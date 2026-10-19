import OpenAI from "openai";
import { z } from "zod";
import { TriageSchema, type Usage } from "./schema";


export class LlmInvalidOutputError extends Error {
  usage: Usage | null;
  constructor(message: string, usage: Usage | null = null) {
    super(message);
    this.name = "LlmInvalidOutputError";
    this.usage = usage;
  }
}

// Timeout is per attempt, not per operation.
const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
  timeout: 20_000,
  maxRetries: 2,
});

export const MODEL = process.env.LLM_MODEL!;
export const API_NAME = "chat_completions";

const MODE =
  process.env.LLM_STRUCTURED_OUTPUT === "json_schema" ? "json_schema" : "prompt";

// Use 1 (ASK): the same Zod contract, as JSON Schema.
const { $schema, ...generated } = z.toJSONSchema(TriageSchema);
void $schema;
const jsonSchema = { ...generated, additionalProperties: false };

export type ModelReply = {
  text: string;
  usage: Usage | null; // null when the endpoint reports no usage
  truncated: boolean; // true when the answer was cut off
};

export async function callModel(system: string, user: string): Promise<ModelReply> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(MODE === "json_schema"
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: "support_triage",
              strict: true,
              schema: jsonSchema,
            },
          },
        }
      : {}),
  });

  const choice = completion.choices[0];
  if (!choice) throw new LlmInvalidOutputError("no choices");

  const u = completion.usage;
  const usage: Usage | null =
    u && typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number"
      ? {
          input_tokens: u.prompt_tokens,
          output_tokens: u.completion_tokens,
          total_tokens: u.total_tokens ?? u.prompt_tokens + u.completion_tokens,
        }
      : null;

  return {
    text: choice.message.content ?? "",
    usage,
    truncated: choice.finish_reason === "length",
  };
}