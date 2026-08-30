import type {
  Breadcrumb,
  LogEntry,
  NetworkEntry,
} from "@symbiosika/bugreport-core";
import type { RedactConfig } from "./types";

class RingBuffer<T> {
  private items: T[] = [];
  constructor(private max: number) {}
  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
  }
  toArray(): T[] {
    return [...this.items];
  }
}

export interface CollectorOptions {
  maxEntries?: number;
  network?: boolean;
  redact?: RedactConfig;
}

function now(): string {
  return new Date().toISOString();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function redactUrl(url: string, params?: string[]): string {
  if (!params || params.length === 0) return url;
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    for (const p of params) {
      if (u.searchParams.has(p)) u.searchParams.set(p, "REDACTED");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && parts.length < 5) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${part}#${cur.id}`);
      break;
    }
    const cls = [...cur.classList].slice(0, 2).join(".");
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

/**
 * Ring-buffered context collector. Runs from init on; its contents are only
 * ever transmitted when the user actually submits a report.
 */
export class ContextCollector {
  private console_: RingBuffer<LogEntry>;
  private network_: RingBuffer<NetworkEntry>;
  private breadcrumbs_: RingBuffer<Breadcrumb>;
  private teardowns: Array<() => void> = [];
  private redact?: RedactConfig;

  constructor(opts: CollectorOptions = {}) {
    const max = opts.maxEntries ?? 50;
    this.console_ = new RingBuffer(max);
    this.network_ = new RingBuffer(max);
    this.breadcrumbs_ = new RingBuffer(max);
    this.redact = opts.redact;
    this.installConsole();
    this.installErrors();
    if (opts.network !== false) this.installNetwork();
    this.installBreadcrumbs();
  }

  private installConsole() {
    for (const level of ["error", "warn"] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        try {
          this.console_.push({
            level,
            message: truncate(
              args
                .map((a) =>
                  typeof a === "string"
                    ? a
                    : a instanceof Error
                      ? a.message
                      : safeStringify(a),
                )
                .join(" "),
              1000,
            ),
            stack: args.find((a): a is Error => a instanceof Error)?.stack?.slice(0, 8000),
            at: now(),
          });
        } catch {
          /* collector must never break the app */
        }
        original(...args);
      };
      this.teardowns.push(() => {
        console[level] = original;
      });
    }
  }

  private installErrors() {
    const onError = (ev: ErrorEvent) => {
      this.console_.push({
        level: "onerror",
        message: truncate(ev.message ?? "unknown error", 1000),
        stack: ev.error instanceof Error ? ev.error.stack?.slice(0, 8000) : undefined,
        at: now(),
      });
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const r = ev.reason;
      this.console_.push({
        level: "unhandledrejection",
        message: truncate(r instanceof Error ? r.message : safeStringify(r), 1000),
        stack: r instanceof Error ? r.stack?.slice(0, 8000) : undefined,
        at: now(),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    this.teardowns.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });
  }

  private installNetwork() {
    // fetch wrapper — status/timing only, never bodies.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const started = performance.now();
      const req = args[0];
      const method =
        args[1]?.method ??
        (typeof req === "object" && "method" in req ? req.method : "GET");
      const url =
        typeof req === "string"
          ? req
          : req instanceof URL
            ? req.toString()
            : req.url;
      try {
        const res = await originalFetch(...args);
        if (!res.ok) this.pushNetwork(method, url, res.status, started);
        return res;
      } catch (err) {
        this.pushNetwork(method, url, 0, started);
        throw err;
      }
    };
    this.teardowns.push(() => {
      window.fetch = originalFetch;
    });

    // XHR wrapper
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    const self = this;
    XHR.open = function (
      this: XMLHttpRequest & { __br?: { method: string; url: string } },
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__br = { method, url: url.toString() };
      // @ts-expect-error pass-through of optional async/user/password args
      return origOpen.call(this, method, url, ...rest);
    } as typeof XHR.open;
    XHR.send = function (
      this: XMLHttpRequest & { __br?: { method: string; url: string } },
      ...args: unknown[]
    ) {
      const started = performance.now();
      this.addEventListener("loadend", () => {
        const info = this.__br;
        if (info && (this.status === 0 || this.status >= 400)) {
          self.pushNetwork(info.method, info.url, this.status, started);
        }
      });
      return origSend.apply(this, args as [Document | XMLHttpRequestBodyInit | null | undefined]);
    } as typeof XHR.send;
    this.teardowns.push(() => {
      XHR.open = origOpen;
      XHR.send = origSend;
    });
  }

  private pushNetwork(method: string, url: string, status: number, started: number) {
    this.network_.push({
      method: method.toUpperCase(),
      url: truncate(redactUrl(url, this.redact?.urlParams), 2000),
      status,
      durationMs: Math.round(performance.now() - started),
      at: now(),
    });
  }

  private installBreadcrumbs() {
    const onClick = (ev: MouseEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      this.breadcrumbs_.push({
        type: "click",
        detail: truncate(cssPath(target), 500),
        at: now(),
      });
    };
    document.addEventListener("click", onClick, { capture: true, passive: true });
    this.teardowns.push(() =>
      document.removeEventListener("click", onClick, { capture: true }),
    );

    const pushNav = () => {
      this.breadcrumbs_.push({
        type: "navigation",
        detail: truncate(
          redactUrl(location.href, this.redact?.urlParams),
          500,
        ),
        at: now(),
      });
    };
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...a) => {
      origPush(...a);
      pushNav();
    };
    history.replaceState = (...a) => {
      origReplace(...a);
      pushNav();
    };
    window.addEventListener("popstate", pushNav);
    this.teardowns.push(() => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("popstate", pushNav);
    });
  }

  snapshot() {
    return {
      consoleEntries: this.console_.toArray(),
      networkErrors: this.network_.toArray(),
      breadcrumbs: this.breadcrumbs_.toArray(),
    };
  }

  destroy() {
    for (const t of this.teardowns.splice(0)) t();
  }
}

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s ?? String(value);
  } catch {
    return String(value);
  }
}
