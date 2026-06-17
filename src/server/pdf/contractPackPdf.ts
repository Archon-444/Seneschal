import PDFDocument from "pdfkit";

// Contract-pack PDF (2A #12). Deterministic, dependency-light layout built with
// pdfkit's built-in Helvetica (no external font files). Record-keeping only —
// the document states explicitly that it is not a legal instrument.

export interface ContractPackData {
  unit: string;
  landlordName: string;
  tenantName: string;
  annualRent: number;
  paymentSchedule: string;
  paymentMethod: string | null;
  termMonths: number | null;
  startDate: string | null; // yyyy-mm-dd
  generatedOn: string; // yyyy-mm-dd
}

const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-AE")}`;

export function buildContractPackPdf(data: ContractPackData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(20).fillColor("#1c2541").text("Tenancy Agreement — Summary Pack", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#6b7385").text(`Prepared ${data.generatedOn} · ${data.unit}`);
  doc.moveDown(1);

  const row = (label: string, value: string) => {
    doc.fontSize(11).fillColor("#6b7385").text(label, { continued: true });
    doc.fillColor("#1c2541").text(`   ${value}`);
    doc.moveDown(0.4);
  };

  doc.fontSize(13).fillColor("#1c2541").text("Parties");
  doc.moveDown(0.4);
  row("Landlord:", data.landlordName);
  row("Tenant:", data.tenantName);
  doc.moveDown(0.6);

  doc.fontSize(13).fillColor("#1c2541").text("Agreed terms");
  doc.moveDown(0.4);
  row("Annual rent:", aed(data.annualRent));
  row("Payment:", `${data.paymentSchedule}${data.paymentMethod ? ` · ${data.paymentMethod}` : ""}`);
  if (data.termMonths != null) row("Term:", `${data.termMonths} months`);
  if (data.startDate) row("Start date:", data.startDate);
  doc.moveDown(0.6);

  doc.fontSize(13).fillColor("#1c2541").text("Signatures");
  doc.moveDown(0.8);
  doc.fontSize(11).fillColor("#1c2541").text("Landlord: ____________________________      Date: ____________");
  doc.moveDown(0.8);
  doc.text("Tenant:   ____________________________      Date: ____________");
  doc.moveDown(1.5);

  doc
    .fontSize(8)
    .fillColor("#6b7385")
    .text(
      "This summary pack is generated from the parties' agreed terms for record-keeping and review. " +
        "Seneschal is a technology platform, not a broker or legal adviser; this document is not a legal " +
        "instrument and does not replace an official tenancy contract or Ejari registration. Review before action.",
      { align: "left" },
    );

  doc.end();
  return done;
}
