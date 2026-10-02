package tests

import (
	"fmt"
	"net/http"
	"testing"

	"windshift/internal/restapi"
)

func TestObjectTranslationAdminCRUDAndBulkResolution(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	adminToken := CreateBearerToken(t, server)

	name := "Translation custom priority"
	createResponse := MakeAuthRequestWithToken(t, server, adminToken, http.MethodPost, "/priorities", map[string]any{
		"name": name, "description": "Canonical description", "icon": "AlertCircle",
		"color": "#123456", "sort_order": 90, "is_default": false,
	})
	defer createResponse.Body.Close()
	AssertStatusCode(t, createResponse, http.StatusCreated)
	var priority struct {
		ID         int    `json:"id"`
		Name       string `json:"name"`
		BuiltinKey string `json:"builtin_key"`
	}
	DecodeJSON(t, createResponse, &priority)
	if priority.ID == 0 || priority.Name != name || priority.BuiltinKey != "" {
		t.Fatalf("created custom priority = %+v, want id, canonical name, and no built-in key", priority)
	}

	translationPath := fmt.Sprintf("/admin/object-translations/priority/%d/name/pt-br", priority.ID)
	upsertResponse := MakeAuthRequestWithToken(t, server, adminToken, http.MethodPut, translationPath, map[string]any{
		"value": "Prioridade personalizada",
	})
	defer upsertResponse.Body.Close()
	AssertStatusCode(t, upsertResponse, http.StatusOK)
	var translation struct {
		ObjectType string `json:"object_type"`
		ObjectID   int    `json:"object_id"`
		Field      string `json:"field"`
		Locale     string `json:"locale"`
		Source     string `json:"source"`
		Value      string `json:"value"`
	}
	DecodeJSON(t, upsertResponse, &translation)
	if translation.ObjectType != "priority" || translation.ObjectID != priority.ID ||
		translation.Field != "name" || translation.Locale != "pt-BR" ||
		translation.Source != "instance" || translation.Value != "Prioridade personalizada" {
		t.Fatalf("upserted translation = %+v", translation)
	}

	localizedResponse := makeSessionRequest(t, http.MethodGet, server.APIBase+"/v2/priorities", adminToken, nil,
		map[string]string{"Accept-Language": "pt-BR"})
	defer localizedResponse.Body.Close()
	AssertStatusCode(t, localizedResponse, http.StatusOK)
	var localizedPriorities []struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
	}
	DecodeJSON(t, localizedResponse, &localizedPriorities)
	foundLocalizedPriority := false
	for _, candidate := range localizedPriorities {
		if candidate.ID != priority.ID {
			continue
		}
		foundLocalizedPriority = true
		if candidate.Name != name || candidate.DisplayName != "Prioridade personalizada" {
			t.Fatalf("localized priority = %+v, want canonical name and translated display_name", candidate)
		}
	}
	if !foundLocalizedPriority {
		t.Fatalf("priority %d missing from localized list", priority.ID)
	}

	v1LocalizedResponse := makeRequest(t, http.MethodGet, server.BaseURL+"/rest/api/v1/priorities", server.BearerToken, nil,
		map[string]string{"Accept-Language": "pt-BR"})
	defer v1LocalizedResponse.Body.Close()
	AssertStatusCode(t, v1LocalizedResponse, http.StatusOK)
	localizedPriorities = nil
	DecodeJSON(t, v1LocalizedResponse, &localizedPriorities)
	foundLocalizedPriority = false
	for _, candidate := range localizedPriorities {
		if candidate.ID == priority.ID {
			foundLocalizedPriority = true
			if candidate.Name != name || candidate.DisplayName != "Prioridade personalizada" {
				t.Fatalf("v1 localized priority = %+v, want canonical name and translated display_name", candidate)
			}
		}
	}
	if !foundLocalizedPriority {
		t.Fatalf("priority %d missing from v1 localized list", priority.ID)
	}

	listResponse := MakeAuthRequestWithToken(t, server, adminToken, http.MethodGet,
		fmt.Sprintf("/admin/object-translations/priority/%d", priority.ID), nil)
	defer listResponse.Body.Close()
	AssertStatusCode(t, listResponse, http.StatusOK)
	var translations []map[string]any
	DecodeJSON(t, listResponse, &translations)
	if len(translations) != 1 || translations[0]["locale"] != "pt-BR" {
		t.Fatalf("listed translations = %#v, want normalized pt-BR row", translations)
	}

	resolveResponse := MakeAuthRequestWithToken(t, server, adminToken, http.MethodPost,
		"/admin/object-translations/resolve", map[string]any{
			"locale": "pt-BR",
			"targets": []map[string]any{{
				"object_type": "priority", "object_id": priority.ID, "field": "name", "fallback": name,
			}},
		})
	defer resolveResponse.Body.Close()
	AssertStatusCode(t, resolveResponse, http.StatusOK)
	var resolved []struct {
		Value  string `json:"value"`
		Locale string `json:"locale"`
		Source string `json:"source"`
	}
	DecodeJSON(t, resolveResponse, &resolved)
	if len(resolved) != 1 || resolved[0].Value != "Prioridade personalizada" ||
		resolved[0].Locale != "pt-BR" || resolved[0].Source != "instance" {
		t.Fatalf("resolved values = %+v", resolved)
	}

	deleteResponse := MakeAuthRequestWithToken(t, server, adminToken, http.MethodDelete, translationPath, nil)
	defer deleteResponse.Body.Close()
	AssertStatusCode(t, deleteResponse, http.StatusNoContent)

	fallbackResponse := MakeAuthRequestWithToken(t, server, adminToken, http.MethodPost,
		"/admin/object-translations/resolve", map[string]any{
			"locale": "pt-BR",
			"targets": []map[string]any{{
				"object_type": "priority", "object_id": priority.ID, "field": "name", "fallback": name,
			}},
		})
	defer fallbackResponse.Body.Close()
	AssertStatusCode(t, fallbackResponse, http.StatusOK)
	resolved = nil
	DecodeJSON(t, fallbackResponse, &resolved)
	if len(resolved) != 1 || resolved[0].Value != name || resolved[0].Source != "canonical" || resolved[0].Locale != "" {
		t.Fatalf("fallback values = %+v", resolved)
	}
}

func TestObjectTranslationEndpointsRequireSystemAdmin(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	_, username, password := CreateTestUserWithCredentials(
		t, server, "translation_non_admin", "translation-non-admin@test.com",
	)
	nonAdminToken := CreateBearerTokenForUser(t, server, username, password)

	response := MakeAuthRequestWithToken(t, server, nonAdminToken, http.MethodGet,
		"/admin/object-translations/definitions", nil)
	defer response.Body.Close()
	AssertStatusCode(t, response, http.StatusForbidden)
	var apiError restapi.ErrorResponse
	DecodeJSON(t, response, &apiError)
	if apiError.Code != restapi.ErrCodeInsufficientPermission {
		t.Fatalf("non-admin error = %+v, want code %q", apiError, restapi.ErrCodeInsufficientPermission)
	}
}

func TestObjectTranslationCacheInvalidationAcrossAPISurfaces(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	adminCookie := CreateBearerToken(t, server)

	name := "Cross surface priority"
	createResponse := MakeAuthRequestWithToken(t, server, adminCookie, http.MethodPost, "/priorities", map[string]any{
		"name": name, "description": "", "icon": "AlertCircle", "color": "#654321", "sort_order": 91,
	})
	defer createResponse.Body.Close()
	AssertStatusCode(t, createResponse, http.StatusCreated)
	var priority struct {
		ID int `json:"id"`
	}
	DecodeJSON(t, createResponse, &priority)

	resolveBody := map[string]any{
		"locale": "de-CH",
		"targets": []map[string]any{{
			"object_type": "priority", "object_id": priority.ID, "field": "name", "fallback": name,
		}},
	}
	primeResponse := MakeAuthRequestWithToken(t, server, adminCookie, http.MethodPost,
		"/admin/object-translations/resolve", resolveBody)
	defer primeResponse.Body.Close()
	AssertStatusCode(t, primeResponse, http.StatusOK)

	v1Path := fmt.Sprintf("/rest/api/v1/admin/object-translations/priority/%d/name/de", priority.ID)
	v1WriteResponse := MakeBearerRequestWithToken(t, server, server.BearerToken, http.MethodPut, v1Path,
		map[string]any{"value": "Oberflächenübergreifend"})
	defer v1WriteResponse.Body.Close()
	AssertStatusCode(t, v1WriteResponse, http.StatusOK)

	cookieResolveResponse := MakeAuthRequestWithToken(t, server, adminCookie, http.MethodPost,
		"/admin/object-translations/resolve", resolveBody)
	defer cookieResolveResponse.Body.Close()
	AssertStatusCode(t, cookieResolveResponse, http.StatusOK)
	var resolved []struct {
		Value  string `json:"value"`
		Locale string `json:"locale"`
		Source string `json:"source"`
	}
	DecodeJSON(t, cookieResolveResponse, &resolved)
	if len(resolved) != 1 || resolved[0].Value != "Oberflächenübergreifend" ||
		resolved[0].Locale != "de" || resolved[0].Source != "instance" {
		t.Fatalf("cookie resolution after v1 write = %+v", resolved)
	}

	deleteResponse := MakeAuthRequestWithToken(t, server, adminCookie, http.MethodDelete,
		fmt.Sprintf("/admin/object-translations/priority/%d/name/de", priority.ID), nil)
	defer deleteResponse.Body.Close()
	AssertStatusCode(t, deleteResponse, http.StatusNoContent)

	v1ResolveResponse := MakeBearerRequestWithToken(t, server, server.BearerToken, http.MethodPost,
		"/rest/api/v1/admin/object-translations/resolve", resolveBody)
	defer v1ResolveResponse.Body.Close()
	AssertStatusCode(t, v1ResolveResponse, http.StatusOK)
	resolved = nil
	DecodeJSON(t, v1ResolveResponse, &resolved)
	if len(resolved) != 1 || resolved[0].Value != name || resolved[0].Source != "canonical" {
		t.Fatalf("v1 resolution after cookie delete = %+v", resolved)
	}
}

func TestObjectTranslationV1RequiresMatchingTokenScope(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	readToken := createTokenWithScopesAsUser(
		t, server, "admin", "testpass123", []string{"admin:object-translations:read"},
	)

	readResponse := MakeBearerRequestWithToken(t, server, readToken, http.MethodGet,
		"/rest/api/v1/admin/object-translations/definitions", nil)
	defer readResponse.Body.Close()
	AssertStatusCode(t, readResponse, http.StatusOK)

	writeResponse := MakeBearerRequestWithToken(t, server, readToken, http.MethodPut,
		"/rest/api/v1/admin/object-translations/priority/1/name/de", map[string]any{"value": "Verboten"})
	defer writeResponse.Body.Close()
	AssertStatusCode(t, writeResponse, http.StatusForbidden)
	var apiError restapi.ErrorResponse
	DecodeJSON(t, writeResponse, &apiError)
	if apiError.Code != restapi.ErrCodeInsufficientPermission {
		t.Fatalf("read-only token write error = %+v, want code %q", apiError, restapi.ErrCodeInsufficientPermission)
	}
}

func TestObjectTranslationBulkLimitPreservesSurfaceErrorContracts(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	adminCookie := CreateBearerToken(t, server)
	targets := make([]map[string]any, 501)
	for i := range targets {
		targets[i] = map[string]any{
			"object_type": "priority", "object_id": 1, "field": "name", "fallback": "Medium",
		}
	}
	body := map[string]any{"locale": "de", "targets": targets}

	tests := []struct {
		name     string
		request  func() *http.Response
		wantCode string
	}{
		{
			name: "session",
			request: func() *http.Response {
				return MakeAuthRequestWithToken(t, server, adminCookie, http.MethodPost,
					"/admin/object-translations/resolve", body)
			},
			wantCode: restapi.ErrCodeValidationFailed,
		},
		{
			name: "bearer",
			request: func() *http.Response {
				return MakeBearerRequestWithToken(t, server, server.BearerToken, http.MethodPost,
					"/rest/api/v1/admin/object-translations/resolve", body)
			},
			wantCode: restapi.ErrCodeInvalidInput,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := tt.request()
			defer response.Body.Close()
			AssertStatusCode(t, response, http.StatusBadRequest)
			var apiError restapi.ErrorResponse
			DecodeJSON(t, response, &apiError)
			if apiError.Code != tt.wantCode || apiError.Error != "targets must contain at most 500 objects" {
				t.Fatalf("bulk-limit error = %+v, want code %q and stable message", apiError, tt.wantCode)
			}
		})
	}
}
