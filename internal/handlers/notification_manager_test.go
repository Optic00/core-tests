package handlers

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"windshift/internal/database"
	"windshift/internal/models"
	"windshift/internal/testutils"
)

type recordingPushDispatcher struct {
	mu            sync.Mutex
	notifications []models.Notification
	reject        bool
}

func (d *recordingPushDispatcher) Enqueue(notification models.Notification) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.reject {
		return false
	}
	d.notifications = append(d.notifications, notification)
	return true
}

func (d *recordingPushDispatcher) Close(context.Context) error { return nil }

func newNotificationManagerTestDB(t *testing.T) database.Database {
	t.Helper()
	tdb := testutils.CreateTestDB(t, true)
	db := tdb.GetDatabase()
	for id := 1; id <= 3; id++ {
		if _, err := db.ExecWrite(`
			INSERT INTO users (id, email, username, first_name, last_name)
			VALUES (?, ?, ?, 'Notification', 'Test')
			ON CONFLICT(id) DO NOTHING
		`, id, fmt.Sprintf("notification-manager-%d@example.com", id), fmt.Sprintf("notification-manager-%d", id)); err != nil {
			_ = tdb.Close()
			t.Fatalf("insert notification user %d: %v", id, err)
		}
	}
	t.Cleanup(func() { _ = tdb.Close() })
	return db
}

func newNotificationManagerForTest(t *testing.T, db database.Database) *NotificationManager {
	t.Helper()
	config := DefaultNotificationManagerConfig()
	config.MaxBatchSize = 25
	manager, err := NewNotificationManager(db, config)
	if err != nil {
		t.Fatalf("new notification manager: %v", err)
	}
	t.Cleanup(manager.Stop)
	return manager
}

func testNotifications(userID, count int) []models.Notification {
	notifications := make([]models.Notification, count)
	for i := range notifications {
		notifications[i] = models.Notification{
			UserID:             userID,
			Title:              fmt.Sprintf("Notification %d", i),
			Message:            "bounded payload",
			Type:               "info",
			ActionURL:          fmt.Sprintf("/workspaces/1/items/%d", i+1),
			AuthorizationScope: models.NotificationScopeSystem,
		}
	}
	return notifications
}

func TestNotificationManagerBulkInsertAndCompactCache(t *testing.T) {
	db := newNotificationManagerTestDB(t)
	manager := newNotificationManagerForTest(t, db)
	dispatcher := &recordingPushDispatcher{}
	manager.SetPushDispatcher(dispatcher)

	// Warm an empty complete snapshot so inserts update rather than invalidate it.
	if got, err := manager.GetUserNotifications(1, 50, 0); err != nil || len(got) != 0 {
		t.Fatalf("warm cache: len=%d err=%v", len(got), err)
	}
	stored, err := manager.AddNotifications(testNotifications(1, 1000))
	if err != nil {
		t.Fatalf("bulk insert: %v", err)
	}
	if len(stored) != 1000 || stored[0].ID == 0 || stored[999].ID == 0 {
		t.Fatalf("stored ids not populated: first=%d last=%d count=%d", stored[0].ID, stored[999].ID, len(stored))
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id = 1`).Scan(&count); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if count != 1000 {
		t.Fatalf("database count = %d, want 1000", count)
	}
	var persisted models.Notification
	var deliveryState string
	var deliveryAttempts int
	if err := db.QueryRow(`
		SELECT user_id, title, message, type, read, action_url, authorization_scope,
		       email_delivery_state, email_delivery_attempts
		FROM notifications WHERE id = ?
	`, stored[0].ID).Scan(
		&persisted.UserID, &persisted.Title, &persisted.Message, &persisted.Type,
		&persisted.Read, &persisted.ActionURL, &persisted.AuthorizationScope,
		&deliveryState, &deliveryAttempts,
	); err != nil {
		t.Fatalf("read persisted notification: %v", err)
	}
	if persisted.UserID != 1 || persisted.Title != "Notification 0" || persisted.Message != "bounded payload" ||
		persisted.Type != "info" || persisted.Read || persisted.ActionURL != "/workspaces/1/items/1" ||
		persisted.AuthorizationScope != models.NotificationScopeSystem || deliveryState != "pending" || deliveryAttempts != 0 {
		t.Fatalf("persisted notification = %+v delivery_state:%s attempts:%d", persisted, deliveryState, deliveryAttempts)
	}
	cache, ok := manager.cacheSnapshot(1)
	if !ok || len(cache.Notifications) != notificationCachePageSize || cache.Complete {
		t.Fatalf("cache snapshot = ok:%v len:%d complete:%v", ok, len(cache.Notifications), cache.Complete)
	}
	if page, err := manager.GetUserNotifications(1, 10, 90); err != nil || len(page) != 10 {
		t.Fatalf("cached page: len=%d err=%v", len(page), err)
	}
	if page, err := manager.GetUserNotifications(1, 20, 100); err != nil || len(page) != 20 {
		t.Fatalf("deep page: len=%d err=%v", len(page), err)
	}
	stats := manager.GetStats()
	if stats["insert_batches"] != 1 || stats["inserted"] != 1000 || stats["max_cache_entry_bytes"] <= 0 {
		t.Fatalf("manager stats = %+v", stats)
	}
	dispatcher.mu.Lock()
	pushCount := len(dispatcher.notifications)
	dispatcher.mu.Unlock()
	if pushCount != 1000 {
		t.Fatalf("push enqueue count = %d, want 1000", pushCount)
	}
}

func TestNotificationManagerBulkInsertRollsBackWholeBatch(t *testing.T) {
	db := newNotificationManagerTestDB(t)
	manager := newNotificationManagerForTest(t, db)
	batch := []models.Notification{
		testNotifications(1, 1)[0],
		testNotifications(999999, 1)[0],
	}
	if _, err := manager.AddNotifications(batch); err == nil {
		t.Fatal("bulk insert with missing recipient succeeded")
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id = 1`).Scan(&count); err != nil {
		t.Fatalf("count rolled-back notifications: %v", err)
	}
	if count != 0 {
		t.Fatalf("notifications after failed batch = %d, want 0", count)
	}
}

func TestNotificationManagerSlowUserDoesNotBlockAnotherUser(t *testing.T) {
	db := newNotificationManagerTestDB(t)
	manager := newNotificationManagerForTest(t, db)

	blockedLock := manager.userLock(1)
	blockedLock.Lock()
	blockedDone := make(chan error, 1)
	waiting := make(chan struct{})
	var waitingOnce sync.Once
	manager.beforeUserLock = func(userID int) {
		if userID == 1 {
			waitingOnce.Do(func() { close(waiting) })
		}
	}
	go func() {
		_, err := manager.AddNotification(testNotifications(1, 1)[0])
		blockedDone <- err
	}()
	<-waiting

	otherDone := make(chan error, 1)
	go func() {
		_, err := manager.AddNotification(testNotifications(2, 1)[0])
		otherDone <- err
	}()
	select {
	case err := <-otherDone:
		if err != nil {
			t.Fatalf("other user insert: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("unrelated user was blocked by another user lock")
	}
	blockedLock.Unlock()
	if err := <-blockedDone; err != nil {
		t.Fatalf("blocked user insert: %v", err)
	}
}

func TestNotificationManagerConcurrentCreateReadUpdate(t *testing.T) {
	db := newNotificationManagerTestDB(t)
	manager := newNotificationManagerForTest(t, db)
	initial, err := manager.AddNotifications(testNotifications(1, 50))
	if err != nil {
		t.Fatalf("seed notifications: %v", err)
	}

	var workers sync.WaitGroup
	for worker := 0; worker < 12; worker++ {
		workers.Add(1)
		go func(worker int) {
			defer workers.Done()
			for i := 0; i < 50; i++ {
				switch worker % 3 {
				case 0:
					_, _ = manager.AddNotification(testNotifications((worker%2)+1, 1)[0])
				case 1:
					_, _ = manager.GetUserNotifications(1, 50, 0)
				case 2:
					_ = manager.MarkAsRead(1, initial[i%len(initial)].ID)
				}
			}
		}(worker)
	}
	workers.Wait()
	if page, err := manager.GetUserNotifications(1, 100, 0); err != nil || len(page) == 0 || len(page) > notificationCachePageSize {
		t.Fatalf("final page: len=%d err=%v", len(page), err)
	}
}

func TestNotificationManagerMarkAllAsReadUpdatesDatabaseAndWarmCache(t *testing.T) {
	db := newNotificationManagerTestDB(t)
	manager := newNotificationManagerForTest(t, db)

	if _, err := manager.AddNotifications(testNotifications(1, 3)); err != nil {
		t.Fatalf("seed notifications: %v", err)
	}
	if _, err := manager.AddNotifications(testNotifications(2, 1)); err != nil {
		t.Fatalf("seed other user notification: %v", err)
	}
	if page, err := manager.GetUserNotifications(1, 50, 0); err != nil || len(page) != 3 {
		t.Fatalf("warm cache: len=%d err=%v", len(page), err)
	}

	if err := manager.MarkAllAsRead(1); err != nil {
		t.Fatalf("mark all as read: %v", err)
	}

	var unread int
	if err := db.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id = 1 AND read = false`).Scan(&unread); err != nil {
		t.Fatalf("count unread notifications: %v", err)
	}
	if unread != 0 {
		t.Fatalf("unread notifications = %d, want 0", unread)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id = 2 AND read = false`).Scan(&unread); err != nil {
		t.Fatalf("count other user unread notifications: %v", err)
	}
	if unread != 1 {
		t.Fatalf("other user unread notifications = %d, want 1", unread)
	}

	page, err := manager.GetUserNotifications(1, 50, 0)
	if err != nil {
		t.Fatalf("read cached notifications: %v", err)
	}
	for _, notification := range page {
		if !notification.Read {
			t.Fatalf("cached notification %d is unread", notification.ID)
		}
	}
}
