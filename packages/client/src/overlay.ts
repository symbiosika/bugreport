import type { Messages } from "./i18n";

export interface OverlayCallbacks {
  onConsentAccept: () => void;
  onConsentCancel: () => void;
  onScreenshot: () => void;
  onPauseToggle: (paused: boolean) => void;
  onSubmit: (comment: string | undefined) => void;
  onCancel: () => void;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
.backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; z-index: 2147483646;
}
.dialog {
  background: #fff; color: #111; border-radius: 12px; padding: 24px;
  max-width: 440px; width: calc(100vw - 48px); box-shadow: 0 12px 40px rgba(0,0,0,.3);
}
.dialog h2 { font-size: 17px; margin-bottom: 12px; }
.dialog p { font-size: 14px; line-height: 1.5; margin-bottom: 10px; white-space: pre-wrap; }
.dialog .hint { font-size: 12.5px; color: #555; }
.dialog textarea {
  width: 100%; min-height: 88px; border: 1px solid #ccc; border-radius: 8px;
  padding: 10px; font-size: 14px; resize: vertical; margin-bottom: 14px;
}
.row { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
button {
  border: 0; border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer;
  background: #e5e5e5; color: #111;
}
button.primary { background: #2563eb; color: #fff; }
button.danger { background: #dc2626; color: #fff; }
button:hover { filter: brightness(.95); }
.bar {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  background: #1f2937; color: #fff; border-radius: 999px;
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,.35); z-index: 2147483646;
}
.bar .rec { display: flex; align-items: center; gap: 7px; padding: 0 8px; font-size: 13px; font-variant-numeric: tabular-nums; }
.bar .dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; animation: pulse 1.2s infinite; }
.bar.paused .dot { animation: none; background: #f59e0b; }
@keyframes pulse { 50% { opacity: .35; } }
.bar button { background: #374151; color: #fff; font-size: 13px; padding: 7px 12px; }
.bar button.primary { background: #2563eb; }
.bar button.danger { background: transparent; color: #f87171; }
.toast {
  position: fixed; bottom: 84px; left: 50%; transform: translateX(-50%);
  background: #111827; color: #fff; font-size: 13px; padding: 8px 14px;
  border-radius: 8px; z-index: 2147483646;
}
.spinner {
  width: 22px; height: 22px; border: 3px solid #e5e7eb; border-top-color: #2563eb;
  border-radius: 50%; animation: spin .8s linear infinite; margin: 0 auto 12px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.center { text-align: center; }
.fab {
  position: fixed; bottom: 20px; right: 20px; z-index: 2147483644;
  background: #2563eb; color: #fff; border-radius: 999px; padding: 11px 18px;
  font-size: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.25);
}
`;

/** Overlay UI in its own shadow root so app styles and overlay styles can
 * never interfere with each other. */
export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private container: HTMLElement;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private pausedAt = 0;
  private pausedTotal = 0;

  constructor(
    private t: Messages,
    private callbacks: OverlayCallbacks,
  ) {
    this.host = document.createElement("div");
    this.host.setAttribute("data-bugreport-overlay", "");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    this.root.appendChild(style);
    this.container = document.createElement("div");
    this.root.appendChild(this.container);
    document.body.appendChild(this.host);
  }

  /** Used around frame grabs so the overlay is not in the shot. */
  hide() {
    this.host.style.visibility = "hidden";
  }
  show() {
    this.host.style.visibility = "visible";
  }

  private clear() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.container.replaceChildren();
  }

  renderFloatingButton(onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "fab";
    btn.textContent = `🐞 ${this.t.reportBug}`;
    btn.addEventListener("click", onClick);
    this.root.appendChild(btn);
    return btn;
  }

  showConsent(consentText: string, tabHint: boolean) {
    this.clear();
    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog");
    dialog.appendChild(el("h2", "", this.t.consentTitle));
    dialog.appendChild(el("p", "", consentText));
    if (tabHint) dialog.appendChild(el("p", "hint", this.t.consentTabHint));
    const row = el("div", "row");
    const cancel = button(this.t.consentCancel, "", () =>
      this.callbacks.onConsentCancel(),
    );
    const accept = button(this.t.consentAccept, "primary", () =>
      this.callbacks.onConsentAccept(),
    );
    accept.setAttribute("data-testid", "bugreport-consent-accept");
    row.append(cancel, accept);
    dialog.appendChild(row);
    backdrop.appendChild(dialog);
    this.container.appendChild(backdrop);
  }

  showRecordingBar() {
    this.clear();
    this.startTime = Date.now();
    this.pausedTotal = 0;
    const bar = el("div", "bar");
    bar.setAttribute("data-testid", "bugreport-bar");

    const rec = el("div", "rec");
    const dot = el("div", "dot");
    const time = el("span", "", "00:00");
    rec.append(dot, el("span", "", `⏺ ${this.t.recording}`), time);

    let paused = false;
    const shot = button(`📸 ${this.t.screenshot}`, "", () =>
      this.callbacks.onScreenshot(),
    );
    shot.setAttribute("data-testid", "bugreport-screenshot");
    const pause = button(`⏸ ${this.t.pause}`, "", () => {
      paused = !paused;
      bar.classList.toggle("paused", paused);
      pause.textContent = paused ? `▶ ${this.t.resume}` : `⏸ ${this.t.pause}`;
      if (paused) this.pausedAt = Date.now();
      else this.pausedTotal += Date.now() - this.pausedAt;
      this.callbacks.onPauseToggle(paused);
    });
    const submit = button(`✓ ${this.t.submit}`, "primary", () =>
      this.showCommentDialog(),
    );
    submit.setAttribute("data-testid", "bugreport-submit");
    const cancel = button(`✕ ${this.t.cancel}`, "danger", () =>
      this.callbacks.onCancel(),
    );

    bar.append(rec, shot, pause, submit, cancel);
    this.container.appendChild(bar);

    this.timerInterval = setInterval(() => {
      if (paused) return;
      const s = Math.floor((Date.now() - this.startTime - this.pausedTotal) / 1000);
      time.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }, 250);
  }

  elapsedMs(): number {
    return Date.now() - this.startTime - this.pausedTotal;
  }

  showCommentDialog() {
    this.clear();
    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog");
    dialog.appendChild(el("h2", "", this.t.commentTitle));
    const textarea = document.createElement("textarea");
    textarea.placeholder = this.t.commentPlaceholder;
    textarea.setAttribute("data-testid", "bugreport-comment");
    dialog.appendChild(textarea);
    const row = el("div", "row");
    const send = button(this.t.send, "primary", () =>
      this.callbacks.onSubmit(textarea.value.trim() || undefined),
    );
    send.setAttribute("data-testid", "bugreport-send");
    row.append(button(this.t.cancel, "", () => this.callbacks.onCancel()), send);
    dialog.appendChild(row);
    backdrop.appendChild(dialog);
    this.container.appendChild(backdrop);
  }

  showUploading() {
    this.clear();
    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog center");
    dialog.appendChild(el("div", "spinner"));
    dialog.appendChild(el("p", "", this.t.uploading));
    backdrop.appendChild(dialog);
    this.container.appendChild(backdrop);
  }

  showSubmitted(reportId: string, onClose: () => void) {
    this.clear();
    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog center");
    dialog.setAttribute("data-testid", "bugreport-success");
    dialog.appendChild(el("h2", "", `✅ ${this.t.submittedTitle}`));
    dialog.appendChild(el("p", "", this.t.submittedText));
    dialog.appendChild(el("p", "hint", `${this.t.reportIdLabel}: ${reportId}`));
    const row = el("div", "row");
    row.style.justifyContent = "center";
    row.appendChild(button(this.t.close, "primary", onClose));
    dialog.appendChild(row);
    backdrop.appendChild(dialog);
    this.container.appendChild(backdrop);
  }

  showError(message: string, onClose: () => void) {
    this.clear();
    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog center");
    dialog.appendChild(el("h2", "", `⚠️ ${this.t.errorTitle}`));
    dialog.appendChild(el("p", "", message));
    const row = el("div", "row");
    row.style.justifyContent = "center";
    row.appendChild(button(this.t.close, "primary", onClose));
    dialog.appendChild(row);
    backdrop.appendChild(dialog);
    this.container.appendChild(backdrop);
  }

  showToast(message: string, ms = 3000) {
    const toast = el("div", "toast", message);
    this.container.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
  }

  reset() {
    this.clear();
  }

  destroy() {
    this.clear();
    this.host.remove();
  }
}

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  if (className) btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}
