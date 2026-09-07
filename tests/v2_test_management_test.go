package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	v2 "windshift/internal/restapi/v2"
)

type managementRecord struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Status       string `json:"status"`
	ActualResult string `json:"actual_result"`
	Notes        string `json:"notes"`
	TestCaseID   int    `json:"test_case_id"`
	PlanID       int    `json:"plan_id"`
}
type managementFixture struct {
	server    *TestServer
	workspace int
	bearer    bool
}

func runManagementCase(t *testing.T, test func(*testing.T, *managementFixture)) {
	t.Helper()
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			server, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, server)
			f := &managementFixture{server: server, bearer: bearer}
			f.workspace = f.workspaceNamed(t, "Management", "MGMT")
			test(t, f)
		})
	}
}
func (f *managementFixture) request(t *testing.T, method, path string, body any) *http.Response {
	t.Helper()
	if f.bearer {
		return MakeV2BearerRequest(t, f.server, method, path, body)
	}
	return MakeV2SessionRequest(t, f.server, method, path, body)
}
func (f *managementFixture) workspaceNamed(t *testing.T, name, key string) int {
	t.Helper()
	return DecodeV2Document[managementRecord](t, f.request(t, http.MethodPost, "/workspaces", map[string]any{"name": name, "key": key}), http.StatusCreated).ID
}
func (f *managementFixture) path(resource string) string {
	return fmt.Sprintf("/workspaces/%d/%s", f.workspace, resource)
}
func (f *managementFixture) create(t *testing.T, resource string, body any) managementRecord {
	t.Helper()
	return DecodeV2Document[managementRecord](t, f.request(t, http.MethodPost, f.path(resource), body), http.StatusCreated)
}
func (f *managementFixture) attach(t *testing.T, plan, caseID int) {
	t.Helper()
	DecodeV2Document[map[string]any](t, f.request(t, http.MethodPost, f.path(fmt.Sprintf("test-plans/%d/test-cases", plan)), map[string]any{"test_case_id": caseID}), http.StatusOK)
}
func (f *managementFixture) seed(t *testing.T) (int, int) {
	t.Helper()
	c := f.create(t, "test-cases", map[string]any{"title": "Test case", "priority": "medium"})
	p := f.create(t, "test-plans", map[string]any{"name": "Test plan"})
	f.attach(t, p.ID, c.ID)
	return c.ID, p.ID
}
func (f *managementFixture) results(t *testing.T, runID int) []managementRecord {
	t.Helper()
	return DecodeV2Document[[]managementRecord](t, f.request(t, http.MethodGet, f.path(fmt.Sprintf("test-runs/%d/results", runID)), nil), http.StatusOK)
}
func TestV2TestManagementAggregateRoutes(t *testing.T) {
	runManagementCase(t, func(t *testing.T, f *managementFixture) {
		caseID, planID := f.seed(t)
		cases, page := DecodeV2Page[managementRecord](t, f.request(t, http.MethodGet, f.path("test-cases"), nil))
		if len(cases) != 1 || cases[0].ID != caseID || page.TotalItems != 1 {
			t.Fatalf("cases=%+v page=%+v", cases, page)
		}
		run := f.create(t, "test-runs", map[string]any{"name": "Aggregate run", "plan_id": planID})
		detail := DecodeV2Document[struct {
			Run       managementRecord   `json:"run"`
			TestCases []managementRecord `json:"test_cases"`
		}](t, f.request(t, http.MethodGet, f.path(fmt.Sprintf("test-runs/%d/detail", run.ID)), nil), http.StatusOK)
		if detail.Run.ID != run.ID || len(detail.TestCases) != 1 || detail.TestCases[0].ID != caseID {
			t.Fatalf("detail=%+v", detail)
		}
	})
}
func TestV2TestRunExecution_SessionAndBearerContract(t *testing.T) {
	runManagementCase(t, func(t *testing.T, f *managementFixture) {
		caseID, planID := f.seed(t)
		run := f.create(t, "test-runs", map[string]any{"name": "<script>bad()</script>Parity run", "plan_id": planID})
		if run.Name != "Parity run" || run.PlanID != planID {
			t.Fatalf("run=%+v", run)
		}
		results := f.results(t, run.ID)
		if len(results) != 1 || results[0].ID <= 0 || results[0].TestCaseID != caseID {
			t.Fatalf("results=%+v", results)
		}
		path := f.path(fmt.Sprintf("test-runs/%d/results/%d", run.ID, results[0].ID))
		DecodeV2Document[managementRecord](t, f.request(t, http.MethodPatch, path, map[string]any{"status": "failed", "actual_result": "cookie<script>bad()</script><br/>result", "notes": "<img src=x onerror=alert(1)>cookie note"}), http.StatusOK)
		f.bearer = !f.bearer // Verify persistence across mounts, in both directions.
		after := f.results(t, run.ID)
		if len(after) != 1 || after[0].Status != "failed" || strings.Contains(after[0].ActualResult, "<script>") || !strings.Contains(after[0].ActualResult, "<br />") || strings.Contains(strings.ToLower(after[0].Notes), "onerror") {
			t.Fatalf("sanitized result=%+v", after)
		}
		assertCommentStatus(t, f.request(t, http.MethodPatch, path, map[string]any{"status": "invented"}), http.StatusBadRequest)
		retained := f.results(t, run.ID)
		if len(retained) != 1 || retained[0] != after[0] {
			t.Fatalf("invalid patch persisted: before=%+v after=%+v", after, retained)
		}
		DecodeV2Document[managementRecord](t, f.request(t, http.MethodPatch, path, map[string]any{"status": "passed", "actual_result": "bearer result", "notes": "bearer note"}), http.StatusOK)
		f.bearer = !f.bearer
		stored := f.results(t, run.ID)
		if len(stored) != 1 || stored[0].Status != "passed" || stored[0].ActualResult != "bearer result" || stored[0].Notes != "bearer note" {
			t.Fatalf("stored=%+v", stored)
		}
	})
}
func TestV2TestCatalog_SessionAndBearerContract(t *testing.T) {
	runManagementCase(t, func(t *testing.T, f *managementFixture) {
		caseID, _ := f.seed(t)
		foreign := *f
		foreign.workspace = f.workspaceNamed(t, "Foreign catalog", "FOREIGN")
		foreignCase, foreignPlan := foreign.seed(t)
		plan := f.create(t, "test-plans", map[string]any{"name": "<script>bad()</script>Shared plan", "description": "before<script>bad()</script>after"})
		if plan.Name != "Shared plan" || strings.Contains(plan.Description, "<script>") {
			t.Fatalf("plan=%+v", plan)
		}
		f.bearer = !f.bearer
		DecodeV2Document[managementRecord](t, f.request(t, http.MethodPatch, f.path(fmt.Sprintf("test-plans/%d", plan.ID)), map[string]any{"name": "<script>bad()</script>Updated plan", "description": "updated<script>bad()</script>description"}), http.StatusOK)
		f.bearer = !f.bearer
		stored := DecodeV2Document[managementRecord](t, f.request(t, http.MethodGet, f.path(fmt.Sprintf("test-plans/%d", plan.ID)), nil), http.StatusOK)
		if stored.Name != "Updated plan" || strings.Contains(stored.Description, "<script>") {
			t.Fatalf("stored=%+v", stored)
		}
		linkPath := f.path(fmt.Sprintf("test-plans/%d/test-cases", plan.ID))
		for i := 0; i < 2; i++ {
			assertCommentStatus(t, f.request(t, http.MethodPost, linkPath, map[string]any{"test_case_id": foreignCase}), http.StatusNotFound)
			f.bearer = !f.bearer
		}
		links := DecodeV2Document[[]managementRecord](t, f.request(t, http.MethodGet, linkPath, nil), http.StatusOK)
		if len(links) != 0 {
			t.Fatalf("foreign attachment persisted: %+v", links)
		}
		f.attach(t, plan.ID, caseID)
		template := f.create(t, "test-run-templates", map[string]any{"plan_id": plan.ID, "name": "<script>bad()</script>Shared template", "description": "before<script>bad()</script><br/>after"})
		if template.Name != "Shared template" || strings.Contains(template.Description, "<script>") || !strings.Contains(template.Description, "<br />") {
			t.Fatalf("template=%+v", template)
		}
		for i := 0; i < 2; i++ {
			assertCommentStatus(t, f.request(t, http.MethodPost, f.path("test-run-templates"), map[string]any{"plan_id": foreignPlan, "name": "Foreign template"}), http.StatusNotFound)
			f.bearer = !f.bearer
		}
		templates, page := DecodeV2Page[managementRecord](t, f.request(t, http.MethodGet, f.path("test-run-templates"), nil))
		if len(templates) != 1 || templates[0].ID != template.ID || page.TotalItems != 1 {
			t.Fatalf("foreign template persisted: %+v %+v", templates, page)
		}
		f.bearer = !f.bearer
		run := DecodeV2Document[managementRecord](t, f.request(t, http.MethodPost, f.path(fmt.Sprintf("test-run-templates/%d/execute", template.ID)), nil), http.StatusCreated)
		if run.Name != "Shared template - Run 1" || run.PlanID != plan.ID {
			t.Fatalf("execution=%+v", run)
		}
		f.bearer = !f.bearer
		results := f.results(t, run.ID)
		if len(results) != 1 || results[0].Status != "not_run" || results[0].TestCaseID != caseID {
			t.Fatalf("results=%+v", results)
		}
	})
}
func TestV2TestManagementRoutesMirrorSessionSurface(t *testing.T) {
	routes := EnumerateRegisteredRoutes(t)
	count := 0
	expectedRoutes := map[string]bool{}
	for _, route := range v2.Inventory() {
		if !strings.Contains(route.Path, "/test-") {
			continue
		}
		count++
		for _, prefix := range []string{"/api/v2", "/rest/api/v2"} {
			expectedRoutes[route.Method+" "+prefix+route.Path] = true
		}
		if route.Exposure != v2.ExposureBoth || !containsRoute(routes, route.Method, "/api/v2"+route.Path) || !containsRoute(routes, route.Method, "/rest/api/v2"+route.Path) {
			t.Errorf("test management route not available on both mounts: %+v", route)
		}
	}
	if count == 0 {
		t.Fatal("no test management routes found")
	}
	for _, route := range routes {
		if (strings.HasPrefix(route.Path, "/api/v2/") || strings.HasPrefix(route.Path, "/rest/api/v2/")) && strings.Contains(route.Path, "/test-") && !expectedRoutes[route.Method+" "+route.Path] {
			t.Errorf("registered test management route missing from v2 inventory: %+v", route)
		}
	}
	for _, expected := range []struct{ method, path string }{
		{http.MethodGet, "/workspaces/{workspace_id}/test-cases"},
		{http.MethodPost, "/workspaces/{workspace_id}/test-plans"},
		{http.MethodGet, "/workspaces/{workspace_id}/test-runs/{run_id}/detail"},
		{http.MethodPatch, "/workspaces/{workspace_id}/test-runs/{run_id}/results/{result_id}"},
		{http.MethodPost, "/workspaces/{workspace_id}/test-run-templates/{template_id}/execute"},
	} {
		for _, prefix := range []string{"/api/v2", "/rest/api/v2"} {
			if !containsRoute(routes, expected.method, prefix+expected.path) {
				t.Errorf("missing %s %s%s", expected.method, prefix, expected.path)
			}
		}
	}
}

func TestV2TestManagement_EditorReadsButCannotMutate(t *testing.T) {
	runManagementCase(t, func(t *testing.T, f *managementFixture) {
		caseID, planID := f.seed(t)
		template := f.create(t, "test-run-templates", map[string]any{"plan_id": planID, "name": "Template"})
		run := f.create(t, "test-runs", map[string]any{"plan_id": planID, "name": "Run"})
		before := f.results(t, run.ID)
		if len(before) != 1 {
			t.Fatalf("results=%+v", before)
		}
		id, username, password := CreateTestUserWithCredentials(t, f.server, "management-reader", "management-reader@example.test")
		// Editor has test.view; test.manage/test.execute belong to Tester and Administrator.
		AssignWorkspaceRole(t, f.server, id, f.workspace, "Editor")
		cookie, token := CreateAuthCredentialsForUser(t, f.server, username, password)
		actor := *f.server
		actor.SessionCookie, actor.BearerToken = cookie, token
		reader := *f
		reader.server = &actor
		for _, resource := range []string{fmt.Sprintf("test-cases/%d", caseID), fmt.Sprintf("test-plans/%d", planID), fmt.Sprintf("test-run-templates/%d", template.ID), fmt.Sprintf("test-runs/%d", run.ID)} {
			visible := DecodeV2Document[managementRecord](t, reader.request(t, http.MethodGet, reader.path(resource), nil), http.StatusOK)
			if visible.ID <= 0 {
				t.Fatalf("unreadable resource: %+v", visible)
			}
			assertCommentStatus(t, reader.request(t, http.MethodDelete, reader.path(resource), nil), http.StatusNotFound)
			retained := DecodeV2Document[managementRecord](t, f.request(t, http.MethodGet, f.path(resource), nil), http.StatusOK)
			if retained != visible {
				t.Fatalf("denied delete changed resource: %+v -> %+v", visible, retained)
			}
		}
		assertCommentStatus(t, reader.request(t, http.MethodPatch, reader.path(fmt.Sprintf("test-runs/%d/results/%d", run.ID, before[0].ID)), map[string]any{"status": "passed"}), http.StatusNotFound)
		after := f.results(t, run.ID)
		if len(after) != 1 || after[0] != before[0] {
			t.Fatalf("denied execution persisted: %+v -> %+v", before, after)
		}
		assertCommentStatus(t, reader.request(t, http.MethodPost, reader.path(fmt.Sprintf("test-run-templates/%d/execute", template.ID)), nil), http.StatusNotFound)
		runs, page := DecodeV2Page[managementRecord](t, f.request(t, http.MethodGet, f.path("test-runs"), nil))
		if len(runs) != 1 || runs[0].ID != run.ID || page.TotalItems != 1 {
			t.Fatalf("denied template execution persisted: %+v %+v", runs, page)
		}
	})
}
