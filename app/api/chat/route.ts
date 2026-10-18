import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const MODEL = process.env.LLM_MODEL!;

const SYSTEM_PROMPT = "You are a helpful assistant. Answer concisely.";

type ChatMessage = { role: "user" | "assistant"; content: string };

function isValidHistory(h: unknown): h is ChatMessage[] {
  return (
    Array.isArray(h) &&
    h.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "string" ||
    !body.message.trim()
  ) {
    return Response.json(
      { error: "Please provide a non-empty message string." },
      { status: 400 },
    );
  }

  const history = "history" in body ? body.history : [];
  if (!isValidHistory(history)) {
    return Response.json({ error: "Invalid history." }, { status: 400 });
  }

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-20),
        { role: "user", content: body.message },
      ],
    });

    return Response.json({
      answer: response.choices[0]?.message?.content ?? "",
    });
  } catch (err) {
    console.error("Model call failed:", err);
    return Response.json(
      { error: "The model request failed." },
      { status: 502 },
    );
  }
}