//go:build test

package sla

import (
	"sync"
	"testing"
	"time"
)

func TestTestClockSetAndAdvance(t *testing.T) {
	start := time.Date(2026, 1, 2, 15, 30, 0, 0, time.UTC)
	clock := NewTestClock(start)

	if got := clock.Now(); !got.Equal(start) {
		t.Fatalf("initial Now() = %v, want %v", got, start)
	}

	clock.Advance(90 * time.Minute)
	if got, want := clock.Now(), start.Add(90*time.Minute); !got.Equal(want) {
		t.Fatalf("Now() after advance = %v, want %v", got, want)
	}

	earlier := start.Add(-time.Hour)
	clock.Set(earlier)
	if got := clock.Now(); !got.Equal(earlier) {
		t.Fatalf("Now() after set = %v, want %v", got, earlier)
	}
}

// TestTestClockConcurrentReads exercises Now concurrently with an advance under
// the race detector.
func TestTestClockConcurrentReads(t *testing.T) {
	clock := NewTestClock(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC))

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 100 {
				_ = clock.Now()
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for range 100 {
			clock.Advance(time.Second)
		}
	}()
	wg.Wait()

	// The advance is serialized, so all 100 steps are applied.
	if got, want := clock.Now(), time.Date(2026, 3, 1, 0, 1, 40, 0, time.UTC); !got.Equal(want) {
		t.Fatalf("Now() = %v, want %v", got, want)
	}
}
