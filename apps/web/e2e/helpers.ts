import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@querypilot.test", password: "DemoPassw0rd1" };

export async function resetBackend() {
  await fetch("http://127.0.0.1:54329/__reset");
}

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function setTheme(page: Page, name: "Light" | "Dark" | "System") {
  await page.getByTestId("theme-toggle").click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.getByRole("menu")).toBeHidden();
}

/** Chooses an option in a Radix <Select> identified by its test id or accessible name. */
export async function choose(page: Page, trigger: string, option: RegExp | string) {
  await page.getByTestId(trigger).click();
  await page.getByRole("option", { name: option }).click();
}
