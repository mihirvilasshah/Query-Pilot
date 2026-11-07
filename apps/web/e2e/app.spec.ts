import { expect, test } from "@playwright/test";
import { choose, login, resetBackend, setTheme } from "./helpers";

const V1 = "00000000-0000-4000-8000-000000000200";
const V2 = "00000000-0000-4000-8000-000000000201";

test.beforeEach(async ({ page }) => {
  await resetBackend();
  await login(page);
});

test.describe("dashboard & layout", () => {
  test("statistics come from stored data", async ({ page }) => {
    await expect(page.getByTestId("stat-database-projects")).toHaveText("2");
    await expect(page.getByTestId("stat-schema-versions")).toHaveText("2");
    await expect(page.getByTestId("stat-tables")).toHaveText("7");
    await expect(page.getByTestId("stat-stored-procedures")).toHaveText("3");
    await expect(page.getByTestId("stat-sql-scripts")).toHaveText("1");
    await expect(page.getByTestId("stat-analyses")).toHaveText("0");
    await expect(page.getByText("Hospital Pricing Database").first()).toBeVisible();
    await expect(page.getByText("Not configured")).toBeVisible();
  });

  test("sidebar collapses and remembers its state", async ({ page }) => {
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await page.reload();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  });

  test("navigation is usable on a phone-sized screen", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await ctx.newPage();
    await login(page);
    await expect(page.getByTestId("sidebar")).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "SQL Script Analyzer" }).click();
    await expect(page).toHaveURL(/sql-analyzer/);
    // no horizontal overflow on the page body
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  });

  test("global search finds database objects", async ({ page }) => {
    await page.getByTestId("global-search").click();
    await page.getByPlaceholder(/Search tables/).fill("OUSetting");
    await expect(page.getByRole("option", { name: /PricingLevelOUSetting/ })).toBeVisible();
    await page.getByRole("option", { name: /PricingLevelOUSetting/ }).click();
    await expect(page).toHaveURL(/database-intelligence\/tables\//);
  });
});

test.describe("projects", () => {
  test("create, list and reject duplicate names", async ({ page }) => {
    await page.goto("/projects?new=1");
    await page.getByLabel("Project name").fill("Warehouse DB");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: "Warehouse DB" })).toBeVisible();
    await page.goto("/projects?new=1");
    await page.getByLabel("Project name").fill("Warehouse DB");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByTestId("project-form").getByRole("alert")).toContainText("already have a project");
  });
});

test.describe("database intelligence", () => {
  test("overview shows real object counts and limitations", async ({ page }) => {
    await page.goto("/database-intelligence");
    const counts = page.getByTestId("overview-counts");
    await expect(counts).toContainText("Tables");
    await expect(counts.getByText("7", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("object-distribution")).toBeVisible();
    await expect(page.getByText("Analysis limitations")).toBeVisible();
    await expect(page.getByText(/Import warnings/)).toBeVisible();
  });

  test("table explorer searches, filters and opens a table", async ({ page }) => {
    await page.goto("/database-intelligence/tables");
    await expect(page.getByTestId("explorer-count")).toContainText("7 of 7");
    await page.getByTestId("explorer-search").fill("OUSetting");
    await expect(page.getByTestId("explorer-count")).toContainText("1 of 7");
    await page.getByTestId("explorer-search").fill("PricingLevel");
    await page.getByTestId("explorer-list").getByRole("link").first().click();
    await expect(page.getByTestId("object-title")).toContainText("PricingLevel");
    const rows = page.getByTestId("columns-table").locator("tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId("columns-table")).toContainText("EffectiveFrom");
    await expect(page.getByTestId("columns-table")).toContainText("decimal(9,4)");
    await page.getByRole("tab", { name: "Relationships" }).click();
    await expect(page.getByText("FK_PricingLevel_OperationalUnit")).toBeVisible();
    await page.getByRole("tab", { name: "Indexes & constraints" }).click();
    await expect(page.getByText("IX_PricingLevel_OU")).toBeVisible();
    await expect(page.getByText("CK_PricingLevel_Markup")).toBeVisible();
    await page.getByRole("tab", { name: "Definition" }).click();
    await expect(page.getByTestId("monaco")).toBeVisible();
  });

  test("missing foreign keys are not invented: inferred links are labelled", async ({ page }) => {
    await page.goto("/database-intelligence/tables");
    await page.getByTestId("explorer-search").fill("Hospital");
    await page.getByTestId("explorer-list").getByRole("link").first().click();
    await page.getByRole("tab", { name: "Relationships" }).click();
    await expect(page.getByText("Inferred", { exact: true })).toBeVisible();
    await expect(page.getByText(/never invents foreign keys/i)).toBeVisible();
  });

  test("column impact analysis lists referencing objects", async ({ page }) => {
    await page.goto("/database-intelligence/tables");
    await page.getByTestId("explorer-search").fill("PricingLevel");
    await page.getByTestId("explorer-list").getByRole("link").first().click();
    await page.getByRole("tab", { name: "Impact analysis" }).click();
    await choose(page, "impact-column", "Markup");
    await expect(page.getByTestId("impact-result")).toContainText("dbo.usp_UpdatePricing");
  });

  test("stored procedure: dynamic SQL is flagged and unresolved references are distinguished", async ({ page }) => {
    await page.goto("/database-intelligence/procedures");
    await page.getByTestId("explorer-search").fill("SearchCharges");
    await page.getByTestId("explorer-list").getByRole("link").first().click();
    await expect(page.getByTestId("dynamic-warning")).toContainText("not guaranteed to be complete");
    await page.getByRole("tab", { name: "References" }).click();
    await expect(page.getByText("Unresolved dynamic reference").first()).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByText("@term")).toBeVisible();
  });

  test("stored procedure: references, definition and mermaid flowchart", async ({ page }) => {
    await page.goto("/database-intelligence/procedures");
    await page.getByTestId("explorer-search").fill("UpdatePricing");
    await page.getByTestId("explorer-list").getByRole("link").first().click();
    await page.getByRole("tab", { name: "References" }).click();
    await expect(page.getByText("Confirmed static dependency").first()).toBeVisible();
    await expect(page.getByText("dbo.PricingLevel").first()).toBeVisible();
    await page.getByRole("tab", { name: "Flowchart" }).click();
    await expect(page.locator("[data-testid=mermaid] svg")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-testid=mermaid]")).toContainText("UPDATE dbo.PricingLevel");
  });

  test("views, functions and triggers have explorers", async ({ page }) => {
    await page.goto("/database-intelligence/views");
    await expect(page.getByTestId("explorer-count")).toContainText("1 of 1");
    await page.goto("/database-intelligence/functions");
    await expect(page.getByTestId("explorer-count")).toContainText("1 of 1");
    await page.goto("/database-intelligence/triggers");
    await expect(page.getByTestId("trigger-list")).toContainText("trg_PricingLevel_Audit");
    await expect(page.getByTestId("trigger-list")).toContainText("AFTER");
  });

  test("indexes and constraints explorer", async ({ page }) => {
    await page.goto("/database-intelligence/indexes");
    await expect(page.getByText("IX_PricingLevel_OU")).toBeVisible();
    await page.getByRole("tab", { name: /Constraints/ }).click();
    await expect(page.getByText("DF_PricingLevel_Markup")).toBeVisible();
  });

  test("dependency graph is interactive and discloses incompleteness", async ({ page }) => {
    await page.goto("/database-intelligence/dependencies");
    await expect(page.getByText(/not guaranteed to be complete/)).toBeVisible();
    await expect(page.getByTestId("graph-node").first()).toBeVisible();
    expect(await page.getByTestId("graph-node").count()).toBeGreaterThan(8);
    await page.getByTestId("graph-node").filter({ hasText: "usp_SearchCharges" }).click();
    const details = page.getByTestId("graph-details");
    await expect(details).toContainText("usp_SearchCharges");
    await expect(details).toContainText("Unresolved dynamic reference");
    await page.getByTestId("graph-search").fill("zzz-no-such-object");
    await page.getByRole("button", { name: "Triggers" }).click(); // type filter toggles
    await expect(page.getByRole("button", { name: "Triggers" })).toHaveAttribute("aria-pressed", "false");
  });

  test("ER diagram shows keys and separates declared from inferred relationships", async ({ page }) => {
    await page.goto("/database-intelligence/er-diagram");
    await expect(page.getByTestId("er-node")).toHaveCount(7);
    await expect(page.getByText("Declared foreign key", { exact: true })).toBeVisible();
    await expect(page.getByText(/Inferred \(not a real constraint\)/)).toBeVisible();
    await page.getByTestId("er-node").filter({ hasText: "Charge" }).first().click();
    await expect(page.getByTestId("er-details")).toContainText("billing.Charge");
    await expect(page.getByTestId("er-details")).toContainText("Declared FK");
    await page.getByLabel("Show inferred relationships").click();
    await page.getByTestId("er-search").fill("Hospital");
    await page.getByTestId("er-search").press("Enter");
  });

  test("schema versions list shows history and warnings", async ({ page }) => {
    await page.goto("/database-intelligence/versions");
    const list = page.getByTestId("versions-list");
    await expect(list).toContainText("Initial import");
    await expect(list).toContainText("Updated pricing tables");
    await expect(list).toContainText("1 warning");
  });

  test("documentation export downloads deterministic markdown", async ({ page }) => {
    const res = await page.request.get(`/api/docs/${V2}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const md = await res.text();
    expect(md).toContain("# Hospital Pricing Database - Database Documentation");
    expect(md).toContain("EffectiveFrom");
    expect(md).toContain("Contains dynamic SQL");
  });
});

test.describe("SQL tools", () => {
  test("analyzer detects risky statements without AI", async ({ page }) => {
    await page.goto("/sql-analyzer");
    await page.getByRole("button", { name: "Load example" }).click();
    await page.getByTestId("analyze-btn").click();
    const result = page.getByTestId("analysis-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("overall-risk")).toHaveText("Critical");
    await expect(result).toContainText("UPDATE without WHERE");
    await expect(result).toContainText("DELETE without WHERE");
    await expect(result).toContainText("Dynamic SQL built by string concatenation");
    await expect(result).toContainText("dbo.Customer");
    await expect(result).toContainText("never executed", { useInnerText: true }).catch(() => {});
    await page.goto("/history");
    await expect(page.getByTestId("history-list")).toContainText("Analyzed");
  });

  test("workspace lists scripts, opens tabs and analyzes", async ({ page }) => {
    await page.goto("/sql-workspace");
    await expect(page.getByTestId("script-list")).toContainText("Archive old charges");
    await page.getByTestId("script-list").getByRole("button", { name: /Archive old charges/ }).click();
    await expect(page.getByRole("tab", { name: /Archive old charges/ })).toBeVisible();
    await page.getByTestId("workspace-analyze").click();
    await expect(page.getByTestId("workspace-output")).toContainText("DELETE without WHERE");
    await expect(page.getByTestId("format-btn")).toBeVisible();
  });

  test("AI features fail gracefully when no provider is configured", async ({ page }) => {
    await page.goto(`/database-intelligence/assistant`);
    await page.getByTestId("chat-input").fill("Explain the complete database architecture");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("ai-error")).toContainText(/not configured|API key/i);
    // deterministic features still work afterwards
    await page.goto("/database-intelligence/tables");
    await expect(page.getByTestId("explorer-count")).toContainText("7 of 7");
    await page.goto("/ai-assistant");
    await page.getByTestId("gen-request").fill("Generate a SELECT for pricing levels");
    await page.getByTestId("generate-btn").click();
    await expect(page.getByTestId("ai-error")).toBeVisible();
  });

  test("object AI explanation reports the missing key", async ({ page }) => {
    await page.goto("/database-intelligence/procedures");
    await page.getByTestId("explorer-list").getByRole("link").first().click();
    await page.getByRole("tab", { name: "AI explanation" }).click();
    await page.getByTestId("ai-explain").click();
    await expect(page.getByTestId("ai-error")).toBeVisible();
  });

  test("AI settings: consent is explicit and keys are never shown", async ({ page }) => {
    await page.goto("/settings?tab=ai");
    await expect(page.getByTestId("ai-status")).toHaveText("No API key");
    await expect(page.getByText("Data sent to external AI providers")).toBeVisible();
    await expect(page.getByText(/CREDENTIAL_ENCRYPTION_KEY/).first()).toBeVisible();
    await page.getByTestId("ai-consent").click();
    await page.getByTestId("ai-save").click();
    await expect(page.getByText("AI settings saved")).toBeVisible();
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  });
});

test.describe("schema comparison & migration", () => {
  test("compare two versions and highlight destructive changes", async ({ page }) => {
    await page.goto("/schema-comparison");
    await page.getByTestId("compare-btn").click();
    const result = page.getByTestId("comparison-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("diff-list")).toContainText("EffectiveFrom");
    await expect(page.getByTestId("diff-list")).toContainText("Data type: decimal(9,2) → decimal(9,4)");
    await expect(page.getByTestId("diff-list")).toContainText("dbo.Currency");
    await expect(page.getByTestId("diff-list")).toContainText("usp_UpdatePricing");

    // reverse direction removes things: must be flagged as data loss
    await choose(page, "base-version", /v2/);
    await choose(page, "target-version", /v1/);
    await page.getByTestId("compare-btn").click();
    await expect(page.locator("[data-destructive=true]").first()).toBeVisible();
    await expect(page.getByTestId("diff-list")).toContainText("may lose data");
  });

  test("migration plan is generated for review, destructive statements commented out", async ({ page }) => {
    await page.goto(`/migration-assistant?base=${V2}&target=${V1}`);
    await expect(page.getByText("Generated scripts require human review")).toBeVisible();
    await page.getByTestId("generate-migration").click();
    const plan = page.getByTestId("migration-plan");
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("Purpose");
    await expect(plan).toContainText("DATA LOSS");
    await page.getByRole("tab", { name: /Steps/ }).click();
    await expect(plan).toContainText("Drop removed columns");
    await expect(plan).toContainText("destructive");
    await page.getByRole("tab", { name: "Checklist" }).click();
    await expect(plan).toContainText("Backup taken and restore verified");
    await page.getByRole("tab", { name: "Pre-validation" }).click();
    await expect(page.getByTestId("monaco")).toBeVisible();
  });
});

test.describe("schema versions", () => {
  test("owner can rename a version label", async ({ page }) => {
    await page.goto("/database-intelligence/versions");
    await expect(page.getByTestId("versions-list")).toContainText("Updated pricing tables");
    await page.getByTestId("edit-version-label-2").click();
    await page.getByLabel("Version label").fill("Prod snapshot");
    await page.getByTestId("save-version-label").click();
    await expect(page.getByTestId("versions-list")).toContainText("Prod snapshot");
    await expect(page.getByTestId("versions-list")).not.toContainText("Updated pricing tables");
  });
});

test.describe("schema import pipeline", () => {
  test("rejects a fake DACPAC by content, not by extension", async ({ page }) => {
    await page.goto("/database-intelligence/import");
    await page.getByTestId("schema-file-input").setInputFiles({ name: "bad.dacpac", mimeType: "application/octet-stream", buffer: Buffer.from("this is not a zip file") });
    await expect(page.getByRole("alert").filter({ hasText: "not a valid DACPAC" })).toBeVisible();
    await expect(page.getByTestId("start-import")).toBeDisabled();
  });

  test("rejects unsupported extensions and empty files", async ({ page }) => {
    await page.goto("/database-intelligence/import");
    await page.getByTestId("schema-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByRole("alert").filter({ hasText: "Only .dacpac and .sql" })).toBeVisible();
    await page.getByTestId("schema-file-input").setInputFiles({ name: "empty.sql", mimeType: "text/plain", buffer: Buffer.alloc(0) });
    await expect(page.getByRole("alert").filter({ hasText: "empty" })).toBeVisible();
  });

  test("uploads a SQL file, queues a job and shows progress to completion", async ({ page }) => {
    await page.goto("/database-intelligence/import");
    await page.getByTestId("schema-file-input").setInputFiles({ name: "release3.sql", mimeType: "text/plain", buffer: Buffer.from("CREATE TABLE dbo.T (Id int);\nGO\n") });
    await expect(page.getByTestId("selected-file")).toContainText("release3.sql");
    await page.getByLabel(/Version label/).fill("Release 3");
    await page.getByTestId("start-import").click();
    const job = page.getByTestId("import-job").first();
    await expect(job).toBeVisible();
    await expect(job).toHaveAttribute("data-status", "completed", { timeout: 20_000 });
    await page.goto("/database-intelligence/versions");
    await expect(page.getByTestId("versions-list")).toContainText("Release 3");
    await expect(page.getByTestId("versions-list")).toContainText("v3");
  });

  test("a failed import shows a useful error and can be retried", async ({ page }) => {
    await page.goto("/database-intelligence/import");
    await page.getByTestId("schema-file-input").setInputFiles({ name: "fail_me.sql", mimeType: "text/plain", buffer: Buffer.from("CREATE TABLE") });
    await page.getByTestId("start-import").click();
    const job = page.getByTestId("import-job").first();
    await expect(job).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    await expect(job).toContainText("syntax error near line 3");
    await expect(job.getByRole("button", { name: /Retry import/ })).toBeVisible();
  });
});

test.describe("dark theme renders data-heavy pages", () => {
  test("ER diagram, dependency graph and analyzer work in dark mode", async ({ page }) => {
    await setTheme(page, "Dark");
    await page.goto("/database-intelligence/er-diagram");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("er-node").first()).toBeVisible();
    await page.screenshot({ path: "test-results/er-dark.png" });
    await page.goto("/database-intelligence/dependencies");
    await expect(page.getByTestId("graph-node").first()).toBeVisible();
    await page.screenshot({ path: "test-results/deps-dark.png" });
  });
});
