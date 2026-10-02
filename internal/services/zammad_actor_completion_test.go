package services

import (
	"context"
	"strings"
	"testing"

	"windshift/internal/models"
	"windshift/internal/repository"
)

func TestZammadCompletionRequiresActiveConfiguredActor(t *testing.T) {
	f := newZammadServiceFixture(t, nil)
	f.service.workflow = NewWorkflowService(f.db)

	if _, err := f.db.ExecWrite(`
		INSERT INTO user_global_permissions (user_id, permission_id)
		SELECT ?, id FROM permissions WHERE permission_key = 'system.admin'
	`, f.actorID); err != nil {
		t.Fatal(err)
	}

	link, err := f.service.CreateTicket(context.Background(), f.item1, f.actorID,
		models.CreateZammadTicketRequest{ConnectionID: f.connection.ProviderID})
	if err != nil {
		t.Fatal(err)
	}
	closed := []int{4}
	if _, err := f.service.UpdateConnection(f.connection.ProviderID,
		models.UpdateZammadConnectionRequest{ClosedStateIDs: &closed, CompletionStatusID: &f.doneStatus}); err != nil {
		t.Fatal(err)
	}

	if _, err := NewUserDeactivationService(f.db, UserDeactivationInvalidators{}).DeactivateUser(f.actorID); err != nil {
		t.Fatal(err)
	}
	config := DefaultPermissionCacheConfig()
	config.WarmupOnStartup = false
	permission, err := NewPermissionService(f.db, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = permission.Close() })
	f.service.permission = permission
	allowed, err := permission.HasWorkspacePermission(f.actorID, f.workspace1, models.PermissionItemEdit)
	if err != nil || !allowed {
		t.Fatalf("stale grant prerequisite: allowed=%v error=%v", allowed, err)
	}

	f.transport.getTicket = map[string]any{
		"id": 901, "number": "420901", "group_id": 7,
		"state_id": 4, "state": "closed",
	}
	if _, err := f.service.SyncTicketLink(context.Background(), link.ID); err == nil || !strings.Contains(err.Error(), "configured Zammad actor is inactive") {
		t.Fatalf("inactive actor sync error = %v", err)
	}
	var statusID int
	if err := f.db.QueryRow("SELECT status_id FROM items WHERE id = ?", f.item1).Scan(&statusID); err != nil {
		t.Fatal(err)
	}
	if statusID != f.openStatus {
		t.Fatalf("inactive actor completed item: status=%d", statusID)
	}
	stored, err := f.service.GetTicketLink(link.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.CompletionApplied || !strings.Contains(stored.LastError, "configured Zammad actor is inactive") {
		t.Fatalf("rejected completion state = %#v", stored)
	}

	if err := repository.NewUserRepository(f.db).SetActive(f.actorID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.SyncTicketLink(context.Background(), link.ID); err != nil {
		t.Fatalf("reactivated actor cannot complete: %v", err)
	}
	if err := f.db.QueryRow("SELECT status_id FROM items WHERE id = ?", f.item1).Scan(&statusID); err != nil {
		t.Fatal(err)
	}
	stored, err = f.service.GetTicketLink(link.ID)
	if err != nil {
		t.Fatal(err)
	}
	if statusID != f.doneStatus || !stored.CompletionApplied || stored.LastError != "" {
		t.Fatalf("reactivated completion: status=%d link=%#v", statusID, stored)
	}
}
