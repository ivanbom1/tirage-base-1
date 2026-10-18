import OpenAI from "openai";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const MODEL = process.env.LLM_MODEL!;

// Triage v1: plain text straight back. No JSON, no Zod
export async function triageTicket(ticket: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(ticket) },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}