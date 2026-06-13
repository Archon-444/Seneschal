// Shared extraction prompt — used by every LLM vision provider so Anthropic
// and Gemini extract with identical instructions (D13).

export const EXTRACTION_PROMPT = `You are extracting structured fields from a Dubai tenancy document (contract, Ejari certificate, cheque schedule, invoice, or quotation). Mixed Arabic/English headers are common.

Return STRICT JSON of shape:
{"fields": {"<fieldName>": {"value": <value>, "confidence": <0..1>, "source": "<short verbatim snippet from the document>"}}}

Field names to use where applicable: landlordName, tenantName, community, building, unitNo, propertyType, bedrooms, ejariNo, startDate, endDate, annualRent, depositAmount, noticePeriodDays, noticePeriodSource, paymentItems (array of {seq,dueDate,amount,instrument,chequeNo,bank}), certificateNo, usage, issueDate, vendorName, quoteRef, invoiceRef, amount, currency, date.

Dates as ISO yyyy-mm-dd. Amounts as numbers without separators. If a field is absent use value null with the confidence of that judgement. Never invent values.`;
