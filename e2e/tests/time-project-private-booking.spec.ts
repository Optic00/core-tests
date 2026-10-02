import type { BrowserContext } from "@playwright/test";
import {
	createCustomerOrgViaAPI,
	createTimeProjectViaAPI,
	createUserViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateUser } from "../fixtures/test-data";
import { TimeTrackingPage } from "../pages/time-tracking.page";

const headers = { "Sec-Fetch-Site": "same-origin" };

test("private project is visible and bookable only by its member", async ({
	request,
	browser,
}, testInfo) => {
	const suffix = `private-${testInfo.workerIndex}-${testInfo.testId.slice(0, 8)}`;
	const cleanupPaths: string[] = [];
	const contexts: BrowserContext[] = [];

	try {
		const users = [];
		for (const role of ["member", "outsider"]) {
			const credentials = generateUser(`${suffix}-${role}`);
			const user = await createUserViaAPI(request, credentials);
			cleanupPaths.unshift(`/api/users/${user.id}`);
			const context = await browser.newContext({
				baseURL: process.env.BASE_URL || "http://localhost:8080",
				storageState: { cookies: [], origins: [] },
			});
			contexts.push(context);
			const login = await context.request.post("/api/auth/login", {
				headers,
				data: {
					email_or_username: credentials.username,
					password: credentials.password_hash,
				},
			});
			expect(login.status(), await login.text()).toBe(200);
			const page = await context.newPage();
			await page.clock.setFixedTime(new Date("2026-09-08T12:00:00Z"));
			users.push({ id: user.id, page });
		}
		const [member, outsider] = users;
		const customer = await createCustomerOrgViaAPI(request, {
			name: `Booking customer ${suffix}`,
		});
		cleanupPaths.unshift(`/api/customer-organisations/${customer.id}`);
		const projects = [];
		for (const visibility of ["Private", "Open"]) {
			const project = await createTimeProjectViaAPI(request, {
				name: `${visibility} booking ${suffix}`,
				customer_id: customer.id,
			});
			cleanupPaths.unshift(`/api/v2/time/projects/${project.id}`);
			projects.push(project);
		}
		const [privateProject, openProject] = projects;
		const membership = await request.post(
			`/api/v2/time/projects/${privateProject.id}/members`,
			{
				headers,
				data: { principal_type: "user", principal_id: member.id },
			},
		);
		expect(membership.status(), await membership.text()).toBe(201);

		await test.step("member sees the private project; outsider sees only the open control", async () => {
			for (const actor of users) {
				await actor.page.goto("/time/projects");
				await expect(
					actor.page.getByTestId(`time-project-${openProject.id}`),
				).toHaveText(openProject.name);
			}
			await expect(
				member.page.getByTestId(`time-project-${privateProject.id}`),
			).toHaveText(privateProject.name);
			await expect(
				outsider.page.getByTestId(`time-project-${privateProject.id}`),
			).toHaveCount(0);
		});

		await test.step("outsider cannot select the private project or submit a booking for it", async () => {
			const page = outsider.page;
			await page.goto("/time");
			await page.getByTestId("time-log-open").click();
			const dialog = page.getByTestId("time-log-modal");
			const picker = dialog.locator("#time-log-project");
			await picker.click();
			await expect(
				page.getByTestId(`time-log-project-option-${openProject.id}`),
			).toBeVisible();
			await expect(
				page.getByTestId(`time-log-project-option-${privateProject.id}`),
			).toHaveCount(0);
			await picker.fill(privateProject.name);
			await expect(page.getByTestId(/^time-log-project-option-/)).toHaveCount(
				0,
			);
			await dialog
				.locator("#time-log-description")
				.fill("Denied private booking");
			await dialog.locator("#time-log-duration").fill("30m");
			await expect(dialog.getByTestId("dialog-confirm")).toBeDisabled();
			await dialog.getByTestId("dialog-cancel").click();
		});

		await test.step("member books time and the saved project, date, duration and description survive reload", async () => {
			const page = member.page;
			await page.goto("/time");
			const saved = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" &&
					new URL(response.url()).pathname.endsWith("/api/v2/time/worklogs"),
			);
			const description = `Member private booking ${suffix}`;
			await new TimeTrackingPage(page).logTime({
				project: privateProject.name,
				description,
				duration: "30m",
				date: "2026-09-08",
			});
			// Capture the created ID solely to clean up the booking through the API.
			const worklog = (await (await saved).json()).data;
			cleanupPaths.unshift(`/api/v2/time/worklogs/${worklog.id}`);
			await page.goto("/m/timer");
			await page.reload();
			const entry = page.getByTestId("worklog-edit");
			await expect(entry).toHaveCount(1);
			await expect(entry).toContainText(description);
			await entry.click();
			const dialog = page.getByTestId("time-log-modal");
			await expect(dialog.locator("#time-log-project")).toHaveValue(
				privateProject.name,
			);
			await expect(dialog.locator("#time-log-description")).toHaveValue(
				description,
			);
			await expect(dialog.locator("#time-log-duration")).toHaveValue("30m");
			await expect(dialog.locator("#time-log-date")).toHaveValue("2026-09-08");
		});
	} finally {
		for (const context of contexts) await context.close();
		for (const path of cleanupPaths) {
			const response = await request.delete(path, { headers });
			expect(
				response.ok(),
				`cleanup ${path}: ${response.status()} ${await response.text()}`,
			).toBeTruthy();
		}
	}
});
