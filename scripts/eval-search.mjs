#!/usr/bin/env node
// small regression check for search, every case was verified live against
// the running app before being added here. hits the real endpoint end to
// end (model call, safety filter, actual RDS query), not a unit test of
// one layer. costs about a cent to run in total at haiku rates
//
// usage:
//   npm run eval:search
//   BASE_URL=https://<prod-url> npm run eval:search

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * @typedef {{
 *   query: string,
 *   note: string,
 *   expectFilters?: Record<string, string>,
 *   expectBlockedField?: string,
 *   expectEmptyFilters?: boolean,
 *   expectResultNames?: string[],
 * }} EvalCase
 *
 * @type {EvalCase[]}
 */
const CASES = [
  {
    query: "wrestling coaches in Wyoming",
    note: "multi-field extraction; a role word ('coaches') that maps to no field must be dropped, not guessed at",
    expectFilters: { state: "WY", sportAffiliation: "USA Wrestling" },
    expectResultNames: ["Daniel Blume", "Marcus Nathanson"],
  },
  {
    query: "wrestling sanctions in wyoming",
    note: "case-insensitivity: an all-lowercase query resolves identically to the mixed-case version above",
    expectFilters: { state: "WY", sportAffiliation: "USA Wrestling" },
    expectResultNames: ["Daniel Blume", "Marcus Nathanson"],
  },
  {
    query: "sanctions in California",
    note: "a full state name resolved to the two-letter code the database actually stores",
    expectFilters: { state: "CA" },
    expectResultNames: ["Renata Grantham", "Theodore Kowalczyk"],
  },
  {
    query: "who's ineligible in Colorado",
    note: "eligibility, phrased as a question, resolved to the Action Taken field",
    expectFilters: { state: "CO", actionKeyword: "Permanently Ineligible" },
    expectResultNames: ["Priya Novosad", "Wesley Ostrander"],
  },
  {
    query: "who's suspended in Vermont",
    note: "a different action category, on a state with exactly one matching record",
    expectFilters: { state: "VT", actionKeyword: "Suspended" },
    expectResultNames: ["Camille Ohlsen"],
  },
  {
    query: "coaches banned in Oregon",
    note: "correctly resolved on BOTH fields, but zero results - the query must not be loosened to force a match. Distinct from failing to resolve at all.",
    expectFilters: { state: "OR", actionKeyword: "Permanently Ineligible" },
    expectResultNames: [],
  },
  {
    query: "who's ineligible in Ohio",
    note: "a state with zero seeded records at all - resolution succeeds, the empty result is a fact about the data, not a bug",
    expectFilters: { state: "OH" },
    expectResultNames: [],
  },
  {
    query: "find a person named minor",
    note: "the deterministic safety rule firing on the term 'minor', targeting the name field",
    expectBlockedField: "name",
  },
  {
    query: "find a person named child",
    note: "a SECOND, independent minor-reference term ('child', not 'minor') - proves the rule is a real term list, not tuned to one phrase",
    expectBlockedField: "name",
  },
  {
    query: "bad people in sports",
    note: "deliberately unresolvable - the model must decline to guess rather than inventing filters or returning everything",
    expectEmptyFilters: true,
  },
];

async function runCase(testCase) {
  const response = await fetch(`${BASE_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: testCase.query }),
  });

  if (!response.ok) {
    return { pass: false, reason: `HTTP ${response.status}` };
  }

  const body = await response.json();
  const problems = [];

  if (testCase.expectFilters) {
    for (const [field, expected] of Object.entries(testCase.expectFilters)) {
      const actual = body.appliedFilters?.[field];
      if (actual !== expected) {
        problems.push(`appliedFilters.${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
  }

  if (testCase.expectBlockedField) {
    const blockedFields = (body.blocked ?? []).map((b) => b.field);
    if (!blockedFields.includes(testCase.expectBlockedField)) {
      problems.push(`expected '${testCase.expectBlockedField}' to be blocked, but blocked = ${JSON.stringify(blockedFields)}`);
    }
    if (testCase.expectBlockedField in (body.appliedFilters ?? {})) {
      problems.push(`'${testCase.expectBlockedField}' was blocked but still present in appliedFilters - the safety filter did not actually remove it`);
    }
  }

  if (testCase.expectEmptyFilters) {
    const keys = Object.keys(body.resolvedFilters ?? {});
    if (keys.length > 0) {
      problems.push(`expected no filters extracted, got ${JSON.stringify(body.resolvedFilters)}`);
    }
  }

  if (testCase.expectResultNames) {
    const actualNames = (body.results ?? []).map((r) => r.name).sort();
    const expectedNames = [...testCase.expectResultNames].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      problems.push(`expected results ${JSON.stringify(expectedNames)}, got ${JSON.stringify(actualNames)}`);
    }
  }

  return { pass: problems.length === 0, problems, body };
}

async function main() {
  console.log(`\nSearch eval -> ${BASE_URL}/api/search\n`);

  let failures = 0;

  for (const testCase of CASES) {
    process.stdout.write(`"${testCase.query}"\n  ${testCase.note}\n`);
    const result = await runCase(testCase);

    if (result.pass) {
      console.log(`  PASS\n`);
    } else {
      failures++;
      console.log(`  FAIL`);
      for (const problem of result.problems ?? [result.reason]) {
        console.log(`    - ${problem}`);
      }
      console.log();
    }
  }

  const total = CASES.length;
  const passed = total - failures;
  console.log(`${passed}/${total} passed.`);

  if (failures > 0) {
    console.log(
      `\n${failures} case(s) failed. This means either a real regression, or the model's\n` +
      `behavior shifted and the expectation needs updating - re-verify manually before\n` +
      `assuming the code is wrong.\n`
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
