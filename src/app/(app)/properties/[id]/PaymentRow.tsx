import { Badge, Money, Td } from "@/components/ui";
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
  dueDate: string;
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
      <Td className="figure">{item.seq}</Td>
      <Td className="figure whitespace-nowrap">{item.dueDate}</Td>
      <Td><Money amount={item.amount} /></Td>
      <Td>{item.instrument}</Td>
      <Td className="figure">{item.chequeNo ?? "—"}</Td>
      <Td>{item.bank ?? "—"}</Td>
      <Td><Badge value={item.status} /></Td>
      <Td>
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
