import type {
  AnalysisInput,
  AssetMeta,
  BugReport,
  BugReportAnalysis,
} from "@symbiosika/bugreport-core";

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

/**
 * Persistence is entirely the host's concern: where assets and reports live,
 * how long they are retained and how keys turn into URLs.
 */
export interface StorageAdapter {
  putAsset(
    reportId: string,
    asset: Omit<AssetMeta, "key" | "usedInAnalysis">,
    data: ReadableStream<Uint8Array>,
  ): Promise<{ key: string }>;
  getAsset(key: string): Promise<ReadableStream<Uint8Array>>;
  saveReport(report: BugReport): Promise<void>;
  getReport(reportId: string): Promise<BugReport | null>;
}

/**
 * Optional. Which provider, model, prompt or deployment is used is entirely
 * up to the host. `analyze` receives a curated AnalysisInput and must return
 * a result conforming to BugReportAnalysisSchema.
 */
export interface LlmAdapter {
  transcribe(
    audio: Blob,
    opts: { language?: string },
  ): Promise<{ text: string; language: string }>;
  analyze(input: AnalysisInput): Promise<BugReportAnalysis>;
}

export interface ActionContext {
  logger: Logger;
  storage: StorageAdapter;
}

export interface ActionResultInput {
  system: string;
  externalId?: string;
  externalUrl?: string;
}

export interface BugReportAction {
  name: string;
  run(report: BugReport, ctx: ActionContext): Promise<ActionResultInput | void>;
}

export interface AuthContext {
  /** Stable identifier used for rate limiting. */
  userId: string;
  [key: string]: unknown;
}
