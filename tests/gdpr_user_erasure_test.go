package tests

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestGDPRUserErasure pins the Article 17 erasure flow (WI-1307): erasure is
// distinct from administrative offboarding, records DSAR intake/decision/
// execution evidence, retains work history under the pseudonymized user row,
// leaves audit logs untouched, and is irreversible. Per the approved policy,
// audit logs are intentionally NOT erased — their pseudonymized user IDs are
// retained (audit-integrity justification), which is why assertions here
// check that audit rows survive erasure untouched.
func TestGDPRUserErasure(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)

	wsID, _ := CreateTestWorkspace(t, server, "GDPR Erasure WS", "")
	userID, _, _ := CreateTestUserWithCredentials(t, server, "gdprsubject", "gdprsubject@test.local")
	AssignWorkspaceRole(t, server, userID, wsID, "Editor")

	// The subject authored work history in a shared workspace item: a comment
	// must survive erasure under the pseudonymized user row.
	itemID := CreateTestItem(t, server, wsID, "Item with subject history")
	commentResp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/items/%d/comments", itemID), map[string]interface{}{
		"content": "subject-authored context that outlives the account",
	})
	defer commentResp.Body.Close()
	AssertStatusCode(t, commentResp, http.StatusCreated)

	requestedAt := time.Now().Add(-48 * time.Hour)

	eraseResp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/users/%d/erase", userID), map[string]interface{}{
		"requested_by": "gdprsubject@test.local via privacy@ channel",
		"requested_at": requestedAt.UTC().Format(time.RFC3339),
		"notes":        "Art. 17 request approved after identity verification",
	})
	defer eraseResp.Body.Close()
	AssertStatusCode(t, eraseResp, http.StatusCreated)

	var evidence struct {
		UserID        int    `json:"user_id"`
		RequestedBy   string `json:"requested_by"`
		RequestedAt   string `json:"requested_at"`
		ApprovedBy    int    `json:"approved_by"`
		ExecutedAt    string `json:"executed_at"`
		PolicyVersion string `json:"policy_version"`
	}
	DecodeJSON(t, eraseResp, &evidence)
	if evidence.UserID != userID || evidence.PolicyVersion == "" || evidence.ApprovedBy == 0 {
		t.Fatalf("evidence = %#v", evidence)
	}
	if _, err := time.Parse(time.RFC3339, evidence.RequestedAt); err != nil {
		t.Errorf("requested_at = %q is not RFC3339", evidence.RequestedAt)
	}

	// The user row is pseudonymized and irreversibly marked.
	var username, email string
	var erasedAt, offboardedAt *time.Time
	if err := server.DB().QueryRow(`SELECT username, email, erased_at, offboarded_at FROM users WHERE id = ?`, userID).
		Scan(&username, &email, &erasedAt, &offboardedAt); err != nil {
		t.Fatalf("read user row: %v", err)
	}
	if erasedAt == nil {
		t.Errorf("erased_at not set")
	}
	if offboardedAt == nil {
		t.Errorf("offboarded_at not set — erasure must imply deactivation")
	}
	if username == "gdprsubject" || email == "gdprsubject@test.local" {
		t.Errorf("user row was not pseudonymized: username=%q email=%q", username, email)
	}

	// Work history survives under the pseudonymized identity.
	comment := server.DB().QueryRow(`SELECT content FROM comments WHERE item_id = ? ORDER BY id DESC LIMIT 1`, itemID)
	var content string
	if err := comment.Scan(&content); err != nil {
		t.Fatalf("subject comment lost during erasure: %v", err)
	}
	if content != "subject-authored context that outlives the account" {
		t.Errorf("comment content changed: %q", content)
	}

	// Second erasure is refused — the decision is recorded once.
	secondResp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/users/%d/erase", userID), map[string]interface{}{
		"requested_by": "again",
	})
	defer secondResp.Body.Close()
	AssertStatusCode(t, secondResp, http.StatusConflict)

	// Reactivation must be refused for an erased account.
	reactivate := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/users/%d/activate", userID), nil)
	defer reactivate.Body.Close()
	AssertStatusCode(t, reactivate, http.StatusConflict)
}

func TestGDPRUserErasureDenials(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)

	userID, _, _ := CreateTestUserWithCredentials(t, server, "gdprdenial", "gdprdenial@test.local")

	t.Run("non_admin_cannot_erase", func(t *testing.T) {
		_, _, editorPass := CreateTestUserWithCredentials(t, server, "gdprnonadmin", "gdprnonadmin@test.local")
		editorSession, _ := CreateAuthCredentialsForUser(t, server, "gdprnonadmin", editorPass)

		resp := MakeAuthRequestWithToken(t, server, editorSession, http.MethodPost, fmt.Sprintf("/users/%d/erase", userID), map[string]interface{}{
			"requested_by": "someone",
		})
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusForbidden)
	})

	t.Run("admin_cannot_erase_self", func(t *testing.T) {
		adminID := lookupAdminUser(t, server).ID
		resp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/users/%d/erase", adminID), map[string]interface{}{
			"requested_by": "self",
		})
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusForbidden)
	})

	t.Run("missing_intake_reference_is_rejected", func(t *testing.T) {
		resp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/users/%d/erase", userID), map[string]interface{}{
			"requested_by": "",
		})
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusBadRequest)
	})
}

// TestGDPRErasureKeepsAuditLogsPseudonymized pins the explicit scope
// decision: audit log rows are not erased or redacted by the erasure flow.
// The subject is referenced by resource_id, the offboarding event retains the
// pre-erasure identity in its details (per the review-page policy), and the
// erasure event is recorded against the same subject.
func TestGDPRErasureKeepsAuditLogsPseudonymized(t *testing.T) {
	server, _ := StartTestServer(t, GetDBType())
	CreateBearerToken(t, server)

	userID, _, _ := CreateTestUserWithCredentials(t, server, "gdpraudit", "gdpraudit@test.local")

	eraseResp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/users/%d/erase", userID), map[string]interface{}{
		"requested_by": "audit-scope-check",
	})
	defer eraseResp.Body.Close()
	AssertStatusCode(t, eraseResp, http.StatusCreated)

	// The erasure audit event for the subject retains the pre-erasure
	// identity in its details; erasure must not have touched the audit trail.
	var eraseDetails string
	if err := server.DB().QueryRow(
		`SELECT details FROM audit_logs WHERE action_type = 'user.erase' AND resource_id = ?`,
		userID,
	).Scan(&eraseDetails); err != nil {
		t.Fatalf("erasure audit row for subject missing: %v", err)
	}
	if !strings.Contains(eraseDetails, "gdpraudit@test.local") {
		t.Errorf("erasure audit details lost the pre-erasure identity: %s", eraseDetails)
	}

	// The erasure event is recorded against the same subject.
	var eraseCount int
	if err := server.DB().QueryRow(
		`SELECT COUNT(*) FROM audit_logs WHERE action_type = 'user.erase' AND resource_id = ?`,
		userID,
	).Scan(&eraseCount); err != nil {
		t.Fatalf("query erasure audit row: %v", err)
	}
	if eraseCount != 1 {
		t.Errorf("erasure audit rows = %d, want 1", eraseCount)
	}
}
