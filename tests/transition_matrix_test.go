package tests

import (
	"fmt"
	"net/http"
	"sort"
	"testing"
)

// TestTransitionMatrixEndpoint exercises GET /api/workspaces/{id}/transition-matrix
// — the workspace-wide (item_type, status) transition matrix that backs the
// board's transition preload, replacing the per-pair
// /items/{id}/available-status-transitions fan-out. It cross-validates the
// matrix entry for a real item against that item's per-item endpoint, so the
// two stay consistent.
func TestTransitionMatrixEndpoint(t *testing.T) {
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)

	wsID, _ := CreateTestWorkspace(t, server, "Matrix WS", shortKey("MXWS"))
	configSetID := GetDefaultConfigurationSet(t, server)
	AssociateWorkspaceWithConfigSet(t, server, wsID, configSetID)
	itemID := CreateTestItem(t, server, wsID, "Matrix Item")

	// Read the item to learn its (item_type_id, status_id).
	itemResp := MakeAuthRequest(t, server, http.MethodGet, fmt.Sprintf("/items/%d", itemID), nil)
	var item map[string]interface{}
	DecodeJSON(t, itemResp, &item)
	itemResp.Body.Close()
	itemTypeID := intField(item, "item_type_id")
	statusID := intField(item, "status_id")
	if itemTypeID == 0 || statusID == 0 {
		t.Fatalf("expected item to have item_type_id and status_id, got type=%d status=%d", itemTypeID, statusID)
	}

	// Fetch the matrix.
	matrixResp := MakeAuthRequest(t, server, http.MethodGet, fmt.Sprintf("/workspaces/%d/transition-matrix", wsID), nil)
	defer matrixResp.Body.Close()
	AssertStatusCode(t, matrixResp, http.StatusOK)

	var matrix []struct {
		ItemTypeID  int                      `json:"item_type_id"`
		StatusID    int                      `json:"status_id"`
		Transitions []map[string]interface{} `json:"transitions"`
	}
	DecodeJSON(t, matrixResp, &matrix)

	if len(matrix) == 0 {
		t.Fatalf("expected a non-empty transition matrix")
	}

	var matrixEntry []map[string]interface{}
	for _, entry := range matrix {
		if entry.ItemTypeID == itemTypeID && entry.StatusID == statusID {
			matrixEntry = entry.Transitions
			break
		}
	}
	if matrixEntry == nil {
		t.Fatalf("matrix missing entry for item type %d and status %d", itemTypeID, statusID)
	}

	// Cross-validate against the per-item endpoint (same source of truth, minus
	// item-specific approval/condition gating, which a fresh item has none of).
	perItemResp := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/v2/items/%d/available-transitions", itemID), nil)
	defer perItemResp.Body.Close()
	AssertStatusCode(t, perItemResp, http.StatusOK)

	var perItem struct {
		AvailableTransitions []map[string]interface{} `json:"available_transitions"`
	}
	DecodeJSON(t, perItemResp, &perItem)

	if got, want := statusIDsOf(matrixEntry), statusIDsOf(perItem.AvailableTransitions); !equalIntSlices(got, want) {
		t.Fatalf("matrix transitions %v != per-item transitions %v", got, want)
	}
}

// TestTransitionMatrixEndpoint_PermissionDenied verifies a user without access
// to the workspace gets 404 (existence not leaked), like the per-item endpoint.
func TestTransitionMatrixEndpoint_PermissionDenied(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	adminToken := CreateBearerToken(t, server)
	server.BearerToken = adminToken

	wsID, _ := CreateTestWorkspace(t, server, "Matrix Perm WS", shortKey("MXPW"))
	LockDownWorkspace(t, server, wsID)

	userID, username, password := CreateTestUserWithCredentials(t, server, "matrix_perm_user", "matrix_perm@test.com")
	_ = userID
	userToken := CreateBearerTokenForUser(t, server, username, password)

	resp := MakeAuthRequestWithToken(t, server, userToken, http.MethodGet,
		fmt.Sprintf("/workspaces/%d/transition-matrix", wsID), nil)
	defer resp.Body.Close()
	AssertStatusCode(t, resp, http.StatusNotFound)
}

func statusIDsOf(transitions []map[string]interface{}) []int {
	ids := make([]int, 0, len(transitions))
	for _, t := range transitions {
		ids = append(ids, intField(t, "id"))
	}
	sort.Ints(ids)
	return ids
}
