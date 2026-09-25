/** The one AED formatter. English puts the currency first ("AED 78,000");
 *  Arabic follows the amount with the dirham ("78,000 درهم"). Latin digits in
 *  both, matching UAE contracts and Ejari certificates. Record-keeping display
 *  only: Seneschal never holds funds. */
export function formatAed(amount: string | number, locale: "en" | "ar" = "en"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  const digits = n.toLocaleString("en-AE", { minimumFractionDigits: 0 });
  return locale === "ar" ? `${digits} درهم` : `AED ${digits}`;
}
