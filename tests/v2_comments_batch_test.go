package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// createV2BatchComment adds one comment through the production v2 API.
// Sequential creation makes "newest first" deterministic: equal timestamps
// fall back to descending ID, and later inserts have higher IDs.
func createV2BatchComment(t *testing.T, server *TestServer, itemID int, content string) {
	t.Helper()
	response := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/items/%d/comments", itemID),
		map[string]any{"content": content})
	defer response.Body.Close()
	AssertStatusCode(t, response, http.StatusCreated)
}

type commentBatchEntry struct {
	ItemID   int  `json:"item_id"`
	HasMore  bool `json:"has_more"`
	Comments []struct {
		ID      int    `json:"id"`
		Content string `json:"content"`
		Source  string `json:"source"`
	} `json:"comments"`
}

func postCommentsBatch(t *testing.T, server *TestServer, token string, itemIDs []int, pageSize int) (int, []commentBatchEntry) {
	t.Helper()
	body := map[string]any{"item_ids": itemIDs}
	if pageSize != 0 {
		body["page_size"] = pageSize
	}
	response := MakeBearerRequestWithToken(t, server, token, http.MethodPost,
		"/rest/api/v2/comments/batch", body)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return response.StatusCode, nil
	}
	var document struct {
		Data []commentBatchEntry `json:"data"`
	}
	DecodeJSON(t, response, &document)
	return response.StatusCode, document.Data
}

func TestV2CommentsBatchReturnsNewestFirstPerItemInRequestOrder(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Comments batch", shortKey("CB"))
	itemA := CreateTestItem(t, server, workspaceID, "Batch item A")
	itemB := CreateTestItem(t, server, workspaceID, "Batch item B")
	itemC := CreateTestItem(t, server, workspaceID, "Batch item C")

	createV2BatchComment(t, server, itemA, "a-1")
	createV2BatchComment(t, server, itemA, "a-2")
	createV2BatchComment(t, server, itemA, "a-3")
	createV2BatchComment(t, server, itemB, "b-1")

	status, entries := postCommentsBatch(t, server, server.BearerToken,
		[]int{itemB, itemA, 999999999, itemC}, 0)
	if status != http.StatusOK {
		t.Fatalf("batch status = %d, want 200", status)
	}
	if len(entries) != 3 {
		t.Fatalf("entries = %d, want 3 (missing item 999999999 omitted)", len(entries))
	}

	if entries[0].ItemID != itemB {
		t.Errorf("first entry item_id = %d, want %d (request order preserved)", entries[0].ItemID, itemB)
	}
	if len(entries[0].Comments) != 1 || entries[0].Comments[0].Content != "b-1" || entries[0].HasMore {
		t.Errorf("item B entry = %+v, want single b-1 without has_more", entries[0])
	}
	if entries[1].ItemID != itemA {
		t.Errorf("second entry item_id = %d, want %d", entries[1].ItemID, itemA)
	}
	got := make([]string, 0, len(entries[1].Comments))
	for _, comment := range entries[1].Comments {
		got = append(got, comment.Content)
	}
	if strings.Join(got, ",") != "a-3,a-2,a-1" {
		t.Errorf("item A comments = %v, want newest first [a-3 a-2 a-1]", got)
	}
	if entries[1].HasMore {
		t.Error("item A has_more = true, want false (3 comments, default limit 25)")
	}
	if entries[2].ItemID != itemC {
		t.Errorf("third entry item_id = %d, want %d", entries[2].ItemID, itemC)
	}
	if len(entries[2].Comments) != 0 || entries[2].HasMore {
		t.Errorf("item C entry = %+v, want empty comment list", entries[2])
	}
}

func TestV2CommentsBatchPageSizeBoundsAndHasMore(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Comments batch page", shortKey("CBP"))
	itemID := CreateTestItem(t, server, workspaceID, "Paged batch item")
	for i := 1; i <= 3; i++ {
		createV2BatchComment(t, server, itemID, fmt.Sprintf("p-%d", i))
	}

	status, entries := postCommentsBatch(t, server, server.BearerToken, []int{itemID}, 2)
	if status != http.StatusOK {
		t.Fatalf("batch status = %d, want 200", status)
	}
	if len(entries) != 1 || len(entries[0].Comments) != 2 || !entries[0].HasMore {
		t.Fatalf("paged entry = %+v, want 2 newest comments with has_more", entries)
	}
	if entries[0].Comments[0].Content != "p-3" || entries[0].Comments[1].Content != "p-2" {
		t.Errorf("paged comments = %+v, want [p-3 p-2]", entries[0].Comments)
	}

	if status, _ := postCommentsBatch(t, server, server.BearerToken, []int{itemID}, maxCommentFeedPageSize+1); status != http.StatusBadRequest {
		t.Errorf("page_size above maximum status = %d, want 400", status)
	}
}

// Mirrors of production caps so the black-box tests do not import internals.
const (
	maxCommentBatchItems   = 500
	maxCommentFeedPageSize = 100
)

func TestV2CommentsBatchValidation(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Comments batch valid", shortKey("CBV"))
	itemID := CreateTestItem(t, server, workspaceID, "Validation item")
	createV2BatchComment(t, server, itemID, "only")

	cases := []struct {
		name    string
		itemIDs []int
	}{
		{"empty item_ids", []int{}},
		{"zero id", []int{itemID, 0}},
		{"negative id", []int{-1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if status, _ := postCommentsBatch(t, server, server.BearerToken, tc.itemIDs, 0); status != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", status)
			}
		})
	}

	overLimit := make([]int, maxCommentBatchItems+1)
	for i := range overLimit {
		overLimit[i] = i + 1
	}
	if status, _ := postCommentsBatch(t, server, server.BearerToken, overLimit, 0); status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for more than %d ids", status, maxCommentBatchItems)
	}

	// Duplicates collapse: one entry per distinct item.
	status, entries := postCommentsBatch(t, server, server.BearerToken, []int{itemID, itemID}, 0)
	if status != http.StatusOK {
		t.Fatalf("duplicate batch status = %d, want 200", status)
	}
	if len(entries) != 1 || entries[0].ItemID != itemID {
		t.Errorf("duplicate batch = %+v, want single entry for item %d", entries, itemID)
	}
}

func TestV2CommentsBatchOmitsItemsCallerCannotRead(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Comments batch denied", shortKey("CBD"))
	LockDownWorkspace(t, server, workspaceID)
	forbiddenItem := CreateTestItem(t, server, workspaceID, "Forbidden item")
	createV2BatchComment(t, server, forbiddenItem, "secret")

	// Allowed workspace: same user is an Editor here.
	allowedWorkspaceID, _ := CreateTestWorkspace(t, server, "Comments batch allowed", shortKey("CBA"))
	allowedItem := CreateTestItem(t, server, allowedWorkspaceID, "Allowed item")
	createV2BatchComment(t, server, allowedItem, "visible")

	memberID, username, password := CreateTestUserWithCredentials(t, server, "batch_limited", "batch_limited@test.com")
	AssignWorkspaceRole(t, server, memberID, allowedWorkspaceID, "Editor")
	token := createTokenWithScopesAsUser(t, server, username, password, []string{"items:read"})

	status, entries := postCommentsBatch(t, server, token, []int{forbiddenItem}, 0)
	if status != http.StatusOK {
		t.Fatalf("denied-only batch status = %d, want 200 (omission, not error)", status)
	}
	if len(entries) != 0 {
		t.Errorf("denied-only batch = %+v, want no entries (existence privacy)", entries)
	}

	status, entries = postCommentsBatch(t, server, token, []int{forbiddenItem, allowedItem}, 0)
	if status != http.StatusOK {
		t.Fatalf("mixed batch status = %d, want 200", status)
	}
	if len(entries) != 1 || entries[0].ItemID != allowedItem {
		t.Errorf("mixed batch = %+v, want only allowed item %d", entries, allowedItem)
	}
	if len(entries[0].Comments) != 1 || entries[0].Comments[0].Content != "visible" {
		t.Errorf("allowed entry comments = %+v, want [visible]", entries[0].Comments)
	}
}
