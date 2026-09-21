# Data authentication test set — fit and proper PoC

Synthetic test data for the **data authentication** stage only. Scoring is out of scope here:
no weights, polarity or risk scores are included.

## What is in here

| Path | Contents |
|---|---|
| `fnp_authentication_testset.xlsx` | The 15 questions, the answer matrix, the expected verdicts, and applicant profiles |
| `form_data/APP00N.json` | One submission payload per applicant — what the filer typed, plus evidence paths |
| `evidence/APP00N/*.pdf` | The proof documents that submission points at (43 files in total) |
| `expected_results.json` | Ground truth: 123 field-level checks with the verdict the engine should reach |

## Question selection

All 8 sections of `Fit_and_Proper_Scoring_Model_v2` are kept. Two questions were taken from
each, and one from Collective Suitability, giving 15. Question text is verbatim from the
workbook, including the Jamaican references (`J$2.5mn`, `BSA`) — swap those before this goes
in front of a Namibian audience.

| Section | Questions taken |
|---|---|
| Age | A1, A4 |
| Qualifications & Experience | Q1, Q3 |
| Professional Conduct /Reputation/Integrity | PC1, PC19 |
| Financial Soundness | FC5, FC7 |
| Conflict of interest (Entity/Enterprise based) | CoI2, CoI6 |
| Time Commitment | T1, T2 |
| Conflict of interest (Licensee based) | CoL1, CoL3 |
| Collective Suitability | CS4 |

The source questions are Yes/No, which on its own gives an authentication engine nothing to
verify. Each selected question therefore carries **declared values** — the structured detail a
filer would supply alongside the answer (date of birth, qualification and year, employer and
dates, share count, and so on). Those declared values are what gets checked against the
document.

## The five applicants

| ID | Applicant | What it exercises |
|---|---|---|
| APP001 | Johanna N. Amutenya | Clean baseline. Everything matches. |
| APP002 | Petrus K. Shivute | Transcription errors: date-of-birth digits transposed, degree year off by one. |
| APP003 | Elias T. Haufiku | Overstated experience (declared 12 years, letter supports ~8) and a missing tax certificate. |
| APP004 | Maria L. van Wyk | Answer-level contradiction (declares no record, clearance shows a conviction) and a share count off by 10×. |
| APP005 | Margaret Kaapanda | Tolerance cases: maiden name on the degree, `Ltd.` vs `Limited` on the employer, registry extract that omits the appointment date. |

## Verdicts the engine should produce

| Verdict | Count | Meaning |
|---|---|---|
| `MATCH` | 111 | Declared value corroborated |
| `MISMATCH` | 5 | Evidence contradicts the declared value → case returns to the filer |
| `EVIDENCE_MISSING` | 3 | Mandatory document not uploaded |
| `MATCH_VARIANT` | 2 | Differs only by name variant or legal suffix — a false positive if flagged |
| `CONTRADICTION` | 1 | Evidence contradicts the Yes/No answer itself, not just a field |
| `UNVERIFIABLE` | 1 | Document present, field not locatable in it |

`MATCH_VARIANT` is the important row. An engine that flags those two is technically correct and
operationally useless — it sends the filer back over a maiden name. Precision on that pair is
the thing worth measuring.

## Suggested harness

1. Load `form_data/APP00N.json`.
2. For each response with `evidence_required: true`, extract the named fields from the PDF at
   `evidence[].path`.
3. Compare against `declared_values` and emit a verdict per field.
4. Diff against `expected_results.json` — report precision and recall per verdict class, not
   just overall accuracy. Missing a `MISMATCH` and over-flagging a `MATCH_VARIANT` are
   different failures with different costs.

## Deliberate limits

- Text-native PDFs, not scans. Real filers upload phone photos, so add a degraded set before
  believing any accuracy number from this one.
- One document per field. No cases yet where a value must be reconciled across two documents.
- No adversarial or tampered documents.
