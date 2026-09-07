package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"windshift/internal/models"
	"windshift/internal/services"
)

func (f *diagramFixture) createPage(t *testing.T) models.Page {
	t.Helper()
	page := DecodeV2Document[models.Page](t, f.request(t, f.editor, http.MethodPost, fmt.Sprintf("/workspaces/%d/pages", f.workspace), map[string]any{
		"title": "Architecture", "content": "# Architecture",
	}), http.StatusCreated)
	if page.ID <= 0 || page.WorkspaceID != f.workspace || page.Content != "# Architecture" || page.ContentHash == "" {
		t.Fatal("page fixture lost identity, content or hash")
	}
	return page
}

func (f *diagramFixture) pagePath(pageID int) string {
	return fmt.Sprintf("/workspaces/%d/pages/%d", f.workspace, pageID)
}

// Preserves both old PageHandler diagram scenarios through the real v2 mounts.
func TestV2PageDiagrams_CreateListGetAndUpdate(t *testing.T) {
	runDiagramCase(t, func(t *testing.T, f *diagramFixture) {
		page := f.createPage(t)
		collection := f.pagePath(page.ID) + "/diagrams"
		created := DecodeV2Document[services.PageDiagram](t, f.request(t, f.editor, http.MethodPost, collection, pageDiagramCreateBody(page.ContentHash)), http.StatusCreated)
		if created.AttachmentID <= 0 || created.PageID != page.ID || created.Name != "Flow" || created.Kind != services.DiagramKindMermaid || created.ContentHash == "" || created.ContentHash == page.ContentHash {
			t.Fatal("created page diagram lost identity, kind or changed content hash")
		}
		listed := DecodeV2Document[[]services.PageDiagram](t, f.request(t, f.viewer, http.MethodGet, collection, nil), http.StatusOK)
		if len(listed) != 1 || listed[0].AttachmentID != created.AttachmentID {
			t.Fatal("list did not return exactly the created diagram")
		}
		path := collection + "/" + strconv.Itoa(created.AttachmentID)
		fetched := DecodeV2Document[services.PageDiagram](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		var seed map[string]string
		if err := json.Unmarshal(fetched.Payload, &seed); err != nil || seed["source"] != "graph TD; A-->B" {
			t.Fatal("stored Mermaid payload did not preserve its source")
		}
		scene := map[string]any{
			"elements": []map[string]any{{"id": "one", "type": "rectangle"}},
			"appState": map[string]any{}, "files": map[string]any{},
		}
		body := map[string]any{"name": "Renamed flow", "excalidraw": scene, "expected_content_hash": created.ContentHash}
		updated := DecodeV2Document[services.PageDiagram](t, f.request(t, f.editor, http.MethodPatch, path, body), http.StatusOK)
		if updated.AttachmentID <= 0 || updated.AttachmentID == created.AttachmentID || updated.PageID != page.ID || updated.Name != "Renamed flow" || updated.Kind != services.DiagramKindExcalidraw || updated.ContentHash == "" || updated.ContentHash == created.ContentHash {
			t.Fatal("updated diagram did not replace the immutable attachment and page hash")
		}
		other := *f
		other.bearer = !f.bearer
		current := DecodeV2Document[models.Page](t, other.request(t, f.viewer, http.MethodGet, f.pagePath(page.ID), nil), http.StatusOK)
		if current.ContentHash != updated.ContentHash || strings.Contains(current.Content, `"attachmentId":`+strconv.Itoa(created.AttachmentID)) ||
			!strings.Contains(current.Content, `"attachmentId":`+strconv.Itoa(updated.AttachmentID)) || !strings.Contains(current.Content, `"name":"Renamed flow"`) {
			t.Fatal("stored page did not replace the diagram reference and name")
		}
		stored := DecodeV2Document[services.PageDiagram](t, other.request(t, f.viewer, http.MethodGet, collection+"/"+strconv.Itoa(updated.AttachmentID), nil), http.StatusOK)
		var payload struct {
			Elements []struct{ ID, Type string } `json:"elements"`
		}
		if err := json.Unmarshal(stored.Payload, &payload); err != nil || len(payload.Elements) != 1 || payload.Elements[0].ID != "one" || payload.Elements[0].Type != "rectangle" {
			t.Fatal("updated Excalidraw scene did not persist across mounts")
		}
		listed = DecodeV2Document[[]services.PageDiagram](t, f.request(t, f.viewer, http.MethodGet, collection, nil), http.StatusOK)
		if len(listed) != 1 || listed[0].AttachmentID != updated.AttachmentID {
			t.Fatal("diagram collection did not follow the updated page reference")
		}
	})
}

func TestV2PageDiagrams_MutationMasksCrossWorkspaceAndViewerDenials(t *testing.T) {
	runDiagramCase(t, func(t *testing.T, f *diagramFixture) {
		page := f.createPage(t)
		collection := f.pagePath(page.ID) + "/diagrams"
		cross := fmt.Sprintf("/workspaces/%d/pages/%d/diagrams", f.otherWorkspace, page.ID)
		body := pageDiagramCreateBody(page.ContentHash)
		assertDiagramStatus(t, f.request(t, f.admin, http.MethodPost, cross, body), http.StatusNotFound)
		for _, actor := range []*TestServer{f.viewer, f.outsider} {
			assertDiagramStatus(t, f.request(t, actor, http.MethodPost, collection, body), http.StatusNotFound)
		}
		if diagrams := DecodeV2Document[[]services.PageDiagram](t, f.request(t, f.viewer, http.MethodGet, collection, nil), http.StatusOK); len(diagrams) != 0 {
			t.Fatal("denied diagram create persisted an attachment reference")
		}
		created := DecodeV2Document[services.PageDiagram](t, f.request(t, f.editor, http.MethodPost, collection, body), http.StatusCreated)
		if created.AttachmentID <= 0 || created.ContentHash == "" {
			t.Fatal("authorized diagram create did not produce an attachment and hash")
		}
		path := collection + "/" + strconv.Itoa(created.AttachmentID)
		update := map[string]any{"name": "Denied", "mermaid": "graph TD; B-->C", "expected_content_hash": created.ContentHash}
		assertDiagramStatus(t, f.request(t, f.admin, http.MethodPatch, cross+"/"+strconv.Itoa(created.AttachmentID), update), http.StatusNotFound)
		for _, actor := range []*TestServer{f.viewer, f.outsider} {
			assertDiagramStatus(t, f.request(t, actor, http.MethodPatch, path, update), http.StatusNotFound)
		}
		assertDiagramStatus(t, f.request(t, f.outsider, http.MethodGet, collection, nil), http.StatusNotFound)
		assertDiagramStatus(t, f.request(t, f.outsider, http.MethodGet, path, nil), http.StatusNotFound)
		// An old hash also rejects an otherwise authorized writer.
		update["expected_content_hash"] = page.ContentHash
		assertDiagramStatus(t, f.request(t, f.editor, http.MethodPatch, path, update), http.StatusConflict)
		current := DecodeV2Document[models.Page](t, f.request(t, f.viewer, http.MethodGet, f.pagePath(page.ID), nil), http.StatusOK)
		if current.ContentHash != created.ContentHash || !strings.Contains(current.Content, `"name":"Flow"`) || strings.Contains(current.Content, "Denied") {
			t.Fatal("denied or conflicting PATCH changed the stored page")
		}
		stored := DecodeV2Document[services.PageDiagram](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		var seed map[string]string
		if err := json.Unmarshal(stored.Payload, &seed); err != nil || seed["source"] != "graph TD; A-->B" || stored.Name != "Flow" {
			t.Fatal("denied or conflicting PATCH changed the stored diagram")
		}
	})
}
