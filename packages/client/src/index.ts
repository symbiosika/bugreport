import {
  fnv1aHex,
  type BugReportPublicConfig,
  type ReportContext,
  type SubmitRequest,
} from "@symbiosika/bugreport-core";
import { ApiClient } from "./api";
import { CaptureSession, type CapturedFrame } from "./capture";
import { ContextCollector, redactUrl } from "./collector";
import { getMessages } from "./i18n";
import { Overlay } from "./overlay";
import { checkSupport } from "./support";
import type { BugReportClientConfig, BugReportState } from "./types";

export * from "./types";
export { checkSupport } from "./support";
export { ContextCollector } from "./collector";

export interface BugReportClient {
  /** False on mobile, insecure contexts or missing browser APIs — offer your
   * own fallback (e.g. a plain form) in that case. */
  readonly isSupported: boolean;
  readonly unsupportedReason?: string;
  readonly state: BugReportState;
  /** Opens the consent dialog (must eventually be triggered by the user). */
  start(): void;
  /** Aborts a running recording. */
  cancel(): void;
  /** Subscribe to state changes; returns an unsubscribe function. */
  onStateChange(fn: (state: BugReportState) => void): () => void;
  /** Removes overlay, listeners and console/network wrappers. */
  destroy(): void;
}

export function initBugReport(config: BugReportClientConfig): BugReportClient {
  const support = checkSupport();
  const t = getMessages(config.locale);
  const api = new ApiClient(config);

  let state: BugReportState = "idle";
  const listeners = new Set<(s: BugReportState) => void>();
  const setState = (s: BugReportState) => {
    state = s;
    for (const fn of listeners) fn(s);
  };

  if (!support.supported) {
    return {
      isSupported: false,
      unsupportedReason: support.reason,
      get state() {
        return state;
      },
      start() {
        config.onError?.(
          new Error(`bugreport not supported: ${support.reason}`),
        );
      },
      cancel() {},
      onStateChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      destroy() {},
    };
  }

  const collector = new ContextCollector({
    maxEntries: config.capture?.console?.maxEntries ?? 50,
    network: config.capture?.network !== false,
    redact: config.redact,
  });

  // Prefetch the server config (consent text, limits) so the consent dialog
  // opens instantly and getDisplayMedia stays inside the user gesture.
  let serverConfig: BugReportPublicConfig | null = null;
  const configPromise = api
    .getConfig()
    .then((c) => {
      serverConfig = c;
      return c;
    })
    .catch((err) => {
      config.onError?.(err instanceof Error ? err : new Error(String(err)));
      return null;
    });

  let overlay: Overlay | null = null;
  const getOverlay = () => {
    if (!overlay) {
      overlay = new Overlay(t, {
        onConsentAccept: () => void onConsentAccept(),
        onConsentCancel: () => reset(),
        onScreenshot: () => {
          void capture?.grab("screenshot");
          getOverlay().showToast(`📸 ${t.screenshot} ✓`, 1200);
        },
        onPauseToggle: (paused) => {
          if (paused) {
            capture?.pause();
            setState("paused");
          } else {
            capture?.resume();
            setState("recording");
          }
        },
        onSubmit: (comment) => void submit(comment),
        onCancel: () => reset(),
      });
    }
    return overlay;
  };

  let capture: CaptureSession | null = null;
  let reportIdPromise: Promise<string> | null = null;
  let uploadQueue: Promise<void> = Promise.resolve();
  let uploadErrors = 0;

  function enqueueFrame(frame: CapturedFrame) {
    if (!reportIdPromise) return;
    const p = reportIdPromise;
    uploadQueue = uploadQueue.then(async () => {
      try {
        const id = await p;
        await api.uploadAsset(id, frame.blob, {
          kind: frame.kind,
          capturedAt: frame.capturedAt,
        });
      } catch {
        uploadErrors++;
      }
    });
  }

  async function onConsentAccept() {
    const ov = getOverlay();
    try {
      capture = new CaptureSession(
        config.capture ?? {},
        config.redact,
        {
          onFrame: enqueueFrame,
          onStreamEnded: () => {
            // User pressed the browser's own "stop sharing" — go to submit.
            if (state === "recording" || state === "paused") {
              ov.showCommentDialog();
            }
          },
          hideOverlay: () => ov.hide(),
          showOverlay: () => ov.show(),
        },
        () => {
          ov.showToast(t.maxDurationReached);
          ov.showCommentDialog();
        },
      );
      // getDisplayMedia is the first await inside — still within the gesture.
      const started = capture.start(config.requireTabCapture ?? false);

      // Open the report session in parallel.
      reportIdPromise = api.openSession({
        app: config.app,
        reporter: config.reporter?.(),
        locale: config.locale,
      });
      reportIdPromise.catch(() => {});

      await started;
      setState("recording");
      ov.showRecordingBar();
    } catch (err) {
      // Permission denied or session failure.
      capture = null;
      reportIdPromise = null;
      reset();
      config.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function buildContext(): ReportContext {
    const collected = collector.snapshot();
    let custom: Record<string, unknown> | undefined;
    try {
      custom = config.context?.();
    } catch {
      custom = undefined;
    }
    return {
      url: redactUrl(location.href, config.redact?.urlParams),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      userAgent: navigator.userAgent,
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...collected,
      custom,
    };
  }

  async function submit(comment: string | undefined) {
    const ov = getOverlay();
    if (!capture || !reportIdPromise) return reset();
    setState("submitting");
    ov.showUploading();
    try {
      const durationMs = ov.elapsedMs();
      const { audio, video } = await capture.stop();
      const reportId = await reportIdPromise;
      await uploadQueue; // all sampled frames
      if (audio) {
        await api.uploadAsset(reportId, audio, {
          kind: "audio",
          capturedAt: new Date().toISOString(),
        });
      }
      if (video) {
        await api.uploadAsset(reportId, video, {
          kind: "video",
          capturedAt: new Date().toISOString(),
        });
      }
      const sc = serverConfig ?? (await configPromise);
      if (!sc) throw new Error("bugreport: server config unavailable");
      const body: SubmitRequest = {
        context: buildContext(),
        userComment: comment,
        consent: {
          acceptedAt: new Date().toISOString(),
          version: sc.consent.version,
          textHash: fnv1aHex(sc.consent.text),
        },
        durationMs,
      };
      await api.submit(reportId, body);
      setState("submitted");
      ov.showSubmitted(reportId, () => reset());
      config.onSubmitted?.({ reportId });
    } catch (err) {
      setState("error");
      ov.showError(t.errorGeneric, () => reset());
      config.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function reset() {
    void capture?.stop().catch(() => {});
    capture = null;
    reportIdPromise = null;
    uploadQueue = Promise.resolve();
    uploadErrors = 0;
    overlay?.reset();
    setState("idle");
  }

  function start() {
    if (state !== "idle") return;
    const sc = serverConfig;
    const ov = getOverlay();
    setState("consent");
    if (sc) {
      if (!sc.enabled) return reset();
      ov.showConsent(sc.consent.text, config.requireTabCapture ?? true);
    } else {
      // Config not loaded yet — wait for it, then show (still fine: consent
      // click is the gesture that matters for getDisplayMedia).
      void configPromise.then((c) => {
        if (!c || !c.enabled) return reset();
        if (state === "consent") {
          ov.showConsent(c.consent.text, config.requireTabCapture ?? true);
        }
      });
    }
  }

  if (config.floatingButton) {
    getOverlay().renderFloatingButton(() => start());
  }

  return {
    isSupported: true,
    get state() {
      return state;
    },
    start,
    cancel: reset,
    onStateChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      reset();
      collector.destroy();
      overlay?.destroy();
      overlay = null;
    },
  };
}
