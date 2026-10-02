import {
	createUserViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { type APIRequestContext, expect, test } from "../fixtures/context-path";
import { generateUser, generateWorkspace } from "../fixtures/test-data";

/**
 * Knowledge Pages — workspace page.* permission affordance gating (WI-789).
 *
 * The default roles carry: Viewer → page.view; Editor → page.view/create/
 * edit; Administrator → all five page keys. The server enforces the write
 * contract (page_application_service.go); this spec pins both the exact
 * HTTP denial codes and the browser-visible affordances that must appear
 * or disappear for each role.
 *
 * Serial: all tests share the workspace, users, and seed page created in
 * beforeAll; assertions remain independent per test.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";

interface RoleUser {
	username: string;
	password: string;
	userId: number;
}

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
		`role assign failed (status ${resp.status()})`,
	).toBeTruthy();
}

/**
 * Browser context authenticated as the given user. Storage state starts
 * empty so each role gets its own cookie jar.
 */
async function loggedInPage(
	browser: import("@playwright/test").Browser,
	user: RoleUser,
): Promise<{ page: import("@playwright/test").Page; request: APIRequestContext; close: () => Promise<void> }> {
	const ctx = await browser.newContext({
		baseURL: BASE_URL,
		storageState: { cookies: [], origins: [] },
	});
	await loginAs(ctx.request, user.username, user.password);
	const page = await ctx.newPage();
	return {
		page,
		request: ctx.request,
		close: () => ctx.close(),
	};
}

test.describe("Knowledge Pages — permission affordance gating", () => {
	test.describe.configure({ mode: "serial" });

	let workspaceId: number;
	let pageId: number;
	const users: Record<"viewer" | "editor" | "admin", RoleUser | null> = {
		viewer: null,
		editor: null,
		admin: null,
	};

	test.beforeAll(async ({ request: adminRequest }) => {
		const wsData = generateWorkspace(`page-gating-${Date.now()}`);
		const ws = await createWorkspaceViaAPI(adminRequest, wsData);
		workspaceId = ws.id;

		// Assigning an explicit role flips the workspace into gated mode,
		// so each user's effective page.* set is exactly their role's.
		for (const [roleName, key] of [
			["Viewer", "viewer"],
			["Editor", "editor"],
			["Administrator", "admin"],
		] as const) {
			const userData = generateUser(`pgate-${key}-${Date.now()}`);
			const user = await createUserViaAPI(adminRequest, userData);
			const roleId = await getRoleIdByName(adminRequest, roleName);
			await assignWorkspaceRole(adminRequest, user.id, ws.id, roleId);
			users[key] = {
				username: userData.username,
				password: userData.password_hash,
				userId: user.id,
			};
		}

		const resp = await adminRequest.post(
			`/api/v2/workspaces/${workspaceId}/pages`,
			{
				headers: SEC_FETCH,
				data: { title: "Gating runbook", content: "# Gating runbook" },
			},
		);
		expect(resp.ok(), "seed page create failed").toBeTruthy();
		pageId = (await resp.json()).data.id;
	});

	test("viewer: no create affordance, no row kebab, toolbar read-only; writes denied with 404", async ({
		browser,
	}) => {
		const viewer = users.viewer!;
		const session = await loggedInPage(browser, viewer);
		try {
			const { page, request } = session;
			await page.goto(`/workspaces/${workspaceId}/pages`);
			await expect(page.getByTestId(`page-tree-item-${pageId}`)).toBeVisible({
				timeout: 10_000,
			});

			// No page.create → header add button absent.
			await expect(page.locator("#pages-add-button")).toHaveCount(0);

			// page.view only → effective level is "view" → the row kebab has
			// no items and must not render.
			await page.getByTestId(`page-tree-item-${pageId}`).hover();
			await expect(
				page.getByTestId(`page-tree-item-${pageId}`).getByTestId("page-kebab"),
			).toHaveCount(0);

			// Toolbar keeps view-level entries (history) but must not offer
			// move, permissions, or archive.
			await page.goto(`/workspaces/${workspaceId}/pages/${pageId}`);
			await page.getByTestId("page-toolbar-kebab").click();
			await expect(page.getByTestId("page-menu-history")).toBeVisible();
			await expect(page.getByTestId("page-menu-move")).toHaveCount(0);
			await expect(page.getByTestId("page-menu-permissions")).toHaveCount(0);
			await expect(page.getByTestId("page-menu-archive")).toHaveCount(0);

			// Exact denial contract for every write path.
			const createResp = await request.post(
				`/api/v2/workspaces/${workspaceId}/pages`,
				{
					headers: SEC_FETCH,
					data: { title: "Nope", content: "", parent_id: null },
				},
			);
			expect(createResp.status()).toBe(404);

			const patchResp = await request.patch(
				`/api/v2/workspaces/${workspaceId}/pages/${pageId}`,
				{
					headers: { ...SEC_FETCH, "Content-Type": "application/merge-patch+json" },
					data: { title: "Renamed by viewer" },
				},
			);
			expect(patchResp.status()).toBe(404);

			const deleteResp = await request.delete(
				`/api/v2/workspaces/${workspaceId}/pages/${pageId}`,
				{ headers: SEC_FETCH },
			);
			expect(deleteResp.status()).toBe(404);

			// The page survives every denied write.
			const getResp = await request.get(
				`/api/v2/workspaces/${workspaceId}/pages/${pageId}`,
				{ headers: SEC_FETCH },
			);
			expect(getResp.ok()).toBeTruthy();
			expect((await getResp.json()).data.title).toBe("Gating runbook");
		} finally {
			await session.close();
		}
	});

	test("editor: create/edit affordances visible, admin affordances absent; archive and ACL denied with 404", async ({
		browser,
	}) => {
		const editor = users.editor!;
		const session = await loggedInPage(browser, editor);
		try {
			const { page, request } = session;
			await page.goto(`/workspaces/${workspaceId}/pages/${pageId}`);
			await expect(page.getByTestId(`page-tree-item-${pageId}`)).toBeVisible({
				timeout: 10_000,
			});

			// Editor holds page.create → header add button present.
			await expect(page.locator("#pages-add-button")).toBeVisible();

			// Effective level "edit": kebab offers add-child/rename/move but
			// neither permissions nor archive.
			const row = page.getByTestId(`page-tree-item-${pageId}`);
			await row.hover();
			// Scope to the row: the tree may hold several pages by now.
			await row.getByTestId("page-kebab").click();
			await expect(page.getByTestId("page-kebab-add-child")).toBeVisible();
			await expect(page.getByTestId("page-kebab-rename")).toBeVisible();
			await expect(page.getByTestId("page-kebab-move")).toBeVisible();
			await expect(page.getByTestId("page-kebab-permissions")).toHaveCount(0);
			await expect(page.getByTestId("page-kebab-archive")).toHaveCount(0);
			await page.keyboard.press("Escape");

			// Toolbar offers move but not permissions/archive.
			await page.getByTestId("page-toolbar-kebab").click();
			await expect(page.getByTestId("page-menu-move")).toBeVisible();
			await expect(page.getByTestId("page-menu-permissions")).toHaveCount(0);
			await expect(page.getByTestId("page-menu-archive")).toHaveCount(0);
			await page.keyboard.press("Escape");

			// Positive controls: create and title edit succeed for an editor.
			const createResp = await request.post(
				`/api/v2/workspaces/${workspaceId}/pages`,
				{
					headers: SEC_FETCH,
					data: { title: "Editor-made page", content: "", parent_id: null },
				},
			);
			expect(createResp.status()).toBe(201);

			const patchResp = await request.patch(
				`/api/v2/workspaces/${workspaceId}/pages/${pageId}`,
				{
					headers: { ...SEC_FETCH, "Content-Type": "application/merge-patch+json" },
					data: { title: "Gating runbook (edited)" },
				},
			);
			expect(patchResp.status()).toBe(200);

			// page.delete absent → archive denied; page.admin absent → ACL
			// grant denied. Both return the existence-hiding 404 contract.
			const deleteResp = await request.delete(
				`/api/v2/workspaces/${workspaceId}/pages/${pageId}`,
				{ headers: SEC_FETCH },
			);
			expect(deleteResp.status()).toBe(404);

			const grantResp = await request.post(
				`/api/v2/workspaces/${workspaceId}/pages/${pageId}/permissions`,
				{
					headers: SEC_FETCH,
					data: {
						principal_type: "user",
						principal_id: users.viewer!.userId,
						permission_level: "view",
					},
				},
			);
			expect(grantResp.status()).toBe(404);
		} finally {
			await session.close();
		}
	});

	test("admin: full affordance set including permissions and archive", async ({
		browser,
	}) => {
		const admin = users.admin!;
		const session = await loggedInPage(browser, admin);
		try {
			const { page } = session;
			await page.goto(`/workspaces/${workspaceId}/pages/${pageId}`);
			await expect(page.getByTestId(`page-tree-item-${pageId}`)).toBeVisible({
				timeout: 10_000,
			});

			await expect(page.locator("#pages-add-button")).toBeVisible();

			// Row kebab exposes the complete management set.
			const row = page.getByTestId(`page-tree-item-${pageId}`);
			await row.hover();
			// Scope to the row: the tree may hold several pages by now.
			await row.getByTestId("page-kebab").click();
			await expect(page.getByTestId("page-kebab-add-child")).toBeVisible();
			await expect(page.getByTestId("page-kebab-rename")).toBeVisible();
			await expect(page.getByTestId("page-kebab-move")).toBeVisible();
			await expect(page.getByTestId("page-kebab-permissions")).toBeVisible();
			await expect(page.getByTestId("page-kebab-archive")).toBeVisible();
			await page.keyboard.press("Escape");

			// Toolbar mirrors it.
			await page.getByTestId("page-toolbar-kebab").click();
			await expect(page.getByTestId("page-menu-move")).toBeVisible();
			await expect(page.getByTestId("page-menu-permissions")).toBeVisible();
			await expect(page.getByTestId("page-menu-archive")).toBeVisible();
		} finally {
			await session.close();
		}
	});
});
