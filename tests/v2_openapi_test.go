package tests

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestV2OpenAPI_PublicJSONDiscovery(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	for _, prefix := range []string{"/rest/api/v1", "/api/v2", "/rest/api/v2"} {
		t.Run(prefix, func(t *testing.T) {
			response := makeRequest(t, http.MethodGet, server.BaseURL+prefix+"/openapi.json", "", nil, nil)
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status=%d", response.StatusCode)
			}
			assertCommentJSON(t, response)
			if response.Header.Get("Cache-Control") != "public, max-age=300" {
				t.Fatalf("cache control=%q", response.Header.Get("Cache-Control"))
			}
			var doc struct {
				OpenAPI string                     `json:"openapi"`
				Paths   map[string]json.RawMessage `json:"paths"`
			}
			if err := json.NewDecoder(response.Body).Decode(&doc); err != nil {
				t.Fatal(err)
			}
			if doc.OpenAPI == "" || len(doc.Paths) == 0 {
				t.Fatalf("empty discovery document: %+v", doc)
			}
			if prefix == "/rest/api/v1" {
				return
			}
			if _, ok := doc.Paths["/items"]; !ok {
				t.Fatal("v2 item path missing")
			}
			etag := response.Header.Get("ETag")
			if etag == "" {
				t.Fatal("v2 ETag missing")
			}
			cached := makeRequest(t, http.MethodGet, server.BaseURL+prefix+"/openapi.json", "", nil, map[string]string{"If-None-Match": etag})
			defer cached.Body.Close()
			body, err := io.ReadAll(cached.Body)
			if err != nil {
				t.Fatal(err)
			}
			if cached.StatusCode != http.StatusNotModified || len(body) != 0 || cached.Header.Get("ETag") != etag {
				t.Fatalf("conditional response=%d etag=%q body=%s", cached.StatusCode, cached.Header.Get("ETag"), body)
			}
			stale := makeRequest(t, http.MethodGet, server.BaseURL+prefix+"/openapi.json", "", nil, map[string]string{"If-None-Match": `"stale"`})
			defer stale.Body.Close()
			var refreshed struct {
				OpenAPI string                     `json:"openapi"`
				Paths   map[string]json.RawMessage `json:"paths"`
			}
			if stale.StatusCode != http.StatusOK || stale.Header.Get("ETag") != etag {
				t.Fatalf("stale validator response=%d etag=%q", stale.StatusCode, stale.Header.Get("ETag"))
			}
			if err := json.NewDecoder(stale.Body).Decode(&refreshed); err != nil {
				t.Fatal(err)
			}
			if refreshed.OpenAPI != doc.OpenAPI || len(refreshed.Paths) != len(doc.Paths) {
				t.Fatalf("stale validator did not return discovery document")
			}
		})
	}
}

// YAML discovery was removed; JSON is the supported public discovery format.
func TestV2OpenAPI_RemovedYAMLIsNotServed(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	for _, prefix := range []string{"/rest/api/v1", "/api/v2", "/rest/api/v2"} {
		t.Run(prefix, func(t *testing.T) {
			assertCommentStatus(t, makeRequest(t, http.MethodGet, server.BaseURL+prefix+"/openapi.yaml", "", nil, nil), http.StatusNotFound)
		})
	}
}
