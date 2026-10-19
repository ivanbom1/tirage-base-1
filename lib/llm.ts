import OpenAI from "openai";
import { z } from "zod";
import { TriageSchema } from "./schema";

export class LlmInvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmInvalidOutputError";
  }
}

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
  timeout: 20_000,
  maxRetries: 2,
});

const MODEL = process.env.LLM_MODEL!;

const MODE =
  process.env.LLM_STRUCTURED_OUTPUT === "json_schema" ? "json_schema" : "prompt";

// Use 1 (ASK): the same Zod contract, as JSON Schema
const { $schema, ...generated } = z.toJSONSchema(TriageSchema);
void $schema;
const jsonSchema = { ...generated, additionalProperties: false };

// Returns the raw text of the model's answer
export async function callModel(system: string, user: string): Promise<string> {
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
  // The JSON is incomplete, so the output is invalid
  if (choice.finish_reason === "length") {
    throw new LlmInvalidOutputError("cut off");
  }
  return choice.message.content ?? "";
}