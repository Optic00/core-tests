//go:build test

package services_test

import (
	"context"
	"errors"
	"testing"

	"windshift/internal/models"
	"windshift/internal/repository"
	"windshift/internal/services"
	"windshift/internal/testutils"
)

func TestCollectionQueuesRequireWorkspaceItemView(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('queue-owner@example.test', 'queue-owner', 'Queue', 'Owner')`)
	outsiderID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('queue-outsider@example.test', 'queue-outsider', 'Queue', 'Outsider')`)
	workspaceID := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Restricted queue workspace', 'QRESTRICT')`)
	if _, err := db.ExecWrite(`INSERT INTO user_workspace_roles (user_id, workspace_id, role_id) SELECT ?, ?, id FROM workspace_roles WHERE builtin_key = 'viewer'`, ownerID, workspaceID); err != nil {
		t.Fatal(err)
	}
	public := models.Collection{Name: "Public queue collection", WorkspaceID: &workspaceID, IsPublic: true}
	if err := repository.NewCollectionRepository(db).Create(&public, ownerID); err != nil {
		t.Fatal(err)
	}
	private := models.Collection{Name: "Revoked owner collection", WorkspaceID: &workspaceID}
	if err := repository.NewCollectionRepository(db).Create(&private, outsiderID); err != nil {
		t.Fatal(err)
	}
	global := models.Collection{Name: "Private global collection"}
	if err := repository.NewCollectionRepository(db).Create(&global, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.NewQueueRepository(db).Create(&models.Queue{WorkspaceID: workspaceID, CollectionID: &public.ID, Name: "Internal escalation", QLQuery: "assignee IS NULL"}); err != nil {
		t.Fatal(err)
	}

	config := services.DefaultPermissionCacheConfig()
	config.WarmupOnStartup = false
	permissions, err := services.NewPermissionService(db, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = permissions.Close() })
	allowed, err := permissions.HasWorkspacePermission(outsiderID, workspaceID, models.PermissionItemView)
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Fatal("outsider unexpectedly has item.view")
	}
	app := services.NewItemApplicationService(db, permissions, nil, nil, nil)
	for _, collectionID := range []int{public.ID, private.ID, global.ID} {
		if _, err := app.ListQueues(context.Background(), outsiderID, 0, &collectionID); !errors.Is(err, repository.ErrNotFound) {
			t.Errorf("ListQueues(collection %d) = %v, want not found", collectionID, err)
		}
		if _, err := app.CreateQueue(context.Background(), services.AuditActor{UserID: outsiderID}, 0, &collectionID, services.QueueInput{Name: "Unauthorized", QL: "assignee IS NULL"}); !errors.Is(err, repository.ErrNotFound) {
			t.Errorf("CreateQueue(collection %d) = %v, want not found", collectionID, err)
		}
	}
	visible, err := app.ListQueues(context.Background(), ownerID, 0, &public.ID)
	if err != nil {
		t.Fatalf("owner ListQueues: %v", err)
	}
	found := false
	for _, queue := range visible {
		if queue.Name == "Internal escalation" {
			found = true
		}
	}
	if !found {
		t.Fatalf("owner could not see custom queue: %+v", visible)
	}
}

func TestCollectionApplicationRejectsGlobalMoveWhileQueuesExist(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	db := tdb.GetDatabase()
	ownerID := testutils.InsertID(t, db, `INSERT INTO users (email, username, first_name, last_name) VALUES ('queue-move-owner@example.test', 'queue-move-owner', 'Queue', 'Owner')`)
	workspaceID := testutils.InsertID(t, db, `INSERT INTO workspaces (name, key) VALUES ('Queue move', 'QMOVE')`)
	if _, err := db.ExecWrite(`INSERT INTO user_workspace_roles (user_id, workspace_id, role_id) SELECT ?, ?, id FROM workspace_roles WHERE builtin_key = 'viewer'`, ownerID, workspaceID); err != nil {
		t.Fatal(err)
	}
	collection := models.Collection{Name: "Scoped", WorkspaceID: &workspaceID}
	if err := repository.NewCollectionRepository(db).Create(&collection, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.NewQueueRepository(db).Create(&models.Queue{WorkspaceID: workspaceID, CollectionID: &collection.ID, Name: "Preserved", QLQuery: "assignee IS NULL"}); err != nil {
		t.Fatal(err)
	}
	config := services.DefaultPermissionCacheConfig()
	config.WarmupOnStartup = false
	permissions, err := services.NewPermissionService(db, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = permissions.Close() })
	app := services.NewCollectionApplicationService(db, permissions)
	_, err = app.Update(services.AuditActor{UserID: ownerID}, collection.ID, services.CollectionUpdate{WorkspaceIDSet: true})
	var validation *services.CollectionValidationError
	if !errors.As(err, &validation) || validation.Message != "remove collection queues before clearing its workspace" {
		t.Fatalf("global move with queues = %v, want collection validation error", err)
	}
	stored, err := repository.NewCollectionRepository(db).GetModel(collection.ID)
	if err != nil || stored.WorkspaceID == nil || *stored.WorkspaceID != workspaceID || stored.Name != "Scoped" {
		t.Fatalf("rejected move changed collection: value=%+v error=%v", stored, err)
	}
	// Emulate the legacy state left by the old move path. Ordinary edits must
	// remain possible even when a queue is stranded in the former workspace.
	if _, err := db.ExecWrite("UPDATE collections SET workspace_id = NULL WHERE id = ?", collection.ID); err != nil {
		t.Fatal(err)
	}
	updated, err := app.Update(services.AuditActor{UserID: ownerID}, collection.ID,
		services.CollectionUpdate{NameSet: true, Name: "Renamed legacy"})
	if err != nil || updated.WorkspaceID != nil || updated.Name != "Renamed legacy" {
		t.Fatalf("legacy rename: value=%+v error=%v", updated, err)
	}
	rows, err := repository.NewQueueRepository(db).ListByScope(workspaceID, &collection.ID)
	if err != nil || len(rows) != 1 || rows[0].Name != "Preserved" {
		t.Fatalf("legacy rename lost queue: rows=%+v error=%v", rows, err)
	}
}
