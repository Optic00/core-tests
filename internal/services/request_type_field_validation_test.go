package services

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"testing"

	"windshift/internal/database"
)

func newRequestFieldValidationDB(t *testing.T) (database.Database, int, int, int) {
	t.Helper()

	db, err := database.NewSQLiteDB(filepath.Join(t.TempDir(), "request-fields.db"))
	if err != nil {
		t.Fatalf("NewSQLiteDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Initialize(); err != nil {
		t.Fatalf("Initialize: %v", err)
	}

	var channelID, workspaceID, itemTypeID, selectFieldID, multiselectFieldID, requestTypeID int
	if err := db.QueryRow(`
		INSERT INTO channels (name, type, direction, status, config)
		VALUES ('form', 'form', 'inbound', 'enabled', '{}') RETURNING id
	`).Scan(&channelID); err != nil {
		t.Fatalf("insert channel: %v", err)
	}
	if err := db.QueryRow(`INSERT INTO workspaces (name, key) VALUES ('Requests', 'REQX') RETURNING id`).Scan(&workspaceID); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	if _, err := db.ExecWrite(`UPDATE channels SET config = ? WHERE id = ?`, fmt.Sprintf(`{"form_workspace_ids":[%d]}`, workspaceID), channelID); err != nil {
		t.Fatalf("configure channel workspace: %v", err)
	}
	if err := db.QueryRow(`INSERT INTO item_types (name) VALUES ('Request Field Test Type') RETURNING id`).Scan(&itemTypeID); err != nil {
		t.Fatalf("insert item type: %v", err)
	}
	if err := db.QueryRow(`
		INSERT INTO custom_field_definitions (name, field_type, options)
		VALUES ('request-field-select', 'select', '{"next_id":3,"items":[{"id":1,"label":"One"},{"id":2,"label":"Two"}]}')
		RETURNING id
	`).Scan(&selectFieldID); err != nil {
		t.Fatalf("insert select custom field: %v", err)
	}
	if err := db.QueryRow(`
		INSERT INTO custom_field_definitions (name, field_type, options)
		VALUES ('request-field-multiselect', 'multiselect', '{"next_id":3,"items":[{"id":1,"label":"One"},{"id":2,"label":"Two"}]}')
		RETURNING id
	`).Scan(&multiselectFieldID); err != nil {
		t.Fatalf("insert multiselect custom field: %v", err)
	}
	var configSetID, screenID int
	if err := db.QueryRow(`INSERT INTO configuration_sets (name) VALUES ('Request Field Test Config') RETURNING id`).Scan(&configSetID); err != nil {
		t.Fatalf("insert configuration set: %v", err)
	}
	if err := db.QueryRow(`INSERT INTO screens (name) VALUES ('Request Field Test Screen') RETURNING id`).Scan(&screenID); err != nil {
		t.Fatalf("insert screen: %v", err)
	}
	if _, err := db.ExecWrite(`INSERT INTO workspace_configuration_sets (workspace_id, configuration_set_id) VALUES (?, ?)`, workspaceID, configSetID); err != nil {
		t.Fatalf("bind workspace configuration: %v", err)
	}
	if _, err := db.ExecWrite(`INSERT INTO configuration_set_item_types (configuration_set_id, item_type_id, create_screen_id) VALUES (?, ?, ?)`, configSetID, itemTypeID, screenID); err != nil {
		t.Fatalf("bind item type screen: %v", err)
	}
	for _, fieldID := range []int{selectFieldID, multiselectFieldID} {
		if _, err := db.ExecWrite(`INSERT INTO screen_fields (screen_id, field_type, field_identifier) VALUES (?, 'custom', ?)`, screenID, strconv.Itoa(fieldID)); err != nil {
			t.Fatalf("insert screen field %d: %v", fieldID, err)
		}
	}
	if err := db.QueryRow(`
		INSERT INTO request_types (channel_id, name, item_type_id, workspace_id, is_active)
		VALUES (?, 'Request Field Validation', ?, ?, true) RETURNING id
	`, channelID, itemTypeID, workspaceID).Scan(&requestTypeID); err != nil {
		t.Fatalf("insert request type: %v", err)
	}
	for order, fieldID := range []int{selectFieldID, multiselectFieldID} {
		if _, err := db.ExecWrite(`
			INSERT INTO request_type_fields
				(request_type_id, field_identifier, field_type, is_required, display_order)
			VALUES (?, ?, 'custom', false, ?)
		`, requestTypeID, strconv.Itoa(fieldID), order+1); err != nil {
			t.Fatalf("insert request type field %d: %v", fieldID, err)
		}
	}

	return db, requestTypeID, selectFieldID, multiselectFieldID
}

func TestValidateAndSeparateRequestFieldsRejectsInvalidSelectOption(t *testing.T) {
	db, requestTypeID, selectFieldID, _ := newRequestFieldValidationDB(t)

	_, err := ValidateAndSeparateRequestFields(context.Background(), db, &requestTypeID, "Title", "", map[string]interface{}{
		strconv.Itoa(selectFieldID): float64(999),
	})
	if err == nil {
		t.Fatal("invalid select option unexpectedly passed public request-field validation")
	}
}

func TestValidateAndSeparateRequestFieldsOmitsBlankOptionalCustomFields(t *testing.T) {
	db, requestTypeID, selectFieldID, multiselectFieldID := newRequestFieldValidationDB(t)

	tests := []struct {
		name    string
		fieldID int
		value   any
	}{
		{name: "empty select", fieldID: selectFieldID, value: ""},
		{name: "whitespace select", fieldID: selectFieldID, value: "  \t"},
		{name: "empty multiselect string", fieldID: multiselectFieldID, value: ""},
		{name: "empty multiselect array", fieldID: multiselectFieldID, value: []any{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fieldID := strconv.Itoa(tt.fieldID)
			result, err := ValidateAndSeparateRequestFields(context.Background(), db, &requestTypeID, "Title", "", map[string]any{
				fieldID: tt.value,
			})
			if err != nil {
				t.Fatalf("ValidateAndSeparateRequestFields: %v", err)
			}
			if _, exists := result.CustomFieldValues[fieldID]; exists {
				t.Fatalf("blank optional field %s was retained: %#v", fieldID, result.CustomFieldValues[fieldID])
			}
		})
	}
}

// addRequestTypeDefaultDescriptionField configures the default description
// field on the fixture request type.
func addRequestTypeDefaultDescriptionField(t *testing.T, db database.Database, requestTypeID int, required bool) {
	t.Helper()
	if _, err := db.ExecWrite(`
		INSERT INTO request_type_fields
			(request_type_id, field_identifier, field_type, is_required, display_order)
		VALUES (?, 'description', 'default', ?, 0)
	`, requestTypeID, required); err != nil {
		t.Fatalf("insert default description field: %v", err)
	}
}

// The description reaching validation is sanitized with sanitize.Comment,
// which does not trim, so whitespace-only input must count as blank for the
// required check — same contract as title and custom/virtual fields.
func TestValidateAndSeparateRequestFieldsRejectsBlankRequiredDescription(t *testing.T) {
	db, requestTypeID, _, _ := newRequestFieldValidationDB(t)
	addRequestTypeDefaultDescriptionField(t, db, requestTypeID, true)

	tests := []struct {
		name        string
		description string
	}{
		{name: "empty", description: ""},
		{name: "spaces", description: "   "},
		{name: "tabs and newlines", description: " \t\n "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ValidateAndSeparateRequestFields(context.Background(), db, &requestTypeID, "Title", tt.description, nil)
			if err == nil {
				t.Fatalf("description %q unexpectedly satisfied the required description field", tt.description)
			}
			if err.Error() != "description is required" {
				t.Fatalf("error = %q, want %q", err.Error(), "description is required")
			}
		})
	}
}

func TestValidateAndSeparateRequestFieldsAcceptsDescriptionWithSurroundingWhitespace(t *testing.T) {
	db, requestTypeID, _, _ := newRequestFieldValidationDB(t)
	addRequestTypeDefaultDescriptionField(t, db, requestTypeID, true)

	// Content padded with whitespace is a real value; the required check must
	// not trim it away, and validation never rewrites the stored description.
	_, err := ValidateAndSeparateRequestFields(context.Background(), db, &requestTypeID, "Title", "  Printer on floor 3 is jammed  ", nil)
	if err != nil {
		t.Fatalf("ValidateAndSeparateRequestFields: %v", err)
	}
}

func TestValidateAndSeparateRequestFieldsAllowsWhitespaceOptionalDescription(t *testing.T) {
	db, requestTypeID, _, _ := newRequestFieldValidationDB(t)
	addRequestTypeDefaultDescriptionField(t, db, requestTypeID, false)

	if _, err := ValidateAndSeparateRequestFields(context.Background(), db, &requestTypeID, "Title", "   ", nil); err != nil {
		t.Fatalf("whitespace-only optional description was rejected: %v", err)
	}
}
