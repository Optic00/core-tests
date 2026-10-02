import {
	expect,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page,
} from './context-path';
import { createUserViaAPI, createWorkspaceViaAPI } from './api-helpers';
import { generateUser, generateWorkspace } from './test-data';

/**
 * Fixtures for multi-user permission scenarios.
 *
 * A "gated" workspace is one where the everyone-Viewer fallback is disabled:
 * a throwaway gate user holds the seeded Viewer role, so every other user's
 * access comes only from their explicit role assignment (see
 * permission_cache.go — the fallback is only active while no user has the
 * Viewer role).
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

export type SeededRole = 'Viewer' | 'Editor' | 'Administrator' | 'Tester';

export interface SessionUser {
	id: number;
	username: string;
	password: string;
	/** Browser context carrying the user's session cookie. */
	context: BrowserContext;
	/** API context sharing the browser session cookie. */
	request: APIRequestContext;
	page: Page;
}

export interface GatedWorkspace {
	workspaceId: number;
	/** Every user created for this fixture (gate user + role users). */
	userIds: number[];
	sessions: SessionUser[];
	/** Sessions by the label given in the roles argument. */
	sessionsByLabel: Record<string, SessionUser>;
}

interface UserCredentials {
	id: number;
	username: string;
	password: string;
}

async function seededRoleId(
	request: APIRequestContext,
	role: SeededRole,
): Promise<number> {
	const resp = await request.get('/api/workspace-roles', {
		headers: SEC_FETCH,
	});
	expect(resp.ok(), `list workspace roles: ${resp.status()}`).toBeTruthy();
	const body = await resp.json();
	const roles = (body.data ?? body) as Array<{ id: number; name: string }>;
	const match = roles.find((r) => r.name === role);
	expect(match, `seeded role "${role}" missing`).toBeDefined();
	return match!.id;
}

export async function assignWorkspaceRole(
	request: APIRequestContext,
	userId: number,
	workspaceId: number,
	role: SeededRole,
): Promise<void> {
	const roleId = await seededRoleId(request, role);
	const resp = await request.post('/api/workspace-roles/assign', {
		headers: SEC_FETCH,
		data: { user_id: userId, workspace_id: workspaceId, role_id: roleId },
	});
	expect(
		resp.ok(),
		`assign ${role} to user ${userId}: ${resp.status()} ${await resp.text()}`,
	).toBeTruthy();
}

export async function createWorkspaceUser(
	adminRequest: APIRequestContext,
	suffix: string,
): Promise<UserCredentials> {
	const userData = generateUser(suffix);
	const user = await createUserViaAPI(adminRequest, userData);
	return {
		id: user.id,
		username: userData.username,
		password: userData.password_hash,
	};
}

/**
 * Log a user into a fresh browser context. The returned API request shares
 * the browser session cookie, so mutations made with it behave exactly like
 * the user's own tab. Call after all role assignments so the first page load
 * sees the final permission profile.
 */
export async function openSession(
	browser: Browser,
	user: UserCredentials,
): Promise<SessionUser> {
	const context = await browser.newContext({
		storageState: { cookies: [], origins: [] },
		baseURL: BASE_URL,
	});
	const login = await context.request.post('/api/auth/login', {
		headers: SEC_FETCH,
		data: {
			email_or_username: user.username,
			password: user.password,
			remember_me: false,
		},
	});
	expect(login.ok(), `login ${user.username}: ${login.status()}`).toBeTruthy();
	const page = await context.newPage();
	return { ...user, context, request: context.request, page };
}

/**
 * Create a gated workspace with one browser session per requested role. Each
 * user is created, assigned the role, and only then logged in, so no
 * re-login dance is needed.
 */
export async function createGatedWorkspaceWithSessions(
	adminRequest: APIRequestContext,
	browser: Browser,
	suffix: string,
	roles: Array<{ label: string; role: SeededRole }>,
): Promise<GatedWorkspace> {
	const workspace = await createWorkspaceViaAPI(
		adminRequest,
		generateWorkspace(suffix),
	);
	const userIds: number[] = [];

	// Gate user: disables the everyone-Viewer fallback for this workspace.
	const gateUser = await createWorkspaceUser(adminRequest, `${suffix}-gate`);
	userIds.push(gateUser.id);
	await assignWorkspaceRole(
		adminRequest,
		gateUser.id,
		workspace.id,
		'Viewer',
	);

	const sessions: SessionUser[] = [];
	const sessionsByLabel: Record<string, SessionUser> = {};
	for (const { label, role } of roles) {
		const user = await createWorkspaceUser(adminRequest, `${suffix}-${label}`);
		await assignWorkspaceRole(adminRequest, user.id, workspace.id, role);
		const session = await openSession(browser, user);
		userIds.push(user.id);
		sessions.push(session);
		sessionsByLabel[label] = session;
	}

	return { workspaceId: workspace.id, userIds, sessions, sessionsByLabel };
}

/**
 * Tear a gated workspace down: close browser contexts, delete the workspace
 * (cascades its content), then delete the users.
 */
export async function disposeGatedWorkspace(
	adminRequest: APIRequestContext,
	fixture: GatedWorkspace,
): Promise<void> {
	for (const session of fixture.sessions) {
		await session.context.close();
	}
	const deleted = await adminRequest.delete(
		`/api/v2/workspaces/${fixture.workspaceId}`,
		{ headers: SEC_FETCH },
	);
	expect(deleted.status(), `delete workspace: ${await deleted.text()}`).toBe(
		204,
	);
	for (const userId of fixture.userIds) {
		const resp = await adminRequest.delete(`/api/users/${userId}`, {
			headers: SEC_FETCH,
		});
		expect(resp.ok(), `delete user ${userId}: ${resp.status()}`).toBeTruthy();
	}
}
