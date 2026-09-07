package auth_test

import (
	"io"
	"sync"
	"testing"

	"windshift/internal/auth"
)

func TestValidationCacheCloseIsConcurrentAndIdempotent(t *testing.T) {
	for _, tc := range []struct {
		name string
		new  func() io.Closer
	}{
		{"api_tokens", func() io.Closer { return auth.NewTokenManager(nil, nil, 1) }},
		{"scim_tokens", func() io.Closer { return auth.NewSCIMTokenManager(nil, 1) }},
		{"sessions", func() io.Closer { return auth.NewSessionManager(nil, false, false, nil, "test-secret", "strict") }},
		{"sessions_disabled", func() io.Closer {
			return auth.NewSessionManagerWithValidationCacheTTL(nil, false, false, nil, "test-secret", "strict", 0)
		}},
		{"api_tokens_no_cache", func() io.Closer { return &auth.TokenManager{} }},
		{"scim_tokens_no_cache", func() io.Closer { return &auth.SCIMTokenManager{} }},
		{"sessions_no_validator", func() io.Closer { return &auth.SessionManager{} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			manager := tc.new()
			t.Cleanup(func() { _ = manager.Close() })
			var callers sync.WaitGroup
			for range 8 {
				callers.Go(func() {
					if err := manager.Close(); err != nil {
						t.Errorf("Close: %v", err)
					}
				})
			}
			callers.Wait()
			if err := manager.Close(); err != nil {
				t.Fatalf("repeated Close: %v", err)
			}
		})
	}
}
