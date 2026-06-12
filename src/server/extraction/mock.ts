import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtractionFields, ExtractionProvider } from "../services/extraction";

// Mock extraction provider: replays recorded outputs from
// fixtures/recorded-extractions.json, matched by fixture id embedded in the
// file name (T6.4 allows recorded LLM outputs in CI).

interface RecordedExtraction {
  fixtureId: string;
  fields: ExtractionFields;
}

export function mockProvider(): ExtractionProvider {
  return {
    async extract({ fileName }) {
      const path = join(process.cwd(), "fixtures", "recorded-extractions.json");
      const recorded = JSON.parse(await readFile(path, "utf8")) as RecordedExtraction[];
      const match = recorded.find((r) => fileName.includes(r.fixtureId));
      if (!match) {
        throw new Error(`No recorded extraction for file ${fileName}`);
      }
      return { model: "mock-recorded-v1", fields: match.fields };
    },
  };
}
