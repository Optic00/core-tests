package tests

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"windshift/internal/models"
)

// Four representative classes x eight actors x two real mounts. This is not
// per-route coverage: other MatrixRoutes remain policy-intent declarations.
func TestPermissionMatrix(t *testing.T) {
	if len(Classes) == 0 || len(MatrixActors) == 0 {
		t.Fatal("matrix requires classes and actors")
	}
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			server, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, server)
			targetWS, targetKey := CreateTestWorkspace(t, server, "Matrix Target", shortKey("MTRX"))
			otherWS, _ := CreateTestWorkspace(t, server, "Matrix Other", shortKey("MTRO"))
			LockDownWorkspace(t, server, targetWS)
			LockDownWorkspace(t, server, otherWS)
			createItem := func(workspace int, title string) int {
				t.Helper()
				item := DecodeV2Document[v2FixtureRecord](t, MakeV2SessionRequest(t, server, http.MethodPost, "/items", map[string]any{"workspace_id": workspace, "title": title}), http.StatusCreated)
				if item.ID <= 0 {
					t.Fatal("matrix fixture needs a positive item ID")
				}
				return item.ID
			}
			fixtures := MatrixFixtures{TargetWorkspaceID: targetWS, OtherWorkspaceID: otherWS,
				TargetItemID: createItem(targetWS, "Matrix target item"), OtherItemID: createItem(otherWS, "Matrix other item")}
			actors := SetupMatrixActors(t, server, MatrixSubjects{TargetWorkspaceID: targetWS, TargetWorkspaceKey: targetKey, OtherWorkspaceID: otherWS}, bearer)
			// Prove this actor really has usable membership elsewhere; otherwise
			// its target denial would merely duplicate the no-membership case.
			otherItem := DecodeV2Document[v2FixtureRecord](t, actors[ActorCrossWorkspaceMember].Do(t, http.MethodGet, fmt.Sprintf("/api/v2/items/%d", fixtures.OtherItemID), nil), http.StatusOK)
			if otherItem.ID != fixtures.OtherItemID {
				t.Fatal("cross-workspace actor cannot read its own workspace item")
			}

			for _, class := range Classes {
				t.Run(class.Name, func(t *testing.T) {
					route := RepresentativeRouteFor(class.Name)
					if route == nil {
						t.Fatalf("no representative for %q", class.Name)
					}
					if len(class.Expected) != len(MatrixActors) || len(actors) != len(MatrixActors) {
						t.Fatal("matrix actor/expectation coverage is incomplete")
					}
					for _, actorName := range MatrixActors {
						expected, ok := class.Expected[actorName]
						if !ok {
							t.Fatalf("missing expectation for %s", actorName)
						}
						actor, ok := actors[actorName]
						if !ok {
							t.Fatalf("missing actor %s", actorName)
						}
						t.Run(string(actorName), func(t *testing.T) {
							before := readMatrixState(t, server, fixtures, class.Name)
							text := "Matrix " + string(actorName)
							var body any
							if route.Body != nil {
								body = route.Body(fixtures)
								fields, ok := body.(map[string]any)
								if !ok {
									t.Fatal("matrix mutation body must be a field map")
								}
								switch class.Name {
								case "workspace.item.edit":
									fields["title"] = text
								case "workspace.item.comment":
									fields["content"] = text
								case "workspace.admin":
									fields["name"] = text
								default:
									t.Fatalf("unexpected mutation class %s", class.Name)
								}
							}
							path := ExpandMatrixPath(route.Path, fixtures)
							response := actor.Do(t, route.Method, path, body)
							if response.StatusCode != expected {
								AssertStatusCode(t, response, expected)
								response.Body.Close()
								t.Fatalf("%s %s as %s did not satisfy class %s", route.Method, path, actorName, class.Name)
							}
							assertCommentJSON(t, response)
							var result map[string]any
							if expected >= 400 {
								assertCommentStatus(t, response, expected)
							} else {
								result = DecodeV2Document[map[string]any](t, response, expected)
							}
							after := readMatrixState(t, server, fixtures, class.Name)
							if expected >= 400 || class.Name == "workspace.item.view" {
								if !reflect.DeepEqual(before, after) {
									t.Fatal("denied/read-only matrix cell changed persisted state")
								}
								if result != nil && (result["id"] != float64(fixtures.TargetItemID) || result["title"] != before.Text) {
									t.Fatal("allowed read returned wrong item")
								}
								return
							}
							switch class.Name {
							case "workspace.item.edit", "workspace.admin":
								field := "title"
								if class.Name == "workspace.admin" {
									field = "name"
								}
								if result["id"] != float64(before.ID) || result[field] != text || after.ID != before.ID || after.Text != text || after.Key != before.Key || after.Description != before.Description || after.Active != before.Active {
									t.Fatal("allowed PATCH did not persist exactly the requested text")
								}
							case "workspace.item.comment":
								id := ExtractIDFromResponse(t, result)
								if id <= 0 || result["content"] != text || result["author_id"] != float64(actor.UserID) || len(after.Comments) != len(before.Comments)+1 {
									t.Fatal("allowed comment lost identity, content, author or persistence")
								}
								prior := map[int]models.Comment{}
								for _, comment := range before.Comments {
									prior[comment.ID] = comment
								}
								found := false
								for _, comment := range after.Comments {
									if comment.ID == id {
										if found || comment.Content != text || comment.AuthorID == nil || *comment.AuthorID != actor.UserID {
											t.Fatal("stored matrix comment is invalid")
										}
										found = true
									} else {
										old, ok := prior[comment.ID]
										if !ok || !reflect.DeepEqual(old, comment) {
											t.Fatal("comment create changed an existing comment")
										}
										delete(prior, comment.ID)
									}
								}
								if !found || len(prior) != 0 {
									t.Fatal("comment feed omitted expected records")
								}
							}
						})
					}
				})
			}
			if bearer {
				t.Run("token_scope", func(t *testing.T) { assertMatrixScopeGuards(t, server, fixtures) })
			}
		})
	}
}

func assertMatrixScopeGuards(t *testing.T, server *TestServer, fx MatrixFixtures) {
	t.Helper()
	limited := *server
	limited.SessionCookie = ""
	limited.BearerToken = createTokenWithScopesAsUser(t, server, "admin", "testpass123", []string{"users:read"})
	caller := DecodeV2Document[v2FixtureRecord](t, MakeV2BearerRequest(t, &limited, http.MethodGet, "/users/me", nil), http.StatusOK)
	if caller.ID != lookupAdminUser(t, server).ID {
		t.Fatal("scope control token is not the administrator")
	}
	for _, class := range Classes {
		t.Run(class.Name, func(t *testing.T) {
			route := RepresentativeRouteFor(class.Name)
			before := readMatrixState(t, server, fx, class.Name)
			var body any
			if route.Body != nil {
				body = route.Body(fx)
			}
			path := strings.TrimPrefix(ExpandMatrixPath(route.Path, fx), "/api/v2")
			response := MakeV2BearerRequest(t, &limited, route.Method, path, body)
			defer response.Body.Close()
			assertCommentJSON(t, response)
			if response.StatusCode != http.StatusForbidden {
				AssertStatusCode(t, response, http.StatusForbidden)
				return
			}
			var failure struct {
				Error struct{ Code string } `json:"error"`
			}
			DecodeJSON(t, response, &failure)
			if failure.Error.Code != "insufficient_permission" {
				t.Fatalf("scope error=%q, want insufficient_permission", failure.Error.Code)
			}
			if after := readMatrixState(t, server, fx, class.Name); !reflect.DeepEqual(before, after) {
				t.Fatal("scope-denied request changed stored state")
			}
		})
	}
}

type matrixState struct {
	ID                     int
	Text, Key, Description string
	Active                 bool
	Comments               []models.Comment
}

// Read stored state independently through the administrator session after each
// matrix request; the bearer run therefore also verifies cross-mount persistence.
func readMatrixState(t *testing.T, server *TestServer, fx MatrixFixtures, class string) matrixState {
	t.Helper()
	switch class {
	case "workspace.item.view", "workspace.item.edit":
		item := DecodeV2Document[models.Item](t, MakeV2SessionRequest(t, server, http.MethodGet, fmt.Sprintf("/items/%d", fx.TargetItemID), nil), http.StatusOK)
		return matrixState{ID: item.ID, Text: item.Title, Description: item.Description}
	case "workspace.item.comment":
		feed := DecodeV2Document[v2CommentFeed](t, MakeV2SessionRequest(t, server, http.MethodGet, fmt.Sprintf("/items/%d/comments", fx.TargetItemID), nil), http.StatusOK)
		if feed.HasMore {
			t.Fatal("matrix comment snapshot would be truncated")
		}
		return matrixState{Comments: feed.Comments}
	case "workspace.admin":
		workspace := DecodeV2Document[models.Workspace](t, MakeV2SessionRequest(t, server, http.MethodGet, fmt.Sprintf("/workspaces/%d", fx.TargetWorkspaceID), nil), http.StatusOK)
		return matrixState{ID: workspace.ID, Text: workspace.Name, Key: workspace.Key, Description: workspace.Description, Active: workspace.Active}
	default:
		t.Fatalf("missing state assertion for matrix class %s", class)
		return matrixState{}
	}
}

func TestExpandMatrixPathRetainsMount(t *testing.T) {
	fixtures := MatrixFixtures{TargetItemID: 17, TargetWorkspaceID: 29, OtherItemID: 31, OtherWorkspaceID: 43, TargetCommentID: 47, TargetAttachmentID: 53, TargetLinkID: 59, PortalSlug: "matrix-portal"}
	for _, tc := range []struct{ path, want string }{
		{"/api/v2/items/{id}", "/api/v2/items/17"},
		{"/api/v2/workspaces/{workspace_id}", "/api/v2/workspaces/29"},
		{"/rest/api/v2/items/{otherItemId}", "/rest/api/v2/items/31"},
		{"/api/v2/workspaces/{otherWorkspaceId}", "/api/v2/workspaces/43"},
		{"/api/v2/workspaces/{workspaceId}/items/{item_id}", "/api/v2/workspaces/29/items/17"},
		{"/api/v2/items/{itemId}/comments/{commentId}", "/api/v2/items/17/comments/47"},
		{"/api/attachments/{attachmentId}", "/api/attachments/53"},
		{"/api/v2/links/{linkId}", "/api/v2/links/59"},
		{"/api/portal/{slug}", "/api/portal/matrix-portal"},
	} {
		if got := ExpandMatrixPath(tc.path, fixtures); got != tc.want {
			t.Fatalf("path=%q, want %q", got, tc.want)
		}
	}
}

// Prefix enforcement is still incremental; this guard independently ensures
// every exercised representative exists on BOTH real v2 mounts.
func TestMatrixV2RepresentativesRegistered(t *testing.T) {
	registered := map[string]bool{}
	for _, route := range EnumerateRegisteredRoutes(t) {
		registered[routeKey(route.Method, route.Path)] = true
	}
	for _, class := range Classes {
		route := RepresentativeRouteFor(class.Name)
		if route == nil || !strings.HasPrefix(route.Path, "/api/v2/") {
			t.Fatalf("class %s lacks a canonical v2 representative", class.Name)
		}
		for _, path := range []string{route.Path, strings.Replace(route.Path, "/api/v2/", "/rest/api/v2/", 1)} {
			if !registered[routeKey(route.Method, path)] {
				t.Errorf("matrix representative is not registered: %s %s", route.Method, path)
			}
		}
	}
}
