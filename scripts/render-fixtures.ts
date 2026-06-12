import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";

// Render fixtures/seneschal-fixtures-documents.md into one PDF per fixture
// (T6.4). Plain-text rendering is sufficient for the extraction harness;
// the mock provider matches on the fixture id embedded in the file name.

const FIXTURE_IDS = [
  "fixture-1-contract-marina",
  "fixture-2-contract-bayview-override",
  "fixture-3-ejari-certificate",
  "fixture-4-cheque-schedule",
  "fixture-5-quotation",
  "fixture-6-invoice-mismatch",
];

const md = readFileSync(join(process.cwd(), "fixtures", "seneschal-fixtures-documents.md"), "utf8");
const sections = md.split(/^---$/m).filter((s) => /## FIXTURE \d/.test(s));

if (sections.length !== FIXTURE_IDS.length) {
  throw new Error(`Expected ${FIXTURE_IDS.length} fixture sections, found ${sections.length}`);
}

const outDir = join(process.cwd(), "fixtures", "pdf");
mkdirSync(outDir, { recursive: true });

Promise.all(
  sections.map(
    (section, i) =>
      new Promise<void>((resolve, reject) => {
        const file = join(outDir, `${FIXTURE_IDS[i]}.pdf`);
        const doc = new PDFDocument({ size: "A4", margin: 50 });
        const stream = createWriteStream(file);
        doc.pipe(stream);
        doc.font("Helvetica").fontSize(10).text(section.trim(), { lineGap: 2 });
        doc.end();
        stream.on("finish", () => {
          console.log(`rendered ${file}`);
          resolve();
        });
        stream.on("error", reject);
      }),
  ),
).catch((err) => {
  console.error(err);
  process.exit(1);
});
