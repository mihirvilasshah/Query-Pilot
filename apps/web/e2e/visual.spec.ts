import { test } from "@playwright/test";
import { choose, login, resetBackend, setTheme } from "./helpers";

// Captures screenshots for manual visual review (test-results/visual/*). Assertions live in app.spec.ts.
test.describe("visual review captures", () => {
  test.beforeEach(async ({ page }) => {
    await resetBackend();
    await login(page);
  });

  for (const theme of ["Light", "Dark"] as const) {
    test(`pages in ${theme} theme`, async ({ page }) => {
      await setTheme(page, theme);
      const shot = async (name: string) => page.screenshot({ path: `test-results/visual/${theme.toLowerCase()}-${name}.png` });
      await page.goto("/dashboard");
      await shot("dashboard");
      await page.goto("/database-intelligence");
      await page.waitForTimeout(500);
      await shot("overview");
      await page.goto("/database-intelligence/tables");
      await page.getByTestId("explorer-list").getByRole("link").first().click();
      await page.waitForTimeout(800);
      await shot("table-detail");
      await page.goto("/sql-analyzer");
      await page.getByRole("button", { name: "Load example" }).click();
      await page.getByTestId("analyze-btn").click();
      await page.getByTestId("analysis-result").waitFor();
      await shot("analyzer");
      await page.goto("/schema-comparison");
      await page.getByTestId("compare-btn").click();
      await page.getByTestId("comparison-result").waitFor();
      await shot("comparison");
      await page.goto("/sql-workspace");
      await page.getByTestId("script-list").getByRole("button", { name: /Archive/ }).click();
      await page.waitForTimeout(1500);
      await shot("workspace");
      await page.goto("/database-intelligence/er-diagram");
      await page.waitForTimeout(800);
      await shot("er");
      await page.goto("/settings?tab=ai");
      await shot("settings-ai");
      void choose;
    });
  }

  test("mobile captures", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await ctx.newPage();
    await login(page);
    await page.screenshot({ path: "test-results/visual/mobile-dashboard.png" });
    await page.goto("/database-intelligence/tables");
    await page.screenshot({ path: "test-results/visual/mobile-tables.png" });
    await ctx.close();
  });
});
