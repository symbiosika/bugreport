import * as v from "valibot";
import {
  AssetUploadFieldsSchema,
  SessionRequestSchema,
  SubmitRequestSchema,
  fnv1aHex,
  type BugReport,
  type BugReportPublicConfig,
  type ReportStatusResponse,
} from "@symbiosika/bugreport-core";
import type {
  AuthContext,
  BugReportAction,
  Logger,
  LlmAdapter,
  StorageAdapter,
} from "./interfaces";
import { RateLimiter } from "./rate-limit";
import { runPipeline } from "./pipeline";

export interface BugReportHandlerOptions {
  /** Required — the host's own persistence implementation. */
  storage: StorageAdapter;
  /** Optional — without it reports are created with analysisStatus 'skipped'. */
  llm?: LlmAdapter;
  /** At least one action; each receives the finished BugReport. */
  actions: BugReportAction[];

  /**
   * Return an AuthContext to accept the request, null to reject with 401.
   * Defaults to allowing everything as user "anonymous".
   */
  auth?: (req: Request) => Promise<AuthContext | null> | AuthContext | null;

  limits?: {
    maxAssetBytes?: number;
    maxAssetsPerReport?: number;
    maxImagesToLlm?: number;
    ratePerUserPerHour?: number;
    maxDurationMs?: number;
  };

  consent: { version: string; text: string };

  /** Disable GET /bugreport/:id (e.g. when report status is not needed). */
  statusEndpoint?: boolean;

  logger?: Logger;

  /** Invoked after the async pipeline for a report settles (useful in tests). */
  onReportProcessed?: (report: BugReport) => void;
}

export type BugReportHandler = ((req: Request) => Promise<Response>) & {
  /** Resolves when all currently running pipelines have settled. */
  waitForPipelines(): Promise<void>;
};

const DEFAULT_LIMITS = {
  maxAssetBytes: 10 * 1024 * 1024,
  maxAssetsPerReport: 40,
  maxImagesToLlm: 6,
  ratePerUserPerHour: 5,
  maxDurationMs: 180_000,
};

const consoleLogger: Logger = {
  debug: (m, d) => console.debug(m, d ?? ""),
  info: (m, d) => console.info(m, d ?? ""),
  warn: (m, d) => console.warn(m, d ?? ""),
  error: (m, d) => console.error(m, d ?? ""),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

const ID_RE = "([0-9a-fA-F-]{8,64})";
const ROUTES = {
  config: new RegExp(`/config/?$`),
  session: new RegExp(`/session/?$`),
  asset: new RegExp(`/${ID_RE}/asset/?$`),
  submit: new RegExp(`/${ID_RE}/submit/?$`),
  status: new RegExp(`/${ID_RE}/?$`),
};

/**
 * Creates a web-standard (Request → Response) handler implementing the
 * bugreport API. Mount it under any prefix, e.g.
 * `app.all('/api/bugreport/*', (c) => handler(c.req.raw))` — route matching
 * is prefix-agnostic.
 */
export function createBugReportHandler(
  options: BugReportHandlerOptions,
): BugReportHandler {
  if (!options.storage) throw new Error("bugreport: storage adapter is required");
  if (!options.actions || options.actions.length === 0) {
    throw new Error("bugreport: at least one action is required");
  }

  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const logger = options.logger ?? consoleLogger;
  const rateLimiter = new RateLimiter(limits.ratePerUserPerHour);
  const statusEnabled = options.statusEndpoint !== false;
  const pending = new Set<Promise<unknown>>();

  const publicConfig: BugReportPublicConfig = {
    enabled: true,
    consent: options.consent,
    limits: {
      maxAssetBytes: limits.maxAssetBytes,
      maxAssetsPerReport: limits.maxAssetsPerReport,
      maxDurationMs: limits.maxDurationMs,
    },
    features: { statusEndpoint: statusEnabled },
  };

  const handler = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;

    if (req.method === "OPTIONS") return new Response(null, { status: 204 });

    // GET /config — no auth needed, it only carries public config.
    if (req.method === "GET" && ROUTES.config.test(path)) {
      return json(publicConfig);
    }

    const auth = options.auth
      ? await options.auth(req)
      : ({ userId: "anonymous" } satisfies AuthContext);
    if (!auth) return error(401, "unauthorized");

    // POST /session
    if (req.method === "POST" && ROUTES.session.test(path)) {
      if (!rateLimiter.allow(auth.userId)) {
        return error(429, "rate limit exceeded");
      }
      const parsed = v.safeParse(SessionRequestSchema, await safeJson(req));
      if (!parsed.success) return error(400, "invalid session request");
      const report: BugReport = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: "processing",
        app: parsed.output.app,
        reporter: parsed.output.reporter,
        title: "",
        summary: "",
        stepsToReproduce: [],
        severitySuggestion: "medium",
        labels: [],
        confidence: 0,
        context: {
          url: "",
          viewport: { width: 0, height: 0, dpr: 1 },
          userAgent: "",
          locale: parsed.output.locale ?? "en",
          timezone: "",
          consoleEntries: [],
          networkErrors: [],
          breadcrumbs: [],
        },
        assets: [],
        consent: { acceptedAt: "", version: "", textHash: "" },
        analysisStatus: options.llm ? "ok" : "skipped",
        actionResults: [],
      };
      await options.storage.saveReport(report);
      logger.info("bugreport: session opened", { reportId: report.id });
      return json({ reportId: report.id }, 201);
    }

    // PUT /:id/asset
    const assetMatch = req.method === "PUT" && path.match(ROUTES.asset);
    if (assetMatch) {
      const reportId = assetMatch[1]!;
      const report = await options.storage.getReport(reportId);
      if (!report) return error(404, "unknown report");
      if (report.status !== "processing" || report.consent.acceptedAt) {
        return error(409, "report already submitted");
      }
      if (report.assets.length >= limits.maxAssetsPerReport) {
        return error(413, "too many assets");
      }
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return error(400, "expected multipart form data");
      }
      const file = form.get("file");
      if (!(file instanceof Blob)) return error(400, "missing file part");
      if (file.size === 0) return error(400, "empty file");
      if (file.size > limits.maxAssetBytes) return error(413, "asset too large");
      const fields = v.safeParse(AssetUploadFieldsSchema, {
        kind: form.get("kind"),
        capturedAt: form.get("capturedAt"),
        caption: form.get("caption") ?? undefined,
      });
      if (!fields.success) return error(400, "invalid asset metadata");

      const { key } = await options.storage.putAsset(
        reportId,
        {
          kind: fields.output.kind,
          mimeType: file.type || "application/octet-stream",
          bytes: file.size,
          capturedAt: fields.output.capturedAt,
          caption: fields.output.caption,
        },
        file.stream() as ReadableStream<Uint8Array>,
      );
      report.assets.push({
        key,
        kind: fields.output.kind,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        capturedAt: fields.output.capturedAt,
        caption: fields.output.caption,
        usedInAnalysis: false,
      });
      await options.storage.saveReport(report);
      return json({ key }, 201);
    }

    // POST /:id/submit
    const submitMatch = req.method === "POST" && path.match(ROUTES.submit);
    if (submitMatch) {
      const reportId = submitMatch[1]!;
      const report = await options.storage.getReport(reportId);
      if (!report) return error(404, "unknown report");
      if (report.consent.acceptedAt) return error(409, "already submitted");
      const parsed = v.safeParse(SubmitRequestSchema, await safeJson(req));
      if (!parsed.success) return error(400, "invalid submit request");

      // The consent hash must match the text this server serves.
      const expectedHash = fnv1aHex(options.consent.text);
      if (
        parsed.output.consent.version !== options.consent.version ||
        parsed.output.consent.textHash !== expectedHash
      ) {
        return error(409, "consent version mismatch");
      }

      report.context = parsed.output.context;
      report.userComment = parsed.output.userComment;
      report.consent = parsed.output.consent;
      await options.storage.saveReport(report);

      const task = runPipeline(report, {
        storage: options.storage,
        llm: options.llm,
        actions: options.actions,
        logger,
        maxImagesToLlm: limits.maxImagesToLlm,
        locale: report.context.locale,
        recordingDurationMs: parsed.output.durationMs,
      })
        .then((r) => options.onReportProcessed?.(r))
        .catch(async (err) => {
          logger.error("bugreport: pipeline crashed", {
            reportId,
            error: String(err),
          });
          report.status = "failed";
          await options.storage.saveReport(report).catch(() => {});
          options.onReportProcessed?.(report);
        });
      pending.add(task);
      task.finally(() => pending.delete(task));

      return json({ reportId }, 202);
    }

    // GET /:id
    const statusMatch = req.method === "GET" && path.match(ROUTES.status);
    if (statusMatch && statusEnabled) {
      const report = await options.storage.getReport(statusMatch[1]!);
      if (!report) return error(404, "unknown report");
      const externalUrl = report.actionResults.find((r) => r.externalUrl)
        ?.externalUrl;
      const body: ReportStatusResponse = {
        id: report.id,
        status: report.status,
        analysisStatus: report.analysisStatus,
        title: report.title || undefined,
        actionResults: report.actionResults,
        externalUrl,
      };
      return json(body);
    }

    return error(404, "not found");
  };

  return Object.assign(handler, {
    waitForPipelines: async () => {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  });
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
