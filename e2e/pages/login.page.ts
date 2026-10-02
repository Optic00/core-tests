import { expect, type Page } from "../fixtures/context-path";

/**
 * Page Object for the Login Dialog
 */
export class LoginPage {
	constructor(private page: Page) {}

	// Selectors
	readonly loginDialog = "#emailOrUsername";
	readonly usernameInput = "#emailOrUsername";
	readonly passwordInput = "#password";
	readonly loginButton = 'button[type="submit"]';
	readonly errorMessage = '.error, .error-message, [role="alert"]';

	/**
	 * Navigate to the login page (the login form renders at "/"). Wait for
	 * the boot-time /api/auth/me round trip: fills that land before it are
	 * wiped when the app re-renders the form after the auth check.
	 */
	async goto() {
		const boot = this.page
			.waitForResponse((res) => res.url().includes("/api/auth/me"), { timeout: 10000 })
			.catch(() => null);
		await this.page.goto("/");
		await boot;
	}

	/**
	 * Check if login dialog is visible
	 */
	async isLoginDialogVisible(): Promise<boolean> {
		try {
			await this.page.waitForSelector(
				`${this.passwordInput}, ${this.loginDialog}`,
				{
					timeout: 5000,
				},
			);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Fill in username
	 */
	async fillUsername(username: string) {
		await this.page.fill(this.usernameInput, username);
	}

	/**
	 * Fill in password
	 */
	async fillPassword(password: string) {
		await this.page.fill(this.passwordInput, password);
	}

	/**
	 * Toggle remember me / stay signed in checkbox
	 */
	async setRememberMe(checked: boolean) {
		const checkbox = this.page
			.getByTestId("login-remember-me")
			.locator('input[type="checkbox"]');
		if (checked) {
			await checkbox.check({ force: true });
		} else {
			await checkbox.uncheck({ force: true });
		}
	}

	/**
	 * Click login button
	 */
	async clickLogin() {
		await this.page.click(this.loginButton);
	}

	/**
	 * Fill both credential fields and confirm the form accepted them (submit
	 * enabled). The SPA can remount the form during boot and wipe values, so
	 * re-fill up to three times before giving up.
	 */
	async fillCredentials(username: string, password: string) {
		const submit = this.page.locator(this.loginButton);
		for (let attempt = 0; attempt < 3; attempt++) {
			await this.fillUsername(username);
			await this.fillPassword(password);
			try {
				await expect(submit).toBeEnabled({ timeout: 2000 });
				return;
			} catch {
				// remount wiped the values — fill again
			}
		}
		throw new Error("Login form never accepted the filled credentials");
	}

	/**
	 * Perform complete login
	 */
	async login(username: string, password: string, rememberMe: boolean = false) {
		await this.goto();

		// Wait for login dialog to appear
		const isVisible = await this.isLoginDialogVisible();
		if (!isVisible) {
			throw new Error("Login dialog did not appear");
		}

		await this.fillCredentials(username, password);

		if (rememberMe) {
			await this.setRememberMe(true);
		}

		await this.clickLogin();

		// Wait for login to complete — the login form disappears on success
		await this.page
			.locator(this.loginDialog)
			.waitFor({ state: "detached", timeout: 10000 })
			.catch(() => {});
	}

	/** Log in after navigation only when the application did not retain a session. */
	async loginIfNeeded(username: string, password: string) {
		await this.goto();
		if (!(await this.isLoginDialogVisible())) return;

		await this.fillUsername(username);
		await this.fillPassword(password);
		await this.clickLogin();
		await this.page
			.locator(this.loginDialog)
			.waitFor({ state: "detached", timeout: 10000 })
			.catch(() => {});
	}

	/**
	 * Verify successful login
	 */
	async verifyLoginSuccess() {
		const cookies = await this.page.context().cookies();
		const hasSession = cookies.some(
			(c) => c.name === "session" || c.name === "windshift_session",
		);
		expect(hasSession).toBeTruthy();

		// Login dialog should be gone
		await expect(this.page.locator(this.loginDialog)).not.toBeVisible({
			timeout: 10000,
		});
	}

	/**
	 * Verify login failed
	 */
	async verifyLoginFailed() {
		await expect(this.page.locator(this.errorMessage)).toBeVisible({
			timeout: 5000,
		});
	}

	/**
	 * Get error message text
	 */
	async getErrorMessage(): Promise<string> {
		const errorElement = this.page.locator(this.errorMessage).first();
		return (await errorElement.textContent()) || "";
	}

	/**
	 * Logout (via user avatar menu)
	 */
	async logout() {
		// Click the user avatar menu trigger button
		await this.page
			.locator('[data-testid="user-avatar-menu"] button')
			.first()
			.click();

		// Wait for and click the Sign out menu item
		const signOutBtn = this.page.getByRole("menuitem", { name: /sign out/i });
		await signOutBtn.waitFor({ state: "visible", timeout: 5000 });
		await signOutBtn.click();

		// Wait for logout — the login form reappears when the session is gone
		await this.page
			.locator(this.loginDialog)
			.waitFor({ state: "visible", timeout: 10000 });
	}

	/**
	 * Verify logout success
	 */
	async verifyLogoutSuccess() {
		const isVisible = await this.isLoginDialogVisible();
		expect(isVisible).toBeTruthy();
	}
}
