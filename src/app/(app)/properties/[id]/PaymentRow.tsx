import { Badge, DubaiDate, Money, Td } from "@/components/ui";
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
          {actions.map((a) => (
            <form key={a.to} action={transitionPaymentAction}>
              <input type="hidden" name="paymentItemId" value={item.id} />
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="hidden" name="to" value={a.to} />
              <button className="text-xs text-navy-500 underline-offset-2 hover:text-navy-900 hover:underline">
                {a.label}
              </button>
            </form>
          ))}
        </div>
      </Td>
    </tr>
  );
}
