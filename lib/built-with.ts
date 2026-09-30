import { Database, Sparkles, Workflow, Zap } from "lucide-react";

// four, not every primitive this project touches - these are the ones a
// visitor can actually go watch happen (the table not re-fetching, a run
// pausing until it's signed off, a sentence turning into a filter), so
// they're the ones worth explaining instead of just listing a tech stack.
// shared between the footer strip and the full /primitives page so the
// two never drift apart. withoutIt names the actual failure mode this
// avoids, not a generic "would be worse" - the point is to make the
// tradeoff concrete, not just claim one exists
export const BUILT_WITH = [
  {
    icon: Database,
    name: "Cache Components",
    withoutIt: "one write would force a full re-read of all ten records, since there'd be nothing more specific than the whole table to invalidate.",
    blurb: "Each record gets its own cache tag, so updating one only invalidates that one entry. In the \"All records\" table, editing a record re-fetches just its row; the other nine stay cached.",
    section: "All records",
  },
  {
    icon: Workflow,
    name: "Workflows",
    withoutIt: "either the record would write immediately with no real approval gate, or a genuine gate would need its own polling job to notice when a decision finally comes in.",
    blurb: "A simulated update proposes a change and pauses there as a real Workflow run. The record itself is only written once someone approves it, and the run can resume days later, even across a redeploy.",
    section: "Workflow run",
  },
  {
    icon: Sparkles,
    name: "AI SDK",
    withoutIt: "searching would only work if you already knew the exact field and stored value, same as the current public site.",
    blurb: "generateText with a structured Output schema turns a typed sentence directly into the filter object the search query runs on.",
    section: "Search in plain language",
  },
  {
    icon: Zap,
    name: "AI Gateway",
    withoutIt: "a single provider outage would take search down with it, and there'd be no visibility into what each call actually cost.",
    blurb: "Search calls a model through one provider-prefixed model string, which is what gets automatic failover and per-call cost tracking without extra code.",
    section: "Search in plain language",
  },
] as const;
