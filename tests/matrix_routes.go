package tests

import (
	"strconv"
	"strings"
)

// MatrixRoute is a concrete (method, path-template) pair classified into a
// PermissionClass. The matrix test picks one route per class as the
// representative target for the per-actor assertion sweep.
//
// Path templates use Go 1.22-style placeholders: `/items/{id}`, `/items/{itemId}`.
// The matrix test expands them by substituting the seeded item / workspace IDs
// at request time via ExpandMatrixPath.
//
// Body, when non-nil, produces the JSON-encoded request body each actor sends.
// Required for routes whose handlers parse the body before auth (e.g. items
// Update) — sending nil there yields a 400 from json.Decode that drowns the
// 401/403/404 signal the matrix is trying to assert. Body is invoked once per
// actor; return a fresh value if the body needs to be unique per call.
type MatrixRoute struct {
	Method string
	Path   string // including the /api or /rest/api/v1 prefix
	Class  string // PermissionClass.Name
	Body   func(fx MatrixFixtures) any
}

// MatrixRoutes is the seed of the full per-route classification.
// TestRouteClassification requires an entry or documented exemption for
// registered routes under EnforcedPrefixes, not for every v2 endpoint.
//
// Four v2 representatives run against both mounts. Other entries are policy
// intent only; prefix-scoped route enforcement remains explicitly incremental.
var MatrixRoutes = []MatrixRoute{
	// --- Representatives (exercised by TestPermissionMatrix) ---
	//
	// Each PermissionClass in Classes pulls its representative via
	// RepresentativeRouteFor, which returns the FIRST MatrixRoute whose
	// Class matches. The first entry per class below is the one actually
	// fired against every actor; further entries with the same Class are
	// policy-intent declarations only (they satisfy the drift guard but
	// are not re-tested for status code).
	{Method: "GET", Path: "/api/v2/items/{id}", Class: "workspace.item.view"},
	{
		Method: "PATCH",
		Path:   "/api/v2/items/{id}",
		Class:  "workspace.item.edit",
		// The driver makes mutation text unique per actor and verifies stored
		// state after every allow/deny; this is not a status-only no-op PATCH.
		Body: func(fx MatrixFixtures) any {
			return map[string]any{"title": "Matrix updated"}
		},
	},
	{
		Method: "POST",
		Path:   "/api/v2/items/{id}/comments",
		Class:  "workspace.item.comment",
		// CreateComment validates Content as non-empty. Each successful
		// call creates a new comment row; safe to run across all actors.
		Body: func(fx MatrixFixtures) any {
			return map[string]any{"content": "Matrix comment"}
		},
	},
	{
		Method: "PATCH",
		// Registered as `PATCH /workspaces/{workspace_id}`; `{id}` would resolve
		// to the item ID via the placeholder convention; use {workspaceId}
		// so ExpandMatrixPath substitutes TargetWorkspaceID. Go's mux is
		// positional — the placeholder name in the URL doesn't have to
		// match the registration.
		Path:  "/api/v2/workspaces/{workspaceId}",
		Class: "workspace.admin",
		// Workspace.Update validates Name as `required` — minimum body must
		// include it. active=true keeps the workspace usable for any later
		// classes that run after this one.
		Body: func(fx MatrixFixtures) any {
			return map[string]any{
				"name":   "Matrix Target",
				"active": true,
			}
		},
	},

	// --- Policy-intent classifications (drift guard only, not re-exercised) ---
	//
	// Routes below share a policy class with one of the representatives above.
	// Each entry asserts "this route's auth gate follows class X" — the matrix
	// does not re-fire them; reviewer/security audit reads the Class field as
	// the policy claim. A class with no representative listed above is omitted
	// from Classes (e.g. workspace.item.delete — destructive ops still pending
	// per-actor fixture refresh; see comment below).

	// workspace.item.view — routes gated on canViewItem / PermissionItemView.
	// V2 diagram policy intent only: the representative tests do not re-fire
	// every route below.
	// Dedicated TestV2ItemDiagrams cases exercise both mounts; bearer scopes are
	// checked separately by TestV2Diagrams_GranularBearerScopes.
	{Method: "GET", Path: "/api/v2/items/{item_id}/diagrams", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/v2/item-diagrams/{diagram_id}", Class: "workspace.item.view"},
	{Method: "GET", Path: "/rest/api/v2/items/{item_id}/diagrams", Class: "workspace.item.view"},
	{Method: "GET", Path: "/rest/api/v2/item-diagrams/{diagram_id}", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/available-status-transitions", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/detail-summary", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/history", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/status-durations", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/children", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/ancestors", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/descendants", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/tree", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/watch", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/personal-tasks", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/recurrence", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/recurrence/instances", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/comments", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/diagrams", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/links", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/field-links/{fieldId}", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/linked-assets", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/worklogs", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/time-rollup", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/labels", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/personal-labels", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/approvals", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/integration-links", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/scm-connection-status", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/scm-links", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/scm-repositories", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/webhooks", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/items/{id}/agent-runs", Class: "workspace.item.view"},

	// workspace.item.edit — routes gated on canEditItem / PermissionItemEdit.
	// Add only non-destructive operations here; destructive deletes that
	// consume the fixture (which would break subsequent actor iterations)
	// stay in exemptions with a structural reason until the per-actor
	// fixture refresh shape lands.
	{Method: "POST", Path: "/api/v2/items/{item_id}/diagrams", Class: "workspace.item.edit"},
	{Method: "PATCH", Path: "/api/v2/item-diagrams/{diagram_id}", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/rest/api/v2/items/{item_id}/diagrams", Class: "workspace.item.edit"},
	{Method: "PATCH", Path: "/rest/api/v2/item-diagrams/{diagram_id}", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/reparent-children", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/copy", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/transition", Class: "workspace.item.edit"},
	{Method: "GET", Path: "/api/items/{id}/type-change-analysis", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/change-type", Class: "workspace.item.edit"},
	{Method: "GET", Path: "/api/items/{id}/delete-info", Class: "workspace.item.edit"},
	{Method: "PUT", Path: "/api/items/{id}/frac-index", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/schedule", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/recurrence", Class: "workspace.item.edit"},
	{Method: "PUT", Path: "/api/items/{id}/recurrence", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/recurrence/generate", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/watch", Class: "workspace.item.view"}, // watch toggle gates on view per items_watch.go
	{Method: "POST", Path: "/api/items/{id}/diagrams", Class: "workspace.item.edit"},
	{Method: "PUT", Path: "/api/items/{id}/labels", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/labels", Class: "workspace.item.edit"},
	{Method: "PUT", Path: "/api/items/{id}/personal-labels", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/personal-labels", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/integration-links", Class: "workspace.item.edit"},
	{Method: "GET", Path: "/api/items/{id}/integration-search", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/scm-links", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/{id}/scm-links/create-branch", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/bulk-update", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/bulk-patch", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/items/roadmap-hierarchy-dates", Class: "workspace.item.view"},

	// --- /api/attachments — gate on the parent item's view/edit perm ---
	// Upload requires item.edit on the target item (carried in the body).
	// Download/thumbnail require item.view on the attachment's item.
	{Method: "POST", Path: "/api/attachments/upload", Class: "workspace.item.edit"},
	{Method: "GET", Path: "/api/attachments/{attachmentId}/download", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/attachments/{attachmentId}/thumbnail", Class: "workspace.item.view"},

	// V2 label policy intent. The catalog is global, but each catalog route
	// authorizes its workspace context. Dedicated TestV2Labels cases exercise
	// these routes independently of the four matrix representatives.
	{Method: "GET", Path: "/api/v2/workspaces/{workspace_id}/labels", Class: "workspace.item.view"},
	{Method: "GET", Path: "/api/v2/workspaces/{workspace_id}/labels/{label_id}", Class: "workspace.item.view"},
	{Method: "POST", Path: "/api/v2/workspaces/{workspace_id}/labels", Class: "workspace.item.edit"},
	{Method: "PATCH", Path: "/api/v2/workspaces/{workspace_id}/labels/{label_id}", Class: "workspace.admin"},
	{Method: "GET", Path: "/api/v2/items/{item_id}/labels", Class: "workspace.item.view"},
	{Method: "PUT", Path: "/api/v2/items/{item_id}/labels", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/api/v2/items/{item_id}/labels", Class: "workspace.item.edit"},
	{Method: "GET", Path: "/rest/api/v2/workspaces/{workspace_id}/labels", Class: "workspace.item.view"},
	{Method: "GET", Path: "/rest/api/v2/workspaces/{workspace_id}/labels/{label_id}", Class: "workspace.item.view"},
	{Method: "POST", Path: "/rest/api/v2/workspaces/{workspace_id}/labels", Class: "workspace.item.edit"},
	{Method: "PATCH", Path: "/rest/api/v2/workspaces/{workspace_id}/labels/{label_id}", Class: "workspace.admin"},
	{Method: "GET", Path: "/rest/api/v2/items/{item_id}/labels", Class: "workspace.item.view"},
	{Method: "PUT", Path: "/rest/api/v2/items/{item_id}/labels", Class: "workspace.item.edit"},
	{Method: "POST", Path: "/rest/api/v2/items/{item_id}/labels", Class: "workspace.item.edit"},

	// --- /api/links — gate on the parent item's view/edit perm ---
	// Create/delete require item.edit on the source/target item.
	// Search returns linkable items filtered by view perm (multi-workspace
	// filter semantics, exempted).
	{Method: "POST", Path: "/api/links", Class: "workspace.item.edit"},
}

// RepresentativeRouteFor returns the first MatrixRoute classified under the
// given class name. The matrix test uses this as the representative endpoint
// for per-actor assertions. Returns nil if no route is classified into the
// class — which is itself a configuration error worth surfacing.
func RepresentativeRouteFor(className string) *MatrixRoute {
	for i := range MatrixRoutes {
		if MatrixRoutes[i].Class == className {
			return &MatrixRoutes[i]
		}
	}
	return nil
}

// ExpandMatrixPath substitutes placeholders in the route path against the
// seeded fixtures.
//
// Supported placeholders:
//
//	{id}, {itemId}, {item_id}        → fx.TargetItemID
//	{otherItemId}                    → fx.OtherItemID
//	{workspaceId}, {workspace_id}    → fx.TargetWorkspaceID
//	{otherWorkspaceId}               → fx.OtherWorkspaceID
//	{commentId}                      → fx.TargetCommentID
//	{attachmentId}                   → fx.TargetAttachmentID
//	{linkId}                         → fx.TargetLinkID
//	{slug}                           → fx.PortalSlug (empty if unseeded)
//
// The canonical full path is retained. MatrixSession.Do is responsible for
// mapping /api/v2 to the session or bearer mount exactly once.
func ExpandMatrixPath(template string, fx MatrixFixtures) string {
	s := template
	s = strings.ReplaceAll(s, "{otherItemId}", strconv.Itoa(fx.OtherItemID))
	s = strings.ReplaceAll(s, "{otherWorkspaceId}", strconv.Itoa(fx.OtherWorkspaceID))
	s = strings.ReplaceAll(s, "{id}", strconv.Itoa(fx.TargetItemID))
	s = strings.ReplaceAll(s, "{itemId}", strconv.Itoa(fx.TargetItemID))
	s = strings.ReplaceAll(s, "{item_id}", strconv.Itoa(fx.TargetItemID))
	s = strings.ReplaceAll(s, "{workspaceId}", strconv.Itoa(fx.TargetWorkspaceID))
	s = strings.ReplaceAll(s, "{workspace_id}", strconv.Itoa(fx.TargetWorkspaceID))
	s = strings.ReplaceAll(s, "{commentId}", strconv.Itoa(fx.TargetCommentID))
	s = strings.ReplaceAll(s, "{attachmentId}", strconv.Itoa(fx.TargetAttachmentID))
	s = strings.ReplaceAll(s, "{linkId}", strconv.Itoa(fx.TargetLinkID))
	s = strings.ReplaceAll(s, "{slug}", fx.PortalSlug)

	return s
}
