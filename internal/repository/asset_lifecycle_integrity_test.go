//go:build test

package repository

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"windshift/internal/database"

	"windshift/internal/testutils"
)

func assetLifecycleInsertID(t *testing.T, db interface {
	QueryRow(string, ...interface{}) *sql.Row
}, query string, args ...interface{}) int {
	t.Helper()
	var id int
	if err := db.QueryRow(query+" RETURNING id", args...).Scan(&id); err != nil {
		t.Fatalf("insert fixture: %v", err)
	}
	return id
}

func TestHardDeleteSetRemovesPolymorphicAssetLinksTransactionally(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()
	db := tdb.GetDatabase()
	repo := NewAssetRepository(db)

	setID := assetLifecycleInsertID(t, db, "INSERT INTO asset_management_sets (name) VALUES (?)", "Delete links set")
	otherSetID := assetLifecycleInsertID(t, db, "INSERT INTO asset_management_sets (name) VALUES (?)", "Keep links set")
	typeID := assetLifecycleInsertID(t, db, "INSERT INTO asset_types (set_id, name) VALUES (?, ?)", setID, "Server")
	otherTypeID := assetLifecycleInsertID(t, db, "INSERT INTO asset_types (set_id, name) VALUES (?, ?)", otherSetID, "Laptop")
	assetA := assetLifecycleInsertID(t, db, "INSERT INTO assets (set_id, asset_type_id, title) VALUES (?, ?, ?)", setID, typeID, "A")
	assetB := assetLifecycleInsertID(t, db, "INSERT INTO assets (set_id, asset_type_id, title) VALUES (?, ?, ?)", setID, typeID, "B")
	otherAsset := assetLifecycleInsertID(t, db, "INSERT INTO assets (set_id, asset_type_id, title) VALUES (?, ?, ?)", otherSetID, otherTypeID, "Other")
	linkTypeID := assetLifecycleInsertID(t, db,
		"INSERT INTO link_types (name, forward_label, reverse_label) VALUES (?, ?, ?)",
		"asset lifecycle", "links", "linked by")

	for _, link := range []struct {
		sourceType string
		sourceID   int
		targetType string
		targetID   int
	}{
		{"asset", assetA, "item", 1001},
		{"item", 1002, "asset", assetA},
		{"asset", assetA, "asset", assetB},
		{"asset", otherAsset, "item", 1003},
	} {
		if _, err := db.ExecWrite(`
			INSERT INTO item_links (link_type_id, source_type, source_id, target_type, target_id)
			VALUES (?, ?, ?, ?, ?)
		`, linkTypeID, link.sourceType, link.sourceID, link.targetType, link.targetID); err != nil {
			t.Fatalf("insert item link: %v", err)
		}
	}

	failedRepo := NewAssetRepository(assetDeleteFailureDB{Database: db})
	if err := failedRepo.HardDeleteSet(setID); !errors.Is(err, errAssetDeleteTestFailure) {
		t.Fatalf("failed deletion = %v", err)
	}
	for _, check := range []struct {
		query string
		want  int
	}{
		{"SELECT COUNT(*) FROM assets", 3},
		{"SELECT COUNT(*) FROM item_links", 4},
		{"SELECT COUNT(*) FROM asset_management_sets WHERE id = " + fmt.Sprint(setID), 1},
	} {
		var got int
		if err := db.QueryRow(check.query).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("after rollback %s = %d, want %d", check.query, got, check.want)
		}
	}
	if err := repo.HardDeleteSet(setID); err != nil {
		t.Fatalf("HardDeleteSet: %v", err)
	}

	var deletedLinks int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM item_links
		WHERE (source_type = 'asset' AND source_id IN (?, ?))
		   OR (target_type = 'asset' AND target_id IN (?, ?))
	`, assetA, assetB, assetA, assetB).Scan(&deletedLinks); err != nil {
		t.Fatalf("count deleted links: %v", err)
	}
	if deletedLinks != 0 {
		t.Fatalf("links for deleted set assets = %d, want 0", deletedLinks)
	}
	var retainedLinks int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM item_links WHERE source_type = 'asset' AND source_id = ?",
		otherAsset,
	).Scan(&retainedLinks); err != nil {
		t.Fatalf("count retained links: %v", err)
	}
	if retainedLinks != 1 {
		t.Fatalf("unrelated links = %d, want 1", retainedLinks)
	}
}

func TestReplaceAssetTypeFieldsPrunesRemovedValues(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()
	db := tdb.GetDatabase()
	repo := NewAssetRepository(db)

	setID := assetLifecycleInsertID(t, db, "INSERT INTO asset_management_sets (name) VALUES (?)", "Field lifecycle set")
	typeID := assetLifecycleInsertID(t, db, "INSERT INTO asset_types (set_id, name) VALUES (?, ?)", setID, "Server")
	removedID := assetLifecycleInsertID(t, db,
		"INSERT INTO custom_field_definitions (name, field_type) VALUES (?, ?)", "Serial Number", "text")
	retainedID := assetLifecycleInsertID(t, db,
		"INSERT INTO custom_field_definitions (name, field_type) VALUES (?, ?)", "Location", "text")
	if err := repo.ReplaceAssetTypeFields(typeID, []AssetTypeFieldAssignment{
		{CustomFieldID: removedID},
		{CustomFieldID: retainedID, DisplayOrder: 1},
	}); err != nil {
		t.Fatalf("initial ReplaceAssetTypeFields: %v", err)
	}
	raw := fmt.Sprintf(`{"%d":"SN-1","Serial Number":"SN-legacy","serial number":"SN-lower","%d":"ZRH"}`, removedID, retainedID)
	assetID := assetLifecycleInsertID(t, db,
		"INSERT INTO assets (set_id, asset_type_id, title, custom_field_values) VALUES (?, ?, ?, ?)",
		setID, typeID, "Server 1", raw)

	if err := repo.ReplaceAssetTypeFields(typeID, []AssetTypeFieldAssignment{
		{CustomFieldID: retainedID},
	}); err != nil {
		t.Fatalf("ReplaceAssetTypeFields: %v", err)
	}

	var stored string
	if err := db.QueryRow("SELECT custom_field_values FROM assets WHERE id = ?", assetID).Scan(&stored); err != nil {
		t.Fatalf("read pruned values: %v", err)
	}
	var values map[string]interface{}
	if err := json.Unmarshal([]byte(stored), &values); err != nil {
		t.Fatalf("decode pruned values: %v", err)
	}
	for _, key := range []string{fmt.Sprintf("%d", removedID), "Serial Number", "serial number"} {
		if _, ok := values[key]; ok {
			t.Fatalf("removed field key %q survived: %v", key, values)
		}
	}
	if values[fmt.Sprintf("%d", retainedID)] != "ZRH" {
		t.Fatalf("retained field value = %v, want ZRH", values)
	}
}

var errAssetDeleteTestFailure = errors.New("injected set deletion failure")

type assetDeleteFailureDB struct{ database.Database }

func (db assetDeleteFailureDB) Begin() (database.Tx, error) {
	tx, err := db.Database.Begin()
	if err != nil {
		return nil, err
	}
	return assetDeleteFailureTx{Tx: tx}, nil
}

type assetDeleteFailureTx struct{ database.Tx }

func (tx assetDeleteFailureTx) Exec(query string, args ...interface{}) (sql.Result, error) {
	if strings.HasPrefix(query, "DELETE FROM asset_management_sets") {
		return nil, errAssetDeleteTestFailure
	}
	return tx.Tx.Exec(query, args...)
}
