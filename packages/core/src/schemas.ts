import * as v from "valibot";

const isoTs = v.pipe(v.string(), v.isoTimestamp());

export const AssetKindSchema = v.picklist([
  "screenshot",
  "frame",
  "video",
  "audio",
]);

export const LogEntrySchema = v.object({
  level: v.picklist(["error", "warn", "unhandledrejection", "onerror"]),
  message: v.pipe(v.string(), v.maxLength(1000)),
  stack: v.optional(v.pipe(v.string(), v.maxLength(8000))),
  at: isoTs,
});

export const NetworkEntrySchema = v.object({
  method: v.pipe(v.string(), v.maxLength(10)),
  url: v.pipe(v.string(), v.maxLength(2000)),
  status: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999)),
  durationMs: v.pipe(v.number(), v.minValue(0)),
  at: isoTs,
});

export const BreadcrumbSchema = v.object({
  type: v.picklist(["click", "navigation"]),
  detail: v.pipe(v.string(), v.maxLength(500)),
  at: isoTs,
});

export const ReportContextSchema = v.object({
  url: v.pipe(v.string(), v.maxLength(2000)),
  route: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  viewport: v.object({
    width: v.number(),
    height: v.number(),
    dpr: v.number(),
  }),
  userAgent: v.pipe(v.string(), v.maxLength(500)),
  locale: v.pipe(v.string(), v.maxLength(35)),
  timezone: v.pipe(v.string(), v.maxLength(64)),
  consoleEntries: v.pipe(v.array(LogEntrySchema), v.maxLength(200)),
  networkErrors: v.pipe(v.array(NetworkEntrySchema), v.maxLength(200)),
  breadcrumbs: v.pipe(v.array(BreadcrumbSchema), v.maxLength(200)),
  custom: v.optional(v.record(v.string(), v.unknown())),
});

export const AppIdentitySchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  version: v.optional(v.pipe(v.string(), v.maxLength(100))),
  environment: v.optional(v.pipe(v.string(), v.maxLength(50))),
});

export const ReporterSchema = v.object({
  id: v.optional(v.pipe(v.string(), v.maxLength(200))),
  name: v.optional(v.pipe(v.string(), v.maxLength(200))),
  email: v.optional(v.pipe(v.string(), v.maxLength(320))),
  role: v.optional(v.pipe(v.string(), v.maxLength(100))),
});

export const ConsentRecordSchema = v.object({
  acceptedAt: isoTs,
  version: v.pipe(v.string(), v.maxLength(50)),
  textHash: v.pipe(v.string(), v.maxLength(128)),
});

export const SessionRequestSchema = v.object({
  app: AppIdentitySchema,
  reporter: v.optional(ReporterSchema),
  locale: v.optional(v.pipe(v.string(), v.maxLength(35))),
});

export const SubmitRequestSchema = v.object({
  context: ReportContextSchema,
  userComment: v.optional(v.pipe(v.string(), v.maxLength(10_000))),
  consent: ConsentRecordSchema,
  durationMs: v.optional(v.pipe(v.number(), v.minValue(0))),
});

export const AssetUploadFieldsSchema = v.object({
  kind: AssetKindSchema,
  capturedAt: isoTs,
  caption: v.optional(v.pipe(v.string(), v.maxLength(500))),
});

/** Schema the LlmAdapter's analyze() result is validated against. */
export const BugReportAnalysisSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  summary: v.pipe(v.string(), v.minLength(1), v.maxLength(4000)),
  stepsToReproduce: v.pipe(
    v.array(v.pipe(v.string(), v.maxLength(500))),
    v.maxLength(30),
  ),
  expectedBehaviour: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  actualBehaviour: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  severitySuggestion: v.picklist(["low", "medium", "high", "critical"]),
  areaSuggestion: v.optional(v.pipe(v.string(), v.maxLength(200))),
  labels: v.pipe(v.array(v.pipe(v.string(), v.maxLength(50))), v.maxLength(20)),
  confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  imageCaptions: v.optional(v.record(v.string(), v.string())),
});

export type SessionRequestOutput = v.InferOutput<typeof SessionRequestSchema>;
export type SubmitRequestOutput = v.InferOutput<typeof SubmitRequestSchema>;
export type AssetUploadFieldsOutput = v.InferOutput<
  typeof AssetUploadFieldsSchema
>;
export type BugReportAnalysisOutput = v.InferOutput<
  typeof BugReportAnalysisSchema
>;
