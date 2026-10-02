//go:build test

package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"windshift/internal/models"
	"windshift/internal/testutils"
)

// --- Pure key-generation helpers --------------------------------------------

// The personal key derives from the owner ID: P<id>, alphanumeric, within the
// 2-10 key contract, collision-free by construction.
func TestPersonalWorkspaceKeyCandidatesSatisfyContract(t *testing.T) {
	var keyPattern = regexp.MustCompile(`^[A-Z0-9]+$`)
	for _, userID := range []int{1, 42, 999999} {
		candidates := personalWorkspaceKeyCandidates(userID)
		if candidates[0] != fmt.Sprintf("P%d", userID) {
			t.Errorf("first candidate = %q, want P%d", candidates[0], userID)
		}
		for _, key := range candidates {
			if len(key) < 2 || len(key) > 10 || !keyPattern.MatchString(key) {
				t.Errorf("candidate %q (user %d) violates the 2-10 alphanumeric key contract", key, userID)
			}
		}
	}
}

// WI-1421: fallback candidates must live in a namespace disjoint from every
// user's base key, so one user's fallback can never equal another user's base
// and collisions cannot cascade across users. Letter-terminated fallbacks give
// exactly that: bases are P + decimal digits, so a trailing letter excludes the
// base shape, and the trailing letter plus digit run pin the owner uniquely.
func TestPersonalWorkspaceKeyFallbacksNeverCollideAcrossUsers(t *testing.T) {
	seen := make(map[string]int) // candidate -> owner that claimed it first
	for userID := 1; userID <= 5000; userID++ {
		for i, key := range personalWorkspaceKeyCandidates(userID) {
			if i == 0 {
				continue // bases are unique per user by construction (P + decimal ID)
			}
			last := key[len(key)-1]
			if last < 'A' || last > 'Z' {
				t.Fatalf("fallback %q (user %d) must end in a letter to stay out of the P<digits> base namespace", key, userID)
			}
			if owner, taken := seen[key]; taken {
				t.Fatalf("candidate %q generated for both user %d and user %d", key, owner, userID)
			}
			seen[key] = userID
		}
	}
}

// --- GetOrCreatePersonalWorkspace HTTP handler ------------------------------

func TestWorkspaceHandler_GetOrCreatePersonalWorkspace_CreatesOnFirstCall(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	tdb.SeedTestData(t)
	handler := newWorkspaceHandlerForSettings(t, tdb)

	req := testutils.CreateJSONRequest(t, "POST", "/api/workspaces/personal", nil)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.GetOrCreatePersonalWorkspace, req, nil)

	rr.AssertStatusCode(http.StatusCreated)

	var ws models.Workspace
	rr.AssertJSONResponse(&ws)

	if !ws.IsPersonal {
		t.Error("Expected IsPersonal=true on returned workspace")
	}
	if ws.OwnerID == nil || *ws.OwnerID != 1 {
		t.Errorf("Expected OwnerID=1, got %v", ws.OwnerID)
	}
	if !strings.Contains(ws.Name, "Todo List") {
		t.Errorf("Expected workspace name to contain 'Todo List', got %q", ws.Name)
	}
	// Confirm the row actually landed in the DB.
	var count int
	err := tdb.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE is_personal = TRUE AND owner_id = 1`).Scan(&count)
	if err != nil {
		t.Fatalf("count personal ws: %v", err)
	}
	if count != 1 {
		t.Errorf("Expected exactly 1 personal workspace row, got %d", count)
	}
}

func TestWorkspaceHandler_GetOrCreatePersonalWorkspace_IdempotentOnSecondCall(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	tdb.SeedTestData(t)
	handler := newWorkspaceHandlerForSettings(t, tdb)

	// First call creates.
	req1 := testutils.CreateJSONRequest(t, "POST", "/api/workspaces/personal", nil)
	rr1 := testutils.ExecuteAuthenticatedRequest(t, handler.GetOrCreatePersonalWorkspace, req1, nil)
	rr1.AssertStatusCode(http.StatusCreated)
	var first models.Workspace
	rr1.AssertJSONResponse(&first)

	// Second call should return the existing workspace (200, same ID).
	req2 := testutils.CreateJSONRequest(t, "POST", "/api/workspaces/personal", nil)
	rr2 := testutils.ExecuteAuthenticatedRequest(t, handler.GetOrCreatePersonalWorkspace, req2, nil)
	rr2.AssertStatusCode(http.StatusOK)
	var second models.Workspace
	rr2.AssertJSONResponse(&second)

	if first.ID != second.ID {
		t.Errorf("Expected same workspace ID on second call: first=%d second=%d", first.ID, second.ID)
	}

	// Still only one row.
	var count int
	err := tdb.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE is_personal = TRUE AND owner_id = 1`).Scan(&count)
	if err != nil {
		t.Fatalf("count personal ws: %v", err)
	}
	if count != 1 {
		t.Errorf("Expected 1 personal workspace after idempotent call, got %d", count)
	}
}

func TestWorkspaceHandler_GetOrCreatePersonalWorkspace_HandlesKeyCollision(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	tdb.SeedTestData(t)
	handler := newWorkspaceHandlerForSettings(t, tdb)

	// The personal key is P1 for user 1. A regular workspace already owning
	// that key forces the backstop candidates.
	_, err := tdb.Exec(`
		INSERT INTO workspaces (name, key, description, active) VALUES ('Squatter', 'P1', 'x', TRUE)
	`)
	if err != nil {
		t.Fatalf("pre-create squatter workspace: %v", err)
	}

	req := testutils.CreateJSONRequest(t, "POST", "/api/workspaces/personal", nil)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.GetOrCreatePersonalWorkspace, req, nil)

	rr.AssertStatusCode(http.StatusCreated)

	var ws models.Workspace
	rr.AssertJSONResponse(&ws)
	if ws.Key == "P1" {
		t.Errorf("Expected collision-resolved key, got the squatted %q", ws.Key)
	}
	var keyPattern = regexp.MustCompile(`^[A-Z0-9]+$`)
	if len(ws.Key) < 2 || len(ws.Key) > 10 || !keyPattern.MatchString(ws.Key) {
		t.Errorf("resolved key %q violates the 2-10 alphanumeric key contract", ws.Key)
	}
	// The personal workspace must still exist exactly once for the owner.
	var count int
	if err := tdb.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE is_personal = TRUE AND owner_id = 1`).Scan(&count); err != nil {
		t.Fatalf("count personal ws: %v", err)
	}
	if count != 1 {
		t.Errorf("Expected exactly 1 personal workspace row, got %d", count)
	}
}

func TestWorkspaceHandler_GetOrCreatePersonalWorkspace_Unauthenticated(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	tdb.SeedTestData(t)
	handler := newWorkspaceHandlerForSettings(t, tdb)

	req := testutils.CreateJSONRequest(t, "POST", "/api/workspaces/personal", nil)
	// ExecuteRequest dispatches the handler with no authenticated user in the
	// context, so RequireAuth should respond with 401.
	rr := testutils.ExecuteRequest(t, handler.GetOrCreatePersonalWorkspace, req)

	rr.AssertStatusCode(http.StatusUnauthorized)
}
