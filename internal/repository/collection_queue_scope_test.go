//go:build test

package repository_test

import (
	"errors"
	"testing"
	"time"

	"windshift/internal/database"
	"windshift/internal/models"
	"windshift/internal/repository"
	"windshift/internal/testutils"
)

func TestCollectionWorkspaceMovePreservesQueues(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('queue-move@example.test', 'queue-move', 'Queue', 'Move')`)
	oldWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Queue old', 'QOLD')`)
	newWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Queue new', 'QNEW')`)
	collections := repository.NewCollectionRepository(db)
	queues := repository.NewQueueRepository(db)
	collection := models.Collection{Name: "Moving collection", WorkspaceID: &oldWorkspace}
	if err := collections.Create(&collection, ownerID); err != nil {
		t.Fatal(err)
	}
	created, err := queues.Create(&models.Queue{WorkspaceID: oldWorkspace, CollectionID: &collection.ID, Name: "Keep me", QLQuery: "assignee IS NULL"})
	if err != nil {
		t.Fatal(err)
	}
	collection.WorkspaceID = &newWorkspace
	if err := collections.Update(collection.ID, &collection); err != nil {
		t.Fatal(err)
	}
	newRows, err := queues.ListByScope(newWorkspace, &collection.ID)
	if err != nil {
		t.Fatal(err)
	}
	oldRows, err := queues.ListByScope(oldWorkspace, &collection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(newRows) != 1 || newRows[0].ID != created.ID || len(oldRows) != 0 {
		t.Fatalf("moved queue not in collection scope: new=%+v old=%+v", newRows, oldRows)
	}
	if _, err := db.ExecWrite(`DELETE FROM workspaces WHERE id = ?`, oldWorkspace); err != nil {
		t.Fatal(err)
	}
	if _, err := queues.GetByID(created.ID); err != nil {
		t.Fatalf("queue lost with old workspace: %v", err)
	}
}

func TestQueueWriteWaitsForConcurrentCollectionMovePostgres(t *testing.T) {
	if !testutils.IsPostgres() {
		t.Skip("PostgreSQL row-lock serialization")
	}
	for _, tc := range []struct {
		name  string
		write func(*repository.QueueRepository, *models.Queue) error
	}{
		{"create", func(queues *repository.QueueRepository, q *models.Queue) error {
			_, err := queues.Create(q)
			return err
		}},
		{"hide builtin", func(queues *repository.QueueRepository, q *models.Queue) error {
			return queues.SetBuiltinHidden(q, true)
		}},
		{"restore builtin", func(queues *repository.QueueRepository, q *models.Queue) error {
			return queues.SetBuiltinHidden(q, false)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tdb := testutils.CreateTestDB(t, true)
			t.Cleanup(func() { _ = tdb.Close() })
			db := tdb.GetDatabase()
			ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('queue-concurrent@example.test', 'queue-concurrent', 'Queue', 'Concurrent')`)
			oldWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Concurrent queue old', 'CQOLD')`)
			newWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Concurrent queue new', 'CQNEW')`)
			collections := repository.NewCollectionRepository(db)
			queues := repository.NewQueueRepository(db)
			collection := models.Collection{Name: "Concurrent", WorkspaceID: &oldWorkspace}
			if err := collections.Create(&collection, ownerID); err != nil {
				t.Fatal(err)
			}
			builtinKey := "unassigned"
			q := &models.Queue{WorkspaceID: oldWorkspace, CollectionID: &collection.ID, Name: "Concurrent queue", QLQuery: "assignee IS NULL", BuiltinKey: &builtinKey}
			if tc.name == "create" {
				q.BuiltinKey = nil
			}

			// Hold the same collection row lock as CollectionRepository.Update,
			// then observe the writer waiting in PostgreSQL before committing.
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback() }()
			if _, err := tx.Exec("UPDATE collections SET workspace_id = ? WHERE id = ?", newWorkspace, collection.ID); err != nil {
				t.Fatal(err)
			}
			writeDone := make(chan error, 1)
			go func() { writeDone <- tc.write(queues, q) }()
			if err := waitForQueueRowLock(db, 5*time.Second); err != nil {
				_ = tx.Rollback()
				<-writeDone
				t.Fatal(err)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			if err := <-writeDone; !errors.Is(err, repository.ErrNotFound) {
				t.Fatalf("write after concurrent move = %v, want not found", err)
			}
			rows, err := queues.ListByScope(oldWorkspace, &collection.ID)
			if err != nil || len(rows) != 0 {
				t.Fatalf("queue stranded in old scope: rows=%+v error=%v", rows, err)
			}
		})
	}
}

func waitForQueueRowLock(db database.Database, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		err := db.QueryRow(`
			SELECT COUNT(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'
			AND query LIKE '%UPDATE collections SET updated_at = updated_at%'
		`).Scan(&waiting)
		if err != nil {
			return err
		}
		if waiting > 0 {
			return nil
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			return errors.New("queue writer did not wait for the collection row lock")
		}
	}
}

func TestCollectionGlobalMoveRejectsExistingQueuesWithoutChangingData(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('queue-global@example.test', 'queue-global', 'Queue', 'Global')`)
	workspaceID := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Queue scoped', 'QSCOPE')`)
	collections := repository.NewCollectionRepository(db)
	queues := repository.NewQueueRepository(db)
	withQueue := models.Collection{Name: "Has queue", WorkspaceID: &workspaceID}
	if err := collections.Create(&withQueue, ownerID); err != nil {
		t.Fatal(err)
	}
	queue, err := queues.Create(&models.Queue{WorkspaceID: workspaceID, CollectionID: &withQueue.ID, Name: "Preserve", QLQuery: "assignee IS NULL"})
	if err != nil {
		t.Fatal(err)
	}
	withQueue.WorkspaceID = nil
	withQueue.Name = "Rejected rename"
	if err := collections.Update(withQueue.ID, &withQueue); !errors.Is(err, repository.ErrCollectionQueuesRequireWorkspace) {
		t.Fatalf("move with queue = %v, want ErrCollectionQueuesRequireWorkspace", err)
	}
	stored, err := collections.GetModel(withQueue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.WorkspaceID == nil || *stored.WorkspaceID != workspaceID || stored.Name != "Has queue" {
		t.Fatalf("failed move changed collection: %+v", stored)
	}
	if _, err := queues.GetByID(queue.ID); err != nil {
		t.Fatalf("failed move lost queue: %v", err)
	}

	withoutQueue := models.Collection{Name: "No queue", WorkspaceID: &workspaceID}
	if err := collections.Create(&withoutQueue, ownerID); err != nil {
		t.Fatal(err)
	}
	withoutQueue.WorkspaceID = nil
	if err := collections.Update(withoutQueue.ID, &withoutQueue); err != nil {
		t.Fatalf("move without queue: %v", err)
	}
	global, err := collections.GetModel(withoutQueue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if global.WorkspaceID != nil {
		t.Fatalf("global collection still has workspace: %+v", global)
	}
}

func TestLegacyGlobalCollectionWithQueueCanBeRenamedAndRebound(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('legacy-queue@example.test', 'legacy-queue', 'Queue', 'Legacy')`)
	oldWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Legacy queue old', 'LQOLD')`)
	newWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Legacy queue new', 'LQNEW')`)
	collections := repository.NewCollectionRepository(db)
	queues := repository.NewQueueRepository(db)
	collection := models.Collection{Name: "Legacy", WorkspaceID: &oldWorkspace}
	if err := collections.Create(&collection, ownerID); err != nil {
		t.Fatal(err)
	}
	queue, err := queues.Create(&models.Queue{WorkspaceID: oldWorkspace, CollectionID: &collection.ID, Name: "Retained", QLQuery: "assignee IS NULL"})
	if err != nil {
		t.Fatal(err)
	}
	// Recreate the old bug's otherwise unreachable persisted state.
	if _, err := db.ExecWrite("UPDATE collections SET workspace_id = NULL WHERE id = ?", collection.ID); err != nil {
		t.Fatal(err)
	}
	collection.WorkspaceID = nil
	collection.Name = "Renamed legacy"
	if err := collections.Update(collection.ID, &collection); err != nil {
		t.Fatalf("rename legacy global collection: %v", err)
	}
	stored, err := collections.GetModel(collection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.WorkspaceID != nil || stored.Name != "Renamed legacy" {
		t.Fatalf("rename changed scope or name: %+v", stored)
	}
	if _, err := queues.GetByID(queue.ID); err != nil {
		t.Fatalf("rename lost legacy queue: %v", err)
	}
	collection.WorkspaceID = &newWorkspace
	if err := collections.Update(collection.ID, &collection); err != nil {
		t.Fatalf("rebind legacy collection: %v", err)
	}
	rows, err := queues.ListByScope(newWorkspace, &collection.ID)
	if err != nil || len(rows) != 1 || rows[0].ID != queue.ID {
		t.Fatalf("rebound queue: rows=%+v error=%v", rows, err)
	}
}

func TestQueueCreationRejectsStaleCollectionWorkspace(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('stale-queue@example.test', 'stale-queue', 'Queue', 'Stale')`)
	oldWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Stale queue old', 'SQOLD')`)
	newWorkspace := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Stale queue new', 'SQNEW')`)
	collections := repository.NewCollectionRepository(db)
	queues := repository.NewQueueRepository(db)
	collection := models.Collection{Name: "Moving", WorkspaceID: &oldWorkspace}
	if err := collections.Create(&collection, ownerID); err != nil {
		t.Fatal(err)
	}
	collection.WorkspaceID = &newWorkspace
	if err := collections.Update(collection.ID, &collection); err != nil {
		t.Fatal(err)
	}
	if _, err := queues.Create(&models.Queue{WorkspaceID: oldWorkspace, CollectionID: &collection.ID, Name: "Stale", QLQuery: "assignee IS NULL"}); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("stale queue create = %v, want not found", err)
	}
	builtinKey := "unassigned"
	staleBuiltin := &models.Queue{WorkspaceID: oldWorkspace, CollectionID: &collection.ID, Name: "Unassigned", QLQuery: "assignee IS NULL", BuiltinKey: &builtinKey}
	for _, hidden := range []bool{true, false} {
		if err := queues.SetBuiltinHidden(staleBuiltin, hidden); !errors.Is(err, repository.ErrNotFound) {
			t.Fatalf("stale builtin hidden=%v = %v, want not found", hidden, err)
		}
	}
	rows, err := queues.ListByScope(oldWorkspace, &collection.ID)
	if err != nil || len(rows) != 0 {
		t.Fatalf("stale queue persisted: rows=%+v error=%v", rows, err)
	}
	if _, err := queues.Create(&models.Queue{WorkspaceID: newWorkspace, CollectionID: &collection.ID, Name: "Current", QLQuery: "assignee IS NULL"}); err != nil {
		t.Fatalf("current queue create: %v", err)
	}
}
