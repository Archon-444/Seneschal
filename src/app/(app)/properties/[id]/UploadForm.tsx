import { Button, Card, Field, inputClass } from "@/components/ui";
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
}: {
  scopeType: string;
  scopeId: string;
  back: string;
  allowExtract?: boolean;
}) {
  return (
    <Card>
      <form action={uploadDocumentAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="scopeType" value={scopeType} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="back" value={back} />
        <Field label="File">
          <input type="file" name="file" required className="text-sm" />
        </Field>
        <Field label="Kind">
          <select name="kind" className={inputClass}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        {allowExtract && (
          <label className="flex items-center gap-2 pb-2 text-sm text-navy-700">
            <input type="checkbox" name="extract" value="yes" />
            Extract fields (review before commit)
          </label>
        )}
        <Button type="submit" variant="secondary">Upload</Button>
      </form>
    </Card>
  );
}
