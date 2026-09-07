package tests

import (
	"fmt"
	"net/http"
	"testing"
)

func TestFixtureAdminIdentity(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	want := DecodeV2Document[UserFx](t, MakeV2BearerRequest(t, ts, http.MethodGet, "/users/me", nil), http.StatusOK)
	got := lookupAdminUser(t, ts)
	if got.ID <= 0 || got.Username != "admin" || got != want {
		t.Fatalf("admin fixture = %+v, authenticated bearer user = %+v", got, want)
	}
}

func TestFixtureWorkspaceLockdownRemovesImplicitAccess(t *testing.T) {
	ts, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, ts)
	workspace := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, ts, http.MethodPost, "/workspaces", map[string]any{
		"name": "Lockdown fixture", "key": "LOCKDOWN",
	}), http.StatusCreated)
	userID, username, password := CreateTestUserWithCredentials(t, ts, "lockdown_outsider", "lockdown@example.test")
	outsider := *ts
	outsider.SessionCookie = ""
	outsider.BearerToken = createTokenWithScopesAsUser(t, ts, username, password, []string{"workspaces:read"})
	path := fmt.Sprintf("/workspaces/%d", workspace.ID)
	if got := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, &outsider, http.MethodGet, path, nil), http.StatusOK); got.ID != workspace.ID {
		t.Fatalf("open workspace = %+v", got)
	}
	LockDownWorkspace(t, ts, workspace.ID)
	denied := MakeV2BearerRequest(t, &outsider, http.MethodGet, path, nil)
	AssertStatusCode(t, denied, http.StatusNotFound)
	denied.Body.Close()
	// An explicit grant restores access on the same route with the same token.
	AssignWorkspaceRole(t, ts, userID, workspace.ID, "Viewer")
	if got := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, &outsider, http.MethodGet, path, nil), http.StatusOK); got.ID != workspace.ID {
		t.Fatalf("explicitly granted workspace = %+v", got)
	}
}
