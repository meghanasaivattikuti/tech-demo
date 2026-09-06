# Modernizing the Public Disciplinary Database (PDD)

**A Vercel Solutions Architect submission**

> Everything in this document describes a demo built against fictional data.
> No real individual's name, case, or disposition appears anywhere in this
> repository or its live deployment.

---

## 1. Problem Statement

**Customer:** a national sports-safety governing body operating a Public
Disciplinary Database (PDD) - a public-facing tool that lets parents,
athletes, and volunteer coordinators look up individuals sanctioned through
the organization's disciplinary process.

**Current stack:** iSight (legacy source of truth, being retired) feeds an API
Gateway + Lambda layer that performs no transformation and caches all case
data uniformly for 300 seconds, in front of a React single-page app hosted on
S3 + CloudFront with a field-siloed filter UI (separate City / State / Sport
Affiliation dropdowns, exact-or-prefix match only).

**The pain has one root cause and two symptoms.** The system was built to
store and serve exact values precisely, not to reflect real-world accuracy or
real-world phrasing.

- **Staleness (the headline problem).** The blanket 300-second cache applies
  uniformly regardless of which record actually changed. On a database whose
  entire purpose is warning the public about safety risk, a window where a
  newly sanctioned individual doesn't yet appear (or a cleared individual
  still does) is not a cosmetic delay. It is a false negative on a safety
  check, at the moment it matters most.
- **Rigid search (the compounding problem).** The user must already know the
  system's internal data model: which of three siloed fields a term belongs
  to, and its exact stored value (`"CA"`, not `"California"`). This fails
  precisely the audience least likely to know that structure.

Fixing both means making the system fast and precise about *what* it shows
(targeted cache invalidation instead of a blanket TTL) and forgiving about
*how* people ask for it (AI-resolved natural-language search instead of
siloed exact-match dropdowns).

---

## 2. Architecture

### 2.1 Current state

```
  iSight (source of truth, being retired)
     |  raw JSON
     v
  PDD API Layer                    [ API Gateway + Lambda ]
     - pass-through only, NO transformation
     - caches ALL case data for 300s, uniformly,
       regardless of which record actually changed
     |  raw JSON
     v
  PDD Public Frontend               [ React SPA, S3 + CloudFront ]
     - field-siloed filter UI (separate City / State / Sport dropdowns)
     - exact / prefix match only, no cross-field matching
```

### 2.2 Target state

```
+---------------------- AWS (stays) ------------------------+
|  RDS SQL Server "Clue" - private subnet, not publicly       |
|  accessible in production                                   |
|    table: pdd_records                                        |
|    security group: inbound 1433 from Secure Compute's        |
|    static outbound IPs only                                  |
|                                                                |
|  internal-reporting-pipeline (Batch / Iceberg / Glue / Athena) |
|    untouched - internal reporting only, out of scope           |
+-------------------------------|--------------------------------+
                                |  TDS wire protocol, TCP 1433
                                |  (not HTTP - no API Gateway hop;
                                |   the layer it replaced added
                                |   transformation-free pass-through
                                |   and nothing else)
+-------------------------------v--------------------------------+
|                            VERCEL                                |
|                                                                   |
|  Next.js 16, Cache Components enabled                             |
|    static shell -> prerendered, served from the edge               |
|    each record -> its own cache entry, its own tag                 |
|                                                                     |
|  Natural-language search (Vercel Function)                          |
|    plain English -> AI SDK -> AI Gateway -> Claude Haiku 4.5          |
|    deterministic safety filter (application code, not the model)      |
|    -> parameterized SQL against RDS                                   |
|                                                                        |
|  Simulated case-management write (Server Action)                       |
|    write -> invalidate exactly the one changed record's cache tag       |
+---------------------------------------------------------------------------+
                                |
                                v
                  Public PDD page: the parent, athlete,
                  or volunteer coordinator who needs an answer
```

**The boundary, stated plainly:** Vercel owns presentation, caching, and
search resolution. AWS owns the case data and everything that generates it.
The only thing crossing the boundary is a parameterized read (and, in this
demo only, a tightly scoped simulated write, see §7).

### 2.3 What stays outside Vercel, and why

| System | Stays on | Why |
|---|---|---|
| The case data itself (RDS SQL Server, standing in for the real system of record) | AWS | Case data never leaves AWS or gets duplicated into Vercel. Data placement and residency decisions are preserved exactly as they are today. |
| `internal-reporting-pipeline` (Batch, Iceberg, Glue, Athena) | AWS | Internal reporting and analytics, entirely unrelated to the public-facing site. Explicitly out of scope for this modernization. |
| iSight | Retired, not connected to | This design describes the **post-migration** state. There is no live dual-system comparison in scope. |

This boundary (Vercel touches nothing but a read/write connection to the
data, and never duplicates or relocates the data itself) is the single most
important architectural decision in this submission.

---

## 3. Vercel Primitives Chosen, With Rationale and Trade-offs

Three primitives, deliberately not more. Two are from the AI stack.

### 3.1 Cache Components (rendering & caching)

**What it replaces:** the current architecture's page-level, uniform,
300-second blanket cache: a policy that cannot express "only this one record
changed."

**Why this primitive and not ISR.** ISR's `revalidate` is a property of a
*page*, not a *record*. It cannot express per-record invalidation at all.
Building on it would relocate the exact bug being fixed rather than solve it.
Cache Components lets each record be its own cache entry under its own tag, so
one sanction changing invalidates exactly one entry while every other record
keeps serving from cache, untouched.

**Trade-off accepted:** Cache Components is a newer primitive than ISR, with a
smaller track record in production. Accepted because the per-record
requirement cannot be met by ISR at any maturity level. This isn't a
preference, it's a capability gap in the older primitive.

### 3.2 AI SDK: Natural-Language Search

**What it replaces:** the three siloed, exact-match dropdown filters that
require the user to already know the internal data model.

**Why this primitive and not a custom NLP pipeline or a bigger model.** A
single structured call (`generateText` with a typed `Output.object` schema)
turns "wrestling coaches in Wyoming" into `{ state: "WY", sportAffiliation:
"USA Wrestling" }`. This is a stateless, one-shot extraction task: there is
no conversation to maintain and no multi-step reasoning required, so a
heavier orchestration layer (an agent framework, a durable workflow) would be
solving a problem this task doesn't have.

**Trade-off accepted:** a smaller model (Claude Haiku 4.5) was deliberately
chosen over a larger one. The extraction task is close to the floor of model
difficulty, and it runs on every public search; a larger model would mean
paying for reasoning capacity the task doesn't use, which matters for a
nonprofit accountable for its infrastructure spend.

### 3.3 AI Gateway: Provider Failover and Cost Visibility

**What it adds:** a provider-prefixed model string routes every search
through Gateway automatically, with an explicit provider fallback order
configured so a degraded primary provider fails over with no code change and
no second API key. Every call's real, billed cost is captured and available
per search.

**Why this matters to this customer specifically:** a nonprofit needs to
account for infrastructure spend, and "how much did this feature cost this
month" is a question Gateway answers by default rather than one that requires
building a custom telemetry pipeline.

**Trade-off accepted:** none material: Gateway is a routing layer in front
of the same provider call that would otherwise be made directly, at the cost
of one extra hop that buys failover and cost attribution in return.

### Considered and rejected

- **Workflows**: built for durable, long-running, multi-step execution that
  must survive crashes and deploys. This feature is a sub-second, stateless
  call with no intermediate state worth checkpointing; if it fails, the
  correct recovery is the user pressing search again. Adopting Workflows here
  would be paying setup and operational cost for durability machinery this
  problem does not need.
- **Secure Compute**: the correct production mechanism for private,
  authenticated connectivity into the customer's VPC (static outbound IPs +
  VPC peering, so RDS is never publicly reachable). Not provisioned in this
  demo; see §7.

---

## 4. Working Demo

- **Public URL:** https://tech-demo-inky.vercel.app
- **Public repository:** https://github.com/meghanasaivattikuti/tech-demo
- **No authentication required.** The page and search feature are open; the
  simulated case-update control is intentionally public and scoped (see §7)
  so it can be demonstrated without credentials.
- **Canned examples**, so the reviewer doesn't have to invent input, and each
  proves a different behavior:

  | Query | What it demonstrates |
  |---|---|
  | "wrestling coaches in Wyoming" | Two filters resolved from one phrase; a role word ("coaches") that maps to no field is correctly dropped rather than guessed at |
  | "sanctions in California" | A full state name resolved to the two-letter code the database actually stores (something the current dropdown UI cannot do) |
  | "who's ineligible in Colorado" | Eligibility, phrased as a question, resolved to the Action Taken field |
  | "find a person named minor" | The deterministic safety rule firing: the query is blocked before it ever reaches the database, and the block is shown, not hidden |
  | "bad people in sports" | A deliberately unresolvable query: the system declines to guess rather than returning an unfiltered list |

- **Crosses the boundary drawn in §2.3**: every search and every page load
  reads live from a real (not mocked) RDS SQL Server instance over the
  database's native wire protocol.
- **The AI-stack primitive is used meaningfully**, not decoratively: the
  resolved filter object is displayed to the user before results are shown,
  making the model's work inspectable rather than a black box.

---

## 5. Rollout Plan

1. **Preview.** Every branch and pull request gets its own Preview Deployment
   automatically once the repository is connected to Vercel, with no additional
   configuration required. Reviewers and stakeholders can validate a change against a
   real URL before it reaches production.
2. **Validation.** Before promotion: the canned query set in §4 passes, the
   deterministic safety rule is confirmed to block a minor-targeting query,
   and the cache-invalidation demo (§7) shows exactly one record's cache entry
   changing per write.
3. **Canary.** Rolling Releases promotes a build to a small percentage of
   production traffic first, rather than cutting over all at once.
4. **Cutover.** Traffic is shifted to 100% once the canary shows no
   regression against the validation criteria above.
5. **Rollback.** Because the previous deployment remains live throughout,
   rollback is instant: traffic returns to the last-known-good build with no
   redeploy and no rebuild. This is the direct answer to "what does an
   incident look like mid-rollout": traffic reverts before the on-call
   engineer has finished reading the alert.

Rolling Releases and instant rollback are described here as the intended
production mechanism; they are not fabricated inside the demo application
itself, since doing so would misrepresent a platform-level release capability
as if it were application code.

---

## 6. Success Measures

### Technical outcomes (measured against this demo)

| Metric | Current site | This design |
|---|---|---|
| Staleness window per changed record | Up to 300 seconds, **and blanket**: every record's cache resets, not just the one that changed | The next request reflects the change; verified live that the other nine records are not touched (zero unrelated cache misses triggered) |
| Natural-language query resolution | Not supported: exact-match dropdowns only | 5/5 canned test queries resolve correctly, including the safety-block case |
| Cost per search | N/A: no AI layer exists today | ~$0.0007 per query, fully attributed per call via AI Gateway |
| Search latency | N/A | ~1.0–1.3 seconds per query, measured |

### Business outcomes (expected, not yet measured against live traffic)

- **Reduced safety-critical risk window.** Directly addresses the "false
  negative on a safety check" problem named in §1: a newly sanctioned
  individual is discoverable at the next request rather than within an
  unpredictable window of up to five minutes.
- **Lower burden on the least-equipped audience.** Removes the requirement
  that a parent, athlete, or volunteer coordinator already understand the
  system's internal field structure before a search can succeed.
- **Cost accountability.** Gives a nonprofit organization per-call cost
  attribution for its AI-assisted search feature by default, rather than
  requiring a custom telemetry build to answer "what did this cost."

These business outcomes are stated as expected effects of the technical
change, not as measurements against real production traffic; no live usage
data exists to compare against yet.

---

## 7. Known Limitations and Risks

To be transparent about before kickoff, not discovered during it:

1. **The search endpoint has no rate limiting.** It is public and calls a
   paid model on every request. Production mitigation: rate limiting plus the
   Vercel WAF in front of the route.
2. **No error boundary if the database is unreachable at request time.** The
   page currently surfaces an error rather than degrading gracefully to
   "temporarily unavailable" or serving a last-known-good cached value.
3. **The eval set (§8) is not yet wired into CI.** It runs on demand
   (`npm run eval:search`) against a live instance, but nothing currently
   triggers it automatically on a change to the extraction prompt or schema.
   Wiring it into a pre-merge check is the natural next step.
4. **Secure Compute is not provisioned in this demo.** Production
   connectivity should use Secure Compute's static outbound IPs and VPC
   peering so RDS is never publicly reachable. The demo instead reaches RDS
   over a public endpoint restricted by a narrow security-group rule. This is
   a deliberate, disclosed substitution for the demo environment, not a
   production recommendation.
5. **Adding or removing a record requires invalidating a second, separate
   index cache tag**, not just the individual record's tag; a purely
   per-record tagging scheme cannot, on its own, discover newly added rows.
6. **The demo's simulated case-update control is intentionally public**,
   scoped to a fixed set of ten fictional demo records and six known sanction
   values (never free text, never an arbitrary record), specifically so the
   cache-invalidation behavior can be demonstrated live without requiring
   authentication. In production, writes originate exclusively from the
   customer's own case-management workflow, and the public application has no
   write path to the database at all.

---

## 8. Development Tooling

**IDE / agent used:** Claude Code, used throughout for architecture design,
implementation, live debugging against the real provisioned database and AI
Gateway, and iterative refinement based on direct testing rather than
assumption.

**How AI behavior was validated:** a runnable regression check
(`scripts/eval-search.mjs`, `npm run eval:search`) exercises the live endpoint
end to end (the real model call through AI Gateway, the deterministic safety
filter, and a real query against RDS) across ten cases, each chosen to test
something the others don't:

| What it checks | Example |
|---|---|
| Multi-field extraction | "wrestling coaches in Wyoming" → `state: WY, sportAffiliation: USA Wrestling`, with the role word "coaches" correctly dropped |
| Case-insensitivity | The same query, all lowercase, resolves identically |
| A second action category | "who's suspended in Vermont" |
| Correct resolution, zero results | "coaches banned in Oregon": both fields resolve correctly; the query is not loosened to force a match where the data has none |
| Correct resolution, no seeded data | "who's ineligible in Ohio": a state with zero records at all |
| The safety rule, term 1 | "find a person named minor" → blocked on `name` |
| The safety rule, term 2 (independent) | "find a person named child" → blocked on `name` via a **different** minor-reference term, confirming the rule is a real term list rather than tuned to one phrase |
| Deliberate ambiguity | "bad people in sports" → the model declines to guess rather than inventing filters |

Every expectation in that file was verified against the live endpoint before
being written down; none are assumed. One case in the original canned-query
set ("cases involving a minor") was dropped and replaced after live testing
showed the model reinterpreted it into an unrelated misconduct category
rather than naming a minor, so it never exercised the safety rule at all; the
replacement phrasing was verified to trigger the block consistently before
being adopted into both the UI and this eval set.

Current run: **10/10 passing.** This is a small, targeted regression check,
not a large-scale statistical eval, appropriate for a feature this size, and
named as such rather than overstated.

---

## 9. Platform Feedback

Candid notes from actually building on Vercel's platform for this project:
specific things, not general praise.

**What worked well:**

- **AI Gateway's provider-prefixed model string removed real operational
  work.** Once deployed, the search feature needed no Anthropic API key at
  all. Vercel Functions authenticate to Gateway via the project's own OIDC
  token. One less secret to provision, rotate, or leak.
- **The cache-tag model is genuinely easy to reason about, and easy to
  verify.** `cacheTag` + `updateTag` reduces to a simple, verifiable claim
  ("one write invalidates one entry") that could be directly measured and
  confirmed rather than taken on faith, which mattered a lot for a feature whose entire
  value proposition is that claim being true.
- **Structured outputs made an LLM-in-front-of-a-database design feel safe
  to build.** `generateText` with a typed `Output.object` schema gave a clean
  boundary between "what the model said" and "what a parameterized query
  actually runs." That boundary is what made putting a model in front of
  live case data defensible at all.

**What was frustrating, with a specific fix in mind for each:**

- **AI Gateway's per-key "Spend Budget" control is easy to mistake for
  billing.** It looks like a dial that controls whether a key can call paid
  models; it actually only caps spend against a team balance that has to be
  funded separately at the team level. This cost real debugging time
  distinguishing "the team has no billing set up" from "this key has no
  budget." Suggestion: surface team-level plan/billing status directly on the
  per-key page, not only on a separate team billing screen.
- **A well-known SQL Server driver (`mssql`) failed only inside Next.js, with
  an opaque error** (`parameter.type.validate is not a function`) that gave no
  hint the actual cause was Turbopack bundling two copies of the module and
  breaking the driver's internal identity checks. The fix
  (`serverExternalPackages`) is one line once you know to look for it. The
  error message gave no reason to look there. Suggestion: when a "not a
  function" error surfaces from a dependency not listed in
  `serverExternalPackages`, consider a dev-mode hint pointing at that setting
  as a likely cause.
- **Every built-in `cacheLife` profile ships `stale: 300` by default.** Sensible
  for most content, but a silent footgun for anything correctness-critical:
  nothing in the primitive itself flags that a client can hold a five-minute-
  stale copy of data even with per-record tags configured correctly. Catching
  this took a careful read of the type declarations, not something the docs
  called out for this class of use case.
- **The 64KB total environment-variable cap isn't surfaced until deploy
  time.** A multi-line secret like a CA certificate bundle can quietly exceed
  it locally, where nothing enforces the limit, and only fail once actually
  deploying. A local warning as a project approaches the ceiling (in `vercel
  env add`, or during `next dev`) would catch this well before a deploy does.
