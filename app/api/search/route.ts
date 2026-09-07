import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";

import {
  applyMinorContextSafetyFilter,
  hasAnyFilter,
  searchFilterSchema,
  type SearchFilters,
} from "@/lib/pdd-search";
import { searchRecords } from "@/lib/db";
import type { CostSource, SearchResponse, SearchTrace } from "@/lib/search-types";

// one query in, one structured filter out, then a parameterized SQL query.
// no Eve/Workflows here - there's no conversation to maintain and no
// durability need for a call this short, so either would just be paying
// for machinery this doesn't need. the model only ever translates text to
// a filter object, it never sees records or writes SQL itself

// provider-prefixed string routes through AI Gateway instead of a provider
// SDK directly, which is what gets us failover + per-call cost tracking.
// haiku over a bigger model since this is closed-form extraction against a
// small known field set, not worth paying for more reasoning than that
const MODEL = "anthropic/claude-haiku-4-5";

// published haiku 4.5 rates, used only when Gateway doesn't return a cost
// for the call itself
const HAIKU_INPUT_USD_PER_MTOK = 1;
const HAIKU_OUTPUT_USD_PER_MTOK = 5;

function resolveCost(
  providerMetadata: Record<string, unknown> | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): { costUsd: number | undefined; costSource: CostSource } {
  // prefer what Gateway actually billed, it stays correct even after a
  // provider failover to different rates
  const gateway = providerMetadata?.gateway as { cost?: unknown } | undefined;
  const reported = gateway?.cost;
  const parsed =
    typeof reported === "string"
      ? Number(reported)
      : typeof reported === "number"
        ? reported
        : Number.NaN;

  if (Number.isFinite(parsed)) {
    return { costUsd: parsed, costSource: "gateway" };
  }

  if (inputTokens === undefined || outputTokens === undefined) {
    return { costUsd: undefined, costSource: "estimated" };
  }

  const costUsd =
    (inputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOK;

  return { costUsd, costSource: "estimated" };
}

// One JSON line per request, to stdout, which is what Vercel's runtime logs
// collect and parse. The client-side trace panel only lives as long as the
// tab does, so without this the per-call cost attribution isn't durable and
// can't be queried after the fact.
//
// The query text is deliberately NOT logged. On a disciplinary database the
// query is itself sensitive: it says who someone is asking about. Length is
// enough to spot abuse (a 40KB query is not a person searching) without
// retaining the term.
type SearchLog = {
  outcome: "ok" | "bad_request" | "unresolvable" | "error";
  requestId: string;
  latencyMs: number;
  queryLength: number;
  model?: string;
  servedByModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costSource?: CostSource;
  appliedFilterCount?: number;
  blockedFields?: string[];
  resultCount?: number;
  reason?: string;
};

function logSearch(fields: SearchLog): void {
  const line = JSON.stringify({ event: "pdd.search", ...fields });
  if (fields.outcome === "ok") {
    console.log(line);
  } else {
    console.warn(line);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  // Vercel sets x-vercel-id on every request, so a log line can be tied back
  // to a specific invocation in the dashboard. Falls back to a generated id
  // locally, where the header isn't present.
  const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();

  let query: unknown;
  try {
    ({ query } = await request.json());
  } catch {
    logSearch({
      outcome: "bad_request",
      requestId,
      latencyMs: Date.now() - startedAt,
      queryLength: 0,
      reason: "body was not JSON",
    });
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof query !== "string" || query.trim().length === 0) {
    logSearch({
      outcome: "bad_request",
      requestId,
      latencyMs: Date.now() - startedAt,
      queryLength: typeof query === "string" ? query.length : 0,
      reason: "query missing or empty",
    });
    return Response.json({ error: "A search query is required." }, { status: 400 });
  }

  const trimmedQuery = query.trim();

  let resolvedFilters: SearchFilters;
  let trace: SearchTrace;

  try {
    // generateText + Output.object, not generateObject - generateObject is
    // deprecated in ai sdk 7, this is the same primitive under its current
    // name. reading off finalStep since the top level providerMetadata/
    // response are deprecated aliases for it
    const { output, usage, finalStep } = await generateText({
      model: MODEL,
      output: Output.object({ schema: searchFilterSchema }),
      // without the known-value hints the model has no way to know sport
      // affiliation is stored as "USA Wrestling" not "wrestling"
      prompt: `Extract PDD search filters from this query: "${trimmedQuery}"

Known field values:
- State is always a two-letter code.
- City is a literal city name.
- Sport Affiliation values look like "USA Wrestling", "USA Weightlifting", "USA Gymnastics", "USA Swimming", "USA Track & Field".
- Misconduct is one of: Sexual Misconduct, Emotional Misconduct, Physical Misconduct, Failure to Report, Criminal Disposition.
- Action Taken looks like "Permanently Ineligible", "Suspended, 2 years", "Probation, 2 years".

Only populate a field if the query actually implies it. Leave a field out rather than guessing. Terms describing a person's role, such as "coach" or "volunteer", do not map to any field in this data set and should be ignored.`,
      providerOptions: {
        gateway: {
          // if anthropic degrades, this retries the same request against
          // bedrock automatically, no code change, no second key
          order: ["anthropic", "bedrock"],
        },
      },
    });

    resolvedFilters = output;

    const { costUsd, costSource } = resolveCost(
      finalStep.providerMetadata,
      usage.inputTokens,
      usage.outputTokens,
    );

    trace = {
      model: MODEL,
      servedByModel: finalStep.response.modelId,
      latencyMs: Date.now() - startedAt,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      costSource,
    };
  } catch (error) {
    // don't fall back to "return everything" on a bad parse - an
    // unfiltered result set looks like a real answer when it isn't one.
    //
    // both classes have to be caught. Output.object throws
    // NoObjectGeneratedError when the model's JSON doesn't parse or doesn't
    // match the schema (state: "California" against .length(2) is the
    // likely one here); NoOutputGeneratedError is the separate case of no
    // output at all. catching only the latter left this branch unreachable
    // for the failure that actually happens, and 500'd instead.
    if (
      NoObjectGeneratedError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      logSearch({
        outcome: "unresolvable",
        requestId,
        latencyMs: Date.now() - startedAt,
        queryLength: trimmedQuery.length,
        model: MODEL,
        reason: error.name,
      });
      return Response.json(
        { error: "Could not interpret that search. Try naming a state, sport, or sanction." },
        { status: 422 },
      );
    }

    // rethrown, so the platform still records it as a 500 with a stack, but
    // the line below makes it findable alongside the successful calls
    logSearch({
      outcome: "error",
      requestId,
      latencyMs: Date.now() - startedAt,
      queryLength: trimmedQuery.length,
      model: MODEL,
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }

  const { safeFilters, blocked } = applyMinorContextSafetyFilter(resolvedFilters);

  // nothing left after the safety filter means the query didn't resolve to
  // anything this data set answers - return nothing, not everything
  const results = hasAnyFilter(safeFilters) ? await searchRecords(safeFilters) : [];

  const body: SearchResponse = {
    query: trimmedQuery,
    resolvedFilters,
    appliedFilters: safeFilters,
    blocked,
    results,
    trace,
  };

  logSearch({
    outcome: "ok",
    requestId,
    latencyMs: Date.now() - startedAt,
    queryLength: trimmedQuery.length,
    model: trace.model,
    servedByModel: trace.servedByModel,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    costUsd: trace.costUsd,
    costSource: trace.costSource,
    // the count, not the values: a filter value can be a person's name
    appliedFilterCount: Object.keys(safeFilters).length,
    // field names are column names, not user data, so these are safe to keep
    blockedFields: blocked.map((entry) => entry.field),
    resultCount: results.length,
  });

  return Response.json(body);
}
