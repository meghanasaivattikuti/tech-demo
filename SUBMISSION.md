# Modernizing the Public Disciplinary Database (PDD)

**A Vercel Solutions Architect submission**

> Everything here describes a demo built on fictional data. No real
> individual's name, case, or disposition appears in this repository or on the
> live deployment.

---

## Summary

**Live demo:** https://tech-demo-inky.vercel.app
**Repository:** https://github.com/meghanasaivattikuti/tech-demo

The customer publishes a public record of people sanctioned through a national
sports-safety disciplinary process. Their current site caches every record
together for 300 seconds, and makes you know the internal data model before
you can search it. Both are addressed here, reading live from a real RDS SQL
Server instance in AWS:

- **Per-record cache invalidation**, with Cache Components. One sanction
  changing invalidates one cache entry, and the other nine keep serving from
  cache. Section 3.1.
- **Natural-language search**, through the AI SDK and AI Gateway to Claude
  Haiku 4.5. Plain English becomes a typed filter object, then a parameterized
  query. Section 3.2.
- **A safety rule that fails closed** in application code rather than in the
  prompt: a query naming a minor is refused outright, not narrowed to whatever
  was left of it. Section 4.
- **A boundary that holds.** Case data never leaves AWS and is never
  duplicated into Vercel. What crosses between them is a parameterized read.
  Section 2.3.

The largest gap is the first item in section 7. Production invalidation needs a
webhook from the customer's case-management system, which this demo fakes
inside a Server Action. Without it the design falls back to a longer staleness
window than the cache it replaces, which is what makes that webhook the input
this design consumes rather than a refinement on it.

---

## 1. Problem Statement

The customer is a national sports-safety governing body. They run a Public
Disciplinary Database: a public site where parents, athletes and volunteer
coordinators look up people sanctioned through the organization's disciplinary
process.

Today that's a React SPA on S3 and CloudFront. Behind it, an API Gateway and
Lambda layer passes case data through from the legacy case-management system
(the current source of truth, being retired) without transforming it, and
caches all of it for 300 seconds. The UI filters on three separate dropdowns,
City, State and Sport Affiliation, with exact or prefix matching and no way to
match across fields.

Two problems. They're related, but the fixes are different enough that I've
treated them separately.

**Staleness.** The 300-second cache is blanket. It doesn't matter which record
changed; everything resets together. On a database whose purpose is telling
the public about a safety risk, a window where a newly sanctioned person
hasn't appeared yet, or a cleared person still has, isn't a cosmetic delay. It
is a wrong answer to the question the site exists to answer.

**Rigid search.** To search successfully you have to already know the internal
data model: which of the three fields your term belongs to, and the exact
stored value. `"CA"`, not `"California"`. That requirement falls hardest on the
people least likely to know anything about the data model, which is most of
the audience.

So: targeted invalidation instead of a blanket TTL, and natural-language
search instead of siloed dropdowns.

---

## 2. Architecture

### 2.1 Current state

```
  Legacy case-management system (source of truth, being retired)
     |  raw JSON
     v
  PDD API Layer         [ API Gateway + Lambda ]
     - pass-through only, NO transformation
     - caches ALL case data for 300s, uniformly,
       regardless of which record actually changed
     |  raw JSON
     v
  PDD Public Frontend   [ React SPA, S3 + CloudFront ]
     - field-siloed filter UI (separate City / State / Sport dropdowns)
     - exact / prefix match only, no cross-field matching
```

### 2.2 Target state

```
+--------------------------- AWS (stays) ----------------------------+
|                                                                    |
|  RDS SQL Server                                                    |
|    private subnet, not publicly accessible in production           |
|    table: pdd_records                                              |
|    security group: inbound 1433 from Secure Compute's              |
|    static outbound IPs only                                        |
|                                                                    |
|  Internal reporting pipeline (Batch / Iceberg / Glue / Athena)     |
|    untouched: internal reporting only, out of scope                |
|                                                                    |
+------------------------------+-------------------------------------+
                               |
                           TDS wire protocol, TCP 1433
                           not HTTP, so no API Gateway hop: the
                           layer it replaced added pass-through
                           with no transformation and nothing else
                               |
+------------------------------v-------------------------------------+
|                               VERCEL                               |
|                                                                    |
|  Next.js 16, Cache Components enabled                              |
|    static shell  ->  prerendered, served from the edge             |
|    each record   ->  its own cache entry, its own tag              |
|                                                                    |
|  Natural-language search (Vercel Function)                         |
|    plain English -> AI SDK -> AI Gateway -> Claude Haiku 4.5       |
|    deterministic safety filter in application code,                |
|    not in the model, then parameterized SQL against RDS            |
|                                                                    |
|  Simulated case-management write (Server Action)                   |
|    write -> invalidate the one changed record's cache tag          |
|                                                                    |
+------------------------------+-------------------------------------+
                               |
                               v
              The parent, athlete, or volunteer coordinator
              who needs an answer
```

Vercel owns presentation, caching and search resolution. AWS owns the case data
and everything that produces it. What crosses between them is a parameterized
read, plus (in this demo only) a narrowly scoped simulated write, described
under Working Demo.

### 2.3 What stays outside Vercel, and why

| System | Stays on | Why |
|---|---|---|
| The case data itself (RDS SQL Server, standing in for the real system of record) | AWS | Case data never leaves AWS or gets duplicated into Vercel. Data placement and residency decisions stay as they are today. |
| The internal reporting pipeline (Batch, Iceberg, Glue, Athena) | AWS | Internal reporting and analytics, unrelated to the public site. Out of scope for this work. |
| The legacy case-management system | Retired, not connected to | This describes the post-migration state. A live dual-system comparison isn't in scope. |

Keeping the data where it is, rather than replicating it into Vercel, is the
decision most of the rest of this design follows from.

Case data stays in AWS, but the *search query text* doesn't: it goes to the
model to be turned into a filter object. The model never sees a record. Even
so, on a disciplinary database the query itself is sensitive, because it says
who someone is asking about. Production would need a retention and
data-processing position on query text, and can pin inference to an in-region
provider using the same Gateway setting described in the AI Gateway section.

---

## 3. Vercel Primitives Chosen, With Rationale and Trade-offs

Three primitives. Two of them from the AI stack.

### 3.1 Cache Components

This replaces the page-level 300-second blanket cache, which has no way to
express "only this one record changed."

The 300-second number isn't an oversight. With a page-level cache, how fresh
the data is and how much load reaches the database are controlled by the same
setting. Making records fresher means shortening the cache, which means it
gets discarded more often, which means more requests fall through to a single
database instance that can't absorb many more. Five minutes is roughly where
those two pressures balance. Per-record tags split that one setting in two: a
record refreshes when it actually changes rather than on a timer, so
freshness stops being paid for in database load.

I looked at ISR first and ruled it out on capability, not maturity. ISR's
`revalidate` is a property of a page, not a record, so it can't express
per-record invalidation at all. Building on it would have moved the bug rather
than fixed it. With Cache Components each record is its own cache entry under
its own tag, so one sanction changing invalidates one entry and the rest keep
serving.

Tagged caching predates Cache Components: `unstable_cache` has taken a `tags`
option since Next 14, so per-record invalidation was expressible before this.
Three things rule it out here. It's deprecated in Next 16, replaced by `use
cache`. It couldn't compose with prerendering, so granular data caching came
at the cost of a page-level rendering strategy, rather than a static shell
with per-record holes streaming into it. And it took a single `revalidate`
number with no `stale` control, which is the knob this use case actually
needs, since client staleness was a global `staleTimes` setting rather than a
per-record decision.

One wrinkle in the per-record model: tags can't discover rows that don't exist
yet, so adding or removing a record has to invalidate a second tag covering the
id list. The cost is one query, and every record entry stays intact.

In this demo the write and the `updateTag` call happen in the same Server
Action, which is tidy but not how production works. There, the write starts in
the customer's case-management system, which has no path into this app. That
system has to tell Vercel something changed. The mechanism is a signed webhook
calling `revalidateTag(recordTag(id), { expire: 0 })`, with the `updated_at`
column (already maintained by an `AFTER UPDATE` trigger) as a reconciler
signal for anything missed. Two details in that call. It can't be
the demo's `updateTag`, which throws outside a Server Action, and the profile
is `{ expire: 0 }` rather than the generally recommended `max` because
stale-while-revalidate would keep serving the superseded sanction while the
refresh ran, which is the staleness this whole design exists to remove.

Without that integration this design falls back to the time-based
`revalidate`, which is set to an hour because it's meant to be a backstop and
not the mechanism. That's twelve times the staleness window of the 300-second
cache it replaces, so the fallback isn't parity with the current site, it's
worse than it. That's what makes the webhook the input this design consumes
rather than a refinement on it. I've specified it here but not built it; see
Known Limitations and Risks.

The trade-off I accepted is that Cache Components is newer than ISR and has a
shorter production track record. I took it because the per-record requirement
can't be met by ISR at any level of maturity.

### 3.2 AI SDK, for natural-language search

This replaces the three exact-match dropdowns.

One structured call, `generateText` with a typed `Output.object` schema, turns
"wrestling coaches in Wyoming" into `{ state: "WY", sportAffiliation: "USA
Wrestling" }`. It's a stateless one-shot extraction, so there's no conversation
to hold and no multi-step reasoning to orchestrate. An agent framework or a
durable workflow would be solving problems this task doesn't have.

On model choice: Haiku 4.5 rather than something larger, on purpose. The
extraction is close to the floor of difficulty and it runs on every public
search. A bigger model means paying for reasoning the task never uses, and this
customer is a nonprofit that has to account for its infrastructure spend.

The trade-off I accepted is that a search path which used to be exactly
deterministic now has a nondeterministic dependency in it. The same query can
resolve differently between runs, and a provider failover changes which model
is doing the resolving. That is the reason the resolved filters are shown to
the user instead of being applied silently, and the reason the eval set exists
at all. Two smaller costs come with it: a search goes from effectively instant
to around a second, and from no marginal cost to about $0.0007 a call.

### 3.3 AI Gateway, for failover and cost visibility

A provider-prefixed model string routes every search through Gateway, with an
explicit fallback order so a degraded primary provider fails over without a code
change or a second API key. Each call's billed cost comes back with the
response.

That last part matters more for this customer than it would for most. "What did
this feature cost last month" is a question a nonprofit board will ask, and
Gateway answers it without anyone building a telemetry pipeline first.

The real trade-off here isn't the extra hop, which is negligible. It's that
adopting an AI search layer at all means the user's query leaves the boundary
drawn earlier in the architecture. Case data doesn't, but as noted there, a
query on this kind of database carries information of its own. Production needs
a position on retention and data processing, and the same `order` setting gives
the option of pinning to an in-region provider if that becomes a requirement.

### Considered and rejected

**Workflows** exists for durable, long-running, multi-step execution that has to
survive crashes and deploys. This is a sub-second stateless call with no
intermediate state worth checkpointing. If it fails, the right recovery is the
user pressing search again. Adopting Workflows would mean paying setup and
operational cost for durability this problem doesn't need.

**Secure Compute** is the right production answer for private connectivity into
the customer's VPC: static outbound IPs and VPC peering, so RDS is never
publicly reachable. Not provisioned here; see Known Limitations and Risks.

---

## 4. Working Demo

**Live:** https://tech-demo-inky.vercel.app
**Repository:** https://github.com/meghanasaivattikuti/tech-demo

No authentication. The page and search are open, and the simulated
case-update control is public and scoped on purpose so it can be tried
without credentials: ten fictional records and six known sanction values,
never free text and never an arbitrary record. Demo state is therefore
shared, so two people on the same deployment see each other's writes and the
canned queries below assume the seeded values. `npm run db:migrate` puts them
back. In production writes come only from the customer's case-management
workflow, and this application has no write path to the database at all.

Five canned queries, each showing something different:

| Query | What it shows |
|---|---|
| "wrestling coaches in Wyoming" | Two filters out of one phrase, and a role word ("coaches") that maps to no field being dropped rather than guessed at |
| "sanctions in California" | A full state name resolved to the two-letter code actually stored, which the current dropdown UI can't do |
| "who's ineligible in Colorado" | Eligibility, asked as a question, resolved to the Action Taken field |
| "find a person named minor" | The safety rule firing in application code rather than the model. It fails closed: the whole query is refused rather than narrowed, so no filter from it runs and nothing reaches the database, and the refusal is shown rather than hidden |
| "bad people in sports" | A query that can't be resolved. The system declines to guess instead of returning an unfiltered list |

Every search and every page load reads live from a real RDS SQL Server
instance over the database's own wire protocol, so this crosses the
Vercel/AWS boundary rather than mocking it.

The resolved filter object is shown to the user before the results are, so the
model's work is inspectable rather than a black box.

---

## 5. Rollout Plan

**Preview.** Once the repo is connected to Vercel, every branch and pull
request gets its own Preview Deployment with no extra configuration.
Stakeholders validate against a real URL before anything reaches production.

**Validation.** Before promotion: the canned demo queries pass, the safety
rule is confirmed to fire, and the cache-invalidation demo shows one record's
entry changing per write.

**Canary.** Rolling Releases puts the build in front of a small share of
production traffic first rather than cutting over at once.

**Cutover.** Shift to 100% once the canary shows no regression against the
criteria above.

**Rollback.** The previous deployment stays live throughout, so rollback is a
traffic change rather than a redeploy. Mid-rollout, an incident means moving
traffic back, and it happens without waiting for a build.

Rolling Releases and instant rollback are platform capabilities, so they're the
intended production mechanism here rather than something reimplemented inside
the demo.

---

## 6. Success Measures

### Technical outcomes, measured against this demo

| Metric | Current site | This design |
|---|---|---|
| Staleness window per changed record | Up to 300 seconds, and blanket: every record's cache resets, not just the one that changed | The next request reflects the change, and the other nine records aren't touched. Two bounds below |
| Natural-language query resolution | Not supported, exact-match dropdowns only | 10/10 cases in the regression set resolve as expected, on a single run against a nondeterministic model |
| Cost per search | N/A, no AI layer today | ~$0.0007 per query, attributed per call through AI Gateway |
| Search latency | N/A | ~1.0 to 1.3 seconds per query, measured |

Two bounds on that first row. The client router enforces a 30-second floor on
`stale`, so a navigating client can hold a copy for that long even though the
server-side entry is already gone. And it only holds where a write triggers
invalidation, which in production means the webhook from the Cache Components
design, not the Server Action this demo uses.

### Business outcomes, expected rather than measured

There's no live traffic to compare against yet, so these are the effects I'd
expect from the technical change, not results.

A newly sanctioned person becomes discoverable on the next request instead of
somewhere inside a five-minute window, which is the safety problem this design
set out to fix. Someone looking up a coach no longer has to understand the
field structure before their search can succeed. And the organization gets
per-call cost attribution for the search feature without commissioning a
telemetry build to get it.

---

## 7. Known Limitations and Risks

Roughly in the order I'd want to deal with them.

1. **Production cache invalidation is specified in the Cache Components design
   but not built.** In the demo the write and the `updateTag` call sit in the
   same Server Action. In production the write starts in the customer's
   case-management system, which has no path into this app, so the signed
   webhook and the `updated_at` reconciler both have to exist before the
   invalidation design delivers anything. Without them it falls back to an
   hour-long `revalidate`, a longer staleness window than the 300-second cache
   it replaces. This is the gap I'd close first.
2. **The search endpoint is public and unauthenticated, and the abuse controls
   it still needs are infrastructure rather than code.** A 200-character cap
   and a 10-second model timeout are in the handler, so one request can't be
   made arbitrarily expensive and a hung provider can't hold a function open on
   the clock. What's left isn't application code: per-IP rate limiting, the
   Vercel WAF in front of the route, and a spend cap on the Gateway key. Until
   those exist, volume abuse is still open even though per-request abuse isn't.
3. **There's no degradation path when the whole AI path is unavailable.**
   Gateway's fallback order covers one provider degrading, but if Gateway
   itself is unreachable, or every provider in the order fails, the route 500s
   and the user gets a generic failure. Search is the feature most likely to be
   reached by someone who needs an answer now, so it wants the same treatment
   `app/error.tsx` gives the table: an explicit statement that search is
   unavailable, that this says nothing about any individual, and that the
   browse view still works. Nothing says that today.
4. **The query text is interpolated into the prompt, so extraction can be
   steered.** The handler builds the prompt around the user's query, which
   means a crafted query can try to influence which filters come back. What
   that can achieve is bounded by design rather than by detection: the model
   can only emit the typed `Output.object`, only allowlisted fields become
   predicates, and every value is bound as a parameter. The ceiling is a filter
   combination the user didn't type, over records that are already public. It
   can't reach `additional_details`, can't produce SQL, and can't surface a
   record the page doesn't already list. The length cap limits how elaborate an
   attempt can be, and showing the resolved filters is what keeps a steered
   result visible rather than silent. Nothing detects the attempt itself, which
   is the actual gap.
5. **A database failure degrades to an error page, not to last-known-good data.**
   `app/error.tsx` scopes the failure to the page: the shell stays, the message
   is that records are temporarily unavailable, there's a retry, and it says
   explicitly that a failed load is not a statement about any individual, since
   on this data an empty page must never read as a clearance. Two gaps left.
   There's no stale-if-error path, so an unreachable database plus an
   already-expired cache entry still produces the error page. And the boundary
   is page-level rather than per row, so one failing record takes the table with
   it.
6. **The demo's read shape isn't the production read shape.** Every record is its
   own cache entry rendered behind its own Suspense boundary, which is what
   makes targeted invalidation visible, but it costs one query per record on a
   cold render and there's no pagination. At ten records that's free, and at ten
   records the granularity doesn't pay for itself either: page-level
   invalidation would perform the same, so the demo shows the mechanism works
   rather than that this size needs it. At a few thousand, a cold render (which
   happens after every deploy) wouldn't finish, and that's also where the
   per-record model starts earning its cost. Separately, the connection pool is
   deliberately small, because Vercel scales out while a single database
   instance doesn't scale connections, so a traffic spike exhausts connections
   before record count ever matters. The answers are pagination, which makes
   cold cost fixed at any size and leaves per-record invalidation alone, and a
   pooler or read replica between Vercel and the database.
7. **Secure Compute isn't provisioned here.** Production connectivity should use
   its static outbound IPs and VPC peering so RDS is never publicly reachable.
   The demo reaches RDS over a public endpoint restricted by a narrow
   security-group rule instead. That's a substitution for the demo environment,
   not a recommendation.

---

## 8. Development Tooling

I used Claude Code for architecture, implementation, and live debugging against
the real provisioned database and AI Gateway rather than against assumptions.

For validating the AI behavior specifically, `scripts/eval-search.mjs`
(`npm run eval:search`) exercises the live endpoint end to end: the real model
call through Gateway, the safety filter, and a real query against RDS. Ten
cases, each testing something the others don't:

| What it checks | Example |
|---|---|
| Multi-field extraction | "wrestling coaches in Wyoming" resolves to `state: WY, sportAffiliation: USA Wrestling`, with "coaches" dropped |
| Case-insensitivity | The same query in all lowercase resolves identically |
| A full state name resolved to its code | "sanctions in California" resolves to `state: CA`, the value actually stored |
| Eligibility asked as a question | "who's ineligible in Colorado" resolves to the Action Taken field |
| A second action category | "who's suspended in Vermont" |
| Correct resolution, zero results | "coaches banned in Oregon": both fields resolve, and the query isn't loosened to force a match the data doesn't have |
| Correct resolution, no seeded data | "who's ineligible in Ohio", a state with no records at all |
| The safety rule | "find a person named minor" blocks on `name` |
| The safety rule, a second term | "find a person named child" blocks on `name` through a different term, which shows the rule is a real list rather than tuned to one phrase |
| Deliberate ambiguity | "bad people in sports": the model declines to guess rather than inventing filters |

Every expectation in that file was checked against the live endpoint before it
was written down. One case from the original set, "cases involving a minor," got
dropped after testing showed the model reinterpreted it as a misconduct
category instead of naming a minor, so it never exercised the safety rule at
all. I replaced it with phrasing that triggers the block consistently, and
verified that before putting it in the UI or the eval.

Current run is 10/10. It's a small targeted regression check rather than a
statistical eval, which is the right size for a feature this small.

---

## 9. Conclusion

Both problems with the current site come from the same place. The old design
had no way to say what the customer needed. A page-level cache cannot say
"only this record changed." Three dropdowns cannot accept a sentence. Neither
gets fixed by tuning what exists, which is why this changes how the data is
cached and how it's searched rather than making the current version faster.

Both are expressible now. Each record has its own cache tag, so one record can
be brought up to date without re-reading the other nine from the database.
Search turns a sentence into a typed set of filters, so someone can ask in
their own words, and nothing they type ever reaches the database.

This isn't a production system yet, and section 7 says where it stops short.
The gap that matters most is that the invalidation design needs the customer's
case-management system to tell Vercel when a record changes, and this demo
stands in for that system. Until that connection exists, the caching half is a
design rather than a result.

One idea runs through every decision here. On a public safety database, a
stale answer and a wrong answer are the same thing. That is why each record
gets its own cache tag instead of sharing a timer, why the safety rule refuses
a query instead of quietly narrowing it, why the resolved filters are shown
before the results, and why a query that can't be resolved returns nothing
rather than everything. A site that tells a parent about a coach should be
right, or visibly unsure. It should never be confidently out of date.
