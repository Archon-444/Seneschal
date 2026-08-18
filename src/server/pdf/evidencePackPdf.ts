import PDFDocument from "pdfkit";
import { formatDubaiDate } from "../calculators/dates";

// Evidence-pack PDF. Deterministic pdfkit layout (Helvetica). A hash manifest of
// the chronology and documents, not a sealed chain. Documents are identified by
// SHA-256, not embedded.

export interface EvidencePackData {
  generatedAt: string;
  tenancy: {
    id: string;
    ejariNo: string | null;
    startDate: Date;
    endDate: Date;
    annualRent: number;
    status: string;
  };
  property: {
    id: string;
    community: string;
    building: string | null;
    unitNo: string | null;
  };
  parties: { landlord: string; tenant: string };
  cases: { id: string; status: string }[];
  chronology: {
    id: string;
    createdAt: Date;
    type: string;
    label: string;
    actorType: string;
  }[];
  documents: {
    id: string;
    fileName: string;
    kind: string;
    sizeBytes: number;
    sha256: string;
    createdAt: Date;
    uploadedById: string | null;
  }[];
}

const DISCLAIMER =
  "Record-keeping pack based on supplied data. Rule-based calculations. Review before action. " +
  "Seneschal holds no funds and provides no legal advice. This is a hash manifest of the " +
  "chronology and documents, not a sealed chain. Source files are not embedded.";

export function buildEvidencePackPdf(data: EvidencePackData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const unit = [data.property.community, data.property.building, data.property.unitNo]
    .filter(Boolean)
    .join(" · ");

  doc.fontSize(18).fillColor("#1c2541").text("Evidence pack", { align: "left" });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor("#6b7385").text(`${unit} · generated ${data.generatedAt}`);
  doc.moveDown(0.8);

  doc.fontSize(12).fillColor("#1c2541").text("Tenancy");
  doc.moveDown(0.3);
  row(doc, "Term", `${formatDubaiDate(data.tenancy.startDate)} → ${formatDubaiDate(data.tenancy.endDate)}`);
  row(doc, "Annual rent", `AED ${Math.round(data.tenancy.annualRent).toLocaleString("en-AE")}`);
  row(doc, "Ejari", data.tenancy.ejariNo ?? "not recorded");
  row(doc, "Status", data.tenancy.status);
  row(doc, "Landlord", data.parties.landlord);
  row(doc, "Tenant", data.parties.tenant);
  doc.moveDown(0.6);

  if (data.cases.length) {
    doc.fontSize(12).fillColor("#1c2541").text("Renewal cases");
    doc.moveDown(0.3);
    for (const c of data.cases) {
      row(doc, c.status, c.id);
    }
    doc.moveDown(0.6);
  }

  doc.fontSize(12).fillColor("#1c2541").text("Chronology");
  doc.moveDown(0.3);
  if (data.chronology.length === 0) {
    doc.fontSize(9).fillColor("#6b7385").text("No evidence events on this tenancy.");
  } else {
    for (const ev of data.chronology) {
      const when = formatDubaiDate(ev.createdAt);
      doc.fontSize(8).fillColor("#6b7385").text(`${when}  `, { continued: true });
      doc.fillColor("#1c2541").text(`${ev.label}  `, { continued: true });
      doc.fillColor("#6b7385").text(ev.actorType);
    }
  }
  doc.moveDown(0.8);

  doc.fontSize(12).fillColor("#1c2541").text("Document manifest");
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor("#6b7385").text("Identified by SHA-256. Source files are not embedded in this pack.");
  doc.moveDown(0.3);
  if (data.documents.length === 0) {
    doc.fontSize(9).fillColor("#6b7385").text("No documents in scope.");
  } else {
    for (const file of data.documents) {
      doc.fontSize(8).fillColor("#1c2541").text(file.fileName);
      doc
        .fontSize(7)
        .fillColor("#6b7385")
        .text(
          `${file.kind} · ${file.sizeBytes} bytes · ${formatDubaiDate(file.createdAt)} · sha256 ${file.sha256}`,
        );
      doc.moveDown(0.2);
    }
  }
  doc.moveDown(1);
  doc.fontSize(8).fillColor("#6b7385").text(DISCLAIMER, { align: "left" });

  doc.end();
  return done;
}

function row(doc: InstanceType<typeof PDFDocument>, label: string, value: string) {
  doc.fontSize(10).fillColor("#6b7385").text(`${label}:  `, { continued: true });
  doc.fillColor("#1c2541").text(value);
}
