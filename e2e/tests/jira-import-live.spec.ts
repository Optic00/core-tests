import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/context-path";

type JiraImportLiveConfig = {
	cloudUrl: string;
	email: string;
	apiToken: string;
	projectKeys: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath =
	process.env.JIRA_IMPORT_E2E_CONFIG ??
	path.resolve(__dirname, "../../../core/.jira-import-e2e.local.json");

function loadConfig(): JiraImportLiveConfig {
	const config = JSON.parse(
		fs.readFileSync(configPath, "utf8"),
	) as JiraImportLiveConfig;
	if (
		!config.cloudUrl?.startsWith("https://") ||
		!config.email ||
		!config.apiToken ||
		!Array.isArray(config.projectKeys)
	) {
		throw new Error(
			`Invalid Jira live-import configuration at ${configPath}; HTTPS URL, email, token, and a projectKeys array are required`,
		);
	}
	return config;
}

function firstNumber(value: string | null): number {
	const match = value?.replaceAll(",", "").match(/\d+/);
	if (!match) throw new Error(`Expected a numeric value in: ${value}`);
	return Number(match[0]);
}

test.describe.configure({ mode: "serial", retries: 0 });
test.use({ trace: "off", video: "off" });

test("imports selected Jira Cloud projects and their supported configuration through the wizard", async ({
	page,
}, testInfo) => {
	test.setTimeout(30 * 60 * 1000);
	const config = loadConfig();

	await page.goto("/admin/system-import");
	await page.getByTestId("jira-import-new").click();
	await expect(page.getByTestId("jira-import-step-connect")).toBeVisible();
	await expect(page.getByTestId("jira-import-close")).toBeVisible();

	await page.getByTestId("jira-import-url").fill(config.cloudUrl);
	await page.getByTestId("jira-import-email").fill(config.email);
	await page.getByTestId("jira-import-api-token").fill(config.apiToken);
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-projects")).toBeVisible({
		timeout: 2 * 60 * 1000,
	});
	const discoveredProjects = await page
		.getByTestId(/^jira-import-project-/)
		.evaluateAll((buttons) =>
			buttons.map((button) => ({
				key: (button.getAttribute("data-testid") ?? "").replace(
					"jira-import-project-",
					"",
				),
				projectType: button.getAttribute("data-project-type") ?? "",
				issueCount: Number(button.getAttribute("data-issue-count") ?? "0"),
				disabled: (button as HTMLButtonElement).disabled,
			})),
		);
	let selectedProjectKeys = config.projectKeys;
	if (selectedProjectKeys.length === 0) {
		const softwareProject = discoveredProjects.find(
			(project) => project.projectType === "software" && !project.disabled,
		);
		const serviceManagementProject = discoveredProjects.find(
			(project) => project.projectType === "service_desk" && !project.disabled,
		);
		if (!softwareProject || !serviceManagementProject) {
			throw new Error(
				"The live Jira import regression requires one importable software project and one Jira Service Management project",
			);
		}
		selectedProjectKeys = [softwareProject.key, serviceManagementProject.key];
	}
	const selectedProjects = selectedProjectKeys.map((projectKey) => {
		const project = discoveredProjects.find(
			(candidate) => candidate.key === projectKey,
		);
		if (!project) {
			throw new Error(
				`Configured Jira project ${projectKey} was not discovered`,
			);
		}
		return project;
	});
	expect(
		selectedProjects.some((project) => project.projectType === "software"),
	).toBeTruthy();
	expect(
		selectedProjects.some((project) => project.projectType === "service_desk"),
	).toBeTruthy();
	const expectedIssueCount = selectedProjects.reduce(
		(total, project) => total + project.issueCount,
		0,
	);
	for (const projectKey of selectedProjectKeys) {
		const project = page.getByTestId(`jira-import-project-${projectKey}`);
		await expect(project).toBeVisible();
		await expect(project).toBeEnabled();
		await project.click();
	}

	await page.getByTestId("jira-import-next").click();
	await expect(page.getByTestId("jira-import-step-mapping")).toBeVisible({
		timeout: 10 * 60 * 1000,
	});

	for (const projectKey of selectedProjectKeys) {
		await expect(
			page.getByTestId(`jira-import-workspace-mapping-${projectKey}`),
		).toBeVisible();
	}

	const issueTypeMappings = page.getByTestId("jira-import-issue-type-mapping");
	const statusMappings = page.getByTestId("jira-import-status-mapping");
	const versionMappings = page.getByTestId("jira-import-version-mapping");
	const customFieldMappings = page.getByTestId(
		"jira-import-custom-field-mapping",
	);
	await expect(issueTypeMappings.first()).toBeVisible();
	await expect(statusMappings.first()).toBeVisible();
	await expect(customFieldMappings.first()).toBeVisible();
	const serviceManagementProjects = page.getByTestId(
		"jira-import-service-management-project",
	);
	await expect(serviceManagementProjects.first()).toBeVisible();
	const serviceManagementProjectDetails =
		await serviceManagementProjects.evaluateAll((rows) =>
			rows.map((row) => ({
				projectKey: row.getAttribute("data-project-key") ?? "",
				requestTypeCount: Number(
					row.getAttribute("data-request-type-count") ?? "0",
				),
			})),
		);
	const expectedRequestTypeCount = serviceManagementProjectDetails.reduce(
		(total, project) => total + project.requestTypeCount,
		0,
	);
	expect(expectedRequestTypeCount).toBeGreaterThan(0);

	const organizationMapping = page.getByTestId(
		"jira-import-service-management-organizations",
	);
	let expectedOrganizationCount = 0;
	let expectedOrganizationMemberCount = 0;
	if ((await organizationMapping.count()) > 0) {
		await expect(organizationMapping).toBeVisible();
		expectedOrganizationCount = Number(
			(await organizationMapping.getAttribute("data-organization-count")) ??
				"0",
		);
		expectedOrganizationMemberCount = Number(
			(await organizationMapping.getAttribute(
				"data-organization-member-count",
			)) ?? "0",
		);
		expect(expectedOrganizationCount).toBeGreaterThan(0);
		await page.getByTestId("jira-import-import-organizations").click();
	}

	const fieldActions = await customFieldMappings.evaluateAll((rows) =>
		rows.map((row) => row.getAttribute("data-mapping-action")),
	);
	expect(fieldActions.length).toBeGreaterThan(0);
	expect(
		fieldActions.every((action) => action === "create" || action === "skip"),
	).toBeTruthy();

	const assetSchemaMappings = page.getByTestId("jira-import-asset-schema");
	await expect(page.getByTestId("jira-import-assets-mapping")).toBeVisible();
	await expect(assetSchemaMappings.first()).toBeVisible();
	const assetFieldMappings = page.getByTestId(
		"jira-import-asset-field-mapping",
	);
	await expect(assetFieldMappings.first()).toBeVisible();
	const assetFieldIDs = await assetFieldMappings.evaluateAll((rows) =>
		rows.map((row) => row.getAttribute("data-jira-field-id") ?? ""),
	);
	expect(
		assetFieldIDs.every((fieldID) => fieldID.startsWith("customfield_")),
	).toBeTruthy();
	for (const fieldID of assetFieldIDs) {
		await expect(
			page.locator(`#jira-import-asset-field-schema-${fieldID}`),
		).toContainText("Detect from issue values");
	}
	const assetSchemas = await assetSchemaMappings.evaluateAll((rows) =>
		rows.map((row) => ({
			name: row.getAttribute("data-schema-name") ?? "",
			key: row.getAttribute("data-schema-key") ?? "",
			setName: row.getAttribute("data-set-name") ?? "",
			objectCount: Number(row.getAttribute("data-object-count") ?? "0"),
			typeCount: Number(row.getAttribute("data-type-count") ?? "0"),
		})),
	);
	const expectedAssetCount = assetSchemas.reduce(
		(total, schema) => total + schema.objectCount,
		0,
	);
	expect(assetSchemas.length).toBeGreaterThan(0);
	expect(expectedAssetCount).toBeGreaterThan(0);
	expect(assetSchemas.some((schema) => schema.typeCount > 0)).toBeTruthy();

	const mappingSummary = {
		projects: selectedProjectKeys,
		issueTypes: await issueTypeMappings.count(),
		statuses: await statusMappings.count(),
		versions: await versionMappings.count(),
		customFieldsCreated: fieldActions.filter((action) => action === "create")
			.length,
		customFieldsSkipped: fieldActions.filter((action) => action === "skip")
			.length,
		serviceManagementRequestTypes: expectedRequestTypeCount,
		customerOrganizations: expectedOrganizationCount,
		organizationMembers: expectedOrganizationMemberCount,
		assetSchemas: assetSchemas.length,
		assetFields: assetFieldIDs.length,
		assets: expectedAssetCount,
	};
	await testInfo.attach("jira-import-mapping-summary.json", {
		body: JSON.stringify(mappingSummary, null, 2),
		contentType: "application/json",
	});
	console.log(`Jira import mapping summary: ${JSON.stringify(mappingSummary)}`);

	await page.getByTestId("jira-import-next").click();
	await expect(page.getByTestId("jira-import-step-preview")).toBeVisible();
	for (const projectKey of selectedProjectKeys) {
		await expect(
			page.getByTestId(`jira-import-preview-project-${projectKey}`),
		).toBeVisible();
	}
	if (expectedOrganizationCount > 0) {
		await expect(
			page.getByTestId("jira-import-preview-organizations"),
		).toHaveAttribute("data-import-enabled", "true");
	}
	await expect(page.getByTestId("jira-import-preview-assets")).toHaveAttribute(
		"data-asset-count",
		String(expectedAssetCount),
	);

	const previewWorkspaceCount = firstNumber(
		await page.getByTestId("jira-import-preview-workspaces").textContent(),
	);
	const previewItemCount = firstNumber(
		await page.getByTestId("jira-import-preview-items").textContent(),
	);
	expect(previewWorkspaceCount).toBe(selectedProjectKeys.length);
	expect(previewItemCount).toBeGreaterThan(0);
	if (expectedIssueCount > 0) {
		expect(previewItemCount).toBe(expectedIssueCount);
	}

	await page.getByTestId("jira-import-next").click();
	await expect(page.getByTestId("jira-import-step-import")).toBeVisible();
	await expect(page.getByTestId("jira-import-progress")).toBeVisible({
		timeout: 30_000,
	});
	const importComplete = page.getByTestId("jira-import-complete");
	await expect(importComplete).toBeVisible({
		timeout: 25 * 60 * 1000,
	});
	await expect(page.getByTestId("jira-import-failed-count")).toHaveCount(0);
	const importCounts = {
		totalIssues: Number(
			(await importComplete.getAttribute("data-total-issues")) ?? "0",
		),
		importedIssues: Number(
			(await importComplete.getAttribute("data-imported-issues")) ?? "0",
		),
		totalComments: Number(
			(await importComplete.getAttribute("data-total-comments")) ?? "0",
		),
		importedComments: Number(
			(await importComplete.getAttribute("data-imported-comments")) ?? "0",
		),
		totalAttachments: Number(
			(await importComplete.getAttribute("data-total-attachments")) ?? "0",
		),
		importedAttachments: Number(
			(await importComplete.getAttribute("data-imported-attachments")) ?? "0",
		),
	};
	expect(importCounts.totalIssues).toBe(previewItemCount);
	expect(importCounts.importedIssues).toBe(importCounts.totalIssues);
	expect(importCounts.totalComments).toBeGreaterThan(0);
	expect(importCounts.importedComments).toBe(importCounts.totalComments);
	expect(importCounts.importedAttachments).toBe(importCounts.totalAttachments);

	await page.getByTestId("jira-import-next").click();
	await expect(page.getByTestId("jira-import-wizard")).toHaveCount(0);

	const historyRow = page.getByTestId("jira-import-history-row").first();
	await expect(historyRow).toBeVisible();
	await expect(historyRow.getByTestId("jira-import-history-status")).toHaveText(
		"completed",
	);
	const historyCounts = await historyRow
		.getByTestId("jira-import-history-counts")
		.textContent();
	expect(historyCounts).toContain(
		`${previewWorkspaceCount} ${previewWorkspaceCount === 1 ? "workspace" : "workspaces"}`,
	);
	expect(historyCounts).toContain(
		`${previewItemCount} ${previewItemCount === 1 ? "item" : "items"}`,
	);
	await expect(historyRow).toHaveAttribute(
		"data-imported-comments",
		String(importCounts.importedComments),
	);
	await expect(historyRow).toHaveAttribute(
		"data-imported-attachments",
		String(importCounts.importedAttachments),
	);

	const portalProject = serviceManagementProjectDetails[0];
	expect(portalProject.projectKey).not.toBe("");
	await page.goto(`/portal/jira-${portalProject.projectKey.toLowerCase()}`);
	await expect(page.getByTestId("portal-page")).toHaveAttribute(
		"data-ready",
		"true",
	);
	await expect(page.getByTestId("portal-request-type-card")).toHaveCount(
		portalProject.requestTypeCount,
	);

	await page.goto("/organizations");
	const portalCustomersPage = page.getByTestId("portal-customers-page");
	await expect(portalCustomersPage).toHaveAttribute("data-ready", "true");
	if (expectedOrganizationMemberCount > 0) {
		await expect(portalCustomersPage).toHaveAttribute(
			"data-total-customers",
			String(expectedOrganizationMemberCount),
		);
	}
	const importedPortalCustomers = page.getByTestId("portal-customer-row");
	await expect(importedPortalCustomers.first()).toBeVisible();
	console.log(
		`Imported portal customer rows: ${await importedPortalCustomers.count()}`,
	);
	if (expectedOrganizationCount > 0) {
		const organizations = page.getByTestId("customer-organization");
		expect(await organizations.count()).toBeGreaterThanOrEqual(
			expectedOrganizationCount,
		);
		let assignedCustomerRows = 0;
		for (let index = 0; index < (await organizations.count()); index += 1) {
			await organizations.nth(index).click();
			assignedCustomerRows += await page
				.getByTestId("portal-customer-row")
				.count();
		}
		expect(assignedCustomerRows).toBeGreaterThan(0);
	}

	await page.goto("/assets");
	await expect(page.getByTestId("asset-browser")).toBeVisible();
	for (const schema of assetSchemas) {
		await page.locator("#asset-set-select").click();
		const assetSetOptions = page.getByTestId("asset-set-select-option");
		await expect(assetSetOptions.first()).toBeVisible();
		const optionLabels = await assetSetOptions.allTextContents();
		const importedSetIndex = optionLabels.findIndex(
			(label) => label.trim() === schema.setName,
		);
		expect(importedSetIndex).toBeGreaterThanOrEqual(0);
		await assetSetOptions.nth(importedSetIndex).click();
		await expect(assetSetOptions).toHaveCount(0);
		await expect
			.poll(async () =>
				Number(
					(await page
						.getByTestId("asset-browser")
						.getAttribute("data-total-assets")) ?? "0",
				),
			)
			.toBe(schema.objectCount);
		await expect(page.getByTestId("asset-row")).toHaveCount(
			Math.min(schema.objectCount, 25),
		);
	}
});
