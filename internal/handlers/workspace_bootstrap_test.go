package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"errors"
	"windshift/internal/repository"
)

func TestWorkspaceBootstrapRequiresAuthentication(t *testing.T) {
	handler := NewWorkspaceBootstrapHandler(&WorkspaceHandler{}, nil, nil, nil, nil)
	recorder := httptest.NewRecorder()

	handler.Get(recorder, httptest.NewRequest(http.MethodGet, "/api/workspaces/1/bootstrap", nil))

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func (h *WorkspaceHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, ok := RequireAuth(w, r)
	if !ok {
		return
	}
	id, ok := requireWorkspaceIDParam(w, r, h.keyCache, "id")
	if !ok {
		return
	}
	workspace, err := h.loadWorkspaceForUser(user, id)
	if errors.Is(err, repository.ErrNotFound) {
		respondNotFound(w, r, "workspace")
		return
	}
	if err != nil {
		respondInternalError(w, r, err)
		return
	}
	h.trackWorkspaceVisit(user.ID, workspace.ID)
	respondJSONOK(w, workspace)
}
