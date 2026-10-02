package data

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientGetCommentsFollowsAllPages(t *testing.T) {
	requestedCursors := make([]string, 0, 2)
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

		cursor := r.URL.Query().Get("cursor")
		requestedCursors = append(requestedCursors, cursor)
		response := struct {
			Data struct {
				Comments   []commentDTO `json:"comments"`
				NextCursor string       `json:"next_cursor"`
				HasMore    bool         `json:"has_more"`
			} `json:"data"`
		}{}
		switch cursor {
		case "":
			response.Data.HasMore = true
			response.Data.NextCursor = "next-page"
			response.Data.Comments = []commentDTO{
				{ID: 3, ItemID: 840, Content: "newest", CreatedAt: time.Unix(3, 0).UTC()},
				{ID: 2, ItemID: 840, Content: "middle", CreatedAt: time.Unix(2, 0).UTC()},
			}
		case "next-page":
			response.Data.Comments = []commentDTO{
				{ID: 1, ItemID: 840, Content: "oldest", CreatedAt: time.Unix(1, 0).UTC()},
			}
		default:
			t.Fatalf("unexpected cursor %q", cursor)
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
	if len(requestedCursors) != 2 || requestedCursors[0] != "" || requestedCursors[1] != "next-page" {
		t.Fatalf("requested cursors = %v, want initial and opaque cursor", requestedCursors)
	}
}
