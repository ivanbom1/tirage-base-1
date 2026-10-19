"use client";

import { useState, type FormEvent } from "react";
import { TriageResponseSchema, type TriageResponse } from "../../lib/schema";

export default function TriagePage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<TriageResponse | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || !body.trim()) return;

    // Ticket text as in the course: subject + "\n\n" + body
    const ticket = subject + "\n\n" + body;

    setIsSending(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const detail =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Triage failed. Please try again.";
        throw new Error(detail);
      }

      // Check the reply against the same contract before showing it.
      const parsed = TriageResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("The server returned an invalid reply. Please try again.");
      }
      setResult(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Triage failed.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="chat">
      <h1>Support triage</h1>
      <p>Enter a ticket subject and body.</p>
      <form onSubmit={submit} aria-busy={isSending}>
        <label htmlFor="subject">Subject</label>
        <input
          id="subject"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          disabled={isSending}
        />
        <label htmlFor="body">Body</label>
        <textarea
          id="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          required
          disabled={isSending}
        />
        <button type="submit" disabled={isSending || !body.trim()}>
          {isSending ? "Triaging..." : "Triage"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      {result && (
        <section aria-label="Triage result">
          <p><strong>Category:</strong> {result.category}</p>
          <p><strong>Priority:</strong> {result.priority}</p>
          <p><strong>Summary:</strong> {result.summary}</p>
          <p><strong>Suggested action:</strong> {result.suggested_action}</p>
          <p>
            <strong>Tokens:</strong>{" "}
            {result.usage
              ? `input ${result.usage.input_tokens}, output ${result.usage.output_tokens}, total ${result.usage.total_tokens}`
              : "not reported by this endpoint"}
          </p>
        </section>
      )}
    </main>
  );
}