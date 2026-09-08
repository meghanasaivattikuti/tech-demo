// Unit tests for lib/pdd-search.ts. Everything in that file is pure - no
// model call, no database - so these run in milliseconds, need no
// credentials, and are deterministic. That's the difference between this and
// scripts/eval-search.mjs, which exercises a live nondeterministic model and
// can only be run on demand.
//
// Run with `npm test`. No test framework: node's built-in runner, and node
// strips the TypeScript types itself.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyMinorContextSafetyFilter,
  buildSearchPredicate,
  hasAnyFilter,
  type SearchFilters,
} from "../lib/pdd-search.ts";

// The term list is deliberately duplicated here rather than imported from
// the module under test. A test that imports the list it's checking can't
// catch a term being deleted from it.
const MINOR_TERMS = [
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

const EVERY_FIELD: SearchFilters = {
  name: "Blume",
  city: "Cheyenne",
  state: "WY",
  sportAffiliation: "USA Wrestling",
  misconductKeyword: "Sexual",
  actionKeyword: "Permanently Ineligible",
};

describe("applyMinorContextSafetyFilter", () => {
  test("every term on the list blocks the name field", () => {
    for (const term of MINOR_TERMS) {
      const { safeFilters, blocked } = applyMinorContextSafetyFilter({
        name: term,
      });
      assert.equal(blocked.length, 1, `"${term}" should have been blocked`);
      assert.equal(blocked[0].field, "name");
      assert.equal(safeFilters.name, undefined);
    }
  });

  test("a term inside a longer word does not fire", () => {
    // word-boundary matching, not substring. these are the realistic false
    // positives: a real surname or an ordinary word that contains a term.
    for (const value of [
      "Minorca",
      "minority",
      "Kidder",
      "Childers",
      "Boyd",
      "Girlington",
      "Teenaged",
    ]) {
      const { safeFilters, blocked } = applyMinorContextSafetyFilter({
        name: value,
      });
      assert.equal(blocked.length, 0, `"${value}" should not have been blocked`);
      assert.equal(safeFilters.name, value);
    }
  });

  test("matching is case-insensitive", () => {
    for (const value of ["MINOR", "Minor", "mInOr", "a CHILD present"]) {
      const { blocked } = applyMinorContextSafetyFilter({ name: value });
      assert.equal(blocked.length, 1, `"${value}" should have been blocked`);
    }
  });

  test("a term anywhere in a phrase fires", () => {
    const { blocked } = applyMinorContextSafetyFilter({
      name: "records involving a minor as the affected party",
    });
    assert.equal(blocked.length, 1);
  });

  test("misconductKeyword is checked too", () => {
    const { safeFilters, blocked } = applyMinorContextSafetyFilter({
      misconductKeyword: "child",
    });
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].field, "misconductKeyword");
    assert.equal(safeFilters.misconductKeyword, undefined);
  });

  test("both checked fields can be blocked in one pass", () => {
    const { safeFilters, blocked } = applyMinorContextSafetyFilter({
      name: "minor",
      misconductKeyword: "child",
    });
    assert.equal(blocked.length, 2);
    assert.deepEqual(
      blocked.map((b) => b.field).sort(),
      ["misconductKeyword", "name"],
    );
    assert.deepEqual(safeFilters, {});
  });

  test("the controlled-value fields are NOT checked", () => {
    // state/city/sportAffiliation/actionKeyword can't name a person, so the
    // rule deliberately doesn't touch them. This pins the documented scope:
    // if someone widens MINOR_CHECKED_FIELDS, this test should be the thing
    // that makes them think about it.
    for (const field of [
      "city",
      "state",
      "sportAffiliation",
      "actionKeyword",
    ] as const) {
      const { safeFilters, blocked } = applyMinorContextSafetyFilter({
        [field]: "minor",
      });
      assert.equal(blocked.length, 0, `${field} should not be checked`);
      assert.equal(safeFilters[field], "minor");
    }
  });

  test("a block refuses the whole query, siblings included", () => {
    // fail-closed. dropping only the blocked field would have run
    // state=WY AND sport=USA Wrestling on its own, returning every wrestling
    // record in Wyoming: broader than what was asked for, and still shaped
    // like an answer to the question that was typed
    const { safeFilters, blocked } = applyMinorContextSafetyFilter({
      name: "minor",
      state: "WY",
      sportAffiliation: "USA Wrestling",
    });
    assert.equal(blocked.length, 1);
    assert.deepEqual(safeFilters, {});
    assert.equal(hasAnyFilter(safeFilters), false);
  });

  test("a blocked entry carries the field, the value and a reason", () => {
    const { blocked } = applyMinorContextSafetyFilter({ name: "minor" });
    assert.equal(blocked[0].field, "name");
    assert.equal(blocked[0].value, "minor");
    assert.ok(blocked[0].reason.length > 0);
  });

  test("the input object is not mutated", () => {
    const input: SearchFilters = { name: "minor", state: "WY" };
    applyMinorContextSafetyFilter(input);
    assert.deepEqual(input, { name: "minor", state: "WY" });
  });

  test("clean filters pass through untouched", () => {
    const { safeFilters, blocked } = applyMinorContextSafetyFilter(EVERY_FIELD);
    assert.equal(blocked.length, 0);
    assert.deepEqual(safeFilters, EVERY_FIELD);
  });
});

describe("buildSearchPredicate", () => {
  test("no filters produces no WHERE clause and no parameters", () => {
    const { sql, params } = buildSearchPredicate({});
    assert.equal(sql, "");
    assert.deepEqual(params, []);
  });

  test("empty-string filters are skipped", () => {
    const { sql, params } = buildSearchPredicate({ name: "", state: "" });
    assert.equal(sql, "");
    assert.deepEqual(params, []);
  });

  test("state matches exactly, uppercased, bound as char2", () => {
    // state is CHAR(2); binding it as NVARCHAR would put the implicit
    // conversion on the column and defeat IX_pdd_records_state.
    const { sql, params } = buildSearchPredicate({ state: "  wy " });
    assert.equal(sql, "WHERE state = @p0");
    assert.deepEqual(params, [{ name: "p0", value: "WY", type: "char2" }]);
  });

  test("the text fields use LIKE with an explicit ESCAPE clause", () => {
    // T-SQL has no default escape character, unlike MySQL.
    const fields: Array<[keyof SearchFilters, string]> = [
      ["name", "name"],
      ["city", "city"],
      ["sportAffiliation", "sport_affiliation"],
      ["misconductKeyword", "misconduct"],
      ["actionKeyword", "action_taken"],
    ];
    for (const [field, column] of fields) {
      const { sql, params } = buildSearchPredicate({ [field]: "value" });
      assert.equal(sql, `WHERE ${column} LIKE @p0 ESCAPE '\\'`);
      assert.deepEqual(params, [
        { name: "p0", value: "%value%", type: "nvarchar" },
      ]);
    }
  });

  test("LIKE metacharacters in the value are escaped", () => {
    const cases: Array<[string, string]> = [
      ["50%", "%50\\%%"],
      ["a_b", "%a\\_b%"],
      ["[x]", "%\\[x]%"], // '[' is a metacharacter in T-SQL, ']' is not
      ["back\\slash", "%back\\\\slash%"],
      ["%_[\\", "%\\%\\_\\[\\\\%"],
    ];
    for (const [input, expected] of cases) {
      const { params } = buildSearchPredicate({ name: input });
      assert.equal(params[0].value, expected, `input was ${JSON.stringify(input)}`);
    }
  });

  test("values are trimmed", () => {
    const { params } = buildSearchPredicate({ city: "  Cheyenne  " });
    assert.equal(params[0].value, "%Cheyenne%");
  });

  test("multiple filters are ANDed, with sequential unique parameters", () => {
    const { sql, params } = buildSearchPredicate({
      state: "WY",
      sportAffiliation: "USA Wrestling",
    });
    // state is third in the allowlist, sportAffiliation fourth, so state
    // is bound first regardless of the caller's key order
    assert.equal(
      sql,
      "WHERE state = @p0 AND sport_affiliation LIKE @p1 ESCAPE '\\'",
    );
    assert.equal(params.length, 2);
    assert.deepEqual(
      params.map((p) => p.name),
      ["p0", "p1"],
    );
  });

  test("parameter order follows the allowlist, not the caller's key order", () => {
    // the model can return keys in any order; the generated SQL must not
    // depend on it, or the same query produces different plans
    const a = buildSearchPredicate({ state: "WY", name: "Blume" });
    const b = buildSearchPredicate({ name: "Blume", state: "WY" });
    assert.equal(a.sql, b.sql);
    assert.deepEqual(a.params, b.params);
    assert.equal(a.params[0].value, "%Blume%"); // name is first in the allowlist
  });

  test("all six fields together produce six parameters", () => {
    const { params } = buildSearchPredicate(EVERY_FIELD);
    assert.equal(params.length, 6);
    assert.equal(new Set(params.map((p) => p.name)).size, 6);
  });

  test("keys outside the allowlist are ignored", () => {
    // additional_details is the only column that can reference a minor, and
    // it is absent from PREDICATES, so it is unreachable by construction
    // rather than by anyone remembering a rule.
    const { sql, params } = buildSearchPredicate({
      additionalDetails: "minor",
      additional_details: "minor",
      id: "PDD-1005",
      updatedAt: "2026-01-01",
    } as unknown as SearchFilters);
    assert.equal(sql, "");
    assert.deepEqual(params, []);
  });

  test("no generated SQL can ever mention additional_details", () => {
    const { sql } = buildSearchPredicate(EVERY_FIELD);
    assert.ok(!sql.includes("additional_details"));
    assert.ok(!sql.toLowerCase().includes("additional"));
  });

  test("the value never reaches the SQL text, only a placeholder does", () => {
    // the injection property: the model chooses which known column to filter
    // and what to look for, and nothing else
    const hostile = "'; DROP TABLE dbo.pdd_records; --";
    for (const field of [
      "name",
      "city",
      "state",
      "sportAffiliation",
      "misconductKeyword",
      "actionKeyword",
    ] as const) {
      const { sql, params } = buildSearchPredicate({ [field]: hostile });
      assert.ok(!sql.includes("DROP"), `${field} leaked the value into the SQL`);
      assert.ok(!sql.includes("'; "), `${field} leaked the value into the SQL`);
      assert.ok(!sql.includes("--"), `${field} leaked the value into the SQL`);
      assert.equal(params.length, 1);
      assert.ok(params[0].value.includes("DROP")); // it lives in the parameter
    }
  });
});

describe("hasAnyFilter", () => {
  test("false for no filters", () => {
    assert.equal(hasAnyFilter({}), false);
  });

  test("false when every value is empty", () => {
    assert.equal(hasAnyFilter({ name: "", state: "" }), false);
  });

  test("true when any value is set", () => {
    assert.equal(hasAnyFilter({ state: "WY" }), true);
    assert.equal(hasAnyFilter({ name: "", state: "WY" }), true);
  });
});

describe("the safety filter and the predicate builder together", () => {
  test("a blocked term takes its siblings out of the SQL with it", () => {
    // the actual invariant the route handler depends on
    const fromModel: SearchFilters = {
      name: "minor",
      state: "WY",
    };
    const { safeFilters, blocked } = applyMinorContextSafetyFilter(fromModel);
    const { sql, params } = buildSearchPredicate(safeFilters);

    assert.equal(blocked.length, 1);
    assert.equal(sql, "");
    assert.equal(params.length, 0);
  });

  test("when the block empties the filters, nothing queryable is left", () => {
    const { safeFilters, blocked } = applyMinorContextSafetyFilter({
      name: "minor",
    });
    assert.equal(blocked.length, 1);
    assert.equal(hasAnyFilter(safeFilters), false);
    // the route checks hasAnyFilter and returns no results rather than
    // running an unfiltered query
    assert.equal(buildSearchPredicate(safeFilters).sql, "");
  });
});
