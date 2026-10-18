import { triageTicket } from "../../../lib/triage";

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
    !("ticket" in body) ||
    typeof body.ticket !== "string" ||
    !body.ticket.trim()
  ) {
    return Response.json(
      { error: "Please provide a non-empty ticket string." },
      { status: 400 },
    );
  }

  try {
    const answer = await triageTicket(body.ticket);
    return Response.json({ answer });
  } catch (err) {
    console.error("Triage call failed:", err);
    return Response.json(
      { error: "The triage request failed." },
      { status: 502 },
    );
  }
}