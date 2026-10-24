import { z } from "zod";

// The contract, written once. Used to ASK (JSON Schema) and to CHECK (safeParse).
export const TriageSchema = z.object({
  category: z.enum(["billing", "technical_bug", "account", "feature_request"]),
  priority: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(300),
  suggested_action: z.string().min(1).max(500),
});

export type TriageResult = z.infer<typeof TriageSchema>;

// How a ticket is triaged: LLM only, decision model only, or decision model decides + LLM writes.
export const STRATEGIES = ["llm", "dm", "dm+llm"] as const;
export const StrategySchema = z.enum(STRATEGIES);
export type Strategy = z.infer<typeof StrategySchema>;

// What the browser may send to POST /api/triage. strategy defaults to "llm".
export const TriageRequestSchema = z.object({
  ticket: z.string().trim().min(1).max(20000),
  strategy: StrategySchema.default("llm"),
});

// Token usage of one triage request (summed over attempts).
export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

// What the decision model said (null when it was not used).
export const DmInfoSchema = z.object({
  model: z.string(),
  usage: UsageSchema,
  category_confidence: z.number().nullable(),
  priority_confidence: z.number().nullable(),
});

export type DmInfo = z.infer<typeof DmInfoSchema>;

// What POST /api/triage returns on success.
// usage = LLM tokens (null if no LLM call, or the endpoint reports none). dm = decision model details.
export const TriageResponseSchema = TriageSchema.extend({
  usage: UsageSchema.nullable(),
  strategy: StrategySchema,
  model: z.string(),
  dm: DmInfoSchema.nullable(),
});

export type TriageResponse = z.infer<typeof TriageResponseSchema>;