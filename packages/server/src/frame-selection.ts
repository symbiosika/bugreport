import type { AssetMeta } from "@symbiosika/bugreport-core";

/**
 * Words in the transcript that hint the user is pointing at something on
 * screen. Frames captured around those moments are prioritised.
 */
const HINT_WORDS_DE = [
  "hier",
  "jetzt",
  "das da",
  "fehler",
  "stürzt ab",
  "kaputt",
  "falsch",
  "problem",
  "meldung",
];
const HINT_WORDS_EN = [
  "here",
  "now",
  "this one",
  "error",
  "crash",
  "broken",
  "wrong",
  "problem",
  "message",
];

export interface FrameSelectionInput {
  assets: AssetMeta[];
  transcript?: { text: string; language: string };
  /** Wall-clock start of the recording; hint matching needs it to map
   * transcript position to capture time. Optional — without it only the
   * priority rules (manual shots, first/last frame) apply. */
  recordingStartedAt?: string;
  recordingDurationMs?: number;
  maxImages: number;
}

/**
 * Provider-independent image selection heuristic:
 *   (a) manual screenshots first,
 *   (b) frames from time windows where the transcript contains hint words,
 *   (c) first and last frame,
 * capped at maxImages.
 *
 * Returns asset keys in capture order.
 */
export function selectFramesForAnalysis(input: FrameSelectionInput): string[] {
  const images = input.assets
    .filter((a) => a.kind === "screenshot" || a.kind === "frame")
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (images.length === 0) return [];

  const selected = new Set<string>();
  const push = (key: string) => {
    if (selected.size < input.maxImages) selected.add(key);
  };

  // (a) manual screenshots
  for (const a of images) if (a.kind === "screenshot") push(a.key);

  // (b) hint-word windows
  const frames = images.filter((a) => a.kind === "frame");
  if (
    input.transcript &&
    input.recordingStartedAt &&
    input.recordingDurationMs &&
    frames.length > 0
  ) {
    const words = input.transcript.language.startsWith("de")
      ? HINT_WORDS_DE
      : HINT_WORDS_EN;
    const text = input.transcript.text.toLowerCase();
    const start = Date.parse(input.recordingStartedAt);
    const dur = input.recordingDurationMs;
    for (const word of words) {
      let idx = text.indexOf(word);
      while (idx !== -1) {
        // Approximate the moment: position in text ~ position in time.
        const t = start + (idx / Math.max(text.length, 1)) * dur;
        let best: AssetMeta | undefined;
        let bestDist = Infinity;
        for (const f of frames) {
          const dist = Math.abs(Date.parse(f.capturedAt) - t);
          if (dist < bestDist) {
            bestDist = dist;
            best = f;
          }
        }
        if (best && bestDist < 10_000) push(best.key);
        idx = text.indexOf(word, idx + 1);
      }
    }
  }

  // (c) first and last frame
  const first = images[0];
  const last = images[images.length - 1];
  if (first) push(first.key);
  if (last) push(last.key);

  // Return in capture order.
  return images.filter((a) => selected.has(a.key)).map((a) => a.key);
}
