package tests

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// seedRateLimitedEmail inserts a flood-declined tracking row directly. The
// production API cannot create rate-limited intake state without a live IMAP
// mailbox, so this is the documented direct-write exception for exercising
// the requeue boundary; channel and workspace fixtures still go through the
// HTTP API.
func seedRateLimitedEmail(t *testing.T, server *TestServer, channelID int, dedupKey string, uid, uidValidity int) {
	t.Helper()
	if _, err := server.DB().ExecWrite(`
		INSERT INTO email_message_tracking
			(channel_id, message_id, dedup_key, from_email, from_name, subject, direction, uid, uid_validity, rate_limited_at, processed_at)
		VALUES (?, ?, ?, 'flooder@example.com', 'Flooder', 'Flood', 'inbound', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, channelID, "<"+dedupKey+"@example.com>", dedupKey, uid, uidValidity); err != nil {
		t.Fatalf("seed rate-limited tracking row: %v", err)
	}
}

func setEmailWatermark(t *testing.T, server *TestServer, channelID, lastUID int) {
	t.Helper()
	// API-created channels have no state row until the scheduler polls them;
	// upsert so the endpoints under test see the watermark the fake poll left.
	if _, err := server.DB().ExecWrite(`
		INSERT INTO email_channel_state (channel_id, last_uid, uid_validity)
		VALUES (?, ?, 42)
		ON CONFLICT(channel_id) DO UPDATE SET last_uid = excluded.last_uid, uid_validity = 42
	`, channelID, lastUID); err != nil {
		t.Fatalf("set email watermark: %v", err)
	}
}

func getEmailWatermark(t *testing.T, server *TestServer, channelID int) (lastUID, uidValidity int) {
	t.Helper()
	if err := server.DB().QueryRow(
		`SELECT last_uid, COALESCE(uid_validity, 0) FROM email_channel_state WHERE channel_id = ?`,
		channelID,
	).Scan(&lastUID, &uidValidity); err != nil {
		t.Fatalf("read email watermark: %v", err)
	}
	return lastUID, uidValidity
}

var emailFixtureSeq int

// createInboundEmailChannelFixture creates a fully-wired inbound email
// channel through the production API: workspace, configuration-set
// association with a valid item type, provider, and the channel itself.
func createInboundEmailChannelFixture(t *testing.T, server *TestServer, name string, rateLimitPerHour *int) int {
	t.Helper()

	// Workspace keys are unique per server and limited to 10 alphanumeric
	// characters, so build one from the fixture sequence.
	emailFixtureSeq++
	key := fmt.Sprintf("EM%d", emailFixtureSeq)
	workspaceID, _ := CreateTestWorkspace(t, server, name+" WS", key)
	configSetID := GetDefaultConfigurationSet(t, server)
	itemTypes := GetItemTypes(t, server, configSetID)
	itemTypeID := RequireItemTypeID(t, itemTypes, "Task")
	AssociateWorkspaceWithConfigSet(t, server, workspaceID, configSetID)

	channelID := CreateInboundEmailChannel(t, server, EmailChannelConfig{
		Name:             name,
		WorkspaceID:      workspaceID,
		ItemTypeID:       itemTypeID,
		EmailProviderID:  CreateEmailProvider(t, server, name+" Provider", "generic"),
		IMAPHost:         "localhost",
		IMAPPort:         993,
		Username:         "testuser",
		Password:         "testpass",
		Encryption:       "ssl",
		RateLimitPerHour: rateLimitPerHour,
	})

	// The create endpoint builds its own (mostly empty) config; the real
	// intake settings land through the dedicated config-update endpoint. The
	// values satisfy ValidateConfigForEnable, but no IMAP connection is ever
	// dialed by these fixtures.
	channelConfig := map[string]any{
		"email_workspace_id": workspaceID,
		"email_item_type_id": itemTypeID,
		"email_auth_method":  "basic",
		"email_mailbox":      "INBOX",
		"email_mark_as_read": true,
		"imap_host":          "localhost",
		"imap_port":          993,
		"imap_username":      "testuser",
		"imap_password":      "testpass",
		"imap_encryption":    "ssl",
	}
	if rateLimitPerHour != nil {
		channelConfig["email_rate_limit_per_hour"] = *rateLimitPerHour
	}
	UpdateChannelConfig(t, server, channelID, channelConfig)

	return channelID
}

func createRateLimitedEmailChannel(t *testing.T, server *TestServer, name string) int {
	cap := 1
	return createInboundEmailChannelFixture(t, server, name, &cap)
}

// TestRequeueRateLimitedEmails verifies the flood-recovery boundary: the log
// reports declined mail, the requeue endpoint rewinds the watermark to the
// earliest declined UID in the current epoch, and repeated calls stay
// idempotent. A channel with nothing declined reports requeued=false.
func TestRequeueRateLimitedEmails(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)

	channelID := createRateLimitedEmailChannel(t, server, "Rate limit recovery")
	// The scheduler consumed UIDs up to 2 and declined the message at UID 2.
	setEmailWatermark(t, server, channelID, 2)
	seedRateLimitedEmail(t, server, channelID, "rate-1", 2, 42)

	t.Run("email log surfaces rate-limited mail", func(t *testing.T) {
		resp := MakeAuthRequest(t, server, http.MethodGet, fmt.Sprintf("/channels/%d/email-log", channelID), nil)
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusOK)

		var body struct {
			State struct {
				RateLimitedCount int `json:"rate_limited_count"`
			} `json:"state"`
			Messages []struct {
				ItemID        *int       `json:"item_id"`
				RateLimitedAt *time.Time `json:"rate_limited_at"`
				FromEmail     string     `json:"from_email"`
			} `json:"messages"`
		}
		DecodeJSON(t, resp, &body)
		if body.State.RateLimitedCount != 1 {
			t.Fatalf("rate_limited_count = %d, want 1", body.State.RateLimitedCount)
		}
		if len(body.Messages) != 1 {
			t.Fatalf("message rows = %d, want 1", len(body.Messages))
		}
		msg := body.Messages[0]
		if msg.RateLimitedAt == nil {
			t.Fatal("message row missing rate_limited_at")
		}
		if msg.ItemID != nil {
			t.Fatalf("rate-limited row has item_id %d, want null", *msg.ItemID)
		}
		if msg.FromEmail != "flooder@example.com" {
			t.Fatalf("from_email = %q, want flooder@example.com", msg.FromEmail)
		}
	})

	t.Run("requeue rewinds watermark to earliest declined UID", func(t *testing.T) {
		resp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/channels/%d/email/requeue-rate-limited", channelID), nil)
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusOK)

		var body struct {
			Requeued bool `json:"requeued"`
			FromUID  int  `json:"from_uid"`
		}
		DecodeJSON(t, resp, &body)
		if !body.Requeued || body.FromUID != 2 {
			t.Fatalf("requeue = (requeued:%v from_uid:%d), want (true, 2)", body.Requeued, body.FromUID)
		}
		lastUID, validity := getEmailWatermark(t, server, channelID)
		if lastUID != 1 || validity != 42 {
			t.Fatalf("watermark = %d/%d, want 1/42", lastUID, validity)
		}
	})

	t.Run("requeue is idempotent", func(t *testing.T) {
		resp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/channels/%d/email/requeue-rate-limited", channelID), nil)
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusOK)

		var body struct {
			Requeued bool `json:"requeued"`
			FromUID  int  `json:"from_uid"`
		}
		DecodeJSON(t, resp, &body)
		if !body.Requeued || body.FromUID != 2 {
			t.Fatalf("second requeue = (requeued:%v from_uid:%d), want (true, 2)", body.Requeued, body.FromUID)
		}
	})

	t.Run("channel without declined mail reports nothing to requeue", func(t *testing.T) {
		emptyChannelID := createRateLimitedEmailChannel(t, server, "Rate limit empty")
		resp := MakeAuthRequest(t, server, http.MethodPost, fmt.Sprintf("/channels/%d/email/requeue-rate-limited", emptyChannelID), nil)
		defer resp.Body.Close()
		AssertStatusCode(t, resp, http.StatusOK)

		var body struct {
			Requeued bool `json:"requeued"`
		}
		DecodeJSON(t, resp, &body)
		if body.Requeued {
			t.Fatal("empty channel reported requeued=true, want false")
		}
	})
}

// TestRequeueRateLimitedEmailsRequiresChannelManagement verifies the denial
// contract: a user without channel-management rights gets 403 for both the
// requeue action and the flood-visibility log.
func TestRequeueRateLimitedEmailsRequiresChannelManagement(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	server, cleanup := StartTestServer(t, GetDBType())
	defer cleanup()
	CreateBearerToken(t, server)

	channelID := createRateLimitedEmailChannel(t, server, "Rate limit denial")
	setEmailWatermark(t, server, channelID, 2)
	seedRateLimitedEmail(t, server, channelID, "rate-denied", 2, 42)

	_, otherUsername, otherPassword := CreateTestUserWithCredentials(
		t, server, "rate_limit_other", "rate-limit-other@test.com",
	)
	otherToken := CreateBearerTokenForUser(t, server, otherUsername, otherPassword)

	for _, tc := range []struct {
		name    string
		method  string
		endpoint string
	}{
		{"requeue denied", http.MethodPost, fmt.Sprintf("/channels/%d/email/requeue-rate-limited", channelID)},
		{"email log denied", http.MethodGet, fmt.Sprintf("/channels/%d/email-log", channelID)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := MakeAuthRequestWithToken(t, server, otherToken, tc.method, tc.endpoint, nil)
			defer resp.Body.Close()
			AssertStatusCode(t, resp, http.StatusForbidden)
		})
	}

	// The denial must not have mutated state.
	if lastUID, _ := getEmailWatermark(t, server, channelID); lastUID != 2 {
		t.Fatalf("watermark after denial = %d, want unchanged 2", lastUID)
	}
}
