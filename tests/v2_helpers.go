package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// These helpers address v2 explicitly. Bootstrap, authentication, portal and
// other retained legacy routes continue to use the existing helpers.
func MakeV2SessionRequest(t *testing.T, server *TestServer, method, endpoint string, body any) *http.Response {
	t.Helper()
	return makeSessionRequest(t, method, v2URL(t, server, "/api/v2", endpoint), server.SessionCookie, body, v2Headers(method))
}

func MakeV2BearerRequest(t *testing.T, server *TestServer, method, endpoint string, body any) *http.Response {
	t.Helper()
	return makeRequest(t, method, v2URL(t, server, "/rest/api/v2", endpoint), server.BearerToken, body, v2Headers(method))
}

func v2URL(t *testing.T, server *TestServer, prefix, endpoint string) string {
	t.Helper()
	if !strings.HasPrefix(endpoint, "/") || strings.HasPrefix(endpoint, "//") {
		t.Fatalf("v2 endpoint must be an absolute path within its mount: %q", endpoint)
	}
	return server.BaseURL + prefix + endpoint
}

func v2Headers(method string) map[string]string {
	if method == http.MethodPatch {
		return map[string]string{"Content-Type": "application/merge-patch+json"}
	}
	return nil
}

type V2Pagination struct {
	Page       int `json:"page"`
	PageSize   int `json:"page_size"`
	TotalItems int `json:"total_items"`
	TotalPages int `json:"total_pages"`
}

func (p *V2Pagination) UnmarshalJSON(body []byte) error {
	var fields struct {
		Page       *int `json:"page"`
		PageSize   *int `json:"page_size"`
		TotalItems *int `json:"total_items"`
		TotalPages *int `json:"total_pages"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fields); err != nil {
		return err
	}
	if fields.Page == nil || fields.PageSize == nil || fields.TotalItems == nil || fields.TotalPages == nil {
		return fmt.Errorf("all four v2 pagination fields must be present and non-null")
	}
	*p = V2Pagination{Page: *fields.Page, PageSize: *fields.PageSize, TotalItems: *fields.TotalItems, TotalPages: *fields.TotalPages}
	return nil
}

type v2Envelope struct {
	Data       json.RawMessage `json:"data"`
	Pagination *V2Pagination   `json:"pagination,omitempty"`
	Meta       json.RawMessage `json:"meta,omitempty"`
}

func decodeV2Envelope(body []byte) (v2Envelope, error) {
	var result v2Envelope
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return result, fmt.Errorf("expected a single JSON document")
	}
	if len(result.Data) == 0 || bytes.Equal(result.Data, []byte("null")) {
		return result, fmt.Errorf("v2 response is missing non-null data")
	}
	return result, nil
}

func readV2Envelope(t *testing.T, response *http.Response, status int) v2Envelope {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status {
		t.Fatalf("expected HTTP %d, got %d: %s", status, response.StatusCode, body)
	}
	result, err := decodeV2Envelope(body)
	if err != nil {
		t.Fatalf("invalid v2 envelope: %v; body: %s", err, body)
	}
	return result
}

func DecodeV2Document[T any](t *testing.T, response *http.Response, status int) T {
	t.Helper()
	envelope := readV2Envelope(t, response, status)
	if envelope.Pagination != nil {
		t.Fatal("expected a document, got a page")
	}
	var result T
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func DecodeV2Page[T any](t *testing.T, response *http.Response) ([]T, V2Pagination) {
	t.Helper()
	envelope := readV2Envelope(t, response, http.StatusOK)
	p := envelope.Pagination
	if p == nil || p.Page < 1 || p.PageSize < 1 || p.TotalItems < 0 || p.TotalPages < 0 {
		t.Fatal("missing or invalid v2 pagination")
	}
	wantPages := p.TotalItems / p.PageSize
	if p.TotalItems%p.PageSize != 0 {
		wantPages++
	}
	if p.TotalPages != wantPages {
		t.Fatalf("pagination total_pages=%d, want %d", p.TotalPages, wantPages)
	}
	var result []T
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		t.Fatal(err)
	}
	if len(result) > p.PageSize {
		t.Fatal("page exceeds page_size")
	}
	return result, *p
}
