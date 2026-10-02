//go:build test

package handlers

import (
	"net/http"
	"testing"

	"windshift/internal/models"
	"windshift/internal/repository"
	"windshift/internal/testutils"
)

func TestWorkspaceHandlerGet(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	var workspaceID int
	if err := tdb.QueryRow(`
		INSERT INTO workspaces (name, key, description, active, created_at, updated_at)
		VALUES ('Test Workspace', 'TEST', 'Test workspace', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id
	`).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	grantSystemAdmin(t, tdb, 1)
	permissionService, activityTracker, _ := createTestServices(t, *tdb)
	keyCache := NewWorkspaceKeyCache(repository.NewWorkspaceRepository(tdb.GetDatabase()))
	handler := NewWorkspaceHandler(tdb.GetDatabase(), permissionService, activityTracker, keyCache)

	request := testutils.CreateJSONRequest(t, http.MethodGet, "/api/workspaces/"+testutils.IntToString(workspaceID), nil)
	request.SetPathValue("id", testutils.IntToString(workspaceID))
	response := testutils.ExecuteAuthenticatedRequest(t, handler.Get, request, nil)
	response.AssertStatusCode(http.StatusOK).AssertContentType("application/json")

	var workspace models.Workspace
	response.AssertJSONResponse(&workspace)
	if workspace.ID != workspaceID || workspace.Name != "Test Workspace" || workspace.Key != "TEST" || workspace.Description != "Test workspace" || !workspace.Active {
		t.Fatalf("workspace = %#v", workspace)
	}
}

func TestWorkspaceHandlerGetNotFound(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()
	grantSystemAdmin(t, tdb, 1)
	permissionService, activityTracker, _ := createTestServices(t, *tdb)
	keyCache := NewWorkspaceKeyCache(repository.NewWorkspaceRepository(tdb.GetDatabase()))
	handler := NewWorkspaceHandler(tdb.GetDatabase(), permissionService, activityTracker, keyCache)

	request := testutils.CreateJSONRequest(t, http.MethodGet, "/api/workspaces/99999", nil)
	request.SetPathValue("id", "99999")
	response := testutils.ExecuteAuthenticatedRequest(t, handler.Get, request, nil)
	response.AssertStatusCode(http.StatusNotFound)
}

func TestWorkspaceHandlerGetAll(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	for _, workspace := range []struct{ name, key, description string }{
		{"Workspace A", "WSA", "First workspace"},
		{"Workspace B", "WSB", "Second workspace"},
		{"Workspace C", "WSC", "Third workspace"},
	} {
		if _, err := tdb.Exec(`
			INSERT INTO workspaces (name, key, description, active, created_at, updated_at)
			VALUES (?, ?, ?, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`, workspace.name, workspace.key, workspace.description); err != nil {
			t.Fatalf("create workspace %s: %v", workspace.name, err)
		}
	}

	grantSystemAdmin(t, tdb, 1)
	permissionService, activityTracker, _ := createTestServices(t, *tdb)
	keyCache := NewWorkspaceKeyCache(repository.NewWorkspaceRepository(tdb.GetDatabase()))
	handler := NewWorkspaceHandler(tdb.GetDatabase(), permissionService, activityTracker, keyCache)
	request := testutils.CreateJSONRequest(t, http.MethodGet, "/api/workspaces", nil)
	response := testutils.ExecuteAuthenticatedRequest(t, handler.GetAll, request, nil)
	response.AssertStatusCode(http.StatusOK).AssertContentType("application/json")

	var workspaces []models.Workspace
	response.AssertJSONResponse(&workspaces)
	if len(workspaces) != 3 {
		t.Fatalf("workspaces = %#v", workspaces)
	}
	for index, name := range []string{"Workspace A", "Workspace B", "Workspace C"} {
		if workspaces[index].Name != name {
			t.Fatalf("workspace %d name = %q, want %q", index, workspaces[index].Name, name)
		}
	}
}

func TestWorkspaceHandlerGetByKey(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()
	if _, err := tdb.Exec(`
		INSERT INTO workspaces (name, key, description, active, created_at, updated_at)
		VALUES ('Test Workspace', 'TEST', 'Test workspace', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`); err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	grantSystemAdmin(t, tdb, 1)
	permissionService, activityTracker, _ := createTestServices(t, *tdb)
	keyCache := NewWorkspaceKeyCache(repository.NewWorkspaceRepository(tdb.GetDatabase()))
	handler := NewWorkspaceHandler(tdb.GetDatabase(), permissionService, activityTracker, keyCache)
	request := testutils.CreateJSONRequest(t, http.MethodGet, "/api/workspaces/TEST", nil)
	request.SetPathValue("id", "TEST")
	response := testutils.ExecuteAuthenticatedRequest(t, handler.Get, request, nil)
	response.AssertStatusCode(http.StatusOK)

	var workspace models.Workspace
	response.AssertJSONResponse(&workspace)
	if workspace.Name != "Test Workspace" || workspace.Key != "TEST" {
		t.Fatalf("workspace = %#v", workspace)
	}
}

func TestWorkspaceHandlerGetByKeyNotFound(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()
	grantSystemAdmin(t, tdb, 1)
	permissionService, activityTracker, _ := createTestServices(t, *tdb)
	keyCache := NewWorkspaceKeyCache(repository.NewWorkspaceRepository(tdb.GetDatabase()))
	handler := NewWorkspaceHandler(tdb.GetDatabase(), permissionService, activityTracker, keyCache)
	request := testutils.CreateJSONRequest(t, http.MethodGet, "/api/workspaces/NONEXISTENT", nil)
	request.SetPathValue("id", "NONEXISTENT")
	response := testutils.ExecuteAuthenticatedRequest(t, handler.Get, request, nil)
	response.AssertStatusCode(http.StatusNotFound)
}

func (h *WorkspaceHandler) GetAll(w http.ResponseWriter, r *http.Request) {
	user, ok := RequireAuth(w, r)
	if !ok {
		return
	}
	workspaces, err := h.repo.FindAll(user.ID, r.URL.Query().Get("is_personal") == "true")
	if err != nil {
		respondInternalError(w, r, err)
		return
	}
	visible := make([]models.Workspace, 0, len(workspaces))
	for _, workspace := range workspaces {
		var allowed bool
		if workspace.Active {
			allowed, err = h.canViewWorkspace(user.ID, workspace.ID)
		} else {
			allowed, err = h.authz.HasWorkspacePermission(user.ID, workspace.ID, models.PermissionWorkspaceAdmin)
		}
		if err != nil {
			respondInternalError(w, r, err)
			return
		}
		if allowed {
			visible = append(visible, workspace)
		}
	}
	respondJSONOK(w, visible)
}
