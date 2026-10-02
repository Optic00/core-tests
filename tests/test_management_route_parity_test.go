package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestV1TestManagementAggregateRoutes(t *testing.T) {
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)

	workspaceID, _ := CreateTestWorkspace(t, server, "V1 aggregate routes", shortKey("V1AR"))
	testCaseID := seedTestCase(t, server, workspaceID, "Aggregate route case")

	countResp := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-cases/count", workspaceID), nil)
	defer countResp.Body.Close()
	AssertStatusCode(t, countResp, http.StatusOK)
	var countResult map[string]interface{}
	DecodeJSON(t, countResp, &countResult)
	if got := intField(countResult, "count"); got != 1 {
		t.Fatalf("test-case count = %d, want 1", got)
	}

	setID := seedTestSet(t, server, workspaceID, "Aggregate route set")
	attachCaseToSet(t, server, workspaceID, setID, testCaseID)
	createRunResp := MakeAuthRequest(t, server, http.MethodPost,
		fmt.Sprintf("/workspaces/%d/test-runs", workspaceID), map[string]interface{}{
			"name":    "Aggregate route run",
			"plan_id": setID,
		})
	defer createRunResp.Body.Close()
	AssertStatusCode(t, createRunResp, http.StatusCreated)
	var run map[string]interface{}
	DecodeJSON(t, createRunResp, &run)
	runID := ExtractIDFromResponse(t, run)

	detailResp := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-runs/%d/detail", workspaceID, runID), nil)
	defer detailResp.Body.Close()
	AssertStatusCode(t, detailResp, http.StatusOK)
	var detail struct {
		Run       map[string]interface{}   `json:"run"`
		TestCases []map[string]interface{} `json:"test_cases"`
	}
	DecodeJSON(t, detailResp, &detail)
	if got := intField(detail.Run, "id"); got != runID {
		t.Fatalf("detail run id = %d, want %d", got, runID)
	}
	if len(detail.TestCases) != 1 || intField(detail.TestCases[0], "id") != testCaseID {
		t.Fatalf("detail test cases = %v, want case %d", detail.TestCases, testCaseID)
	}
}

func TestTestRunExecution_CookieAndRESTV1Contract(t *testing.T) {
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Execution parity", shortKey("EXP"))
	testCaseID := seedTestCase(t, server, workspaceID, "Execution parity case")
	setID := seedTestSet(t, server, workspaceID, "Execution parity set")
	attachCaseToSet(t, server, workspaceID, setID, testCaseID)

	createResponse := MakeAuthRequest(t, server, http.MethodPost,
		fmt.Sprintf("/workspaces/%d/test-runs", workspaceID),
		map[string]interface{}{"name": "<script>bad()</script>Parity run", "plan_id": setID})
	defer createResponse.Body.Close()
	AssertStatusCode(t, createResponse, http.StatusCreated)
	var run map[string]interface{}
	DecodeJSON(t, createResponse, &run)
	runID := ExtractIDFromResponse(t, run)
	if name, _ := run["name"].(string); name != "Parity run" {
		t.Fatalf("shared create sanitizer produced name %q, want Parity run", name)
	}

	resultsResponse := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/workspaces/%d/test-runs/%d/results", workspaceID, runID), nil)
	defer resultsResponse.Body.Close()
	AssertStatusCode(t, resultsResponse, http.StatusOK)
	var results []map[string]interface{}
	DecodeJSON(t, resultsResponse, &results)
	if len(results) != 1 {
		t.Fatalf("run results = %v, want one result", results)
	}
	resultID := intField(results[0], "id")

	cookieUpdate := MakeAuthRequest(t, server, http.MethodPut,
		fmt.Sprintf("/workspaces/%d/test-runs/%d/results/%d", workspaceID, runID, resultID),
		map[string]interface{}{
			"status": "failed", "actual_result": "cookie<script>bad()</script><br/>result",
			"notes": "<img src=x onerror=alert(1)>cookie note",
		})
	defer cookieUpdate.Body.Close()
	AssertStatusCode(t, cookieUpdate, http.StatusOK)

	v1Read := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-runs/%d/results", workspaceID, runID), nil)
	defer v1Read.Body.Close()
	AssertStatusCode(t, v1Read, http.StatusOK)
	var afterCookie []map[string]interface{}
	DecodeJSON(t, v1Read, &afterCookie)
	if len(afterCookie) != 1 || afterCookie[0]["status"] != "failed" {
		t.Fatalf("v1 read after cookie update = %v", afterCookie)
	}
	actual, _ := afterCookie[0]["actual_result"].(string)
	notes, _ := afterCookie[0]["notes"].(string)
	if strings.Contains(actual, "<script>") || !strings.Contains(actual, "<br />") || strings.Contains(strings.ToLower(notes), "onerror") {
		t.Fatalf("cookie mutation did not use shared rich-text sanitizer: actual=%q notes=%q", actual, notes)
	}

	invalidV1Update := MakeBearerRequest(t, server, http.MethodPut,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-runs/%d/results/%d", workspaceID, runID, resultID),
		map[string]interface{}{"status": "invented"})
	defer invalidV1Update.Body.Close()
	AssertStatusCode(t, invalidV1Update, http.StatusBadRequest)

	v1Update := MakeBearerRequest(t, server, http.MethodPut,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-runs/%d/results/%d", workspaceID, runID, resultID),
		map[string]interface{}{"status": "passed", "actual_result": "v1 result", "notes": "v1 note"})
	defer v1Update.Body.Close()
	AssertStatusCode(t, v1Update, http.StatusOK)

	cookieRead := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/workspaces/%d/test-runs/%d/results", workspaceID, runID), nil)
	defer cookieRead.Body.Close()
	AssertStatusCode(t, cookieRead, http.StatusOK)
	var afterV1 []map[string]interface{}
	DecodeJSON(t, cookieRead, &afterV1)
	if len(afterV1) != 1 || afterV1[0]["status"] != "passed" || afterV1[0]["actual_result"] != "v1 result" || afterV1[0]["notes"] != "v1 note" {
		t.Fatalf("cookie read after v1 update = %v", afterV1)
	}
}

func TestTestCatalog_CookieAndRESTV1Contract(t *testing.T) {
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Catalog parity", shortKey("CAT"))
	foreignWorkspaceID, _ := CreateTestWorkspace(t, server, "Foreign catalog", shortKey("FCAT"))
	testCaseID := seedTestCase(t, server, workspaceID, "Catalog case")
	foreignCaseID := seedTestCase(t, server, foreignWorkspaceID, "Foreign catalog case")
	foreignSetID := seedTestSet(t, server, foreignWorkspaceID, "Foreign catalog set")

	createSetResponse := MakeAuthRequest(t, server, http.MethodPost,
		fmt.Sprintf("/workspaces/%d/test-plans", workspaceID), map[string]interface{}{
			"name":        "<script>bad()</script>Shared set",
			"description": "before<script>bad()</script>after",
		})
	defer createSetResponse.Body.Close()
	AssertStatusCode(t, createSetResponse, http.StatusCreated)
	var createdSet map[string]interface{}
	DecodeJSON(t, createSetResponse, &createdSet)
	setID := ExtractIDFromResponse(t, createdSet)
	if createdSet["name"] != "Shared set" || strings.Contains(createdSet["description"].(string), "<script>") {
		t.Fatalf("cookie set create was not normalized: %v", createdSet)
	}

	updateSetResponse := MakeBearerRequest(t, server, http.MethodPut,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-sets/%d", workspaceID, setID), map[string]interface{}{
			"name":        "<script>bad()</script>Updated set",
			"description": "updated<script>bad()</script>description",
		})
	defer updateSetResponse.Body.Close()
	AssertStatusCode(t, updateSetResponse, http.StatusOK)

	cookieSetResponse := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/workspaces/%d/test-plans/%d", workspaceID, setID), nil)
	defer cookieSetResponse.Body.Close()
	AssertStatusCode(t, cookieSetResponse, http.StatusOK)
	var updatedSet map[string]interface{}
	DecodeJSON(t, cookieSetResponse, &updatedSet)
	if updatedSet["name"] != "Updated set" || strings.Contains(updatedSet["description"].(string), "<script>") {
		t.Fatalf("cookie set read after v1 update = %v", updatedSet)
	}

	for _, request := range map[string]func() *http.Response{
		"cookie": func() *http.Response {
			return MakeAuthRequest(t, server, http.MethodPost,
				fmt.Sprintf("/workspaces/%d/test-plans/%d/test-cases", workspaceID, setID),
				map[string]interface{}{"test_case_id": foreignCaseID})
		},
		"v1": func() *http.Response {
			return MakeBearerRequest(t, server, http.MethodPost,
				fmt.Sprintf("/rest/api/v1/workspaces/%d/test-sets/%d/test-cases", workspaceID, setID),
				map[string]interface{}{"test_case_id": foreignCaseID})
		},
	} {
		response := request()
		AssertStatusCode(t, response, http.StatusNotFound)
		response.Body.Close()
	}

	attachCaseToSet(t, server, workspaceID, setID, testCaseID)

	createTemplateResponse := MakeAuthRequest(t, server, http.MethodPost,
		fmt.Sprintf("/workspaces/%d/test-run-templates", workspaceID), map[string]interface{}{
			"plan_id":     setID,
			"name":        "<script>bad()</script>Shared template",
			"description": "before<script>bad()</script><br/>after",
		})
	defer createTemplateResponse.Body.Close()
	AssertStatusCode(t, createTemplateResponse, http.StatusCreated)
	var template map[string]interface{}
	DecodeJSON(t, createTemplateResponse, &template)
	templateID := ExtractIDFromResponse(t, template)
	if template["name"] != "Shared template" || strings.Contains(template["description"].(string), "<script>") || !strings.Contains(template["description"].(string), "<br />") {
		t.Fatalf("cookie template create was not normalized: %v", template)
	}

	for _, request := range []func() *http.Response{
		func() *http.Response {
			return MakeAuthRequest(t, server, http.MethodPost,
				fmt.Sprintf("/workspaces/%d/test-run-templates", workspaceID),
				map[string]interface{}{"plan_id": foreignSetID, "name": "Foreign template"})
		},
		func() *http.Response {
			return MakeBearerRequest(t, server, http.MethodPost,
				fmt.Sprintf("/rest/api/v1/workspaces/%d/test-run-templates", workspaceID),
				map[string]interface{}{"set_id": foreignSetID, "name": "Foreign template"})
		},
	} {
		response := request()
		AssertStatusCode(t, response, http.StatusNotFound)
		response.Body.Close()
	}

	executeResponse := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v1/workspaces/%d/test-run-templates/%d/execute", workspaceID, templateID), nil)
	defer executeResponse.Body.Close()
	AssertStatusCode(t, executeResponse, http.StatusCreated)
	var run map[string]interface{}
	DecodeJSON(t, executeResponse, &run)
	runID := ExtractIDFromResponse(t, run)
	if run["name"] != "Shared template - Run 1" {
		t.Fatalf("template execution name = %v", run["name"])
	}

	resultsResponse := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/workspaces/%d/test-runs/%d/results", workspaceID, runID), nil)
	defer resultsResponse.Body.Close()
	AssertStatusCode(t, resultsResponse, http.StatusOK)
	var results []map[string]interface{}
	DecodeJSON(t, resultsResponse, &results)
	if len(results) != 1 || results[0]["status"] != "not_run" {
		t.Fatalf("template execution results = %v, want one not_run result", results)
	}
}
