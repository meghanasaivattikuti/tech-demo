import { z } from "zod";

// the live PDD makes you know which of 3 siloed fields your term belongs to
// and its exact stored value ("CA" not "California"). this schema is what
// the model resolves a plain english query into instead
export const searchFilterSchema = z.object({
  name: z.string().optional().describe("Full or partial name of the sanctioned individual"),
  city: z.string().optional().describe("Literal city name, e.g. 'Cheyenne'"),
  state: z
    .string()
    .length(2)
    .optional()
    .describe(
      "Two-letter US state code. Resolve full state names to their code, e.g. 'California' -> 'CA'",
    ),
  sportAffiliation: z
    .string()
    .optional()
    .describe("National governing body, e.g. 'USA Wrestling', 'USA Weightlifting'"),
  misconductKeyword: z
    .string()
    .optional()
    .describe(
      "Misconduct category keyword, e.g. 'Sexual', 'Emotional', 'Physical', 'Failure to Report', 'Criminal Disposition'",
    ),
  // added this one beyond the original 5 fields - "who's ineligible in
  // Colorado" needs eligibility, which lives in Action Taken, otherwise it
  // silently becomes "everyone in Colorado"
  actionKeyword: z
    .string()
    .optional()
    .describe(
      "Sanction keyword from Action Taken, e.g. 'Permanently Ineligible', 'Suspended', 'Probation'",
    ),
});

export type SearchFilters = z.infer<typeof searchFilterSchema>;

export type BlockedFilter = {
  field: keyof SearchFilters;
  value: string;
  reason: string;
};

// PDD only publishes adults. a minor can show up as context in the
// narrative text but should never be a searchable subject. this has to be
// code, not a prompt instruction - a prompt only works while the model
// feels like complying, and that breaks the moment a provider fails over
const MINOR_REFERENCE_TERMS = [
  "minor",
  "minors",
  "child",
  "children",
  "kid",
  "kids",
  "juvenile",
  "juveniles",
  "underage",
  "teen",
  "teens",
  "teenage",
  "teenager",
  "adolescent",
  "boy",
  "boys",
  "girl",
  "girls",
];

function referencesMinor(value: string): boolean {
  return MINOR_REFERENCE_TERMS.some((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(value),
  );
}

// only name/misconductKeyword are free text that could target a person -
// state/city/sport/action are all controlled values
const MINOR_CHECKED_FIELDS = ["name", "misconductKeyword"] as const;

export function applyMinorContextSafetyFilter(filters: SearchFilters): {
  safeFilters: SearchFilters;
  blocked: BlockedFilter[];
} {
  const safeFilters: SearchFilters = { ...filters };
  const blocked: BlockedFilter[] = [];

  for (const field of MINOR_CHECKED_FIELDS) {
    const value = safeFilters[field];
    if (value && referencesMinor(value)) {
      blocked.push({
        field,
        value,
        reason:
          "The PDD publishes adult subjects only. A minor referenced as context inside a record cannot be used as a search target.",
      });
      delete safeFilters[field];
    }
  }

  return { safeFilters, blocked };
}

// the allowlist - additional_details isn't in here so it just can't be
// searched, structurally, not because someone has to remember a rule
const PREDICATES: Array<{
  field: keyof SearchFilters;
  column: string;
  match: "exact" | "contains";
}> = [
  { field: "name", column: "name", match: "contains" },
  { field: "city", column: "city", match: "contains" },
  { field: "state", column: "state", match: "exact" },
  { field: "sportAffiliation", column: "sport_affiliation", match: "contains" },
  { field: "misconductKeyword", column: "misconduct", match: "contains" },
  { field: "actionKeyword", column: "action_taken", match: "contains" },
];

// T-SQL LIKE rules, not MySQL's - two differences that would've been
// silently wrong if ported as-is: no default escape char (needs an
// explicit ESCAPE clause) and '[' is a metacharacter here, unlike in MySQL
const LIKE_METACHARACTERS = /[\\%_[]/g;

function likeValue(value: string): string {
  const escaped = value.trim().replace(LIKE_METACHARACTERS, (character) => `\\${character}`);
  return `%${escaped}%`;
}

export type SqlParam = { name: string; value: string };

// everything goes through a placeholder, nothing model-supplied ever
// touches the SQL text directly - the model can only choose which known
// column to filter on and what value to look for
export function buildSearchPredicate(filters: SearchFilters): {
  sql: string;
  params: SqlParam[];
} {
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  for (const { field, column, match } of PREDICATES) {
    const value = filters[field];
    if (!value) continue;

    const name = `p${params.length}`;

    if (match === "exact") {
      clauses.push(`${column} = @${name}`);
      params.push({ name, value: value.trim().toUpperCase() });
    } else {
      clauses.push(`${column} LIKE @${name} ESCAPE '\\'`);
      params.push({ name, value: likeValue(value) });
    }
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function hasAnyFilter(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) => Boolean(value));
}
