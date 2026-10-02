package tests

import (
	"fmt"
	"net/http"
	"testing"
)

// TestIterationProgressBatch exercises POST /api/iterations/progress —
// the bulk progress fetch that backs the dashboard iteration-timeline widget,
// replacing one GET /iterations/{id}/progress per iteration. It verifies the
// requested iteration is present, a non-existent id is omitted,
// and the batched report matches the per-iteration endpoint.
func TestIterationProgressBatch(t *testing.T) {
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)

	wsID, _ := CreateTestWorkspace(t, server, "Iter Progress WS", shortKey("IPWS"))

	iterationData := map[string]interface{}{
		"name":        "Sprint Batch",
		"description": "batch progress test",
		"start_date":  "2024-01-01",
		"end_date":    "2024-01-31",
		"status":      "active",
	}
	iterResp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/v2/workspaces/%d/iterations", wsID), iterationData)
	AssertStatusCode(t, iterResp, http.StatusCreated)
	var iter map[string]interface{}
	DecodeJSON(t, iterResp, &iter)
	iterResp.Body.Close()
	iterationID := ExtractIDFromResponse(t, iter)
	const missing = 999999999

	resp := MakeAuthRequest(t, server, http.MethodPost, "/v2/iterations/progress", map[string]any{"ids": []int{iterationID, missing}})
	defer resp.Body.Close()
	AssertStatusCode(t, resp, http.StatusOK)

	var batch []struct {
		IterationID int                    `json:"iteration_id"`
		Progress    map[string]interface{} `json:"progress"`
	}
	DecodeJSON(t, resp, &batch)

	if len(batch) != 1 || batch[0].IterationID != iterationID {
		t.Fatalf("batch response = %+v, want only iteration %d", batch, iterationID)
	}

	// Cross-check a stable field against the per-iteration endpoint.
	perResp := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/v2/iterations/%d/progress", iterationID), nil)
	defer perResp.Body.Close()
	AssertStatusCode(t, perResp, http.StatusOK)
	var per map[string]interface{}
	DecodeJSON(t, perResp, &per)

	if intField(batch[0].Progress, "total_items") != intField(per, "total_items") {
		t.Fatalf("batch total_items %v != per-iteration total_items %v",
			batch[0].Progress["total_items"], per["total_items"])
	}
}

// TestIterationProgressBatch_NoIDs verifies an empty ids list returns an empty
// array, not an error.
func TestIterationProgressBatch_NoIDs(t *testing.T) {
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)

	resp := MakeAuthRequest(t, server, http.MethodPost, "/v2/iterations/progress", map[string]any{"ids": []int{}})
	defer resp.Body.Close()
	AssertStatusCode(t, resp, http.StatusOK)

	var batch []map[string]interface{}
	DecodeJSON(t, resp, &batch)
	if len(batch) != 0 {
		t.Fatalf("want empty array, got %v", batch)
	}
}
