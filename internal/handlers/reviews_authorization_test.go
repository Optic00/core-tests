//go:build test

package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"windshift/internal/models"
	"windshift/internal/services"
	"windshift/internal/testutils"
)

func TestGetCompletedItemsExcludesWorkspacesWithoutItemView(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = tdb.Close() })
	setup := newServiceSetup(t, tdb)
	viewerID := setup.CreateUser("review-viewer@example.test", "review-viewer", "Review", "Viewer")
	otherID := setup.CreateUser("review-other@example.test", "review-other", "Review", "Other")
	visibleWorkspaceID := setup.CreateWorkspace("Visible Review Workspace", "VRW")
	hiddenWorkspaceID := setup.CreateWorkspace("Hidden Review Workspace", "HRW")
	grantViewerRoleForAuthorizationTest(t, tdb, viewerID, visibleWorkspaceID)
	grantViewerRoleForAuthorizationTest(t, tdb, otherID, hiddenWorkspaceID)

	categoryID := testutils.InsertID(t, tdb.GetDatabase(), `
		INSERT INTO status_categories (name, color, is_completed)
		VALUES ('Review Complete Category', '#22c55e', true)
	`)
	statusID := testutils.InsertID(t, tdb.GetDatabase(), `
		INSERT INTO statuses (name, category_id)
		VALUES ('Review Complete Status', ?)
	`, categoryID)
	completedAt := time.Date(2026, time.August, 25, 12, 0, 0, 0, time.UTC)
	createItem := func(workspaceID, creatorID int, title, description string) int {
		t.Helper()
		itemID, err := services.CreateItem(tdb.GetDatabase(), services.ItemCreationParams{
			WorkspaceID: workspaceID,
			Title:       title,
			Description: description,
			StatusID:    &statusID,
			AssigneeID:  &viewerID,
			CreatorID:   &creatorID,
			CreatedAt:   &completedAt,
			UpdatedAt:   &completedAt,
		})
		if err != nil {
			t.Fatalf("create %q: %v", title, err)
		}
		return int(itemID)
	}
	visibleItemID := createItem(visibleWorkspaceID, viewerID, "Visible completed item", "Visible details")
	createItem(hiddenWorkspaceID, otherID, "Restricted completed item", "Restricted details")

	permissionService, err := services.NewPermissionService(tdb.GetDatabase(), services.PermissionCacheConfig{
		TTL: 0, MaxCacheSize: 8, WarmupOnStartup: false, PreWarmActive: false, BatchSize: 10,
	})
	if err != nil {
		t.Fatalf("NewPermissionService: %v", err)
	}
	t.Cleanup(func() { _ = permissionService.Close() })
	handler := NewReviewHandler(tdb.GetDatabase(), permissionService)
	req := testutils.WithAuthContext(
		httptest.NewRequest(http.MethodGet, "/api/reviews/completed-items?start_date=2026-08-25&end_date=2026-08-25", nil),
		testutils.TestUserWithID(viewerID),
	)
	recorder := testutils.ExecuteRequest(t, handler.GetCompletedItems, req)
	recorder.AssertStatusCode(http.StatusOK)

	var items []models.Item
	if err := json.NewDecoder(recorder.Body).Decode(&items); err != nil {
		t.Fatalf("decode completed items: %v", err)
	}
	if len(items) != 1 || items[0].ID != visibleItemID || items[0].Title != "Visible completed item" {
		t.Fatalf("completed items = %+v, want only the item in a visible workspace", items)
	}
}
