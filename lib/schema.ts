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