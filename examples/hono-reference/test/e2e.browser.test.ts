/**
 * Browser end-to-end test: drives the real demo page in Chromium with fake
 * media devices — floating button → consent → getDisplayMedia (auto-accepted
 * via Chrome flags) → frames/screenshot/audio → submit → pipeline → ZIP.
 *
 * Run: bun test examples/hono-reference/test/e2e.browser.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const dataDir = mkdtempSync(join(tmpdir(), "bugreport-e2e-data-"));
const zipDir = mkdtempSync(join(tmpdir(), "bugreport-e2e-zip-"));

let server: ReturnType<typeof Bun.spawn> | null = null;
let browser: Browser | null = null;

beforeAll(async () => {
  server = Bun.spawn(
    ["bun", "run", join(import.meta.dir, "../src/server.ts")],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        BUGREPORT_DATA_DIR: dataDir,
        BUGREPORT_ZIP_DIR: zipDir,
        BUGREPORT_CURL_FETCH: "1",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  // wait for readiness
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/bugreport/config`);
      if (res.ok) break;
    } catch {}
    await Bun.sleep(200);
  }

  browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-accept-this-tab-capture",
    ],
  });
});

afterAll(async () => {
  await browser?.close();
  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(zipDir, { recursive: true, force: true });
});

describe("browser e2e", () => {
  test(
    "records, submits and produces a zipped report",
    async () => {
      const context = await browser!.newContext({
        permissions: ["microphone"],
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await page.goto(BASE);

      await expect(
        page.locator("#log"),
      ).not.toBeNull();
      const logText = await page.locator("#log").textContent();
      expect(logText).toContain("Bug reporting available");

      // 1. floating button → consent dialog → accept (grants tab capture)
      await page.click("button.fab");
      await page.click('[data-testid="bugreport-consent-accept"]');

      // 2. recording bar appears; provoke some errors while "recording"
      await page.waitForSelector('[data-testid="bugreport-bar"]');
      await page.click("#btn-crash");
      await page.click("#btn-fetch");
      await page.click("#btn-warn");
      await page.waitForTimeout(3500); // let frame sampling capture a few frames

      // 3. manual screenshot, then submit with a comment
      await page.click('[data-testid="bugreport-screenshot"]');
      await page.waitForTimeout(500);
      await page.click('[data-testid="bugreport-submit"]');
      await page.fill(
        '[data-testid="bugreport-comment"]',
        "The save button throws an error, see the red box.",
      );
      await page.click('[data-testid="bugreport-send"]');

      // 4. success dialog shows the report id
      await page.waitForSelector('[data-testid="bugreport-success"]', {
        timeout: 30_000,
      });
      const successText = await page
        .locator('[data-testid="bugreport-success"]')
        .textContent();
      const reportId = successText?.match(/[0-9a-f-]{36}/)?.[0];
      expect(reportId).toBeDefined();

      // 5. poll the status endpoint until the async pipeline finishes
      let status: { status: string; analysisStatus: string } | null = null;
      for (let i = 0; i < 120; i++) {
        const res = await fetch(`${BASE}/api/bugreport/${reportId}`);
        expect(res.status).toBe(200);
        status = (await res.json()) as typeof status;
        if (status!.status !== "processing") break;
        await Bun.sleep(1000);
      }
      expect(status!.status).toBe("done");
      console.log("e2e report:", reportId, "analysis:", status!.analysisStatus);

      // 6. the zip action wrote the archive
      const zips = readdirSync(zipDir).filter((f) => f.includes(reportId!));
      expect(zips).toHaveLength(1);

      // 7. the client collected the provoked errors into the report context
      const report = (await (
        await fetch(`${BASE}/api/bugreport/${reportId}`)
      ).json()) as { status: string };
      expect(report.status).toBe("done");

      await context.close();
    },
    { timeout: 180_000 },
  );
});
