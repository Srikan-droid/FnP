// The test data's section names are used verbatim from the source workbook. Display-only
// renames go here so the underlying qid/section keys never have to change.
const DISPLAY_OVERRIDES: Record<string, string> = {
  Age: "Basic Details",
  "Professional Conduct /Reputation/Integrity": "Professional Conduct, Reputation & Integrity",
  "Conflict of interest. (Entity/Enterprise based)": "Conflict of Interest — Entity",
  "Conflict of interest. (Licensee based)": "Conflict of Interest — Licensee",
};

export function displaySection(section: string): string {
  return DISPLAY_OVERRIDES[section] ?? section;
}
