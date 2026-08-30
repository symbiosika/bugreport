import * as v from "valibot";
import {
  BugReportAnalysisSchema,
  type AnalysisInput,
  type BugReport,
} from "@symbiosika/bugreport-core";
import type {
  BugReportAction,
  Logger,
  LlmAdapter,
  StorageAdapter,
} from "./interfaces";
import { selectFramesForAnalysis } from "./frame-selection";

export interface PipelineOptions {
  storage: StorageAdapter;
  llm?: LlmAdapter;
  actions: BugReportAction[];
  logger: Logger;
  maxImagesToLlm: number;
  locale?: string;
  recordingDurationMs?: number;
}

async function streamToUint8Array(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Runs the processing pipeline on a submitted report:
 * transcription → frame selection → analysis → save → actions.
 *
 * Failures in transcription or analysis never lose the report — it is saved
 * with analysisStatus 'failed' instead.
 */
export async function runPipeline(
  report: BugReport,
  opts: PipelineOptions,
): Promise<BugReport> {
  const { storage, llm, actions, logger } = opts;

  let analysisStatus: BugReport["analysisStatus"] = llm ? "ok" : "skipped";

  // 1. Transcription
  if (llm) {
    const audio = report.assets.find((a) => a.kind === "audio");
    if (audio) {
      try {
        const bytes = await streamToUint8Array(await storage.getAsset(audio.key));
        const blob = new Blob([bytes as BlobPart], { type: audio.mimeType });
        report.transcript = await llm.transcribe(blob, {
          language: opts.locale,
        });
        logger.info("bugreport: transcription done", {
          reportId: report.id,
          chars: report.transcript.text.length,
        });
      } catch (err) {
        analysisStatus = "failed";
        logger.error("bugreport: transcription failed", {
          reportId: report.id,
          error: String(err),
        });
      }
    }
  }

  // 2. Frame selection (provider independent, always runs)
  const firstImage = report.assets.find(
    (a) => a.kind === "frame" || a.kind === "screenshot",
  );
  const selectedKeys = selectFramesForAnalysis({
    assets: report.assets,
    transcript: report.transcript,
    recordingStartedAt: firstImage?.capturedAt,
    recordingDurationMs: opts.recordingDurationMs,
    maxImages: opts.maxImagesToLlm,
  });
  for (const asset of report.assets) {
    asset.usedInAnalysis = selectedKeys.includes(asset.key);
  }

  // 3. Analysis
  if (llm && analysisStatus === "ok") {
    try {
      const images: AnalysisInput["images"] = [];
      for (const key of selectedKeys) {
        const meta = report.assets.find((a) => a.key === key);
        if (!meta) continue;
        images.push({
          key,
          kind: meta.kind,
          mimeType: meta.mimeType,
          capturedAt: meta.capturedAt,
          data: await streamToUint8Array(await storage.getAsset(key)),
        });
      }
      const raw = await llm.analyze({
        app: report.app,
        reporter: report.reporter,
        transcript: report.transcript,
        userComment: report.userComment,
        context: report.context,
        images,
        locale: opts.locale,
      });
      const analysis = v.parse(BugReportAnalysisSchema, raw);
      report.title = analysis.title;
      report.summary = analysis.summary;
      report.stepsToReproduce = analysis.stepsToReproduce;
      report.expectedBehaviour = analysis.expectedBehaviour;
      report.actualBehaviour = analysis.actualBehaviour;
      report.severitySuggestion = analysis.severitySuggestion;
      report.areaSuggestion = analysis.areaSuggestion;
      report.labels = analysis.labels;
      report.confidence = analysis.confidence;
      if (analysis.imageCaptions) {
        for (const asset of report.assets) {
          const caption = analysis.imageCaptions[asset.key];
          if (caption) asset.caption = caption;
        }
      }
      logger.info("bugreport: analysis done", {
        reportId: report.id,
        title: analysis.title,
      });
    } catch (err) {
      analysisStatus = "failed";
      logger.error("bugreport: analysis failed", {
        reportId: report.id,
        error: String(err),
      });
    }
  }

  report.analysisStatus = analysisStatus;
  report.status = "done";

  // 4. Save the assembled report before actions run.
  await storage.saveReport(report);

  // 5. Actions — sequential, fault tolerant.
  for (const action of actions) {
    try {
      const result = await action.run(report, { logger, storage });
      report.actionResults.push({ system: action.name, ...(result ?? {}) });
      logger.info("bugreport: action done", {
        reportId: report.id,
        action: action.name,
      });
    } catch (err) {
      report.actionResults.push({ system: action.name, error: String(err) });
      logger.error("bugreport: action failed", {
        reportId: report.id,
        action: action.name,
        error: String(err),
      });
    }
  }

  await storage.saveReport(report);
  return report;
}
