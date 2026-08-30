import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
  BugReportAnalysisSchema,
  SessionRequestSchema,
  SubmitRequestSchema,
  fnv1aHex,
} from "../src/index";

const validContext = {
  url: "https://app.example.com/orders",
  viewport: { width: 1280, height: 800, dpr: 2 },
  userAgent: "Mozilla/5.0",
  locale: "de-DE",
  timezone: "Europe/Berlin",
  consoleEntries: [
    {
      level: "error",
      message: "TypeError: x is undefined",
      at: new Date().toISOString(),
    },
  ],
  networkErrors: [],
  breadcrumbs: [],
};

describe("SessionRequestSchema", () => {
  test("accepts a minimal valid request", () => {
    const r = v.safeParse(SessionRequestSchema, { app: { id: "demo" } });
    expect(r.success).toBe(true);
  });

  test("rejects a missing app id", () => {
    const r = v.safeParse(SessionRequestSchema, { app: {} });
    expect(r.success).toBe(false);
  });
});

describe("SubmitRequestSchema", () => {
  test("accepts a valid submit body", () => {
    const r = v.safeParse(SubmitRequestSchema, {
      context: validContext,
      consent: {
        acceptedAt: new Date().toISOString(),
        version: "1.0",
        textHash: "abc",
      },
    });
    expect(r.success).toBe(true);
  });

  test("rejects a non-ISO timestamp", () => {
    const r = v.safeParse(SubmitRequestSchema, {
      context: validContext,
      consent: { acceptedAt: "yesterday", version: "1.0", textHash: "abc" },
    });
    expect(r.success).toBe(false);
  });
});

describe("BugReportAnalysisSchema", () => {
  test("accepts a full analysis", () => {
    const r = v.safeParse(BugReportAnalysisSchema, {
      title: "Save button crashes",
      summary: "Clicking save throws a TypeError.",
      stepsToReproduce: ["Open orders", "Click save"],
      severitySuggestion: "high",
      labels: ["bug", "orders"],
      confidence: 0.9,
    });
    expect(r.success).toBe(true);
  });

  test("rejects confidence outside 0..1", () => {
    const r = v.safeParse(BugReportAnalysisSchema, {
      title: "t",
      summary: "s",
      stepsToReproduce: [],
      severitySuggestion: "low",
      labels: [],
      confidence: 1.5,
    });
    expect(r.success).toBe(false);
  });
});

describe("fnv1aHex", () => {
  test("is stable and distinguishes inputs", () => {
    expect(fnv1aHex("consent v1")).toBe(fnv1aHex("consent v1"));
    expect(fnv1aHex("consent v1")).not.toBe(fnv1aHex("consent v2"));
    expect(fnv1aHex("")).toHaveLength(8);
  });
});
