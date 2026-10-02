import {
	createUserViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { type APIRequestContext, expect, test } from "../fixtures/context-path";
import { generateUser, generateWorkspace } from "../fixtures/test-data";

/**
 * Pages nav visibility by workspace role (WI-1360).
 *
 * The Tester role holds no page.* permissions. In a gated workspace (any
 * explicit role assignment disables the "everyone" fallback), the Pages nav
 * entry used to render while Page list/GETs failed — a menu pointing at a
 * dead module. The nav entry is now gated on page.view; this spec pins the
 * browser-visible behavior for a Tester and a workspace admin.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";

async function loginAs(
	ctx: APIRequestContext,
	username: string,
	password: string,
): Promise<void> {
	const resp = await ctx.post("/api/auth/login", {
		headers: SEC_FETCH,
		data: { email_or_username: username, password, remember_me: false },
	});
	expect(
		resp.ok(),
		`login as ${username} failed (status ${resp.status()})`,
	).toBeTruthy();
}

async function getRoleIdByName(
	ctx: APIRequestContext,
	name: string,
): Promise<number> {
	const resp = await ctx.get("/api/workspace-roles", { headers: SEC_FETCH });
	expect(resp.ok()).toBeTruthy();
	const body = await resp.json();
	const roles: Array<{ id: number; name: string }> = body.data ?? body;
	const role = roles.find((r) => r.name === name);
	expect(role, `workspace role "${name}" not found`).toBeDefined();
	if (!role) throw new Error(`workspace role "${name}" not found`);
	return role.id;
}

async function assignWorkspaceRole(
	ctx: APIRequestContext,
	userId: number,
	workspaceId: number,
	roleId: number,
): Promise<void> {
	const resp = await ctx.post("/api/workspace-roles/assign", {
		headers: SEC_FETCH,
		data: { user_id: userId, workspace_id: workspaceId, role_id: roleId },
	});
	expect(
		resp.ok(),
		`role assign failed (status ${resp.status()}): ${await resp.text().catch(() => "")}`,
	).toBeTruthy();
}

test.describe("Pages nav visibility (WI-1360)", () => {
	test.describe.configure({ mode: "serial" });

	let workspaceId: number;
	let testerUsername: string;
	let testerPassword: string;

	test.beforeAll(async ({ request: adminRequest }) => {
		const wsData = generateWorkspace(`pages-nav-${Date.now()}`);
		const ws = await createWorkspaceViaAPI(adminRequest, wsData);
		workspaceId = ws.id;

		// Gate the workspace: an explicit Viewer assignment disables the
		// "everyone has Viewer+Editor" fallback (permission_cache_builder only
		// kills the fallback on explicit Viewer assignments). Without this a
		// Tester would still hold page.view through the fallback.
		const meResponse = await adminRequest.get("/api/auth/me", { headers: SEC_FETCH });
		expect(meResponse.ok()).toBeTruthy();
		const me = await meResponse.json();
		const viewerRoleId = await getRoleIdByName(adminRequest, "Viewer");
		await assignWorkspaceRole(adminRequest, me.user.id, ws.id, viewerRoleId);

		// The Tester role holds no page.* permissions, so a Tester in this
		// gated workspace has no page.view at all.
		const testerData = generateUser(`pgnv-${Date.now()}`);
		const tester = await createUserViaAPI(adminRequest, testerData);
		testerUsername = testerData.username;
		testerPassword = testerData.password_hash;
		const testerRoleId = await getRoleIdByName(adminRequest, "Tester");
		await assignWorkspaceRole(
			adminRequest,
			tester.id,
			ws.id,
			testerRoleId,
		);
	});

	test("tester in a gated workspace sees no Pages nav entry", async ({
		browser,
	}) => {
		const testerCtx = await browser.newContext({
			baseURL: BASE_URL,
			storageState: { cookies: [], origins: [] },
		});
		try {
			await loginAs(testerCtx.request, testerUsername, testerPassword);
			const testerPage = await testerCtx.newPage();
			await testerPage.goto(`/workspaces/${workspaceId}/board`);
			await expect(testerPage.getByTestId("workspace-nav-board")).toBeVisible({
				timeout: 15000,
			});
			await expect(testerPage.getByTestId("workspace-nav-pages")).toHaveCount(
				0,
			);
		} finally {
			await testerCtx.close();
		}
	});

	test("workspace admin still sees the Pages nav entry", async ({
		browser,
	}) => {
		const adminCtx = await browser.newContext({
			baseURL: BASE_URL,
			storageState: { cookies: [], origins: [] },
		});
		try {
			// The instance admin is a system admin, which the permission cache
			// treats as holding every workspace permission, page.view included.
			await loginAs(adminCtx.request, "admin", "TestPass123!");
			const adminPage = await adminCtx.newPage();
			await adminPage.goto(`/workspaces/${workspaceId}/board`);
			await expect(adminPage.getByTestId("workspace-nav-pages")).toBeVisible({
				timeout: 15000,
			});
		} finally {
			await adminCtx.close();
		}
	});
});
