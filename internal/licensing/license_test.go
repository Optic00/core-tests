package licensing

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func testKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	return pub, priv
}

func testLicense() License {
	issued := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	return License{
		Plugin:     "windshift-pro",
		InstanceID: "1A2B-3C4D-5E6F-7081",
		IssuedAt:   issued,
	}
}

func TestSignAndVerifyRoundTrip(t *testing.T) {
	pub, priv := testKeyPair(t)
	token, err := Sign(testLicense(), priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	license, err := Verify(token, pub)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	want := testLicense()
	if license.Plugin != want.Plugin || license.InstanceID != want.InstanceID {
		t.Errorf("round trip mismatch: got %+v, want plugin=%q instance=%q", license, want.Plugin, want.InstanceID)
	}
}

func TestVerifyRejectsTamperedPayload(t *testing.T) {
	pub, priv := testKeyPair(t)
	token, err := Sign(testLicense(), priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// Move the payload one character: the signature no longer matches.
	payloadPart, sigPart, _ := splitToken(token)
	payload, err := base64RawURLDecode(payloadPart)
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	payload[len(payload)-1] ^= 0x01
	tampered := encodeRawURLBase64(payload) + "." + sigPart

	if _, err := Verify(tampered, pub); !errors.Is(err, ErrLicenseBadSignature) {
		t.Errorf("Verify(tampered) error = %v, want ErrLicenseBadSignature", err)
	}
}

func TestVerifyRejectsWrongKeyAndMalformedTokens(t *testing.T) {
	otherPub, _ := testKeyPair(t)
	_, priv := testKeyPair(t)

	token, err := Sign(testLicense(), priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := Verify(token, otherPub); !errors.Is(err, ErrLicenseBadSignature) {
		t.Errorf("Verify(wrong key) error = %v, want ErrLicenseBadSignature", err)
	}
	for _, malformed := range []string{"", "not-a-token", "a.b.c", "%%%.AAA"} {
		if _, err := Verify(malformed, otherPub); !errors.Is(err, ErrLicenseMalformed) && !errors.Is(err, ErrLicenseBadSignature) {
			t.Errorf("Verify(%q) error = %v, want malformed or bad signature", malformed, err)
		}
	}
}

func TestValidateChecksPluginInstanceAndExpiry(t *testing.T) {
	license := testLicense()
	now := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)

	if err := Validate(license, "windshift-pro", license.InstanceID, now); err != nil {
		t.Errorf("Validate(valid) = %v, want nil", err)
	}

	if err := Validate(license, "other-plugin", license.InstanceID, now); !errors.Is(err, ErrLicenseWrongPlugin) {
		t.Errorf("Validate(wrong plugin) = %v, want ErrLicenseWrongPlugin", err)
	}

	if err := Validate(license, "windshift-pro", "FFFF-FFFF-FFFF-FFFF", now); !errors.Is(err, ErrLicenseWrongHost) {
		t.Errorf("Validate(wrong instance) = %v, want ErrLicenseWrongHost", err)
	}

	expiry := now.Add(-24 * time.Hour)
	license.ExpiresAt = &expiry
	if err := Validate(license, "windshift-pro", license.InstanceID, now); !errors.Is(err, ErrLicenseExpired) {
		t.Errorf("Validate(expired) = %v, want ErrLicenseExpired", err)
	}
}

func TestMakeVerifierAcceptsValidAndRejectsEverythingElse(t *testing.T) {
	pub, priv := testKeyPair(t)
	const instanceID = "1A2B-3C4D-5E6F-7081"
	verifier := MakeVerifier(pub, instanceID)

	token, err := Sign(testLicense(), priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if err := verifier("windshift-pro", []byte(token)); err != nil {
		t.Errorf("verifier(valid license) = %v, want nil", err)
	}
	if err := verifier("windshift-pro", nil); !errors.Is(err, ErrLicenseMalformed) {
		t.Errorf("verifier(missing license) = %v, want ErrLicenseMalformed", err)
	}

	// A license for another instance must not verify on this one.
	other := testLicense()
	other.InstanceID = "FFFF-FFFF-FFFF-FFFF"
	otherToken, err := Sign(other, priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if err := verifier("windshift-pro", []byte(otherToken)); !errors.Is(err, ErrLicenseWrongHost) {
		t.Errorf("verifier(other instance) = %v, want ErrLicenseWrongHost", err)
	}

	// Payload must actually be a license, not arbitrary signed data.
	if _, err := json.Marshal("not a license"); err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := verifier("windshift-pro", []byte("AAAA.BBBB")); err == nil {
		t.Error("verifier(garbage token) = nil, want error")
	}
}

func base64RawURLDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

func encodeRawURLBase64(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}
