package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/models"
)

type diagramFixture struct {
	admin, editor, viewer, outsider *TestServer
	workspace, otherWorkspace, item int
	editorID                        int
	bearer                          bool
}

func runDiagramCase(t *testing.T, test func(*testing.T, *diagramFixture)) {
	t.Helper()
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			admin, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, admin)
			f := &diagramFixture{admin: admin, bearer: bearer}
			f.workspace, _ = CreateTestWorkspace(t, admin, "Diagrams", "DGM")
			f.otherWorkspace, _ = CreateTestWorkspace(t, admin, "Other diagrams", "ODGM")
			actor := func(name, role string) (*TestServer, int) {
				id, username, password := CreateTestUserWithCredentials(t, admin, name, name+"@example.test")
				if role != "" {
					AssignWorkspaceRole(t, admin, id, f.workspace, role)
				}
				cookie, token := CreateAuthCredentialsForUser(t, admin, username, password)
				caller := *admin
				caller.SessionCookie, caller.BearerToken = cookie, token
				return &caller, id
			}
			f.editor, f.editorID = actor("diagram-editor", "Editor")
			// An explicit Viewer role prevents the implicit everyone-role fallback.
			f.viewer, _ = actor("diagram-viewer", "Viewer")
			f.outsider, _ = actor("diagram-outsider", "")
			f.item = DecodeV2Document[v2FixtureRecord](t, f.request(t, admin, http.MethodPost, "/items", map[string]any{
				"workspace_id": f.workspace, "title": "Diagram item",
			}), http.StatusCreated).ID
			if f.item <= 0 {
				t.Fatal("diagram fixture requires a positive item ID")
			}
			test(t, f)
		})
	}
}

func (f *diagramFixture) request(t *testing.T, actor *TestServer, method, path string, body any) *http.Response {
	t.Helper()
	if f.bearer {
		return MakeV2BearerRequest(t, actor, method, path, body)
	}
	return MakeV2SessionRequest(t, actor, method, path, body)
}

func (f *diagramFixture) itemPath() string { return fmt.Sprintf("/items/%d/diagrams", f.item) }
func itemDiagramPath(id int) string        { return fmt.Sprintf("/item-diagrams/%d", id) }

const emptyItemDiagram = `{"nodes":[],"edges":[]}`

func pageDiagramCreateBody(hash string) map[string]any {
	return map[string]any{"name": "Flow", "mermaid": "graph TD; A-->B", "placement": "end", "expected_content_hash": hash}
}

func (f *diagramFixture) createItemDiagram(t *testing.T) models.ItemDiagram {
	t.Helper()
	diagram := DecodeV2Document[models.ItemDiagram](t, f.request(t, f.editor, http.MethodPost, f.itemPath(), map[string]any{
		"name": "Test Diagram", "diagram_data": emptyItemDiagram,
	}), http.StatusCreated)
	if diagram.ID <= 0 || diagram.ItemID != f.item || diagram.Name != "Test Diagram" || diagram.DiagramData != emptyItemDiagram || diagram.CreatedBy == nil || *diagram.CreatedBy != f.editorID {
		t.Fatal("created item diagram lost its identity, content or author")
	}
	return diagram
}

func assertDiagramStatus(t *testing.T, response *http.Response, status int) {
	t.Helper()
	// This shared assertion also enforces an empty body for 204 responses.
	assertCommentStatus(t, response, status)
}
