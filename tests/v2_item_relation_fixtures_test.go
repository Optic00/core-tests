package tests

import (
	"fmt"
	"net/http"
	"testing"
)

// Labels and links share workspace-role fixtures, not database shortcuts.
type itemRelationFixture struct {
	admin, editor, viewer, outsider *TestServer
	workspace, foreign, item        int
	editorID                        int
	bearer                          bool
}

func runItemRelationCase(t *testing.T, test func(*testing.T, *itemRelationFixture)) {
	t.Helper()
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			admin, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, admin)
			f := &itemRelationFixture{admin: admin, bearer: bearer}
			f.workspace, _ = CreateTestWorkspace(t, admin, "Item relations", "REL")
			LockDownWorkspace(t, admin, f.workspace)
			f.foreign, _ = CreateTestWorkspace(t, admin, "Foreign relations", "FREL")
			// Without explicit membership, the everyone-role fallback would make
			// this supposed hidden target visible and invalidate denial tests.
			LockDownWorkspace(t, admin, f.foreign)
			actor := func(name, role string) *TestServer {
				id, username, password := CreateTestUserWithCredentials(t, admin, name, name+"@example.test")
				if role == "Editor" {
					f.editorID = id
				}
				if role != "" {
					AssignWorkspaceRole(t, admin, id, f.workspace, role)
				}
				cookie, token := CreateAuthCredentialsForUser(t, admin, username, password)
				caller := *admin
				caller.SessionCookie, caller.BearerToken = cookie, token
				return &caller
			}
			f.editor, f.viewer, f.outsider = actor("relation-editor", "Editor"), actor("relation-viewer", "Viewer"), actor("relation-outsider", "")
			f.item = f.createItem(t, f.workspace, "Relation source")
			test(t, f)
		})
	}
}

func (f *itemRelationFixture) request(t *testing.T, actor *TestServer, method, path string, body any) *http.Response {
	t.Helper()
	var response *http.Response
	if f.bearer {
		response = MakeV2BearerRequest(t, actor, method, path, body)
	} else {
		response = MakeV2SessionRequest(t, actor, method, path, body)
	}
	// Preserve legacy JSON Content-Type assertions as well as v2 envelopes.
	if response.StatusCode != http.StatusNoContent {
		assertCommentJSON(t, response)
	}
	return response
}

func (f *itemRelationFixture) createItem(t *testing.T, workspace int, title string) int {
	t.Helper()
	item := DecodeV2Document[v2FixtureRecord](t, f.request(t, f.admin, http.MethodPost, "/items", map[string]any{"workspace_id": workspace, "title": title}), http.StatusCreated)
	if item.ID <= 0 {
		t.Fatal("relation fixture needs a positive item ID")
	}
	return item.ID
}
