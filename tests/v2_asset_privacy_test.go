package tests

import (
	"fmt"
	"net/http"
	"testing"
)

func TestV2Assets_CreatorEmailHidden(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	setID, assetTypeID := seedAssetSetAndType(t, ts, "privacy-v2")
	caller := *ts
	caller.SessionCookie = ""
	caller.BearerToken = adminAssetToken(t, ts)
	// The fixture has a real email, but this token cannot read the user API.
	creator := DecodeV2Document[struct {
		ID    int    `json:"id"`
		Email string `json:"email"`
	}](t, MakeV2SessionRequest(t, ts, http.MethodGet, "/users/me", nil), http.StatusOK)
	if creator.ID <= 0 || creator.Email == "" {
		t.Fatal("creator fixture requires a positive ID and nonempty email")
	}
	denied := MakeV2BearerRequest(t, &caller, http.MethodGet, "/users/me", nil)
	AssertStatusCode(t, denied, http.StatusForbidden)
	denied.Body.Close()
	for _, mount := range []string{"session", "bearer"} {
		t.Run(mount, func(t *testing.T) {
			request := func(method, path string, body any) *http.Response {
				if mount == "session" {
					return MakeV2SessionRequest(t, ts, method, path, body)
				}
				return MakeV2BearerRequest(t, &caller, method, path, body)
			}
			check := func(asset map[string]any, id int, title string) {
				t.Helper()
				if asset["id"] != float64(id) || asset["created_by"] != float64(creator.ID) || asset["title"] != title || asset["set_id"] != float64(setID) {
					t.Fatal("asset response lost identity, title, set or creator ID")
				}
				if name, ok := asset["creator_name"].(string); !ok || name == "" {
					t.Fatal("asset response lost the creator name")
				}
				if _, present := asset["creator_email"]; present {
					t.Error("asset response exposes creator_email")
				}
				assertCreatorEmailAbsent(t, asset)
			}
			collection := fmt.Sprintf("/asset-sets/%d/assets", setID)
			created := DecodeV2Document[map[string]any](t, request(http.MethodPost, collection,
				map[string]any{"title": "Privacy", "asset_type_id": assetTypeID}), http.StatusCreated)
			id := ExtractIDFromResponse(t, created)
			check(created, id, "Privacy")
			path := fmt.Sprintf("/assets/%d", id)
			check(DecodeV2Document[map[string]any](t, request(http.MethodGet, path, nil), http.StatusOK), id, "Privacy")
			check(DecodeV2Document[map[string]any](t, request(http.MethodPatch, path, map[string]any{"title": "Updated"}), http.StatusOK), id, "Updated")
			items, pagination := DecodeV2Page[map[string]any](t, request(http.MethodGet, collection, nil))
			if len(items) != 1 || pagination.TotalItems != 1 {
				t.Fatalf("asset list size=%d total=%d, want one", len(items), pagination.TotalItems)
			}
			check(items[0], id, "Updated")
			deleted := request(http.MethodDelete, path, nil)
			AssertStatusCode(t, deleted, http.StatusNoContent)
			deleted.Body.Close()
		})
	}
}
