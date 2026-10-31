import { expect, test } from "@playwright/test";
import { DEMO, login, resetBackend, setTheme } from "./helpers";

test.beforeEach(async () => {
  await resetBackend();
});

test.describe("authentication & route protection", () => {
  test("unauthenticated visitors are sent to the sign-in page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.goto("/database-intelligence/tables");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong credentials show a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("login-form").getByRole("alert")).toContainText("Invalid email or password");
  });

  test("registration validates the password policy", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Name").fill("Ada");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("weak");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/at least 10 characters/i).first()).toBeVisible();
  });

  test("password reset never reveals whether an account exists", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
  });

  test("open redirects through ?next= are ignored", async ({ page }) => {
    await page.goto("/login?next=//evil.example.com");
    await page.getByLabel("Email").fill(DEMO.email);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:3100\/dashboard/);
  });

  test("sign out returns to the login page and protects routes again", async ({ page }) => {
    await login(page);
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("themes", () => {
  test("theme toggle switches and persists across reloads (login page)", async ({ page }) => {
    await page.goto("/login");
    await setTheme(page, "Dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await setTheme(page, "Light");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("first visit follows the operating system theme", async ({ browser }) => {
    const dark = await browser.newContext({ colorScheme: "dark" });
    const p1 = await dark.newPage();
    await p1.goto("http://127.0.0.1:3100/login");
    await expect(p1.locator("html")).toHaveClass(/dark/);
    await dark.close();
    const light = await browser.newContext({ colorScheme: "light" });
    const p2 = await light.newPage();
    await p2.goto("http://127.0.0.1:3100/login");
    await expect(p2.locator("html")).not.toHaveClass(/dark/);
    await light.close();
  });

  test("design tokens produce different surfaces in light and dark", async ({ page }) => {
    await login(page);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await setTheme(page, "Light");
    const light = await bg();
    await setTheme(page, "Dark");
    await expect.poll(bg).not.toBe(light);
  });
});
