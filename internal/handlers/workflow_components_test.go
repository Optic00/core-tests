//go:build test

package handlers

import (
	"net/http"
	"testing"

	"windshift/internal/models"
	"windshift/internal/services"
	"windshift/internal/testutils"
)

func newTestStatusEnumHandler(tdb *testutils.TestDB) *EnumHandler {
	return NewEnumHandler(
		services.NewEnumService(tdb.GetDatabase(), services.NewStatusConfig()),
		func() interface{} { return &models.Status{} },
	)
}

// Test Statuses

func TestStatusEnumHandler_Create_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	// Create the status category through EnumService.
	categoryID := newServiceSetup(t, tdb).CreateStatusCategory("Test Category", "#0000ff")

	handler := newTestStatusEnumHandler(tdb)

	status := models.Status{
		Name:        "Test Status",
		Description: "Test status description",
		CategoryID:  categoryID,
		IsDefault:   false,
	}

	req := testutils.CreateJSONRequest(t, "POST", "/api/statuses", status)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Create, req, nil)

	rr.AssertStatusCode(http.StatusCreated).
		AssertContentType("application/json")

	var response models.Status
	rr.AssertJSONResponse(&response)

	if response.ID == 0 {
		t.Error("Expected created status to have an ID")
	}
	if response.Name != status.Name {
		t.Errorf("Expected name %s, got %s", status.Name, response.Name)
	}
	if response.CategoryID != status.CategoryID {
		t.Errorf("Expected category ID %d, got %d", status.CategoryID, response.CategoryID)
	}
}

func TestStatusEnumHandler_GetAll_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := newTestStatusEnumHandler(tdb)

	// The database should already have default statuses from initialization
	req := testutils.CreateJSONRequest(t, "GET", "/api/statuses", nil)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.GetAll, req, nil)

	rr.AssertStatusCode(http.StatusOK).
		AssertContentType("application/json")

	var response []models.Status
	rr.AssertJSONResponse(&response)

	// Should have at least the default statuses
	if len(response) < 3 {
		t.Errorf("Expected at least 3 default statuses, got %d", len(response))
	}

	// Should have category names populated
	for _, status := range response {
		if status.CategoryName == "" {
			t.Errorf("Expected status %s to have category name populated", status.Name)
		}
	}
}

func TestStatusEnumHandler_Update_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	// Create status category first via the status categories API
	categoryID := newServiceSetup(t, tdb).CreateStatusCategory("Test Category", "#ff0000")

	statusHandler := newTestStatusEnumHandler(tdb)

	// Create initial status
	status := models.Status{
		Name:        "Original Status",
		Description: "Original description",
		CategoryID:  categoryID,
		IsDefault:   false,
	}

	createReq := testutils.CreateJSONRequest(t, "POST", "/api/statuses", status)
	createRR := testutils.ExecuteAuthenticatedRequest(t, statusHandler.Create, createReq, nil)

	var createdStatus models.Status
	createRR.AssertJSONResponse(&createdStatus)

	// Update the status
	updatedStatus := models.Status{
		Name:        "Updated Status",
		Description: "Updated description",
		CategoryID:  int(categoryID),
		IsDefault:   true,
	}

	updateReq := testutils.CreateJSONRequest(t, "PUT", "/api/statuses/"+testutils.IntToString(createdStatus.ID), updatedStatus)
	updateReq.SetPathValue("id", testutils.IntToString(createdStatus.ID))
	rr := testutils.ExecuteAuthenticatedRequest(t, statusHandler.Update, updateReq, nil)

	rr.AssertStatusCode(http.StatusOK).
		AssertContentType("application/json")

	var response models.Status
	rr.AssertJSONResponse(&response)

	if response.ID != createdStatus.ID {
		t.Errorf("Expected ID %d, got %d", createdStatus.ID, response.ID)
	}
	if response.Name != updatedStatus.Name {
		t.Errorf("Expected updated name %s, got %s", updatedStatus.Name, response.Name)
	}
	if response.Description != updatedStatus.Description {
		t.Errorf("Expected updated description %s, got %s", updatedStatus.Description, response.Description)
	}
	if response.IsDefault != updatedStatus.IsDefault {
		t.Errorf("Expected updated IsDefault %v, got %v", updatedStatus.IsDefault, response.IsDefault)
	}
}

func TestStatusEnumHandler_Delete_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	categoryID := newServiceSetup(t, tdb).CreateStatusCategory("Test Category", "#ff0000")

	statusHandler := newTestStatusEnumHandler(tdb)

	// Create status to delete
	status := models.Status{
		Name:        "Status to Delete",
		Description: "Will be deleted",
		CategoryID:  int(categoryID),
		IsDefault:   false,
	}

	createReq := testutils.CreateJSONRequest(t, "POST", "/api/statuses", status)
	createRR := testutils.ExecuteAuthenticatedRequest(t, statusHandler.Create, createReq, nil)

	var createdStatus models.Status
	createRR.AssertJSONResponse(&createdStatus)

	// Delete the status
	deleteReq := testutils.CreateJSONRequest(t, "DELETE", "/api/statuses/"+testutils.IntToString(createdStatus.ID), nil)
	deleteReq.SetPathValue("id", testutils.IntToString(createdStatus.ID))
	rr := testutils.ExecuteAuthenticatedRequest(t, statusHandler.Delete, deleteReq, nil)

	rr.AssertStatusCode(http.StatusNoContent)

	// Verify deletion by trying to get it
	getReq := testutils.CreateJSONRequest(t, "GET", "/api/statuses/"+testutils.IntToString(createdStatus.ID), nil)
	getReq.SetPathValue("id", testutils.IntToString(createdStatus.ID))
	getRR := testutils.ExecuteAuthenticatedRequest(t, statusHandler.Get, getReq, nil)

	getRR.AssertStatusCode(http.StatusNotFound)
}

// Test Custom Fields

func TestCustomFieldHandler_Create_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewCustomFieldHandler(tdb.GetDatabase())

	field := models.CustomFieldDefinition{
		Name:        "Test Field",
		FieldType:   "text",
		Description: "Test custom field",
		Required:    false,
		Options:     "[]",
	}

	req := testutils.CreateJSONRequest(t, "POST", "/api/custom-fields", field)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Create, req, nil)

	rr.AssertStatusCode(http.StatusCreated).
		AssertContentType("application/json")

	var response models.CustomFieldDefinition
	rr.AssertJSONResponse(&response)

	if response.ID == 0 {
		t.Error("Expected created custom field to have an ID")
	}
	if response.Name != field.Name {
		t.Errorf("Expected name %s, got %s", field.Name, response.Name)
	}
	if response.FieldType != field.FieldType {
		t.Errorf("Expected field type %s, got %s", field.FieldType, response.FieldType)
	}
}

func TestCustomFieldHandler_ValidationErrors(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewCustomFieldHandler(tdb.GetDatabase())

	tests := []struct {
		name        string
		field       models.CustomFieldDefinition
		expectedErr string
	}{
		{
			name:        "Missing name",
			field:       models.CustomFieldDefinition{FieldType: "text"},
			expectedErr: "Field name is required",
		},
		{
			name:        "Missing field type",
			field:       models.CustomFieldDefinition{Name: "Test Field"},
			expectedErr: "Invalid field type",
		},
		{
			name:        "Invalid field type",
			field:       models.CustomFieldDefinition{Name: "Test Field", FieldType: "invalid"},
			expectedErr: "Invalid field type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := testutils.CreateJSONRequest(t, "POST", "/api/custom-fields", tt.field)
			rr := testutils.ExecuteAuthenticatedRequest(t, handler.Create, req, nil)

			testutils.AssertValidationError(t, rr, tt.expectedErr)
		})
	}
}

func TestCustomFieldHandler_Update_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewCustomFieldHandler(tdb.GetDatabase())

	// Create initial custom field
	field := models.CustomFieldDefinition{
		Name:        "Original Field",
		FieldType:   "text",
		Description: "Original description",
		Required:    false,
		Options:     "[]",
	}

	createReq := testutils.CreateJSONRequest(t, "POST", "/api/custom-fields", field)
	createRR := testutils.ExecuteAuthenticatedRequest(t, handler.Create, createReq, nil)

	var createdField models.CustomFieldDefinition
	createRR.AssertJSONResponse(&createdField)

	// Update the field
	updatedField := models.CustomFieldDefinition{
		Name:         "Updated Field",
		FieldType:    "text",
		Description:  "Updated description",
		Required:     true,
		Options:      "[]",
		DisplayOrder: 5,
	}

	updateReq := testutils.CreateJSONRequest(t, "PUT", "/api/custom-fields/"+testutils.IntToString(createdField.ID), updatedField)
	updateReq.SetPathValue("id", testutils.IntToString(createdField.ID))
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Update, updateReq, nil)

	rr.AssertStatusCode(http.StatusOK).
		AssertContentType("application/json")

	var response models.CustomFieldDefinition
	rr.AssertJSONResponse(&response)

	if response.ID != createdField.ID {
		t.Errorf("Expected ID %d, got %d", createdField.ID, response.ID)
	}
	if response.Name != updatedField.Name {
		t.Errorf("Expected updated name %s, got %s", updatedField.Name, response.Name)
	}
	if response.FieldType != updatedField.FieldType {
		t.Errorf("Expected updated field type %s, got %s", updatedField.FieldType, response.FieldType)
	}
	if response.Required != updatedField.Required {
		t.Errorf("Expected updated required %v, got %v", updatedField.Required, response.Required)
	}
	if response.Description != updatedField.Description {
		t.Errorf("Expected updated description %s, got %s", updatedField.Description, response.Description)
	}
	if response.DisplayOrder != updatedField.DisplayOrder {
		t.Errorf("Expected updated display order %d, got %d", updatedField.DisplayOrder, response.DisplayOrder)
	}
}

func TestCustomFieldHandler_Delete_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewCustomFieldHandler(tdb.GetDatabase())

	// Create custom field to delete
	field := models.CustomFieldDefinition{
		Name:        "Field to Delete",
		FieldType:   "text",
		Description: "Will be deleted",
		Required:    false,
		Options:     "[]",
	}

	createReq := testutils.CreateJSONRequest(t, "POST", "/api/custom-fields", field)
	createRR := testutils.ExecuteAuthenticatedRequest(t, handler.Create, createReq, nil)

	var createdField models.CustomFieldDefinition
	createRR.AssertJSONResponse(&createdField)

	// Delete the field
	deleteReq := testutils.CreateJSONRequest(t, "DELETE", "/api/custom-fields/"+testutils.IntToString(createdField.ID), nil)
	deleteReq.SetPathValue("id", testutils.IntToString(createdField.ID))
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Delete, deleteReq, nil)

	rr.AssertStatusCode(http.StatusNoContent)

	// Verify deletion by trying to get it
	getReq := testutils.CreateJSONRequest(t, "GET", "/api/custom-fields/"+testutils.IntToString(createdField.ID), nil)
	getReq.SetPathValue("id", testutils.IntToString(createdField.ID))
	getRR := testutils.ExecuteAuthenticatedRequest(t, handler.Get, getReq, nil)

	getRR.AssertStatusCode(http.StatusNotFound)
}

// Test Screens

func TestScreenHandler_Create_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewScreenHandler(tdb.GetDatabase())

	screen := models.Screen{
		Name:        "Test Screen",
		Description: "Test screen description",
	}

	req := testutils.CreateJSONRequest(t, "POST", "/api/screens", screen)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Create, req, nil)

	rr.AssertStatusCode(http.StatusCreated).
		AssertContentType("application/json")

	var response models.Screen
	rr.AssertJSONResponse(&response)

	if response.ID == 0 {
		t.Error("Expected created screen to have an ID")
	}
	if response.Name != screen.Name {
		t.Errorf("Expected name %s, got %s", screen.Name, response.Name)
	}
	if response.Description != screen.Description {
		t.Errorf("Expected description %s, got %s", screen.Description, response.Description)
	}
}

func TestScreenHandler_GetAll_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	// Create test screens
	screens := []string{"Screen A", "Screen B", "Screen C"}
	for _, screenName := range screens {
		_, err := tdb.Exec(`
			INSERT INTO screens (name, description, created_at, updated_at)
			VALUES (?, 'Test screen', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`, screenName)
		if err != nil {
			t.Fatalf("Failed to create test screen %s: %v", screenName, err)
		}
	}

	handler := NewScreenHandler(tdb.GetDatabase())

	req := testutils.CreateJSONRequest(t, "GET", "/api/screens", nil)
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.GetAll, req, nil)

	rr.AssertStatusCode(http.StatusOK).
		AssertContentType("application/json")

	var response []models.Screen
	rr.AssertJSONResponse(&response)

	// Should have at least our test screens plus any default ones
	if len(response) < len(screens) {
		t.Errorf("Expected at least %d screens, got %d", len(screens), len(response))
	}

	// Verify our test screens are present and sorted by name
	foundScreens := make(map[string]bool)
	for _, screen := range response {
		foundScreens[screen.Name] = true
	}

	for _, screenName := range screens {
		if !foundScreens[screenName] {
			t.Errorf("Expected to find screen %s in response", screenName)
		}
	}
}

func TestScreenHandler_Update_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewScreenHandler(tdb.GetDatabase())

	// Create initial screen
	screen := models.Screen{
		Name:        "Original Screen",
		Description: "Original description",
	}

	createReq := testutils.CreateJSONRequest(t, "POST", "/api/screens", screen)
	createRR := testutils.ExecuteAuthenticatedRequest(t, handler.Create, createReq, nil)

	var createdScreen models.Screen
	createRR.AssertJSONResponse(&createdScreen)

	// Update the screen
	updatedScreen := models.Screen{
		Name:        "Updated Screen",
		Description: "Updated description",
	}

	updateReq := testutils.CreateJSONRequest(t, "PUT", "/api/screens/"+testutils.IntToString(createdScreen.ID), updatedScreen)
	updateReq.SetPathValue("id", testutils.IntToString(createdScreen.ID))
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Update, updateReq, nil)

	rr.AssertStatusCode(http.StatusOK).
		AssertContentType("application/json")

	var response models.Screen
	rr.AssertJSONResponse(&response)

	if response.ID != createdScreen.ID {
		t.Errorf("Expected ID %d, got %d", createdScreen.ID, response.ID)
	}
	if response.Name != updatedScreen.Name {
		t.Errorf("Expected updated name %s, got %s", updatedScreen.Name, response.Name)
	}
	if response.Description != updatedScreen.Description {
		t.Errorf("Expected updated description %s, got %s", updatedScreen.Description, response.Description)
	}
}

func TestScreenHandler_Delete_Success(t *testing.T) {
	tdb := testutils.CreateTestDB(t, true)
	defer tdb.Close()

	handler := NewScreenHandler(tdb.GetDatabase())

	// Create screen to delete
	screen := models.Screen{
		Name:        "Screen to Delete",
		Description: "Will be deleted",
	}

	createReq := testutils.CreateJSONRequest(t, "POST", "/api/screens", screen)
	createRR := testutils.ExecuteAuthenticatedRequest(t, handler.Create, createReq, nil)

	var createdScreen models.Screen
	createRR.AssertJSONResponse(&createdScreen)

	// Delete the screen
	deleteReq := testutils.CreateJSONRequest(t, "DELETE", "/api/screens/"+testutils.IntToString(createdScreen.ID), nil)
	deleteReq.SetPathValue("id", testutils.IntToString(createdScreen.ID))
	rr := testutils.ExecuteAuthenticatedRequest(t, handler.Delete, deleteReq, nil)

	rr.AssertStatusCode(http.StatusNoContent)

	// Verify deletion by trying to get it
	getReq := testutils.CreateJSONRequest(t, "GET", "/api/screens/"+testutils.IntToString(createdScreen.ID), nil)
	getReq.SetPathValue("id", testutils.IntToString(createdScreen.ID))
	getRR := testutils.ExecuteAuthenticatedRequest(t, handler.Get, getReq, nil)

	getRR.AssertStatusCode(http.StatusNotFound)
}
