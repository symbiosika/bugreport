import type { CaptureConfig, RedactConfig } from "./types";

export interface CapturedFrame {
  blob: Blob;
  kind: "frame" | "screenshot";
  capturedAt: string;
}

export interface CaptureCallbacks {
  onFrame: (frame: CapturedFrame) => void;
  /** Called when the user stops sharing via the browser UI. */
  onStreamEnded: () => void;
  /** Hide/show the overlay around a grab so it is not part of the shot. */
  hideOverlay: () => void;
  showOverlay: () => void;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/**
 * Screen + microphone capture. The screen stream is opened but by default
 * NOT recorded as video: frames are sampled periodically, on clicks and on
 * manual screenshots via <video> → canvas → JPEG.
 */
export class CaptureSession {
  private screenStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas = document.createElement("canvas");
  private audioRecorder: MediaRecorder | null = null;
  private videoRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private videoChunks: Blob[] = [];
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private clickListener: ((ev: MouseEvent) => void) | null = null;
  private grabbing = false;
  private paused = false;
  startedAt = "";

  constructor(
    private config: CaptureConfig,
    private redact: RedactConfig | undefined,
    private callbacks: CaptureCallbacks,
    private onMaxDuration: () => void,
  ) {}

  /**
   * Must be called synchronously from a user gesture — no awaits before
   * getDisplayMedia(), or the browser rejects the request.
   */
  async start(requireTabCapture: boolean): Promise<void> {
    const displayOpts: DisplayMediaStreamOptions & Record<string, unknown> = {
      video: { frameRate: 10 },
      audio: false,
      // Chrome: steer the picker towards the current tab.
      preferCurrentTab: requireTabCapture ? true : undefined,
      selfBrowserSurface: "include",
    };
    this.screenStream = await navigator.mediaDevices.getDisplayMedia(displayOpts);

    if (this.config.microphone !== false) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        this.micStream = null; // no mic permission — report still works
      }
    }

    this.startedAt = new Date().toISOString();

    const track = this.screenStream.getVideoTracks()[0];
    track?.addEventListener("ended", () => this.callbacks.onStreamEnded());

    // Hidden <video> that plays the screen stream for canvas grabs.
    this.video = document.createElement("video");
    this.video.srcObject = this.screenStream;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.style.cssText =
      "position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(this.video);
    await this.video.play();

    // Audio: its own MediaRecorder on the mic stream — clean input for
    // transcription, no demuxing server-side.
    if (this.micStream) {
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      this.audioRecorder = new MediaRecorder(this.micStream, {
        mimeType: mime,
        audioBitsPerSecond: 48_000,
      });
      this.audioRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.audioRecorder.start(1000);
    }

    // Optional real video recording (attachment only).
    if (this.config.recordVideo) {
      this.videoRecorder = new MediaRecorder(this.screenStream, {
        videoBitsPerSecond: 1_500_000,
      });
      this.videoRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.videoChunks.push(e.data);
      };
      this.videoRecorder.start(1000);
    }

    // Periodic frame sampling.
    const interval = this.config.frameIntervalMs ?? 4000;
    this.frameTimer = setInterval(() => {
      void this.grab("frame");
    }, interval);

    // A frame on every click (captures the state the user acts on).
    this.clickListener = () => {
      void this.grab("frame");
    };
    document.addEventListener("click", this.clickListener, {
      capture: true,
      passive: true,
    });

    // Hard cut.
    const maxMs = this.config.maxDurationMs ?? 180_000;
    this.maxTimer = setTimeout(() => this.onMaxDuration(), maxMs);

    // First frame right away.
    void this.grab("frame");
  }

  async grab(kind: "frame" | "screenshot"): Promise<void> {
    if (!this.video || this.grabbing || this.paused) return;
    this.grabbing = true;
    const masks: HTMLElement[] = [];
    try {
      // Redaction bars over sensitive elements (works for tab capture).
      for (const selector of this.redact?.selectors ?? []) {
        for (const el of document.querySelectorAll(selector)) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const mask = document.createElement("div");
          mask.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#000;z-index:2147483645;pointer-events:none;`;
          document.body.appendChild(mask);
          masks.push(mask);
        }
      }

      // With tab sharing the overlay would record itself: hide it, wait two
      // animation frames so the compositor catches up, grab, show again.
      this.callbacks.hideOverlay();
      await nextFrame();
      await nextFrame();

      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (vw === 0 || vh === 0) return;
      const maxW = this.config.maxFrameWidth ?? 1600;
      const scale = Math.min(1, maxW / vw);
      this.canvas.width = Math.round(vw * scale);
      this.canvas.height = Math.round(vh * scale);
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        this.canvas.toBlob(resolve, "image/jpeg", this.config.jpegQuality ?? 0.7),
      );
      if (blob) {
        this.callbacks.onFrame({
          blob,
          kind,
          capturedAt: new Date().toISOString(),
        });
      }
    } finally {
      this.callbacks.showOverlay();
      for (const m of masks) m.remove();
      this.grabbing = false;
    }
  }

  pause() {
    this.paused = true;
    if (this.audioRecorder?.state === "recording") this.audioRecorder.pause();
    if (this.videoRecorder?.state === "recording") this.videoRecorder.pause();
  }

  resume() {
    this.paused = false;
    if (this.audioRecorder?.state === "paused") this.audioRecorder.resume();
    if (this.videoRecorder?.state === "paused") this.videoRecorder.resume();
  }

  /** Stops everything and returns the recorded audio/video blobs. */
  async stop(): Promise<{ audio: Blob | null; video: Blob | null }> {
    if (this.frameTimer) clearInterval(this.frameTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.clickListener) {
      document.removeEventListener("click", this.clickListener, { capture: true });
    }

    const stopRecorder = (rec: MediaRecorder | null) =>
      new Promise<void>((resolve) => {
        if (!rec || rec.state === "inactive") return resolve();
        rec.addEventListener("stop", () => resolve(), { once: true });
        rec.stop();
      });
    await stopRecorder(this.audioRecorder);
    await stopRecorder(this.videoRecorder);

    const audio =
      this.audioChunks.length > 0
        ? new Blob(this.audioChunks, {
            type: this.audioRecorder?.mimeType || "audio/webm",
          })
        : null;
    const video =
      this.videoChunks.length > 0
        ? new Blob(this.videoChunks, {
            type: this.videoRecorder?.mimeType || "video/webm",
          })
        : null;

    for (const stream of [this.screenStream, this.micStream]) {
      stream?.getTracks().forEach((t) => t.stop());
    }
    this.video?.remove();
    this.video = null;
    this.screenStream = null;
    this.micStream = null;
    return { audio, video };
  }
}
