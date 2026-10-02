//go:build test

package handlers

import (
	"strconv"
	"testing"
	"time"

	"windshift/internal/database"
	"windshift/internal/services"
	"windshift/internal/testutils"
	"windshift/internal/testutils/factory"
)

type mockNotificationService struct{}

func (*mockNotificationService) EmitEvent(*services.NotificationEvent) {}

func grantSystemAdmin(t *testing.T, tdb *testutils.TestDB, userID int) {
	t.Helper()
	newServiceSetup(t, tdb).GrantGlobal(userID, "system.admin")
}

func createTestServices(t *testing.T, db testutils.TestDB) (*services.PermissionService, *services.ActivityTracker, *mockNotificationService) {
	t.Helper()
	permissionConfig := services.DefaultPermissionCacheConfig()
	permissionConfig.WarmupOnStartup = false
	permissionConfig.TTL = time.Minute
	permissionService, err := services.NewPermissionService(db.GetDatabase(), permissionConfig)
	if err != nil {
		t.Fatalf("create permission service: %v", err)
	}
	t.Cleanup(func() { _ = permissionService.Close() })

	activityConfig := services.DefaultActivityTrackerConfig()
	activityConfig.FlushInterval = time.Hour
	activityConfig.ImmediateFlushActivity = false
	activityTracker, err := services.NewActivityTracker(db.GetDatabase(), activityConfig)
	if err != nil {
		t.Fatalf("create activity tracker: %v", err)
	}
	t.Cleanup(func() { _ = activityTracker.Close() })
	return permissionService, activityTracker, &mockNotificationService{}
}

func seedWorkspaceWithRole(t *testing.T, db database.Database, workspaceID, userID int, role string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO workspaces (id, name, key, active) VALUES (?, 'WS', ?, TRUE)`, workspaceID, "WS"+strconv.Itoa(workspaceID)); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	var roleID, adminRoleID int
	if err := db.QueryRow(`SELECT id FROM workspace_roles WHERE name = ?`, role).Scan(&roleID); err != nil {
		t.Fatalf("look up role %s: %v", role, err)
	}
	if err := db.QueryRow(`SELECT id FROM workspace_roles WHERE name = 'Administrator'`).Scan(&adminRoleID); err != nil {
		t.Fatalf("look up administrator role: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO user_workspace_roles (user_id, workspace_id, role_id, granted_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, userID, workspaceID, roleID); err != nil {
		t.Fatalf("assign workspace role: %v", err)
	}
	if userID != 999 {
		if _, err := db.Exec(`INSERT INTO user_workspace_roles (user_id, workspace_id, role_id, granted_at) VALUES (999, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (user_id, workspace_id, role_id) DO NOTHING`, workspaceID, adminRoleID); err != nil {
			t.Fatalf("assign phantom admin: %v", err)
		}
	}
}

func createTestItemForComments(t *testing.T, tdb *testutils.TestDB, data testutils.TestDataSet) int {
	t.Helper()
	id, err := factory.NewTestFactory(tdb.GetDatabase()).CreateItem(factory.CreateItemOpts{
		WorkspaceID: data.WorkspaceID,
		Title:       "Item for events",
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	return id
}
