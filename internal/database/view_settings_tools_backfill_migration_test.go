//go:build test

package database

import (
	"fmt"
	"testing"
)

func TestMigrationViewSettingsBackfillTools(t *testing.T) {
	dsn := fmt.Sprintf("file:%s/nav-view-settings.db?mode=memory&cache=shared", t.TempDir())
	db, err := NewSQLiteDBWithPoolSizes(dsn, 2, 1)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() { _ = db.Close() }()

	// The fixture mirrors board_configurations as the 20261001 migration
	// left it: view_settings present, JSON payloads, dual scoping.
	for _, statement := range []string{
		`CREATE TABLE schema_migrations (
			version TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE board_configurations (
			id INTEGER PRIMARY KEY,
			workspace_id INTEGER,
			collection_id INTEGER,
			view_settings TEXT
		)`,
		// Workspace override stored before tools were toggleable: views only.
		`INSERT INTO board_configurations (id, workspace_id, view_settings)
			VALUES (1, 10, '{"enabled_views":["board","list"]}')`,
		// Workspace override already naming a tools id: must stay untouched.
		`INSERT INTO board_configurations (id, workspace_id, view_settings)
			VALUES (2, 11, '{"enabled_views":["board","agents"]}')`,
		// Explicit reset: stays the reset state.
		`INSERT INTO board_configurations (id, workspace_id, view_settings)
			VALUES (3, 12, '{"enabled_views":null}')`,
		// Collection row: tools ids never apply there, so no backfill.
		`INSERT INTO board_configurations (id, collection_id, view_settings)
			VALUES (4, 30, '{"enabled_views":["board"]}')`,
		// Unreadable legacy payload: tolerated and left alone.
		`INSERT INTO board_configurations (id, workspace_id, view_settings)
			VALUES (5, 13, 'not json')`,
		// No settings at all: nothing to backfill.
		`INSERT INTO board_configurations (id, workspace_id, view_settings)
			VALUES (6, 14, NULL)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("legacy fixture: %v", err)
		}
	}

	var migration *Migration
	for i := range Catalog {
		if Catalog[i].Version == "20261002_view_settings_backfill_tools" {
			migration = &Catalog[i]
			break
		}
	}
	if migration == nil {
		t.Fatal("view settings tools backfill migration missing from catalog")
	}
	if err := applyMigration(db, driverSQLite, *migration); err != nil {
		t.Fatalf("apply migration: %v", err)
	}

	readViews := func(id int) string {
		t.Helper()
		var raw *string
		if err := db.QueryRow(`SELECT view_settings FROM board_configurations WHERE id = ?`, id).Scan(&raw); err != nil {
			t.Fatalf("read row %d: %v", id, err)
		}
		if raw == nil {
			return "<NULL>"
		}
		return *raw
	}

	// Views keep their order; the seven tools ids are appended.
	got := readViews(1)
	want := `{"enabled_views":["board","list","queue","agents","iterations","milestones","analytics","actions","pages"]}`
	if got != want {
		t.Fatalf("backfilled row 1 = %s, want %s", got, want)
	}

	// Everything else is untouched.
	if got := readViews(2); got != `{"enabled_views":["board","agents"]}` {
		t.Fatalf("row 2 already naming a tools id changed: %s", got)
	}
	if got := readViews(3); got != `{"enabled_views":null}` {
		t.Fatalf("reset row 3 changed: %s", got)
	}
	if got := readViews(4); got != `{"enabled_views":["board"]}` {
		t.Fatalf("collection row 4 changed: %s", got)
	}
	if got := readViews(5); got != "not json" {
		t.Fatalf("unreadable row 5 changed: %s", got)
	}
	if got := readViews(6); got != "<NULL>" {
		t.Fatalf("null row 6 changed: %s", got)
	}
}
