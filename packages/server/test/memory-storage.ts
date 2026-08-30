import type { BugReport } from "@symbiosika/bugreport-core";
import type { StorageAdapter } from "../src/interfaces";

export function createMemoryStorage(): StorageAdapter & {
  reports: Map<string, BugReport>;
  assets: Map<string, Uint8Array>;
} {
  const reports = new Map<string, BugReport>();
  const assets = new Map<string, Uint8Array>();
  let n = 0;
  return {
    reports,
    assets,
    async putAsset(reportId, asset, data) {
      const key = `${reportId}/${++n}-${asset.kind}`;
      assets.set(key, new Uint8Array(await new Response(data).arrayBuffer()));
      return { key };
    },
    async getAsset(key) {
      const bytes = assets.get(key);
      if (!bytes) throw new Error(`unknown asset ${key}`);
      return new Blob([bytes as unknown as BlobPart]).stream();
    },
    async saveReport(report) {
      reports.set(report.id, structuredClone(report));
    },
    async getReport(id) {
      const r = reports.get(id);
      return r ? structuredClone(r) : null;
    },
  };
}
