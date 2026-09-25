import type { LinkLang } from "./linkCopy";

/**
 * The notice version a consent record stores, naming the text the person was
 * shown. English is the reference text and keeps the bare version
 * ("privacy_notice_v1"), so English-only records read exactly as before. The
 * Arabic and bilingual renditions of the same notice add a suffix:
 * "privacy_notice_v1+ar", "privacy_notice_v1+en-ar".
 */
export function localizedNoticeVersion(base: string, lang: LinkLang = "en"): string {
  if (lang === "ar") return `${base}+ar`;
  if (lang === "both") return `${base}+en-ar`;
  return base;
}
