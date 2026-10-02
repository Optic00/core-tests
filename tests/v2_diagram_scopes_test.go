package tests

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"windshift/internal/models"
	"windshift/internal/services"
)

func TestV2Diagrams_GranularBearerScopes(t *testing.T) {
	admin, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, admin)
	workspace, _ := CreateTestWorkspace(t, admin, "Diagram scopes", "DSCP")
	item := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, admin, http.MethodPost, "/items", map[string]any{"workspace_id": workspace, "title": "Scoped diagrams"}), http.StatusCreated)
	itemCollection := fmt.Sprintf("/items/%d/diagrams", item.ID)
	itemBody := map[string]any{"name": "Scoped diagram", "diagram_data": emptyItemDiagram}
	diagram := DecodeV2Document[models.ItemDiagram](t, MakeV2SessionRequest(t, admin, http.MethodPost, itemCollection, itemBody), http.StatusCreated)
	page := DecodeV2Document[models.Page](t, MakeV2SessionRequest(t, admin, http.MethodPost, fmt.Sprintf("/workspaces/%d/pages", workspace), map[string]any{"title": "Diagram scopes"}), http.StatusCreated)
	pageCollection := fmt.Sprintf("/workspaces/%d/pages/%d/diagrams", workspace, page.ID)
	pageDiagram := DecodeV2Document[services.PageDiagram](t, MakeV2SessionRequest(t, admin, http.MethodPost, pageCollection, pageDiagramCreateBody(page.ContentHash)), http.StatusCreated)
	if item.ID <= 0 || diagram.ID <= 0 || page.ID <= 0 || pageDiagram.AttachmentID <= 0 {
		t.Fatal("scope fixtures require positive resource IDs")
	}
	pageDetail := pageCollection + "/" + strconv.Itoa(pageDiagram.AttachmentID)
	caller := func(scope string) *TestServer {
		t.Helper()
		actor := *admin
		actor.SessionCookie = ""
		actor.BearerToken = createTokenWithScopesAsUser(t, admin, "admin", "testpass123", []string{scope})
		return &actor
	}
	t.Run("missing_scope", func(t *testing.T) {
		actor := caller("users:read")
		for _, path := range []string{itemCollection, itemDiagramPath(diagram.ID), pageCollection, pageDetail} {
			assertDiagramStatus(t, MakeV2BearerRequest(t, actor, http.MethodGet, path, nil), http.StatusForbidden)
		}
	})
	t.Run("read_only", func(t *testing.T) {
		for _, tc := range []struct {
			scope, collection, detail, idKey string
			id                               int
			create, patch                    any
		}{
			{"items:read", itemCollection, itemDiagramPath(diagram.ID), "id", diagram.ID, itemBody, map[string]any{"name": "Denied"}},
			{"pages:read", pageCollection, pageDetail, "attachment_id", pageDiagram.AttachmentID, pageDiagramCreateBody(pageDiagram.ContentHash), map[string]any{"name": "Denied", "mermaid": "graph TD; B-->C"}},
		} {
			t.Run(tc.scope, func(t *testing.T) {
				actor := caller(tc.scope)
				listed := DecodeV2Document[[]map[string]any](t, MakeV2BearerRequest(t, actor, http.MethodGet, tc.collection, nil), http.StatusOK)
				got := DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, actor, http.MethodGet, tc.detail, nil), http.StatusOK)
				if len(listed) != 1 || listed[0][tc.idKey] != float64(tc.id) || got[tc.idKey] != float64(tc.id) {
					t.Fatal("read scope did not return the expected diagram")
				}
				assertDiagramStatus(t, MakeV2BearerRequest(t, actor, http.MethodPost, tc.collection, tc.create), http.StatusForbidden)
				assertDiagramStatus(t, MakeV2BearerRequest(t, actor, http.MethodPatch, tc.detail, tc.patch), http.StatusForbidden)
			})
		}
		assertDiagramStatus(t, MakeV2BearerRequest(t, caller("items:read"), http.MethodDelete, itemDiagramPath(diagram.ID), nil), http.StatusForbidden)
		items := DecodeV2Document[[]models.ItemDiagram](t, MakeV2SessionRequest(t, admin, http.MethodGet, itemCollection, nil), http.StatusOK)
		pages := DecodeV2Document[[]services.PageDiagram](t, MakeV2SessionRequest(t, admin, http.MethodGet, pageCollection, nil), http.StatusOK)
		if len(items) != 1 || items[0].ID != diagram.ID || items[0].Name != diagram.Name || len(pages) != 1 || pages[0].AttachmentID != pageDiagram.AttachmentID || pages[0].Name != pageDiagram.Name {
			t.Fatal("scope-denied writes changed stored diagrams")
		}
	})
	t.Run("write_implies_read", func(t *testing.T) {
		actor := caller("items:write")
		created := DecodeV2Document[models.ItemDiagram](t, MakeV2BearerRequest(t, actor, http.MethodPost, itemCollection, itemBody), http.StatusCreated)
		path := itemDiagramPath(created.ID)
		updated := DecodeV2Document[models.ItemDiagram](t, MakeV2BearerRequest(t, actor, http.MethodPatch, path, map[string]any{"name": "Written"}), http.StatusOK)
		stored := DecodeV2Document[models.ItemDiagram](t, MakeV2BearerRequest(t, actor, http.MethodGet, path, nil), http.StatusOK)
		if created.ID <= 0 || updated.Name != "Written" || stored.ID != created.ID || stored.Name != updated.Name {
			t.Fatal("items:write did not grant persisted CRUD")
		}
		// Item diagram deletion deliberately requires items:write, not items:delete.
		assertDiagramStatus(t, MakeV2BearerRequest(t, actor, http.MethodDelete, path, nil), http.StatusNoContent)
		assertDiagramStatus(t, MakeV2SessionRequest(t, admin, http.MethodGet, path, nil), http.StatusNotFound)
		actor = caller("pages:write")
		written := DecodeV2Document[services.PageDiagram](t, MakeV2BearerRequest(t, actor, http.MethodPost, pageCollection, pageDiagramCreateBody(pageDiagram.ContentHash)), http.StatusCreated)
		path = pageCollection + "/" + strconv.Itoa(written.AttachmentID)
		changed := DecodeV2Document[services.PageDiagram](t, MakeV2BearerRequest(t, actor, http.MethodPatch, path, map[string]any{"name": "Written", "mermaid": "graph TD; B-->C", "expected_content_hash": written.ContentHash}), http.StatusOK)
		storedPage := DecodeV2Document[services.PageDiagram](t, MakeV2BearerRequest(t, actor, http.MethodGet, pageCollection+"/"+strconv.Itoa(changed.AttachmentID), nil), http.StatusOK)
		if written.AttachmentID <= 0 || changed.AttachmentID == written.AttachmentID || storedPage.AttachmentID != changed.AttachmentID || storedPage.Name != "Written" {
			t.Fatal("pages:write did not grant persisted create/update/read")
		}
	})
}
