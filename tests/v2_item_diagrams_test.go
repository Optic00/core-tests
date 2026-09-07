package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/models"
)

// These real-HTTP cases replace the 13 removed cookie DiagramHandler tests.
// V1 REST routes are separate and their existing coverage is not removed.
func TestV2ItemDiagrams_CRUDAndWorkspacePermissions(t *testing.T) {
	runDiagramCase(t, func(t *testing.T, f *diagramFixture) {
		created := f.createItemDiagram(t) // Editor create permission, not admin bypass.
		path := itemDiagramPath(created.ID)
		for _, actor := range []*TestServer{f.editor, f.viewer} {
			listed := DecodeV2Document[[]models.ItemDiagram](t, f.request(t, actor, http.MethodGet, f.itemPath(), nil), http.StatusOK)
			if len(listed) != 1 || listed[0].ID != created.ID || listed[0].ItemID != f.item {
				t.Fatal("authorized list did not return exactly the created diagram")
			}
			got := DecodeV2Document[models.ItemDiagram](t, f.request(t, actor, http.MethodGet, path, nil), http.StatusOK)
			if got.ID != created.ID || got.Name != created.Name || got.DiagramData != emptyItemDiagram {
				t.Fatal("authorized GET did not return the stored diagram")
			}
		}
		for _, actor := range []*TestServer{f.viewer, f.outsider} {
			assertDiagramStatus(t, f.request(t, actor, http.MethodPost, f.itemPath(), map[string]any{"name": "Denied", "diagram_data": emptyItemDiagram}), http.StatusNotFound)
			assertDiagramStatus(t, f.request(t, actor, http.MethodPatch, path, map[string]any{"name": "Denied"}), http.StatusNotFound)
			assertDiagramStatus(t, f.request(t, actor, http.MethodDelete, path, nil), http.StatusNotFound)
		}
		assertDiagramStatus(t, f.request(t, f.outsider, http.MethodGet, f.itemPath(), nil), http.StatusNotFound)
		assertDiagramStatus(t, f.request(t, f.outsider, http.MethodGet, path, nil), http.StatusNotFound)
		retained := DecodeV2Document[[]models.ItemDiagram](t, f.request(t, f.editor, http.MethodGet, f.itemPath(), nil), http.StatusOK)
		if len(retained) != 1 || retained[0].ID != created.ID || retained[0].Name != created.Name || retained[0].DiagramData != emptyItemDiagram {
			t.Fatal("denied writes changed the stored diagram collection")
		}
		updated := DecodeV2Document[models.ItemDiagram](t, f.request(t, f.editor, http.MethodPatch, path, map[string]any{"name": "Renamed"}), http.StatusOK)
		if updated.ID != created.ID || updated.Name != "Renamed" || updated.DiagramData != emptyItemDiagram || updated.UpdatedBy == nil || *updated.UpdatedBy != f.editorID {
			t.Fatal("name-only PATCH lost data or update attribution")
		}
		// Read through the other mount to prove the PATCH was persisted.
		other := *f
		other.bearer = !f.bearer
		stored := DecodeV2Document[models.ItemDiagram](t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.ID != updated.ID || stored.Name != updated.Name || stored.DiagramData != emptyItemDiagram {
			t.Fatal("PATCH did not persist across mounts")
		}
		assertDiagramStatus(t, f.request(t, f.editor, http.MethodDelete, path, nil), http.StatusNoContent)
		assertDiagramStatus(t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusNotFound)
		if diagrams := DecodeV2Document[[]models.ItemDiagram](t, f.request(t, f.editor, http.MethodGet, f.itemPath(), nil), http.StatusOK); len(diagrams) != 0 {
			t.Fatal("deleted diagram remains in the item collection")
		}
	})
}

func TestV2ItemDiagrams_Unauthenticated(t *testing.T) {
	runDiagramCase(t, func(t *testing.T, f *diagramFixture) {
		diagram := f.createItemDiagram(t)
		anonymous := *f.admin
		anonymous.SessionCookie, anonymous.BearerToken = "", ""
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodPost, f.itemPath(), map[string]any{"name": "Unauthorized", "diagram_data": emptyItemDiagram}},
			{http.MethodGet, f.itemPath(), nil},
			{http.MethodGet, itemDiagramPath(diagram.ID), nil},
			{http.MethodPatch, itemDiagramPath(diagram.ID), map[string]any{"name": "Unauthorized"}},
			{http.MethodDelete, itemDiagramPath(diagram.ID), nil},
		} {
			t.Run(tc.method+tc.path, func(t *testing.T) {
				assertDiagramStatus(t, f.request(t, &anonymous, tc.method, tc.path, tc.body), http.StatusUnauthorized)
			})
		}
		retained := DecodeV2Document[[]models.ItemDiagram](t, f.request(t, f.editor, http.MethodGet, f.itemPath(), nil), http.StatusOK)
		if len(retained) != 1 || retained[0].ID != diagram.ID || retained[0].Name != diagram.Name {
			t.Fatal("anonymous writes changed persisted diagrams")
		}
	})
}

func TestV2ItemDiagrams_NotFound(t *testing.T) {
	runDiagramCase(t, func(t *testing.T, f *diagramFixture) {
		assertDiagramStatus(t, f.request(t, f.admin, http.MethodPost, "/items/999999/diagrams", map[string]any{"name": "Missing item", "diagram_data": emptyItemDiagram}), http.StatusNotFound)
		for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
			t.Run(method, func(t *testing.T) {
				var body any
				if method == http.MethodPatch {
					body = map[string]any{"name": "Missing diagram"}
				}
				assertDiagramStatus(t, f.request(t, f.admin, method, itemDiagramPath(999999), body), http.StatusNotFound)
			})
		}
	})
}

func TestV2ItemDiagrams_MergePatchValidation(t *testing.T) {
	runDiagramCase(t, func(t *testing.T, f *diagramFixture) {
		diagram := f.createItemDiagram(t)
		path := itemDiagramPath(diagram.ID)
		for i, tc := range []struct {
			body    map[string]any
			message string
		}{
			{map[string]any{"name": nil}, "Diagram fields cannot be null"},
			{map[string]any{"diagram_data": nil}, "Diagram fields cannot be null"},
			{map[string]any{"name": ""}, "diagram name is required"},
			{map[string]any{"diagram_data": ""}, "diagram data is required"},
		} {
			t.Run(fmt.Sprint(i), func(t *testing.T) {
				assertCommentStatus(t, f.request(t, f.editor, http.MethodPatch, path, tc.body), http.StatusBadRequest, tc.message)
			})
		}
		stored := DecodeV2Document[models.ItemDiagram](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != diagram.Name || stored.DiagramData != diagram.DiagramData {
			t.Fatal("invalid PATCH changed diagram content")
		}
		const data = `{"nodes":[{"id":"one"}],"edges":[]}`
		updated := DecodeV2Document[models.ItemDiagram](t, f.request(t, f.editor, http.MethodPatch, path, map[string]any{"diagram_data": data}), http.StatusOK)
		if updated.Name != diagram.Name || updated.DiagramData != data {
			t.Fatal("data-only PATCH lost the name or ignored the data")
		}
		stored = DecodeV2Document[models.ItemDiagram](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != diagram.Name || stored.DiagramData != data {
			t.Fatal("data-only PATCH was not persisted")
		}
		// Preserve the old update scenario changing both fields in one request.
		updated = DecodeV2Document[models.ItemDiagram](t, f.request(t, f.editor, http.MethodPatch, path, map[string]any{"name": "Both changed", "diagram_data": emptyItemDiagram}), http.StatusOK)
		if updated.ID != diagram.ID || updated.Name != "Both changed" || updated.DiagramData != emptyItemDiagram {
			t.Fatal("combined PATCH did not replace both fields")
		}
		stored = DecodeV2Document[models.ItemDiagram](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != updated.Name || stored.DiagramData != emptyItemDiagram {
			t.Fatal("combined PATCH was not persisted")
		}
	})
}
