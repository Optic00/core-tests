package tests

import (
	"fmt"
	"net/http"
	"testing"
)

type v2FixtureRecord struct {
	ID          int    `json:"id"`
	Key         string `json:"key"`
	Title       string `json:"title"`
	Description string `json:"description"`
	WorkspaceID int    `json:"workspace_id"`
}

func TestV2EnvelopeRejectsLegacyAndMalformedResponses(t *testing.T) {
	for _, body := range []string{`{"id":1}`, `{"data":null}`, `{"error":"failure"}`, `{"data":{}} {"data":{}}`, `{"data":{},"unexpected":1}`} {
		if _, err := decodeV2Envelope([]byte(body)); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
	for _, pagination := range []string{
		`{"page_size":50,"total_items":0,"total_pages":0}`,
		`{"page":1,"total_items":0,"total_pages":0}`,
		`{"page":1,"page_size":50,"total_pages":0}`,
		`{"page":1,"page_size":50,"total_items":0}`,
		`{"page":null,"page_size":50,"total_items":0,"total_pages":0}`,
		`{"page":1,"page_size":null,"total_items":0,"total_pages":0}`,
		`{"page":1,"page_size":50,"total_items":null,"total_pages":0}`,
		`{"page":1,"page_size":50,"total_items":0,"total_pages":null}`,
	} {
		body := `{"data":[],"pagination":` + pagination + `}`
		if _, err := decodeV2Envelope([]byte(body)); err == nil {
			t.Errorf("accepted incomplete pagination %s", body)
		}
	}
	if _, err := decodeV2Envelope([]byte(`{"data":[],"pagination":{"page":1,"page_size":50,"total_items":0,"total_pages":0},"meta":{}}`)); err != nil {
		t.Fatal(err)
	}
}

// Real HTTP fixtures verify both mounts, merge-patch and the page contract.
// The shared server disables CSRF; this test does not claim CSRF coverage.
func TestV2WorkspaceItemLifecycleAndAuthenticationBoundaries(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	workspace := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, server, http.MethodPost, "/workspaces", map[string]any{"name": "V2 contract", "key": "V2CONTRACT"}), http.StatusCreated)
	if workspace.ID <= 0 || workspace.Key != "V2CONTRACT" {
		t.Fatalf("workspace=%+v", workspace)
	}
	for _, title := range []string{"First", "Second"} {
		item := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, server, http.MethodPost, "/items", map[string]any{"workspace_id": workspace.ID, "title": title, "description": "Keep this description"}), http.StatusCreated)
		if item.ID <= 0 || item.Title != title || item.WorkspaceID != workspace.ID {
			t.Fatalf("item=%+v", item)
		}
	}
	query := fmt.Sprintf("/items?workspace_id=%d&page_size=1", workspace.ID)
	first, p := DecodeV2Page[v2FixtureRecord](t, MakeV2SessionRequest(t, server, http.MethodGet, query+"&page=1", nil))
	if len(first) != 1 || p.Page != 1 || p.TotalItems != 2 || p.TotalPages != 2 {
		t.Fatalf("first=%+v pagination=%+v", first, p)
	}
	second, p := DecodeV2Page[v2FixtureRecord](t, MakeV2BearerRequest(t, server, http.MethodGet, query+"&page=2", nil))
	if len(second) != 1 || p.Page != 2 || second[0].ID == first[0].ID {
		t.Fatalf("second=%+v pagination=%+v", second, p)
	}
	path := fmt.Sprintf("/items/%d", first[0].ID)
	updated := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, server, http.MethodPatch, path, map[string]any{"title": "Changed"}), http.StatusOK)
	if updated.Title != "Changed" || updated.ID != first[0].ID {
		t.Fatalf("updated=%+v", updated)
	}
	stored := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, server, http.MethodGet, path, nil), http.StatusOK)
	if stored.Title != "Changed" || stored.ID != first[0].ID || stored.WorkspaceID != workspace.ID || stored.Description != "Keep this description" {
		t.Fatalf("stored=%+v", stored)
	}
	response := MakeV2BearerRequest(t, server, http.MethodPatch, path, map[string]any{"title": "Must not be stored", "unknown_field": true})
	AssertStatusCode(t, response, http.StatusBadRequest)
	response.Body.Close()
	afterRejection := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, server, http.MethodGet, path, nil), http.StatusOK)
	if afterRejection != stored {
		t.Fatalf("rejected patch partially changed item: before=%+v after=%+v", stored, afterRejection)
	}
	for _, tc := range []struct{ name, mount, token, cookie string }{
		{"anonymous session", "/api/v2", "", ""},
		{"anonymous bearer", "/rest/api/v2", "", ""},
		{"bearer on session", "/api/v2", server.BearerToken, ""},
		{"session on bearer", "/rest/api/v2", "", server.SessionCookie},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := makeRequest(t, http.MethodGet, server.BaseURL+tc.mount+path, tc.token, nil, map[string]string{"Cookie": tc.cookie})
			defer response.Body.Close()
			AssertStatusCode(t, response, http.StatusUnauthorized)
		})
	}
}
