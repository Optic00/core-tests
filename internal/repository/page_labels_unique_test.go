package repository

import (
	"errors"
	"testing"

	"windshift/internal/testutils"
)

func newPageLabelUniqueRepository(t *testing.T) *PageLabelRepository {
	t.Helper()
	db := testutils.CreateTestDB(t, false)
	// PostgreSQL cleanup is already registered by CreateTestDB.
	if !testutils.IsPostgres() {
		t.Cleanup(func() { _ = db.Close() })
	}
	// Repository-only constraint tests intentionally bypass HTTP setup.
	if _, err := db.Exec(`INSERT INTO workspaces (id, name, key) VALUES (1, 'Labels', 'LBL')`); err != nil {
		t.Fatal(err)
	}
	return NewPageLabelRepository(db.Database)
}

func TestPageLabelRepository_Delete_RemovesAssignmentRows(t *testing.T) {
	repo := newPageLabelUniqueRepository(t)
	pageID := testutils.InsertID(t, repo.db, `INSERT INTO pages (workspace_id, title, slug, created_by) VALUES (1, 'Page', 'page', 1)`)
	labelID, _, err := repo.Create("design", "#3B82F6", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.db.Exec(`INSERT INTO page_label_assignments (page_id, page_label_id) VALUES (?, ?)`, pageID, labelID); err != nil {
		t.Fatal(err)
	}
	assertCount := func(want int) {
		t.Helper()
		var count int
		if err := repo.db.QueryRow(`SELECT COUNT(*) FROM page_label_assignments WHERE page_id = ? AND page_label_id = ?`, pageID, labelID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("assignment rows: got %d, want %d", count, want)
		}
	}
	assertCount(1)
	if err := repo.Delete(labelID); err != nil {
		t.Fatal(err)
	}
	assertCount(0)
}

func TestPageLabelRepository_Create_TranslatesUniqueViolation(t *testing.T) {
	repo := newPageLabelUniqueRepository(t)
	if _, _, err := repo.Create("design", "#3B82F6", 1); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.Create("design", "#3B82F6", 1); !errors.Is(err, ErrDuplicateEntry) {
		t.Fatalf("duplicate create: want ErrDuplicateEntry, got %v", err)
	}
}

func TestPageLabelRepository_Update_TranslatesUniqueViolation(t *testing.T) {
	repo := newPageLabelUniqueRepository(t)
	id, _, err := repo.Create("design", "#3B82F6", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.Create("eng", "#22C55E", 1); err != nil {
		t.Fatal(err)
	}
	if err := repo.Update(id, "eng", "#3B82F6"); !errors.Is(err, ErrDuplicateEntry) {
		t.Fatalf("duplicate rename: want ErrDuplicateEntry, got %v", err)
	}
}
