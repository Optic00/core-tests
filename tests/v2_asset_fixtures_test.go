package tests

import (
	"fmt"
	"net/http"
	"testing"
)

// Asset tests opt into granular scopes explicitly; account bootstrap still
// uses its retained session API. This helper is also used by the CLI fixture.
func adminAssetToken(t *testing.T, ts *TestServer) string {
	t.Helper()
	return createTokenWithScopesAsUser(t, ts, "admin", "testpass123", []string{"assets:read", "assets:write", "assets:delete"})
}

func seedAssetSetAndType(t *testing.T, ts *TestServer, suffix string) (setID, assetTypeID int) {
	t.Helper()
	setID = DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, "/asset-sets", map[string]any{
		"name": "Asset API test " + suffix, "description": "Asset fixture",
	}), http.StatusCreated).ID
	assetTypeID = DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, fmt.Sprintf("/asset-sets/%d/types", setID), map[string]any{
		"name": "Laptop", "description": "Fixture asset type", "icon": "Laptop", "color": "#1f6feb",
	}), http.StatusCreated).ID
	if setID <= 0 || assetTypeID <= 0 {
		t.Fatal("asset fixture needs positive set/type IDs")
	}
	return setID, assetTypeID
}

func addRequiredFieldToType(t *testing.T, ts *TestServer, assetTypeID int, name, fieldType string) int {
	t.Helper()
	// Custom-field definitions retain their admin configuration endpoint.
	fieldID := CreateTestCustomField(t, ts, name, fieldType, "")
	fields := DecodeV2Document[[]struct {
		CustomFieldID int  `json:"custom_field_id"`
		IsRequired    bool `json:"is_required"`
	}](t, MakeV2SessionRequest(t, ts, http.MethodPut, fmt.Sprintf("/asset-types/%d/fields", assetTypeID), map[string]any{
		"fields": []map[string]any{{"custom_field_id": fieldID, "is_required": true, "display_order": 0}},
	}), http.StatusOK)
	if len(fields) != 1 || fields[0].CustomFieldID != fieldID || !fields[0].IsRequired {
		t.Fatalf("required asset field assignment = %+v", fields)
	}
	return fieldID
}

func getAssetRoleID(t *testing.T, ts *TestServer, name string) int {
	t.Helper()
	roles := DecodeV2Document[[]struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}](t, MakeV2SessionRequest(t, ts, http.MethodGet, "/asset-roles", nil), http.StatusOK)
	for _, role := range roles {
		if role.Name == name && role.ID > 0 {
			return role.ID
		}
	}
	t.Fatalf("asset role %q not found", name)
	return 0
}

func assignAssetSetRole(t *testing.T, ts *TestServer, setID, userID, roleID int) {
	t.Helper()
	result := DecodeV2Document[struct {
		Assigned bool `json:"assigned"`
	}](t, MakeV2SessionRequest(t, ts, http.MethodPost, fmt.Sprintf("/asset-sets/%d/roles", setID), map[string]any{
		"user_id": userID, "role_id": roleID,
	}), http.StatusCreated)
	if !result.Assigned {
		t.Fatal("asset role assignment not confirmed")
	}
}

func assertCreatorEmailAbsent(t *testing.T, asset map[string]any) {
	t.Helper()
	if creator, ok := asset["creator"].(map[string]any); ok {
		if email, present := creator["email"]; present && email != "" {
			t.Fatal("asset response exposes nested creator email")
		}
	}
}

// Omitting permissions exercises the same default mint as ws init.
func createTokenWithDefaultScopes(t *testing.T, ts *TestServer, username, password string) string {
	t.Helper()
	login := makeRequest(t, http.MethodPost, ts.APIBase+"/auth/login", "", map[string]string{"email_or_username": username, "password": password}, nil)
	defer login.Body.Close()
	AssertStatusCode(t, login, http.StatusOK)
	var cookie string
	for _, candidate := range login.Cookies() {
		if candidate.Name == "session" || candidate.Name == "windshift_session" {
			cookie = candidate.String()
			break
		}
	}
	if cookie == "" {
		t.Fatal("default-token login did not set a session cookie")
	}
	response := makeRequest(t, http.MethodPost, ts.APIBase+"/api-tokens", "", map[string]any{"name": "default-mint-" + username}, map[string]string{"Cookie": cookie})
	defer response.Body.Close()
	AssertStatusCode(t, response, http.StatusOK)
	var result struct {
		Token string `json:"token"`
	}
	DecodeJSON(t, response, &result)
	if result.Token == "" {
		t.Fatal("default mint returned no token")
	}
	return result.Token
}
