package data

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientGetCommentsFollowsAllPages(t *testing.T) {
	requestedPages := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/api/v2/items/840/comments" {
			http.NotFound(w, r)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		if got := r.URL.Query().Get("page_size"); got != "100" {
			t.Fatalf("page_size = %q, want 100", got)
		}

		page := r.URL.Query().Get("cursor")
		requestedPages = append(requestedPages, page)
		var response any
		switch page {
		case "":
			response = map[string]any{"data": map[string]any{"comments": []map[string]any{{"id": 3, "item_id": 840, "content": "newest"}, {"id": 2, "item_id": 840, "content": "middle"}}, "has_more": true, "next_cursor": "older"}}
		case "older":
			response = map[string]any{"data": map[string]any{"comments": []map[string]any{{"id": 1, "item_id": 840, "content": "oldest"}}, "has_more": false}}
		default:
			t.Fatalf("unexpected page %q", page)
		}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Fatalf("encode response: %v", err)
		}
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL)
	client.SetBearerToken("test-token")
	comments, err := client.getComments(840)
	if err != nil {
		t.Fatalf("getComments: %v", err)
	}
	if len(comments) != 3 ||
		comments[0].ID != 3 ||
		comments[1].ID != 2 ||
		comments[2].ID != 1 {
		t.Fatalf("comments = %+v, want IDs 3, 2, 1", comments)
	}
	if len(requestedPages) != 2 ||
		requestedPages[0] != "" ||
		requestedPages[1] != "older" {
		t.Fatalf("requested cursors = %v, want initial then older", requestedPages)
	}
}
