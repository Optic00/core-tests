package tests

// Black-box regression contract for the v2 convergence drift findings in
// WI-1283 (audit docs/reviews/v2-convergence-drift-audit-2026-09-07.md).
// Each test pins the exact payload the client sends today and asserts the
// v2 endpoint accepts it and persists the intended result.

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestV2ItemPatchStoryPointsEstimateInheritProject(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "V2 patch contract", shortKey("V2PC"))

	itemID := CreateTestItem(t, server, workspaceID, "Patch convergence item")

	// The item-detail project picker always sends project_id + inherit_project
	// together (itemDetailStore.svelte.js), and the backlog inline editors
	// send story_points / estimate_minutes (nullable to clear).
	patch := MakeBearerRequest(t, server, http.MethodPatch,
		fmt.Sprintf("/rest/api/v2/items/%d", itemID),
		map[string]any{
			"story_points":     3.5,
			"estimate_minutes": 90,
			"inherit_project":  true,
		})
	defer patch.Body.Close()
	AssertStatusCode(t, patch, http.StatusOK)

	got := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/items/%d", itemID), nil)
	defer got.Body.Close()
	AssertStatusCode(t, got, http.StatusOK)
	var document struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, got, &document)
	data := document.Data
	if sp, _ := data["story_points"].(float64); sp != 3.5 {
		t.Fatalf("story_points after patch = %v, want 3.5", data["story_points"])
	}
	if em, _ := data["estimate_minutes"].(float64); em != 90 {
		t.Fatalf("estimate_minutes after patch = %v, want 90", data["estimate_minutes"])
	}
	if inherit, _ := data["inherit_project"].(bool); !inherit {
		t.Fatalf("inherit_project after patch = %v, want true", data["inherit_project"])
	}

	// Explicit null clears story points (backlog "clear estimate" flow).
	clear := MakeBearerRequest(t, server, http.MethodPatch,
		fmt.Sprintf("/rest/api/v2/items/%d", itemID),
		map[string]any{"story_points": nil, "estimate_minutes": nil})
	defer clear.Body.Close()
	AssertStatusCode(t, clear, http.StatusOK)

	gotAgain := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/items/%d", itemID), nil)
	defer gotAgain.Body.Close()
	var after struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, gotAgain, &after)
	if after.Data["story_points"] != nil || after.Data["estimate_minutes"] != nil {
		t.Fatalf("cleared story_points/estimate_minutes = %v/%v, want null",
			after.Data["story_points"], after.Data["estimate_minutes"])
	}
}

func TestV2TestRunUnassignedFilter(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Run filter contract", shortKey("RFC"))

	setID := seedTestSet(t, server, workspaceID, "Run filter set")
	runID := seedTestRun(t, server, workspaceID, setID, "Unassigned run")

	// TestRuns.svelte sends unassigned=true instead of the legacy
	// assignee_id=unassigned sentinel, which v2 rejects.
	list := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-runs?unassigned=true", workspaceID), nil)
	defer list.Body.Close()
	AssertStatusCode(t, list, http.StatusOK)
	var page struct {
		Data []map[string]any `json:"data"`
	}
	DecodeJSON(t, list, &page)
	found := false
	for _, run := range page.Data {
		if intField(run, "id") == runID {
			found = true
		}
	}
	if !found {
		t.Fatalf("unassigned=true list = %v, want run %d included", page.Data, runID)
	}

	// Assigned runs stay filtered out of the unassigned list.
	viewerID, _, _ := CreateTestUserWithCredentials(t, server, "run_filter_viewer", "run_filter_viewer@test.com")
	AssignWorkspaceRole(t, server, viewerID, workspaceID, "Viewer")
	assignedID := seedTestRunWithAssignee(t, server, workspaceID, setID, "Assigned run", &viewerID)
	afterAssign := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-runs?unassigned=true", workspaceID), nil)
	defer afterAssign.Body.Close()
	var afterPage struct {
		Data []map[string]any `json:"data"`
	}
	DecodeJSON(t, afterAssign, &afterPage)
	for _, run := range afterPage.Data {
		if intField(run, "id") == assignedID {
			t.Fatalf("assigned run %d leaked into unassigned=true list", assignedID)
		}
	}
}

func TestV2TestFolderCreateAcceptsSortOrder(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Folder create contract", shortKey("FCC"))

	// TestCases.svelte sends parent_id, name, description and sort_order on
	// both create and update; create must accept the field (it is ignored and
	// replaced by max sort order + step, matching legacy).
	create := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-folders", workspaceID),
		map[string]any{"name": "Sort folder", "description": "d", "parent_id": nil, "sort_order": 0})
	defer create.Body.Close()
	AssertStatusCode(t, create, http.StatusCreated)
	var doc struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, create, &doc)
	folder := doc.Data
	folderID := intField(folder, "id")
	if folderID < 1 {
		t.Fatalf("created folder id = %d, want > 0", folderID)
	}

	// POST /test-folders/reorder persists folder-level sort manipulation, so
	// verify the create assigned a real server-side order rather than 0.
	list := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-folders", workspaceID), nil)
	defer list.Body.Close()
	AssertStatusCode(t, list, http.StatusOK)
	var listDoc struct {
		Data []map[string]any `json:"data"`
	}
	DecodeJSON(t, list, &listDoc)
	for _, item := range listDoc.Data {
		if intField(item, "id") == folderID && intField(item, "sort_order") <= 0 {
			t.Fatalf("created folder persisted sort_order = %d, want > 0", intField(item, "sort_order"))
		}
	}
}

func TestV2LinkTypeActivateToggleSendsActiveOnly(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)

	create := MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/link-types",
		map[string]any{
			"name":                 "Toggle link",
			"display_name":         "Toggle link",
			"forward_label":        "relates to",
			"reverse_label":        "is related from",
			"color":                "#123456",
			"allowed_entity_types": []string{"item", "test_case"},
		})
	defer create.Body.Close()
	AssertStatusCode(t, create, http.StatusCreated)
	var created struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, create, &created)
	linkTypeID := intField(created.Data, "id")
	if linkTypeID < 1 {
		t.Fatalf("created link type id = %d, want > 0", linkTypeID)
	}

	// LinkTypeManager.svelte toggles with the minimal {active} payload after
	// the DTO spread regressed to a 400.
	toggle := MakeBearerRequest(t, server, http.MethodPatch,
		fmt.Sprintf("/rest/api/v2/link-types/%d", linkTypeID),
		map[string]any{"active": false})
	defer toggle.Body.Close()
	AssertStatusCode(t, toggle, http.StatusOK)

	on := MakeBearerRequest(t, server, http.MethodPatch,
		fmt.Sprintf("/rest/api/v2/link-types/%d", linkTypeID),
		map[string]any{"active": true})
	defer on.Body.Close()
	AssertStatusCode(t, on, http.StatusOK)
	var onDoc struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, on, &onDoc)
	if active, _ := onDoc.Data["active"].(bool); !active {
		t.Fatalf("link type active after toggle-on = %v, want true", onDoc.Data["active"])
	}
}

func TestV2BoardConfigurationSaveRoundTripsColumns(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Board config contract", shortKey("BCC"))

	create := MakeAuthRequest(t, server, http.MethodPost, "/v2/collections",
		map[string]any{"name": "Board columns", "workspace_id": workspaceID})
	defer create.Body.Close()
	AssertStatusCode(t, create, http.StatusCreated)
	var created struct {
		Data struct {
			ID int `json:"id"`
		} `json:"data"`
	}
	DecodeJSON(t, create, &created)
	collectionID := created.Data.ID
	if collectionID < 1 {
		t.Fatalf("collection id = %d, want > 0", collectionID)
	}

	columns := []map[string]any{{
		"id": nil, "name": "To do", "display_order": 0,
		"wip_limit": 5, "color": "#94a3b8", "status_ids": []int{},
	}}
	put := MakeAuthRequest(t, server, http.MethodPut,
		fmt.Sprintf("/v2/collections/%d/board-configuration", collectionID),
		map[string]any{"columns": columns, "list_columns": []any{}, "card_fields": []any{}})
	defer put.Body.Close()
	AssertStatusCode(t, put, http.StatusOK)

	// Save again with the exact shape the UI builds from the fetched config
	// (buildListColumnConfiguration strips board_configuration_id,
	// created_at, updated_at). This is the payload that used to 400.
	fetched := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/v2/collections/%d/board-configuration", collectionID), nil)
	defer fetched.Body.Close()
	AssertStatusCode(t, fetched, http.StatusOK)
	var fetchedDoc struct {
		Data struct {
			Columns []map[string]any `json:"columns"`
		} `json:"data"`
	}
	DecodeJSON(t, fetched, &fetchedDoc)
	if len(fetchedDoc.Data.Columns) == 0 {
		t.Fatalf("board configuration has no columns after first save")
	}
	mapped := make([]map[string]any, 0, len(fetchedDoc.Data.Columns))
	for _, column := range fetchedDoc.Data.Columns {
		mapped = append(mapped, map[string]any{
			"id":            column["id"],
			"name":          column["name"],
			"display_order": column["display_order"],
			"wip_limit":     column["wip_limit"],
			"color":         column["color"],
			"status_ids":    column["status_ids"],
		})
	}
	resave := MakeAuthRequest(t, server, http.MethodPut,
		fmt.Sprintf("/v2/collections/%d/board-configuration", collectionID),
		map[string]any{"columns": mapped, "list_columns": []any{}, "card_fields": []any{}})
	defer resave.Body.Close()
	AssertStatusCode(t, resave, http.StatusOK)
}

func TestV2TaskCheckboxUsesTransitionNotStatusPatch(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)

	// Personal tasks live in the caller's workflow-less personal workspace.
	personalResp := MakeAuthRequest(t, server, http.MethodGet, "/workspaces/personal", nil)
	defer personalResp.Body.Close()
	// First access creates the personal workspace on demand (201 Created).
	if personalResp.StatusCode != http.StatusOK && personalResp.StatusCode != http.StatusCreated {
		t.Fatalf("GET /workspaces/personal = %d, want 200/201", personalResp.StatusCode)
	}
	var personalWorkspace map[string]any
	DecodeJSON(t, personalResp, &personalWorkspace)
	personalID := intField(personalWorkspace, "id")
	if personalID < 1 {
		t.Fatalf("personal workspace id = %d, want > 0", personalID)
	}

	create := MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/items",
		map[string]any{"title": "Toggle task", "workspace_id": personalID, "is_task": true})
	defer create.Body.Close()
	AssertStatusCode(t, create, http.StatusCreated)
	var created struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, create, &created)
	itemID := intField(created.Data, "id")

	// The legacy PATCH {status: "completed"} was a silent no-op; v2 rejects it.
	legacy := MakeBearerRequest(t, server, http.MethodPatch,
		fmt.Sprintf("/rest/api/v2/items/%d", itemID),
		map[string]any{"status": "completed"})
	defer legacy.Body.Close()
	AssertStatusCode(t, legacy, http.StatusBadRequest)

	// ListCellRenderer now toggles through the transition endpoint with the
	// globally stable Open/Done personal-task statuses.
	done := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/items/%d/transition", itemID),
		map[string]any{"to_status_id": 3})
	defer done.Body.Close()
	AssertStatusCode(t, done, http.StatusOK)
	back := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/items/%d/transition", itemID),
		map[string]any{"to_status_id": 1})
	defer back.Body.Close()
	AssertStatusCode(t, back, http.StatusOK)
	var backDoc struct {
		Data struct {
			Item map[string]any `json:"item"`
		} `json:"data"`
	}
	DecodeJSON(t, back, &backDoc)
	if statusID := intField(backDoc.Data.Item, "status_id"); statusID != 1 {
		t.Fatalf("status after open transition = %d, want 1", statusID)
	}
}

func TestV2WorklogListTeamScopeCustomerFilterAndOrdering(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	projectID := createTimeProjectFixture(t, server, "Team worklogs")
	workspaceID, _ := CreateTestWorkspace(t, server, "Team worklogs ws", shortKey("TWW"))
	itemID := CreateTestItem(t, server, workspaceID, "Team worklog item")

	// A colleague books worklogs on the same project; the main user books two
	// more sharing the same date and start time to exercise the tie-breakers.
	colleagueID, colleagueName, colleaguePassword := CreateTestUserWithCredentials(t, server, "team_worklog_colleague", "team_worklog_colleague@test.com")
	AssignWorkspaceRole(t, server, colleagueID, workspaceID, "Viewer")
	colleagueToken := CreateBearerTokenForUser(t, server, colleagueName, colleaguePassword)

	createWorklog := func(token, description, startTime, endTime string, colleague bool) int {
		t.Helper()
		payload := map[string]any{
			"project_id": projectID, "item_id": itemID, "description": description,
			"date": "2026-09-05",
		}
		if startTime != "" {
			payload["start_time"] = startTime
			payload["end_time"] = endTime
		} else {
			payload["duration_minutes"] = 30
		}
		var resp *http.Response
		if colleague {
			resp = MakeAuthRequestWithToken(t, server, token, http.MethodPost, "/v2/time/worklogs", payload)
		} else {
			resp = MakeBearerRequestWithToken(t, server, token, http.MethodPost, "/rest/api/v2/time/worklogs", payload)
		}
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusCreated)
		var doc struct {
			Data map[string]any `json:"data"`
		}
		DecodeJSON(t, resp, &doc)
		return intField(doc.Data, "id")
	}
	firstID := createWorklog(colleagueToken, "colleague entry", "", "", true)
	secondID := createWorklog(server.BearerToken, "main entry early", "09:30", "10:00", false)
	thirdID := createWorklog(server.BearerToken, "main entry late", "10:00", "10:30", false)

	// Timesheet row: the caller sees colleagues' entries on accessible
	// projects (legacy team-wide scope), not only their own.
	list := MakeBearerRequest(t, server, http.MethodGet,
		"/rest/api/v2/time/worklogs?from=2026-09-01&to=2026-09-30&page_size=50", nil)
	defer list.Body.Close()
	AssertStatusCode(t, list, http.StatusOK)
	var page struct {
		Data []struct {
			ID          int    `json:"id"`
			Description string `json:"description"`
			StartTime   int64  `json:"start_time"`
		} `json:"data"`
	}
	DecodeJSON(t, list, &page)
	seen := map[string]bool{}
	for _, row := range page.Data {
		seen[row.Description] = true
	}
	if !seen["colleague entry"] || !seen["main entry early"] || !seen["main entry late"] {
		t.Fatalf("team-scoped worklog list = %v, want all three descriptions", page.Data)
	}
	// Same date: newest start time first, then higher id (created later).
	if len(page.Data) >= 3 && (page.Data[0].ID != thirdID || page.Data[1].ID != secondID || page.Data[2].ID != firstID) {
		t.Fatalf("worklog ordering = %+v, want date DESC, start_time DESC, id DESC", page.Data)
	}

	// Page-walk stability: page_size=1 yields each row exactly once.
	walked := map[int]bool{}
	pageNumber := 1
	for {
		resp := MakeBearerRequest(t, server, http.MethodGet,
			fmt.Sprintf("/rest/api/v2/time/worklogs?from=2026-09-01&to=2026-09-30&page_size=1&page=%d", pageNumber), nil)
		AssertStatusCode(t, resp, http.StatusOK)
		var walkedPage struct {
			Data []struct {
				ID int `json:"id"`
			} `json:"data"`
			Pagination struct {
				TotalPages int `json:"total_pages"`
			} `json:"pagination"`
		}
		DecodeJSON(t, resp, &walkedPage)
		resp.Body.Close()
		if len(walkedPage.Data) == 0 {
			break
		}
		id := walkedPage.Data[0].ID
		if walked[id] {
			t.Fatalf("page-walk returned duplicate worklog %d on page %d", id, pageNumber)
		}
		walked[id] = true
		if pageNumber >= walkedPage.Pagination.TotalPages || pageNumber > 10 {
			break
		}
		pageNumber++
	}
	for _, id := range []int{firstID, secondID, thirdID} {
		if !walked[id] {
			t.Fatalf("page-walk missing worklog %d", id)
		}
	}

	// Customer dropdown filter must actually restrict results.
	customerA := worklogCustomerID(t, server, firstID)
	otherCustomerID := seedCustomerOrganisation(t, server, "Other team")
	otherProjectID := seedTimeProject(t, server, otherCustomerID, "Other team project")
	otherItemID := CreateTestItem(t, server, workspaceID, "Other customer item")
	otherWorklogResp := MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/time/worklogs",
		map[string]any{
			"project_id": otherProjectID, "item_id": otherItemID, "description": "other customer entry",
			"date": "2026-09-06", "duration_minutes": 15, "start_time": "09:00",
		})
	defer otherWorklogResp.Body.Close()
	AssertStatusCode(t, otherWorklogResp, http.StatusCreated)

	filtered := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/time/worklogs?customer_id=%d&page_size=50", customerA), nil)
	defer filtered.Body.Close()
	AssertStatusCode(t, filtered, http.StatusOK)
	var filteredPage struct {
		Data []struct {
			Description string `json:"description"`
		} `json:"data"`
	}
	DecodeJSON(t, filtered, &filteredPage)
	for _, row := range filteredPage.Data {
		if row.Description == "other customer entry" {
			t.Fatalf("customer_id filter leaked other customer's worklog: %+v", filteredPage.Data)
		}
	}
}

// worklogCustomerID reads the customer_id of a created worklog.
func worklogCustomerID(t *testing.T, ts *TestServer, worklogID int) int {
	t.Helper()
	resp := MakeBearerRequest(t, ts, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/time/worklogs/%d", worklogID), nil)
	defer resp.Body.Close()
	AssertStatusCode(t, resp, http.StatusOK)
	var doc struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, resp, &doc)
	return intField(doc.Data, "customer_id")
}

func seedCustomerOrganisation(t *testing.T, ts *TestServer, name string) int {
	t.Helper()
	resp := MakeAuthRequest(t, ts, http.MethodPost, "/customer-organisations", map[string]any{"name": name})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create customer: %d", resp.StatusCode)
	}
	var out map[string]any
	DecodeJSON(t, resp, &out)
	return ExtractIDFromResponse(t, out)
}

func seedTimeProject(t *testing.T, ts *TestServer, customerID int, name string) int {
	t.Helper()
	resp := MakeAuthRequest(t, ts, http.MethodPost, "/time/projects",
		map[string]any{"name": name, "status": "Active", "customer_id": customerID})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create time project: %d", resp.StatusCode)
	}
	var out map[string]any
	DecodeJSON(t, resp, &out)
	return ExtractIDFromResponse(t, out)
}

func TestV2LinksBatchIncludesTestCaseLinks(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Batch links", shortKey("BTL"))
	itemID := CreateTestItem(t, server, workspaceID, "Batch anchor")
	testCaseID := seedTestCase(t, server, workspaceID, "Batch case")

	testsLinkTypeID := linkTypeIDByBuiltinKey(t, server, "tests")
	link := MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/links", map[string]any{
		"source_type": "item", "source_id": itemID,
		"target_type": "test_case", "target_id": testCaseID,
		"link_type_id": testsLinkTypeID,
	})
	defer link.Body.Close()
	AssertStatusCode(t, link, http.StatusCreated)

	batch := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/links/batch?ids=%d", itemID), nil)
	defer batch.Body.Close()
	AssertStatusCode(t, batch, http.StatusOK)
	var doc struct {
		Data []struct {
			ItemID   int `json:"item_id"`
			Outgoing []struct {
				TargetType string `json:"target_type"`
				TargetID   int    `json:"target_id"`
			} `json:"outgoing"`
		} `json:"data"`
	}
	DecodeJSON(t, batch, &doc)
	if len(doc.Data) != 1 {
		t.Fatalf("batch link page = %+v, want one anchor", doc.Data)
	}
	found := false
	for _, link := range doc.Data[0].Outgoing {
		if link.TargetType == "test_case" && link.TargetID == testCaseID {
			found = true
		}
	}
	if !found {
		t.Fatalf("batch links = %+v, want item->test_case link to %d", doc.Data, testCaseID)
	}
}

func TestV2LinksBatchAcceptsMoreThanOneHundredAnchors(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Batch cap", shortKey("BPC"))

	const anchorCount = 105 // frontend chunks at 200 and the cap must clear it
	itemIDs := make([]int, 0, anchorCount)
	for i := 0; i < anchorCount; i++ {
		itemIDs = append(itemIDs, CreateTestItem(t, server, workspaceID, fmt.Sprintf("Batch item %d", i)))
	}

	batch := MakeBearerRequest(t, server, http.MethodGet,
		"/rest/api/v2/links/batch?ids="+joinInts(itemIDs), nil)
	defer batch.Body.Close()
	AssertStatusCode(t, batch, http.StatusOK)
	var doc struct {
		Data []map[string]any `json:"data"`
	}
	DecodeJSON(t, batch, &doc)
	if len(doc.Data) != anchorCount {
		t.Fatalf("batch anchors returned = %d, want %d", len(doc.Data), anchorCount)
	}
	seen := map[int]bool{}
	for _, group := range doc.Data {
		seen[intField(group, "item_id")] = true
	}
	for _, id := range itemIDs {
		if !seen[id] {
			t.Fatalf("batch result missing anchor %d", id)
		}
	}
}

func TestV2LinksBatchPerItemCapNoLongerTruncates(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Batch per item", shortKey("BPI"))
	anchorID := CreateTestItem(t, server, workspaceID, "Heavily linked anchor")

	relatesTypeID := linkTypeIDByBuiltinKey(t, server, "relates_to")
	targetIDs := make([]int, 0, 55)
	for i := 0; i < 55; i++ {
		targetID := CreateTestItem(t, server, workspaceID, fmt.Sprintf("Link target %d", i))
		targetIDs = append(targetIDs, targetID)
		link := MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/links", map[string]any{
			"source_type": "item", "source_id": anchorID,
			"target_type": "item", "target_id": targetID,
			"link_type_id": relatesTypeID,
		})
		defer link.Body.Close()
		AssertStatusCode(t, link, http.StatusCreated)
	}

	batch := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/links/batch?ids=%d", anchorID), nil)
	defer batch.Body.Close()
	AssertStatusCode(t, batch, http.StatusOK)
	var doc struct {
		Data []struct {
			Outgoing     []map[string]any `json:"outgoing"`
			HasMoreLinks bool             `json:"has_more_links"`
		} `json:"data"`
	}
	DecodeJSON(t, batch, &doc)
	if len(doc.Data) != 1 {
		t.Fatalf("batch page = %+v, want one anchor", doc.Data)
	}
	if len(doc.Data[0].Outgoing) != len(targetIDs) {
		t.Fatalf("anchor outgoing links = %d, want %d (no silent truncation)", len(doc.Data[0].Outgoing), len(targetIDs))
	}
	if doc.Data[0].HasMoreLinks {
		t.Fatalf("anchor has_more_links = true with %d links, want false", len(doc.Data[0].Outgoing))
	}
}

func TestV2TestRunsIncludeEndedByDefault(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Ended runs", shortKey("ENDR"))
	setID := seedTestSet(t, server, workspaceID, "Ended run set")
	runID := seedTestRun(t, server, workspaceID, setID, "End soon")

	end := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-runs/%d/end", workspaceID, runID), nil)
	defer end.Body.Close()
	AssertStatusCode(t, end, http.StatusOK)

	// TestRuns.svelte never sends include_ended, and completed runs must stay
	// visible instead of looking deleted.
	list := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-runs", workspaceID), nil)
	defer list.Body.Close()
	AssertStatusCode(t, list, http.StatusOK)
	var doc struct {
		Data []map[string]any `json:"data"`
	}
	DecodeJSON(t, list, &doc)
	found := false
	for _, run := range doc.Data {
		if intField(run, "id") == runID {
			found = true
		}
	}
	if !found {
		t.Fatalf("default test-run list = %+v, want ended run %d included", doc.Data, runID)
	}
}

func linkTypeIDByBuiltinKey(t *testing.T, ts *TestServer, builtinKey string) int {
	t.Helper()
	resp := MakeBearerRequest(t, ts, http.MethodGet, "/rest/api/v2/link-types?include_inactive=true", nil)
	defer resp.Body.Close()
	AssertStatusCode(t, resp, http.StatusOK)
	var doc struct {
		Data []struct {
			ID         int    `json:"id"`
			BuiltinKey string `json:"builtin_key"`
		} `json:"data"`
	}
	DecodeJSON(t, resp, &doc)
	for _, linkType := range doc.Data {
		if linkType.BuiltinKey == builtinKey {
			return linkType.ID
		}
	}
	t.Fatalf("no link type with builtin_key %q in %+v", builtinKey, doc.Data)
	return 0
}

func joinInts(values []int) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprintf("%d", value))
	}
	return strings.Join(parts, ",")
}

func TestV2AssetUserCustomFieldStoredAsBareID(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	setID, assetTypeID := seedAssetSetAndType(t, server, "user-field")
	userFieldID := addRequiredFieldToType(t, server, assetTypeID, "Assignee", "user")

	// The UI's UserPicker sends {id, name}; the write path must persist the
	// bare user id so CQL user-field filters keep matching.
	targetUserID, _, _ := CreateTestUserWithCredentials(t, server, "asset_user_field", "asset_user_field@test.com")
	created := MakeAuthRequest(t, server, http.MethodPost,
		fmt.Sprintf("/v2/asset-sets/%d/assets", setID), map[string]any{
			"title": "User field laptop", "asset_type_id": assetTypeID,
			"custom_field_values": map[string]any{
				fmt.Sprintf("%d", userFieldID): map[string]any{"id": targetUserID, "name": "Asset User Field"},
			},
		})
	defer created.Body.Close()
	AssertStatusCode(t, created, http.StatusCreated)
	created.Body.Close()

	got := MakeAuthRequest(t, server, http.MethodGet,
		fmt.Sprintf("/v2/asset-sets/%d/assets", setID), nil)
	defer got.Body.Close()
	AssertStatusCode(t, got, http.StatusOK)
	var list struct {
		Data []map[string]any `json:"data"`
	}
	DecodeJSON(t, got, &list)
	if len(list.Data) != 1 {
		t.Fatalf("asset list = %v, want one asset", list.Data)
	}
	values, _ := list.Data[0]["custom_field_values"].(map[string]any)
	stored, ok := values[fmt.Sprintf("%d", userFieldID)]
	if !ok {
		t.Fatalf("custom_field_values = %v, want key %d", values, userFieldID)
	}
	if number, isNumber := stored.(float64); !isNumber || int(number) != targetUserID {
		t.Fatalf("stored user-field value = %#v, want bare id %d", stored, targetUserID)
	}
}

func TestV2TestFolderAndLabelSanitization(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Sanitize toys", shortKey("SAT"))

	// Empty folder name is rejected after sanitization.
	emptyFolder := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-folders", workspaceID),
		map[string]any{"name": "   ", "description": "d"})
	defer emptyFolder.Body.Close()
	AssertStatusCode(t, emptyFolder, http.StatusBadRequest)

	// HTML is stripped from folder names and descriptions.
	cleanFolder := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-folders", workspaceID),
		map[string]any{"name": "<script>alert(1)</script>Folder", "description": "<b>bold</b> folder"})
	defer cleanFolder.Body.Close()
	AssertStatusCode(t, cleanFolder, http.StatusCreated)
	var folderDoc struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, cleanFolder, &folderDoc)
	if name, _ := folderDoc.Data["name"].(string); strings.Contains(name, "<script>") {
		t.Fatalf("folder name unsanitized: %q", name)
	}
	if desc, _ := folderDoc.Data["description"].(string); strings.Contains(desc, "<b>") {
		t.Fatalf("folder description unsanitized: %q", desc)
	}

	// Label names require a non-empty value and are short-identifier sanitized.
	emptyLabel := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-labels", workspaceID),
		map[string]any{"name": "", "color": "#112233", "description": "d"})
	defer emptyLabel.Body.Close()
	AssertStatusCode(t, emptyLabel, http.StatusBadRequest)

	cleanLabel := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-labels", workspaceID),
		map[string]any{"name": "<br>Smoke", "color": "#112233", "description": "<script>x</script>desc"})
	defer cleanLabel.Body.Close()
	// legacy cookie surface returned 201 for valid labels
	if cleanLabel.StatusCode != http.StatusCreated {
		AssertStatusCode(t, cleanLabel, http.StatusCreated)
	}
	var labelDoc struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, cleanLabel, &labelDoc)
	if name, _ := labelDoc.Data["name"].(string); strings.Contains(name, "<") {
		t.Fatalf("label name unsanitized: %q", name)
	}
	if desc, _ := labelDoc.Data["description"].(string); strings.Contains(desc, "<script>") {
		t.Fatalf("label description unsanitized: %q", desc)
	}
}

func TestV2PageHistoryRedactsRevisionAuthors(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "History privacy", shortKey("HPR"))

	viewerID, viewerName, viewerPassword := CreateTestUserWithCredentials(t, server, "history_viewer", "history_viewer@test.com")
	AssignWorkspaceRole(t, server, viewerID, workspaceID, "Viewer")
	viewerToken := createTokenWithScopesAsUser(t, server, viewerName, viewerPassword, []string{"pages:read", "pages:write"})

	createPage := MakeBearerRequest(t, server, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/pages", workspaceID),
		map[string]any{"title": "Private history", "content": "v1"})
	defer createPage.Body.Close()
	AssertStatusCode(t, createPage, http.StatusCreated)
	var created struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, createPage, &created)
	pageID := intField(created.Data, "id")

	revision := MakeBearerRequest(t, server, http.MethodPatch,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/pages/%d", workspaceID, pageID),
		map[string]any{"title": "Private history", "content": "v2"})
	defer revision.Body.Close()
	AssertStatusCode(t, revision, http.StatusOK)

	// A plain viewer sees revision content but not the author identities.
	viewerHistory := MakeBearerRequestWithToken(t, server, viewerToken, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/pages/%d/history", workspaceID, pageID), nil)
	defer viewerHistory.Body.Close()
	AssertStatusCode(t, viewerHistory, http.StatusOK)
	var viewerPage struct {
		Data []struct {
			RevisionNumber int                    `json:"revision_number"`
			Author         map[string]interface{} `json:"author"`
		} `json:"data"`
	}
	DecodeJSON(t, viewerHistory, &viewerPage)
	if len(viewerPage.Data) == 0 {
		t.Fatalf("page history is empty for viewer")
	}
	for _, item := range viewerPage.Data {
		if item.Author != nil {
			t.Fatalf("revision %d author leaked to viewer without user.list: %+v", item.RevisionNumber, item.Author)
		}
	}

	// The admin (author) retains the identity.
	adminHistory := MakeBearerRequest(t, server, http.MethodGet,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/pages/%d/history", workspaceID, pageID), nil)
	defer adminHistory.Body.Close()
	AssertStatusCode(t, adminHistory, http.StatusOK)
	var adminPage struct {
		Data []struct {
			RevisionNumber int                    `json:"revision_number"`
			Author         map[string]interface{} `json:"author"`
		} `json:"data"`
	}
	DecodeJSON(t, adminHistory, &adminPage)
	if len(adminPage.Data) == 0 || adminPage.Data[0].Author == nil {
		t.Fatalf("admin page history lost the author identity: %+v", adminPage.Data)
	}
}

// seedTestRun creates a test run without an assignee through the v2 API.
func seedTestRun(t *testing.T, ts *TestServer, workspaceID, setID int, name string) int {
	t.Helper()
	return seedTestRunWithAssignee(t, ts, workspaceID, setID, name, nil)
}

// seedTestRunWithAssignee creates a test run and optionally assigns it.
func seedTestRunWithAssignee(t *testing.T, ts *TestServer, workspaceID, setID int, name string, assigneeID *int) int {
	t.Helper()
	body := map[string]any{"name": name, "plan_id": setID}
	if assigneeID != nil {
		body["assignee_id"] = *assigneeID
	}
	resp := MakeBearerRequest(t, ts, http.MethodPost,
		fmt.Sprintf("/rest/api/v2/workspaces/%d/test-runs", workspaceID), body)
	defer resp.Body.Close()
	AssertStatusCode(t, resp, http.StatusCreated)
	var doc struct {
		Data map[string]any `json:"data"`
	}
	DecodeJSON(t, resp, &doc)
	return intField(doc.Data, "id")
}
