package tests

import (
	"fmt"
	"net/http"
	"testing"
)

type catalogFixture struct {
	admin, reader *TestServer
	bearer        bool
}

func runCatalogCase(t *testing.T, test func(*testing.T, *catalogFixture)) {
	t.Helper()
	for _, bearer := range []bool{false, true} {
		t.Run(fmt.Sprintf("bearer=%t", bearer), func(t *testing.T) {
			admin, _ := StartTestServer(t, GetDBType())
			CreateBearerToken(t, admin)
			_, username, password := CreateTestUserWithCredentials(t, admin, "catalog-reader", "catalog-reader@example.test")
			cookie, token := CreateAuthCredentialsForUser(t, admin, username, password)
			reader := *admin
			reader.SessionCookie, reader.BearerToken = cookie, token
			test(t, &catalogFixture{admin: admin, reader: &reader, bearer: bearer})
		})
	}
}

func (f *catalogFixture) request(t *testing.T, actor *TestServer, method, path string, body any) *http.Response {
	t.Helper()
	var response *http.Response
	if f.bearer {
		response = MakeV2BearerRequest(t, actor, method, path, body)
	} else {
		response = MakeV2SessionRequest(t, actor, method, path, body)
	}
	if response.StatusCode != http.StatusNoContent {
		assertCommentJSON(t, response)
	}
	return response
}

func assertV2Error(t *testing.T, response *http.Response, status int, code string, messages ...string) {
	t.Helper()
	defer response.Body.Close()
	AssertStatusCode(t, response, status)
	assertCommentJSON(t, response)
	var body struct {
		Error struct {
			Code, Message string
		} `json:"error"`
	}
	DecodeJSON(t, response, &body)
	if body.Error.Code != code {
		t.Fatalf("v2 error code=%q, want %q", body.Error.Code, code)
	}
	for _, message := range messages {
		if body.Error.Message != message {
			t.Fatalf("v2 error message=%q, want %q", body.Error.Message, message)
		}
	}
}
