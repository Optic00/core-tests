package tests

import (
	"bytes"
	"context"
	"path/filepath"
	"runtime/pprof"
	"strings"
	"testing"
	"time"

	"windshift/internal/auth"
	"windshift/internal/config"
	"windshift/internal/server"
)

// Cache workers retain their caches after the server is otherwise unreachable.
// Observe worker identities because unrelated workers exiting must not mask a
// leak. Run sequentially with respect to other server/cache constructors.
func TestServerShutdownStopsCacheWorkers(t *testing.T) {
	for _, ttl := range []time.Duration{0, auth.DefaultSessionValidationCacheTTL} {
		t.Run("session_cache_"+ttl.String(), func(t *testing.T) {
			preexisting := cacheWorkerIDs(t)
			other := auth.NewTokenManagerWithCacheBudget(nil, nil, "unrelated_shutdown_test", 1)
			t.Cleanup(func() { _ = other.Close() })
			unrelated := cacheWorkerIDs(t)
			for id := range preexisting {
				delete(unrelated, id)
			}
			if len(unrelated) != 1 {
				t.Fatalf("unrelated cache workers = %d, want 1", len(unrelated))
			}
			before := cacheWorkerIDs(t)
			ts, cleanup := startTestServer(t, GetDBType(), func(cfg *server.Config) {
				cfg.Auth.SessionValidationCacheTTL = ttl
			})
			owned := cacheWorkerIDs(t)
			for id := range before {
				delete(owned, id)
			}
			// Guard against a vacuous pass if BigCache changes its worker name.
			wantWorkers := 6
			if ttl > 0 {
				wantWorkers++
			}
			if len(owned) != wantWorkers {
				t.Fatalf("server cache workers = %d, want %d", len(owned), wantWorkers)
			}
			cleanup()
			if err := ts.server.Shutdown(context.Background()); err != nil {
				t.Fatalf("repeated Shutdown: %v", err)
			}
			waitForCondition(t, 3*time.Second, "server cache workers to stop", func() bool {
				for id := range cacheWorkerIDs(t) {
					if owned[id] {
						return false
					}
				}
				return true
			})
			remaining := cacheWorkerIDs(t)
			for id := range unrelated {
				if !remaining[id] {
					t.Fatal("server shutdown stopped an unrelated cache worker")
				}
			}
		})
	}
}

func TestServerStartupFailureStopsCacheWorkers_SQLite(t *testing.T) {
	before := cacheWorkerIDs(t)
	activityBefore := workerIDs(t, "windshift/internal/server.(*Server).runActivityCleanup(")
	// A missing production RPID fails after permission, activity and session
	// caches are constructed, before the HTTP server is returned to its owner.
	srv, err := server.New(server.Config{
		Port: "0", SilentMode: true,
		DB: config.DBConfig{
			SQLitePath:   filepath.Join(t.TempDir(), "startup-failure.db"),
			MaxReadConns: 2, MaxWriteConns: 1,
		},
		Auth: config.AuthConfig{
			SessionSecret:             "cache-startup-test-secret",
			SessionValidationCacheTTL: auth.DefaultSessionValidationCacheTTL,
		},
	})
	if srv != nil {
		t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })
		t.Fatal("server unexpectedly started with no production RPID")
	}
	if err == nil || !strings.Contains(err.Error(), "no RP ID provided") {
		t.Fatalf("startup error = %v, want missing RPID", err)
	}
	waitForCondition(t, 3*time.Second, "failed startup cache workers to stop", func() bool {
		for id := range cacheWorkerIDs(t) {
			if !before[id] {
				return false
			}
		}
		return true
	})
	waitForCondition(t, 3*time.Second, "failed startup activity cleanup to stop", func() bool {
		for id := range workerIDs(t, "windshift/internal/server.(*Server).runActivityCleanup(") {
			if !activityBefore[id] {
				return false
			}
		}
		return true
	})
}

func cacheWorkerIDs(t *testing.T) map[string]bool {
	t.Helper()
	return workerIDs(t, "bigcache/v3.newBigCache.func1()")
}

func workerIDs(t *testing.T, frame string) map[string]bool {
	t.Helper()
	var stacks bytes.Buffer
	if err := pprof.Lookup("goroutine").WriteTo(&stacks, 2); err != nil {
		t.Fatal(err)
	}
	workers := make(map[string]bool)
	for _, stack := range strings.Split(stacks.String(), "\n\n") {
		if strings.Contains(stack, frame) {
			fields := strings.Fields(stack)
			if len(fields) < 2 || fields[0] != "goroutine" {
				t.Fatalf("unexpected goroutine profile header: %q", stack)
			}
			workers[fields[1]] = true
		}
	}
	return workers
}
