import type { ExtractionFields, ExtractionProvider } from "../services/extraction";
import { EXTRACTION_PROMPT } from "./prompt";

// Gemini vision extraction provider (D13). Sends the document to the Gemini
// generateContent API with JSON-mode output; returns per-field value +
// confidence + source snippet. AI proposes — only the review screen commits (P11).
// Native PDF + image support via inline_data; free tier covers pilot volume.

export function geminiProvider(): ExtractionProvider {
  return {
    async extract({ mime, data }) {
      const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY ?? ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mime, data: data.toString("base64") } },
                { text: EXTRACTION_PROMPT },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as { fields: ExtractionFields };
      return { model, fields: parsed.fields };
    },
  };
}
