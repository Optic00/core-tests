import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from './context-path';
import { createUserViaAPI } from './api-helpers';

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

export interface ArabicSession {
	context: BrowserContext;
	page: Page;
	userId: number;
}

/**
 * Create a dedicated Arabic-language user with a role on the workspace and a
 * logged-in browser context. Language is user-profile state; switching the
 * shared admin's language races every parallel spec that asserts English
 * strings, so language-switching tests must use their own user.
 *
 * The caller owns the returned context (close it when done).
 */
export async function createArabicSession(
	request: APIRequestContext,
	browser: Browser,
	workspaceId: number,
	label: string,
	workspaceRole = 'Viewer'
): Promise<ArabicSession> {
	const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	const username = `ar${label}${nonce}`.slice(0, 32);
	const user = await createUserViaAPI(request, {
		email: `${username}@e2e.local`,
		username,
		first_name: 'Arabic',
		last_name: label,
		password_hash: `pass-${nonce}-${label}`,
	});

	const rolesResp = await request.get('/api/workspace-roles', { headers: SEC_FETCH });
	expect(rolesResp.ok()).toBeTruthy();
	const rolesBody = (await rolesResp.json()) as {
		data?: Array<{ id: number; name: string }>;
	};
	const roles = rolesBody.data ?? (rolesBody as unknown as Array<{ id: number; name: string }>);
	const role = roles.find((candidate) => candidate.name === workspaceRole);
	expect(role, `workspace role ${workspaceRole} not found`).toBeDefined();
	const assign = await request.post('/api/workspace-roles/assign', {
		headers: SEC_FETCH,
		data: { user_id: user.id, workspace_id: workspaceId, role_id: role!.id },
	});
	expect(assign.ok(), `assign role failed: ${assign.status()}`).toBeTruthy();

	const context = await browser.newContext({
		baseURL: BASE_URL,
		storageState: { cookies: [], origins: [] },
	});
	const login = await context.request.post('/api/auth/login', {
		headers: SEC_FETCH,
		data: {
			email_or_username: username,
			password: `pass-${nonce}-${label}`,
			remember_me: false,
		},
	});
	expect(login.ok(), `login as ${username} failed: ${login.status()}`).toBeTruthy();

	// The user sets their own language; the app applies it on next boot.
	const put = await context.request.put(`/api/users/${user.id}/regional-settings`, {
		headers: { 'Content-Type': 'application/json' },
		data: { timezone: 'UTC', language: 'ar' },
	});
	expect(put.ok(), `set language failed: ${put.status()} (${await put.text()})`).toBeTruthy();

	// The session validation cache serves the pre-change snapshot for up to
	// 5s — poll until the session reflects Arabic.
	await expect
		.poll(async () => {
			const me = await (await context.request.get('/api/auth/me')).json();
			const profile = (me.data?.user ?? me.user ?? me) as { language?: string };
			return profile.language;
		}, { timeout: 20000 })
		.toBe('ar');

	const page = await context.newPage();
	return { context, page, userId: user.id };
}
