import OpenAI from "openai";
import { LlmInvalidOutputError } from "../../../lib/llm";
import { TriageRequestSchema } from "../../../lib/schema";
import { triageTicket } from "../../../lib/triage";


function fail(status: number, code: string, message: string) {
  return Response.json({ error: message, code }, { status });
}


export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad_request", "Invalid JSON body.");
  }


  const req = TriageRequestSchema.safeParse(body);
  if (!req.success) {
    return fail(
      400,
      "bad_request",
      "Please provide a non-empty ticket (at most 20000 characters).",
    );
  }


  try {
    const result = await triageTicket(req.data.ticket);
    return Response.json(result);
  } catch (err) {
    if (err instanceof LlmInvalidOutputError) {
      return fail(
        502,
        "invalid_model_output",
        "The model returned an invalid answer. Please try again.",
      );
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