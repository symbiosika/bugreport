import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { BugReport } from "@symbiosika/bugreport-core";
import type { BugReportAction } from "@symbiosika/bugreport-server";

/**
 * Reference action: bundles the finished report (JSON + human-readable
 * Markdown + all assets) into a ZIP on the local disk.
 *
 * In production this is where a Gitea/Jira/n8n-webhook action would live —
 * same interface, a few dozen lines.
 */
export function createZipAction(outDir: string): BugReportAction {
  return {
    name: "zip-on-disk",
    async run(report, { storage, logger }) {
      const files: Record<string, Uint8Array> = {
        "report.json": strToU8(JSON.stringify(report, null, 2)),
        "report.md": strToU8(reportToMarkdown(report)),
      };
      for (const asset of report.assets) {
        const stream = await storage.getAsset(asset.key);
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        files[`assets/${asset.key.replaceAll("/", "_")}`] = bytes;
      }
      const zip = zipSync(files, { level: 6 });
      await mkdir(outDir, { recursive: true });
      const filename = `${report.createdAt.slice(0, 10)}-${report.id}.zip`;
      const path = join(outDir, filename);
      await writeFile(path, zip);
      logger.info("zip-on-disk: wrote report zip", { path });
      return { system: "zip-on-disk", externalId: filename };
    },
  };
}

function reportToMarkdown(r: BugReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.title || "Bug report (no analysis)"}`);
  lines.push("");
  lines.push(`- **ID:** ${r.id}`);
  lines.push(`- **Created:** ${r.createdAt}`);
  lines.push(`- **App:** ${r.app.id} ${r.app.version ?? ""} (${r.app.environment ?? "?"})`);
  if (r.reporter?.name || r.reporter?.email) {
    lines.push(`- **Reporter:** ${r.reporter.name ?? ""} ${r.reporter.email ?? ""}`);
  }
  lines.push(`- **Severity (suggested):** ${r.severitySuggestion}`);
  lines.push(`- **Labels:** ${r.labels.join(", ") || "–"}`);
  lines.push(`- **Analysis:** ${r.analysisStatus} (confidence ${r.confidence})`);
  lines.push("");
  if (r.summary) {
    lines.push("## Summary", "", r.summary, "");
  }
  if (r.stepsToReproduce.length > 0) {
    lines.push("## Steps to reproduce", "");
    r.stepsToReproduce.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }
  if (r.expectedBehaviour) lines.push("**Expected:** " + r.expectedBehaviour, "");
  if (r.actualBehaviour) lines.push("**Actual:** " + r.actualBehaviour, "");
  if (r.transcript?.text) {
    lines.push("## Transcript", "", `> ${r.transcript.text}`, "");
  }
  if (r.userComment) lines.push("## User comment", "", r.userComment, "");
  if (r.context.consoleEntries.length > 0) {
    lines.push("## Console", "", "```");
    for (const e of r.context.consoleEntries) {
      lines.push(`[${e.at}] ${e.level}: ${e.message}`);
      if (e.stack) lines.push(e.stack);
    }
    lines.push("```", "");
  }
  if (r.context.networkErrors.length > 0) {
    lines.push("## Failed requests", "", "```");
    for (const e of r.context.networkErrors) {
      lines.push(`[${e.at}] ${e.method} ${e.url} → ${e.status} (${e.durationMs}ms)`);
    }
    lines.push("```", "");
  }
  lines.push("## Assets", "");
  for (const a of r.assets) {
    lines.push(
      `- \`${a.key}\` (${a.kind}, ${a.mimeType}, ${a.bytes} bytes${a.usedInAnalysis ? ", used in analysis" : ""})`,
    );
  }
  return lines.join("\n");
}
