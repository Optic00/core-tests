//go:build test

package ldap

import (
	"testing"

	"windshift/internal/models"
	"windshift/internal/utils"
)

func TestLDAPTLSConfigHonorsConnectionAndProcessBypasses(t *testing.T) {
	t.Cleanup(func() { utils.SetSkipTLSVerify(false) })

	tests := []struct {
		name        string
		connection  bool
		processWide bool
		want        bool
	}{
		{name: "verification enabled by default"},
		{name: "connection bypass", connection: true, want: true},
		{name: "process-wide bypass", processWide: true, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			utils.SetSkipTLSVerify(tt.processWide)
			cfg := ldapTLSConfig(&models.LDAPConfig{Host: "ldap.internal.example", SkipTLSVerify: tt.connection})
			if cfg.InsecureSkipVerify != tt.want {
				t.Fatalf("InsecureSkipVerify = %v, want %v", cfg.InsecureSkipVerify, tt.want)
			}
			if cfg.ServerName != "ldap.internal.example" {
				t.Fatalf("ServerName = %q, want ldap.internal.example", cfg.ServerName)
			}
		})
	}
}
