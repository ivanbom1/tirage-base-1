import { z } from "zod";
import { DmInfoSchema, StrategySchema, TriageSchema, UsageSchema } from "./schema";

export const DATASET_IDS = ["labelled100", "tickets500"] as const;

// What the browser may send to POST /api/smoke.
export const SmokeRequestSchema = z.object({
  dataset: z.enum(DATASET_IDS),
  sampleSize: z.number().int().min(1).max(50),
  strategy: StrategySchema.default("llm"),
});

export const SmokeRowSchema = z.object({
  ticket_id: z.string(),
  subject: z.string(),
  predicted: TriageSchema.nullable(), // null when this ticket failed
  labelled: z.object({ category: z.string(), priority: z.string() }).nullable(),
  error: z.string().nullable(),
  usage: UsageSchema.nullable(), // LLM tokens
  dm: DmInfoSchema.nullable(),
});

export const SmokeSummarySchema = z.object({
  total: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  // null for an unlabelled dataset
  categoryMismatches: z.number().nullable(),
  priorityMismatches: z.number().nullable(),
  totalTokens: z.number().nullable(),
});

export const SmokeResponseSchema = z.object({
  dataset: z.enum(DATASET_IDS),
  strategy: StrategySchema,
  model: z.string(),
  labelled: z.boolean(),
  rows: z.array(SmokeRowSchema),
  summary: SmokeSummarySchema,
});

export type SmokeRow = z.infer<typeof SmokeRowSchema>;
export type SmokeResponse = z.infer<typeof SmokeResponseSchema>;