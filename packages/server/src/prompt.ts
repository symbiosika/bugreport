import type { AnalysisInput } from "@symbiosika/bugreport-core";

export interface AnalysisPromptMessagePart {
  type: "text" | "image";
  /** For text parts. */
  text?: string;
  /** For image parts: the asset key — the adapter resolves it to bytes it
   * already has in `input.images`. */
  imageKey?: string;
}

export interface AnalysisPrompt {
  system: string;
  messages: Array<{ role: "user"; content: AnalysisPromptMessagePart[] }>;
}

/**
 * Optional prompt template — a pure string builder, no adapter, no network.
 * Hosts can use it as-is, extend it, or ignore it entirely.
 */
export function buildAnalysisPrompt(input: AnalysisInput): AnalysisPrompt {
  const lang = input.locale?.startsWith("de") ? "de" : "en";

  const system =
    lang === "de"
      ? `Du bist ein Assistent, der Bug-Reports aus Endnutzer-Aufnahmen erstellt. Du bekommst ein Transkript der gesprochenen Fehlerbeschreibung, ausgewählte Screenshots und technischen Kontext (Konsole, Netzwerkfehler, Breadcrumbs). Erstelle daraus einen strukturierten, für Entwickler nützlichen Bug-Report. Antworte auf Deutsch. Erfinde nichts — wenn Informationen fehlen, lass die Felder knapp oder leer und senke confidence.`
      : `You are an assistant that turns end-user recordings into bug reports. You receive a transcript of the spoken problem description, selected screenshots and technical context (console, network errors, breadcrumbs). Produce a structured bug report useful to developers. Do not invent facts — if information is missing, keep fields short or empty and lower the confidence.`;

  const parts: AnalysisPromptMessagePart[] = [];

  const meta: string[] = [];
  meta.push(`App: ${input.app.id}`);
  if (input.app.version) meta.push(`Version: ${input.app.version}`);
  if (input.app.environment) meta.push(`Environment: ${input.app.environment}`);
  meta.push(`URL: ${input.context.url}`);
  if (input.context.route) meta.push(`Route: ${input.context.route}`);
  meta.push(
    `Viewport: ${input.context.viewport.width}x${input.context.viewport.height} @${input.context.viewport.dpr}x`,
  );
  meta.push(`User agent: ${input.context.userAgent}`);
  meta.push(`Locale: ${input.context.locale}, TZ: ${input.context.timezone}`);
  parts.push({ type: "text", text: meta.join("\n") });

  if (input.transcript?.text) {
    parts.push({
      type: "text",
      text: `Transcript (${input.transcript.language}):\n${input.transcript.text}`,
    });
  }
  if (input.userComment) {
    parts.push({ type: "text", text: `User comment:\n${input.userComment}` });
  }

  if (input.context.consoleEntries.length > 0) {
    const lines = input.context.consoleEntries
      .slice(-30)
      .map((e) => `[${e.at}] ${e.level}: ${e.message}${e.stack ? `\n${e.stack}` : ""}`);
    parts.push({ type: "text", text: `Console entries:\n${lines.join("\n")}` });
  }
  if (input.context.networkErrors.length > 0) {
    const lines = input.context.networkErrors
      .slice(-30)
      .map((e) => `[${e.at}] ${e.method} ${e.url} → ${e.status} (${e.durationMs}ms)`);
    parts.push({ type: "text", text: `Failed requests:\n${lines.join("\n")}` });
  }
  if (input.context.breadcrumbs.length > 0) {
    const lines = input.context.breadcrumbs
      .slice(-30)
      .map((b) => `[${b.at}] ${b.type}: ${b.detail}`);
    parts.push({ type: "text", text: `Breadcrumbs:\n${lines.join("\n")}` });
  }
  if (input.context.custom && Object.keys(input.context.custom).length > 0) {
    parts.push({
      type: "text",
      text: `App state:\n${JSON.stringify(input.context.custom, null, 2).slice(0, 4000)}`,
    });
  }

  for (const img of input.images) {
    parts.push({
      type: "text",
      text: `Image "${img.key}" (${img.kind}, captured ${img.capturedAt}):`,
    });
    parts.push({ type: "image", imageKey: img.key });
  }

  return { system, messages: [{ role: "user", content: parts }] };
}
