import {
	type APIRequestContext,
	expect,
	externalPath,
	test,
} from "../fixtures/context-path";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };
const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const BASE_ORIGIN = process.env.BASE_ORIGIN || new URL(BASE_URL).origin;

function unique(label: string): string {
	return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function expectStatus(
	response: { status: () => number; text: () => Promise<string> },
	status: number,
	label: string,
): Promise<void> {
	if (response.status() !== status) {
		throw new Error(
			`${label}: expected ${status}, got ${response.status()} ${await response.text()}`,
		);
	}
}

async function deleteResource(
	request: APIRequestContext,
	path: string,
): Promise<void> {
	const response = await request.delete(path, { headers: SEC_FETCH });
	if (response.status() !== 204 && response.status() !== 404) {
		throw new Error(
			`cleanup ${path}: expected 204/404, got ${response.status()} ${await response.text()}`,
		);
	}
}

test.describe("browser authentication and consent lifecycles", () => {
	// Each test provisions unique users/credentials and cleans up in finally,
	// so the tests stay independent without serial ordering.

	test("invitation acceptance sets a password, activates the account, and permits login", async ({
		browser,
		request,
	}) => {
		const suffix = unique("invite");
		const username = suffix.slice(0, 48);
		const email = `${suffix}@example.test`;
		const password = "InvitedPass123!";
		let userID: number | undefined;

		const invite = await request.post("/api/users/invite", {
			headers: SEC_FETCH,
			data: {
				email,
				username,
				first_name: "Invited",
				last_name: "Browser User",
			},
		});
		await expectStatus(invite, 201, "invite user");
		const invitation = (await invite.json()) as {
			user: { id: number };
			token: string;
		};
		userID = invitation.user.id;

		const context = await browser.newContext({
			baseURL: BASE_URL,
			storageState: { cookies: [], origins: [] },
		});
		try {
			const page = await context.newPage();

			await page.goto("/set-password/not-a-valid-invitation");
			await expect(page.getByTestId("invitation-error")).toContainText(
				"Invalid Invitation",
			);

			await page.goto(`/set-password/${encodeURIComponent(invitation.token)}`);
			await expect(page.locator("#invitation-email")).toHaveValue(email);
			await expect(page.locator("#invitation-password")).toBeFocused();
			await page.locator("#invitation-password").fill(password);
			await page.locator("#invitation-confirm-password").fill(password);
			await page.getByTestId("invitation-activate").click();
			await expect(page.getByTestId("invitation-success")).toContainText(
				"Password Set!",
			);

			await page.getByTestId("invitation-login-now").click();
			await expect(page.getByTestId("login-dialog")).toBeVisible();
			await page.locator("#emailOrUsername").fill(username);
			const passkeyCheck = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/auth/webauthn/login/start") &&
					response.request().method() === "POST",
			);
			await page.locator("#password").click();
			await passkeyCheck;
			await page.locator("#password").fill(password);
			await page.getByTestId("login-submit").click();
			await expect(page.getByTestId("login-dialog")).not.toBeVisible();

			const sessionCookie = (await context.cookies()).find(
				(cookie) =>
					cookie.name === "session" || cookie.name === "windshift_session",
			);
			expect(
				sessionCookie,
				"accepted invitation should issue a browser session",
			).toBeDefined();
		} finally {
			await context.close();
			if (userID !== undefined) {
				await deleteResource(request, `/api/users/${userID}`);
			}
		}
	});

	test("internal passkey enrollment supports login verification and removal", async ({
		context,
		page,
	}) => {
		const credentialName = unique("browser-passkey");
		const cdp = await context.newCDPSession(page);
		await cdp.send("WebAuthn.enable", { enableUI: false });
		const authenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {
			options: {
				protocol: "ctap2",
				transport: "internal",
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
			},
		});

		try {
			await page.goto("/security");
			await expect(page.getByTestId("security-page")).toBeVisible();
			await page.getByTestId("security-add-credential").click();
			await expect(page.getByTestId("security-credential-modal")).toBeVisible();
			await page.locator("#credential-name").fill(credentialName);
			const registration = page.waitForResponse(
				(response) =>
					response.url().includes("/credentials/webauthn/register/complete") &&
					response.request().method() === "POST",
			);
			await page.getByTestId("security-register-credential").click();
			expect((await registration).ok()).toBeTruthy();
			await expect(
				page.getByTestId("security-credential-modal"),
			).not.toBeVisible();
			await expect
				.poll(async () =>
					page.getByTestId("security-credential-name").allTextContents(),
				)
				.toContain(credentialName);

			await context.clearCookies();
			await page.goto("/");
			await page.locator("#emailOrUsername").fill("admin");
			const availability = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/auth/webauthn/login/start") &&
					response.request().method() === "POST",
			);
			await page.locator("#password").click();
			expect((await availability).ok()).toBeTruthy();
			await expect(page.getByTestId("login-passkey")).toBeVisible();
			const login = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/auth/webauthn/login/complete") &&
					response.request().method() === "POST",
			);
			await page.getByTestId("login-passkey").click();
			expect((await login).ok()).toBeTruthy();
			await expect(page.getByTestId("login-dialog")).not.toBeVisible();

			const sessionCookie = (await context.cookies()).find(
				(cookie) =>
					cookie.name === "session" || cookie.name === "windshift_session",
			);
			expect(
				sessionCookie,
				"passkey login should issue a browser session",
			).toBeDefined();

			await page.goto("/security");
			await expect(page.getByTestId("security-page")).toBeVisible();
			await expect
				.poll(async () =>
					page.getByTestId("security-credential-name").allTextContents(),
				)
				.toContain(credentialName);
			const names = await page
				.getByTestId("security-credential-name")
				.allTextContents();
			const credentialIndex = names.indexOf(credentialName);
			expect(
				credentialIndex,
				"registered passkey should be listed",
			).toBeGreaterThanOrEqual(0);
			await page
				.getByTestId("security-credential-row")
				.nth(credentialIndex)
				.getByTestId("security-credential-remove")
				.click();
			await page.getByTestId("dialog-confirm").click();
			await expect
				.poll(async () =>
					page.getByTestId("security-credential-name").allTextContents(),
				)
				.not.toContain(credentialName);
		} finally {
			await cdp.send("WebAuthn.removeVirtualAuthenticator", {
				authenticatorId: authenticator.authenticatorId,
			});
			await cdp.send("WebAuthn.disable");
		}
	});

	test("OIDC cancel and invalid state return to a focused login with safe errors", async ({
		browser,
		request,
	}) => {
		const suffix = unique("oidc");
		const slug = suffix.slice(0, 48);
		let providerID: number | undefined;
		const created = await request.post("/api/sso/providers", {
			headers: SEC_FETCH,
			data: {
				slug,
				name: "Browser OIDC",
				provider_type: "oidc",
				enabled: true,
				is_default: true,
				issuer_url: "https://127.0.0.1:65534",
				client_id: "browser-client",
				client_secret: "browser-secret",
				scopes: "openid email profile",
				auto_provision_users: false,
				require_verified_email: true,
				attribute_mapping: "{}",
			},
		});
		await expectStatus(created, 201, "create OIDC provider");
		providerID = ((await created.json()) as { id: number }).id;

		const context = await browser.newContext({
			baseURL: BASE_URL,
			storageState: { cookies: [], origins: [] },
			serviceWorkers: "block",
		});
		try {
			let capturedRedirect = "";
			await context.route("**/api/sso/login/**", async (route) => {
				const loginURL = new URL(route.request().url());
				expect(
					loginURL.pathname.endsWith(`/api/sso/login/${slug}`),
				).toBeTruthy();
				capturedRedirect = loginURL.searchParams.get("redirect_uri") || "";
				const callback = new URL(
					externalPath(`/api/sso/callback/${slug}`),
					BASE_ORIGIN,
				);
				callback.searchParams.set("error", "access_denied");
				callback.searchParams.set("state", "cancelled-at-provider");
				await route.fulfill({
					status: 302,
					headers: { location: callback.toString() },
				});
			});
			const page = await context.newPage();

			await page.goto("/");
			await expect(page.getByTestId("login-sso")).toBeVisible();
			await page.getByTestId("login-sso").click();
			await expect(page.getByTestId("login-sso-error")).toContainText(
				"Access was denied by the identity provider",
			);
			expect(capturedRedirect).toBe("/");
			await expect(page.locator("#emailOrUsername")).toBeFocused();

			const invalidCallback = new URL(
				externalPath(`/api/sso/callback/${slug}`),
				BASE_ORIGIN,
			);
			invalidCallback.searchParams.set("code", "untrusted-code");
			invalidCallback.searchParams.set("state", "not-a-stored-state");
			await page.goto(invalidCallback.toString());
			await expect(page.getByTestId("login-sso-error")).toContainText(
				"Login session expired",
			);
			await expect(page.locator("#emailOrUsername")).toBeFocused();
		} finally {
			await context.close();
			if (providerID !== undefined) {
				await deleteResource(request, `/api/sso/providers/${providerID}`);
			}
		}
	});

	test("OAuth consent displays and grants only requested scopes on deny and approve", async ({
		page,
		request,
	}) => {
		const suffix = unique("oauth");
		const redirectURI = new URL(
			externalPath("/oauth-e2e-callback"),
			BASE_ORIGIN,
		).toString();
		let clientID: number | undefined;
		const created = await request.post("/api/admin/oauth-clients", {
			headers: SEC_FETCH,
			data: {
				slug: suffix.slice(0, 48),
				display_name: "Browser OAuth Client",
				client_type: "confidential",
				redirect_uris: [redirectURI],
				allowed_scopes: ["items:read", "workspaces:read"],
				enabled: true,
			},
		});
		await expectStatus(created, 201, "create OAuth client");
		const client = (await created.json()) as { id: number; client_id: string };
		clientID = client.id;

		const authorizeURL = (state: string) => {
			const params = new URLSearchParams({
				client_id: client.client_id,
				redirect_uri: redirectURI,
				response_type: "code",
				scope: "items:read",
				state,
			});
			return `/oauth/authorize?${params.toString()}`;
		};

		try {
			await page.goto(authorizeURL("deny-state"));
			await expect(page.getByTestId("consent-page")).toBeVisible();
			await expect(page.getByTestId("consent-scope")).toHaveCount(1);
			await expect(page.getByTestId("consent-scope")).toContainText(
				"items:read",
			);
			await page.getByTestId("consent-deny").click();
			await page.waitForURL((url) => {
				return (
					url.pathname.endsWith("/oauth-e2e-callback") &&
					url.searchParams.get("error") === "access_denied" &&
					url.searchParams.get("state") === "deny-state"
				);
			});

			await page.goto(authorizeURL("approve-state"));
			await expect(page.getByTestId("consent-scope")).toHaveCount(1);
			await page.getByTestId("consent-allow").click();
			await page.waitForURL((url) => {
				return (
					url.pathname.endsWith("/oauth-e2e-callback") &&
					Boolean(url.searchParams.get("code")) &&
					url.searchParams.get("state") === "approve-state"
				);
			});
		} finally {
			if (clientID !== undefined) {
				await deleteResource(request, `/api/admin/oauth-clients/${clientID}`);
			}
		}
	});
});
