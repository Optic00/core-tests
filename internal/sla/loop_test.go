//go:build test

package sla

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"windshift/internal/models"
)

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

type manualTimer struct{ ch chan time.Time }

func (m *manualTimer) Chan() <-chan time.Time { return m.ch }
func (m *manualTimer) Stop()                  {}
func (m *manualTimer) fire()                  { m.ch <- time.Now() }

type timerRegistry struct {
	mu     sync.Mutex
	timers []*manualTimer
	created chan *manualTimer
}

func newTimerRegistry() *timerRegistry {
	return &timerRegistry{created: make(chan *manualTimer, 64)}
}

func (r *timerRegistry) factory(time.Duration) Timer {
	timer := &manualTimer{ch: make(chan time.Time, 1)}
	r.mu.Lock()
	r.timers = append(r.timers, timer)
	r.mu.Unlock()
	select {
	case r.created <- timer:
	default:
	}
	return timer
}

type fakeStore struct {
	mu          sync.Mutex
	hasDue      bool
	nextDue     time.Time
	dueJobs     []models.SLAJob
	configured  bool
	nextCalls   int
	configCalls int
	nextCalled  chan struct{}
	rescheduled map[int64]time.Time
	failed      map[int64]string
	// renewKeep limits which jobs renew; nil renews everything. renewCalls
	// counts renewal statements.
	renewKeep  map[int64]bool
	renewCalls int
}

func newFakeStore() *fakeStore {
	return &fakeStore{rescheduled: map[int64]time.Time{}, failed: map[int64]string{}, nextCalled: make(chan struct{}, 64)}
}

func (s *fakeStore) NextDueAt(context.Context) (time.Time, bool, error) {
	s.mu.Lock()
	s.nextCalls++
	s.mu.Unlock()
	select {
	case s.nextCalled <- struct{}{}:
	default:
	}
	return s.nextDue, s.hasDue, nil
}

func (s *fakeStore) ClaimDueJobs(context.Context, time.Time, time.Duration, string, int) ([]models.SLAJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]models.SLAJob(nil), s.dueJobs...), nil
}

func (s *fakeStore) RenewJobsLease(_ context.Context, jobIDs []int64, _ string, until time.Time) ([]int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.renewCalls++
	_ = until
	renewed := make([]int64, 0, len(jobIDs))
	for _, id := range jobIDs {
		if s.renewKeep == nil || s.renewKeep[id] {
			renewed = append(renewed, id)
		}
	}
	return renewed, nil
}

func (s *fakeStore) RescheduleOwnedJob(_ context.Context, jobID int64, _, lastError string, dueAt time.Time) error {
	return s.RescheduleJob(context.Background(), jobID, dueAt, lastError)
}

func (s *fakeStore) FailOwnedJob(_ context.Context, jobID int64, _ string, lastError string) error {
	return s.FailJob(context.Background(), jobID, lastError)
}

func (s *fakeStore) RescheduleJob(_ context.Context, jobID int64, dueAt time.Time, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rescheduled[jobID] = dueAt
	return nil
}

func (s *fakeStore) FailJob(_ context.Context, jobID int64, lastError string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failed[jobID] = lastError
	return nil
}

func (s *fakeStore) HasConfiguration(context.Context) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.configCalls++
	return s.configured, nil
}

func (s *fakeStore) drainNextCalled() {
	for {
		select {
		case <-s.nextCalled:
		default:
			return
		}
	}
}

func (s *fakeStore) snapshot() (nextCalls, configCalls int, rescheduled map[int64]time.Time, failed map[int64]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextCalls, s.configCalls, s.rescheduled, s.failed
}

type fakeRunner struct {
	mu    sync.Mutex
	calls []int64
	err   error
}

func (r *fakeRunner) RunJob(_ context.Context, job models.SLAJob) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, job.ID)
	return r.err
}

func (r *fakeRunner) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func TestLoopRunOnceReschedulesFailedJobWithBackoff(t *testing.T) {
	now := time.Date(2025, 1, 8, 12, 0, 0, 0, time.UTC)
	store := newFakeStore()
	store.dueJobs = []models.SLAJob{{ID: 7, Kind: models.SLAJobRecalcItem, Attempts: 1, DueAt: now.Add(-time.Minute)}}
	runner := &fakeRunner{err: errors.New("transient")}
	loop := NewLoop(store, runner, fixedClock{now: now}, newTimerRegistry().factory, LoopConfig{MaxAttempts: 5})

	if err := loop.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	_, _, rescheduled, failed := store.snapshot()
	want := now.Add(Backoff(1))
	if got, ok := rescheduled[7]; !ok || !got.Equal(want) {
		t.Fatalf("rescheduled = %v, want %v", got, want)
	}
	if len(failed) != 0 {
		t.Fatalf("job should not be parked yet: %v", failed)
	}
}

func TestLoopRunOnceParksJobAfterMaxAttempts(t *testing.T) {
	now := time.Date(2025, 1, 8, 12, 0, 0, 0, time.UTC)
	store := newFakeStore()
	store.dueJobs = []models.SLAJob{{ID: 9, Kind: models.SLAJobBreach, Attempts: 8, DueAt: now.Add(-time.Minute)}}
	runner := &fakeRunner{err: errors.New("permanent")}
	loop := NewLoop(store, runner, fixedClock{now: now}, newTimerRegistry().factory, LoopConfig{MaxAttempts: 8})

	if err := loop.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	_, _, rescheduled, failed := store.snapshot()
	if _, ok := rescheduled[9]; ok {
		t.Fatalf("job should not be rescheduled after max attempts")
	}
	if failed[9] != "permanent" {
		t.Fatalf("failed[9] = %q, want %q", failed[9], "permanent")
	}
}

func TestBackoffIsExponentialAndCapped(t *testing.T) {
	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{attempts: 1, want: 30 * time.Second},
		{attempts: 2, want: 60 * time.Second},
		{attempts: 3, want: 120 * time.Second},
		{attempts: 4, want: 240 * time.Second},
		{attempts: 5, want: 5 * time.Minute},
		{attempts: 9, want: 5 * time.Minute},
	}
	for _, tc := range cases {
		if got := Backoff(tc.attempts); got != tc.want {
			t.Fatalf("Backoff(%d) = %s, want %s", tc.attempts, got, tc.want)
		}
	}
}

func TestLoopBlocksWithNoConfigurationAndZeroTimers(t *testing.T) {
	store := newFakeStore()
	store.configured = false
	runner := &fakeRunner{}
	timers := newTimerRegistry()
	loop := NewLoop(store, runner, fixedClock{time.Now()}, timers.factory, LoopConfig{})
	loop.idleCh = make(chan struct{}, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { loop.Run(ctx); close(done) }()

	select {
	case <-loop.idleCh:
	case <-time.After(2 * time.Second):
		t.Fatal("loop did not go idle")
	}
	// Once idle, no safety timer may have been armed and no job may have run.
	if len(timers.timers) != 0 {
		t.Fatalf("timers created while idle = %d, want 0", len(timers.timers))
	}
	if runner.callCount() != 0 {
		t.Fatalf("runner called %d times while idle", runner.callCount())
	}
	if _, configCalls, _, _ := store.snapshot(); configCalls != 1 {
		t.Fatalf("config checks = %d, want exactly 1 before going idle", configCalls)
	}

	store.drainNextCalled()
	// A nudge must wake it without a timer.
	loop.Nudge(time.Now())
	select {
	case <-store.nextCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("nudge did not wake the loop")
	}
	cancel()
	<-done
}

func TestLoopSafetyIntervalReReadsWithConfiguration(t *testing.T) {
	store := newFakeStore()
	store.configured = true
	runner := &fakeRunner{}
	timers := newTimerRegistry()
	loop := NewLoop(store, runner, fixedClock{time.Now()}, timers.factory, LoopConfig{SafetyInterval: 15 * time.Minute})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { loop.Run(ctx); close(done) }()

	// First idle pass arms a safety timer.
	var timer *manualTimer
	select {
	case timer = <-timers.created:
	case <-time.After(2 * time.Second):
		t.Fatal("no safety timer created")
	}
	if _, configCalls, _, _ := store.snapshot(); configCalls != 1 {
		t.Fatalf("config checks = %d, want 1", configCalls)
	}
	store.drainNextCalled()
	timer.fire()

	// Firing the timer must produce exactly one more MIN read.
	select {
	case <-store.nextCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("safety timer did not trigger a re-read")
	}
	if _, configCalls, _, _ := store.snapshot(); configCalls != 1 {
		t.Fatalf("config checks = %d after re-read, want still 1", configCalls)
	}
	cancel()
	<-done
}

func TestLoopNudgeWakesSafetyWait(t *testing.T) {
	store := newFakeStore()
	store.configured = true
	runner := &fakeRunner{}
	timers := newTimerRegistry()
	loop := NewLoop(store, runner, fixedClock{time.Now()}, timers.factory, LoopConfig{SafetyInterval: time.Hour})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { loop.Run(ctx); close(done) }()

	select {
	case <-timers.created:
	case <-time.After(2 * time.Second):
		t.Fatal("no safety timer created")
	}
	store.drainNextCalled()
	loop.Nudge(time.Now())
	select {
	case <-store.nextCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("nudge did not wake the safety wait")
	}
	cancel()
	<-done
}
