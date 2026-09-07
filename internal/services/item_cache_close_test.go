//go:build test

package services_test

import (
	"io"
	"sync"
	"testing"
	"time"

	"windshift/internal/services"
	"windshift/internal/testutils"
)

func TestItemCacheCloseIsConcurrentAndIdempotent(t *testing.T) {
	cache, err := services.NewItemCacheService(nil, services.ItemCacheConfig{
		HierarchyTTL: time.Minute, MaxCacheSize: 1, EnablePreWarm: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cache.Close() })
	var callers sync.WaitGroup
	for range 8 {
		callers.Go(func() {
			if err := cache.Close(); err != nil {
				t.Errorf("Close: %v", err)
			}
		})
	}
	callers.Wait()
	if err := cache.Close(); err != nil {
		t.Fatalf("repeated Close: %v", err)
	}
	if err := (&services.ItemCacheService{}).Close(); err != nil {
		t.Fatalf("Close with no cache: %v", err)
	}
}

func TestPermissionCacheCloseIsConcurrentAndIdempotent(t *testing.T) {
	db := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { _ = db.Close() })
	cache, err := services.NewPermissionService(db.DB, services.PermissionCacheConfig{
		TTL: time.Minute, MaxCacheSize: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cache.Close() })
	for _, closer := range []io.Closer{cache, &services.PermissionService{}} {
		var callers sync.WaitGroup
		for range 8 {
			callers.Go(func() {
				if err := closer.Close(); err != nil {
					t.Errorf("Close: %v", err)
				}
			})
		}
		callers.Wait()
	}
	// Cache ownership must not extend to the shared database.
	var one int
	if err := db.QueryRow("SELECT 1").Scan(&one); err != nil || one != 1 {
		t.Fatalf("database after cache close: value=%d error=%v", one, err)
	}
}
