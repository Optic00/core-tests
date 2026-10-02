package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"windshift/internal/models"
)

type commentFixture struct {
	admin, author             *TestServer
	workspace, item, authorID int
	bearer                    bool
}

type v2CommentFeed struct {
	Comments      []models.Comment `json:"comments"`
	NextCursor    string           `json:"next_cursor"`
	RefreshCursor string           `json:"refresh_cursor"`
	HasMore       bool             `json:"has_more"`
	Total         *int             `json:"total"`
}

func runCommentCase(t *testing.T, test func(*testing.T, *commentFixture)) {
	t.Helper()
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			admin, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, admin)
			f := &commentFixture{admin: admin, bearer: bearer}
			f.workspace = DecodeV2Document[v2FixtureRecord](t, f.request(t, admin, http.MethodPost, "/workspaces", map[string]any{"name": "Comments", "key": "CMT"}), http.StatusCreated).ID
			f.item = DecodeV2Document[v2FixtureRecord](t, f.request(t, admin, http.MethodPost, "/items", map[string]any{"workspace_id": f.workspace, "title": "Comment item"}), http.StatusCreated).ID
			f.author, f.authorID = f.actor(t, "comment-author", "Editor")
			test(t, f)
		})
	}
}

func (f *commentFixture) actor(t *testing.T, name, role string) (*TestServer, int) {
	t.Helper()
	id, username, password := CreateTestUserWithCredentials(t, f.admin, name, name+"@example.test")
	AssignWorkspaceRole(t, f.admin, id, f.workspace, role)
	cookie, token := CreateAuthCredentialsForUser(t, f.admin, username, password)
	actor := *f.admin
	actor.SessionCookie, actor.BearerToken = cookie, token
	return &actor, id
}

func (f *commentFixture) request(t *testing.T, actor *TestServer, method, path string, body any) *http.Response {
	t.Helper()
	if f.bearer {
		return MakeV2BearerRequest(t, actor, method, path, body)
	}
	return MakeV2SessionRequest(t, actor, method, path, body)
}

func (f *commentFixture) path() string { return fmt.Sprintf("/items/%d/comments", f.item) }
func commentPath(id int) string        { return fmt.Sprintf("/comments/%d", id) }

func (f *commentFixture) create(t *testing.T, content string) models.Comment {
	t.Helper()
	response := f.request(t, f.author, http.MethodPost, f.path(), map[string]any{"content": content})
	assertCommentJSON(t, response)
	return DecodeV2Document[models.Comment](t, response, http.StatusCreated)
}

func (f *commentFixture) feed(t *testing.T, query string) v2CommentFeed {
	t.Helper()
	response := f.request(t, f.admin, http.MethodGet, f.path()+query, nil)
	assertCommentJSON(t, response)
	return DecodeV2Document[v2CommentFeed](t, response, http.StatusOK)
}

func assertCommentJSON(t *testing.T, response *http.Response) {
	t.Helper()
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		response.Body.Close()
		t.Fatalf("Content-Type=%q, want application/json", response.Header.Get("Content-Type"))
	}
}

func assertCommentStatus(t *testing.T, response *http.Response, status int, message ...string) {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status {
		t.Fatalf("status=%d, want %d: %s", response.StatusCode, status, body)
	}
	if status == http.StatusNoContent && len(body) != 0 {
		t.Fatalf("204 response has body: %s", body)
	}
	if len(message) != 0 {
		var envelope struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil || envelope.Error.Code != "invalid_request" || envelope.Error.Message != message[0] {
			t.Fatalf("validation error=%s, want invalid_request: %s", body, message[0])
		}
	}
}

func TestV2Comments_CreateComment_Success(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		c := f.create(t, "A comment")
		if c.ID <= 0 || c.ItemID != f.item || c.Content != "A comment" || c.AuthorID == nil || *c.AuthorID != f.authorID {
			t.Fatalf("comment=%+v", c)
		}
	})
}

func TestV2Comments_CreateComment_RejectsOversizedBody(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		for _, tc := range []struct{ size, status int }{{320 * 1024, 400}, {3 * 1024 * 1024, 413}} {
			assertCommentStatus(t, f.request(t, f.author, http.MethodPost, f.path(), map[string]any{"content": strings.Repeat("x", tc.size)}), tc.status)
		}
		if feed := f.feed(t, ""); len(feed.Comments) != 0 {
			t.Fatalf("oversized comment persisted: %+v", feed)
		}
	})
}

func TestV2Comments_CreateComment_ValidationErrors(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		for _, body := range []map[string]any{{}, {"content": ""}, {"content": "  \n\t"}} {
			assertCommentStatus(t, f.request(t, f.author, http.MethodPost, f.path(), body), http.StatusBadRequest, "content is required")
		}
		assertCommentStatus(t, f.request(t, f.author, http.MethodPost, f.path(), map[string]any{"content": "forged", "author_id": f.authorID}), http.StatusBadRequest)
		if feed := f.feed(t, ""); len(feed.Comments) != 0 {
			t.Fatalf("invalid comment persisted: %+v", feed)
		}
	})
}

func TestV2Comments_CreateComment_InvalidItemID(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		assertCommentStatus(t, f.request(t, f.author, http.MethodPost, "/items/abc/comments", map[string]any{"content": "test"}), http.StatusBadRequest)
	})
}

func TestV2Comments_CreateComment_NonExistentItem(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, "/items/999999/comments", map[string]any{"content": "test"}), http.StatusNotFound)
	})
}

func TestV2Comments_GetComments_Success(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		want := map[int]string{}
		for i := 0; i < 3; i++ {
			c := f.create(t, fmt.Sprintf("Comment %d", i))
			want[c.ID] = c.Content
		}
		feed := f.feed(t, "")
		if len(feed.Comments) != 3 || feed.HasMore || feed.Total == nil || *feed.Total != 3 {
			t.Fatalf("feed=%+v", feed)
		}
		for _, c := range feed.Comments {
			if content, ok := want[c.ID]; !ok || content != c.Content || c.AuthorName == "" {
				t.Fatalf("comment=%+v", c)
			}
			delete(want, c.ID)
		}
	})
}

func TestV2Comments_GetComments_DefaultPageIsBounded(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		want := map[int]bool{}
		for i := 0; i < 26; i++ {
			want[f.create(t, fmt.Sprintf("Comment %d", i)).ID] = true
		}
		first := f.feed(t, "")
		if len(first.Comments) != 25 || !first.HasMore || first.Total == nil || *first.Total != 26 || first.NextCursor == "" || first.RefreshCursor == "" {
			t.Fatalf("first=%+v", first)
		}
		last := f.feed(t, "?cursor="+url.QueryEscape(first.NextCursor))
		if len(last.Comments) != 1 || last.HasMore || last.NextCursor != "" || last.Total != nil {
			t.Fatalf("last=%+v", last)
		}
		for _, page := range []v2CommentFeed{first, last} {
			for _, c := range page.Comments {
				if !want[c.ID] {
					t.Fatalf("duplicate or unknown comment %d", c.ID)
				}
				delete(want, c.ID)
			}
		}
		if len(want) != 0 {
			t.Fatalf("missing comments: %v", want)
		}
		newest := f.create(t, "New comment")
		refresh := f.feed(t, "?cursor="+url.QueryEscape(first.RefreshCursor))
		if len(refresh.Comments) != 1 || refresh.Comments[0].ID != newest.ID || refresh.HasMore || refresh.Total != nil {
			t.Fatalf("refresh=%+v", refresh)
		}
	})
}

func TestV2Comments_GetComments_RejectsInvalidPagination(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		for _, query := range []string{"page_size=0", "page_size=101", "page_size=abc", "before=2025-01-01", "before_id=1", "since=invalid&since_id=1", "before_id=1&since_id=2", "cursor=invalid"} {
			t.Run(query, func(t *testing.T) {
				assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, f.path()+"?"+query, nil), http.StatusBadRequest)
			})
		}
	})
}

func TestV2Comments_GetComments_EmptyList(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		feed := f.feed(t, "")
		if feed.Comments == nil || len(feed.Comments) != 0 || feed.HasMore || feed.Total == nil || *feed.Total != 0 || feed.NextCursor != "" {
			t.Fatalf("feed=%+v", feed)
		}
	})
}

func TestV2Comments_GetComments_NonExistentItem(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, "/items/999999/comments", nil), http.StatusNotFound)
	})
}

func TestV2Comments_UpdateComment_Success(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		c := f.create(t, "original")
		response := f.request(t, f.author, http.MethodPatch, commentPath(c.ID), map[string]any{"content": "updated"})
		assertCommentJSON(t, response)
		updated := DecodeV2Document[models.Comment](t, response, http.StatusOK)
		stored := DecodeV2Document[models.Comment](t, f.request(t, f.author, http.MethodGet, commentPath(c.ID), nil), http.StatusOK)
		if updated.ID != c.ID || updated.Content != "updated" || stored.Content != "updated" {
			t.Fatalf("updated=%+v stored=%+v", updated, stored)
		}
	})
}

func TestV2Comments_UpdateComment_EmptyContent(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		c := f.create(t, "original")
		for _, body := range []map[string]any{{}, {"content": nil}, {"content": ""}, {"content": " \n\t"}} {
			assertCommentStatus(t, f.request(t, f.author, http.MethodPatch, commentPath(c.ID), body), http.StatusBadRequest, "content is required")
		}
		stored := DecodeV2Document[models.Comment](t, f.request(t, f.author, http.MethodGet, commentPath(c.ID), nil), http.StatusOK)
		if stored.Content != c.Content {
			t.Fatalf("invalid update persisted: %+v", stored)
		}
	})
}

func TestV2Comments_UpdateComment_NotFound(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPatch, "/comments/999999", map[string]any{"content": "updated"}), http.StatusNotFound)
	})
}

func TestV2Comments_UpdateComment_NotAuthor(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) { f.deniedMutation(t, http.MethodPatch) })
}

func (f *commentFixture) deniedMutation(t *testing.T, method string) {
	t.Helper()
	c := f.create(t, "original")
	other, _ := f.actor(t, "comment-other", "Editor")
	visible := DecodeV2Document[models.Comment](t, f.request(t, other, http.MethodGet, commentPath(c.ID), nil), http.StatusOK)
	if visible.ID != c.ID {
		t.Fatalf("visible=%+v", visible)
	}
	var body any
	if method == http.MethodPatch {
		body = map[string]any{"content": "forged"}
	}
	assertCommentStatus(t, f.request(t, other, method, commentPath(c.ID), body), http.StatusNotFound)
	stored := DecodeV2Document[models.Comment](t, f.request(t, f.author, http.MethodGet, commentPath(c.ID), nil), http.StatusOK)
	if stored.ID != c.ID || stored.Content != c.Content {
		t.Fatalf("denied mutation persisted: %+v", stored)
	}
}

func TestV2Comments_DeleteComment_Success(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		c := f.create(t, "original")
		assertCommentStatus(t, f.request(t, f.author, http.MethodDelete, commentPath(c.ID), nil), http.StatusNoContent)
		assertCommentStatus(t, f.request(t, f.author, http.MethodGet, commentPath(c.ID), nil), http.StatusNotFound)
		feed := f.feed(t, "")
		if len(feed.Comments) != 0 || feed.Total == nil || *feed.Total != 0 {
			t.Fatalf("delete did not persist: %+v", feed)
		}
	})
}

func TestV2Comments_DeleteComment_NotFound(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, "/comments/999999", nil), http.StatusNotFound)
	})
}

func TestV2Comments_DeleteComment_NotAuthor(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) { f.deniedMutation(t, http.MethodDelete) })
}

func TestV2Comments_InvalidID_Scenarios(t *testing.T) {
	runCommentCase(t, func(t *testing.T, f *commentFixture) {
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, "/items/abc/comments", nil},
			{http.MethodPost, "/items/abc/comments", map[string]any{"content": "test"}},
			{http.MethodGet, "/comments/abc", nil},
			{http.MethodPatch, "/comments/abc", map[string]any{"content": "updated"}},
			{http.MethodDelete, "/comments/abc", nil},
		} {
			t.Run(tc.method+tc.path, func(t *testing.T) {
				assertCommentStatus(t, f.request(t, f.admin, tc.method, tc.path, tc.body), http.StatusBadRequest)
			})
		}
	})
}
