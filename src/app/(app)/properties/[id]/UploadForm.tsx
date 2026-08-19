"use client";

import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/uploadLimits";
import { uploadDocumentAction } from "../../actions";

const KINDS = [
  "TENANCY_CONTRACT",
  "EJARI_CERTIFICATE",
  "CHEQUE_IMAGE",
  "RECEIPT",
  "BANK_CONFIRMATION",
  "INVOICE",
  "QUOTATION",
  "TITLE_DEED",
  "ID_DOCUMENT",
  "NOTICE",
  "OTHER",
];

export function UploadForm({
  scopeType,
  scopeId,
  back,
  allowExtract = true,
  extractDefault = false,
  defaultKind,
}: {
  scopeType: string;
  scopeId: string;
  back: string;
  allowExtract?: boolean;
  /** When true, the extract checkbox starts checked (imports OCR path). */
  extractDefault?: boolean;
  defaultKind?: string;
}) {
  const [sizeError, setSizeError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setSizeError(
      file && file.size > MAX_UPLOAD_BYTES
        ? `${file.name} is larger than ${MAX_UPLOAD_LABEL} — choose a smaller file.`
        : null,
    );
  }

  return (
    <Card>
      <form action={uploadDocumentAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="scopeType" value={scopeType} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="back" value={back} />
        <Field label="File" hint={`Up to ${MAX_UPLOAD_LABEL} per file.`} error={sizeError ?? undefined}>
          <input type="file" name="file" required onChange={onFileChange} className="text-sm" />
        </Field>
        <Field label="Kind">
          <select name="kind" className={inputClass} defaultValue={defaultKind ?? KINDS[0]}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {allowExtract && (
          <label className="flex items-center gap-2 pb-2 text-sm text-navy-700">
            <input type="checkbox" name="extract" value="yes" defaultChecked={extractDefault} />
            Extract fields (review before commit)
          </label>
        )}
        <Button type="submit" variant="secondary" disabled={!!sizeError}>Upload</Button>
      </form>
    </Card>
  );
}
