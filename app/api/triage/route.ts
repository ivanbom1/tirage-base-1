import OpenAI from "openai";
import { DmError } from "../../../lib/dm";
import { LlmInvalidOutputError } from "../../../lib/llm";
import { TriageRequestSchema } from "../../../lib/schema";
import { triageTicket } from "../../../lib/triage";

const fail = (status: number, code: string, message: string) =>
  Response.json({ error: message, code }, { status });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad_request", "Invalid JSON body.");
  }

  const req = TriageRequestSchema.safeParse(body);
  if (!req.success) {
    return fail(400, "bad_request", "Please provide a non-empty ticket (at most 20000 characters).");
  }

  try {
    const outcome = await triageTicket(req.data.ticket, req.data.strategy);
    // Result fields, token usage (null if none), strategy, model and decision model details.
    return Response.json({
      ...outcome.result,
      usage: outcome.usage,
      strategy: outcome.strategy,
      model: outcome.model,
      dm: outcome.dm,
    });
  } catch (err) {
    if (err instanceof DmError) {
      if (err.code === "dm_not_configured") {
        return fail(500, "dm_not_configured", "The decision model is not configured (set DM_API_KEY in .env).");
      }
      if (err.status === 429) return fail(429, "rate_limited", "Decision model rate limit reached. Please wait and try again.");
      if (err.status === 504) return fail(504, "triage_timeout", "The decision model timed out. Please try again.");
      if (err.status >= 500) return fail(502, "triage_unavailable", "The decision model is unavailable. Please try again later.");
      console.error("decision model error:", err.status, err.code);
      return fail(500, "internal_error", "Something went wrong on our side.");
    }
    if (err instanceof LlmInvalidOutputError) {
      return fail(502, "invalid_model_output", "The model returned an invalid answer. Please try again.");
    }
    if (err instanceof OpenAI.APIConnectionTimeoutError) {
      return fail(504, "triage_timeout", "The triage request timed out. Please try again.");
    }
    if (err instanceof OpenAI.RateLimitError) {
      return fail(429, "rate_limited", "Rate limit reached. Please wait a moment and try again.");
    }
    if (
      err instanceof OpenAI.APIConnectionError ||
      (err instanceof OpenAI.APIError && (err.status ?? 0) >= 500)
    ) {
      return fail(502, "triage_unavailable", "The triage service is unavailable. Please try again later.");
    }
    console.error(
      "triage internal error:",
      err instanceof OpenAI.APIError ? `status ${err.status}` : err instanceof Error ? err.name : "unknown",
    );
    return fail(500, "internal_error", "Something went wrong on our side.");
  }
}