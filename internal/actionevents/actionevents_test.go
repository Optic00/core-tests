//go:build test

package actionevents

import (
	"context"
	"errors"
	"testing"
	"time"

	"windshift/internal/events"
	"windshift/internal/testutils"
)

func TestActivateCutoverRecordsTheNextEventBoundaryOnce(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ctx := context.Background()
	stored, err := events.NewStore(db).AppendStandalone(ctx, events.NewEvent{
		Key: "cutover-predecessor", AggregateType: "test", AggregateID: "cutover",
		Type: "test.cutover.v1", PayloadVersion: 1, OccurredAt: time.Now().UTC(),
		ActorKind: "system", SourceKind: "test", Payload: []byte(`{"value":1}`),
	})
	if err != nil {
		t.Fatalf("append predecessor: %v", err)
	}

	first, err := ActivateCutover(ctx, db, "test.cutover", "test")
	if err != nil {
		t.Fatalf("first ActivateCutover() error = %v", err)
	}
	second, err := ActivateCutover(ctx, db, "test.cutover", "test")
	if err != nil {
		t.Fatalf("second ActivateCutover() error = %v", err)
	}
	current, err := CurrentCutover(ctx, db, "test.cutover")
	if err != nil {
		t.Fatalf("CurrentCutover() error = %v", err)
	}

	wantStart := stored.ID + 1
	if first.StartEventID != wantStart || second.StartEventID != wantStart || current == nil || current.StartEventID != wantStart {
		t.Fatalf("cutover starts = first:%d second:%d current:%v, want %d", first.StartEventID, second.StartEventID, current, wantStart)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM action_event_cutovers WHERE cutover_key = ?", "test.cutover").Scan(&count); err != nil {
		t.Fatalf("count cutovers: %v", err)
	}
	if count != 1 {
		t.Fatalf("cutover row count = %d, want 1", count)
	}
}

func TestRunTargetsKeepsMixedFailuresRetryable(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })

	store := NewTargetStore(tdb.GetDatabase())
	event := events.Event{ID: 1, Key: "mixed-target-failures"}
	if err := store.Materialize(t.Context(), event, "item-actions", "item.updated", []int{1, 2}); err != nil {
		t.Fatalf("Materialize() error = %v", err)
	}

	attempts := map[int]int{}
	callbacks := Callbacks{
		Completed: func(int) (bool, error) { return false, nil },
		Execute: func(actionID int) (bool, error) {
			attempts[actionID]++
			switch actionID {
			case 1:
				return true, errors.New("permanent target failure")
			case 2:
				if attempts[actionID] == 1 {
					return false, errors.New("transient target failure")
				}
				return false, nil
			default:
				t.Fatalf("unexpected action ID %d", actionID)
				return false, nil
			}
		},
	}

	_, err := RunTargets(t.Context(), store, event.Key, callbacks)
	if err == nil {
		t.Fatal("first RunTargets() succeeded with failed targets")
	}
	if events.IsPermanent(err) {
		t.Fatalf("first RunTargets() error = %v, want retryable while a transient target remains", err)
	}

	executed, err := RunTargets(t.Context(), store, event.Key, callbacks)
	if err == nil || !events.IsPermanent(err) {
		t.Fatalf("second RunTargets() error = %v, want permanent after the transient target completes", err)
	}
	if executed != 1 || attempts[2] != 2 {
		t.Fatalf("second RunTargets() executed=%d transient attempts=%d, want 1/2", executed, attempts[2])
	}

	var state string
	if err := tdb.QueryRow(`
		SELECT state FROM action_event_targets
		WHERE event_key = ? AND action_id = 2
	`, event.Key).Scan(&state); err != nil {
		t.Fatalf("load transient target state: %v", err)
	}
	if state != "completed" {
		t.Fatalf("transient target state = %q, want completed", state)
	}
}
