import { Hono } from "hono";
import { join } from "node:path";
import {
  createBugReportHandler,
  type BugReportHandlerOptions,
  type BugReportHandler,
} from "@symbiosika/bugreport-server";
import { createFsStorage } from "./adapters/fs-storage";
import { createAiSdkLlmAdapter } from "./adapters/ai-sdk-llm";
import { createZipAction } from "./adapters/zip-action";
import { curlFetch } from "./lib/curl-fetch";

const ROOT = join(import.meta.dir, "..");

export const CONSENT_TEXT = [
  "To analyze the problem, screen stills of your browser tab, your microphone recording and technical context (console messages, failed requests, visited routes) will be captured and sent to our development team.",
  "In the next dialog please share only this tab and make sure no sensitive data is visible.",
  "The data is used exclusively to process your bug report.",
].join("\n\n");

export interface CreateAppOptions {
  dataDir?: string;
  zipDir?: string;
  /** Override the LLM adapter (or pass null to run without analysis). */
  llm?: BugReportHandlerOptions["llm"] | null;
  onReportProcessed?: BugReportHandlerOptions["onReportProcessed"];
}

export function createApp(opts: CreateAppOptions = {}) {
  const dataDir = opts.dataDir ?? join(ROOT, "data");
  const zipDir = opts.zipDir ?? join(ROOT, "bugreports");

  const storage = createFsStorage(dataDir);

  const llm =
    opts.llm === null
      ? undefined
      : (opts.llm ??
        (process.env.OPENROUTER_API_KEY && process.env.MISTRAL_API_KEY
          ? createAiSdkLlmAdapter({
              openrouterApiKey: process.env.OPENROUTER_API_KEY,
              mistralApiKey: process.env.MISTRAL_API_KEY,
              analysisModel: process.env.OPENROUTER_MODEL,
              // Sandbox escape hatch: Bun's fetch cannot pass some
              // TLS-intercepting proxies — see src/lib/curl-fetch.ts.
              fetch: process.env.BUGREPORT_CURL_FETCH === "1" ? curlFetch : undefined,
            })
          : undefined));

  const handler: BugReportHandler = createBugReportHandler({
    storage,
    llm,
    actions: [createZipAction(zipDir)],

    // Reference auth: accept everything as a demo user. In a real app verify
    // the session token here and return null for 401.
    auth: async (_req) => ({ userId: "demo-user" }),

    limits: {
      maxAssetBytes: 10 * 1024 * 1024,
      maxAssetsPerReport: 40,
      maxImagesToLlm: 6,
      ratePerUserPerHour: 100,
    },

    consent: { version: "1.0", text: CONSENT_TEXT },
    onReportProcessed: opts.onReportProcessed,
  });

  const app = new Hono();

  app.all("/api/bugreport/*", (c) => handler(c.req.raw));

  // Static demo frontend + the built client bundle.
  app.get("/", async (c) =>
    c.html(await Bun.file(join(ROOT, "public/index.html")).text()),
  );
  app.get("/bugreport-client.js", (c) => {
    const file = Bun.file(
      join(ROOT, "../../packages/client/dist/bugreport-client.browser.js"),
    );
    c.header("content-type", "application/javascript");
    return c.body(file.stream());
  });

  // Demo endpoint that always fails — for provoking network errors in the demo.
  app.get("/api/flaky", (c) => c.json({ error: "boom" }, 500));

  return { app, handler, llmConfigured: Boolean(llm) };
}

if (import.meta.main) {
  const { app, llmConfigured } = createApp({
    dataDir: process.env.BUGREPORT_DATA_DIR,
    zipDir: process.env.BUGREPORT_ZIP_DIR,
  });
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({ port, fetch: app.fetch, idleTimeout: 120 });
  console.log(`bugreport example running on http://localhost:${port}`);
  console.log(
    llmConfigured
      ? "LLM adapter: OpenRouter (analysis) + Mistral Voxtral (transcription)"
      : "LLM adapter: NOT configured (set OPENROUTER_API_KEY + MISTRAL_API_KEY) — reports will have analysisStatus 'skipped'",
  );
  console.log("Finished reports are zipped to examples/hono-reference/bugreports/");
}
