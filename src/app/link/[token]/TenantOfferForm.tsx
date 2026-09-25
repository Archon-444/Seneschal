"use client";

import { useActionState, useState } from "react";
import { COPY, errorPair, type LinkLang } from "@/lib/linkCopy";
import { formatAed } from "@/lib/money";
import { formatDubaiDateTime } from "@/server/calculators/dates";
import { respondToOfferAction, type OfferResponseState } from "./actions";
import {
  Bi,
  ButtonLabel,
  FieldLabel,
  LinkError,
  ReceiptBox,
  ReceiptRow,
  linkInputClass,
  primaryButtonClass,
  secondaryButtonClass,
  valueLocale,
} from "./parts";

export function TenantOfferForm({ token, lang, version }: { token: string; lang: LinkLang; version: number }) {
  const [state, formAction, pending] = useActionState(
    respondToOfferAction,
    { status: "idle" } as OfferResponseState,
  );
  const [mode, setMode] = useState<"choose" | "counter" | "ask">("choose");
  const loc = valueLocale(lang);

  if (state.status === "done") {
    // Echo the response back as a receipt: the tenant sees exactly what was
    // recorded, when, and against which offer version.
    const title =
      state.action === "ACCEPT" ? COPY.acceptedTitle : state.action === "COUNTER" ? COPY.counteredTitle : COPY.askedTitle;
    const answer =
      state.action === "ACCEPT" ? COPY.answerAccepted : state.action === "COUNTER" ? COPY.answerCountered : COPY.answerAsked;
    return (
      <ReceiptBox>
        <p className="font-semibold text-onfile">
          <Bi pair={title} lang={lang} />
        </p>
        <div className="space-y-1.5">
          <ReceiptRow label={COPY.receiptAnswer} lang={lang}>
            <Bi pair={answer} lang={lang === "both" ? "en" : lang} />
          </ReceiptRow>
          <ReceiptRow label={COPY.receiptOffer} lang={lang}>
            <span className="figure">v{version}</span>
          </ReceiptRow>
          <ReceiptRow label={COPY.receiptRecorded} lang={lang}>
            <span className="figure">{formatDubaiDateTime(new Date(state.recordedAt), loc)}</span>
          </ReceiptRow>
          {state.action === "COUNTER" && state.annualRent != null && (
            <ReceiptRow label={COPY.receiptProposed} lang={lang}>
              <span className="figure">{formatAed(state.annualRent, loc)}</span>
              {state.paymentSchedule ? ` · ${state.paymentSchedule}` : ""}
            </ReceiptRow>
          )}
          {state.note && (
            <ReceiptRow label={COPY.receiptNote} lang={lang}>
              <span dir="auto">“{state.note}”</span>
            </ReceiptRow>
          )}
        </div>
        <p>
          <Bi pair={state.action === "ACCEPT" ? COPY.afterAccept : COPY.afterOther} lang={lang} />
        </p>
        <p className="text-ink-muted">
          <Bi pair={COPY.receiptKeep} lang={lang} />
        </p>
      </ReceiptBox>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lang" value={lang} />

      {mode === "counter" && (
        <div className="space-y-3 rounded-md border border-sheet-line bg-desk/50 p-4">
          <div>
            <FieldLabel pair={COPY.counterRent} lang={lang} htmlFor="offer-rent" />
            <input id="offer-rent" name="annualRent" type="number" min="1" step="1" required inputMode="numeric" className={`${linkInputClass} figure`} />
          </div>
          <div>
            <FieldLabel pair={COPY.paymentSchedule} lang={lang} htmlFor="offer-schedule" />
            <input
              id="offer-schedule"
              name="paymentSchedule"
              required
              placeholder={lang === "ar" ? COPY.paymentPlaceholder.ar : COPY.paymentPlaceholder.en}
              className={linkInputClass}
            />
          </div>
        </div>
      )}

      {(mode === "counter" || mode === "ask") && (
        <div>
          <FieldLabel pair={mode === "ask" ? COPY.yourQuestion : COPY.noteOptional} lang={lang} htmlFor="offer-note" />
          <textarea id="offer-note" name="note" rows={3} required={mode === "ask"} className={linkInputClass} />
        </div>
      )}

      <label className="flex min-h-11 items-start gap-3 text-sm text-ink-soft">
        <input type="checkbox" name="optIn" className="mt-0.5 h-5 w-5 shrink-0 accent-ink" />
        <span>
          <Bi pair={COPY.whatsappOptIn} lang={lang} />
        </span>
      </label>

      {state.status === "error" && <LinkError pair={errorPair(state.message)} lang={lang} />}

      {mode === "choose" ? (
        <div className="space-y-2.5">
          <button type="submit" name="action" value="ACCEPT" disabled={pending} className={primaryButtonClass}>
            <ButtonLabel pair={pending ? COPY.sending : COPY.accept} lang={lang} />
          </button>
          <button type="button" onClick={() => setMode("counter")} className={secondaryButtonClass}>
            <ButtonLabel pair={COPY.counter} lang={lang} />
          </button>
          <button type="button" onClick={() => setMode("ask")} className={secondaryButtonClass}>
            <ButtonLabel pair={COPY.ask} lang={lang} />
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <button
            type="submit"
            name="action"
            value={mode === "counter" ? "COUNTER" : "ASK"}
            disabled={pending}
            className={primaryButtonClass}
          >
            <ButtonLabel pair={pending ? COPY.sending : mode === "counter" ? COPY.sendCounter : COPY.sendQuestion} lang={lang} />
          </button>
          <button type="button" onClick={() => setMode("choose")} className={secondaryButtonClass}>
            <ButtonLabel pair={COPY.back} lang={lang} />
          </button>
        </div>
      )}
    </form>
  );
}
