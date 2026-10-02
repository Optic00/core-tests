//go:build test

package services

import (
	"slices"
	"testing"

	"windshift/internal/models"
	"windshift/internal/repository"
)

// Overrides stored before the toggleable id set changed (test-management
// entries were briefly toggleable) must not wedge every later save: reads
// drop unknown ids and the next successful PUT heals the stored row.
func TestStoredViewSettingsDropLegacyUnknownIDs(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	service := NewCollectionApplicationService(tdb.GetDatabase(), permissions)
	actor := AuditActor{UserID: seed.UserID}
	scope := BoardConfigurationScope{WorkspaceID: &seed.WorkspaceID}

	// Poison the stored row directly: a PUT could no longer produce this
	// shape, which is exactly the legacy state being healed.
	boards := repository.NewBoardConfigurationRepository(tdb.GetDatabase())
	stale := []string{"board", "list", "test-sets"}
	if _, err := boards.Create(nil, &seed.WorkspaceID, &models.BoardConfigurationRequest{
		Columns:      []models.BoardColumnRequest{},
		ViewSettings: &models.ViewSettings{EnabledViews: &stale},
	}); err != nil {
		t.Fatalf("seed poisoned row: %v", err)
	}

	config, err := service.GetBoardConfiguration(seed.UserID, scope)
	if err != nil {
		t.Fatalf("get poisoned row: %v", err)
	}
	assertEnabledViews(t, config.ViewSettings, []string{"board", "list"})

	// A UI round-trip of the cleaned set saves and heals the stored row.
	if _, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{
		ViewSettings: boardViewSettingsOverride("board", "list", "agents"),
	}); err != nil {
		t.Fatalf("save after normalization: %v", err)
	}
	stored, err := boards.GetByWorkspaceID(seed.WorkspaceID)
	if err != nil {
		t.Fatalf("reload stored row: %v", err)
	}
	if stored.ViewSettings == nil || stored.ViewSettings.EnabledViews == nil ||
		slices.Contains(*stored.ViewSettings.EnabledViews, "test-sets") {
		t.Fatalf("stored settings after heal = %+v, want legacy id dropped", stored.ViewSettings)
	}

	// A row holding nothing but stale ids reads as inherit, not as an empty
	// override, and a collection under it falls back to the default views.
	onlyStale := []string{"test-sets"}
	if err := boards.Update(stored.ID, &models.BoardConfigurationRequest{
		Columns:      []models.BoardColumnRequest{},
		ViewSettings: &models.ViewSettings{EnabledViews: &onlyStale},
	}); err != nil {
		t.Fatalf("rewrite row stale-only: %v", err)
	}
	config, err = service.GetBoardConfiguration(seed.UserID, scope)
	if err != nil {
		t.Fatalf("get stale-only row: %v", err)
	}
	// The reset representation (settings with a nil set) is the documented
	// "no override" state; a stale-only row must read the same way.
	if config.ViewSettings != nil && config.ViewSettings.EnabledViews != nil {
		t.Fatalf("stale-only workspace row = %+v, want the reset (nil set) state", config.ViewSettings)
	}

	collection, err := service.Create(actor, models.Collection{
		Name: "Legacy heal", WorkspaceID: &seed.WorkspaceID, QLQuery: "",
	})
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	config, err = service.GetBoardConfiguration(seed.UserID, BoardConfigurationScope{CollectionID: &collection.ID})
	if err != nil {
		t.Fatalf("get collection over stale row: %v", err)
	}
	assertEnabledViews(t, config.ViewSettings, models.BoardViewIDs)
	if !config.ViewSettingsInherited {
		t.Fatal("collection over stale-only row must report inherited")
	}
}

// The workspace scope owns every toggleable nav id: the six collection views
// plus the workspace-only tools entries. Collection scopes stay limited to
// the views, and test-management entries are not toggleable anywhere.
func TestWorkspaceScopeAcceptsWorkspaceNavIDs(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	service := NewCollectionApplicationService(tdb.GetDatabase(), permissions)
	actor := AuditActor{UserID: seed.UserID}
	scope := BoardConfigurationScope{WorkspaceID: &seed.WorkspaceID}

	created, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{
		ViewSettings: boardViewSettingsOverride("board", "queue", "agents", "pages"),
	})
	if err != nil {
		t.Fatalf("workspace override with nav ids: %v", err)
	}
	config, err := service.GetBoardConfiguration(seed.UserID, scope)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if config.ID != created.ID {
		t.Fatalf("config id = %d, want %d", config.ID, created.ID)
	}
	// The stored override keeps submission order; set semantics are enforced
	// on read (canonical ordering applies to merged effective responses).
	assertEnabledViews(t, config.ViewSettings, []string{"board", "queue", "agents", "pages"})

	// Test-management entries are not toggleable anywhere.
	if _, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{
		ViewSettings: boardViewSettingsOverride("board", "test-cases"),
	}); err == nil || err.Error() != `unknown view "test-cases" in enabled_views` {
		t.Fatalf("test entry error = %v, want unknown view rejection", err)
	}
}

func TestCollectionScopeRejectsWorkspaceOnlyNavIDs(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	service := NewCollectionApplicationService(tdb.GetDatabase(), permissions)
	actor := AuditActor{UserID: seed.UserID}

	collection, err := service.Create(actor, models.Collection{
		Name: "Nav scope", WorkspaceID: &seed.WorkspaceID, QLQuery: "",
	})
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	scope := BoardConfigurationScope{CollectionID: &collection.ID}

	for _, id := range []string{"agents", "analytics"} {
		if _, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{
			ViewSettings: boardViewSettingsOverride("board", id),
		}); err == nil || err.Error() != wantNavScopeError(id) {
			t.Fatalf("collection override with %q error = %v, want %q", id, err, wantNavScopeError(id))
		}
	}
}

func wantNavScopeError(id string) string {
	return `view "` + id + `" can only be toggled at the workspace scope`
}

// A collection view override replaces only the view ids; workspace-only nav
// ids keep inheriting from the workspace row, merged in canonical order.
func TestCollectionOverrideInheritsWorkspaceNavIDs(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	service := NewCollectionApplicationService(tdb.GetDatabase(), permissions)
	actor := AuditActor{UserID: seed.UserID}

	collection, err := service.Create(actor, models.Collection{
		Name: "Nav inherit", WorkspaceID: &seed.WorkspaceID, QLQuery: "",
	})
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	collectionScope := BoardConfigurationScope{CollectionID: &collection.ID}
	workspaceScope := BoardConfigurationScope{WorkspaceID: &seed.WorkspaceID}

	if _, err := service.PutBoardConfiguration(actor, workspaceScope, models.BoardConfigurationRequest{
		ViewSettings: boardViewSettingsOverride("board", "list", "agents", "pages"),
	}); err != nil {
		t.Fatalf("workspace override: %v", err)
	}

	// Without a collection row the whole workspace set inherits.
	config, err := service.GetBoardConfiguration(seed.UserID, collectionScope)
	if err != nil {
		t.Fatalf("get inherited: %v", err)
	}
	assertEnabledViews(t, config.ViewSettings, []string{"board", "list", "agents", "pages"})

	// With a collection row the views override and the nav ids persist.
	if _, err := service.PutBoardConfiguration(actor, collectionScope, models.BoardConfigurationRequest{
		ViewSettings: boardViewSettingsOverride("board"),
	}); err != nil {
		t.Fatalf("collection override: %v", err)
	}
	config, err = service.GetBoardConfiguration(seed.UserID, collectionScope)
	if err != nil {
		t.Fatalf("get after override: %v", err)
	}
	assertEnabledViews(t, config.ViewSettings, []string{"board", "agents", "pages"})

	// Resetting the collection override restores the full workspace set.
	if _, err := service.PutBoardConfiguration(actor, collectionScope, models.BoardConfigurationRequest{
		ViewSettings: boardViewSettingsReset(),
	}); err != nil {
		t.Fatalf("collection reset: %v", err)
	}
	config, err = service.GetBoardConfiguration(seed.UserID, collectionScope)
	if err != nil {
		t.Fatalf("get after reset: %v", err)
	}
	assertEnabledViews(t, config.ViewSettings, []string{"board", "list", "agents", "pages"})
}
