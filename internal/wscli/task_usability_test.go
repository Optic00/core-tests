package wscli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"windshift/internal/wscli"
)

func runTaskUsability(t *testing.T, server *httptest.Server, args ...string) (int, string, string) {
	t.Helper()
	config := filepath.Join(t.TempDir(), "ws.toml")
	if err := os.WriteFile(config, []byte(""), 0600); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	argv := append([]string{"--config", config}, args...)
	code := wscli.Run(context.Background(), argv, nil, &out, &errOut, map[string]string{"WS_URL": server.URL, "WS_TOKEN": "synthetic-test", "WS_WORKSPACE": ""})
	return code, out.String(), errOut.String()
}

func TestTaskListAllFollowsPagesAndPreservesFilters(t *testing.T) {
	var pages []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/api/v2/items" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("milestone_id") != "7" || r.URL.Query().Get("page_size") != "2" {
			t.Errorf("filters: %s", r.URL.RawQuery)
		}
		page := r.URL.Query().Get("page")
		pages = append(pages, page)
		if page == "1" {
			fmt.Fprint(w, `{"data":[{"id":1},{"id":2}],"pagination":{"page":1,"page_size":2,"total_items":3,"total_pages":2}}`)
			return
		}
		fmt.Fprint(w, `{"data":[{"id":3}],"pagination":{"page":2,"page_size":2,"total_items":3,"total_pages":2}}`)
	}))
	defer server.Close()
	code, out, errOut := runTaskUsability(t, server, "task", "ls", "--all", "--limit", "2", "--milestone", "7")
	if code != 0 {
		t.Fatalf("run: %s", errOut)
	}
	var result wscli.PaginatedResponse[wscli.Item]
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Data) != 3 || result.Data[2].ID != 3 || strings.Join(pages, ",") != "1,2" {
		t.Fatalf("result=%s pages=%v", out, pages)
	}
}

func TestTaskListPaginationWarningDoesNotPolluteCSV(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":[{"id":1,"title":"First"}],"pagination":{"page":1,"page_size":1,"total_items":3,"total_pages":3}}`)
	}))
	defer server.Close()
	code, out, errOut := runTaskUsability(t, server, "task", "ls", "--limit", "1", "-o", "csv")
	if code != 0 || !strings.Contains(errOut, "1 of 3") || strings.Contains(out, "Showing") {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out, errOut)
	}
}

func TestTaskListAllValidatesFinalUniqueItemCount(t *testing.T) {
	for _, tc := range []struct {
		name        string
		lastIDs     []int
		total       int
		wantSuccess bool
	}{
		{"complete", []int{3}, 3, true},
		{"empty final page", nil, 3, false},
		{"duplicate final page", []int{2}, 3, false},
		{"partial final page", []int{3}, 4, false},
		{"more than advertised", []int{3}, 2, false},
		{"overlap but complete", []int{2, 3}, 3, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if requests > 2 {
					http.Error(w, "unexpected page", 500)
					return
				}
				ids := []int{1, 2}
				if requests == 2 {
					ids = tc.lastIDs
				}
				items := make([]wscli.Item, 0, len(ids))
				for _, id := range ids {
					items = append(items, wscli.Item{ID: id})
				}
				if err := json.NewEncoder(w).Encode(wscli.PaginatedResponse[wscli.Item]{Data: items, Pagination: wscli.PaginationMeta{Page: requests, PageSize: 2, TotalItems: tc.total, TotalPages: 2}}); err != nil {
					t.Error(err)
				}
			}))
			t.Cleanup(server.Close)
			code, out, errOut := runTaskUsability(t, server, "task", "ls", "--all", "--limit", "2")
			if requests != 2 || (code == 0) != tc.wantSuccess {
				t.Fatalf("requests=%d code=%d stdout=%q stderr=%q", requests, code, out, errOut)
			}
			if !tc.wantSuccess && (out != "" || !strings.Contains(errOut, "incomplete pagination")) {
				t.Fatalf("stdout=%q stderr=%q", out, errOut)
			}
			if tc.wantSuccess {
				var result wscli.PaginatedResponse[wscli.Item]
				if err := json.Unmarshal([]byte(out), &result); err != nil {
					t.Fatal(err)
				}
				if len(result.Data) != 3 || result.Data[0].ID != 1 || result.Data[1].ID != 2 || result.Data[2].ID != 3 || result.Pagination.TotalItems != 3 {
					t.Fatalf("result=%s", out)
				}
			}
		})
	}
}

func TestTaskListRejectsInvalidPaginationBeforeFetchingItems(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request %s", r.URL)
		http.NotFound(w, r)
	}))
	defer server.Close()
	for _, args := range [][]string{{"--limit", "101"}, {"--page", "0"}, {"--all", "--page", "2"}} {
		code, _, _ := runTaskUsability(t, server, append([]string{"task", "ls"}, args...)...)
		if code == 0 {
			t.Errorf("accepted %v", args)
		}
	}
}

func TestTaskStatusNameResolutionAndUnknownStatus(t *testing.T) {
	itemsCalled := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/v2/workspaces/42/statuses":
			fmt.Fprint(w, `{"data":[{"id":3,"name":"Erledigt"},{"id":4,"name":"Bereit"}]}`)
		case "/rest/api/v2/items":
			itemsCalled++
			if r.URL.Query().Get("status_id_not") != "3" {
				t.Errorf("status query=%s", r.URL.RawQuery)
			}
			fmt.Fprint(w, `{"data":[],"pagination":{"page":1,"page_size":50,"total_items":0,"total_pages":0}}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	code, _, errOut := runTaskUsability(t, server, "task", "ls", "-w", "42", "-s", "~erledigt")
	if code != 0 {
		t.Fatal(errOut)
	}
	code, _, errOut = runTaskUsability(t, server, "task", "ls", "-w", "42", "-s", "Quatsch")
	if code == 0 || !strings.Contains(errOut, "Erledigt") || itemsCalled != 1 {
		t.Fatalf("code=%d error=%s item requests=%d", code, errOut, itemsCalled)
	}
}

func TestTaskEditResolvesParentKeyAndSendsNullToClearIt(t *testing.T) {
	var parents []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/rest/api/v2/workspaces/CTX/items/9":
			fmt.Fprint(w, `{"data":{"id":99,"workspace_id":42}}`)
		case r.Method == "PATCH" && r.URL.Path == "/rest/api/v2/items/42":
			var body map[string]json.RawMessage
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			parents = append(parents, string(body["parent_id"]))
			fmt.Fprint(w, `{"data":{"id":42,"workspace_id":42}}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	for _, parent := range []string{"CTX-9", "0"} {
		code, _, errOut := runTaskUsability(t, server, "task", "edit", "42", "--parent", parent)
		if code != 0 {
			t.Fatal(errOut)
		}
	}
	if fmt.Sprint(parents) != "[99 null]" {
		t.Fatalf("parents=%v", parents)
	}
}

func TestTaskListAllHandlesEmptyAndRejectsBrokenPagination(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		wantSuccess    bool
	}{
		{"empty", `{"data":[],"pagination":{"page":1,"page_size":50,"total_items":0,"total_pages":0}}`, true},
		{"missing metadata", `{"data":[{"id":1}]}`, false},
		{"stuck on first page", `{"data":[{"id":1}],"pagination":{"page":1,"page_size":1,"total_items":2,"total_pages":2}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if requests > 2 {
					t.Error("pagination did not stop")
					http.Error(w, "loop", 500)
					return
				}
				fmt.Fprint(w, tc.response)
			}))
			defer server.Close()
			code, out, errOut := runTaskUsability(t, server, "task", "ls", "--all")
			if (code == 0) != tc.wantSuccess {
				t.Fatalf("code=%d out=%s err=%s", code, out, errOut)
			}
			if tc.wantSuccess && !strings.Contains(out, `"data": []`) {
				t.Fatalf("empty result=%s", out)
			}
		})
	}
}

func TestTaskListRejectsWrongSinglePage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") != "3" {
			t.Errorf("page=%s", r.URL.RawQuery)
		}
		fmt.Fprint(w, `{"data":[{"id":1}],"pagination":{"page":1,"page_size":1,"total_items":3,"total_pages":3}}`)
	}))
	t.Cleanup(server.Close)
	code, out, errOut := runTaskUsability(t, server, "task", "ls", "--page", "3", "--limit", "1")
	if code == 0 || out != "" || !strings.Contains(errOut, "invalid pagination") {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out, errOut)
	}
}

func TestTaskMilestoneNameSearchesAllPagesWithoutFuzzyMatch(t *testing.T) {
	var milestonePages []string
	itemsCalled := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/v2/workspaces/42/milestones":
			page := r.URL.Query().Get("page")
			milestonePages = append(milestonePages, page)
			if page == "1" {
				fmt.Fprint(w, `{"data":[{"id":6,"name":"Q4 planning"}],"pagination":{"page":1,"page_size":100,"total_items":101,"total_pages":2}}`)
			} else {
				fmt.Fprint(w, `{"data":[{"id":7,"name":"Q4"}],"pagination":{"page":2,"page_size":100,"total_items":101,"total_pages":2}}`)
			}
		case "/rest/api/v2/items":
			itemsCalled++
			if r.URL.Query().Get("milestone_id") != "7" {
				t.Errorf("filter=%s", r.URL.RawQuery)
			}
			fmt.Fprint(w, `{"data":[],"pagination":{"page":1,"total_pages":0}}`)
		default:
			t.Errorf("unexpected request %s", r.URL)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	code, _, errOut := runTaskUsability(t, server, "task", "ls", "-w", "42", "--milestone", "q4")
	if code != 0 || strings.Join(milestonePages, ",") != "1,2" {
		t.Fatalf("code=%d err=%s pages=%v", code, errOut, milestonePages)
	}
	code, _, errOut = runTaskUsability(t, server, "task", "ls", "-w", "42", "--milestone", "planning")
	if code == 0 || !strings.Contains(errOut, "not found") || itemsCalled != 1 {
		t.Fatalf("code=%d err=%s requests=%d", code, errOut, itemsCalled)
	}
}
