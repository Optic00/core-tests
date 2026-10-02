import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/context-path";

type XrayRegion = "global" | "us" | "eu" | "au";

type JiraImportXrayLiveConfig = {
	cloudUrl: string;
	email: string;
	apiToken: string;
	xray: {
		region: XrayRegion;
		clientId: string;
		clientSecret: string;
	};
};

type XrayStep = {
	action: string;
	data: string;
	result: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath =
	process.env.JIRA_IMPORT_E2E_CONFIG ??
	path.resolve(__dirname, "../../../core/.jira-import-e2e.local.json");
const projectKey = process.env.JIRA_XRAY_LIVE_PROJECT ?? "KN";
const issueID = process.env.JIRA_XRAY_LIVE_ISSUE_ID ?? "10520";
const testTitle = process.env.JIRA_XRAY_LIVE_TEST_TITLE ?? "Test 1";

function loadConfig(): JiraImportXrayLiveConfig {
	const config = JSON.parse(
		fs.readFileSync(configPath, "utf8"),
	) as JiraImportXrayLiveConfig;
	if (
		!config.cloudUrl?.startsWith("https://") ||
		!config.email ||
		!config.apiToken ||
		!config.xray?.clientId ||
		!config.xray?.clientSecret ||
		!["global", "us", "eu", "au"].includes(config.xray.region)
	) {
		throw new Error(`Invalid Xray live-import configuration at ${configPath}`);
	}
	return config;
}

async function loadExpectedXraySteps(
	config: JiraImportXrayLiveConfig,
): Promise<XrayStep[]> {
	const hosts: Record<XrayRegion, string> = {
		global: "xray.cloud.getxray.app",
		us: "us.xray.cloud.getxray.app",
		eu: "eu.xray.cloud.getxray.app",
		au: "au.xray.cloud.getxray.app",
	};
	const baseURL = `https://${hosts[config.xray.region]}`;
	const authentication = await fetch(`${baseURL}/api/v2/authenticate`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_id: config.xray.clientId,
			client_secret: config.xray.clientSecret,
		}),
	});
	expect(authentication.ok, "Xray authentication failed").toBeTruthy();
	const token = (await authentication.json()) as string;

	const response = await fetch(`${baseURL}/api/v2/graphql`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query: `
				query ImportTests($issueIds: [String], $limit: Int!) {
					getTests(issueIds: $issueIds, limit: $limit) {
						results {
							issueId
							steps { action data result }
						}
					}
				}
			`,
			variables: { issueIds: [issueID], limit: 1 },
		}),
	});
	expect(response.ok, "Xray GraphQL request failed").toBeTruthy();
	const body = (await response.json()) as {
		data?: {
			getTests?: {
				results?: Array<{ issueId: string; steps: XrayStep[] }>;
			};
		};
		errors?: Array<{ message: string }>;
	};
	expect(body.errors ?? []).toHaveLength(0);
	const definition = body.data?.getTests?.results?.find(
		(testDefinition) => testDefinition.issueId === issueID,
	);
	expect(
		definition,
		`Xray returned no definition for issue ${issueID}`,
	).toBeDefined();
	expect(definition?.steps.length).toBeGreaterThan(0);
	return definition?.steps ?? [];
}

test.describe.configure({ mode: "serial", retries: 0 });
test.use({ trace: "retain-on-failure", video: "off" });

test("imports a live Xray Cloud Test and preserves its rendered step order", async ({
	page,
	request,
}) => {
	test.setTimeout(30 * 60 * 1000);
	const config = loadConfig();
	const expectedSteps = await loadExpectedXraySteps(config);

	await page.goto("/admin/system-import");
	await page.getByTestId("jira-import-new").click();
	await expect(page.getByTestId("jira-import-step-connect")).toBeVisible();

	await page.getByTestId("jira-import-url").fill(config.cloudUrl);
	await page.getByTestId("jira-import-email").fill(config.email);
	await page.getByTestId("jira-import-api-token").fill(config.apiToken);
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-projects")).toBeVisible({
		timeout: 2 * 60 * 1000,
	});
	const project = page.getByTestId(`jira-import-project-${projectKey}`);
	await expect(project).toBeVisible();
	await expect(project).toBeEnabled();
	await project.click();
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-xray")).toBeVisible({
		timeout: 10 * 60 * 1000,
	});
	await expect(page.getByTestId("jira-import-xray-options")).toBeVisible();
	await page.getByTestId("jira-import-xray-enabled").click();
	if (config.xray.region !== "global") {
		await page.locator("#jira-import-xray-region").click();
		await page
			.locator(`#jira-import-xray-region-option-${config.xray.region}`)
			.click();
	}
	await page
		.getByTestId("jira-import-xray-client-id")
		.fill(config.xray.clientId);
	await page
		.getByTestId("jira-import-xray-client-secret")
		.fill(config.xray.clientSecret);
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-mapping")).toBeVisible();
	await expect(
		page.getByTestId(`jira-import-workspace-mapping-${projectKey}`),
	).toBeVisible();
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-preview")).toBeVisible();
	await expect(
		page.getByTestId("jira-import-preview-xray-tests"),
	).toContainText("1");
	await page.getByTestId("jira-import-next").click();

	await expect(page.getByTestId("jira-import-step-import")).toBeVisible();
	await expect(page.getByTestId("jira-import-progress")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByTestId("jira-import-complete")).toBeVisible({
		timeout: 25 * 60 * 1000,
	});
	await expect(
		page.getByTestId("jira-import-xray-imported-count"),
	).toContainText("Imported 1 Xray test case");
	await expect(page.getByTestId("jira-import-xray-failed-count")).toHaveCount(
		0,
	);
	await page.getByTestId("jira-import-next").click();

	const workspacesResponse = await request.get("/api/v2/workspaces");
	expect(
		workspacesResponse.ok(),
		"failed to locate imported workspace",
	).toBeTruthy();
	const workspaceBody = (await workspacesResponse.json()) as
		| Array<{ id: number; key: string }>
		| { data: Array<{ id: number; key: string }> };
	const workspaces = Array.isArray(workspaceBody)
		? workspaceBody
		: workspaceBody.data;
	const workspace = workspaces.find(
		(candidate) => candidate.key === projectKey,
	);
	expect(
		workspace,
		`imported workspace ${projectKey} was not found`,
	).toBeDefined();

	await page.goto(`/workspaces/${workspace?.id}/tests`);
	const testCaseRows = page.getByTestId(/^test-case-row-/);
	await expect(testCaseRows).toHaveCount(1);
	await expect(testCaseRows.first()).toContainText(testTitle);
	const testCaseID = (
		await testCaseRows.first().getAttribute("data-testid")
	)?.replace("test-case-row-", "");
	expect(testCaseID).toBeTruthy();
	await page.getByTestId(`test-case-steps-${testCaseID}`).click();

	const stepRows = page.getByTestId(/^test-step-row-/);
	await expect(stepRows).toHaveCount(expectedSteps.length);
	for (const [index, expectedStep] of expectedSteps.entries()) {
		const row = stepRows.nth(index);
		await expect(row).toContainText(expectedStep.action);
		if (expectedStep.data) {
			await expect(row).toContainText(expectedStep.data);
		}
		await expect(row).toContainText(expectedStep.result);
	}
});
