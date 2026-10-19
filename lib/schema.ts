import { z } from "zod";

// The contract, written once. Used to ASK (JSON Schema) and to CHECK (safeParse).
export const TriageSchema = z.object({
  category: z.enum(["billing", "technical_bug", "account", "feature_request"]),
  priority: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(300),
  suggested_action: z.string().min(1).max(500),
});

export type TriageResult = z.infer<typeof TriageSchema>;

export const TriageRequestSchema = z.object({
  ticket: z.string().trim().min(1).max(20000),
});

// Token usage of one triage request (summed over attempts).
export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

// What POST /api/triage returns on success, usage is null when the endpoint reports none
export const TriageResponseSchema = TriageSchema.extend({
  usage: UsageSchema.nullable(),
});

export type TriageResponse = z.infer<typeof TriageResponseSchema>;