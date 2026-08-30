import { describe, expect, test } from "bun:test";
import type { AssetMeta } from "@symbiosika/bugreport-core";
import { selectFramesForAnalysis } from "../src/frame-selection";

const t0 = Date.parse("2026-08-30T10:00:00.000Z");
const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();

function asset(
  key: string,
  kind: AssetMeta["kind"],
  offsetMs: number,
): AssetMeta {
  return {
    key,
    kind,
    mimeType: "image/jpeg",
    bytes: 1000,
    capturedAt: at(offsetMs),
    usedInAnalysis: false,
  };
}

describe("selectFramesForAnalysis", () => {
  test("returns empty for no images", () => {
    expect(
      selectFramesForAnalysis({
        assets: [asset("a", "audio", 0)],
        maxImages: 6,
      }),
    ).toEqual([]);
  });

  test("prioritises manual screenshots, then first/last frame", () => {
    const keys = selectFramesForAnalysis({
      assets: [
        asset("f1", "frame", 0),
        asset("f2", "frame", 4000),
        asset("s1", "screenshot", 6000),
        asset("f3", "frame", 8000),
      ],
      maxImages: 3,
    });
    expect(keys).toContain("s1");
    expect(keys).toContain("f1"); // first
    expect(keys).toContain("f3"); // last
    expect(keys).toHaveLength(3);
  });

  test("caps at maxImages", () => {
    const assets = Array.from({ length: 10 }, (_, i) =>
      asset(`s${i}`, "screenshot", i * 1000),
    );
    const keys = selectFramesForAnalysis({ assets, maxImages: 4 });
    expect(keys).toHaveLength(4);
  });

  test("picks frames near transcript hint words", () => {
    // 60s recording, "hier" appears in the middle of the transcript,
    // so the frame around 30s should be selected.
    const transcriptHalf = "a".repeat(500);
    const keys = selectFramesForAnalysis({
      assets: [
        asset("f0", "frame", 0),
        asset("f30", "frame", 30_000),
        asset("f60", "frame", 60_000),
      ],
      transcript: {
        text: `${transcriptHalf} hier ist der fehler ${transcriptHalf}`,
        language: "de",
      },
      recordingStartedAt: at(0),
      recordingDurationMs: 60_000,
      maxImages: 6,
    });
    expect(keys).toContain("f30");
  });

  test("returns keys in capture order", () => {
    const keys = selectFramesForAnalysis({
      assets: [
        asset("f1", "frame", 0),
        asset("s1", "screenshot", 2000),
        asset("f2", "frame", 4000),
      ],
      maxImages: 6,
    });
    expect(keys).toEqual(["f1", "s1", "f2"]);
  });
});
