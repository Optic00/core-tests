import { expect, test } from "../fixtures/context-path";

/**
 * Revoked-token surfacing — pins the fix for:
 *
 *   "I have a saved connection that has a revoked token and when I get to
 *    step 2 I get an empty project list. But no error whatsoever."
 *
 * Before the fix the wizard advanced to the Projects step regardless of
 * whether `GET /api/admin/jira-import/projects` failed, then rendered an
 * empty list with no banner, no toast, and no console error.
 *
 * After the fix:
 *   - The backend maps Jira 401 → 502 with `{code: "JIRA_AUTH_FAILED"}` so
 *     the frontend's fetchAPI 401-auto-logout doesn't fire.
 *   - The wizard stays on the Connect step on JIRA_AUTH_FAILED.
 *   - A toast titled "Reconnect required" appears with the upstream message.
 *
 * This spec mocks both endpoints because the alternative (seeding a real bad
 * Jira connection) would require pointing at a network endpoint we control.
 */

test("revoked saved-connection token surfaces a Reconnect required toast and does not advance the wizard", async ({
	page,
}) => {
	// Fake saved connection so the user can click Start Import without touching Jira.
	await page.route("**/api/admin/jira-import/connections", async (route) => {
		if (route.request().method() !== "GET") return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([
				{
					id: "conn-revoked-test",
					instance_url: "https://example.atlassian.net",
					email: "revoked@example.com",
					instance_name: "Revoked test",
					deployment_type: "cloud",
					last_used_at: "2026-05-17T12:00:00Z",
				},
			]),
		});
	});

	// Both the projects list endpoint and the counts endpoint are guarded —
	// mock both so we cover whichever fires first in the click flow.
	const upstreamErrorBody = JSON.stringify({
		code: "JIRA_AUTH_FAILED",
		error:
			"Jira authentication failed — the saved token may be expired or revoked. Reconnect this Jira connection to continue.",
		message:
			"Jira authentication failed — the saved token may be expired or revoked. Reconnect this Jira connection to continue.",
	});
	await page.route("**/api/admin/jira-import/projects*", async (route) => {
		await route.fulfill({
			status: 502,
			contentType: "application/json",
			body: upstreamErrorBody,
		});
	});

	// Other admin-bootstrapping endpoints SystemImportPage triggers — let them
	// pass through; we only care about the two routes above.

	await page.goto("/admin/system-import");

	// Wait for the saved-connection row to render and start from that row.
	const connectionRow = page.getByTestId(
		"jira-import-connection-conn-revoked-test",
	);
	await expect(connectionRow).toBeVisible();
	const startBtn = connectionRow.getByTestId("jira-import-connection-start");
	await expect(startBtn).toBeVisible();
	await startBtn.click();

	// Wizard opens on the Connect step with the saved connection pre-applied
	// (SystemImportPage.openWizard → jiraImport.useSavedConnection). Click
	// Continue / Next to trigger loadProjects(). The wizard's primary action
	// button label is the wizard nextStep button.
	const continueBtn = page.getByTestId("jira-import-next");
	await expect(continueBtn).toBeVisible();
	await continueBtn.click();

	// Assertion 1: The "Reconnect required" toast appears.
	const toast = page.getByTestId("toast").first();
	await expect(toast).toBeVisible({ timeout: 5_000 });
	await expect(toast).toContainText(/reconnect required/i);

	// Assertion 2: We did NOT advance to the Projects step — the projects
	// search input ("Search projects...") only renders on that step.
	await expect(page.getByTestId("jira-import-project-search")).toHaveCount(0);
});
