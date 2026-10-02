package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/models"
	"windshift/internal/services"
)

func (f *itemRelationFixture) linkType(t *testing.T) int {
	t.Helper()
	kind := DecodeV2Document[models.LinkType](t, f.request(t, f.admin, http.MethodPost, "/link-types", map[string]any{
		"name": "Relation blocks", "forward_label": "blocks", "reverse_label": "is blocked by",
	}), http.StatusCreated)
	if kind.ID <= 0 || !kind.Active || kind.IsSystem {
		t.Fatal("link-type fixture needs a positive active custom type")
	}
	return kind.ID
}

func relationBody(source, target, kind int) map[string]any {
	return map[string]any{"source_type": "item", "source_id": source, "target_type": "item", "target_id": target, "link_type_id": kind}
}

func (f *itemRelationFixture) itemLinks(t *testing.T, actor *TestServer, item int) services.EntityLinks {
	t.Helper()
	return DecodeV2Document[services.EntityLinks](t, f.request(t, actor, http.MethodGet, fmt.Sprintf("/items/%d/links", item), nil), http.StatusOK)
}

// These v2 cases preserve all seven old cookie ItemLinkHandler scenarios.
func TestV2ItemLinks_SourceEditAndTargetView(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		kind, target := f.linkType(t), f.createItem(t, f.foreign, "Foreign target")
		body := relationBody(f.item, target, kind)
		empty := f.itemLinks(t, f.viewer, f.item)
		if len(empty.Outgoing) != 0 || len(empty.Incoming) != 0 {
			t.Fatal("new item has unexpected links")
		}
		// Source Editor alone is insufficient when the target is invisible.
		assertCommentStatus(t, f.request(t, f.editor, http.MethodGet, fmt.Sprintf("/items/%d", target), nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.editor, http.MethodPost, "/links", body), http.StatusNotFound)
		if got := f.itemLinks(t, f.admin, f.item); len(got.Outgoing) != 0 {
			t.Fatal("invisible-target link was persisted")
		}
		AssignWorkspaceRole(t, f.admin, f.editorID, f.foreign, "Viewer")
		visible := DecodeV2Document[v2FixtureRecord](t, f.request(t, f.editor, http.MethodGet, fmt.Sprintf("/items/%d", target), nil), http.StatusOK)
		if visible.ID != target {
			t.Fatal("target Viewer grant did not expose the intended item")
		}
		created := DecodeV2Document[models.ItemLink](t, f.request(t, f.editor, http.MethodPost, "/links", body), http.StatusCreated)
		if created.ID <= 0 || created.SourceType != "item" || created.SourceID != f.item || created.TargetType != "item" || created.TargetID != target || created.LinkTypeID != kind {
			t.Fatal("created link lost identity or endpoints")
		}
		other := *f
		other.bearer = !f.bearer
		got, incoming := other.itemLinks(t, f.editor, f.item), other.itemLinks(t, f.editor, target)
		if len(got.Outgoing) != 1 || got.Outgoing[0].ID != created.ID || len(incoming.Incoming) != 1 || incoming.Incoming[0].ID != created.ID {
			t.Fatal("link did not persist on both endpoints across mounts")
		}
		assertCommentStatus(t, f.request(t, f.editor, http.MethodPost, "/links", body), http.StatusConflict)
		path := fmt.Sprintf("/links/%d", created.ID)
		for _, actor := range []*TestServer{f.viewer, f.outsider} {
			assertCommentStatus(t, f.request(t, actor, http.MethodDelete, path, nil), http.StatusNotFound)
		}
		if got := f.itemLinks(t, f.editor, f.item); len(got.Outgoing) != 1 || got.Outgoing[0].ID != created.ID {
			t.Fatal("denied deletion changed stored link")
		}
		// A readable source must not expose a target the Viewer cannot see.
		if hidden := f.itemLinks(t, f.viewer, f.item); len(hidden.Outgoing) != 0 || len(hidden.Incoming) != 0 {
			t.Fatal("link list exposed an inaccessible endpoint")
		}
		assertCommentStatus(t, f.request(t, f.outsider, http.MethodGet, fmt.Sprintf("/items/%d/links", f.item), nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.editor, http.MethodDelete, path, nil), http.StatusNoContent)
		if source, target := other.itemLinks(t, f.editor, f.item), other.itemLinks(t, f.editor, target); len(source.Outgoing) != 0 || len(target.Incoming) != 0 {
			t.Fatal("link deletion did not persist on both endpoints")
		}
	})
}

func TestV2ItemLinks_RequiresSourceEdit(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		kind, target := f.linkType(t), f.createItem(t, f.workspace, "Readable target")
		body := relationBody(f.item, target, kind)
		// Viewer sees BOTH endpoints, but may not edit the source.
		f.itemLinks(t, f.viewer, f.item)
		f.itemLinks(t, f.viewer, target)
		assertCommentStatus(t, f.request(t, f.viewer, http.MethodPost, "/links", body), http.StatusNotFound)
		if got := f.itemLinks(t, f.editor, f.item); len(got.Outgoing) != 0 {
			t.Fatal("Viewer create persisted a link")
		}
		created := DecodeV2Document[models.ItemLink](t, f.request(t, f.editor, http.MethodPost, "/links", body), http.StatusCreated)
		got := f.itemLinks(t, f.viewer, f.item)
		if created.ID <= 0 || len(got.Outgoing) != 1 || got.Outgoing[0].ID != created.ID {
			t.Fatal("Editor create was not visible to the Viewer")
		}
	})
}

func TestV2ItemLinks_MissingSourceAndItem(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		kind := f.linkType(t)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, "/items/999999/links", nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, "/links", relationBody(999999, f.item, kind)), http.StatusNotFound)
		if got := f.itemLinks(t, f.admin, f.item); len(got.Incoming) != 0 || len(got.Outgoing) != 0 {
			t.Fatal("missing-source create changed links")
		}
	})
}

func TestV2ItemLinks_Unauthenticated(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		kind, target := f.linkType(t), f.createItem(t, f.workspace, "Target")
		body := relationBody(f.item, target, kind)
		created := DecodeV2Document[models.ItemLink](t, f.request(t, f.editor, http.MethodPost, "/links", body), http.StatusCreated)
		if created.ID <= 0 {
			t.Fatal("anonymous-delete fixture needs a positive link ID")
		}
		anonymous := *f.admin
		anonymous.SessionCookie, anonymous.BearerToken = "", ""
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, fmt.Sprintf("/items/%d/links", f.item), nil},
			{http.MethodPost, "/links", relationBody(target, f.item, kind)},
			{http.MethodDelete, fmt.Sprintf("/links/%d", created.ID), nil},
		} {
			t.Run(tc.method, func(t *testing.T) {
				assertCommentStatus(t, f.request(t, &anonymous, tc.method, tc.path, tc.body), http.StatusUnauthorized)
			})
		}
		got := f.itemLinks(t, f.editor, f.item)
		if len(got.Outgoing) != 1 || got.Outgoing[0].ID != created.ID || len(got.Incoming) != 0 {
			t.Fatal("anonymous mutation changed links")
		}
	})
}
