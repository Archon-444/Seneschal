import type { ExtractionFields, ExtractionProvider } from "../services/extraction";
import { EXTRACTION_PROMPT } from "./prompt";

// LLM vision extraction provider (D13). Sends the document to the Claude API
// with a structured-output prompt; returns per-field value + confidence +
// source snippet. AI proposes — only the human review screen commits (P11).

export function anthropicProvider(): ExtractionProvider {
  return {
    async extract({ mime, data }) {
      const model = "claude-sonnet-4-6";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                mime === "application/pdf"
                  ? {
                      type: "document",
                      source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") },
                    }
                  : {
                      type: "image",
                      source: { type: "base64", media_type: mime, data: data.toString("base64") },
                    },
                { type: "text", text: EXTRACTION_PROMPT },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { content: { type: string; text?: string }[] };
      const text = body.content.find((c) => c.type === "text")?.text ?? "";
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as { fields: ExtractionFields };
      return { model, fields: parsed.fields };
    },
  };
}
