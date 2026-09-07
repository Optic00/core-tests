// mcp_time_test covers the time tracking tools: list_time_projects,
// list_worklogs, log_time, start_timer, stop_timer.
package tests

import (
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"
)

// createTimeProjectFixture creates a customer + time project via
// retained customer setup and session-v2 time projects. The MCP time tools rely on
// at least one project being visible to the caller, and the
// /time/projects POST handler requires a customer reference.
func createTimeProjectFixture(t *testing.T, ts *TestServer, name string) int {
	t.Helper()

	// Customer first.
	custBody := map[string]interface{}{"name": name + " Customer"}
	custResp := MakeAuthRequest(t, ts, http.MethodPost, "/customer-organisations", custBody)
	defer custResp.Body.Close()
	if custResp.StatusCode != http.StatusCreated && custResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(custResp.Body)
		t.Fatalf("create customer: %d - %s", custResp.StatusCode, string(raw))
	}
	var custOut map[string]interface{}
	DecodeJSON(t, custResp, &custOut)
	customerID := ExtractIDFromResponse(t, custOut)

	// Project tied to that customer.
	body := map[string]interface{}{
		"name":        name,
		"status":      "Active",
		"customer_id": customerID,
	}
	out := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, "/time/projects", body), http.StatusCreated)
	return out.ID
}

func TestMCP_ListTimeProjects(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	_ = SeedWorld(t, ts)
	session := dialMCP(t, ts)

	pid := createTimeProjectFixture(t, ts, "World Time Project")

	var out struct {
		Projects []struct {
			ID     int    `json:"id"`
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"projects"`
	}
	callTool(t, session, "list_time_projects", map[string]interface{}{}, &out)

	found := false
	for _, p := range out.Projects {
		if p.ID == pid && p.Name == "World Time Project" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("created project %d missing from list_time_projects (got %+v)", pid, out.Projects)
	}
}

func TestMCP_LogTime_AndList(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	w := SeedWorld(t, ts)
	session := dialMCP(t, ts)

	pid := createTimeProjectFixture(t, ts, "Worklog Project")

	today := time.Now().Format("2006-01-02")

	// Log a worklog with duration string.
	var logged struct {
		ID              int64  `json:"id"`
		DurationMinutes int    `json:"duration_minutes"`
		Description     string `json:"description"`
	}
	callTool(t, session, "log_time", map[string]interface{}{
		"project_id":  pid,
		"description": "research and design",
		"date":        today,
		"duration":    "1h30m",
		"item_id":     w.Items[0].ID,
	}, &logged)
	if logged.DurationMinutes != 90 {
		t.Fatalf("log_time duration=%d want 90", logged.DurationMinutes)
	}

	// Listing worklogs should now include this entry.
	var listed struct {
		Worklogs []struct {
			ID              int    `json:"id"`
			DurationMinutes int    `json:"duration_minutes"`
			Description     string `json:"description"`
		} `json:"worklogs"`
	}
	callTool(t, session, "list_worklogs", map[string]interface{}{
		"project_id": pid,
		"date_from":  today,
		"date_to":    today,
		"limit":      50,
	}, &listed)
	if len(listed.Worklogs) != 1 || listed.Worklogs[0].DurationMinutes != 90 {
		t.Fatalf("list_worklogs after log_time: %+v", listed.Worklogs)
	}
}

// V2 returns Unix timestamps, unlike the MCP tool's local-time presentation.
// Check both the creation response and a fresh read so the conversion is not
// merely an unpersisted response decoration.
func assertV2ZurichWorklog(t *testing.T, ts *TestServer, response *http.Response) {
	t.Helper()
	type worklog struct {
		ID              int   `json:"id"`
		Date            int64 `json:"date"`
		StartTime       int64 `json:"start_time"`
		EndTime         int64 `json:"end_time"`
		DurationMinutes int   `json:"duration_minutes"`
	}
	created := DecodeV2Document[worklog](t, response, http.StatusCreated)
	if created.ID <= 0 {
		t.Fatalf("created worklog has invalid ID: %+v", created)
	}
	want := worklog{
		ID:              created.ID,
		Date:            time.Date(2026, time.July, 14, 0, 0, 0, 0, time.UTC).Unix(),
		StartTime:       time.Date(2026, time.July, 14, 7, 0, 0, 0, time.UTC).Unix(),
		EndTime:         time.Date(2026, time.July, 14, 8, 0, 0, 0, time.UTC).Unix(),
		DurationMinutes: 60,
	}
	if created != want {
		t.Fatalf("REST civil-time interpretation = %+v, want %+v", created, want)
	}
	persisted := DecodeV2Document[worklog](t, MakeV2BearerRequest(t, ts, http.MethodGet, fmt.Sprintf("/time/worklogs/%d", created.ID), nil), http.StatusOK)
	if persisted != want {
		t.Fatalf("persisted REST worklog = %+v, want %+v", persisted, want)
	}
}

func TestRESTAndMCPWorklogsUseExplicitCivilTimezoneWithoutPreOffset(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	pid := createTimeProjectFixture(t, ts, "Timezone Worklogs")

	restResponse := MakeV2BearerRequest(t, ts, http.MethodPost, "/time/worklogs", map[string]interface{}{
		"project_id":  pid,
		"description": "REST Zurich wall clock",
		"date":        "2026-07-14",
		"start_time":  "09:00",
		"end_time":    "10:00",
		"timezone":    "Europe/Zurich",
	})
	assertV2ZurichWorklog(t, ts, restResponse)

	session := dialMCP(t, ts)
	var mcpOut struct {
		Timezone       string `json:"timezone"`
		StartTimeLocal string `json:"start_time_local"`
		EndTimeLocal   string `json:"end_time_local"`
		StartAt        string `json:"start_at"`
		EndAt          string `json:"end_at"`
	}
	callTool(t, session, "log_time", map[string]interface{}{
		"project_id":  pid,
		"description": "MCP Zurich wall clock",
		"date":        "2026-07-14",
		"start_time":  "09:00",
		"end_time":    "10:00",
		"timezone":    "Europe/Zurich",
	}, &mcpOut)
	if mcpOut.Timezone != "Europe/Zurich" || mcpOut.StartTimeLocal != "09:00" || mcpOut.EndTimeLocal != "10:00" || mcpOut.StartAt != "2026-07-14T07:00:00Z" || mcpOut.EndAt != "2026-07-14T08:00:00Z" {
		t.Fatalf("MCP interpretation = %+v", mcpOut)
	}

	var contextOut struct {
		Timezone  string `json:"timezone"`
		LocalDate string `json:"local_date"`
		UTCNow    string `json:"utc_now"`
	}
	callTool(t, session, "get_temporal_context", map[string]interface{}{"timezone": "Pacific/Auckland"}, &contextOut)
	if contextOut.Timezone != "Pacific/Auckland" || contextOut.LocalDate == "" || contextOut.UTCNow == "" {
		t.Fatalf("temporal context = %+v", contextOut)
	}

	var storedStart, storedDate int64
	if err := ts.DB().QueryRow("SELECT start_time, date FROM time_worklogs WHERE description = ?", "MCP Zurich wall clock").Scan(&storedStart, &storedDate); err != nil {
		t.Fatalf("read MCP worklog: %v", err)
	}
	if got := time.Unix(storedStart, 0).UTC().Format(time.RFC3339); got != "2026-07-14T07:00:00Z" {
		t.Fatalf("stored start = %s", got)
	}
	if got := time.Unix(storedDate, 0).UTC().Format(time.DateOnly); got != "2026-07-14" {
		t.Fatalf("stored date key = %s", got)
	}
}

func TestRESTAndMCPWorklogsResolveTokenUserTimezoneWhenRequestOmitsIt(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	pid := createTimeProjectFixture(t, ts, "Stored Timezone Worklogs")

	update := MakeAuthRequest(t, ts, http.MethodPut, fmt.Sprintf("/users/%d/regional-settings", lookupAdminUser(t, ts).ID), map[string]interface{}{
		"timezone": "Europe/Zurich",
		"language": "en",
	})
	defer update.Body.Close()
	AssertStatusCode(t, update, http.StatusOK)

	restResponse := MakeV2BearerRequest(t, ts, http.MethodPost, "/time/worklogs", map[string]interface{}{
		"project_id": pid, "description": "REST stored timezone", "date": "2026-07-14",
		"start_time": "09:00", "end_time": "10:00",
	})
	assertV2ZurichWorklog(t, ts, restResponse)

	session := dialMCP(t, ts)
	var mcpOut struct {
		Timezone string `json:"timezone"`
		StartAt  string `json:"start_at"`
	}
	callTool(t, session, "log_time", map[string]interface{}{
		"project_id": pid, "description": "MCP stored timezone", "date": "2026-07-14",
		"start_time": "09:00", "end_time": "10:00",
	}, &mcpOut)
	if mcpOut.Timezone != "Europe/Zurich" || mcpOut.StartAt != "2026-07-14T07:00:00Z" {
		t.Fatalf("MCP stored-timezone interpretation = %+v", mcpOut)
	}
}

func TestMCP_Timer_StartStop(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	w := SeedWorld(t, ts)
	session := dialMCP(t, ts)

	pid := createTimeProjectFixture(t, ts, "Timer Project")

	var started struct {
		Started     bool   `json:"started"`
		Description string `json:"description"`
	}
	callTool(t, session, "start_timer", map[string]interface{}{
		"project_id":   pid,
		"workspace_id": w.Alpha.ID,
		"description":  "live timer",
	}, &started)
	if !started.Started {
		t.Fatalf("start_timer started=false: %+v", started)
	}

	var stopped struct {
		Stopped         bool  `json:"stopped"`
		DurationSeconds int64 `json:"duration_seconds"`
	}
	callTool(t, session, "stop_timer", map[string]interface{}{}, &stopped)
	if !stopped.Stopped {
		t.Fatalf("stop_timer returned stopped=false: %+v", stopped)
	}
	if stopped.DurationSeconds < 0 {
		t.Fatalf("stop_timer duration=%ds (want non-negative)", stopped.DurationSeconds)
	}
}
