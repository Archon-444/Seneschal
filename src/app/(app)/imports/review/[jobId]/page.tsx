import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import {
  getExtractionJob,
  isTenancyShapedExtraction,
  type ExtractedField,
  type ExtractionFields,
} from "@/server/services/extraction";
import { getDocument } from "@/server/services/documents";
import { listContacts } from "@/server/services/contacts";
import { listClients } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { normalizePartyName } from "@/server/services/imports";
import { BackLink, Button, Field, FormGrid, FormSection, PageHeader, inputClass } from "@/components/ui";
import { ExtractionReviewForm } from "./ExtractionReviewForm";
import { rejectExtractionFormAction } from "./actions";

// Extraction review is the OCR onboarding gate: proposed landlord, tenant, asset
// and term, with existing-record matching. AI proposes; confirm writes the tenancy.

function confidenceTone(c: number | undefined): string {
  if (c == null) return "text-navy-300";
  const pct = Math.round(c * 100);
  if (pct >= 95) return "text-verde-700";
  if (pct >= 85) return "text-gold-700";
  return "text-claret-500";
}

function fieldValue(field: ExtractedField | undefined): string {
  if (field?.value == null) return "";
  return String(field.value);
}

function uniqueByName<T extends { name: string }>(rows: T[], name: string): T | undefined {
  const n = normalizePartyName(name);
  if (!n) return undefined;
  const hits = rows.filter((r) => normalizePartyName(r.name) === n);
  return hits.length === 1 ? hits[0] : undefined;
}

function ProposedField({
  name,
  label,
  field,
  type,
  required,
  defaultValue,
  placeholder,
  step,
}: {
  name: string;
  label: string;
  field?: ExtractedField;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  step?: string;
}) {
  const value = defaultValue ?? fieldValue(field);
  return (
    <label className="block">
      <span className="t-label mb-1 flex items-baseline justify-between gap-2 text-muted">
        <span>
          {label}
          {required && (
            <span className="ml-0.5 text-gold-700" aria-hidden="true">
              *
            </span>
          )}
        </span>
        {field && (
          <span className={`figure text-[11px] ${confidenceTone(field.confidence)}`}>
            {Math.round(field.confidence * 100)}%
          </span>
        )}
      </span>
      <input
        name={name}
        type={type ?? "text"}
        required={required}
        step={step ?? (type === "number" ? "any" : undefined)}
        defaultValue={value}
        placeholder={placeholder}
        className={inputClass}
      />
      <span className="t-caption mt-1 block text-muted">
        {field?.source ? `“${field.source}”` : "Not found in the document — fill in if you know it."}
      </span>
    </label>
  );
}

export default async function ExtractionReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const ctx = await requireCtx();

  let job;
  try {
    job = await getExtractionJob(ctx, jobId);
  } catch {
    notFound();
  }
  if (job!.status !== "EXTRACTED" && job!.status !== "REVIEWING") {
    return (
      <>
        <BackLink href="/imports" label="Import & extract" />
        <PageHeader title="Extraction job" subtitle={`This job is ${job!.status} and no longer reviewable.`} />
      </>
    );
  }

  const fields = (job!.rawOutput ?? {}) as unknown as ExtractionFields;
  const [doc, contacts, clients, properties] = await Promise.all([
    getDocument(ctx, job!.documentId),
    listContacts(ctx),
    listClients(ctx),
    listProperties(ctx),
  ]);

  if (!isTenancyShapedExtraction(fields)) {
    return (
      <>
        <BackLink href="/imports" label="Import & extract" />
        <PageHeader
          eyebrow="Extraction"
          title="Not a tenancy document"
          subtitle={`${doc.fileName} didn’t yield a landlord, tenant or lease term. File it in the vault as supporting evidence — it will not create a tenancy.`}
        />
        <form action={rejectExtractionFormAction} className="max-w-3xl">
          <input type="hidden" name="jobId" value={jobId} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="danger">Reject extraction</Button>
            <Link href={`/vault/${doc.id}`} className="text-sm text-navy-500 underline-offset-2 hover:underline">
              Open in vault →
            </Link>
          </div>
        </form>
      </>
    );
  }

  const owners = contacts.filter((c) => c.kind === "OWNER" || c.kind === "CLIENT");
  const tenants = contacts.filter((c) => c.kind === "TENANT");
  const landlordName = fieldValue(fields.landlordName);
  const tenantName = fieldValue(fields.tenantName);
  const landlordMatch = uniqueByName(owners, landlordName);
  const tenantMatch = uniqueByName(tenants, tenantName);

  const community = fieldValue(fields.community);
  const building = fieldValue(fields.building);
  const unitNo = fieldValue(fields.unitNo);
  const propertyMatch = properties.find(
    (p) =>
      p.community.trim().toLowerCase() === community.trim().toLowerCase() &&
      (p.building ?? "") === building &&
      (p.unitNo ?? "") === unitNo,
  );
  const defaultClientId =
    propertyMatch?.clientPrincipalId ?? (clients.length === 1 ? clients[0].id : "");

  const paymentItems = (fields.paymentItems?.value ?? []) as {
    seq: number;
    dueDate: string;
    amount: number;
    chequeNo?: string;
    bank?: string;
  }[];

  return (
    <>
      <BackLink href="/imports" label="Import & extract" />
      <PageHeader
        eyebrow="Scan · review · commit"
        title="Review extracted tenancy"
        subtitle="The model proposes landlord, tenant, asset and term from the document. You confirm — including whether each party is new or already on file. Nothing is written until you confirm."
      />

      <ol className="mb-8 max-w-3xl space-y-2 border-b border-line pb-6 text-sm text-navy-700">
        <li>
          <span className="figure text-xs text-gold-700">1</span>
          <span className="ml-2">
            Scan — proposed from{" "}
            <Link href={`/vault/${doc.id}`} className="text-gold-700 underline-offset-2 hover:underline">
              {doc.fileName}
            </Link>
            {job!.model ? ` · ${job!.model}` : ""}
          </span>
        </li>
        <li>
          <span className="figure text-xs text-gold-700">2</span>
          <span className="ml-2">Review — match or create the landlord and tenant, then check the asset and term (this screen).</span>
        </li>
        <li>
          <span className="figure text-xs text-gold-700">3</span>
          <span className="ml-2">Commit — writes the property, tenancy, parties, cheques and deadlines together.</span>
        </li>
      </ol>

      <div className="mb-6 flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="t-label">Confidence</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-verde-500" />
          ≥95% — reads clean, verify at a glance
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold-500" />
          85–94% — check against the source snippet
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-claret-500" />
          &lt;85% — likely needs correcting
        </span>
      </div>

      <ExtractionReviewForm jobId={jobId}>
        <FormSection eyebrow="1 · Parties" title="Landlord and tenant">
          <p className="mb-4 text-xs text-muted">
            Pick an existing contact when the name already matches the directory. Leave the dropdown on
            “create new” to take them onto the record from the extracted name.
          </p>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-navy-900">Landlord · owner / lessor</h3>
              <Field
                label="Use existing contact"
                hint={
                  landlordMatch
                    ? `Matched “${landlordMatch.name}” in the directory — confirm or create new.`
                    : "No unique match. Create new, or pick someone already on file."
                }
              >
                <select
                  name="landlordContactId"
                  className={inputClass}
                  defaultValue={landlordMatch?.id ?? ""}
                >
                  <option value="">— create new below —</option>
                  {owners.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.emiratesId ? ` · ${c.emiratesId}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <FormGrid className="mt-4" cols={1}>
                <ProposedField name="ll_name" label="Owner name" field={fields.landlordName} placeholder="Al Noor Properties LLC" />
                <ProposedField name="ll_emiratesId" label="Emirates ID" field={fields.landlordEmiratesId} placeholder="784-…" />
                <ProposedField name="ll_email" label="Email" field={fields.landlordEmail} type="email" />
                <ProposedField name="ll_phone" label="Phone" field={fields.landlordPhone} />
                <ProposedField name="ll_company" label="Company" field={fields.landlordCompany} />
                <ProposedField name="ll_licenseNo" label="License no" field={fields.landlordLicenseNo} />
              </FormGrid>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-navy-900">Tenant</h3>
              <Field
                label="Use existing contact"
                hint={
                  tenantMatch
                    ? `Matched “${tenantMatch.name}” in the directory — confirm or create new.`
                    : "No unique match. Create new, or pick someone already on file."
                }
              >
                <select
                  name="tenantContactId"
                  className={inputClass}
                  defaultValue={tenantMatch?.id ?? ""}
                >
                  <option value="">— create new below —</option>
                  {tenants.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.emiratesId ? ` · ${c.emiratesId}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <FormGrid className="mt-4" cols={1}>
                <ProposedField name="tn_name" label="Tenant name" field={fields.tenantName} placeholder="Ricardo Fernandes" />
                <ProposedField name="tn_emiratesId" label="Emirates ID" field={fields.tenantEmiratesId} placeholder="784-…" />
                <ProposedField name="tn_email" label="Email" field={fields.tenantEmail} type="email" />
                <ProposedField name="tn_phone" label="Phone" field={fields.tenantPhone} />
                <ProposedField name="tn_nationality" label="Nationality" field={fields.tenantNationality} />
                <ProposedField name="tn_company" label="Company" field={fields.tenantCompany} />
              </FormGrid>
            </div>
          </div>
        </FormSection>

        <FormSection eyebrow="2 · Asset" title="Property">
          <Field
            label="Use existing property"
            hint={
              propertyMatch
                ? "This unit is already on record. The tenancy will be added to it unless the dates overlap."
                : "No matching unit. Fill the fields below to create the property."
            }
          >
            <select name="propertyId" className={inputClass} defaultValue={propertyMatch?.id ?? ""}>
              <option value="">— create new below —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.community}
                  {p.building ? ` · ${p.building}` : ""}
                  {p.unitNo ? ` · ${p.unitNo}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <FormGrid className="mt-4">
            <Field label="Client">
              <select name="clientPrincipalId" className={inputClass} defaultValue={defaultClientId}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <ProposedField name="usage" label="Usage" field={fields.usage} placeholder="Residential" />
            <ProposedField name="community" label="Community / location" field={fields.community} required placeholder="Dubai Marina" />
            <ProposedField name="building" label="Building" field={fields.building} />
            <ProposedField name="unitNo" label="Unit no" field={fields.unitNo} />
            <ProposedField name="propertyType" label="Property type" field={fields.propertyType} />
            <ProposedField name="bedrooms" label="Bedrooms" field={fields.bedrooms} type="number" step="1" />
            <ProposedField name="dewaPremiseNo" label="DEWA premises no" field={fields.dewaPremiseNo} />
          </FormGrid>
        </FormSection>

        <FormSection eyebrow="3 · Term" title="Contract">
          <FormGrid>
            <ProposedField name="ejariNo" label="Ejari no" field={fields.ejariNo} />
            <ProposedField name="noticePeriodDays" label="Notice period (days)" field={fields.noticePeriodDays} type="number" step="1" />
            <ProposedField name="startDate" label="Start date" field={fields.startDate} type="date" required />
            <ProposedField name="endDate" label="End date" field={fields.endDate} type="date" required />
            <ProposedField name="annualRent" label="Annual rent (AED)" field={fields.annualRent} type="number" required />
            <ProposedField name="depositAmount" label="Security deposit (AED)" field={fields.depositAmount} type="number" />
            <ProposedField name="paymentTermsNote" label="Mode of payment" field={fields.paymentTermsNote} placeholder="Four (4) cheques" />
          </FormGrid>
        </FormSection>

        <FormSection eyebrow="4 · Cheques" title="Payment schedule">
          {paymentItems.length > 0 ? (
            <>
              <p className={`mb-3 t-caption ${confidenceTone(fields.paymentItems?.confidence)}`}>
                {fields.paymentItems
                  ? `${Math.round(fields.paymentItems.confidence * 100)}% confidence`
                  : ""}
                {fields.paymentItems?.source ? ` · “${fields.paymentItems.source}”` : ""}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="t-th text-left text-muted">
                      <th className="py-1">#</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Cheque</th>
                      <th>Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentItems.map((item, i) => (
                      <tr key={item.seq} className="border-t border-ivory-200">
                        <td className="py-1.5 pr-2">
                          <input type="hidden" name={`pay_${i}_seq`} value={item.seq} />
                          <span className="figure">{item.seq}</span>
                        </td>
                        <td className="pr-2">
                          <input
                            name={`pay_${i}_dueDate`}
                            type="date"
                            defaultValue={item.dueDate}
                            className={inputClass}
                          />
                        </td>
                        <td className="pr-2">
                          <input
                            name={`pay_${i}_amount`}
                            type="number"
                            step="0.01"
                            defaultValue={item.amount}
                            className={inputClass}
                          />
                        </td>
                        <td className="pr-2">
                          <input
                            name={`pay_${i}_chequeNo`}
                            defaultValue={item.chequeNo ?? ""}
                            className={inputClass}
                          />
                        </td>
                        <td>
                          <input
                            name={`pay_${i}_bank`}
                            defaultValue={item.bank ?? ""}
                            className={inputClass}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Field
              label="Generate cheques (count)"
              hint="No schedule was found in the document. Leave blank to add cheques later, or split the annual rent evenly across this many cheques."
            >
              <input name="chequeCount" type="number" min="0" max="12" className={inputClass} placeholder="4" />
            </Field>
          )}
        </FormSection>
      </ExtractionReviewForm>
    </>
  );
}
