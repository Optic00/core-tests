package utils

import (
	"net"
	"testing"
	"strings"
	"fmt"
)

func TestIsBlockedSSRFAddrWithAllowedCIDRs(t *testing.T) {
	SetAllowLocalConnections(false)
	defer SetAllowLocalConnections(true)

	cidrs, err := ParseCIDRList("100.64.0.0/10,10.2.3.4")
	if err != nil {
		t.Fatalf("ParseCIDRList: %v", err)
	}

	cases := []struct {
		ip      string
		blocked bool
	}{
		{"100.95.24.194", false}, // explicitly allowed WireGuard / CGNAT range
		{"10.2.3.4", false},      // bare IP parsed as /32
		{"10.2.3.5", true},
		{"127.0.0.1", true},       // loopback cannot be allowlisted
		{"169.254.169.254", true}, // link-local metadata cannot be allowlisted
		{"8.8.8.8", false},
	}

	for _, tc := range cases {
		t.Run(tc.ip, func(t *testing.T) {
			ip := net.ParseIP(tc.ip)
			if ip == nil {
				t.Fatalf("invalid test IP %q", tc.ip)
			}
			got := IsBlockedSSRFAddrWithAllowedCIDRs(ip, cidrs)
			if got != tc.blocked {
				t.Errorf("IsBlockedSSRFAddrWithAllowedCIDRs(%s) = %v, want %v", tc.ip, got, tc.blocked)
			}
		})
	}
}

func TestParseCIDRListRejectsInvalidInput(t *testing.T) {
	if _, err := ParseCIDRList("100.64.0.0/10,not-a-cidr"); err == nil {
		t.Fatal("expected ParseCIDRList to reject invalid input")
	}
}

// ParseCIDRList parses a comma-separated list of CIDRs. Bare IP literals are
// accepted as host routes (/32 for IPv4, /128 for IPv6) for operator
// convenience when allowing a single trusted endpoint.
func ParseCIDRList(value string) ([]*net.IPNet, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}

	parts := strings.Split(value, ",")
	cidrs := make([]*net.IPNet, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			_, cidr, err := net.ParseCIDR(part)
			if err != nil {
				return nil, fmt.Errorf("invalid CIDR %q: %w", part, err)
			}
			cidrs = append(cidrs, cidr)
			continue
		}

		ip := net.ParseIP(part)
		if ip == nil {
			return nil, fmt.Errorf("invalid IP/CIDR %q", part)
		}
		bits := 128
		if v4 := ip.To4(); v4 != nil {
			ip = v4
			bits = 32
		}
		cidrs = append(cidrs, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	return cidrs, nil
}
