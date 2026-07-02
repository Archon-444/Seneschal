import { Badge, DubaiDate, Money, Td } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { transitionPaymentAction } from "../../actions";

const NEXT_ACTIONS: Record<string, { to: string; label: string }[]> = {
  SCHEDULED: [{ to: "RECEIVED", label: "Mark received" }],
  REQUESTED: [{ to: "RECEIVED", label: "Mark received" }],
  RECEIVED: [{ to: "DEPOSITED", label: "Mark deposited" }],
  DEPOSITED: [
    { to: "CLEARED", label: "Mark cleared" },
    { to: "BOUNCED", label: "Mark bounced" },
  ],
  LATE: [{ to: "RECEIVED", label: "Mark received" }],
  BOUNCED: [{ to: "RECEIVED", label: "Mark received" }],
};

export interface PaymentRowData {
  id: string;
  seq: number;
  dueDate: Date;
  amount: string;
  instrument: string;
  chequeNo: string | null;
  bank: string | null;
  status: string;
}

export function PaymentRow({ item, propertyId }: { item: PaymentRowData; propertyId: string }) {
  const actions = NEXT_ACTIONS[item.status] ?? [];
  return (
    <tr>
      <Td label="#" className="figure">{item.seq}</Td>
      <Td label="Due" className="whitespace-nowrap"><DubaiDate value={item.dueDate} /></Td>
      <Td label="Amount"><Money amount={item.amount} /></Td>
      <Td label="Instrument">{item.instrument}</Td>
      <Td label="Cheque no" className="figure">{item.chequeNo ?? "—"}</Td>
      <Td label="Bank">{item.bank ?? "—"}</Td>
      <Td label="Status"><Badge value={item.status} /></Td>
      <Td label="Actions">
        <div className="flex gap-2">
          {actions.map((a) =>
            a.to === "BOUNCED" ? (
              // Recording a bounce is a permanent register entry — gate it
              // behind a confirm. The dialog submits the SAME action.
              <ConfirmDialog
                key={a.to}
                trigger={a.label}
                triggerClassName="text-xs text-claret-500 underline-offset-2 hover:text-claret-700 hover:underline"
                title="Record cheque as bounced?"
                message={`This records cheque ${item.chequeNo ?? `#${item.seq}`} as bounced in the register and its evidence log. Seneschal records status only — no funds are held or moved. If the bank later clears it, record it as received again.`}
                confirmLabel="Record bounced"
                tone="danger"
                action={transitionPaymentAction}
                hiddenFields={{ paymentItemId: item.id, propertyId, to: a.to }}
              />
            ) : (
              <form key={a.to} action={transitionPaymentAction}>
                <input type="hidden" name="paymentItemId" value={item.id} />
                <input type="hidden" name="propertyId" value={propertyId} />
                <input type="hidden" name="to" value={a.to} />
                <button className="text-xs text-navy-500 underline-offset-2 hover:text-navy-900 hover:underline">
                  {a.label}
                </button>
              </form>
            ),
          )}
        </div>
      </Td>
    </tr>
  );
}
