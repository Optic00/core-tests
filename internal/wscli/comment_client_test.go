package wscli

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestClient_GetCommentsFollowsAllPages(t *testing.T) {
	requestedPages := make([]string, 0, 2)
	client, _ := newTestPageClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/api/v2/items/840/comments" {
			http.NotFound(w, r)
			return
		}
		requestedPages = append(requestedPages, r.URL.RawQuery)
		cursor := r.URL.Query().Get("cursor")
		var response map[string]any
		switch cursor {
		case "":
			response = map[string]any{"comments": []Comment{{ID: 3}, {ID: 2}}, "has_more": true, "next_cursor": "older"}
		case "older":
			response = map[string]any{"comments": []Comment{{ID: 1}}, "has_more": false}
		default:
			t.Errorf("unexpected cursor %q", cursor)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": response})
	})

	comments, err := client.GetComments(840)
	if err != nil {
		t.Fatalf("GetComments: %v", err)
	}
	if len(comments) != 3 ||
		comments[0].ID != 3 ||
		comments[1].ID != 2 ||
		comments[2].ID != 1 {
		t.Fatalf("comments = %+v, want IDs 3, 2, 1", comments)
	}
	if len(requestedPages) != 2 ||
		requestedPages[0] != "page_size=100" ||
		requestedPages[1] != "page_size=100&cursor=older" {
		t.Fatalf("requested pages = %v", requestedPages)
	}
}
