package tests

import "net/http"

// PermissionClass is a named (actor → expected status) row that the matrix
// asserts for its representative route. Each class encodes both the
// allow side (which actors get 2xx) and the deny side with the *exact* code
// the security policy mandates. AssertRejected-style permissive checks
// (accept any 401/403/404) are intentionally not used here — drift from
// 404→403 on workspace-permission denial is exactly the leak this matrix
// catches.
//
// Expectations describe the current v2 representative routes, not a universal
// status rule for every API. Scope denial is checked separately from these
// role cells: their tokens deliberately carry all available nonadmin scopes.
type PermissionClass struct {
	Name        string              // e.g. "workspace.item.view"
	Description string              // human-readable note (which permission, why)
	Expected    map[MatrixActor]int // exact status per actor
}

// Classes is the canonical class registry. The matrix test iterates this
// list and runs every actor in MatrixActors against the representative
// route for each class (see matrix_routes.go).
//
// Four v2 classes currently run on both auth mounts. Destructive operations,
// record ownership, per-page ACL overrides and portal actors need their own
// fixtures; the representative matrix does not claim those policies.
var Classes = []PermissionClass{
	{
		Name:        "workspace.item.view",
		Description: "V2 GET /items/{id} requires PermissionItemView on the item's workspace.",
		Expected: map[MatrixActor]int{
			ActorAnonymous:            http.StatusUnauthorized, // 401
			ActorNoMembership:         http.StatusNotFound,     // 404 — workspace-perm denial
			ActorCrossWorkspaceMember: http.StatusNotFound,     // 404 — cross-workspace direct-ID
			ActorWorkspaceViewer:      http.StatusOK,           // 200
			ActorWorkspaceEditor:      http.StatusOK,           // 200
			ActorWorkspaceAdmin:       http.StatusOK,           // 200
			ActorWorkspaceTester:      http.StatusOK,           // 200 — Tester role can VIEW items (only CRUD is gated)
			ActorSystemAdmin:          http.StatusOK,           // 200
			// ActorPortalCustomer (401): deferred — see matrix_helpers.go.
		},
	},
	{
		Name:        "workspace.item.edit",
		Description: "V2 PATCH /items/{id} requires PermissionItemEdit and masks permission denial with 404.",
		Expected: map[MatrixActor]int{
			ActorAnonymous:            http.StatusUnauthorized, // 401
			ActorNoMembership:         http.StatusNotFound,     // 404
			ActorCrossWorkspaceMember: http.StatusNotFound,     // 404
			ActorWorkspaceViewer:      http.StatusNotFound,     // 404 — Viewer lacks item.edit; canEditItem false → respondNotFound
			ActorWorkspaceEditor:      http.StatusOK,           // 200 — Editor has item.edit
			ActorWorkspaceAdmin:       http.StatusOK,           // 200
			// Tester deliberately lacks item.edit — that's the Editor/Tester role
			// distinction. Editor owns broad item editing; Tester owns
			// test.execute / test.manage. Both share view/create/comment.
			// Granting item.edit to Tester would collapse the roles.
			ActorWorkspaceTester: http.StatusNotFound, // 404
			ActorSystemAdmin:     http.StatusOK,       // 200
		},
	},
	{
		Name:        "workspace.item.comment",
		Description: "V2 POST /items/{id}/comments requires PermissionItemComment and masks denial with 404.",
		Expected: map[MatrixActor]int{
			ActorAnonymous:            http.StatusUnauthorized, // 401 — auth runs before body parse
			ActorNoMembership:         http.StatusNotFound,     // 404
			ActorCrossWorkspaceMember: http.StatusNotFound,     // 404
			ActorWorkspaceViewer:      http.StatusCreated,      // 201 — Viewer has item.comment
			ActorWorkspaceEditor:      http.StatusCreated,      // 201 — Editor has item.comment
			ActorWorkspaceAdmin:       http.StatusCreated,      // 201
			// Tester gets item.comment too (granted in permissions.sql alongside
			// the test.* perms): testers need to follow up on bugs they file.
			// See the Editor/Tester differentiation note on workspace.item.edit
			// below — Tester is deliberately a peer of Editor (overlap on
			// view/create/comment), not a strict subset.
			ActorWorkspaceTester: http.StatusCreated, // 201
			ActorSystemAdmin:     http.StatusCreated, // 201
		},
	},
	{
		Name: "workspace.admin",
		// Current v2 WorkspaceApplicationService.Update returns ErrNotFound
		// for denied CanAdminWorkspace, unlike the removed cookie PUT handler.
		Description: "V2 PATCH /workspaces/{id} requires PermissionWorkspaceAdmin and masks denial with 404.",
		Expected: map[MatrixActor]int{
			ActorAnonymous:            http.StatusUnauthorized, // 401
			ActorNoMembership:         http.StatusNotFound,
			ActorCrossWorkspaceMember: http.StatusNotFound,
			ActorWorkspaceViewer:      http.StatusNotFound,
			ActorWorkspaceEditor:      http.StatusNotFound,
			ActorWorkspaceAdmin:       http.StatusOK, // 200 — Administrator role has workspace.admin
			ActorWorkspaceTester:      http.StatusNotFound,
			ActorSystemAdmin:          http.StatusOK, // 200
		},
	},
}

// ClassByName looks up a class. Returns nil if not found.
func ClassByName(name string) *PermissionClass {
	for i := range Classes {
		if Classes[i].Name == name {
			return &Classes[i]
		}
	}
	return nil
}
