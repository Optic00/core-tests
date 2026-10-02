import { expect, test } from "../fixtures/context-path";

test("conflicting Jira import offers an explicit update path and sends force_reimport", async ({
	page,
}) => {
	await page.route("**/api/admin/jira-import/connections", async (route) => {
		if (route.request().method() !== "GET") return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([
				{
					id: "connection-reimport",
					instance_url: "https://example.atlassian.net",
					email: "admin@example.com",
					instance_name: "Jira re-import",
					deployment_type: "cloud",
					last_used_at: "2026-07-30T06:00:00Z",
				},
			]),
		});
	});
	await page.route("**/api/admin/jira-import/jobs", async (route) => {
		if (route.request().method() !== "GET") return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: "[]",
		});
	});
	await page.route("**/api/admin/jira-import/projects?*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([
				{
					id: "10000",
					key: "APP",
					name: "Application",
					project_type: "software",
					is_team_managed: true,
				},
			]),
		});
	});
	await page.route(
		"**/api/admin/jira-import/projects/counts",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ APP: 2 }),
			});
		},
	);
	await page.route("**/api/admin/jira-import/analyze", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				projects: [
					{
						key: "APP",
						name: "Application",
						issue_count: 2,
						suggested_workspace_key: "APP",
						is_team_managed: true,
					},
				],
				issue_types: [
					{
						id: "10001",
						name: "Story",
						subtask: false,
						hierarchy_level: 0,
					},
				],
				statuses: [
					{
						id: "1",
						name: "To Do",
						category_key: "new",
						category_name: "To Do",
						color: "#64748b",
					},
				],
				custom_fields: [],
				versions: [],
				users: [],
				asset_schemas: [],
				service_management_projects: [],
				total_issues: 2,
				total_assets: 0,
				xray: {
					detection_status: "not_detected",
					total_tests: 0,
					projects: [],
					test_issue_type_ids: [],
				},
			}),
		});
	});

	const importRequests: Array<Record<string, unknown>> = [];
	await page.route("**/api/admin/jira-import/start", async (route) => {
		const request = route.request();
		const payload = request.postDataJSON() as Record<string, unknown>;
		importRequests.push(payload);
		if (payload.force_reimport !== true) {
			await route.fulfill({
				status: 409,
				contentType: "application/json",
				body: JSON.stringify({
					code: "JIRA_IMPORT_CONFLICT",
					error:
						"One or more selected Jira projects have already been imported.",
					details: {
						conflicting_imports: [
							{
								job_id: "previous-job",
								status: "completed",
								project_keys: ["APP"],
								configuration_drift: true,
							},
						],
					},
				}),
			});
			return;
		}
		await route.fulfill({
			status: 202,
			contentType: "application/json",
			body: JSON.stringify({ job_id: "job-reimport" }),
		});
	});
	await page.route(
		"**/api/admin/jira-import/jobs/job-reimport",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					id: "job-reimport",
					status: "completed",
					phase: "completed",
					progress: {
						total_issues: 2,
						imported_issues: 2,
						total_comments: 0,
						imported_comments: 0,
						total_attachments: 0,
						imported_attachments: 0,
					},
				}),
			});
		},
	);

	await page.goto("/admin/system-import");
	const connection = page.getByTestId(
		"jira-import-connection-connection-reimport",
	);
	await expect(connection).toBeVisible();
	await connection.getByTestId("jira-import-connection-start").click();

	await page.getByTestId("jira-import-next").click();
	await expect(page.getByTestId("jira-import-step-projects")).toBeVisible();
	const teamManagedProject = page.getByTestId("jira-import-project-APP");
	await expect(teamManagedProject).toBeEnabled();
	await expect(teamManagedProject).toHaveAttribute(
		"data-configuration-mode",
		"conservative",
	);
	await teamManagedProject.click();
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-mapping")).toBeVisible();
	await expect(
		page.getByTestId("jira-import-team-managed-limits-APP"),
	).toBeVisible();
	await page.getByTestId("jira-import-next").click();
	await expect(page.getByTestId("jira-import-step-preview")).toBeVisible();
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-import")).toBeVisible();
	const forceReimport = page.getByTestId("jira-import-force-reimport");
	await expect(forceReimport).toBeVisible();
	await expect(forceReimport).toBeEnabled();
	await expect(
		page.getByTestId("jira-import-conflict-previous-job"),
	).toHaveAttribute("data-configuration-drift", "true");
	expect(importRequests).toHaveLength(1);
	expect(importRequests[0].force_reimport).toBe(false);

	await forceReimport.click();

	await expect(page.getByTestId("jira-import-complete")).toHaveAttribute(
		"data-imported-issues",
		"2",
	);
	expect(importRequests).toHaveLength(2);
	expect(importRequests[1]).toMatchObject({
		connection_id: "connection-reimport",
		project_keys: ["APP"],
		force_reimport: true,
	});
});
