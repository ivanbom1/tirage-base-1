import { callModel, LlmInvalidOutputError } from "./llm";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { TriageSchema, type TriageResult } from "./schema";

// Some models wrap JSON in a code fence even when told not to.
function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

// Use 2 (CHECK): string -> unknown -> trusted value.
function parseTriage(text: string): TriageResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new LlmInvalidOutputError("not JSON");
  }
  const parsed = TriageSchema.safeParse(raw);
  if (!parsed.success) throw new LlmInvalidOutputError("schema mismatch");
  return parsed.data;
}

export async function triageTicket(ticket: string): Promise<TriageResult> {
  const user = buildUserMessage(ticket);
  try {
    return parseTriage(await callModel(SYSTEM_PROMPT, user));
  } catch (err) {
    if (!(err instanceof LlmInvalidOutputError)) throw err;
    // Invalid output: retry once, logged (never log the ticket text or keys).
    console.warn("triage: invalid model output, retrying once:", err.message);
    return parseTriage(await callModel(SYSTEM_PROMPT, user));
  }
}