/**
 * Integration test against the REAL provider APIs:
 *  - analysis via Vercel AI SDK + OpenRouter (vision model)
 *  - transcription via Mistral Voxtral
 *
 * Requires OPENROUTER_API_KEY and MISTRAL_API_KEY. Without them the test
 * exits early (reports still work — analysisStatus 'skipped' — but that path
 * is covered by the unit tests already).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { fnv1aHex, type BugReport } from "@symbiosika/bugreport-core";
import { createApp, CONSENT_TEXT } from "../src/server";
import { makePng, makeWav } from "./helpers";

const hasKeys = Boolean(
  process.env.OPENROUTER_API_KEY && process.env.MISTRAL_API_KEY,
);

const dataDir = mkdtempSync(join(tmpdir(), "bugreport-data-"));
const zipDir = mkdtempSync(join(tmpdir(), "bugreport-zip-"));

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(zipDir, { recursive: true, force: true });
});

describe.if(hasKeys)("hono example against real LLM APIs", () => {
  test(
    "full report flow: session → assets → submit → analysis → zip on disk",
    async () => {
      let resolveProcessed: (r: BugReport) => void;
      const processed = new Promise<BugReport>((r) => (resolveProcessed = r));
      const { app } = createApp({
        dataDir,
        zipDir,
        onReportProcessed: (r) => resolveProcessed(r),
      });

      // 1. open session
      const sessionRes = await app.request("/api/bugreport/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app: { id: "demo-app", version: "1.0.0", environment: "test" },
          reporter: { id: "u1", name: "Test User" },
          locale: "de",
        }),
      });
      expect(sessionRes.status).toBe(201);
      const { reportId } = (await sessionRes.json()) as { reportId: string };

      // 2. upload assets: a red "error banner" frame, a screenshot, audio
      const t0 = Date.now();
      const upload = async (
        bytes: Uint8Array,
        mime: string,
        kind: string,
        offsetMs: number,
      ) => {
        const form = new FormData();
        form.set("kind", kind);
        form.set("capturedAt", new Date(t0 + offsetMs).toISOString());
        form.set("file", new Blob([bytes as unknown as BlobPart], { type: mime }), "a");
        const res = await app.request(`/api/bugreport/${reportId}/asset`, {
          method: "PUT",
          body: form,
        });
        expect(res.status).toBe(201);
      };

      // white page with a red bar at the top (looks like an error banner)
      const framePng = makePng(320, 200, (_x, y) =>
        y < 30 ? [220, 38, 38] : [255, 255, 255],
      );
      // page with a blue header and a red button-ish rectangle
      const shotPng = makePng(320, 200, (x, y) => {
        if (y < 24) return [37, 99, 235];
        if (y > 150 && y < 180 && x > 100 && x < 220) return [220, 38, 38];
        return [245, 245, 245];
      });
      await upload(framePng, "image/png", "frame", 0);
      await upload(shotPng, "image/png", "screenshot", 4000);
      await upload(makeWav(2), "audio/wav", "audio", 8000);

      // 3. submit with realistic context
      const submitRes = await app.request(`/api/bugreport/${reportId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: {
            url: "https://demo.example.com/orders/42",
            route: "/orders/42",
            viewport: { width: 1440, height: 900, dpr: 2 },
            userAgent: "Mozilla/5.0 (Test)",
            locale: "de-DE",
            timezone: "Europe/Berlin",
            consoleEntries: [
              {
                level: "onerror",
                message: "TypeError: Cannot read properties of undefined (reading 'save')",
                stack: "at OrderForm.submit (orders.js:123)",
                at: new Date(t0 + 5000).toISOString(),
              },
            ],
            networkErrors: [
              {
                method: "POST",
                url: "https://demo.example.com/api/orders/42/save",
                status: 500,
                durationMs: 312,
                at: new Date(t0 + 5100).toISOString(),
              },
            ],
            breadcrumbs: [
              {
                type: "click",
                detail: "button#save-order",
                at: new Date(t0 + 4900).toISOString(),
              },
            ],
            custom: { tenant: "demo" },
          },
          userComment:
            "Beim Klick auf Speichern in der Bestellmaske stürzt die Seite ab, es erscheint ein roter Fehlerbalken.",
          consent: {
            acceptedAt: new Date().toISOString(),
            version: "1.0",
            textHash: fnv1aHex(CONSENT_TEXT),
          },
          durationMs: 10_000,
        }),
      });
      expect(submitRes.status).toBe(202);

      // 4. pipeline (real API calls: Mistral transcription + OpenRouter analysis)
      const report = await processed;

      expect(report.status).toBe("done");
      expect(report.analysisStatus).toBe("ok");
      expect(report.title.length).toBeGreaterThan(3);
      expect(report.summary.length).toBeGreaterThan(10);
      expect(report.confidence).toBeGreaterThan(0);
      expect(report.transcript).toBeDefined(); // beeps → likely empty text, but transcription ran
      expect(report.assets.filter((a) => a.usedInAnalysis).length).toBeGreaterThan(0);

      // 5. status endpoint reflects the result
      const statusRes = await app.request(`/api/bugreport/${reportId}`);
      expect(statusRes.status).toBe(200);
      const status = (await statusRes.json()) as { status: string; analysisStatus: string };
      expect(status.status).toBe("done");
      expect(status.analysisStatus).toBe("ok");

      // 6. the zip action wrote a complete archive to disk
      const zips = readdirSync(zipDir).filter((f) => f.endsWith(`${reportId}.zip`));
      expect(zips).toHaveLength(1);
      const zip = unzipSync(readFileSync(join(zipDir, zips[0]!)));
      expect(Object.keys(zip)).toContain("report.json");
      expect(Object.keys(zip)).toContain("report.md");
      expect(Object.keys(zip).filter((k) => k.startsWith("assets/"))).toHaveLength(3);
      const zippedReport = JSON.parse(strFromU8(zip["report.json"]!)) as BugReport;
      expect(zippedReport.id).toBe(reportId);
      expect(zippedReport.title).toBe(report.title);

      console.log("\n--- analysed report ---");
      console.log("title:     ", report.title);
      console.log("severity:  ", report.severitySuggestion);
      console.log("labels:    ", report.labels.join(", "));
      console.log("summary:   ", report.summary);
      console.log("steps:     ", report.stepsToReproduce.join(" | "));
      console.log("transcript:", JSON.stringify(report.transcript));
      console.log("zip:       ", join(zipDir, zips[0]!));
    },
    { timeout: 180_000 },
  );
});

test.if(!hasKeys)("skipped: OPENROUTER_API_KEY / MISTRAL_API_KEY not set", () => {
  expect(true).toBe(true);
});
