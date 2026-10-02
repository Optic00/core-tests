package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/models"
)

type pageLabelFixture struct {
	admin, editor, viewer, outsider *TestServer
	workspace, otherWorkspace       int
	bearer                          bool
}

// Each case runs through both real mounts with independent production fixtures.
// User creation and role assignment intentionally use retained bootstrap APIs.
func runPageLabelCase(t *testing.T, test func(*testing.T, *pageLabelFixture)) {
	t.Helper()
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			admin, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, admin)
			workspace := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, admin, http.MethodPost, "/workspaces", map[string]any{"name": "Labels", "key": "LBL"}), http.StatusCreated)
			other := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, admin, http.MethodPost, "/workspaces", map[string]any{"name": "Other labels", "key": "OTHERLBL"}), http.StatusCreated)
			actor := func(name, role string) *TestServer {
				id, username, password := CreateTestUserWithCredentials(t, admin, name, name+"@example.test")
				if role != "" {
					AssignWorkspaceRole(t, admin, id, workspace.ID, role)
				}
				cookie, token := CreateAuthCredentialsForUser(t, admin, username, password)
				actorServer := *admin
				actorServer.SessionCookie, actorServer.BearerToken = cookie, token
				return &actorServer
			}
			f := &pageLabelFixture{admin: admin, workspace: workspace.ID, otherWorkspace: other.ID, bearer: bearer}
			f.editor = actor("label-editor", "Editor")
			// An explicit Viewer grant closes the implicit everyone-role fallback.
			f.viewer = actor("label-viewer", "Viewer")
			f.outsider = actor("label-outsider", "")
			test(t, f)
		})
	}
}

func (f *pageLabelFixture) request(t *testing.T, actor *TestServer, method, path string, body any) *http.Response {
	t.Helper()
	if f.bearer {
		return MakeV2BearerRequest(t, actor, method, path, body)
	}
	return MakeV2SessionRequest(t, actor, method, path, body)
}

func (f *pageLabelFixture) label(t *testing.T, workspace int, name string) models.PageLabel {
	t.Helper()
	return DecodeV2Document[models.PageLabel](t, f.request(t, f.admin, http.MethodPost, fmt.Sprintf("/workspaces/%d/page-labels", workspace), map[string]any{"name": name}), http.StatusCreated)
}

func (f *pageLabelFixture) page(t *testing.T) int {
	t.Helper()
	return DecodeV2Document[v2FixtureRecord](t, f.request(t, f.editor, http.MethodPost, fmt.Sprintf("/workspaces/%d/pages", f.workspace), map[string]any{"title": "Label page"}), http.StatusCreated).ID
}

func (f *pageLabelFixture) labelsPath(pageID int) string {
	return fmt.Sprintf("/workspaces/%d/pages/%d/labels", f.workspace, pageID)
}

func assertPageLabelStatus(t *testing.T, response *http.Response, status int) {
	t.Helper()
	defer response.Body.Close()
	AssertStatusCode(t, response, status)
}

func TestV2PageLabels_Create_RejectsViewer(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		path := fmt.Sprintf("/workspaces/%d/page-labels", f.workspace)
		assertPageLabelStatus(t, f.request(t, f.viewer, http.MethodPost, path, map[string]any{"name": "design"}), http.StatusNotFound)
		labels := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
		if len(labels) != 0 {
			t.Fatalf("denied create persisted labels: %+v", labels)
		}
	})
}

func TestV2PageLabels_Create_EditorSucceeds(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		label := DecodeV2Document[models.PageLabel](t, f.request(t, f.editor, http.MethodPost, fmt.Sprintf("/workspaces/%d/page-labels", f.workspace), map[string]any{"name": "design"}), http.StatusCreated)
		if label.ID <= 0 || label.Name != "design" || label.Color != "#3B82F6" || label.WorkspaceID != f.workspace {
			t.Fatalf("label=%+v", label)
		}
	})
}

func TestV2PageLabels_Get_404ForCrossWorkspace(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		own := f.label(t, f.workspace, "visible")
		visible := DecodeV2Document[models.PageLabel](t, f.request(t, f.editor, http.MethodGet, fmt.Sprintf("/workspaces/%d/page-labels/%d", f.workspace, own.ID), nil), http.StatusOK)
		if visible.ID != own.ID || visible.Name != own.Name {
			t.Fatalf("own workspace label=%+v", visible)
		}
		other := f.label(t, f.otherWorkspace, "secret")
		assertPageLabelStatus(t, f.request(t, f.editor, http.MethodGet, fmt.Sprintf("/workspaces/%d/page-labels/%d", f.workspace, other.ID), nil), http.StatusNotFound)
	})
}

func TestV2PageLabels_Delete_CascadesAssignments(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		page, label := f.page(t), f.label(t, f.workspace, "urgent")
		path := f.labelsPath(page)
		before := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodPost, path, map[string]any{"label_id": label.ID}), http.StatusOK)
		if len(before) != 1 || before[0].ID != label.ID {
			t.Fatalf("assignment before delete=%+v", before)
		}
		labelPath := fmt.Sprintf("/workspaces/%d/page-labels/%d", f.workspace, label.ID)
		assertPageLabelStatus(t, f.request(t, f.editor, http.MethodDelete, labelPath, nil), http.StatusNoContent)
		assertPageLabelStatus(t, f.request(t, f.editor, http.MethodGet, labelPath, nil), http.StatusNotFound)
		after := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if len(after) != 0 {
			t.Fatalf("assignments after label deletion=%+v", after)
		}
	})
}

func TestV2PageLabels_AttachDetach_PerPagePermission(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		page, label := f.page(t), f.label(t, f.workspace, "design")
		path := f.labelsPath(page)
		body := map[string]any{"label_id": label.ID}
		assertPageLabelStatus(t, f.request(t, f.viewer, http.MethodPost, path, body), http.StatusNotFound)
		before := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if len(before) != 0 {
			t.Fatalf("denied attach persisted: %+v", before)
		}
		attached := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodPost, path, body), http.StatusOK)
		if len(attached) != 1 || attached[0].ID != label.ID {
			t.Fatalf("attached=%+v", attached)
		}
		detach := fmt.Sprintf("%s/%d", path, label.ID)
		assertPageLabelStatus(t, f.request(t, f.viewer, http.MethodDelete, detach, nil), http.StatusNotFound)
		retained := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if len(retained) != 1 || retained[0].ID != label.ID {
			t.Fatalf("denied detach changed assignment: %+v", retained)
		}
		assertPageLabelStatus(t, f.request(t, f.editor, http.MethodDelete, detach, nil), http.StatusNoContent)
		after := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if len(after) != 0 {
			t.Fatalf("detach did not persist: %+v", after)
		}
	})
}

func TestV2PageLabels_AttachRejectsCrossWorkspaceLabel(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		page, label := f.page(t), f.label(t, f.otherWorkspace, "other")
		path := f.labelsPath(page)
		assertPageLabelStatus(t, f.request(t, f.editor, http.MethodPost, path, map[string]any{"label_id": label.ID}), http.StatusNotFound)
		labels := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if len(labels) != 0 {
			t.Fatalf("cross-workspace attach persisted: %+v", labels)
		}
	})
}

func TestV2PageLabels_List_RequiresWorkspaceView(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		label := f.label(t, f.workspace, "design")
		path := fmt.Sprintf("/workspaces/%d/page-labels", f.workspace)
		assertPageLabelStatus(t, f.request(t, f.outsider, http.MethodGet, path, nil), http.StatusNotFound)
		visible := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if len(visible) != 1 || visible[0].ID != label.ID {
			t.Fatalf("viewer labels=%+v", visible)
		}
	})
}

func TestV2PageLabels_NameUniquenessPerWorkspace(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		first := f.label(t, f.workspace, "design")
		path := fmt.Sprintf("/workspaces/%d/page-labels", f.workspace)
		assertPageLabelStatus(t, f.request(t, f.editor, http.MethodPost, path, map[string]any{"name": "design"}), http.StatusConflict)
		labels := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodGet, path, nil), http.StatusOK)
		if len(labels) != 1 || labels[0].ID != first.ID {
			t.Fatalf("duplicate changed labels=%+v", labels)
		}
		other := f.label(t, f.otherWorkspace, "design")
		if other.ID == first.ID || other.WorkspaceID != f.otherWorkspace {
			t.Fatalf("cross-workspace name reuse=%+v", other)
		}
	})
}

func TestV2PageLabels_PreloadLabelsOnPageDetail(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		page, label := f.page(t), f.label(t, f.workspace, "design")
		DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodPost, f.labelsPath(page), map[string]any{"label_id": label.ID}), http.StatusOK)
		detail := DecodeV2Document[struct {
			Labels []models.PageLabel `json:"labels"`
		}](t, f.request(t, f.viewer, http.MethodGet, fmt.Sprintf("/workspaces/%d/pages/%d", f.workspace, page), nil), http.StatusOK)
		if len(detail.Labels) != 1 || detail.Labels[0].ID != label.ID || detail.Labels[0].Name != "design" {
			t.Fatalf("preloaded labels=%+v", detail.Labels)
		}
	})
}

func TestV2PageLabels_SetForPage_DedupesDuplicateIDs(t *testing.T) {
	runPageLabelCase(t, func(t *testing.T, f *pageLabelFixture) {
		page, label := f.page(t), f.label(t, f.workspace, "design")
		path := f.labelsPath(page)
		attached := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.editor, http.MethodPut, path, map[string]any{"label_ids": []int{label.ID, label.ID}}), http.StatusOK)
		if len(attached) != 1 || attached[0].ID != label.ID {
			t.Fatalf("deduplicated labels=%+v", attached)
		}
		stored := DecodeV2Document[[]models.PageLabel](t, f.request(t, f.viewer, http.MethodGet, path, nil), http.StatusOK)
		if len(stored) != 1 || stored[0].ID != label.ID {
			t.Fatalf("persisted labels=%+v", stored)
		}
	})
}
