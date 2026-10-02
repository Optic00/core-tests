import {
	createUserViaAPI,
} from "../fixtures/api-helpers";
import { type APIRequestContext, expect, test } from "../fixtures/context-path";
import { generateUser } from "../fixtures/test-data";

/**
 * Admin condition-set and approval-set managers (/admin/condition-sets,
 * /admin/approval-sets). Both list pages were previously only exercised as
 * API setup for other tests. The tests create the backing workflow data via
 * the API, then drive list rendering, search filtering, editor navigation,
 * and deletion through the UI.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

interface V2Page<T> {
	data: T;
}

interface WorkflowTransition {
	id: number;
	from: { id: number } | null;
	to: { id: number };
}

async function createStatus(
	request: APIRequestContext,
	name: string,
	categoryId: number,
): Promise<number> {
	const response = await request.post("/api/v2/statuses", {
		headers: SEC_FETCH,
		data: { name, category_id: categoryId },
	});
	expect(response.ok(), `create status ${name}`).toBeTruthy();
	return (await response.json()).data.id;
}

async function createWorkflowFixture(request: APIRequestContext, prefix: string) {
	const categoriesResponse = await request.get("/api/v2/status-categories", {
		headers: SEC_FETCH,
	});
	expect(categoriesResponse.ok()).toBeTruthy();
	const categories = (await categoriesResponse.json()).data as Array<{
		id: number;
		is_default: boolean;
	}>;
	const categoryId = categories.find((category) => category.is_default)?.id ?? categories[0].id;

	const reviewStatusId = await createStatus(request, `${prefix}-Review`, categoryId);
	const approvedStatusId = await createStatus(request, `${prefix}-Approved`, categoryId);
	const rejectedStatusId = await createStatus(request, `${prefix}-Rejected`, categoryId);

	const workflowResponse = await request.post("/api/v2/workflows", {
		headers: SEC_FETCH,
		data: { name: `${prefix}-workflow`, description: "admin set managers e2e" },
	});
	expect(workflowResponse.ok(), `create workflow: ${await workflowResponse.text()}`).toBeTruthy();
	const workflowId = (await workflowResponse.json()).data.id;

	const transitionsResponse = await request.put(`/api/v2/workflows/${workflowId}/transitions`, {
		headers: SEC_FETCH,
		data: {
			transitions: [
				{ from_status_id: null, to_status_id: 1 },
				{ from_status_id: 1, to_status_id: reviewStatusId },
				{ from_status_id: reviewStatusId, to_status_id: approvedStatusId },
				{ from_status_id: reviewStatusId, to_status_id: rejectedStatusId },
			],
		},
	});
	expect(transitionsResponse.ok(), "configure workflow").toBeTruthy();
	const transitions = (await transitionsResponse.json()).data as WorkflowTransition[];

	const approveTransitionId = transitions.find(
		(transition) =>
			transition.from?.id === reviewStatusId && transition.to.id === approvedStatusId,
	)!.id;
	const denyTransitionId = transitions.find(
		(transition) =>
			transition.from?.id === reviewStatusId && transition.to.id === rejectedStatusId,
	)!.id;
	const reviewTransitionId = transitions.find(
		(transition) => transition.from?.id === 1 && transition.to.id === reviewStatusId,
	)!.id;

	return {
		workflowId,
		reviewStatusId,
		approvedStatusId,
		rejectedStatusId,
		approveTransitionId,
		denyTransitionId,
		reviewTransitionId,
	};
}

async function createApprovalSet(
	request: APIRequestContext,
	name: string,
	workflowId: number,
	reviewStatusId: number,
	approveTransitionId: number,
	denyTransitionId: number,
	approverUserId: number,
): Promise<number> {
	const response = await request.post("/api/v2/approval-sets", {
		headers: SEC_FETCH,
		data: {
			name,
			workflow_id: workflowId,
			set_statuses: [
				{
					status_id: reviewStatusId,
					approve_transition_id: approveTransitionId,
					deny_transition_id: denyTransitionId,
					step_mode: "sequential",
					steps: [
						{
							display_order: 0,
							name: "Sole approver",
							quorum_mode: "any",
							approver_source: "user",
							approver_user_id: approverUserId,
							allow_self_approval: false,
							on_leave_strategy: "keep",
						},
					],
				},
			],
		},
	});
	expect(response.status(), `create approval set: ${await response.text()}`).toBe(201);
	return (await response.json()).data.id;
}

async function createConditionSet(
	request: APIRequestContext,
	name: string,
	workflowId: number,
	transitionId: number,
): Promise<number> {
	const response = await request.post("/api/v2/condition-sets", {
		headers: SEC_FETCH,
		data: {
			name,
			description: "admin set managers e2e",
			workflow_id: workflowId,
			transition_conditions: [
				{ transition_id: transitionId, logic_mode: "and", conditions: [] },
			],
		},
	});
	expect(
		response.status(),
		`create condition set: ${await response.text()}`,
	).toBeLessThan(300);
	return (await response.json()).data.id;
}

test.describe("Admin condition and approval set managers", () => {
	test("approval set list renders, filters, opens the editor, and deletes", async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const prefix = `adm-approval-${stamp}`;
		const approver = await createUserViaAPI(request, generateUser(`apr-${stamp}`));
		const fixture = await createWorkflowFixture(request, prefix);
		const setName = `${prefix}-set`;
		const setId = await createApprovalSet(
			request,
			setName,
			fixture.workflowId,
			fixture.reviewStatusId,
			fixture.approveTransitionId,
			fixture.denyTransitionId,
			approver.id,
		);

		try {
			await page.goto("/admin/approval-sets");
		const row = page.getByTestId(`approval-set-row-${setId}`);
		await expect(row).toBeVisible();
		await expect(row).toContainText(setName);

		// Search narrows to matching rows and restores on clear.
		await page.getByTestId("approval-set-search").fill(setName);
		await expect(row).toBeVisible();
		await page.getByTestId("approval-set-search").fill("no-match-at-all");
		await expect(row).toBeHidden();
		await page.getByTestId("approval-set-search").fill(setName);
		await expect(row).toBeVisible();

		// The editor loads the set's own data.
		await page.getByTestId(`approval-set-edit-${setId}`).click();
		await expect(page).toHaveURL(new RegExp(`/admin/approval-sets/${setId}$`));
		await expect(page.getByTestId("approval-set-name")).toHaveValue(setName);

		// Delete from the list after confirming.
		await page.goto("/admin/approval-sets");
		await page.getByTestId(`approval-set-delete-${setId}`).click();
		await expect(page.getByTestId("dialog-confirm")).toBeVisible();
		await page.getByTestId("dialog-confirm").click();
		await expect(page.getByTestId(`approval-set-row-${setId}`)).toHaveCount(0);

		const listResponse = await request.get("/api/v2/approval-sets", { headers: SEC_FETCH });
		expect(listResponse.ok()).toBeTruthy();
		const remaining = ((await listResponse.json()) as V2Page<Array<{ id: number }>>).data;
		expect(remaining.find((set) => set.id === setId)).toBeUndefined();
		} finally {
			// Remove the catalog fixture; the set itself is already gone via the UI.
			await request.delete(`/api/users/${approver.id}`, { headers: SEC_FETCH });
			await request.delete(`/api/v2/workflows/${fixture.workflowId}`, { headers: SEC_FETCH });
			for (const statusId of [
				fixture.reviewStatusId,
				fixture.approvedStatusId,
				fixture.rejectedStatusId,
			]) {
				await request.delete(`/api/v2/statuses/${statusId}`, { headers: SEC_FETCH });
			}
		}
	});

	test("condition set list renders, filters, opens the editor, and deletes", async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const prefix = `adm-condition-${stamp}`;
		const fixture = await createWorkflowFixture(request, prefix);
		const setName = `${prefix}-set`;
		const setId = await createConditionSet(
			request,
			setName,
			fixture.workflowId,
			fixture.reviewTransitionId,
		);

		try {
			await page.goto("/admin/condition-sets");
		const row = page.getByTestId(`condition-set-row-${setId}`);
		await expect(row).toBeVisible();
		await expect(row).toContainText(setName);

		await page.getByTestId("condition-set-search").fill("no-match-at-all");
		await expect(row).toBeHidden();
		await page.getByTestId("condition-set-search").fill(setName);
		await expect(row).toBeVisible();

		// The editor loads the set's own data.
		await page.getByTestId(`condition-set-edit-${setId}`).click();
		await expect(page).toHaveURL(new RegExp(`/admin/condition-sets/${setId}$`));
		await expect(page.getByTestId("condition-set-name")).toHaveValue(setName);

		// Delete from the list after confirming.
		await page.goto("/admin/condition-sets");
		await page.getByTestId(`condition-set-delete-${setId}`).click();
		await expect(page.getByTestId("dialog-confirm")).toBeVisible();
		await page.getByTestId("dialog-confirm").click();
		await expect(page.getByTestId(`condition-set-row-${setId}`)).toHaveCount(0);

		const listResponse = await request.get("/api/v2/condition-sets", { headers: SEC_FETCH });
		expect(listResponse.ok()).toBeTruthy();
		const remaining = ((await listResponse.json()) as V2Page<Array<{ id: number }>>).data;
		expect(remaining.find((set) => set.id === setId)).toBeUndefined();
		} finally {
			await request.delete(`/api/v2/workflows/${fixture.workflowId}`, { headers: SEC_FETCH });
			for (const statusId of [
				fixture.reviewStatusId,
				fixture.approvedStatusId,
				fixture.rejectedStatusId,
			]) {
				await request.delete(`/api/v2/statuses/${statusId}`, { headers: SEC_FETCH });
			}
		}
	});
});
