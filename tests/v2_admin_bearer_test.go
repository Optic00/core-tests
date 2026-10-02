package tests

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"windshift/internal/models"
	"windshift/internal/objecttranslation"
)

func adminV2Request[T any](t *testing.T, s *TestServer, token, method, path string, input any, status int) T {
	t.Helper()
	response := MakeBearerRequestWithToken(t, s, token, method, "/rest/api/v2/admin"+path, input)
	defer response.Body.Close()
	if response.StatusCode != status {
		AssertStatusCode(t, response, status)
		t.FailNow()
	}
	var result T
	if status != http.StatusNoContent {
		DecodeJSON(t, response, &result)
	}
	return result
}

func TestV2AdminBearerTranslations(t *testing.T) {
	s, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	session := CreateBearerToken(t, s)
	read := createTokenWithScopesAsUser(t, s, "admin", "testpass123", []string{"admin:object-translations:read"})
	write := createTokenWithScopesAsUser(t, s, "admin", "testpass123", []string{"admin:object-translations:write"})
	created := MakeAuthRequestWithToken(t, s, session, "POST", "/priorities", map[string]any{"name": "Admin translation fixture", "description": "Canonical", "color": "#123456", "icon": "AlertCircle", "sort_order": 90})
	defer created.Body.Close()
	AssertStatusCode(t, created, 201)
	var priority struct {
		ID int `json:"id"`
	}
	DecodeJSON(t, created, &priority)
	if priority.ID == 0 {
		t.Fatal("priority ID missing")
	}
	base := fmt.Sprintf("/object-translations/priority/%d", priority.ID)
	path := base + "/name/de"
	definitions := adminV2Request[[]objecttranslation.ObjectDefinition](t, s, read, "GET", "/object-translations/definitions", nil, 200)
	if !reflect.DeepEqual(definitions, objecttranslation.Definitions()) {
		t.Fatalf("definitions = %#v", definitions)
	}
	translation := adminV2Request[objecttranslation.Translation](t, s, write, "PUT", path, map[string]any{"value": "Priorität"}, 200)
	if translation.ObjectType != "priority" || translation.ObjectID != priority.ID || translation.Field != "name" || translation.Locale != "de" || translation.Source != "instance" || translation.Value != "Priorität" {
		t.Fatalf("translation = %+v", translation)
	}
	rows := adminV2Request[[]objecttranslation.Translation](t, s, read, "GET", base, nil, 200)
	if len(rows) != 1 || rows[0].Value != "Priorität" || rows[0].Source != "instance" {
		t.Fatalf("persisted translations = %+v", rows)
	}
	input := map[string]any{"locale": "de", "targets": []map[string]any{{"object_type": "priority", "object_id": priority.ID, "field": "name", "fallback": "Admin translation fixture"}}}
	resolved := adminV2Request[[]objecttranslation.ResolvedValue](t, s, read, "POST", "/object-translations/resolve", input, 200)
	if len(resolved) != 1 || resolved[0].Value != "Priorität" {
		t.Fatalf("resolved = %+v", resolved)
	}
	for _, method := range []string{"PUT", "DELETE"} {
		denied := adminV2Request[map[string]any](t, s, read, method, path, map[string]any{"value": "Forbidden"}, 403)
		if e, ok := denied["error"].(map[string]any); !ok || e["code"] != "insufficient_permission" || e["message"] != "Token lacks a required scope" {
			t.Fatalf("denial = %#v", denied)
		}
	}
	rows = adminV2Request[[]objecttranslation.Translation](t, s, read, "GET", base, nil, 200)
	if len(rows) != 1 || rows[0].Value != "Priorität" {
		t.Fatalf("denied mutations changed translations: %+v", rows)
	}
	for _, endpoint := range []string{"orphans", "canonical-differences"} {
		actual := adminV2Request[[]map[string]any](t, s, read, "GET", "/object-translations/"+endpoint, nil, 200)
		response := MakeAuthRequestWithToken(t, s, session, "GET", "/admin/object-translations/"+endpoint, nil)
		AssertStatusCode(t, response, 200)
		var expected []map[string]any
		DecodeJSON(t, response, &expected)
		response.Body.Close()
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("%s = %#v, want %#v", endpoint, actual, expected)
		}
	}
	adminV2Request[any](t, s, write, "DELETE", path, nil, 204)
	rows = adminV2Request[[]objecttranslation.Translation](t, s, read, "GET", base, nil, 200)
	if len(rows) != 0 {
		t.Fatalf("deleted translations = %+v", rows)
	}
	resolved = adminV2Request[[]objecttranslation.ResolvedValue](t, s, read, "POST", "/object-translations/resolve", input, 200)
	if len(resolved) != 1 || resolved[0].Value != "Admin translation fixture" {
		t.Fatalf("fallback after delete = %+v", resolved)
	}
	for _, test := range []struct {
		path   string
		status int
		code   string
	}{
		{"/object-translations/unknown/1", 400, "invalid_request"},
		{"/object-translations/priority/not-an-id", 400, "invalid_request"},
		{"/object-translations/priority/2147483647", 404, "not_found"},
	} {
		got := adminV2Request[map[string]any](t, s, read, "GET", test.path, nil, test.status)
		if e, ok := got["error"].(map[string]any); !ok || e["code"] != test.code {
			t.Fatalf("error = %#v", got)
		}
	}
}

func TestV2AdminBearerTokensAndAudit(t *testing.T) {
	s, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, s)
	read := createTokenWithScopesAsUser(t, s, "admin", "testpass123", []string{"admin:api-tokens:read"})
	write := createTokenWithScopesAsUser(t, s, "admin", "testpass123", []string{"admin:api-tokens:write"})
	audit := createTokenWithScopesAsUser(t, s, "admin", "testpass123", []string{"admin:audit-logs:read"})
	uid, username, password := CreateTestUserWithCredentials(t, s, "revoked-user", "revoked@example.com")
	target := createTokenWithScopesAsUser(t, s, username, password, []string{"users:read"})
	// Populate the validation cache before revocation.
	response := MakeBearerRequestWithToken(t, s, target, "GET", "/rest/api/v2/users/me", nil)
	AssertStatusCode(t, response, 200)
	response.Body.Close()
	type tokenPage struct {
		Data       []models.APIToken `json:"data"`
		Pagination struct {
			TotalItems int `json:"total_items"`
		} `json:"pagination"`
	}
	page := adminV2Request[tokenPage](t, s, read, "GET", fmt.Sprintf("/api-tokens?user_id=%d&page_size=1", uid), nil, 200)
	if len(page.Data) != 1 || page.Data[0].UserID != uid || page.Pagination.TotalItems != 1 || page.Data[0].Token != "" {
		t.Fatalf("token page = %+v", page)
	}
	id := page.Data[0].ID
	path := fmt.Sprintf("/api-tokens/%d", id)
	denied := adminV2Request[map[string]any](t, s, read, "DELETE", path, nil, 403)
	if e, ok := denied["error"].(map[string]any); !ok || e["code"] != "insufficient_permission" || e["message"] != "Token lacks a required scope" {
		t.Fatalf("denial = %#v", denied)
	}
	response = MakeBearerRequestWithToken(t, s, target, "GET", "/rest/api/v2/users/me", nil)
	AssertStatusCode(t, response, 200)
	response.Body.Close()
	adminV2Request[any](t, s, write, "DELETE", path, nil, 204)
	response = MakeBearerRequestWithToken(t, s, target, "GET", "/rest/api/v2/users/me", nil)
	AssertStatusCode(t, response, 401)
	var revoked map[string]any
	DecodeJSON(t, response, &revoked)
	response.Body.Close()
	if e, ok := revoked["error"].(map[string]any); !ok || e["code"] != "invalid_token" {
		t.Fatalf("revoked token = %#v", revoked)
	}
	page = adminV2Request[tokenPage](t, s, read, "GET", fmt.Sprintf("/api-tokens?user_id=%d", uid), nil, 200)
	if len(page.Data) != 0 || page.Pagination.TotalItems != 0 {
		t.Fatalf("revoked token persisted = %+v", page)
	}
	missing := adminV2Request[map[string]any](t, s, write, "DELETE", path, nil, 404)
	if e, ok := missing["error"].(map[string]any); !ok || e["code"] != "not_found" || e["message"] != "Token was not found" {
		t.Fatalf("missing token = %#v", missing)
	}
	type entry struct {
		ID         int    `json:"id"`
		ResourceID int    `json:"resource_id"`
		ActionType string `json:"action_type"`
		Success    bool   `json:"success"`
	}
	type auditPage struct {
		Data       []entry `json:"data"`
		Pagination struct {
			TotalItems int `json:"total_items"`
		} `json:"pagination"`
	}
	logs := adminV2Request[auditPage](t, s, audit, "GET", "/audit-logs?action_type=api_token.admin_revoke&resource_type=api_token&page_size=1", nil, 200)
	if len(logs.Data) != 1 || logs.Pagination.TotalItems != 1 || logs.Data[0].ResourceID != id || !logs.Data[0].Success {
		t.Fatalf("revocation audit = %+v", logs)
	}
	type stream struct {
		Entries     []entry `json:"entries"`
		NextAfterID int     `json:"next_after_id"`
		HasMore     bool    `json:"has_more"`
	}
	eventID := logs.Data[0].ID
	batch := adminV2Request[stream](t, s, audit, "GET", fmt.Sprintf("/audit-logs/since?after_id=%d&limit=1", eventID-1), nil, 200)
	if len(batch.Entries) != 1 || batch.Entries[0] != logs.Data[0] || batch.NextAfterID != eventID || !batch.HasMore {
		t.Fatalf("stream = %+v", batch)
	}
	next := adminV2Request[stream](t, s, audit, "GET", fmt.Sprintf("/audit-logs/since?after_id=%d&limit=1001", eventID), nil, 200)
	for _, event := range next.Entries {
		if event.ID <= eventID {
			t.Fatalf("stream redelivered event %+v", event)
		}
	}
	for _, path := range []string{"/audit-logs?user_id=bad", "/audit-logs?from=bad", "/audit-logs?to=bad", "/audit-logs/since?after_id=-1", "/audit-logs/since?limit=0", "/api-tokens?user_id=-1"} {
		token := audit
		if strings.HasPrefix(path, "/api-tokens") {
			token = read
		}
		got := adminV2Request[map[string]any](t, s, token, "GET", path, nil, 400)
		if e, ok := got["error"].(map[string]any); !ok || e["code"] != "invalid_request" {
			t.Fatalf("invalid query = %#v", got)
		}
	}
}
