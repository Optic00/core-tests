package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"windshift/internal/wscli"
)

func TestWSCLI_StatusListUsesWorkspaceWorkflows(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	world := SeedWorld(t, ts)
	status := DecodeV2Document[struct {
		Category struct {
			ID int `json:"id"`
		} `json:"category"`
	}](t, MakeV2SessionRequest(t, ts, http.MethodGet, fmt.Sprintf("/statuses/%d", world.Statuses.InProgress), nil), http.StatusOK)
	reviewName := fmt.Sprintf("Alpha Review %d", world.Alpha.ID)
	reviewID := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, "/statuses", map[string]any{
		"name": reviewName, "category_id": status.Category.ID,
	}), http.StatusCreated).ID

	// Detach the two fixture workspaces through the retained configuration API.
	// Their replacement workflows and item-type assignments also use real APIs.
	defaultID := GetDefaultConfigurationSet(t, ts)
	defaultResponse := MakeAuthRequest(t, ts, http.MethodGet, fmt.Sprintf("/configuration-sets/%d", defaultID), nil)
	AssertStatusCode(t, defaultResponse, http.StatusOK)
	var defaultConfig struct {
		WorkspaceIDs []int `json:"workspace_ids"`
	}
	DecodeJSON(t, defaultResponse, &defaultConfig)
	defaultResponse.Body.Close()
	remaining := make([]int, 0, len(defaultConfig.WorkspaceIDs))
	for _, id := range defaultConfig.WorkspaceIDs {
		if id != world.Alpha.ID && id != world.Beta.ID {
			remaining = append(remaining, id)
		}
	}
	update := MakeAuthRequest(t, ts, http.MethodPut, fmt.Sprintf("/configuration-sets/%d", defaultID), map[string]any{"workspace_ids": remaining})
	AssertStatusCode(t, update, http.StatusOK)
	update.Body.Close()
	for _, assignment := range []struct{ workspaceID, targetStatus int }{
		{world.Alpha.ID, reviewID}, {world.Beta.ID, world.Statuses.Done},
	} {
		name := fmt.Sprintf("CLI workflow %d", assignment.workspaceID)
		workflowID := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, "/workflows", map[string]any{"name": name}), http.StatusCreated).ID
		transitions := []map[string]any{
			{"from_status_id": nil, "to_status_id": world.Statuses.Open},
			{"from_status_id": world.Statuses.Open, "to_status_id": assignment.targetStatus},
		}
		DecodeV2Document[[]v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPut, fmt.Sprintf("/workflows/%d/transitions", workflowID), map[string]any{"transitions": transitions}), http.StatusOK)
		response := MakeAuthRequest(t, ts, http.MethodPost, "/configuration-sets", map[string]any{
			"name": name, "workflow_id": workflowID, "workspace_ids": []int{assignment.workspaceID},
			"item_type_configs": []map[string]any{{"item_type_id": world.defaultType}},
		})
		AssertStatusCode(t, response, http.StatusCreated)
		response.Body.Close()
	}

	list := func(t *testing.T, workspaceKey string) wscli.StatusListResult {
		t.Helper()
		out, stderr, code := runWS(t, ts, "status", "ls", "-w", workspaceKey, "-o", "json")
		requireZero(t, code, stderr)
		var result wscli.StatusListResult
		if err := json.Unmarshal(out, &result); err != nil {
			t.Fatalf("decode status list: %v\nraw=%s", err, string(out))
		}
		return result
	}

	alpha := list(t, world.Alpha.Key)
	if alpha.Scope != "workspace" || alpha.Workspace == nil || alpha.Workspace.Key != world.Alpha.Key {
		t.Fatalf("alpha scope metadata = %+v", alpha)
	}
	alphaIDs := map[int]bool{}
	for _, status := range alpha.Statuses {
		alphaIDs[status.ID] = true
	}
	if len(alphaIDs) != 2 || !alphaIDs[world.Statuses.Open] || !alphaIDs[reviewID] || alphaIDs[world.Statuses.Done] {
		t.Fatalf("alpha statuses = %+v, want Open + Review only", alpha.Statuses)
	}

	beta := list(t, world.Beta.Key)
	if beta.Scope != "workspace" || beta.Workspace == nil || beta.Workspace.Key != world.Beta.Key {
		t.Fatalf("beta scope metadata = %+v", beta)
	}
	betaIDs := map[int]bool{}
	for _, status := range beta.Statuses {
		betaIDs[status.ID] = true
	}
	if len(betaIDs) != 2 || !betaIDs[world.Statuses.Open] || !betaIDs[world.Statuses.Done] || betaIDs[reviewID] {
		t.Fatalf("beta statuses = %+v, want Open + Done only", beta.Statuses)
	}

	// Use the status exactly as discovered by the workspace-scoped command.
	// This proves a listed status is a real move target for an applicable item.
	target := world.Items[0]
	if target.WorkspaceID != world.Alpha.ID || target.StatusID != world.Statuses.Open {
		t.Fatalf("unexpected move fixture: %+v", target)
	}
	_, stderr, code := runWS(t, ts,
		"task", "move", strconv.Itoa(target.ID), reviewName,
		"-w", world.Alpha.Key, "-o", "json",
	)
	requireZero(t, code, stderr)

	itemOut, stderr, code := runWS(t, ts, "task", "get", strconv.Itoa(target.ID), "-o", "json")
	requireZero(t, code, stderr)
	var moved struct {
		StatusID int `json:"status_id"`
	}
	if err := json.Unmarshal(itemOut, &moved); err != nil {
		t.Fatalf("decode moved item: %v\nraw=%s", err, string(itemOut))
	}
	if moved.StatusID != reviewID {
		t.Fatalf("item status = %d, want listed Review status %d", moved.StatusID, reviewID)
	}
}
