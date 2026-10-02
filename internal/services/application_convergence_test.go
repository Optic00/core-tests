//go:build test

package services

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"windshift/internal/agentskills"
	"windshift/internal/constants"
	"windshift/internal/models"
	"windshift/internal/repository"
	"windshift/internal/testutils"
)

func convergenceFixture(t *testing.T, systemAdmin bool) (*testutils.TestDB, *PermissionService, testutils.TestDataSet) {
	t.Helper()
	tdb := testutils.CreateTestDB(t, true)
	t.Cleanup(func() { tdb.Close() })
	seed := tdb.SeedTestData(t)
	if systemAdmin {
		repo := repository.NewPermissionRepository(tdb.GetDatabase())
		all, err := repo.ListAll()
		if err != nil {
			t.Fatalf("list permissions: %v", err)
		}
		for _, permission := range all {
			if permission.PermissionKey == models.PermissionSystemAdmin {
				if err := repo.GrantGlobalToUser(seed.UserID, permission.ID, seed.UserID); err != nil {
					t.Fatalf("grant system admin: %v", err)
				}
				break
			}
		}
	}
	permissions, err := NewPermissionService(tdb.GetDatabase(), DefaultPermissionCacheConfig())
	if err != nil {
		t.Fatalf("NewPermissionService: %v", err)
	}
	return tdb, permissions, seed
}

func TestCatalogMutationApplicationOwnsCatalogWrites(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	db := tdb.GetDatabase()
	service := NewCatalogMutationService(db, permissions, NewWorkflowService(db))
	actor := AuditActor{UserID: seed.UserID}

	linkType, err := service.CreateLinkType(actor, models.LinkType{
		Name: "Depends on", ForwardLabel: "depends on", ReverseLabel: "is required by",
	})
	if err != nil {
		t.Fatalf("CreateLinkType: %v", err)
	}
	if linkType.Color != "#6b7280" || !linkType.Active {
		t.Fatalf("created link type = %+v, want default color and active state", linkType)
	}
	inactive := false
	if _, err := service.PatchLinkType(actor, linkType.ID, LinkTypePatch{Active: &inactive}); err != nil {
		t.Fatalf("PatchLinkType: %v", err)
	}
	activeOnly, err := service.ListLinkTypes(false)
	if err != nil {
		t.Fatalf("ListLinkTypes(false): %v", err)
	}
	if slices.ContainsFunc(activeOnly, func(item models.LinkType) bool { return item.ID == linkType.ID }) {
		t.Fatal("inactive link type appeared in the active-only list")
	}
	withInactive, err := service.ListLinkTypes(true)
	if err != nil {
		t.Fatalf("ListLinkTypes(true): %v", err)
	}
	if !slices.ContainsFunc(withInactive, func(item models.LinkType) bool { return item.ID == linkType.ID }) {
		t.Fatal("inactive link type was omitted when include_inactive is true")
	}

	itemType, err := repository.NewItemTypeRepository(db).GetByID(1)
	if err != nil {
		t.Fatalf("load item type: %v", err)
	}
	description := "Updated without changing defaults"
	updated, err := service.PatchItemType(actor, itemType.ID, ItemTypePatch{Description: &description})
	if err != nil {
		t.Fatalf("PatchItemType: %v", err)
	}
	if updated.IsDefault != itemType.IsDefault {
		t.Fatalf("is_default = %v, want preserved %v", updated.IsDefault, itemType.IsDefault)
	}

	workflow, err := service.CreateWorkflow(actor, models.Workflow{Name: "Converged workflow", Description: "Initial"})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	name := "Renamed workflow"
	workflow, err = service.PatchWorkflow(actor, workflow.ID, WorkflowPatch{Name: &name})
	if err != nil {
		t.Fatalf("PatchWorkflow: %v", err)
	}
	if workflow.Name != name {
		t.Fatalf("workflow name = %q, want %q", workflow.Name, name)
	}
	ids, err := service.NonDoneStatusIDs()
	if err != nil {
		t.Fatalf("NonDoneStatusIDs: %v", err)
	}
	if !slices.Contains(ids, constants.StatusIDOpen) || slices.Contains(ids, constants.StatusIDDone) {
		t.Fatalf("non-completed status IDs = %v", ids)
	}
}

func TestAgentSkillApplicationRejectsOversizedBody(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	service := NewAgentSkillApplicationService(tdb.GetDatabase(), permissions)
	_, _, err := service.prepare(context.Background(), seed.WorkspaceID, AgentSkillInput{
		Name: "oversized", Description: "Too large", Body: strings.Repeat("x", agentskills.MaxBodyBytes+1),
	})
	if !errors.Is(err, ErrAgentSkillValidation) || err.Error() != "body must be at most 64 KiB" {
		t.Fatalf("prepare error = %v, want body-size validation", err)
	}
}

func TestGovernanceApplicationsEnforceSystemAdministration(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, false)
	conditionSets := NewConditionSetApplicationService(tdb.GetDatabase(), permissions)
	if _, err := conditionSets.Create(AuditActor{UserID: seed.UserID}, models.ConditionSet{Name: "Denied", WorkflowID: 1}); !errors.Is(err, ErrGovernanceForbidden) {
		t.Fatalf("condition set create error = %v, want forbidden", err)
	}
	approvalSets := NewApprovalSetService(tdb.GetDatabase())
	approvals := NewApprovalService(tdb.GetDatabase(), repository.NewLeaveRepository(tdb.GetDatabase()), NewWorkflowService(tdb.GetDatabase()))
	governance := NewGovernanceApplicationService(tdb.GetDatabase(), permissions, approvalSets, approvals)
	if _, err := governance.CreateApprovalSet(context.Background(), AuditActor{UserID: seed.UserID}, models.ApprovalSet{Name: "Denied", WorkflowID: 1}); !errors.Is(err, ErrGovernanceForbidden) {
		t.Fatalf("approval set create error = %v, want forbidden", err)
	}
}

func TestCollectionApplicationOwnsCategoriesAndScopedBoardConfiguration(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	service := NewCollectionApplicationService(tdb.GetDatabase(), permissions)
	actor := AuditActor{UserID: seed.UserID}

	category, err := service.CreateCategory(actor, models.CollectionCategory{Name: " Delivery ", Description: "Category"})
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if category.Name != "Delivery" || category.Color == "" {
		t.Fatalf("created category = %+v", category)
	}
	name := "Roadmaps"
	category, err = service.PatchCategory(actor, category.ID, CollectionCategoryPatch{Name: &name})
	if err != nil || category.Name != name {
		t.Fatalf("PatchCategory = (%+v, %v)", category, err)
	}

	scope := BoardConfigurationScope{WorkspaceID: &seed.WorkspaceID}
	created, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{
		Columns: []models.BoardColumnRequest{{Name: "Open", Color: "#123456", StatusIDs: []int{seed.StatusID}}},
	})
	if err != nil {
		t.Fatalf("PutBoardConfiguration(create): %v", err)
	}
	if created.ID == 0 || len(created.Columns) != 1 {
		t.Fatalf("created board configuration = %+v", created)
	}
	updated, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{
		Columns: []models.BoardColumnRequest{{ID: &created.Columns[0].ID, Name: "Ready", Color: "#654321", StatusIDs: []int{seed.StatusID}}},
	})
	if err != nil {
		t.Fatalf("PutBoardConfiguration(update): %v", err)
	}
	if updated.ID != created.ID || updated.Columns[0].Name != "Ready" {
		t.Fatalf("updated board configuration = %+v", updated)
	}
	badDays := 0
	if _, err := service.PutBoardConfiguration(actor, scope, models.BoardConfigurationRequest{CompletedItemRetentionDays: &badDays}); err == nil || err.Error() != "completed_item_retention_days must be between 1 and 3650" {
		t.Fatalf("invalid retention error = %v", err)
	}

	if err := service.DeleteBoardConfiguration(actor, scope); err != nil {
		t.Fatalf("DeleteBoardConfiguration: %v", err)
	}
	if config, err := service.GetBoardConfiguration(seed.UserID, scope); err != nil || config.ID != 0 || config.WorkspaceID == nil {
		t.Fatalf("default board after delete = (%+v, %v)", config, err)
	}
	if err := service.DeleteCategory(actor, category.ID); err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
}

type allowWorkspaceAccess struct{}

func (allowWorkspaceAccess) CanViewWorkspace(int, int) (bool, error) { return true, nil }

func TestTimeProjectApplicationOwnsProjectAndAssignmentLifecycle(t *testing.T) {
	tdb, permissions, seed := convergenceFixture(t, true)
	db := tdb.GetDatabase()
	timePermissions := NewTimePermissionService(db, permissions)
	service := NewTimeProjectApplicationService(db, timePermissions, allowWorkspaceAccess{})
	actor := AuditActor{UserID: seed.UserID}

	category, err := service.CreateCategory(actor, models.TimeProjectCategory{Name: "Client", Color: "#123456"})
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	customerID, _, err := repository.NewCustomerOrganisationRepository(db).Create(&models.CustomerOrganisation{Name: "Acme", Active: true})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	project, err := service.CreateProject(actor, models.TimeProject{Name: "Delivery", CustomerID: &customerID, CategoryID: &category.ID})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	initialManagers, err := service.ListManagers(seed.UserID, project.ID)
	if err != nil || len(initialManagers) != 1 || initialManagers[0].ManagerID != seed.UserID {
		t.Fatalf("creator assignment = (%+v, %v)", initialManagers, err)
	}
	if err := service.RemoveManager(actor, project.ID, initialManagers[0].ID); err != nil {
		t.Fatalf("remove creator assignment: %v", err)
	}
	manager, err := service.AddManager(actor, project.ID, models.TimeProjectManagerRequest{ManagerType: "user", ManagerID: seed.UserID})
	if err != nil {
		t.Fatalf("AddManager: %v", err)
	}
	managers, err := service.ListManagers(seed.UserID, project.ID)
	if err != nil || len(managers) != 1 || managers[0].ID != manager.ID {
		t.Fatalf("ListManagers = (%+v, %v)", managers, err)
	}
	if err := service.RemoveManager(actor, project.ID, manager.ID); err != nil {
		t.Fatalf("RemoveManager: %v", err)
	}
	if err := service.DeleteProject(actor, project.ID); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	if err := service.DeleteCategory(actor, category.ID); err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
}
