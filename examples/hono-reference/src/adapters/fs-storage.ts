import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { Writable } from "node:stream";
import type { BugReport } from "@symbiosika/bugreport-core";
import type { StorageAdapter } from "@symbiosika/bugreport-server";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "video/webm": "webm",
};

/**
 * Reference StorageAdapter: plain filesystem. Assets land in
 * `<dataDir>/assets/<reportId>/…`, reports in `<dataDir>/reports/<id>.json`.
 *
 * Swap this for S3/GCS/DB in production — the interface stays the same.
 * Retention/deletion policy is the host's job; a cron that removes old
 * report directories is all it takes here.
 */
export function createFsStorage(dataDir: string): StorageAdapter {
  let counter = 0;
  return {
    async putAsset(reportId, asset, data) {
      const baseType = asset.mimeType.split(";")[0] ?? asset.mimeType;
      const ext = EXT[baseType] ?? "bin";
      const key = `${reportId}/${String(++counter).padStart(3, "0")}-${asset.kind}.${ext}`;
      const path = join(dataDir, "assets", key);
      await mkdir(dirname(path), { recursive: true });
      await data.pipeTo(Writable.toWeb(createWriteStream(path)) as WritableStream<Uint8Array>);
      return { key };
    },

    async getAsset(key) {
      // Keys are storage-internal; still, never let them escape the data dir.
      if (key.includes("..")) throw new Error("invalid asset key");
      const bytes = await readFile(join(dataDir, "assets", key));
      return new Blob([bytes as unknown as BlobPart]).stream();
    },

    async saveReport(report: BugReport) {
      const path = join(dataDir, "reports", `${report.id}.json`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(report, null, 2));
    },

    async getReport(reportId: string) {
      if (!/^[0-9a-fA-F-]+$/.test(reportId)) return null;
      try {
        const raw = await readFile(
          join(dataDir, "reports", `${reportId}.json`),
          "utf8",
        );
        return JSON.parse(raw) as BugReport;
      } catch {
        return null;
      }
    },
  };
}
