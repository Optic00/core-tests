//go:build test

package objecttranslation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"windshift/internal/database"
	"windshift/internal/testutils"
)

func TestNormalizeLocale(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "language", input: "de", want: "de"},
		{name: "region casing", input: "pt-br", want: "pt-BR"},
		{name: "script and region", input: "zh-hant-tw", want: "zh-Hant-TW"},
		{name: "empty", input: "", wantErr: true},
		{name: "underscore", input: "pt_BR", wantErr: true},
		{name: "undefined", input: "und", wantErr: true},
		{name: "malformed", input: "de-!", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeLocale(tt.input)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidLocale) {
					t.Fatalf("NormalizeLocale(%q) error = %v, want ErrInvalidLocale", tt.input, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeLocale(%q): %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("NormalizeLocale(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestObjectTranslationSchemaInitializationIsIdempotent(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	if err := tdb.Database.Initialize(); err != nil {
		t.Fatalf("repeat database initialization: %v", err)
	}
	if _, err := tdb.ExecWrite("DROP TABLE object_translations"); err != nil {
		t.Fatalf("remove translation table to simulate pre-migration database: %v", err)
	}
	if _, err := tdb.ExecWrite("DELETE FROM schema_migrations WHERE version = ?", "20260831_object_translations"); err != nil {
		t.Fatalf("remove translation migration stamp: %v", err)
	}
	if err := tdb.Database.Initialize(); err != nil {
		t.Fatalf("apply object translation migration: %v", err)
	}

	var tableCount int
	if database.IsPostgresDriver(tdb.Database.GetDriverName()) {
		if err := tdb.QueryRow(`
			SELECT COUNT(*) FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name = 'object_translations'
		`).Scan(&tableCount); err != nil {
			t.Fatalf("check PostgreSQL translation table: %v", err)
		}
	} else if err := tdb.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'object_translations'
	`).Scan(&tableCount); err != nil {
		t.Fatalf("check SQLite translation table: %v", err)
	}
	if tableCount != 1 {
		t.Fatalf("object translation table count = %d, want 1", tableCount)
	}
}

func TestResolveFallbackOrderAndCacheInvalidation(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	ctx := t.Context()

	var priorityID int
	if err := tdb.QueryRow("SELECT id FROM priorities WHERE builtin_key = 'medium'").Scan(&priorityID); err != nil {
		t.Fatalf("find medium priority: %v", err)
	}
	target := Target{ObjectType: "priority", ObjectID: priorityID, Field: FieldName, Fallback: "Medium"}

	assertResolvedValue(t, service, "de-CH", target, "Medium", "canonical", "")
	if err := service.SyncSystem(ctx, []SystemTranslation{
		{ObjectType: "priority", BuiltinKey: "medium", Field: FieldName, Locale: "de", Value: "System Mittel"},
		{ObjectType: "priority", BuiltinKey: "medium", Field: FieldName, Locale: "de-CH", Value: "System Schweizer Mittel"},
	}); err != nil {
		t.Fatalf("sync system translations: %v", err)
	}
	assertResolvedValue(t, service, "de-CH", target, "System Schweizer Mittel", SourceSystem, "de-CH")

	if _, err := service.UpsertInstance(ctx, "priority", priorityID, FieldName, "de", "Instanz Mittel"); err != nil {
		t.Fatalf("upsert parent instance translation: %v", err)
	}
	assertResolvedValue(t, service, "de-CH", target, "Instanz Mittel", SourceInstance, "de")

	if _, err := service.UpsertInstance(ctx, "priority", priorityID, FieldName, "de-ch", "Instanz Schweizer Mittel"); err != nil {
		t.Fatalf("upsert exact instance translation: %v", err)
	}
	assertResolvedValue(t, service, "de-CH", target, "Instanz Schweizer Mittel", SourceInstance, "de-CH")

	if err := service.DeleteInstance(ctx, "priority", priorityID, FieldName, "de-CH"); err != nil {
		t.Fatalf("delete exact instance translation: %v", err)
	}
	if err := service.DeleteInstance(ctx, "priority", priorityID, FieldName, "de"); err != nil {
		t.Fatalf("delete parent instance translation: %v", err)
	}
	assertResolvedValue(t, service, "de-AT", target, "System Mittel", SourceSystem, "de")
}

func TestShippedSystemTranslationsSyncWithoutOverwritingInstanceRows(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	ctx := t.Context()

	translations := ShippedSystemTranslations()
	if len(translations) < 400 {
		t.Fatalf("shipped translation count = %d, want complete multilingual catalog", len(translations))
	}
	if err := service.SyncSystem(ctx, translations); err != nil {
		t.Fatalf("sync shipped translations: %v", err)
	}

	var priorityID int
	if err := tdb.QueryRow("SELECT id FROM priorities WHERE builtin_key = 'medium'").Scan(&priorityID); err != nil {
		t.Fatalf("find medium priority: %v", err)
	}
	assertResolvedValue(t, service, "de-CH", Target{
		ObjectType: "priority", ObjectID: priorityID, Field: FieldName, Fallback: "Medium",
	}, "Mittel", SourceSystem, "de")

	if _, err := service.UpsertInstance(ctx, "priority", priorityID, FieldName, "de", "Eigene Priorität"); err != nil {
		t.Fatalf("upsert instance translation: %v", err)
	}
	if err := service.SyncSystem(ctx, translations); err != nil {
		t.Fatalf("resync shipped translations: %v", err)
	}
	assertResolvedValue(t, service, "de-CH", Target{
		ObjectType: "priority", ObjectID: priorityID, Field: FieldName, Fallback: "Medium",
	}, "Eigene Priorität", SourceInstance, "de")
}

func TestCanonicalDifferencesReportValuesWithUnknownSourceLocale(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	baseline, err := service.FindCanonicalDifferences(t.Context(), ShippedSystemTranslations())
	if err != nil {
		t.Fatalf("find baseline canonical differences: %v", err)
	}
	if _, err := tdb.ExecWrite("UPDATE priorities SET name = ? WHERE builtin_key = 'medium'", "Locally renamed priority"); err != nil {
		t.Fatalf("rename built-in priority: %v", err)
	}

	differences, err := service.FindCanonicalDifferences(t.Context(), ShippedSystemTranslations())
	if err != nil {
		t.Fatalf("find canonical differences: %v", err)
	}
	if len(differences) != len(baseline)+1 {
		t.Fatalf("canonical difference count = %d, want baseline %d plus renamed priority", len(differences), len(baseline))
	}
	for _, difference := range differences {
		if difference.ObjectType == "priority" && difference.BuiltinKey == "medium" && difference.Field == FieldName {
			if difference.Canonical != "Locally renamed priority" || difference.System != "Medium" {
				t.Fatalf("priority difference = %#v", difference)
			}
			return
		}
	}
	t.Fatal("renamed built-in priority missing from canonical difference report")
}

func TestLocalizeResponseUsesRequestLocaleAndPreservesCanonicalFields(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	if err := service.SyncSystem(t.Context(), ShippedSystemTranslations()); err != nil {
		t.Fatalf("sync shipped translations: %v", err)
	}

	var response struct {
		ID                 int
		Name               string
		DisplayName        string
		Description        string
		DisplayDescription string
	}
	if err := tdb.QueryRow(`
		SELECT id, name, description FROM status_categories WHERE builtin_key = 'in_progress'
	`).Scan(&response.ID, &response.Name, &response.Description); err != nil {
		t.Fatalf("load status category: %v", err)
	}

	request := httptest.NewRequest("GET", "/status-categories", nil)
	request.Header.Set("Accept-Language", "de-CH,de;q=0.9,en;q=0.8")
	if locale := RequestLocale(request); locale != "de-CH" {
		t.Fatalf("request locale = %q, want de-CH", locale)
	}
	if err := service.LocalizeResponse(t.Context(), RequestLocale(request), "status_category", &response); err != nil {
		t.Fatalf("localize response: %v", err)
	}
	if response.Name != "In Progress" || response.DisplayName != "In Bearbeitung" {
		t.Fatalf("localized names = canonical %q display %q", response.Name, response.DisplayName)
	}
	if response.Description != "Work that is actively being done" || response.DisplayDescription != "Arbeit, die aktiv ausgeführt wird" {
		t.Fatalf("localized descriptions = canonical %q display %q", response.Description, response.DisplayDescription)
	}
}

func TestCustomObjectTranslationAndOwnerDeletion(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	ctx := t.Context()
	priorityID := testutils.InsertID(t, tdb.Database, `
		INSERT INTO priorities (name, description, icon, color, sort_order, is_default)
		VALUES (?, ?, ?, ?, ?, false)
	`, "Customer Escalation", "Custom priority", "AlertCircle", "#123456", 90)

	translation, err := service.UpsertInstance(ctx, "priority", priorityID, FieldName, "pt-br", "Escalação do cliente")
	if err != nil {
		t.Fatalf("upsert custom priority translation: %v", err)
	}
	if translation.Locale != "pt-BR" || translation.Source != SourceInstance {
		t.Fatalf("translation = %#v, want normalized instance translation", translation)
	}
	assertResolvedValue(t, service, "pt-BR", Target{
		ObjectType: "priority", ObjectID: priorityID, Field: FieldName, Fallback: "Customer Escalation",
	}, "Escalação do cliente", SourceInstance, "pt-BR")

	if _, err := tdb.ExecWrite("DELETE FROM priorities WHERE id = ?", priorityID); err != nil {
		t.Fatalf("delete custom priority: %v", err)
	}
	var translationCount int
	if err := tdb.QueryRow("SELECT COUNT(*) FROM object_translations WHERE object_type = 'priority' AND object_id = ?", priorityID).Scan(&translationCount); err != nil {
		t.Fatalf("count deleted owner translations: %v", err)
	}
	if translationCount != 0 {
		t.Fatalf("translation count after owner deletion = %d, want 0", translationCount)
	}
}

func TestTranslationWriteValidationAndOrphanDetection(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	ctx := t.Context()

	if _, err := service.UpsertInstance(ctx, "unknown", 1, FieldName, "de", "Wert"); !errors.Is(err, ErrUnsupportedObjectType) {
		t.Fatalf("unknown object type error = %v, want ErrUnsupportedObjectType", err)
	}
	if _, err := service.UpsertInstance(ctx, "priority", 1, "color", "de", "Rot"); !errors.Is(err, ErrUnsupportedField) {
		t.Fatalf("unknown field error = %v, want ErrUnsupportedField", err)
	}
	if _, err := service.UpsertInstance(ctx, "priority", 999999, FieldName, "de", "Fehlt"); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("missing owner error = %v, want ErrObjectNotFound", err)
	}

	if _, err := tdb.ExecWrite(`
		INSERT INTO object_translations (object_type, object_id, field, locale, source, value)
		VALUES ('priority', 999999, 'name', 'de', 'instance', 'Verwaist')
	`); err != nil {
		t.Fatalf("insert corruption fixture: %v", err)
	}
	orphans, err := service.FindOrphans(ctx)
	if err != nil {
		t.Fatalf("find orphans: %v", err)
	}
	if len(orphans) != 1 || orphans[0].ObjectType != "priority" || orphans[0].ObjectID != 999999 {
		t.Fatalf("orphans = %#v, want priority 999999", orphans)
	}
}

func TestUpsertInstanceSanitizesTranslationValues(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	var priorityID int
	if err := tdb.QueryRow("SELECT id FROM priorities WHERE builtin_key = 'medium'").Scan(&priorityID); err != nil {
		t.Fatalf("find medium priority: %v", err)
	}

	tests := []struct {
		name        string
		field       string
		value       string
		wantContent string
	}{
		{name: "plain name", field: FieldName, value: `<b>Bold</b><script>bad()</script>`, wantContent: "Bold"},
		{name: "rich description", field: FieldDescription, value: `<p>Safe</p><script>bad()</script>`, wantContent: "Safe"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			translation, err := service.UpsertInstance(t.Context(), "priority", priorityID, tt.field, "de", tt.value)
			if err != nil {
				t.Fatalf("upsert translation: %v", err)
			}
			if strings.Contains(translation.Value, "script") || strings.Contains(translation.Value, "bad()") {
				t.Fatalf("sanitized value = %q, want script removed", translation.Value)
			}
			if !strings.Contains(translation.Value, tt.wantContent) {
				t.Fatalf("sanitized value = %q, want content %q", translation.Value, tt.wantContent)
			}
		})
	}
}

func TestResolveBoundedLimitsOnlyAdministratorBulkRequests(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	service := NewService(tdb.Database)
	var priorityID int
	if err := tdb.QueryRow("SELECT id FROM priorities WHERE builtin_key = 'medium'").Scan(&priorityID); err != nil {
		t.Fatalf("find medium priority: %v", err)
	}
	target := Target{ObjectType: "priority", ObjectID: priorityID, Field: FieldName, Fallback: "Medium"}
	targets := make([]Target, MaxResolveTargets+1)
	for i := range targets {
		targets[i] = target
	}

	if _, err := service.ResolveBounded(t.Context(), "de", targets); !errors.Is(err, ErrTooManyTargets) {
		t.Fatalf("ResolveBounded error = %v, want ErrTooManyTargets", err)
	}
	resolved, err := service.Resolve(t.Context(), "de", targets)
	if err != nil {
		t.Fatalf("internal Resolve: %v", err)
	}
	if len(resolved) != len(targets) {
		t.Fatalf("internal Resolve returned %d values, want %d", len(resolved), len(targets))
	}
}

func TestResolveQueryCountDoesNotGrowWithRows(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	targets := make([]Target, 0, 40)
	for i := range 40 {
		name := fmt.Sprintf("Query Count Priority %02d", i)
		id := testutils.InsertID(t, tdb.Database, `
			INSERT INTO priorities (name, description, icon, color, sort_order, is_default)
			VALUES (?, '', 'AlertCircle', '#123456', ?, false)
		`, name, 100+i)
		if _, err := tdb.ExecWrite(`
			INSERT INTO object_translations (object_type, object_id, field, locale, source, value)
			VALUES ('priority', ?, 'name', 'de', 'instance', ?)
		`, id, "DE "+name); err != nil {
			t.Fatalf("insert translation %d: %v", i, err)
		}
		targets = append(targets, Target{ObjectType: "priority", ObjectID: id, Field: FieldName, Fallback: name})
	}

	counted := &queryCountingDB{Database: tdb.Database}
	service := NewService(counted)
	resolved, err := service.Resolve(t.Context(), "de", targets)
	if err != nil {
		t.Fatalf("resolve translations: %v", err)
	}
	if len(resolved) != len(targets) {
		t.Fatalf("resolved %d values, want %d", len(resolved), len(targets))
	}
	if counted.queryCount != 1 {
		t.Fatalf("translation query count = %d, want 1 for %d rows", counted.queryCount, len(targets))
	}
}

func TestRequestLoaderDeduplicatesTargetsAcrossCalls(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	counted := &queryCountingDB{Database: tdb.Database}
	service := NewService(counted)
	loader, err := NewLoader(t.Context(), service, "de-CH")
	if err != nil {
		t.Fatalf("create loader: %v", err)
	}

	var priorityID int
	if err := tdb.QueryRow("SELECT id FROM priorities WHERE builtin_key = 'medium'").Scan(&priorityID); err != nil {
		t.Fatalf("find medium priority: %v", err)
	}
	target := Target{ObjectType: "priority", ObjectID: priorityID, Field: FieldName, Fallback: "Medium"}

	first, err := loader.Resolve([]Target{target, target})
	if err != nil {
		t.Fatalf("first loader resolve: %v", err)
	}
	second, err := loader.Resolve([]Target{target})
	if err != nil {
		t.Fatalf("second loader resolve: %v", err)
	}
	if len(first) != 2 || len(second) != 1 || first[0] != first[1] || first[0] != second[0] {
		t.Fatalf("loader results = first %#v second %#v, want repeated identical values", first, second)
	}
	if counted.queryCount != 1 {
		t.Fatalf("translation query count = %d, want 1 across repeated loader calls", counted.queryCount)
	}
}

func assertResolvedValue(t *testing.T, service *Service, locale string, target Target, wantValue, wantSource, wantLocale string) {
	t.Helper()
	values, err := service.Resolve(t.Context(), locale, []Target{target})
	if err != nil {
		t.Fatalf("resolve %s: %v", locale, err)
	}
	if len(values) != 1 {
		t.Fatalf("resolved value count = %d, want 1", len(values))
	}
	got := values[0]
	if got.Value != wantValue || got.Source != wantSource || got.Locale != wantLocale {
		t.Fatalf("resolved = %#v, want value=%q source=%q locale=%q", got, wantValue, wantSource, wantLocale)
	}
}

type queryCountingDB struct {
	database.Database
	queryCount int
}

func (db *queryCountingDB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	db.queryCount++
	return db.Database.QueryContext(ctx, query, args...)
}
