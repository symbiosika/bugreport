import type { AppIdentity, Reporter } from "@symbiosika/bugreport-core";

export interface CaptureConfig {
  /** Record a real video alongside frame sampling (attachment only). */
  recordVideo?: boolean;
  /** Interval for periodic frame sampling. Default 4000. */
  frameIntervalMs?: number;
  /** Record microphone audio. Default true. */
  microphone?: boolean;
  console?: { maxEntries?: number };
  network?: boolean;
  /** Hard stop after this duration. Default 180_000. */
  maxDurationMs?: number;
  /** JPEG quality for sampled frames. Default 0.7. */
  jpegQuality?: number;
  /** Frames are downscaled to at most this width. Default 1600. */
  maxFrameWidth?: number;
}

export interface RedactConfig {
  /** Elements matching these selectors are covered before each frame grab
   * (only effective when the user shares the current tab). */
  selectors?: string[];
  /** Query params stripped from collected URLs. */
  urlParams?: string[];
}

export interface BugReportClientConfig {
  /** Base URL of the server handler, e.g. '/api/bugreport'. */
  endpoint: string;
  app: AppIdentity;

  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  reporter?: () => Reporter | undefined;

  capture?: CaptureConfig;
  redact?: RedactConfig;

  /** Extra app state merged into context.custom at submit time. */
  context?: () => Record<string, unknown>;

  /** UI language. Default: browser language (de/en supported). */
  locale?: "de" | "en";

  /** Require sharing the current tab (Chrome only enforcement + hint text). */
  requireTabCapture?: boolean;

  /** Render the built-in floating button. Default false. */
  floatingButton?: boolean;

  onSubmitted?: (info: { reportId: string }) => void;
  onError?: (err: Error) => void;
}

export type BugReportState =
  | "idle"
  | "consent"
  | "recording"
  | "paused"
  | "submitting"
  | "submitted"
  | "error";
