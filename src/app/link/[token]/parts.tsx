import type { ReactNode } from "react";
import { COPY, localesFor, type LinkLang, type Locale, type Pair } from "@/lib/linkCopy";

// Presentational pieces for the public link pages (Record look). No hooks, so
// the client forms can use them too.
//
// Language handling: in "both", the page is English-led and each Arabic string
// sits in its own right-to-left element; in "ar", the whole page is RTL and
// only Arabic renders; in "en", only English.

const AR = "font-arabic";

/** A string in the page's language(s), each in its own element. */
export function Bi({
  pair,
  lang,
  as: Tag = "span",
  className = "",
  arClassName = "",
}: {
  pair: Pair;
  lang: LinkLang;
  as?: "span" | "p" | "div";
  className?: string;
  arClassName?: string;
}) {
  return (
    <>
      {localesFor(lang).map((locale) =>
        locale === "ar" ? (
          <Tag key="ar" lang="ar" dir="rtl" className={`${AR} ${lang === "both" ? "block" : ""} ${className} ${arClassName}`}>
            {pair.ar}
          </Tag>
        ) : (
          <Tag key="en" className={`${lang === "both" ? "block" : ""} ${className}`}>
            {pair.en}
          </Tag>
        ),
      )}
    </>
  );
}

/** A label pair on one line: English at the start, Arabic at the end. */
export function BiLine({ pair, lang, className = "" }: { pair: Pair; lang: LinkLang; className?: string }) {
  if (lang !== "both") return <Bi pair={pair} lang={lang} className={className} />;
  return (
    <span className={`flex items-baseline justify-between gap-3 ${className}`}>
      <span>{pair.en}</span>
      <span lang="ar" dir="rtl" className={AR}>
        {pair.ar}
      </span>
    </span>
  );
}

/** The locale a single formatted value uses (money, dates): Arabic only on an Arabic-only page. */
export function valueLocale(lang: LinkLang): Locale {
  return lang === "ar" ? "ar" : "en";
}

export function LinkShell({ lang, children }: { lang: LinkLang; children: ReactNode }) {
  const rtl = lang === "ar";
  return (
    <div lang={rtl ? "ar" : "en"} dir={rtl ? "rtl" : "ltr"} className={rtl ? AR : ""}>
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 pt-5 pb-3">
        <span className="font-slab text-xl font-bold tracking-tight">{COPY.brand.en}</span>
        <LanguageSwitch lang={lang} />
      </header>
      <main className="mx-auto max-w-xl px-4 pb-12">{children}</main>
    </div>
  );
}

function LanguageSwitch({ lang }: { lang: LinkLang }) {
  const options: { value: LinkLang; label: ReactNode; name: string }[] = [
    { value: "both", label: <>EN · <span lang="ar" className={AR}>ع</span></>, name: "English and Arabic" },
    { value: "en", label: "EN", name: "English" },
    { value: "ar", label: <span lang="ar" className={AR}>عربي</span>, name: "العربية" },
  ];
  return (
    <nav aria-label={`${COPY.language.en} · ${COPY.language.ar}`} className="flex overflow-hidden rounded-md border border-sheet-line bg-white text-sm" dir="ltr">
      {options.map((o) => (
        <a
          key={o.value}
          href={o.value === "both" ? "?" : `?lang=${o.value}`}
          aria-label={o.name}
          aria-current={lang === o.value ? "true" : undefined}
          className={`flex min-h-11 items-center px-3 ${lang === o.value ? "bg-ink text-white" : "text-ink-soft hover:bg-desk"}`}
        >
          {o.label}
        </a>
      ))}
    </nav>
  );
}

/** The white document a link page is printed on. */
export function Sheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <article className={`relative rounded-md border border-sheet-line bg-white px-5 py-6 sm:px-7 ${className}`}>{children}</article>;
}

/** Issue stamp in the seal colour: what was issued and when. Arabic gets no
 *  letter-spacing or case change: spacing breaks the joins between letters. */
export function Stamp({ children, rtl = false }: { children: ReactNode; rtl?: boolean }) {
  const script = rtl ? "text-xs" : "figure text-[11px] uppercase tracking-wider";
  return (
    <div className={`shrink-0 rounded border-2 border-seal px-2 py-1 text-center font-semibold leading-snug text-seal ${script}`}>
      {children}
    </div>
  );
}

/** One term of a document: bilingual label, value underneath. */
export function TermRow({ label, lang, children }: { label: Pair; lang: LinkLang; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-rule py-3">
      <dt className="text-[13px] text-ink-muted">
        <BiLine pair={label} lang={lang} />
      </dt>
      <dd className="text-base">{children}</dd>
    </div>
  );
}

/** The dashed box a receipt is written in. */
export function ReceiptBox({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="space-y-3 rounded-md border-[1.5px] border-dashed border-onfile bg-onfile-tint/40 p-4 text-sm">
      {children}
    </div>
  );
}

export function ReceiptRow({ label, lang, children }: { label: Pair; lang: LinkLang; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <span className="text-ink-muted">
        <Bi pair={label} lang={lang === "both" ? "en" : lang} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export const linkInputClass =
  "w-full rounded-md border border-sheet-line bg-white px-3 py-3 text-base text-ink focus:border-ink focus:outline-none";

export const primaryButtonClass =
  "flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-ink bg-ink px-4 text-base font-semibold text-white hover:bg-ink-soft disabled:opacity-50";

export const secondaryButtonClass =
  "flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-sheet-line bg-white px-4 text-base font-medium text-ink hover:bg-desk disabled:opacity-50";

/** Button text: in "both", English at the start and Arabic at the end; otherwise one centred label. */
export function ButtonLabel({ pair, lang }: { pair: Pair; lang: LinkLang }) {
  if (lang === "both") {
    return (
      <>
        <span>{pair.en}</span>
        <span lang="ar" dir="rtl" className={AR}>
          {pair.ar}
        </span>
      </>
    );
  }
  return <span className={`mx-auto ${lang === "ar" ? AR : ""}`}>{lang === "ar" ? pair.ar : pair.en}</span>;
}

/** A form field label in the page's language(s). */
export function FieldLabel({ pair, lang, htmlFor }: { pair: Pair; lang: LinkLang; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm text-ink-soft">
      <BiLine pair={pair} lang={lang} />
    </label>
  );
}

/** An error in the page's language(s). */
export function LinkError({ pair, lang }: { pair: Pair; lang: LinkLang }) {
  return (
    <div role="alert" className="rounded-md bg-gap-tint px-3 py-2 text-sm text-gap">
      <Bi pair={pair} lang={lang} />
    </div>
  );
}
