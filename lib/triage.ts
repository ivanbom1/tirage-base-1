import { callDm, DM_MODEL } from "./dm";
import { callModel, LlmInvalidOutputError, MODEL, type ModelReply } from "./llm";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { TriageSchema, type DmInfo, type Strategy, type TriageResult, type Usage } from "./schema";

// Some models wrap JSON in a code fence even when told not to.
function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

// Use 2 (CHECK): string -> unknown -> trusted value.
function parseTriage(
  reply: ModelReply,
): { ok: true; data: TriageResult } | { ok: false; reason: string } {
  if (reply.truncated) return { ok: false, reason: "cut off" };
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(reply.text));
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const parsed = TriageSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "schema mismatch" };
}

function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

export type TriageOutcome = {
  result: TriageResult;
  usage: Usage | null; // LLM tokens summed over attempts; null if no LLM call or none reported
  attempts: number; // LLM attempts
  strategy: Strategy;
  model: string; // what produced the answer
  dm: DmInfo | null; // decision model details, null when it was not used
};

// The name logged and shown for each strategy.
export function modelName(strategy: Strategy): string {
  if (strategy === "dm") return DM_MODEL;
  if (strategy === "dm+llm") return `${DM_MODEL} + ${MODEL}`;
  return MODEL;
}

const DM_NO_TEXT = "(not generated: the decision model only decides category and priority)";

// LLM path: one call, one retry if the output is invalid (never log the ticket text or keys).
async function runLlm(user: string): Promise<{ result: TriageResult; usage: Usage | null; attempts: number }> {
  let usage: Usage | null = null;
  let reason = "invalid output";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await callModel(SYSTEM_PROMPT, user);
    usage = addUsage(usage, reply.usage);
    const parsed = parseTriage(reply);
    if (parsed.ok) return { result: parsed.data, usage, attempts: attempt };
    reason = parsed.reason;
    console.warn(`triage: invalid model output (${reason}), attempt ${attempt} of 2`);
  }
  // The tokens of the failed attempts were still spent: keep them for the log.
  throw new LlmInvalidOutputError(reason, usage);
}

export async function triageTicket(ticket: string, strategy: Strategy = "llm"): Promise<TriageOutcome> {
  const model = modelName(strategy);

  if (strategy === "llm") {
    const out = await runLlm(buildUserMessage(ticket));
    return { ...out, strategy, model, dm: null };
  }

  // The decision model decides category and priority. A failure is shown, not hidden:
  // silently falling back to the LLM would corrupt any comparison between strategies.
  const dm = await callDm(ticket);

  if (strategy === "dm") {
    return {
      result: {
        category: dm.category,
        priority: dm.priority,
        summary: DM_NO_TEXT,
        suggested_action: DM_NO_TEXT,
      },
      usage: null,
      attempts: 0,
      strategy,
      model,
      dm: dm.info,
    };
  }

  // dm+llm: the decision model decides, the LLM writes the summary and the action.
  const hint =
    `\n\nThe triage decision is already made: category=${dm.category}, priority=${dm.priority}. ` +
    `Repeat exactly these two values and write the summary and suggested_action consistent with them.`;
  const out = await runLlm(buildUserMessage(ticket) + hint);
  return {
    result: { ...out.result, category: dm.category, priority: dm.priority }, // the DM has the last word
    usage: out.usage,
    attempts: out.attempts,
    strategy,
    model,
    dm: dm.info,
  };
}