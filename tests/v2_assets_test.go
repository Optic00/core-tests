package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

type v2AssetFixture struct {
	admin, caller *TestServer
	setID, typeID int
}

func newV2AssetFixture(t *testing.T) *v2AssetFixture {
	t.Helper()
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	setID, typeID := seedAssetSetAndType(t, ts, t.Name())
	caller := *ts
	caller.SessionCookie = ""
	caller.BearerToken = adminAssetToken(t, ts)
	return &v2AssetFixture{admin: ts, caller: &caller, setID: setID, typeID: typeID}
}

func (f *v2AssetFixture) collection() string { return fmt.Sprintf("/asset-sets/%d/assets", f.setID) }

func (f *v2AssetFixture) create(t *testing.T, title string, values map[string]any) map[string]any {
	t.Helper()
	return DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, f.caller, http.MethodPost, f.collection(), map[string]any{
		"title": title, "asset_type_id": f.typeID, "custom_field_values": values,
	}), http.StatusCreated)
}

func (f *v2AssetFixture) get(t *testing.T, id int) map[string]any {
	t.Helper()
	return DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, f.caller, http.MethodGet, fmt.Sprintf("/assets/%d", id), nil), http.StatusOK)
}

func (f *v2AssetFixture) assertCount(t *testing.T, count int) {
	t.Helper()
	items, page := DecodeV2Page[v2FixtureRecord](t, MakeV2BearerRequest(t, f.caller, http.MethodGet, f.collection(), nil))
	if len(items) != count || page.TotalItems != count {
		t.Fatalf("asset count=%d total=%d, want %d", len(items), page.TotalItems, count)
	}
}

func expectAssetError(t *testing.T, response *http.Response, status int, code string, messages ...string) {
	t.Helper()
	defer response.Body.Close()
	AssertStatusCode(t, response, status)
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	DecodeJSON(t, response, &body)
	if body.Error.Code != code {
		t.Fatalf("asset error code=%q, want %q", body.Error.Code, code)
	}
	for _, message := range messages {
		if !strings.Contains(body.Error.Message, message) {
			t.Fatalf("asset error message=%q, want substring %q", body.Error.Message, message)
		}
	}
}

func TestV2Assets_HappyPath_AdminToken(t *testing.T) {
	f := newV2AssetFixture(t)
	f.assertCount(t, 0)
	created := DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, f.caller, http.MethodPost, f.collection(), map[string]any{
		"title": "Lenovo X1", "description": "Carbon Gen 11", "asset_tag": "LAP-001", "asset_type_id": f.typeID,
	}), http.StatusCreated)
	id := ExtractIDFromResponse(t, created)
	for _, asset := range []map[string]any{created, f.get(t, id)} {
		AssertJSONField(t, asset, "title", "Lenovo X1")
		AssertJSONField(t, asset, "asset_tag", "LAP-001")
		AssertJSONField(t, asset, "set_id", float64(f.setID))
	}
	path := fmt.Sprintf("/assets/%d", id)
	updated := DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, f.caller, http.MethodPatch, path, map[string]any{"title": "Lenovo X1 Carbon"}), http.StatusOK)
	stored := DecodeV2Document[map[string]any](t, MakeV2SessionRequest(t, f.admin, http.MethodGet, path, nil), http.StatusOK)
	for _, asset := range []map[string]any{updated, stored} {
		AssertJSONField(t, asset, "title", "Lenovo X1 Carbon")
		AssertJSONField(t, asset, "asset_tag", "LAP-001")
		AssertJSONField(t, asset, "description", "Carbon Gen 11")
	}
	f.assertCount(t, 1)
	sets, _ := DecodeV2Page[v2FixtureRecord](t, MakeV2BearerRequest(t, f.caller, http.MethodGet, "/asset-sets", nil))
	found := false
	for _, set := range sets {
		if set.ID == f.setID {
			found = true
		}
	}
	if !found {
		t.Fatalf("set %d absent from browse", f.setID)
	}
	types, typePage := DecodeV2Page[v2FixtureRecord](t, MakeV2BearerRequest(t, f.caller, http.MethodGet, fmt.Sprintf("/asset-sets/%d/types", f.setID), nil))
	if len(types) != 1 || typePage.TotalItems != 1 || types[0].ID != f.typeID {
		t.Fatalf("asset types=%+v", types)
	}
	deleted := MakeV2BearerRequest(t, f.caller, http.MethodDelete, path, nil)
	AssertStatusCode(t, deleted, http.StatusNoContent)
	deleted.Body.Close()
	expectAssetError(t, MakeV2BearerRequest(t, f.caller, http.MethodGet, path, nil), http.StatusNotFound, "not_found", "")
	f.assertCount(t, 0)
}

func TestV2Assets_TokenScopeEnforcement(t *testing.T) {
	f := newV2AssetFixture(t)
	userID, username, password := CreateTestUserWithCredentials(t, f.admin, "asset-scopes", "asset-scopes@example.test")
	assignAssetSetRole(t, f.admin, f.setID, userID, getAssetRoleID(t, f.admin, "Editor"))
	actor := func(scopes []string) *TestServer {
		copy := *f.admin
		copy.SessionCookie = ""
		copy.BearerToken = createTokenWithScopesAsUser(t, f.admin, username, password, scopes)
		return &copy
	}
	read, write, noScope := actor([]string{"assets:read"}), actor([]string{"assets:write"}), actor([]string{"items:read"})
	body := map[string]any{"title": "Scoped asset", "asset_type_id": f.typeID}
	expectAssetError(t, MakeV2BearerRequest(t, noScope, http.MethodGet, f.collection(), nil), http.StatusForbidden, "insufficient_permission", "")
	expectAssetError(t, MakeV2BearerRequest(t, read, http.MethodPost, f.collection(), body), http.StatusForbidden, "insufficient_permission", "")
	f.assertCount(t, 0)
	// A write-only token implies read, but never delete. Positive controls use
	// the same non-admin user and actual set role as the scope denials above.
	created := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, write, http.MethodPost, f.collection(), body), http.StatusCreated)
	path := fmt.Sprintf("/assets/%d", created.ID)
	for _, caller := range []*TestServer{read, write} {
		got := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, caller, http.MethodGet, path, nil), http.StatusOK)
		if got.ID != created.ID || got.Title != "Scoped asset" {
			t.Fatalf("scoped read=%+v", got)
		}
	}
	expectAssetError(t, MakeV2BearerRequest(t, write, http.MethodDelete, path, nil), http.StatusForbidden, "insufficient_permission", "")
	AssertJSONField(t, f.get(t, created.ID), "title", "Scoped asset")
	// Default mint must demonstrably allow both read and write, not merely avoid
	// one historical error string. Destructive scope remains opt-in.
	defaultActor := *write
	defaultActor.BearerToken = createTokenWithDefaultScopes(t, f.admin, username, password)
	items, _ := DecodeV2Page[v2FixtureRecord](t, MakeV2BearerRequest(t, &defaultActor, http.MethodGet, f.collection(), nil))
	if len(items) != 1 || items[0].ID != created.ID {
		t.Fatalf("default read=%+v", items)
	}
	defaultCreated := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, &defaultActor, http.MethodPost, f.collection(), body), http.StatusCreated)
	defaultPath := fmt.Sprintf("/assets/%d", defaultCreated.ID)
	expectAssetError(t, MakeV2BearerRequest(t, &defaultActor, http.MethodDelete, defaultPath, nil), http.StatusForbidden, "insufficient_permission", "")
	AssertJSONField(t, f.get(t, defaultCreated.ID), "title", "Scoped asset")
	f.assertCount(t, 2)
}

func TestV2Assets_SetPermissionsAreIndependentOfTokenScopes(t *testing.T) {
	for _, bearer := range []bool{false, true} {
		for _, role := range []struct {
			name                string
			read, write, delete bool
		}{{"", false, false, false}, {"Viewer", true, false, false}, {"Editor", true, true, false}, {"Administrator", true, true, true}} {
			t.Run(fmt.Sprintf("bearer=%t/role=%s", bearer, role.name), func(t *testing.T) {
				f := newV2AssetFixture(t)
				id := ExtractIDFromResponse(t, f.create(t, "Protected asset", nil))
				path := fmt.Sprintf("/assets/%d", id)
				uid, username, password := CreateTestUserWithCredentials(t, f.admin, "asset-role-user", "asset-role@example.test")
				if role.name != "" {
					assignAssetSetRole(t, f.admin, f.setID, uid, getAssetRoleID(t, f.admin, role.name))
				}
				actor := *f.admin
				actor.SessionCookie, actor.BearerToken = CreateAuthCredentialsForUser(t, f.admin, username, password)
				request := func(method, path string, body any) *http.Response {
					if bearer {
						return MakeV2BearerRequest(t, &actor, method, path, body)
					}
					return MakeV2SessionRequest(t, &actor, method, path, body)
				}
				if role.read {
					got := DecodeV2Document[v2FixtureRecord](t, request(http.MethodGet, path, nil), http.StatusOK)
					if got.ID != id || got.Title != "Protected asset" {
						t.Fatalf("role read=%+v", got)
					}
					items, page := DecodeV2Page[v2FixtureRecord](t, request(http.MethodGet, f.collection(), nil))
					if len(items) != 1 || page.TotalItems != 1 || items[0].ID != id {
						t.Fatal("role list lost the target asset")
					}
				} else {
					expectAssetError(t, request(http.MethodGet, path, nil), http.StatusNotFound, "not_found", "")
					expectAssetError(t, request(http.MethodGet, f.collection(), nil), http.StatusNotFound, "not_found", "")
				}
				create := request(http.MethodPost, f.collection(), map[string]any{"title": "Role created", "asset_type_id": f.typeID})
				update := request(http.MethodPatch, path, map[string]any{"title": "Role updated"})
				wantCount := 1
				wantTitle := "Protected asset"
				if role.write {
					created := DecodeV2Document[v2FixtureRecord](t, create, http.StatusCreated)
					updated := DecodeV2Document[v2FixtureRecord](t, update, http.StatusOK)
					if created.ID <= 0 || created.ID == id || created.Title != "Role created" || updated.ID != id || updated.Title != "Role updated" {
						t.Fatal("allowed asset writes returned wrong identity or title")
					}
					AssertJSONField(t, f.get(t, created.ID), "title", "Role created")
					wantCount++
					wantTitle = "Role updated"
				} else {
					expectAssetError(t, create, http.StatusNotFound, "not_found", "")
					expectAssetError(t, update, http.StatusNotFound, "not_found", "")
				}
				AssertJSONField(t, f.get(t, id), "title", wantTitle)
				deleted := request(http.MethodDelete, path, nil)
				if role.delete {
					AssertStatusCode(t, deleted, http.StatusNoContent)
					deleted.Body.Close()
					expectAssetError(t, MakeV2BearerRequest(t, f.caller, http.MethodGet, path, nil), http.StatusNotFound, "not_found", "")
					wantCount--
				} else {
					expectAssetError(t, deleted, http.StatusNotFound, "not_found", "")
					AssertJSONField(t, f.get(t, id), "title", wantTitle)
				}
				f.assertCount(t, wantCount)
			})
		}
	}
}

func TestV2Assets_UnknownCustomFieldKeyRejected(t *testing.T) {
	f := newV2AssetFixture(t)
	expectAssetError(t, MakeV2BearerRequest(t, f.caller, http.MethodPost, f.collection(), map[string]any{
		"title": "BadFields", "asset_type_id": f.typeID, "custom_field_values": map[string]any{"not_a_real_field": "x"},
	}), http.StatusBadRequest, "invalid_request", "not_a_real_field")
	f.assertCount(t, 0)
}

func assetAuditEntries(t *testing.T, admin *TestServer, assetID int) []map[string]any {
	t.Helper()
	response := MakeAuthRequest(t, admin, http.MethodGet, "/admin/audit-logs?resource_type=asset&per_page=100", nil)
	defer response.Body.Close()
	AssertStatusCode(t, response, http.StatusOK)
	var result struct {
		Entries []map[string]any `json:"entries"`
	}
	DecodeJSON(t, response, &result)
	var rows []map[string]any
	for _, row := range result.Entries {
		if row["resource_id"] == float64(assetID) {
			rows = append(rows, row)
		}
	}
	return rows
}

func TestV2Assets_MutationsEmitAudit(t *testing.T) {
	f := newV2AssetFixture(t)
	id := ExtractIDFromResponse(t, f.create(t, "AuditMe", nil))
	path := fmt.Sprintf("/assets/%d", id)
	updated := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, f.caller, http.MethodPatch, path, map[string]any{"title": "AuditMe updated"}), http.StatusOK)
	if updated.ID != id || updated.Title != "AuditMe updated" {
		t.Fatalf("updated=%+v", updated)
	}
	deleted := MakeV2BearerRequest(t, f.caller, http.MethodDelete, path, nil)
	AssertStatusCode(t, deleted, http.StatusNoContent)
	deleted.Body.Close()
	want := map[string]int{"asset.create": 1, "asset.update": 1, "asset.delete": 1}
	for _, row := range assetAuditEntries(t, f.admin, id) {
		action, _ := row["action_type"].(string)
		if _, tracked := want[action]; tracked {
			want[action]--
		}
	}
	for action, remaining := range want {
		if remaining != 0 {
			t.Fatalf("audit action %s count differs from one by %d", action, remaining)
		}
	}
}

func TestV2Assets_XSSSanitized(t *testing.T) {
	f := newV2AssetFixture(t)
	created := DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, f.caller, http.MethodPost, f.collection(), map[string]any{
		"title": "<script>alert(1)</script>SafeTitle", "description": "Before<script>evil()</script>After",
		"asset_tag": "<img src=x onerror=alert(1)>TAG-001", "asset_type_id": f.typeID,
	}), http.StatusCreated)
	id := ExtractIDFromResponse(t, created)
	check := func(asset map[string]any) {
		t.Helper()
		for field, want := range map[string]string{"title": "SafeTitle", "description": "BeforeAfter", "asset_tag": "TAG-001"} {
			AssertJSONField(t, asset, field, want)
		}
	}
	check(created)
	check(f.get(t, id))
	// Exercise PATCH as well as the create/read coverage retained from v1.
	updated := DecodeV2Document[map[string]any](t, MakeV2BearerRequest(t, f.caller, http.MethodPatch, fmt.Sprintf("/assets/%d", id), map[string]any{
		"title": "<script>evil()</script>SafeTitle", "description": "Before<script>evil()</script>After", "asset_tag": "<img src=x onerror=evil()>TAG-001",
	}), http.StatusOK)
	check(updated)
	check(f.get(t, id))
}

func TestV2Assets_BearerAuditAttribution(t *testing.T) {
	f := newV2AssetFixture(t)
	id := ExtractIDFromResponse(t, f.create(t, "Attributed asset", nil))
	var rows []map[string]any
	for _, row := range assetAuditEntries(t, f.admin, id) {
		if row["action_type"] == "asset.create" {
			rows = append(rows, row)
		}
	}
	if len(rows) != 1 {
		t.Fatalf("asset create audit count=%d, want one", len(rows))
	}
	details, _ := rows[0]["details"].(map[string]any)
	if details["auth_method"] != "bearer" {
		t.Fatal("asset audit is not attributed to bearer authentication")
	}
	if tokenID, _ := details["api_token_id"].(float64); tokenID <= 0 {
		t.Fatal("asset audit lacks a positive token ID")
	}
	prefix, _ := details["api_token_prefix"].(string)
	// TokenPrefix is a display value with a trailing ellipsis, not raw bytes.
	if len(prefix) <= 3 || !strings.HasSuffix(prefix, "...") || !strings.HasPrefix(f.caller.BearerToken, strings.TrimSuffix(prefix, "...")) {
		t.Fatal("asset audit prefix does not match the acting token")
	}
}

func TestV2Assets_CustomFieldRequiredEnforcedOnCreate(t *testing.T) {
	f := newV2AssetFixture(t)
	fieldID := addRequiredFieldToType(t, f.admin, f.typeID, "hostname", "text")
	response := MakeV2BearerRequest(t, f.caller, http.MethodPost, f.collection(), map[string]any{"title": "Missing hostname", "asset_type_id": f.typeID})
	expectAssetError(t, response, http.StatusBadRequest, "invalid_request", "hostname", "required")
	f.assertCount(t, 0)
	values := map[string]any{fmt.Sprint(fieldID): "host01"}
	created := f.create(t, "With hostname", values)
	for _, asset := range []map[string]any{created, f.get(t, ExtractIDFromResponse(t, created))} {
		stored, _ := asset["custom_field_values"].(map[string]any)
		if stored[fmt.Sprint(fieldID)] != "host01" {
			t.Fatal("required hostname was not persisted")
		}
	}
}

func TestV2Assets_CustomFieldTypeMismatchRejected(t *testing.T) {
	f := newV2AssetFixture(t)
	fieldID := addRequiredFieldToType(t, f.admin, f.typeID, "cpu_cores", "number")
	expectAssetError(t, MakeV2BearerRequest(t, f.caller, http.MethodPost, f.collection(), map[string]any{
		"title": "TypeMismatch", "asset_type_id": f.typeID, "custom_field_values": map[string]any{fmt.Sprint(fieldID): "not-a-number"},
	}), http.StatusBadRequest, "invalid_request", fmt.Sprintf("custom_field_values[%q]: expected numeric value", fmt.Sprint(fieldID)))
	f.assertCount(t, 0)
	created := f.create(t, "Valid number", map[string]any{fmt.Sprint(fieldID): 8})
	stored, _ := f.get(t, ExtractIDFromResponse(t, created))["custom_field_values"].(map[string]any)
	if stored[fmt.Sprint(fieldID)] != float64(8) {
		t.Fatal("valid numeric field was not persisted")
	}
}
