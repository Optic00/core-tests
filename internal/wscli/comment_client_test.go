package wscli

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestClient_GetCommentsFollowsAllPages(t *testing.T) {
	requestedQueries := make([]string, 0, 2)
	client, _ := newTestPageClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/api/v2/items/840/comments" {
			http.NotFound(w, r)
			return
		}
		requestedQueries = append(requestedQueries, r.URL.RawQuery)
		response := DataDocument[struct {
			Comments   []Comment `json:"comments"`
			NextCursor string    `json:"next_cursor"`
			HasMore    bool      `json:"has_more"`
		}]{}
		switch r.URL.Query().Get("cursor") {
		case "":
			response.Data.Comments = []Comment{{ID: 3, CreatedAt: time.Unix(3, 0).UTC()}, {ID: 2, CreatedAt: time.Unix(2, 0).UTC()}}
			response.Data.HasMore = true
			response.Data.NextCursor = "next-page"
		case "next-page":
			response.Data.Comments = []Comment{{ID: 1, CreatedAt: time.Unix(1, 0).UTC()}}
		default:
			t.Fatalf("unexpected cursor %q", r.URL.Query().Get("cursor"))
		}
		_ = json.NewEncoder(w).Encode(response)
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
	if len(requestedQueries) != 2 || requestedQueries[0] != "page_size=100" || requestedQueries[1] != "page_size=100&cursor=next-page" {
		t.Fatalf("requested queries = %v", requestedQueries)
	}
}
