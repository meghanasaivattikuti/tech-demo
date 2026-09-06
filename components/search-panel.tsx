"use client";

import { useState } from "react";

import type { SearchFilters } from "@/lib/pdd-search";
import type { SearchResponse, SearchTrace } from "@/lib/search-types";
import { RecordRow, RecordsTable, RecordsTableEmpty } from "@/components/records-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// each one here shows a different behavior - multi field extraction, full
// state name resolution, eligibility as a question, the safety rule
// firing, and a genuinely ambiguous one. "cases involving a minor" used to
// be here instead of the 4th one but the model reinterpreted it into a
// misconduct category instead of naming a minor, so it never hit the
// safety filter at all - swapped it for a phrasing that actually triggers it
const EXAMPLE_QUERIES = [
  "wrestling coaches in Wyoming",
  "sanctions in California",
  "who's ineligible in Colorado",
  "find a person named minor",
  "bad people in sports",
];

const FILTER_LABELS: Record<keyof SearchFilters, string> = {
  name: "Name",
  city: "City",
  state: "State",
  sportAffiliation: "Sport Affiliation",
  misconductKeyword: "Misconduct",
  actionKeyword: "Action Taken",
};

type LogEntry = {
  id: number;
  query: string;
  resultCount: number;
  blockedCount: number;
  trace: SearchTrace;
};

function filterEntries(filters: SearchFilters): Array<[string, string]> {
  return (Object.keys(FILTER_LABELS) as Array<keyof SearchFilters>)
    .filter((key) => Boolean(filters[key]))
    .map((key) => [FILTER_LABELS[key], filters[key] as string]);
}

function formatCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return "not reported";
  return `$${costUsd.toFixed(6)}`;
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showTrace, setShowTrace] = useState(false);

  async function runSearch(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0 || isSearching) return;

    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Search failed.");
        setResult(null);
        return;
      }

      const body = (await response.json()) as SearchResponse;
      setResult(body);
      setLog((entries) => [
        {
          id: entries.length + 1,
          query: body.query,
          resultCount: body.results.length,
          blockedCount: body.blocked.length,
          trace: body.trace,
        },
        ...entries,
      ]);
    } catch {
      setError("Could not reach the search service.");
      setResult(null);
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Search in plain language</CardTitle>
          <p className="text-sm text-muted-foreground">
            The current public site requires you to already know which field your term
            belongs to and its exact stored value. Type a sentence instead.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(query);
            }}
          >
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. wrestling coaches in Wyoming"
              aria-label="Search the disciplinary database"
            />
            <Button type="submit" disabled={isSearching || query.trim().length === 0}>
              {isSearching ? "Resolving..." : "Search"}
            </Button>
          </form>

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((example) => (
              <Button
                key={example}
                type="button"
                variant="outline"
                size="sm"
                disabled={isSearching}
                onClick={() => {
                  setQuery(example);
                  void runSearch(example);
                }}
              >
                {example}
              </Button>
            ))}
          </div>

          {error !== null && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {result !== null && <ResolvedQuery result={result} />}

      {log.length > 0 && (
        <div>
          {/* collapsed by default, a public safety page shouldn't show live
              billing numbers unasked, still shown in full once clicked */}
          <button
            type="button"
            onClick={() => setShowTrace((value) => !value)}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {showTrace ? "Hide" : "Show"} AI Gateway call trace ({log.length}{" "}
            {log.length === 1 ? "call" : "calls"})
          </button>
          {showTrace && <TraceLog entries={log} />}
        </div>
      )}
    </div>
  );
}

// shown above the results, not hidden behind a toggle - a search that
// silently reinterprets your query is worse than a rigid one since you
// can't tell an empty result apart from a misunderstood one
function ResolvedQuery({ result }: { result: SearchResponse }) {
  const applied = filterEntries(result.appliedFilters);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolved query</CardTitle>
        <p className="text-sm text-muted-foreground">
          What the model extracted from &ldquo;{result.query}&rdquo;, and what was run
          against the case database.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {applied.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {applied.map(([label, value]) => (
              <Badge key={label} variant="secondary">
                {label} = {value}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No filters were extracted. The query did not resolve to any field in this
            data set, so no records were returned. Nothing is shown rather than
            everything, because an unfiltered list would look like an answer.
          </p>
        )}

        {result.blocked.length > 0 && (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-medium text-warning">
              Blocked by the minor-context safety rule
            </p>
            {result.blocked.map((blocked) => (
              <p key={blocked.field} className="text-sm text-muted-foreground">
                Dropped <span className="font-mono">{blocked.field}</span> ={" "}
                <span className="font-mono">&ldquo;{blocked.value}&rdquo;</span>.{" "}
                {blocked.reason}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Enforced in application code before the query was built, not by asking the
              model to decline.
            </p>
          </div>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Raw model output
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(result.resolvedFilters, null, 2)}
          </pre>
        </details>

        <div className="space-y-2">
          <p className="text-sm font-medium">
            {result.results.length} matching{" "}
            {result.results.length === 1 ? "record" : "records"}
          </p>
          <RecordsTable>
            {result.results.length === 0 ? (
              <RecordsTableEmpty message="No records matched these filters." />
            ) : (
              result.results.map((record) => (
                <RecordRow key={record.id} record={record} />
              ))
            )}
          </RecordsTable>
        </div>
      </CardContent>
    </Card>
  );
}

// served by shows which provider actually answered, so a failover shows up
// here instead of being invisible
function TraceLog({ entries }: { entries: LogEntry[] }) {
  const total = entries.reduce((sum, entry) => sum + (entry.trace.costUsd ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Gateway call trace</CardTitle>
        <p className="text-sm text-muted-foreground">
          {entries.length} {entries.length === 1 ? "call" : "calls"} this session,{" "}
          {formatCost(total)} total.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-1 border-b pb-3 text-sm last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">&ldquo;{entry.query}&rdquo;</span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatCost(entry.trace.costUsd)}
                {entry.trace.costSource === "estimated" && " (estimated)"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              requested {entry.trace.model} &middot; served by{" "}
              {entry.trace.servedByModel ?? "unknown"} &middot; {entry.trace.latencyMs}ms
              &middot; {entry.trace.inputTokens ?? "?"} in / {entry.trace.outputTokens ?? "?"}{" "}
              out &middot; {entry.resultCount} results
              {entry.blockedCount > 0 && ` · ${entry.blockedCount} filter blocked`}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
