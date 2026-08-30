/** Kinds of media assets a report can carry. */
export type AssetKind = "screenshot" | "frame" | "video" | "audio";

export interface LogEntry {
  level: "error" | "warn" | "unhandledrejection" | "onerror";
  message: string;
  stack?: string;
  at: string; // ISO timestamp
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number; // 0 = network failure
  durationMs: number;
  at: string;
}

export interface Breadcrumb {
  type: "click" | "navigation";
  detail: string; // selector or route
  at: string;
}

export interface ReportContext {
  url: string;
  route?: string;
  viewport: { width: number; height: number; dpr: number };
  userAgent: string;
  locale: string;
  timezone: string;
  consoleEntries: LogEntry[];
  networkErrors: NetworkEntry[];
  breadcrumbs: Breadcrumb[];
  custom?: Record<string, unknown>;
}

export interface AppIdentity {
  id: string;
  version?: string;
  environment?: string;
}

export interface Reporter {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
}

export interface ConsentRecord {
  acceptedAt: string;
  version: string;
  textHash: string;
}

export interface AssetMeta {
  key: string; // assigned by the StorageAdapter
  kind: AssetKind;
  mimeType: string;
  bytes: number;
  capturedAt: string;
  caption?: string;
  usedInAnalysis: boolean;
}

export interface ActionResult {
  system: string;
  externalId?: string;
  externalUrl?: string;
  error?: string;
}

export type Severity = "low" | "medium" | "high" | "critical";
export type AnalysisStatus = "ok" | "skipped" | "failed";
export type ReportStatus = "processing" | "done" | "failed";

/** Result the host's LlmAdapter must return from analyze(). */
export interface BugReportAnalysis {
  title: string;
  summary: string; // Markdown, 2-5 sentences
  stepsToReproduce: string[];
  expectedBehaviour?: string;
  actualBehaviour?: string;
  severitySuggestion: Severity;
  areaSuggestion?: string;
  labels: string[];
  confidence: number; // 0-1
  /** Optional captions per analysed image, keyed by asset key. */
  imageCaptions?: Record<string, string>;
}

/** The normalised record — the contract between pipeline and actions. */
export interface BugReport {
  id: string;
  createdAt: string;
  status: ReportStatus;

  app: AppIdentity;
  reporter?: Reporter;

  // From the LlmAdapter; empty when analysisStatus is 'skipped' | 'failed'
  title: string;
  summary: string;
  stepsToReproduce: string[];
  expectedBehaviour?: string;
  actualBehaviour?: string;
  severitySuggestion: Severity;
  areaSuggestion?: string;
  labels: string[];
  confidence: number;

  transcript?: { text: string; language: string };
  userComment?: string;

  context: ReportContext;
  assets: AssetMeta[];

  consent: ConsentRecord;
  analysisStatus: AnalysisStatus;
  actionResults: ActionResult[];
}

/** Curated input handed to LlmAdapter.analyze(). */
export interface AnalysisInput {
  app: AppIdentity;
  reporter?: Reporter;
  transcript?: { text: string; language: string };
  userComment?: string;
  context: ReportContext;
  /** Selected images, already loaded as bytes. */
  images: Array<{
    key: string;
    kind: AssetKind;
    mimeType: string;
    capturedAt: string;
    data: Uint8Array;
  }>;
  locale?: string;
}

// ---------------------------------------------------------------------------
// API contract (client <-> server)
// ---------------------------------------------------------------------------

export interface BugReportPublicConfig {
  enabled: boolean;
  consent: { version: string; text: string };
  limits: {
    maxAssetBytes: number;
    maxAssetsPerReport: number;
    maxDurationMs: number;
  };
  features: { statusEndpoint: boolean };
}

export interface SessionRequest {
  app: AppIdentity;
  reporter?: Reporter;
  locale?: string;
}

export interface SessionResponse {
  reportId: string;
}

export interface AssetUploadResponse {
  key: string;
}

export interface SubmitRequest {
  context: ReportContext;
  userComment?: string;
  consent: ConsentRecord;
  durationMs?: number;
}

export interface SubmitResponse {
  reportId: string;
}

/** Public status view served by GET /bugreport/:id */
export interface ReportStatusResponse {
  id: string;
  status: ReportStatus;
  analysisStatus: AnalysisStatus;
  title?: string;
  actionResults: ActionResult[];
  externalUrl?: string;
}
