package tests

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

	"windshift/internal/models"
)

func labelCatalogPath(workspace int) string { return fmt.Sprintf("/workspaces/%d/labels", workspace) }
func itemLabelsPath(item int) string        { return fmt.Sprintf("/items/%d/labels", item) }

func (f *itemRelationFixture) label(t *testing.T, workspace int, name string) models.Label {
	t.Helper()
	label := DecodeV2Document[models.Label](t, f.request(t, f.admin, http.MethodPost, labelCatalogPath(workspace), map[string]any{"name": name, "color": "#123456"}), http.StatusCreated)
	if label.ID <= 0 || label.Name != name || label.Color != "#123456" {
		t.Fatal("label create lost identity, name or color")
	}
	return label
}

func assertLabelIDs(t *testing.T, labels []models.Label, want ...int) {
	t.Helper()
	got := make([]int, len(labels))
	for i, label := range labels {
		got[i] = label.ID
	}
	slices.Sort(got)
	want = slices.Clone(want)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("label IDs=%v, want %v", got, want)
	}
}

// Preserves the 15 former cookie LabelHandler scenarios through v2 HTTP.
// Labels remain global; workspace paths provide authorization context only.
func TestV2Labels_GlobalCatalogAndLegacyFilter(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		local, foreign := f.label(t, f.workspace, "Local"), f.label(t, f.foreign, "Foreign")
		path := labelCatalogPath(f.workspace)
		for _, query := range []string{"", "?workspace_id=999999"} {
			labels := DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, path+query, nil), http.StatusOK)
			assertLabelIDs(t, labels, local.ID, foreign.ID)
		}
		got := DecodeV2Document[models.Label](t, f.request(t, f.viewer, http.MethodGet, fmt.Sprintf("%s/%d", path, foreign.ID), nil), http.StatusOK)
		if got.ID != foreign.ID || got.Name != foreign.Name {
			t.Fatal("foreign-context label is missing from global catalog")
		}
		assertCommentStatus(t, f.request(t, f.outsider, http.MethodGet, path, nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.outsider, http.MethodGet, fmt.Sprintf("%s/%d", path, local.ID), nil), http.StatusNotFound)
		// The invalid legacy query is ignored, but a missing path context is not.
		assertCommentStatus(t, f.request(t, f.viewer, http.MethodGet, labelCatalogPath(999999), nil), http.StatusNotFound)
	})
}

func TestV2Labels_DuplicateAcrossWorkspaceContexts(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		shared := f.label(t, f.workspace, "Shared")
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, labelCatalogPath(f.foreign), map[string]any{"name": "shared"}), http.StatusConflict)
		labels := DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, labelCatalogPath(f.workspace), nil), http.StatusOK)
		assertLabelIDs(t, labels, shared.ID)
		if labels[0].Name != "Shared" {
			t.Fatal("duplicate create changed existing name")
		}
	})
}

func TestV2Labels_ItemAssignmentsAndPermissions(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		local, foreign := f.label(t, f.workspace, "Local"), f.label(t, f.foreign, "Global")
		path := itemLabelsPath(f.item)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK))
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.editor, http.MethodPut, path, map[string]any{"label_ids": []int{foreign.ID}}), http.StatusOK), foreign.ID)
		other := *f
		other.bearer = !f.bearer
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK), foreign.ID)
		for _, actor := range []*TestServer{f.viewer, f.outsider} {
			assertCommentStatus(t, f.request(t, actor, http.MethodPut, path, map[string]any{"label_ids": []int{local.ID}}), http.StatusNotFound)
			assertCommentStatus(t, f.request(t, actor, http.MethodPost, path, map[string]any{"label_id": local.ID}), http.StatusNotFound)
			assertCommentStatus(t, f.request(t, actor, http.MethodDelete, fmt.Sprintf("%s/%d", path, foreign.ID), nil), http.StatusNotFound)
			assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK), foreign.ID)
		}
		assertCommentStatus(t, f.request(t, f.outsider, http.MethodGet, path, nil), http.StatusNotFound)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.editor, http.MethodPost, path, map[string]any{"label_id": local.ID}), http.StatusOK), local.ID, foreign.ID)
		assertCommentStatus(t, f.request(t, f.editor, http.MethodDelete, fmt.Sprintf("%s/%d", path, local.ID), nil), http.StatusNoContent)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK), foreign.ID)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.editor, http.MethodPut, path, map[string]any{"label_ids": []int{}}), http.StatusOK))
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK))
	})
}

func TestV2Labels_Unauthenticated(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		label := f.label(t, f.workspace, "Protected")
		catalog, assignment := labelCatalogPath(f.workspace), itemLabelsPath(f.item)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.editor, http.MethodPost, assignment, map[string]any{"label_id": label.ID}), http.StatusOK), label.ID)
		anonymous := *f.admin
		anonymous.SessionCookie, anonymous.BearerToken = "", ""
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, catalog, nil}, {http.MethodGet, fmt.Sprintf("%s/%d", catalog, label.ID), nil},
			{http.MethodPost, catalog, map[string]any{"name": "Anonymous"}},
			{http.MethodPatch, fmt.Sprintf("%s/%d", catalog, label.ID), map[string]any{"name": "Anonymous"}},
			{http.MethodDelete, fmt.Sprintf("%s/%d", catalog, label.ID), nil},
			{http.MethodGet, assignment, nil}, {http.MethodPut, assignment, map[string]any{"label_ids": []int{}}},
			{http.MethodPost, assignment, map[string]any{"label_id": label.ID}}, {http.MethodDelete, fmt.Sprintf("%s/%d", assignment, label.ID), nil},
		} {
			t.Run(tc.method+tc.path, func(t *testing.T) {
				assertCommentStatus(t, f.request(t, &anonymous, tc.method, tc.path, tc.body), http.StatusUnauthorized)
			})
		}
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, assignment, nil), http.StatusOK), label.ID)
		labels := DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, catalog, nil), http.StatusOK)
		assertLabelIDs(t, labels, label.ID)
		if labels[0].Name != label.Name {
			t.Fatal("anonymous catalog mutation changed the label")
		}
	})
}

func TestV2Labels_MissingItem(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		label := f.label(t, f.workspace, "Existing")
		assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, itemLabelsPath(999999), nil), http.StatusNotFound)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, fmt.Sprintf("%s/%d", itemLabelsPath(999999), label.ID), nil), http.StatusNotFound)
	})
}

func TestV2Labels_CatalogMutationPermissions(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		catalog := labelCatalogPath(f.workspace)
		created := DecodeV2Document[models.Label](t, f.request(t, f.editor, http.MethodPost, catalog, map[string]any{"name": "Editable", "color": "#123456"}), http.StatusCreated)
		if created.ID <= 0 || created.Name != "Editable" || created.Color != "#123456" {
			t.Fatal("Editor label create lost required fields")
		}
		path := fmt.Sprintf("%s/%d", catalog, created.ID)
		for _, actor := range []*TestServer{f.viewer, f.outsider} {
			assertCommentStatus(t, f.request(t, actor, http.MethodPost, catalog, map[string]any{"name": "Denied"}), http.StatusNotFound)
		}
		// Editing/deleting a GLOBAL catalog entry requires workspace admin,
		// whereas creating it and assigning it to an item require only Editor.
		for _, actor := range []*TestServer{f.editor, f.viewer, f.outsider} {
			assertCommentStatus(t, f.request(t, actor, http.MethodPatch, path, map[string]any{"name": "Denied"}), http.StatusNotFound)
			assertCommentStatus(t, f.request(t, actor, http.MethodDelete, path, nil), http.StatusNotFound)
		}
		labels := DecodeV2Document[[]models.Label](t, f.request(t, f.viewer, http.MethodGet, catalog, nil), http.StatusOK)
		assertLabelIDs(t, labels, created.ID)
		if labels[0].Name != created.Name || labels[0].Color != created.Color {
			t.Fatal("denied catalog writes changed the label")
		}
		updated := DecodeV2Document[models.Label](t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"color": "#654321"}), http.StatusOK)
		if updated.ID != created.ID || updated.Name != created.Name || updated.Color != "#654321" {
			t.Fatal("color-only PATCH lost the name or color")
		}
		other := *f
		other.bearer = !f.bearer
		stored := DecodeV2Document[models.Label](t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if stored.Name != created.Name || stored.Color != updated.Color {
			t.Fatal("catalog PATCH did not persist across mounts")
		}
		assignment := itemLabelsPath(f.item)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, f.request(t, f.editor, http.MethodPost, assignment, map[string]any{"label_id": created.ID}), http.StatusOK), created.ID)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, path, nil), http.StatusNoContent)
		assertCommentStatus(t, other.request(t, f.viewer, http.MethodGet, path, nil), http.StatusNotFound)
		assertLabelIDs(t, DecodeV2Document[[]models.Label](t, other.request(t, f.viewer, http.MethodGet, assignment, nil), http.StatusOK))
	})
}
