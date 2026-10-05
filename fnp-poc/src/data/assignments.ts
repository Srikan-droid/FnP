export interface Department {
  key: string;
  name: string;
  blurb: string;
}

export interface Assignment {
  /** Assessment id — the route param and the draft storage key. */
  id: string;
  email: string;
  departmentKey: string;
  /** Entity and position are inherited from the parent application, not entered by the filer. */
  entity: string;
  position: string;
  /** Reference of the parent application that triggered this assessment. */
  reference: string;
  initiatedOn: string;
  /** Which canned applicant dataset backs this assessment's evidence and ground truth. */
  applicantId: string;
  applicantName: string;
  /** True when the department's filer has already started a draft (demo seed). */
  seededDraft: boolean;
  /**
   * Decorative only. Every assessment that actually runs belongs to Banking Licence, since the
   * POC has a single reviewer; these extra cards exist so an applicant's list looks like a real
   * queue, and they are not clickable.
   */
  isDummy?: boolean;
}

export const DEPARTMENTS: Record<string, Department> = {
  banking: {
    key: "banking",
    name: "Banking Licence",
    blurb: "Licensing of banking institutions",
  },
  education: {
    key: "education",
    name: "Education Department",
    blurb: "Accreditation of training institutions",
  },
  insurance: {
    key: "insurance",
    name: "Insurance Supervision",
    blurb: "Long and short term insurers",
  },
  microfinance: {
    key: "microfinance",
    name: "Microfinance Licensing",
    blurb: "Micro-lenders and credit providers",
  },
  payments: {
    key: "payments",
    name: "Payment Systems",
    blurb: "Payment service providers and operators",
  },
  markets: {
    key: "markets",
    name: "Capital Markets",
    blurb: "Securities dealers and market operators",
  },
};

/** The five assessments that actually run — one per applicant, all Banking Licence. */
const LIVE_ASSIGNMENTS: Assignment[] = [
  {
    id: "FNP-2026-0412",
    email: "j.amutenya@example.na",
    departmentKey: "banking",
    entity: "Oshakati Microfinance Bank Limited",
    position: "Non-Executive Director",
    reference: "BL-2026-0412",
    initiatedOn: "2026-08-14",
    applicantId: "APP001",
    applicantName: "Johanna N. Amutenya",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0455",
    email: "p.shivute@example.na",
    departmentKey: "banking",
    entity: "Erongo Building Society",
    position: "Executive Director",
    reference: "BL-2026-0455",
    initiatedOn: "2026-08-19",
    applicantId: "APP002",
    applicantName: "Petrus K. Shivute",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0233",
    email: "e.haufiku@example.na",
    departmentKey: "banking",
    entity: "Namib Trust Bank Limited",
    position: "Non-Executive Director",
    reference: "BL-2026-0233",
    initiatedOn: "2026-08-11",
    applicantId: "APP003",
    applicantName: "Elias T. Haufiku",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0398",
    email: "m.vanwyk@example.na",
    departmentKey: "banking",
    entity: "Oshakati Microfinance Bank Limited",
    position: "Executive Director",
    reference: "BL-2026-0398",
    initiatedOn: "2026-08-25",
    applicantId: "APP004",
    applicantName: "Maria L. van Wyk",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0289",
    email: "m.kaapanda@example.na",
    departmentKey: "banking",
    entity: "Kavango Financial Services",
    position: "Non-Executive Director",
    reference: "BL-2026-0289",
    initiatedOn: "2026-08-21",
    applicantId: "APP005",
    applicantName: "Margaret Kaapanda",
    seededDraft: true,
  },
];

/** Two inert cards per applicant, so the list reads like a real queue rather than one row. */
const DUMMY_SPECS: { departmentKey: string; prefix: string; position: string }[] = [
  { departmentKey: "insurance", prefix: "IS", position: "Principal Officer" },
  { departmentKey: "markets", prefix: "CM", position: "Compliance Officer" },
];

const DUMMY_ASSIGNMENTS: Assignment[] = LIVE_ASSIGNMENTS.flatMap((live, applicantIndex) =>
  DUMMY_SPECS.map((spec, specIndex) => {
    const serial = 600 + applicantIndex * 10 + specIndex;
    return {
      id: `FNP-2026-0${serial}`,
      email: live.email,
      departmentKey: spec.departmentKey,
      entity: live.entity,
      position: spec.position,
      reference: `${spec.prefix}-2026-0${serial}`,
      initiatedOn: live.initiatedOn,
      applicantId: live.applicantId,
      applicantName: live.applicantName,
      seededDraft: false,
      isDummy: true,
    };
  })
);

export const ASSIGNMENTS: Assignment[] = [...LIVE_ASSIGNMENTS, ...DUMMY_ASSIGNMENTS];

/** The assessments the reviewer works: the live ones, newest first. */
export const REVIEWABLE_ASSIGNMENTS: Assignment[] = LIVE_ASSIGNMENTS;

export function assignmentsForEmail(email: string): Assignment[] {
  const normalized = email.trim().toLowerCase();
  return ASSIGNMENTS.filter((a) => a.email === normalized);
}

export function getAssignment(assignmentId: string): Assignment | undefined {
  return ASSIGNMENTS.find((a) => a.id === assignmentId);
}

export function departmentFor(assignment: Assignment): Department {
  return (
    DEPARTMENTS[assignment.departmentKey] ?? {
      key: assignment.departmentKey,
      name: assignment.departmentKey,
      blurb: "",
    }
  );
}

export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
