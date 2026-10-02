package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/models"
)

func linkTypePath(id int) string { return fmt.Sprintf("/link-types/%d", id) }

// The 12 old cookie LinkTypeHandler scenarios are retained through v2 HTTP.
func TestV2LinkTypes_CRUD(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		body := map[string]any{"name": "Blocks", "description": "This item blocks another", "forward_label": "blocks", "reverse_label": "is blocked by", "color": "#ff0000"}
		created := DecodeV2Document[models.LinkType](t, f.request(t, f.admin, http.MethodPost, "/link-types", body), http.StatusCreated)
		if created.ID <= 0 || created.Name != "Blocks" || created.Description != "This item blocks another" || created.ForwardLabel != "blocks" || created.ReverseLabel != "is blocked by" || created.Color != "#ff0000" || !created.Active || created.IsSystem {
			t.Fatal("link type create lost explicit fields or defaults")
		}
		path := linkTypePath(created.ID)
		got := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if got.ID != created.ID || got.Name != created.Name || got.Description != created.Description {
			t.Fatal("link type GET did not preserve identity and description")
		}
		second := f.linkType(t)
		listed := DecodeV2Document[[]models.LinkType](t, f.request(t, f.viewer, http.MethodGet, "/link-types", nil), http.StatusOK)
		seen := map[int]bool{}
		for _, kind := range listed {
			if seen[kind.ID] {
				t.Fatal("duplicate link type in list")
			}
			seen[kind.ID] = true
		}
		if !seen[created.ID] || !seen[second] {
			t.Fatal("list omitted created link types")
		}
		updated := DecodeV2Document[models.LinkType](t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"name": "Updated Name", "description": "Updated description", "forward_label": "updated forward", "reverse_label": "updated reverse", "color": "#abcdef", "active": true}), http.StatusOK)
		if updated.ID != created.ID || updated.Name != "Updated Name" || updated.Description != "Updated description" || updated.ForwardLabel != "updated forward" || updated.ReverseLabel != "updated reverse" || updated.Color != "#abcdef" || !updated.Active {
			t.Fatal("link type PATCH lost updated fields")
		}
		other := *f
		other.bearer = !f.bearer
		stored := DecodeV2Document[models.LinkType](t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.ID != updated.ID || stored.Name != updated.Name || stored.Description != updated.Description || stored.ForwardLabel != updated.ForwardLabel || stored.ReverseLabel != updated.ReverseLabel || stored.Color != updated.Color || !stored.Active {
			t.Fatal("link type PATCH did not persist across mounts")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, path, nil), http.StatusNoContent)
		assertCommentStatus(t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusNotFound)
	})
}

func TestV2LinkTypes_DefaultColorAndInactiveFiltering(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		id := f.linkType(t)
		path := linkTypePath(id)
		original := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if original.Color != "#6b7280" || !original.Active {
			t.Fatal("missing color/active defaults")
		}
		inactive := DecodeV2Document[models.LinkType](t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"active": false}), http.StatusOK)
		if inactive.Active || inactive.Name != original.Name || inactive.ForwardLabel != original.ForwardLabel || inactive.ReverseLabel != original.ReverseLabel || inactive.Color != original.Color {
			t.Fatal("active-only PATCH lost omitted fields")
		}
		for _, tc := range []struct {
			query   string
			visible bool
		}{{"", false}, {"?include_inactive=true", true}} {
			listed := DecodeV2Document[[]models.LinkType](t, f.request(t, f.viewer, http.MethodGet, "/link-types"+tc.query, nil), http.StatusOK)
			found := 0
			for _, kind := range listed {
				if kind.ID == id {
					found++
					if kind.Active {
						t.Fatal("list did not persist inactive state")
					}
				}
			}
			want := 0
			if tc.visible {
				want = 1
			}
			if found != want {
				t.Fatalf("inactive entries=%d, want %d for %q", found, want, tc.query)
			}
		}
	})
}

func TestV2LinkTypes_ValidationAndMissing(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		before := DecodeV2Document[[]models.LinkType](t, f.request(t, f.viewer, http.MethodGet, "/link-types", nil), http.StatusOK)
		for _, field := range []string{"name", "forward_label", "reverse_label"} {
			body := map[string]any{"name": "Invalid", "forward_label": "forward", "reverse_label": "reverse"}
			delete(body, field)
			t.Run(field, func(t *testing.T) {
				assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, "/link-types", body), http.StatusBadRequest, "name, forward_label, and reverse_label are required")
			})
		}
		after := DecodeV2Document[[]models.LinkType](t, f.request(t, f.viewer, http.MethodGet, "/link-types", nil), http.StatusOK)
		if len(before) != len(after) {
			t.Fatal("invalid creates changed the catalog")
		}
		id := f.linkType(t)
		path := linkTypePath(id)
		original := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"name": "", "forward_label": "forward", "reverse_label": "reverse"}), http.StatusBadRequest, "name, forward_label, and reverse_label are required")
		stored := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != original.Name || stored.ForwardLabel != original.ForwardLabel || stored.ReverseLabel != original.ReverseLabel {
			t.Fatal("invalid PATCH changed the catalog entry")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, linkTypePath(999999), nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, linkTypePath(999999), nil), http.StatusNotFound)
	})
}

func TestV2LinkTypes_SystemAndAdminBoundaries(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		id := f.linkType(t)
		path := linkTypePath(id)
		for _, actor := range []*TestServer{f.editor, f.viewer, f.outsider} {
			// The catalog is globally readable, but not globally writable.
			got := DecodeV2Document[models.LinkType](t, f.request(t, actor, http.MethodGet, path, nil), http.StatusOK)
			if got.ID != id {
				t.Fatal("authenticated catalog reader got wrong type")
			}
			assertCommentStatus(t, f.request(t, actor, http.MethodPost, "/link-types", map[string]any{"name": "Denied", "forward_label": "forward", "reverse_label": "reverse"}), http.StatusForbidden)
			assertCommentStatus(t, f.request(t, actor, http.MethodPatch, path, map[string]any{"name": "Denied"}), http.StatusForbidden)
			assertCommentStatus(t, f.request(t, actor, http.MethodDelete, path, nil), http.StatusForbidden)
		}
		stored := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != "Relation blocks" {
			t.Fatal("nonadmin mutation changed catalog entry")
		}
		listed := DecodeV2Document[[]models.LinkType](t, f.request(t, f.viewer, http.MethodGet, "/link-types", nil), http.StatusOK)
		systemID := 0
		for _, kind := range listed {
			if kind.Name == "Denied" {
				t.Fatal("nonadmin create persisted")
			}
			if kind.IsSystem && systemID == 0 {
				systemID = kind.ID
			}
		}
		if systemID <= 0 {
			t.Fatal("production bootstrap did not provide a system link type")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, linkTypePath(systemID), nil), http.StatusForbidden)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPatch, linkTypePath(systemID), map[string]any{"name": "Denied"}), http.StatusForbidden)
		system := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, linkTypePath(systemID), nil), http.StatusOK)
		if system.ID != systemID || !system.IsSystem || system.Name == "Denied" {
			t.Fatal("system type protection did not preserve the record")
		}
	})
}

func TestV2LinkTypes_DeleteInUse(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		id, target := f.linkType(t), f.createItem(t, f.workspace, "Linked target")
		link := DecodeV2Document[models.ItemLink](t, f.request(t, f.editor, http.MethodPost, "/links", relationBody(f.item, target, id)), http.StatusCreated)
		if link.ID <= 0 || link.LinkTypeID != id {
			t.Fatal("in-use fixture did not produce a typed link")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, linkTypePath(id), nil), http.StatusConflict)
		stored := DecodeV2Document[models.LinkType](t, f.request(t, f.viewer, http.MethodGet, linkTypePath(id), nil), http.StatusOK)
		got := f.itemLinks(t, f.viewer, f.item)
		if stored.ID != id || len(got.Outgoing) != 1 || got.Outgoing[0].ID != link.ID {
			t.Fatal("in-use deletion damaged the type or its link")
		}
		assertCommentStatus(t, f.request(t, f.editor, http.MethodDelete, fmt.Sprintf("/links/%d", link.ID), nil), http.StatusNoContent)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, linkTypePath(id), nil), http.StatusNoContent)
		assertCommentStatus(t, f.request(t, f.viewer, http.MethodGet, linkTypePath(id), nil), http.StatusNotFound)
	})
}
