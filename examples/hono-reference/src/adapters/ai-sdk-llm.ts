import { generateObject, jsonSchema, type ModelMessage, type UserContent } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  AnalysisInput,
  BugReportAnalysis,
} from "@symbiosika/bugreport-core";
import {
  buildAnalysisPrompt,
  type LlmAdapter,
} from "@symbiosika/bugreport-server";

export interface AiSdkLlmOptions {
  openrouterApiKey: string;
  mistralApiKey: string;
  /** Vision-capable model on OpenRouter. */
  analysisModel?: string;
  /** Mistral audio transcription model. */
  transcriptionModel?: string;
  /** Custom fetch implementation (corporate proxy, logging, sandboxes). */
  fetch?: typeof fetch;
}

/**
 * Reference LlmAdapter built on the Vercel AI SDK.
 *
 * This is deliberately NOT part of the library — which provider, model,
 * prompt or deployment is used is a per-host decision (data protection,
 * on-prem, cost). This file is a copy template:
 *
 *  - analyze():    AI SDK `generateObject` against an OpenRouter vision model,
 *                  prompt built by the optional `buildAnalysisPrompt` helper.
 *  - transcribe(): Mistral Voxtral via the audio/transcriptions REST endpoint.
 */
export function createAiSdkLlmAdapter(opts: AiSdkLlmOptions): LlmAdapter {
  const doFetch = opts.fetch ?? fetch;
  const openrouter = createOpenRouter({
    apiKey: opts.openrouterApiKey,
    fetch: opts.fetch as never,
  });
  const analysisModel = opts.analysisModel ?? "google/gemini-2.5-flash";
  const transcriptionModel = opts.transcriptionModel ?? "voxtral-mini-latest";

  return {
    async transcribe(audio, { language }) {
      const form = new FormData();
      const ext = audio.type.includes("wav")
        ? "wav"
        : audio.type.includes("mp3") || audio.type.includes("mpeg")
          ? "mp3"
          : "webm";
      form.set("file", audio, `audio.${ext}`);
      form.set("model", transcriptionModel);
      if (language) form.set("language", language.slice(0, 2));

      const res = await doFetch("https://api.mistral.ai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${opts.mistralApiKey}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(
          `mistral transcription failed: ${res.status} ${await res.text()}`,
        );
      }
      const data = (await res.json()) as { text: string; language?: string };
      return { text: data.text, language: data.language ?? language ?? "unknown" };
    },

    async analyze(input: AnalysisInput): Promise<BugReportAnalysis> {
      // The library ships this prompt template as a pure string builder —
      // use it, extend it, or write your own.
      const prompt = buildAnalysisPrompt(input);
      const imageByKey = new Map(input.images.map((i) => [i.key, i]));

      const messages: ModelMessage[] = prompt.messages.map((m) => {
        const content: UserContent = [];
        for (const part of m.content) {
          if (part.type === "text" && part.text) {
            content.push({ type: "text", text: part.text });
          } else if (part.type === "image" && part.imageKey) {
            const img = imageByKey.get(part.imageKey);
            if (img) {
              content.push({
                type: "image",
                image: img.data,
                mediaType: img.mimeType,
              });
            }
          }
        }
        return { role: m.role, content };
      });

      const { object } = await generateObject({
        model: openrouter(analysisModel),
        system: prompt.system,
        messages,
        schema: analysisJsonSchema,
      });
      // The pipeline re-validates against BugReportAnalysisSchema (valibot);
      // clamp the only numeric field defensively.
      object.confidence = Math.max(0, Math.min(1, object.confidence));
      return object;
    },
  };
}

const analysisJsonSchema = jsonSchema<BugReportAnalysis>({
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "stepsToReproduce",
    "severitySuggestion",
    "labels",
    "confidence",
  ],
  properties: {
    title: { type: "string", description: "Short bug title (max 200 chars)" },
    summary: {
      type: "string",
      description: "Markdown summary, 2-5 sentences",
    },
    stepsToReproduce: { type: "array", items: { type: "string" } },
    expectedBehaviour: { type: "string" },
    actualBehaviour: { type: "string" },
    severitySuggestion: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
    },
    areaSuggestion: { type: "string" },
    labels: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
});
