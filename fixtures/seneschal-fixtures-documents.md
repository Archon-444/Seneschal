# Seneschal — Synthetic Document Fixtures v1

All parties, numbers, and references are FICTIONAL. Render each section to PDF for the extraction
test harness (T6.4). Designed to exercise: mixed AR/EN headers, 4-cheque and 2-cheque schedules,
a non-standard notice-period clause, an invoice/quote mismatch, and a missing-Ejari case.

---

## FIXTURE 1 — Tenancy Contract (clean baseline, 4 cheques, silent on notice period)

عقد إيجار — TENANCY CONTRACT
Unified Tenancy Contract — Emirate of Dubai

Contract No: TC-2025-118402
Ejari Registration No: 2025/118402

LANDLORD: Al Noor Properties LLC, P.O. Box 112233, Dubai. Licence: CN-774512.
Represented by: Khalid Al Noor. Phone: +971-50-555-0101.
TENANT: Ricardo Fernandes, Passport P-BR-4471122, Phone +971-52-555-0144,
Email r.fernandes@example.com.

PREMISES: Unit 1204, Marina Heights Tower, Dubai Marina, Dubai.
Type: Apartment, 1 Bedroom. DEWA Premise No: 632-114455.

TERM: From 16 September 2025 to 15 September 2026.
ANNUAL RENT: AED 72,000 (Seventy-Two Thousand Dirhams).
SECURITY DEPOSIT: AED 5,000.

PAYMENT: Rent payable in four (4) cheques as follows:
1. AED 18,000 — due 16 September 2025 — Cheque No 000451 — Emirates NBD
2. AED 18,000 — due 16 December 2025 — Cheque No 000452 — Emirates NBD
3. AED 18,000 — due 16 March 2026 — Cheque No 000453 — Emirates NBD
4. AED 18,000 — due 16 June 2026 — Cheque No 000454 — Emirates NBD

ADDITIONAL CLAUSES:
1. The Tenant shall use the premises for residential purposes only.
2. Maintenance under AED 500 per incident is the Tenant's responsibility.
3. The Landlord shall hand over the premises in good condition.
(No clause varies the statutory notice arrangements.)

Signed: Landlord ____________  Tenant ____________  Date: 09 September 2025

---

## FIXTURE 2 — Tenancy Contract excerpt (notice-period OVERRIDE + 2 cheques, NO Ejari number)

TENANCY AGREEMENT — Schedule of Particulars

Parties: Lumina Real Estate Investments FZ-LLC (Landlord) and Amal & Mazen Haddad (Tenants).
Premises: Unit 803, Bayview Residence, Business Bay, Dubai.
Term: 01 November 2025 to 31 October 2026. Annual Rent: AED 110,000. Deposit: AED 8,000.

Clause 9 — Renewal and Notices: Either party wishing to amend the terms upon renewal or not to
renew shall notify the other party in writing no less than SIXTY (60) days prior to the expiry
of the Term, notwithstanding any longer statutory period the parties hereby agree to vary.

Clause 10 — Payment: Rent payable in two (2) instalments:
- AED 55,000 due 01 November 2025 (Cheque, RAKBANK)
- AED 55,000 due 01 May 2026 (Cheque, RAKBANK)

[NOTE FOR HARNESS: Ejari number intentionally absent → expect MISSING_EJARI risk flag after commit.
Notice override 60 days → noticePeriodDays = 60, gate = 01 September 2026.]

---

## FIXTURE 3 — Ejari Registration Certificate

دائرة الأراضي والأملاك — Dubai Land Department
EJARI — Tenancy Contract Registration Certificate

Certificate No: 2025/118402
Contract Start: 16/09/2025   Contract End: 15/09/2026
Annual Rent: AED 72,000   Contract Value: AED 72,000
Property: Marina Heights Tower, Unit 1204, Dubai Marina
Usage: Residential   Size: 780 sq ft
Landlord: AL NOOR PROPERTIES LLC
Tenant: RICARDO FERNANDES
Issue Date: 18/09/2025

---

## FIXTURE 4 — Cheque Schedule Record (standalone, matches Fixture 1)

Al Noor Properties LLC — Cheque Register Extract
Tenancy: Unit 1204 Marina Heights / R. Fernandes / TC-2025-118402

| # | Cheque No | Bank | Due Date | Amount AED | Status |
|---|---|---|---|---|---|
| 1 | 000451 | Emirates NBD | 16-09-2025 | 18,000 | Cleared 17-09-2025 |
| 2 | 000452 | Emirates NBD | 16-12-2025 | 18,000 | Cleared 18-12-2025 |
| 3 | 000453 | Emirates NBD | 16-03-2026 | 18,000 | Cleared 17-03-2026 |
| 4 | 000454 | Emirates NBD | 16-06-2026 | 18,000 | Scheduled |

---

## FIXTURE 5 — Vendor Quotation

CoolAir Technical Services LLC — TRN 100-2244-5566
QUOTATION Q-2026-0331 — Date: 02 June 2026
To: Al Noor Properties LLC
Property: Unit 1204, Marina Heights Tower, Dubai Marina
Scope: Replace AC compressor capacitor and clean condenser coils, Bedroom unit.
Amount: AED 850 (incl. VAT). Validity: 14 days. Warranty: 90 days on parts.

---

## FIXTURE 6 — Vendor Invoice (amount EXCEEDS quote — anomaly case)

CoolAir Technical Services LLC — TRN 100-2244-5566
TAX INVOICE INV-2026-0512 — Date: 09 June 2026
To: Al Noor Properties LLC
Property: Unit 1204, Marina Heights Tower, Dubai Marina
Ref Quotation: Q-2026-0331
Description: AC compressor capacitor replacement, coil cleaning, additional refrigerant top-up (not quoted).
Amount: AED 1,050 (incl. VAT). Payment: 14 days.

[NOTE FOR HARNESS: invoice 1,050 vs quote 850 → extraction must capture both and link via Q ref;
amount delta surfaces in review, not auto-approved.]
