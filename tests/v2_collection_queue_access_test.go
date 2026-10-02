package tests

import (
	"fmt"
	"net/http"
	"testing"
)

func TestV2PublicCollectionQueuesRequireWorkspaceMembership(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)
	key := shortKey("QPUBLIC")
	workspaceID, _ := CreateTestWorkspace(t, server, "Restricted public queue", key)
	memberID, _, _ := CreateTestUserWithCredentials(t, server, "queue_member", "queue_member@example.test")
	AssignWorkspaceRole(t, server, memberID, workspaceID, "Viewer")
	_, outsiderName, outsiderPassword := CreateTestUserWithCredentials(t, server, "queue_outsider", "queue_outsider@example.test")
	outsiderCookie := CreateBearerTokenForUser(t, server, outsiderName, outsiderPassword)

	created := DecodeV2Document[struct {
		ID int `json:"id"`
	}](t,
		MakeV2SessionRequest(t, server, http.MethodPost, "/collections", map[string]any{
			"name": "Public queue scope", "workspace_id": workspaceID,
			"ql_query":  fmt.Sprintf(`workspaceKey = "%s"`, key),
			"is_public": true, "public_slug": "public-queue-scope",
		}), http.StatusCreated)
	path := fmt.Sprintf("/v2/collections/%d/queues", created.ID)
	for _, request := range []struct {
		method string
		body   any
	}{
		{http.MethodGet, nil},
		{http.MethodPost, map[string]any{"name": "Unauthorized", "ql_query": "assignee IS NULL"}},
	} {
		response := MakeAuthRequestWithToken(t, server, outsiderCookie, request.method, path, request.body)
		AssertStatusCode(t, response, http.StatusNotFound)
		_ = response.Body.Close()
	}
}
