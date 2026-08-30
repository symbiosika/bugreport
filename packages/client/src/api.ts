import type {
  AssetKind,
  BugReportPublicConfig,
  SessionRequest,
  SubmitRequest,
} from "@symbiosika/bugreport-core";
import type { BugReportClientConfig } from "./types";

export class ApiClient {
  constructor(private config: BugReportClientConfig) {}

  private async headers(json = false): Promise<Record<string, string>> {
    const auth = this.config.getAuthHeaders
      ? await this.config.getAuthHeaders()
      : {};
    return json ? { ...auth, "content-type": "application/json" } : auth;
  }

  private url(path: string): string {
    return `${this.config.endpoint.replace(/\/$/, "")}/${path}`;
  }

  async getConfig(): Promise<BugReportPublicConfig> {
    const res = await fetch(this.url("config"), {
      headers: await this.headers(),
    });
    if (!res.ok) throw new Error(`bugreport config failed: ${res.status}`);
    return res.json();
  }

  async openSession(body: SessionRequest): Promise<string> {
    const res = await fetch(this.url("session"), {
      method: "POST",
      headers: await this.headers(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bugreport session failed: ${res.status}`);
    const data = (await res.json()) as { reportId: string };
    return data.reportId;
  }

  async uploadAsset(
    reportId: string,
    blob: Blob,
    meta: { kind: AssetKind; capturedAt: string; caption?: string },
  ): Promise<string> {
    const form = new FormData();
    form.set("kind", meta.kind);
    form.set("capturedAt", meta.capturedAt);
    if (meta.caption) form.set("caption", meta.caption);
    form.set("file", blob, `${meta.kind}-${meta.capturedAt}`);
    const res = await fetch(this.url(`${reportId}/asset`), {
      method: "PUT",
      headers: await this.headers(),
      body: form,
    });
    if (!res.ok) throw new Error(`bugreport asset upload failed: ${res.status}`);
    const data = (await res.json()) as { key: string };
    return data.key;
  }

  async submit(reportId: string, body: SubmitRequest): Promise<void> {
    const res = await fetch(this.url(`${reportId}/submit`), {
      method: "POST",
      headers: await this.headers(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bugreport submit failed: ${res.status}`);
  }
}
