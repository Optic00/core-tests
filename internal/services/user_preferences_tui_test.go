package services

import (
	"fmt"
	"testing"

	"windshift/internal/database"
	"windshift/internal/models"
	"windshift/internal/repository"
)

func openTUIPrefsTestDB(t *testing.T) (database.Database, *UserPreferencesService) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s/tuiprefs.db?mode=memory&cache=shared", t.TempDir())
	db, err := database.NewSQLiteDBWithPoolSizes(dsn, 4, 1)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Initialize(); err != nil {
		t.Fatalf("init db: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO users(id, email, username, first_name, last_name) VALUES (1, 'u@example.com', 'u', 'U', 'Ser')`,
	); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	svc := NewUserPreferencesService(
		repository.NewUserPreferencesRepository(db),
		repository.NewThemeRepository(db),
	)
	return db, svc
}

func floatp(v float64) *float64 { return &v }
func intp(v int) *int           { return &v }

func TestTUIPreferencesRoundTrip(t *testing.T) {
	_, svc := openTUIPrefsTestDB(t)

	// Unset → zero value, no error.
	got, err := svc.GetTUI(1)
	if err != nil {
		t.Fatalf("GetTUI on empty prefs: %v", err)
	}
	if got.Theme != "" || got.SplitRatio != nil || got.LastWorkspaceID != nil {
		t.Fatalf("expected zero prefs, got %+v", got)
	}

	if err := svc.UpdateTUI(1, models.UserTUIPreferences{
		Theme:           "void",
		SplitRatio:      floatp(0.42),
		LastWorkspaceID: intp(7),
	}); err != nil {
		t.Fatalf("UpdateTUI: %v", err)
	}

	got, err = svc.GetTUI(1)
	if err != nil {
		t.Fatalf("GetTUI: %v", err)
	}
	if got.Theme != "void" || got.SplitRatio == nil || *got.SplitRatio != 0.42 ||
		got.LastWorkspaceID == nil || *got.LastWorkspaceID != 7 {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestPreferenceSnapshotPatchPreservesOmittedFieldsAndClearsExplicitValues(t *testing.T) {
	_, svc := openTUIPrefsTestDB(t)
	if err := svc.UpdateTUI(1, models.UserTUIPreferences{
		Theme: "void", SplitRatio: floatp(0.42), LastWorkspaceID: intp(7),
	}); err != nil {
		t.Fatalf("seed TUI: %v", err)
	}

	snapshot, err := svc.UpdateSnapshot(1, UserPreferencesPatch{
		TUIThemeSet: true, TUITheme: "onyx", LastWorkspaceIDSet: true,
	})
	if err != nil {
		t.Fatalf("UpdateSnapshot: %v", err)
	}
	if snapshot.TUI.Theme != "onyx" || snapshot.TUI.SplitRatio == nil || *snapshot.TUI.SplitRatio != 0.42 {
		t.Fatalf("omitted split ratio was not preserved: %+v", snapshot.TUI)
	}
	if snapshot.TUI.LastWorkspaceID != nil {
		t.Fatalf("explicit-null workspace was not cleared: %+v", snapshot.TUI)
	}
}

func TestTUIPreferencesDoNotClobberDashboardLayout(t *testing.T) {
	_, svc := openTUIPrefsTestDB(t)

	layout := models.UserDashboardLayout{
		Sections: []models.UserDashboardSection{{ID: "s1"}},
		Widgets:  []models.UserDashboardWidget{},
	}
	if err := svc.UpdateDashboardLayout(1, layout); err != nil {
		t.Fatalf("UpdateDashboardLayout: %v", err)
	}

	if err := svc.UpdateTUI(1, models.UserTUIPreferences{Theme: "onyx"}); err != nil {
		t.Fatalf("UpdateTUI: %v", err)
	}

	gotLayout, err := svc.GetDashboardLayout(1)
	if err != nil {
		t.Fatalf("GetDashboardLayout: %v", err)
	}
	if len(gotLayout.Sections) != 1 || gotLayout.Sections[0].ID != "s1" {
		t.Fatalf("dashboard layout clobbered by TUI update: %+v", gotLayout)
	}

	gotTUI, err := svc.GetTUI(1)
	if err != nil || gotTUI.Theme != "onyx" {
		t.Fatalf("TUI prefs lost: %+v err=%v", gotTUI, err)
	}
}

func TestTUIPreferencesNormalization(t *testing.T) {
	_, svc := openTUIPrefsTestDB(t)

	long := make([]byte, 100)
	for i := range long {
		long[i] = 'x'
	}
	if err := svc.UpdateTUI(1, models.UserTUIPreferences{
		Theme:           string(long),
		SplitRatio:      floatp(3.5),
		LastWorkspaceID: intp(-4),
	}); err != nil {
		t.Fatalf("UpdateTUI: %v", err)
	}

	got, err := svc.GetTUI(1)
	if err != nil {
		t.Fatalf("GetTUI: %v", err)
	}
	if len(got.Theme) != 64 {
		t.Fatalf("theme not truncated: len=%d", len(got.Theme))
	}
	if got.SplitRatio == nil || *got.SplitRatio != 0.9 {
		t.Fatalf("split ratio not clamped: %+v", got.SplitRatio)
	}
	if got.LastWorkspaceID != nil {
		t.Fatalf("non-positive workspace id not dropped: %v", *got.LastWorkspaceID)
	}
}

func TestTUIPreferencesHideLastWorkspaceAfterRevocation(t *testing.T) {
	db, _ := openTUIPrefsTestDB(t)
	if _, err := db.Exec(`
		INSERT INTO users(id, email, username, first_name, last_name)
		VALUES (2, 'keeper@example.test', 'keeper', 'Keep', 'Er')
	`); err != nil {
		t.Fatalf("seed workspace keeper: %v", err)
	}
	workspace, err := NewWorkspaceService(db).Create(t.Context(), CreateWorkspaceParams{
		Name: "TUI revocation", Key: "TUIR", CreatorID: 2,
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	permissions, err := NewPermissionService(db, DefaultPermissionCacheConfig())
	if err != nil {
		t.Fatalf("create permission service: %v", err)
	}
	t.Cleanup(func() { _ = permissions.Close() })
	svc := NewUserPreferencesService(
		repository.NewUserPreferencesRepository(db),
		repository.NewThemeRepository(db),
		permissions,
	)
	var viewerRoleID int
	if err := db.QueryRow(`SELECT id FROM workspace_roles WHERE name = ?`, models.RoleViewer).Scan(&viewerRoleID); err != nil {
		t.Fatalf("load viewer role: %v", err)
	}
	roles := repository.NewWorkspaceRoleRepository(db)
	if err := roles.AssignToUser(2, workspace.Workspace.ID, viewerRoleID, 2); err != nil {
		t.Fatalf("lock down workspace: %v", err)
	}
	if err := roles.AssignToUser(1, workspace.Workspace.ID, viewerRoleID, 2); err != nil {
		t.Fatalf("assign viewer role: %v", err)
	}
	if err := svc.UpdateTUI(1, models.UserTUIPreferences{LastWorkspaceID: intp(workspace.Workspace.ID)}); err != nil {
		t.Fatalf("store accessible last workspace: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM user_workspace_roles WHERE user_id = ? AND workspace_id = ?`, 1, workspace.Workspace.ID); err != nil {
		t.Fatalf("revoke workspace role: %v", err)
	}
	if err := permissions.InvalidateUserCache(1); err != nil {
		t.Fatalf("invalidate permission cache: %v", err)
	}
	got, err := svc.GetTUI(1)
	if err != nil {
		t.Fatalf("GetTUI after revocation: %v", err)
	}
	if got.LastWorkspaceID != nil {
		t.Fatalf("last workspace after revocation = %d, want omitted", *got.LastWorkspaceID)
	}
}
