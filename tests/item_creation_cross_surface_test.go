package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"windshift/internal/constants"
)

func TestItemCreationV2ContractMatchesAcrossMounts(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Item Creation Contract", shortKey("ICC"))
	label := createLabelFx(t, server, workspaceID, "create-contract", "#2563eb")

	itemTypes := GetItemTypes(t, server, GetDefaultConfigurationSet(t, server))
	itemTypeID := RequireItemTypeID(t, itemTypes, "Task")
	personalResponse := MakeAuthRequest(t, server, http.MethodGet, "/workspaces/personal", nil)
	defer personalResponse.Body.Close()
	AssertStatusCode(t, personalResponse, http.StatusCreated)
	var personalWorkspace struct {
		ID int `json:"id"`
	}
	DecodeJSON(t, personalResponse, &personalWorkspace)

	create := func(surface string) map[string]interface{} {
		t.Helper()
		body := map[string]interface{}{
			"workspace_id": workspaceID,
			"item_type_id": itemTypeID,
			"title":        "  Promise<Anything> shared item\t",
			"description":  "before<script>bad()</script><br/>after",
			"label_ids":    []int{label.ID},
		}
		var response *http.Response
		if surface == "session" {
			response = MakeAuthRequest(t, server, http.MethodPost, "/v2/items", body)
		} else {
			response = MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/items", body)
		}
		defer response.Body.Close()
		AssertStatusCode(t, response, http.StatusCreated)
		var item map[string]interface{}
		DecodeJSON(t, response, &item)
		return item
	}

	for _, surface := range []string{"session", "bearer"} {
		item := create(surface)
		if item["title"] != "Promise<Anything> shared item" || item["description"] != "before<script>bad()</script><br/>after" {
			t.Fatalf("%s create changed source = %v", surface, item)
		}
		labels, ok := item["labels"].([]interface{})
		if !ok || len(labels) != 1 || labels[0].(map[string]interface{})["id"] != float64(label.ID) {
			t.Fatalf("%s create labels = %#v, want label %d", surface, item["labels"], label.ID)
		}
		rendered, _ := item["description_html"].(string)
		if strings.Contains(rendered, "<script>") || !strings.Contains(rendered, "&lt;script&gt;") || !strings.Contains(rendered, "<br>") {
			t.Fatalf("%s description_html is not safe rendered Markdown: %q", surface, rendered)
		}
	}

	for surface, request := range map[string]func(map[string]interface{}) *http.Response{
		"cookie": func(body map[string]interface{}) *http.Response {
			return MakeAuthRequest(t, server, http.MethodPost, "/v2/items", body)
		},
		"bearer": func(body map[string]interface{}) *http.Response {
			return MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/items", body)
		},
	} {
		t.Run(surface+" task invariant", func(t *testing.T) {
			invalid := request(map[string]interface{}{
				"workspace_id": workspaceID,
				"item_type_id": itemTypeID,
				"title":        "Invalid shared task",
				"status_id":    constants.StatusIDOpen,
				"is_task":      true,
			})
			AssertStatusCode(t, invalid, http.StatusBadRequest)
			var errorBody struct {
				Error struct {
					Code    string            `json:"code"`
					Details map[string]string `json:"details"`
				} `json:"error"`
			}
			DecodeJSON(t, invalid, &errorBody)
			invalid.Body.Close()
			if errorBody.Error.Code != "validation_failed" || errorBody.Error.Details["field"] != "is_task" {
				t.Fatalf("task validation response = %#v", errorBody)
			}

			valid := request(map[string]interface{}{
				"workspace_id": personalWorkspace.ID,
				"item_type_id": itemTypeID,
				"title":        "Valid personal task",
				"status_id":    constants.StatusIDOpen,
				"is_task":      true,
			})
			defer valid.Body.Close()
			AssertStatusCode(t, valid, http.StatusCreated)
			var item struct {
				ID          int  `json:"id"`
				WorkspaceID int  `json:"workspace_id"`
				StatusID    *int `json:"status_id"`
				IsTask      bool `json:"is_task"`
			}
			DecodeJSON(t, valid, &item)
			if item.WorkspaceID != personalWorkspace.ID || item.StatusID == nil || *item.StatusID != constants.StatusIDOpen || !item.IsTask {
				t.Fatalf("created personal task = %#v", item)
			}

			transitionPath := fmt.Sprintf("/v2/items/%d/transition", item.ID)
			var transition *http.Response
			if surface == "bearer" {
				transitionPath = fmt.Sprintf("/rest/api/v2/items/%d/transition", item.ID)
				transition = MakeBearerRequest(t, server, http.MethodPost, transitionPath, map[string]interface{}{"to_status_id": 2})
			} else {
				transition = MakeAuthRequest(t, server, http.MethodPost, transitionPath, map[string]interface{}{"to_status_id": 2})
			}
			AssertStatusCode(t, transition, http.StatusBadRequest)
			DecodeJSON(t, transition, &errorBody)
			transition.Body.Close()
			if errorBody.Error.Code != "validation_failed" || errorBody.Error.Details["field"] != "is_task" {
				t.Fatalf("task transition response = %#v", errorBody)
			}
		})
	}

	for _, tc := range []struct {
		name string
		body map[string]interface{}
	}{
		{
			name: "title is whitespace only",
			body: map[string]interface{}{
				"workspace_id": workspaceID,
				"item_type_id": itemTypeID,
				"title":        "   ",
			},
		},
		{
			name: "unknown item type",
			body: map[string]interface{}{
				"workspace_id": workspaceID,
				"item_type_id": 999999,
				"title":        "Invalid type",
			},
		},
		{
			name: "unknown label",
			body: map[string]interface{}{
				"workspace_id": workspaceID,
				"item_type_id": itemTypeID,
				"title":        "Invalid label",
				"label_ids":    []int{999999},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for surface, request := range map[string]func() *http.Response{
				"cookie": func() *http.Response {
					return MakeAuthRequest(t, server, http.MethodPost, "/v2/items", tc.body)
				},
				"bearer": func() *http.Response {
					return MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/items", tc.body)
				},
			} {
				response := request()
				if response.StatusCode != http.StatusBadRequest {
					response.Body.Close()
					t.Fatalf("%s create status = %d, want 400; body=%s", surface, response.StatusCode, fmt.Sprint(tc.body))
				}
				response.Body.Close()
			}
		})
	}

	inactiveResponse := MakeAuthRequest(t, server, http.MethodPost, "/users", map[string]interface{}{
		"email":      "inactive-item-assignee@example.test",
		"username":   "inactive-item-assignee",
		"first_name": "Inactive",
		"last_name":  "Assignee",
		"password":   "testpass123",
		"is_active":  false,
	})
	defer inactiveResponse.Body.Close()
	AssertStatusCode(t, inactiveResponse, http.StatusCreated)
	var inactiveUser map[string]interface{}
	DecodeJSON(t, inactiveResponse, &inactiveUser)
	inactiveUserID := ExtractIDFromResponse(t, inactiveUser)

	for _, assignee := range []struct {
		name string
		id   int
	}{
		{name: "inactive", id: inactiveUserID},
		{name: "unknown", id: inactiveUserID + 1_000_000},
	} {
		t.Run(assignee.name+" assignee", func(t *testing.T) {
			body := map[string]interface{}{
				"workspace_id": workspaceID,
				"item_type_id": itemTypeID,
				"title":        "Rejected " + assignee.name + " assignee",
				"assignee_id":  assignee.id,
			}

			for surface, request := range map[string]func() *http.Response{
				"cookie": func() *http.Response {
					return MakeAuthRequest(t, server, http.MethodPost, "/v2/items", body)
				},
				"bearer": func() *http.Response {
					return MakeBearerRequest(t, server, http.MethodPost, "/rest/api/v2/items", body)
				},
			} {
				response := request()
				AssertStatusCode(t, response, http.StatusBadRequest)

				var errorBody map[string]interface{}
				DecodeJSON(t, response, &errorBody)
				response.Body.Close()
				apiError, ok := errorBody["error"].(map[string]interface{})
				if !ok || apiError["code"] != "validation_failed" || !strings.Contains(fmt.Sprint(apiError["message"]), "Assignee user not found") {
					t.Fatalf("%s validation error = %v", surface, errorBody)
				}
			}
		})
	}
}

func TestItemCreation_NumberAndDateCustomFieldValidation(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspaceID, _ := CreateTestWorkspace(t, server, "Typed Custom Fields", shortKey("TCF"))
	itemTypes := GetItemTypes(t, server, GetDefaultConfigurationSet(t, server))
	itemTypeID := RequireItemTypeID(t, itemTypes, "Task")
	numberFieldID := CreateTestCustomField(t, server, "Estimate "+ts(), "number", "")
	dateFieldID := CreateTestCustomField(t, server, "Target date "+ts(), "date", "")
	numberKey := fmt.Sprintf("%d", numberFieldID)
	dateKey := fmt.Sprintf("%d", dateFieldID)

	request := func(title string, values map[string]interface{}) *http.Response {
		t.Helper()
		body := map[string]interface{}{
			"workspace_id":        workspaceID,
			"item_type_id":        itemTypeID,
			"title":               title,
			"custom_field_values": values,
		}
		return MakeAuthRequest(t, server, http.MethodPost, "/v2/items", body)
	}

	t.Run("rejects invalid number", func(t *testing.T) {
		response := request("Invalid number", map[string]interface{}{numberKey: "abc"})
		defer response.Body.Close()
		AssertStatusCode(t, response, http.StatusBadRequest)
		var body map[string]interface{}
		DecodeJSON(t, response, &body)
		if !strings.Contains(fmt.Sprint(body), "validation_failed") || !strings.Contains(fmt.Sprint(body), "number value must be numeric") {
			t.Fatalf("invalid-number response = %v", body)
		}
	})

	t.Run("rejects invalid date", func(t *testing.T) {
		response := request("Invalid date", map[string]interface{}{dateKey: "2026-02-30"})
		defer response.Body.Close()
		AssertStatusCode(t, response, http.StatusBadRequest)
		var body map[string]interface{}
		DecodeJSON(t, response, &body)
		if !strings.Contains(fmt.Sprint(body), "validation_failed") || !strings.Contains(fmt.Sprint(body), "YYYY-MM-DD") {
			t.Fatalf("invalid-date response = %v", body)
		}
	})

	t.Run("normalizes valid values", func(t *testing.T) {
		response := request("Valid typed fields", map[string]interface{}{
			numberKey: "12.5",
			dateKey:   " 2026-02-28 ",
		})
		defer response.Body.Close()
		AssertStatusCode(t, response, http.StatusCreated)
		var item map[string]interface{}
		DecodeJSON(t, response, &item)
		values, ok := item["custom_field_values"].(map[string]interface{})
		if !ok {
			t.Fatalf("custom_field_values = %#v", item["custom_field_values"])
		}
		if values[numberKey] != float64(12.5) || values[dateKey] != "2026-02-28" {
			t.Fatalf("normalized custom fields = %#v", values)
		}
	})
}
