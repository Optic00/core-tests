package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/models"
)

func priorityPath(id int) string { return fmt.Sprintf("/priorities/%d", id) }

func (f *catalogFixture) priority(t *testing.T, name string, isDefault bool) models.Priority {
	t.Helper()
	priority := DecodeV2Document[models.Priority](t, f.request(t, f.admin, http.MethodPost, "/priorities", map[string]any{"name": name, "is_default": isDefault}), http.StatusCreated)
	if priority.ID <= 0 || priority.Name != name || priority.IsDefault != isDefault {
		t.Fatal("priority fixture lost identity, name or default state")
	}
	return priority
}

// Preserves all 12 removed cookie PriorityHandler scenarios via real v2 HTTP.
func TestV2Priorities_CRUD(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		created := DecodeV2Document[models.Priority](t, f.request(t, f.admin, http.MethodPost, "/priorities", map[string]any{"name": "Super Critical", "description": "Super critical priority items", "icon": "flame", "color": "#ff0000", "sort_order": 1}), http.StatusCreated)
		if created.ID <= 0 || created.Name != "Super Critical" || created.Description != "Super critical priority items" || created.Icon != "flame" || created.Color != "#ff0000" || created.SortOrder != 1 {
			t.Fatal("priority create lost requested fields")
		}
		path := priorityPath(created.ID)
		got := DecodeV2Document[models.Priority](t, f.request(t, f.reader, http.MethodGet, path, nil), http.StatusOK)
		if got.ID != created.ID || got.Name != created.Name || got.Description != created.Description {
			t.Fatal("priority GET lost identity or description")
		}
		second, third := f.priority(t, "Second custom", false), f.priority(t, "Third custom", false)
		listed := DecodeV2Document[[]models.Priority](t, f.request(t, f.reader, http.MethodGet, "/priorities", nil), http.StatusOK)
		seen := map[int]bool{}
		for _, priority := range listed {
			if seen[priority.ID] {
				t.Fatal("priority list has duplicate IDs")
			}
			seen[priority.ID] = true
		}
		if !seen[created.ID] || !seen[second.ID] || !seen[third.ID] {
			t.Fatal("priority list omitted one of the three custom priorities")
		}
		updated := DecodeV2Document[models.Priority](t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"name": "Updated Priority", "description": "Updated description", "icon": "flag", "color": "#222222", "sort_order": 2}), http.StatusOK)
		if updated.ID != created.ID || updated.Name != "Updated Priority" || updated.Description != "Updated description" || updated.Icon != "flag" || updated.Color != "#222222" || updated.SortOrder != 2 {
			t.Fatal("priority PATCH lost updated fields")
		}
		other := *f
		other.bearer = !f.bearer
		stored := DecodeV2Document[models.Priority](t, other.request(t, f.reader, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != updated.Name || stored.Description != updated.Description || stored.Icon != updated.Icon || stored.Color != updated.Color || stored.SortOrder != updated.SortOrder {
			t.Fatal("priority PATCH did not persist across mounts")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, path, nil), http.StatusNoContent)
		assertCommentStatus(t, other.request(t, f.reader, http.MethodGet, path, nil), http.StatusNotFound)
	})
}

func TestV2Priorities_DefaultUniqueness(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		first := f.priority(t, "First Default", true)
		second := f.priority(t, "Second Default", true)
		stored := DecodeV2Document[models.Priority](t, f.request(t, f.reader, http.MethodGet, priorityPath(first.ID), nil), http.StatusOK)
		if stored.IsDefault {
			t.Fatal("creating another default did not clear the first")
		}
		defaults := func(want int) {
			t.Helper()
			listed := DecodeV2Document[[]models.Priority](t, f.request(t, f.reader, http.MethodGet, "/priorities", nil), http.StatusOK)
			count := 0
			for _, priority := range listed {
				if priority.IsDefault {
					count++
					if priority.ID != want {
						t.Fatal("unexpected default priority")
					}
				}
			}
			if count != 1 {
				t.Fatalf("default count=%d, want one", count)
			}
		}
		defaults(second.ID)
		updated := DecodeV2Document[models.Priority](t, f.request(t, f.admin, http.MethodPatch, priorityPath(first.ID), map[string]any{"is_default": true}), http.StatusOK)
		if !updated.IsDefault || updated.Name != first.Name {
			t.Fatal("default-only PATCH lost name or default state")
		}
		defaults(first.ID)
	})
}

func TestV2Priorities_ValidationDuplicatesAndMissing(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		before := DecodeV2Document[[]models.Priority](t, f.request(t, f.reader, http.MethodGet, "/priorities", nil), http.StatusOK)
		for _, body := range []map[string]any{{"description": "Description only"}, {"name": "   ", "description": "Description"}} {
			assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, "/priorities", body), http.StatusBadRequest, "priority name is required")
		}
		created := f.priority(t, "Duplicate Test", false)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, "/priorities", map[string]any{"name": created.Name}), http.StatusConflict)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPatch, priorityPath(created.ID), map[string]any{"name": "", "color": "#444444"}), http.StatusBadRequest, "priority name is required")
		stored := DecodeV2Document[models.Priority](t, f.request(t, f.reader, http.MethodGet, priorityPath(created.ID), nil), http.StatusOK)
		if stored.Name != created.Name || stored.Color != created.Color {
			t.Fatal("invalid PATCH changed priority")
		}
		after := DecodeV2Document[[]models.Priority](t, f.request(t, f.reader, http.MethodGet, "/priorities", nil), http.StatusOK)
		if len(after) != len(before)+1 {
			t.Fatal("invalid/duplicate creates changed catalog size")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, priorityPath(999999), nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, priorityPath(999999), nil), http.StatusNotFound)
	})
}

func TestV2Priorities_DeleteInUse(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		priority := f.priority(t, "In Use Priority", false)
		workspace, _ := CreateTestWorkspace(t, f.admin, "Priority usage", "PRIO")
		item := DecodeV2Document[models.Item](t, f.request(t, f.admin, http.MethodPost, "/items", map[string]any{"workspace_id": workspace, "title": "Priority reference", "priority_id": priority.ID}), http.StatusCreated)
		if item.ID <= 0 || item.PriorityID == nil || *item.PriorityID != priority.ID {
			t.Fatal("in-use fixture did not persist priority reference")
		}
		assertV2Error(t, f.request(t, f.admin, http.MethodDelete, priorityPath(priority.ID), nil), http.StatusConflict, "conflict", "priority is used by 1 work items")
		stored := DecodeV2Document[models.Priority](t, f.request(t, f.reader, http.MethodGet, priorityPath(priority.ID), nil), http.StatusOK)
		itemPath := fmt.Sprintf("/items/%d", item.ID)
		linked := DecodeV2Document[models.Item](t, f.request(t, f.admin, http.MethodGet, itemPath, nil), http.StatusOK)
		if stored.ID != priority.ID || linked.PriorityID == nil || *linked.PriorityID != priority.ID {
			t.Fatal("in-use deletion damaged priority or item reference")
		}
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, itemPath, nil), http.StatusNoContent)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, priorityPath(priority.ID), nil), http.StatusNoContent)
		assertCommentStatus(t, f.request(t, f.reader, http.MethodGet, priorityPath(priority.ID), nil), http.StatusNotFound)
	})
}

func TestV2Priorities_AuthenticationAndAdminBoundaries(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		priority := f.priority(t, "Protected priority", false)
		path := priorityPath(priority.ID)
		anonymous := *f.admin
		anonymous.SessionCookie, anonymous.BearerToken = "", ""
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, "/priorities", nil}, {http.MethodGet, path, nil},
			{http.MethodPost, "/priorities", map[string]any{"name": "Denied"}},
			{http.MethodPatch, path, map[string]any{"name": "Denied"}}, {http.MethodDelete, path, nil},
		} {
			assertCommentStatus(t, f.request(t, &anonymous, tc.method, tc.path, tc.body), http.StatusUnauthorized)
			if tc.method != http.MethodGet {
				assertV2Error(t, f.request(t, f.reader, tc.method, tc.path, tc.body), http.StatusForbidden, "forbidden", "System administration permission is required")
			}
		}
		listed := DecodeV2Document[[]models.Priority](t, f.request(t, f.reader, http.MethodGet, "/priorities", nil), http.StatusOK)
		found := false
		for _, p := range listed {
			if p.Name == "Denied" {
				t.Fatal("unauthorized create/PATCH persisted")
			}
			if p.ID == priority.ID {
				found = true
				if p.Name != priority.Name {
					t.Fatal("protected priority was changed")
				}
			}
		}
		if !found {
			t.Fatal("unauthorized deletion removed priority")
		}
	})
}
