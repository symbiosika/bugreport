import { describe, expect, test } from "bun:test";
import { fnv1aHex, type BugReportAnalysis } from "@symbiosika/bugreport-core";
import { createBugReportHandler } from "../src/handler";
import type { BugReportAction, LlmAdapter } from "../src/interfaces";
import { createMemoryStorage } from "./memory-storage";

const CONSENT = { version: "1.0", text: "Wir zeichnen deinen Bildschirm auf." };
const BASE = "http://test.local/api/bugreport";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const analysis: BugReportAnalysis = {
  title: "Crash on save",
  summary: "The save button throws.",
  stepsToReproduce: ["open page", "click save"],
  severitySuggestion: "high",
  labels: ["bug"],
  confidence: 0.8,
};

function mockLlm(overrides: Partial<LlmAdapter> = {}): LlmAdapter {
  return {
    async transcribe() {
      return { text: "hier ist der fehler", language: "de" };
    },
    async analyze() {
      return analysis;
    },
    ...overrides,
  };
}

function noopAction(results: string[] = []): BugReportAction {
  return {
    name: "noop",
    async run(report) {
      results.push(report.id);
      return { system: "noop", externalId: "TICKET-1", externalUrl: "https://x/1" };
    },
  };
}

const validContext = {
  url: "https://app.example.com/x",
  viewport: { width: 100, height: 100, dpr: 1 },
  userAgent: "test",
  locale: "de",
  timezone: "Europe/Berlin",
  consoleEntries: [],
  networkErrors: [],
  breadcrumbs: [],
};

function submitBody() {
  return {
    context: validContext,
    consent: {
      acceptedAt: new Date().toISOString(),
      version: CONSENT.version,
      textHash: fnv1aHex(CONSENT.text),
    },
  };
}

async function openSession(handler: (r: Request) => Promise<Response>) {
  const res = await handler(
    new Request(`${BASE}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: { id: "demo" } }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { reportId: string }).reportId;
}

async function uploadAsset(
  handler: (r: Request) => Promise<Response>,
  reportId: string,
  kind = "frame",
  bytes = new Uint8Array([1, 2, 3]),
  mime = "image/jpeg",
) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("capturedAt", new Date().toISOString());
  form.set("file", new Blob([bytes as unknown as BlobPart], { type: mime }), "f.jpg");
  return handler(
    new Request(`${BASE}/${reportId}/asset`, { method: "PUT", body: form }),
  );
}

describe("createBugReportHandler", () => {
  test("requires storage and at least one action", () => {
    expect(() =>
      // @ts-expect-error intentional misuse
      createBugReportHandler({ actions: [noopAction()], consent: CONSENT }),
    ).toThrow();
    expect(() =>
      createBugReportHandler({
        storage: createMemoryStorage(),
        actions: [],
        consent: CONSENT,
      }),
    ).toThrow();
  });

  test("GET /config returns public config without auth", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      auth: () => null, // everything else would 401
      logger: silentLogger,
    });
    const res = await handler(new Request(`${BASE}/config`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; consent: { text: string } };
    expect(body.enabled).toBe(true);
    expect(body.consent.text).toBe(CONSENT.text);
  });

  test("rejects unauthenticated session with 401", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      auth: () => null,
      logger: silentLogger,
    });
    const res = await handler(
      new Request(`${BASE}/session`, { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
  });

  test("enforces the per-user rate limit", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      limits: { ratePerUserPerHour: 2 },
      logger: silentLogger,
    });
    await openSession(handler);
    await openSession(handler);
    const res = await handler(
      new Request(`${BASE}/session`, {
        method: "POST",
        body: JSON.stringify({ app: { id: "demo" } }),
      }),
    );
    expect(res.status).toBe(429);
  });

  test("full flow: session → assets → submit → pipeline → action → status", async () => {
    const storage = createMemoryStorage();
    const actionCalls: string[] = [];
    let processed: Promise<void>;
    let resolveProcessed: () => void;
    processed = new Promise((r) => (resolveProcessed = r));
    const handler = createBugReportHandler({
      storage,
      llm: mockLlm(),
      actions: [noopAction(actionCalls)],
      consent: CONSENT,
      logger: silentLogger,
      onReportProcessed: () => resolveProcessed(),
    });

    const reportId = await openSession(handler);

    expect((await uploadAsset(handler, reportId, "frame")).status).toBe(201);
    expect((await uploadAsset(handler, reportId, "screenshot")).status).toBe(201);
    expect(
      (
        await uploadAsset(
          handler,
          reportId,
          "audio",
          new Uint8Array([9, 9]),
          "audio/webm",
        )
      ).status,
    ).toBe(201);

    const res = await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitBody()),
      }),
    );
    expect(res.status).toBe(202);

    await processed;

    const report = await storage.getReport(reportId);
    expect(report).not.toBeNull();
    expect(report!.status).toBe("done");
    expect(report!.analysisStatus).toBe("ok");
    expect(report!.title).toBe("Crash on save");
    expect(report!.transcript?.text).toBe("hier ist der fehler");
    expect(report!.assets).toHaveLength(3);
    expect(report!.assets.some((a) => a.usedInAnalysis)).toBe(true);
    expect(actionCalls).toEqual([reportId]);
    expect(report!.actionResults[0]?.externalId).toBe("TICKET-1");

    // status endpoint
    const statusRes = await handler(new Request(`${BASE}/${reportId}`));
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      status: string;
      externalUrl?: string;
    };
    expect(status.status).toBe("done");
    expect(status.externalUrl).toBe("https://x/1");
  });

  test("report survives an LLM failure with analysisStatus 'failed'", async () => {
    const storage = createMemoryStorage();
    const handler = createBugReportHandler({
      storage,
      llm: mockLlm({
        async analyze() {
          throw new Error("provider down");
        },
      }),
      actions: [noopAction()],
      consent: CONSENT,
      logger: silentLogger,
    });
    const reportId = await openSession(handler);
    await uploadAsset(handler, reportId);
    const res = await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        body: JSON.stringify(submitBody()),
      }),
    );
    expect(res.status).toBe(202);
    await handler.waitForPipelines();

    const report = await storage.getReport(reportId);
    expect(report!.status).toBe("done");
    expect(report!.analysisStatus).toBe("failed");
    expect(report!.title).toBe("");
    expect(report!.actionResults).toHaveLength(1); // action still ran
  });

  test("without llm the report is created with analysisStatus 'skipped'", async () => {
    const storage = createMemoryStorage();
    const handler = createBugReportHandler({
      storage,
      actions: [noopAction()],
      consent: CONSENT,
      logger: silentLogger,
    });
    const reportId = await openSession(handler);
    await uploadAsset(handler, reportId);
    await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        body: JSON.stringify(submitBody()),
      }),
    );
    await handler.waitForPipelines();
    const report = await storage.getReport(reportId);
    expect(report!.analysisStatus).toBe("skipped");
    expect(report!.status).toBe("done");
  });

  test("a throwing action does not break the report or later actions", async () => {
    const storage = createMemoryStorage();
    const calls: string[] = [];
    const handler = createBugReportHandler({
      storage,
      actions: [
        {
          name: "explodes",
          async run() {
            throw new Error("kaboom");
          },
        },
        noopAction(calls),
      ],
      consent: CONSENT,
      logger: silentLogger,
    });
    const reportId = await openSession(handler);
    await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        body: JSON.stringify(submitBody()),
      }),
    );
    await handler.waitForPipelines();
    const report = await storage.getReport(reportId);
    expect(report!.status).toBe("done");
    expect(report!.actionResults).toHaveLength(2);
    expect(report!.actionResults[0]?.error).toContain("kaboom");
    expect(calls).toEqual([reportId]);
  });

  test("rejects submit with wrong consent hash", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      logger: silentLogger,
    });
    const reportId = await openSession(handler);
    const body = submitBody();
    body.consent.textHash = "deadbeef";
    const res = await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(409);
  });

  test("rejects oversized and surplus assets", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      limits: { maxAssetBytes: 10, maxAssetsPerReport: 1 },
      logger: silentLogger,
    });
    const reportId = await openSession(handler);
    const big = await uploadAsset(handler, reportId, "frame", new Uint8Array(11));
    expect(big.status).toBe(413);
    expect((await uploadAsset(handler, reportId)).status).toBe(201);
    const surplus = await uploadAsset(handler, reportId);
    expect(surplus.status).toBe(413);
  });

  test("rejects uploads and re-submit after submit", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      logger: silentLogger,
    });
    const reportId = await openSession(handler);
    await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        body: JSON.stringify(submitBody()),
      }),
    );
    await handler.waitForPipelines();
    expect((await uploadAsset(handler, reportId)).status).toBe(409);
    const again = await handler(
      new Request(`${BASE}/${reportId}/submit`, {
        method: "POST",
        body: JSON.stringify(submitBody()),
      }),
    );
    expect(again.status).toBe(409);
  });

  test("unknown report returns 404", async () => {
    const handler = createBugReportHandler({
      storage: createMemoryStorage(),
      actions: [noopAction()],
      consent: CONSENT,
      logger: silentLogger,
    });
    const res = await handler(
      new Request(`${BASE}/${crypto.randomUUID()}`),
    );
    expect(res.status).toBe(404);
  });
});
