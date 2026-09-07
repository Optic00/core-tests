package tests

import (
	"fmt"
	"net/http"
	"testing"
)

func TestFixtureItemsByWorkspaceIncludesEveryPage(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	workspaceID, _ := CreateTestWorkspace(t, ts, "Paginated fixtures", "FIXPAGE")
	otherID, _ := CreateTestWorkspace(t, ts, "Excluded fixtures", "FIXOTHER")
	create := func(workspaceID, index int) int {
		return DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, "/items", map[string]any{
			"workspace_id": workspaceID, "title": fmt.Sprintf("Fixture item %03d", index),
		}), http.StatusCreated).ID
	}
	excluded := create(otherID, 0)
	if items := GetItemsByWorkspace(t, ts, workspaceID); len(items) != 0 {
		t.Fatalf("empty workspace returned %d items", len(items))
	}
	// The helper requests 100 items per page. One additional item must neither
	// disappear nor duplicate an item from the first page.
	want := make(map[int]bool, fixtureItemPageSize+1)
	for index := 0; index < fixtureItemPageSize+1; index++ {
		id := create(workspaceID, index)
		if id <= 0 || want[id] {
			t.Fatalf("invalid or duplicate created item ID: %d", id)
		}
		want[id] = true
	}
	items := GetItemsByWorkspace(t, ts, workspaceID)
	if len(items) != len(want) {
		t.Fatalf("all pages returned %d items, want %d", len(items), len(want))
	}
	for _, item := range items {
		id := ExtractIDFromResponse(t, item)
		if id == excluded || !want[id] || item["workspace_id"] != float64(workspaceID) {
			t.Fatalf("unexpected, duplicate or foreign item: %+v", item)
		}
		delete(want, id)
	}
	if len(want) != 0 {
		t.Fatalf("missing item IDs: %v", want)
	}
}
