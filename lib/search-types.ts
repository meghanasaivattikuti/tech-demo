import type { BlockedFilter, SearchFilters } from "./pdd-search";
import type { PDDRecord } from "./db";

// separate from lib/db so the client can import types without pulling in
// mssql / next/cache through a value import by accident later

export type CostSource = "gateway" | "estimated";

export type SearchTrace = {
  model: string;
  /** what actually served the call, differs from `model` after a failover */
  servedByModel: string | undefined;
  latencyMs: number;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  costUsd: number | undefined;
  costSource: CostSource;
};

export type SearchResponse = {
  query: string;
  /** exactly what the model returned */
  resolvedFilters: SearchFilters;
  /** what actually ran, after the safety filter */
  appliedFilters: SearchFilters;
  blocked: BlockedFilter[];
  results: PDDRecord[];
  trace: SearchTrace;
};
