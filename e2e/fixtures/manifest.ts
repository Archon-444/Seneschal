import { readFile } from "node:fs/promises";
import { manifestPath, type E2EManifest } from "./paths";

export async function readManifest(): Promise<E2EManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as E2EManifest;
}
