package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

type MatrixActor string

const (
	ActorAnonymous            MatrixActor = "anonymous"
	ActorNoMembership         MatrixActor = "no_membership"
	ActorCrossWorkspaceMember MatrixActor = "cross_workspace"
	ActorWorkspaceViewer      MatrixActor = "ws_viewer"
	ActorWorkspaceEditor      MatrixActor = "ws_editor"
	ActorWorkspaceAdmin       MatrixActor = "ws_admin"
	ActorWorkspaceTester      MatrixActor = "ws_tester"
	ActorSystemAdmin          MatrixActor = "system_admin"
)

// These eight internal caller profiles are the current matrix scope. Portal
// customers and the implicit everyone-role path are not covered by this matrix.
var MatrixActors = []MatrixActor{
	ActorAnonymous, ActorNoMembership, ActorCrossWorkspaceMember,
	ActorWorkspaceViewer, ActorWorkspaceEditor, ActorWorkspaceAdmin,
	ActorWorkspaceTester, ActorSystemAdmin,
}

type MatrixSession struct {
	Name   MatrixActor
	UserID int
	server *TestServer
	bearer bool
}

// MatrixRoutes use the canonical session path. The bearer run exercises its
// mirrored REST mount with a real bearer token, never a session-cookie fallback.
func (s *MatrixSession) Do(t *testing.T, method, path string, body any) *http.Response {
	t.Helper()
	if !strings.HasPrefix(path, "/api/v2/") {
		t.Fatalf("matrix representative must target canonical v2 path: %q", path)
	}
	endpoint := strings.TrimPrefix(path, "/api/v2")
	if s.bearer {
		return MakeV2BearerRequest(t, s.server, method, endpoint, body)
	}
	return MakeV2SessionRequest(t, s.server, method, endpoint, body)
}

type MatrixSubjects struct {
	TargetWorkspaceID  int
	TargetWorkspaceKey string
	OtherWorkspaceID   int
}

// Every item/workspace used in the matrix is created through production HTTP.
// Both workspaces have explicit membership before actors are configured.
type MatrixFixtures struct {
	TargetWorkspaceID  int
	OtherWorkspaceID   int
	TargetItemID       int
	OtherItemID        int
	TargetCommentID    int
	TargetAttachmentID int
	TargetLinkID       int
	PortalSlug         string
}

func SetupMatrixActors(t *testing.T, server *TestServer, subj MatrixSubjects, bearer bool) map[MatrixActor]*MatrixSession {
	t.Helper()
	sessions := map[MatrixActor]*MatrixSession{}
	add := func(name MatrixActor, id int, cookie, token string) {
		actorServer := *server
		actorServer.SessionCookie, actorServer.BearerToken = cookie, token
		sessions[name] = &MatrixSession{Name: name, UserID: id, server: &actorServer, bearer: bearer}
	}
	add(ActorAnonymous, 0, "", "")
	suffix := fmt.Sprintf("%08d", time.Now().UnixNano()%100000000)
	for _, spec := range []struct {
		actor       MatrixActor
		short, role string
		workspace   int
	}{
		{ActorNoMembership, "none", "", 0},
		{ActorCrossWorkspaceMember, "cross", "Editor", subj.OtherWorkspaceID},
		{ActorWorkspaceViewer, "view", "Viewer", subj.TargetWorkspaceID},
		{ActorWorkspaceEditor, "edit", "Editor", subj.TargetWorkspaceID},
		{ActorWorkspaceAdmin, "admin", "Administrator", subj.TargetWorkspaceID},
		{ActorWorkspaceTester, "test", "Tester", subj.TargetWorkspaceID},
	} {
		name := "mx_" + spec.short + "_" + suffix
		id, username, password := CreateTestUserWithCredentials(t, server, name, name+"@example.test")
		if spec.role != "" {
			AssignWorkspaceRole(t, server, id, spec.workspace, spec.role)
		}
		cookie, token := CreateAuthCredentialsForUser(t, server, username, password)
		add(spec.actor, id, cookie, token)
	}
	add(ActorSystemAdmin, lookupAdminUser(t, server).ID, server.SessionCookie, server.BearerToken)
	return sessions
}
