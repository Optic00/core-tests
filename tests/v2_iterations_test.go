package tests

import (
	"fmt"
	"net/http"
	"reflect"
	"testing"

	"windshift/internal/models"
	"windshift/internal/services"
)

func iterationPath(id int) string { return fmt.Sprintf("/iterations/%d", id) }
func workspaceIterations(workspace int) string {
	return fmt.Sprintf("/workspaces/%d/iterations", workspace)
}

func iterationBody(name, status string) map[string]any {
	return map[string]any{"name": name, "description": "Iteration description", "start_date": "2026-07-01", "end_date": "2026-07-14", "status": status}
}

func (f *catalogFixture) iteration(t *testing.T, collection, name, status string) models.Iteration {
	t.Helper()
	created := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodPost, collection, iterationBody(name, status)), http.StatusCreated)
	wantStatus := status
	if wantStatus == "" {
		wantStatus = "planned"
	}
	if created.ID <= 0 || created.Name != name || created.Status != wantStatus || created.StartDate != "2026-07-01" || created.EndDate != "2026-07-14" {
		t.Fatal("iteration fixture lost identity, dates or status")
	}
	return created
}

// Replaces 15 removed cookie IterationHandler scenarios, plus the separate
// omitted/empty/null regression. V2 uses path-selected scope, local-only
// workspace lists and rejects invalid nonempty create statuses. Those are
// explicit contract changes, not preserved legacy expectations.
func TestV2Iterations_CRUDAndProgress(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		workspace, _ := CreateTestWorkspace(t, f.admin, "Iteration lifecycle", "ILC")
		for _, collection := range []string{"/iterations", workspaceIterations(workspace)} {
			t.Run(collection, func(t *testing.T) {
				created := f.iteration(t, collection, "Original iteration", "planned")
				global := collection == "/iterations"
				if created.IsGlobal != global || (global && created.WorkspaceID != nil) || (!global && (created.WorkspaceID == nil || *created.WorkspaceID != workspace)) {
					t.Fatal("create did not use path-selected scope")
				}
				path := iterationPath(created.ID)
				got := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
				if got.ID != created.ID || got.Name != created.Name || got.Description != created.Description {
					t.Fatal("GET lost iteration identity or description")
				}
				updated := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"name": "Updated iteration", "description": "Updated description", "start_date": "2026-07-05", "end_date": "2026-07-20", "status": "active"}), http.StatusOK)
				if updated.ID != created.ID || updated.Name != "Updated iteration" || updated.Description != "Updated description" || updated.StartDate != "2026-07-05" || updated.EndDate != "2026-07-20" || updated.Status != "active" || updated.IsGlobal != global || !reflect.DeepEqual(updated.WorkspaceID, created.WorkspaceID) {
					t.Fatal("PATCH lost requested fields or changed scope")
				}
				other := *f
				other.bearer = !f.bearer
				stored := DecodeV2Document[models.Iteration](t, other.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
				if !reflect.DeepEqual(stored, updated) {
					t.Fatal("iteration PATCH did not persist across mounts")
				}
				progress := DecodeV2Document[services.IterationProgressReport](t, f.request(t, f.admin, http.MethodGet, path+"/progress", nil), http.StatusOK)
				if progress.IterationID != created.ID || progress.IterationName != updated.Name || progress.TotalItems != 0 {
					t.Fatal("empty iteration progress lost identity or reported phantom items")
				}
				assertCommentStatus(t, f.request(t, f.admin, http.MethodDelete, path, nil), http.StatusNoContent)
				assertV2Error(t, other.request(t, f.admin, http.MethodGet, path, nil), http.StatusNotFound, "not_found", "Planning object was not found")
				assertCommentStatus(t, other.request(t, f.admin, http.MethodGet, path+"/progress", nil), http.StatusNotFound)
			})
		}
		for _, suffix := range []string{"", "/progress"} {
			assertV2Error(t, f.request(t, f.admin, http.MethodGet, iterationPath(999999)+suffix, nil), http.StatusNotFound, "not_found", "Planning object was not found")
		}
	})
}

func TestV2Iterations_ListScopeAndStatus(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		workspace, _ := CreateTestWorkspace(t, f.admin, "Iteration scope", "ISC")
		foreign, _ := CreateTestWorkspace(t, f.admin, "Other iteration scope", "OISC")
		global := []models.Iteration{f.iteration(t, "/iterations", "Planned", "planned"), f.iteration(t, "/iterations", "Active", "active"), f.iteration(t, "/iterations", "Completed", "completed")}
		local := f.iteration(t, workspaceIterations(workspace), "Local", "active")
		other := f.iteration(t, workspaceIterations(foreign), "Foreign", "active")
		checkList := func(path string, ids ...int) {
			t.Helper()
			rows, page := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, path, nil))
			if len(rows) != len(ids) || page.TotalItems != len(ids) {
				t.Fatalf("%s: got %d rows and total %d; want %d", path, len(rows), page.TotalItems, len(ids))
			}
			seen := map[int]bool{}
			for _, row := range rows {
				if seen[row.ID] {
					t.Fatal("duplicate iteration in list")
				}
				seen[row.ID] = true
			}
			for _, id := range ids {
				if !seen[id] {
					t.Fatalf("%s omitted iteration %d", path, id)
				}
			}
		}
		checkList("/iterations", global[0].ID, global[1].ID, global[2].ID)
		// Unlike the old cookie query filter, v2 workspace lists exclude globals.
		checkList(workspaceIterations(workspace), local.ID)
		checkList(workspaceIterations(foreign), other.ID)
		checkList("/iterations?status=active", global[1].ID)
		checkList(workspaceIterations(workspace)+"?status=active", local.ID)
		checkList(workspaceIterations(workspace) + "?status=planned")
	})
}

func TestV2Iterations_ValidationAndPathScope(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		workspace, _ := CreateTestWorkspace(t, f.admin, "Iteration validation", "IVL")
		for _, tc := range []struct {
			name, field string
			value       any
			message     string
		}{
			{"missing name", "name", nil, "is required"}, {"blank name", "name", "   ", "is required"},
			{"missing start", "start_date", nil, "is required"}, {"missing end", "end_date", nil, "is required"},
			{"invalid date", "start_date", "July 1", "must use YYYY-MM-DD"},
			{"reversed dates", "end_date", "2026-06-30", "must be on or after start_date"},
			{"invalid status", "status", "invalid-status", "must be planned, active, completed, or cancelled"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				body := iterationBody("Invalid iteration", "planned")
				if tc.value == nil {
					delete(body, tc.field)
				} else {
					body[tc.field] = tc.value
				}
				assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, "/iterations", body), http.StatusBadRequest, tc.message)
			})
		}
		// is_global/workspace_id are not v2 create fields. Inconsistent old body
		// scopes are rejected; scope is now selected exclusively by the route.
		for _, tc := range []struct {
			path, field string
			value       any
		}{
			{"/iterations", "workspace_id", workspace}, {workspaceIterations(workspace), "is_global", true},
		} {
			body := iterationBody("Rejected body scope", "planned")
			body[tc.field] = tc.value
			assertCommentStatus(t, f.request(t, f.admin, http.MethodPost, tc.path, body), http.StatusBadRequest, "Request body is not valid JSON")
		}
		// A nonadmin cannot infer whether an inaccessible workspace exists.
		assertCommentStatus(t, f.request(t, f.reader, http.MethodPost, workspaceIterations(999999), iterationBody("Missing workspace", "planned")), http.StatusNotFound)
		rows, page := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, "/iterations", nil))
		if len(rows) != 0 || page.TotalItems != 0 {
			t.Fatal("invalid creates persisted iterations")
		}
		local, _ := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, workspaceIterations(workspace), nil))
		if len(local) != 0 {
			t.Fatal("invalid scope create persisted locally")
		}
		body := iterationBody("Omitted status", "planned")
		delete(body, "status")
		created := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodPost, "/iterations", body), http.StatusCreated)
		if created.ID <= 0 || created.Status != "planned" {
			t.Fatal("omitted status did not default to planned")
		}
		path := iterationPath(created.ID)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodPatch, path, map[string]any{"name": "Must not persist", "status": "invalid-status"}), http.StatusBadRequest, "must be planned, active, completed, or cancelled")
		stored := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
		if !reflect.DeepEqual(stored, created) {
			t.Fatal("invalid PATCH changed iteration")
		}
	})
}

func TestV2Iterations_PatchOmittedEmptyAndNull(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		// Iteration-type configuration retains its supported cookie API.
		response := MakeAuthRequest(t, f.admin, http.MethodPost, "/iteration-types", map[string]any{"name": "Patch type", "color": "#123456"})
		AssertStatusCode(t, response, http.StatusCreated)
		assertCommentJSON(t, response)
		var kind models.IterationType
		DecodeJSON(t, response, &kind)
		response.Body.Close()
		if kind.ID <= 0 {
			t.Fatal("type fixture needs positive ID")
		}
		body := iterationBody("Original", "planned")
		body["type_id"] = kind.ID
		created := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodPost, "/iterations", body), http.StatusCreated)
		if created.ID <= 0 || created.TypeID == nil || *created.TypeID != kind.ID {
			t.Fatal("iteration lost initial type")
		}
		path := iterationPath(created.ID)
		patch := func(body map[string]any) models.Iteration {
			t.Helper()
			updated := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodPatch, path, body), http.StatusOK)
			other := *f
			other.bearer = !f.bearer
			stored := DecodeV2Document[models.Iteration](t, other.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
			if !reflect.DeepEqual(stored, updated) {
				t.Fatal("partial PATCH did not persist")
			}
			return updated
		}
		renamed := patch(map[string]any{"name": "Renamed"})
		if renamed.Name != "Renamed" || renamed.Description != created.Description || renamed.TypeID == nil || *renamed.TypeID != kind.ID || renamed.StartDate != created.StartDate || renamed.EndDate != created.EndDate || renamed.Status != created.Status {
			t.Fatal("omitted fields were not preserved")
		}
		cleared := patch(map[string]any{"description": ""})
		if cleared.Description != "" || cleared.TypeID == nil || *cleared.TypeID != kind.ID || cleared.Name != "Renamed" {
			t.Fatal("empty description did not clear only description")
		}
		cleared = patch(map[string]any{"type_id": nil})
		if cleared.TypeID != nil || cleared.Name != "Renamed" || cleared.Description != "" {
			t.Fatal("null type did not clear only type")
		}
	})
}

func TestV2Iterations_WorkspaceAndGlobalPermissions(t *testing.T) {
	runItemRelationCase(t, func(t *testing.T, f *itemRelationFixture) {
		localCollection := workspaceIterations(f.workspace)
		local := DecodeV2Document[models.Iteration](t, f.request(t, f.editor, http.MethodPost, localCollection, iterationBody("Local protected", "planned")), http.StatusCreated)
		global := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodPost, "/iterations", iterationBody("Global protected", "planned")), http.StatusCreated)
		if local.ID <= 0 || global.ID <= 0 {
			t.Fatal("permissions need existing local and global iterations")
		}
		for _, target := range []models.Iteration{local, global} {
			path := iterationPath(target.ID)
			collection := "/iterations"
			if !target.IsGlobal {
				collection = localCollection
			}
			for _, actor := range []*TestServer{f.viewer, f.outsider} {
				readStatus := http.StatusOK
				if actor == f.outsider && !target.IsGlobal {
					readStatus = http.StatusNotFound
				}
				for _, readPath := range []string{collection, path, path + "/progress"} {
					assertCommentStatus(t, f.request(t, actor, http.MethodGet, readPath, nil), readStatus)
				}
				assertCommentStatus(t, f.request(t, actor, http.MethodPost, collection, iterationBody("Denied iteration", "planned")), http.StatusNotFound)
				assertCommentStatus(t, f.request(t, actor, http.MethodPatch, path, map[string]any{"name": "Denied iteration"}), http.StatusNotFound)
				assertCommentStatus(t, f.request(t, actor, http.MethodDelete, path, nil), http.StatusNotFound)
				stored := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
				if !reflect.DeepEqual(stored, target) {
					t.Fatal("denied write changed iteration")
				}
				rows, page := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, collection, nil))
				if len(rows) != 1 || page.TotalItems != 1 || rows[0].ID != target.ID {
					t.Fatal("denied create/delete changed collection")
				}
			}
		}
		// Workspace Editor is sufficient locally, but not a global manager.
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodPost, "/iterations", iterationBody("Denied global", "planned")},
			{http.MethodPatch, iterationPath(global.ID), map[string]any{"name": "Denied global"}},
			{http.MethodDelete, iterationPath(global.ID), nil},
		} {
			assertCommentStatus(t, f.request(t, f.editor, tc.method, tc.path, tc.body), http.StatusNotFound)
		}
		globalStored := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodGet, iterationPath(global.ID), nil), http.StatusOK)
		globals, _ := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, "/iterations", nil))
		if !reflect.DeepEqual(globalStored, global) || len(globals) != 1 {
			t.Fatal("workspace Editor changed global iteration")
		}
		changed := DecodeV2Document[models.Iteration](t, f.request(t, f.editor, http.MethodPatch, iterationPath(local.ID), map[string]any{"name": "Editor changed"}), http.StatusOK)
		stored := DecodeV2Document[models.Iteration](t, f.request(t, f.viewer, http.MethodGet, iterationPath(local.ID), nil), http.StatusOK)
		if changed.Name != "Editor changed" || stored.Name != changed.Name || stored.ID != local.ID {
			t.Fatal("Editor local update did not persist")
		}
		assertCommentStatus(t, f.request(t, f.editor, http.MethodDelete, iterationPath(local.ID), nil), http.StatusNoContent)
		assertCommentStatus(t, f.request(t, f.admin, http.MethodGet, iterationPath(local.ID), nil), http.StatusNotFound)
	})
}

func TestV2Iterations_Authentication(t *testing.T) {
	runCatalogCase(t, func(t *testing.T, f *catalogFixture) {
		created := f.iteration(t, "/iterations", "Authenticated iteration", "planned")
		workspace, _ := CreateTestWorkspace(t, f.admin, "Authenticated iterations", "IAU")
		anonymous := *f.admin
		anonymous.SessionCookie, anonymous.BearerToken = "", ""
		path := iterationPath(created.ID)
		for _, tc := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, "/iterations", nil}, {http.MethodGet, workspaceIterations(workspace), nil},
			{http.MethodGet, path, nil}, {http.MethodGet, path + "/progress", nil},
			{http.MethodPost, "/iterations", iterationBody("Anonymous", "planned")},
			{http.MethodPost, workspaceIterations(workspace), iterationBody("Anonymous", "planned")},
			{http.MethodPatch, path, map[string]any{"name": "Anonymous"}}, {http.MethodDelete, path, nil},
		} {
			assertCommentStatus(t, f.request(t, &anonymous, tc.method, tc.path, tc.body), http.StatusUnauthorized)
		}
		stored := DecodeV2Document[models.Iteration](t, f.request(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
		rows, _ := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, "/iterations", nil))
		local, _ := DecodeV2Page[models.Iteration](t, f.request(t, f.admin, http.MethodGet, workspaceIterations(workspace), nil))
		if !reflect.DeepEqual(stored, created) || len(rows) != 1 || len(local) != 0 {
			t.Fatal("anonymous write changed persisted iterations")
		}
	})
}

func TestV2Iterations_GranularBearerScopes(t *testing.T) {
	admin, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, admin)
	f := &catalogFixture{admin: admin, bearer: true}
	created := f.iteration(t, "/iterations", "Scoped iteration", "planned")
	path := iterationPath(created.ID)
	caller := func(scope string) *TestServer {
		t.Helper()
		actor := *admin
		actor.SessionCookie = ""
		actor.BearerToken = createTokenWithScopesAsUser(t, admin, "admin", "testpass123", []string{scope})
		return &actor
	}
	withoutIterationScope := caller("users:read")
	identity := DecodeV2Document[models.User](t, f.request(t, withoutIterationScope, http.MethodGet, "/users/me", nil), http.StatusOK)
	if identity.ID != lookupAdminUser(t, admin).ID {
		t.Fatal("missing-scope control did not authenticate as the administrator")
	}
	for _, readPath := range []string{"/iterations", path, path + "/progress"} {
		assertV2Error(t, f.request(t, withoutIterationScope, http.MethodGet, readPath, nil), http.StatusForbidden, "insufficient_permission")
	}
	reader := caller("iterations:read")
	listed, _ := DecodeV2Page[models.Iteration](t, f.request(t, reader, http.MethodGet, "/iterations", nil))
	got := DecodeV2Document[models.Iteration](t, f.request(t, reader, http.MethodGet, path, nil), http.StatusOK)
	progress := DecodeV2Document[services.IterationProgressReport](t, f.request(t, reader, http.MethodGet, path+"/progress", nil), http.StatusOK)
	if len(listed) != 1 || listed[0].ID != created.ID || got.ID != created.ID || progress.IterationID != created.ID {
		t.Fatal("read scope did not return the existing iteration")
	}
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/iterations", iterationBody("Denied scoped", "planned")},
		{http.MethodPatch, path, map[string]any{"name": "Denied scoped"}},
		{http.MethodDelete, path, nil},
	} {
		assertV2Error(t, f.request(t, reader, tc.method, tc.path, tc.body), http.StatusForbidden, "insufficient_permission")
	}
	stored := DecodeV2Document[models.Iteration](t, f.request(t, admin, http.MethodGet, path, nil), http.StatusOK)
	rows, _ := DecodeV2Page[models.Iteration](t, f.request(t, admin, http.MethodGet, "/iterations", nil))
	if !reflect.DeepEqual(stored, created) || len(rows) != 1 {
		t.Fatal("read-only scope changed iterations")
	}
	writer := caller("iterations:write")
	written := DecodeV2Document[models.Iteration](t, f.request(t, writer, http.MethodPost, "/iterations", iterationBody("Written iteration", "planned")), http.StatusCreated)
	if written.ID <= 0 {
		t.Fatal("write scope did not create iteration")
	}
	writePath := iterationPath(written.ID)
	updated := DecodeV2Document[models.Iteration](t, f.request(t, writer, http.MethodPatch, writePath, map[string]any{"name": "Scoped update"}), http.StatusOK)
	stored = DecodeV2Document[models.Iteration](t, f.request(t, writer, http.MethodGet, writePath, nil), http.StatusOK)
	if updated.Name != "Scoped update" || !reflect.DeepEqual(stored, updated) {
		t.Fatal("write scope did not persist update or imply read")
	}
	assertV2Error(t, f.request(t, writer, http.MethodDelete, writePath, nil), http.StatusForbidden, "insufficient_permission")
	stored = DecodeV2Document[models.Iteration](t, f.request(t, admin, http.MethodGet, writePath, nil), http.StatusOK)
	if !reflect.DeepEqual(stored, updated) {
		t.Fatal("write-only token deleted iteration")
	}
	assertCommentStatus(t, f.request(t, caller("iterations:delete"), http.MethodDelete, writePath, nil), http.StatusNoContent)
	assertCommentStatus(t, f.request(t, admin, http.MethodGet, writePath, nil), http.StatusNotFound)
}
