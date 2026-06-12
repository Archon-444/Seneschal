import type { ExtractionFields, ExtractionProvider } from "../services/extraction";

// LLM vision extraction provider (D13). Sends the document to the Claude API
// with a structured-output prompt; returns per-field value + confidence +
// source snippet. AI proposes — only the human review screen commits (P11).

const EXTRACTION_PROMPT = `You are extracting structured fields from a Dubai tenancy document (contract, Ejari certificate, cheque schedule, invoice, or quotation). Mixed Arabic/English headers are common.

Return STRICT JSON of shape:
{"fields": {"<fieldName>": {"value": <value>, "confidence": <0..1>, "source": "<short verbatim snippet from the document>"}}}

Field names to use where applicable: landlordName, tenantName, community, building, unitNo, propertyType, bedrooms, ejariNo, startDate, endDate, annualRent, depositAmount, noticePeriodDays, noticePeriodSource, paymentItems (array of {seq,dueDate,amount,instrument,chequeNo,bank}), certificateNo, usage, issueDate, vendorName, quoteRef, invoiceRef, amount, currency, date.

Dates as ISO yyyy-mm-dd. Amounts as numbers without separators. If a field is absent use value null with the confidence of that judgement. Never invent values.`;

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
