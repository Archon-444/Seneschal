import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Pilot gate: serious and critical WCAG violations block. Moderate/minor results
 * remain in the HTML report for review rather than being blanket-disabled. */
export async function expectNoSeriousA11yViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
}
