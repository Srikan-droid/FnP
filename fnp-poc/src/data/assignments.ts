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

export const ASSIGNMENTS: Assignment[] = [
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
    initiatedOn: "2026-08-11",
    applicantId: "APP002",
    applicantName: "Petrus K. Shivute",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0098",
    email: "p.shivute@example.na",
    departmentKey: "payments",
    entity: "Namib Pay Solutions (Pty) Ltd",
    position: "Board Chairperson",
    reference: "PS-2026-0098",
    initiatedOn: "2026-09-02",
    applicantId: "APP002",
    applicantName: "Petrus K. Shivute",
    seededDraft: false,
  },
  {
    id: "FNP-2026-0233",
    email: "e.haufiku@example.na",
    departmentKey: "education",
    entity: "Namib Institute of Financial Studies",
    position: "Governing Board Member",
    reference: "ED-2026-0233",
    initiatedOn: "2026-08-19",
    applicantId: "APP003",
    applicantName: "Elias T. Haufiku",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0187",
    email: "e.haufiku@example.na",
    departmentKey: "insurance",
    entity: "Etosha Life Assurance Limited",
    position: "Non-Executive Director",
    reference: "IS-2026-0187",
    initiatedOn: "2026-09-04",
    applicantId: "APP003",
    applicantName: "Elias T. Haufiku",
    seededDraft: false,
  },
  {
    id: "FNP-2026-0341",
    email: "e.haufiku@example.na",
    departmentKey: "microfinance",
    entity: "Kunene Micro Credit CC",
    position: "Principal Officer",
    reference: "MF-2026-0341",
    initiatedOn: "2026-09-09",
    applicantId: "APP003",
    applicantName: "Elias T. Haufiku",
    seededDraft: false,
  },
  {
    id: "FNP-2026-0398",
    email: "m.vanwyk@example.na",
    departmentKey: "banking",
    entity: "Windhoek Commercial Bank Limited",
    position: "Chief Financial Officer",
    reference: "BL-2026-0398",
    initiatedOn: "2026-08-09",
    applicantId: "APP004",
    applicantName: "Maria L. van Wyk",
    seededDraft: true,
  },
  {
    id: "FNP-2026-0076",
    email: "m.vanwyk@example.na",
    departmentKey: "markets",
    entity: "Van Wyk Securities (Pty) Ltd",
    position: "Managing Director",
    reference: "CM-2026-0076",
    initiatedOn: "2026-09-12",
    applicantId: "APP004",
    applicantName: "Maria L. van Wyk",
    seededDraft: false,
  },
  {
    id: "FNP-2026-0289",
    email: "m.kaapanda@example.na",
    departmentKey: "microfinance",
    entity: "Kaapanda Investments CC",
    position: "Non-Executive Director",
    reference: "MF-2026-0289",
    initiatedOn: "2026-08-21",
    applicantId: "APP005",
    applicantName: "Margaret Kaapanda",
    seededDraft: true,
  },
];

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
