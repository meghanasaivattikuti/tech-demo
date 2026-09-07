# Modernizing the Public Disciplinary Database (PDD)

**A Vercel Solutions Architect submission**

> Everything here describes a demo built on fictional data. No real
> individual's name, case, or disposition appears in this repository or on the
> live deployment.

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
|  RDS SQL Server - private subnet, not publicly              |
|  accessible in production                                   |
|    table: pdd_records                                        |
|    security group: inbound 1433 from Secure Compute's        |
|    static outbound IPs only                                  |
|                                                                |
|  internal reporting pipeline (Batch / Iceberg / Glue / Athena) |
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

Vercel owns presentation, caching and search resolution. AWS owns the case data
and everything that produces it. What crosses between them is a parameterized
read, plus (in this demo only) a narrowly scoped simulated write, covered
under Known Limitations and Risks.

### 2.3 What stays outside Vercel, and why

| System | Stays on | Why |
|---|---|---|
| The case data itself (RDS SQL Server, standing in for the real system of record) | AWS | Case data never leaves AWS or gets duplicated into Vercel. Data placement and residency decisions stay as they are today. |
| The internal reporting pipeline (Batch, Iceberg, Glue, Athena) | AWS | Internal reporting and analytics, unrelated to the public site. Out of scope for this work. |
| The legacy case-management system | Retired, not connected to | This describes the post-migration state. A live dual-system comparison isn't in scope. |

Keeping the data where it is, rather than replicating it into Vercel, is the
decision most of the rest of this design follows from.

One thing does cross the line, and I'd rather name it than let a reviewer find
it. Case data stays in AWS, but the *search query text* doesn't: it goes to the
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

I looked at ISR first and ruled it out on capability, not maturity. ISR's
`revalidate` is a property of a page, not a record, so it can't express
per-record invalidation at all. Building on it would have moved the bug rather
than fixed it. With Cache Components each record is its own cache entry under
its own tag, so one sanction changing invalidates one entry and the rest keep
serving.

The part that needs saying: event-driven invalidation is only as good as the
event. In this demo the write and the `updateTag` call happen in the same
Server Action, which is tidy but not how production works. There, the write
starts in the customer's case-management system, which has no path into this
app. That system has to tell Vercel something changed. The mechanism is a
signed webhook calling `revalidateTag(recordTag(id), { expire: 0 })`, with the
`updated_at` column (already maintained by an `AFTER UPDATE` trigger) as a
reconciler signal for anything missed. Two details in that call. It can't be
the demo's `updateTag`, which throws outside a Server Action, and the profile
is `{ expire: 0 }` rather than the generally recommended `max` because
stale-while-revalidate would keep serving the superseded sanction while the
refresh ran, which is the staleness this whole design exists to remove.

Without that integration this design falls back to the time-based `revalidate`
and doesn't beat a TTL. I've specified it here but not built it; see Known
Limitations and Risks.

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
without credentials.

Five canned queries, so there's no need to invent input. Each one shows
something different:

| Query | What it shows |
|---|---|
| "wrestling coaches in Wyoming" | Two filters out of one phrase, and a role word ("coaches") that maps to no field being dropped rather than guessed at |
| "sanctions in California" | A full state name resolved to the two-letter code actually stored, which the current dropdown UI can't do |
| "who's ineligible in Colorado" | Eligibility, asked as a question, resolved to the Action Taken field |
| "find a person named minor" | The safety rule firing in application code rather than the model. The `name` filter is dropped and the drop is shown, not hidden. Here it was the only filter extracted, so nothing reached the database at all; the known limitations cover the case where that isn't true |
| "bad people in sports" | A query that can't be resolved. The system declines to guess instead of returning an unfiltered list |

Every search and every page load reads live from a real RDS SQL Server
instance over the database's own wire protocol, so this crosses the
Vercel/AWS boundary rather than mocking it.

The AI layer isn't decorative: the resolved filter object is shown to the user
before the results are, so the model's work is inspectable rather than a black
box.

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
traffic change rather than a redeploy. That's the answer to "what does an
incident look like mid-rollout": you move traffic back, and you do it without
waiting for a build.

Rolling Releases and instant rollback are platform capabilities. I've described
them as the intended production mechanism rather than reimplementing them
inside the demo, which would misrepresent what the application actually does.

---

## 6. Success Measures

### Technical outcomes, measured against this demo

| Metric | Current site | This design |
|---|---|---|
| Staleness window per changed record | Up to 300 seconds, and blanket: every record's cache resets, not just the one that changed | Server-side, the next request reflects the change and the other nine records aren't touched. Two bounds worth stating: the client router enforces a 30-second floor on `stale`, so a navigating client can hold a copy that long, and this only holds where a write triggers invalidation, which in production needs the webhook from the Cache Components design |
| Natural-language query resolution | Not supported, exact-match dropdowns only | 10/10 cases in the regression set resolve as expected, on a single run against a nondeterministic model |
| Cost per search | N/A, no AI layer today | ~$0.0007 per query, attributed per call through AI Gateway |
| Search latency | N/A | ~1.0 to 1.3 seconds per query, measured |

### Business outcomes, expected rather than measured

There's no live traffic to compare against yet, so these are the effects I'd
expect from the technical change, not results.

A newly sanctioned person becomes discoverable on the next request instead of
somewhere inside a five-minute window, which is the safety problem stated at
the top. Someone looking up a coach no longer has to understand the field
structure before their search can succeed. And the organization gets per-call
cost attribution for the search feature without commissioning a telemetry build
to get it.

---

## 7. Known Limitations and Risks

Roughly in the order I'd want to deal with them.

1. **The search endpoint is public, unauthenticated, unthrottled, and takes an
   unbounded query string.** It calls a paid model on every request with no
   length cap on the input, so a single request can be made arbitrarily
   expensive. Fixes: a length cap and request timeout in the handler, rate
   limiting and the Vercel WAF in front of the route, and a spend cap on the
   Gateway key.
2. **Production cache invalidation is specified in the Cache Components design
   but not built.** In the demo the write and the `updateTag` call sit in the
   same Server Action. In production the write starts in the customer's
   case-management system, which has no path into this app, so the signed
   webhook and the `updated_at` reconciler both have to exist before the
   invalidation design delivers anything. Without them it falls back to the
   time-based `revalidate` and doesn't improve on a TTL. This is the gap I'd
   close first.
3. **The minor-context filter drops the offending field instead of rejecting the
   query.** When the rule fires, sibling filters survive and the search still
   runs, so a query combining a blocked term with a second filter comes back
   *broader* than what was asked for rather than refused. The drop is disclosed
   in the UI, but a safety control should fail closed, and the right behavior is
   to reject the request. Worth being clear that this rule is defence in depth
   and not the primary protection: `additional_details` is the only column that
   can reference a minor, and it's excluded from the searchable allowlist, so a
   minor can't be a search subject regardless of the term list.
4. **A database failure degrades to an error page, not to last-known-good data.**
   `app/error.tsx` scopes the failure to the page: the shell stays, the message
   is that records are temporarily unavailable, there's a retry, and it says
   explicitly that a failed load is not a statement about any individual, since
   on this data an empty page must never read as a clearance. Two gaps left.
   There's no stale-if-error path, so an unreachable database plus an
   already-expired cache entry still produces the error page. And the boundary
   is page-level rather than per row, so one failing record takes the table with
   it.
5. **The demo's read shape isn't the production read shape.** Every record is its
   own cache entry rendered behind its own Suspense boundary, which is what
   makes targeted invalidation visible, but it costs one query per record on a
   cold render and there's no pagination. At ten records that's free. At a few
   thousand, a cold render (which happens after every deploy) wouldn't finish.
   Separately, the connection pool is deliberately small, because Vercel scales
   out while a single database instance doesn't scale connections, so a traffic
   spike exhausts connections before record count ever matters. The answers are
   pagination, which makes cold cost fixed at any size and leaves per-record
   invalidation alone, and a pooler or read replica between Vercel and the
   database.
6. **The eval set is one run and isn't in CI.** It runs on demand
   (`npm run eval:search`) against a live instance and a nondeterministic model
   with no seed, so 10/10 is one observation rather than a pass rate. Nothing
   triggers it when the extraction prompt or schema changes. Repeated runs with
   a pass-rate threshold, a fixture database instead of the live one, and a
   pre-merge check are the next steps.
7. **Secure Compute isn't provisioned here.** Production connectivity should use
   its static outbound IPs and VPC peering so RDS is never publicly reachable.
   The demo reaches RDS over a public endpoint restricted by a narrow
   security-group rule instead. That's a disclosed substitution for the demo
   environment, not a recommendation.
8. **Adding or removing a record means invalidating a second index tag**, not
   just the record's own tag, because per-record tags can't discover rows that
   don't exist yet. The cost is small: that tag covers the id list only, so
   invalidating it re-runs one query and leaves every record entry intact.
9. **The simulated case-update control is public on purpose**, scoped to ten
   fictional records and six known sanction values, never free text and never an
   arbitrary record, so the invalidation behavior can be demonstrated without
   credentials. The consequence is that demo state is shared: two reviewers on
   the same deployment see each other's writes, and the canned demo queries
   assume the seeded values. `npm run db:migrate` puts them back. In production
   writes come only from the customer's case-management workflow and this
   application has no write path to the database at all.

---

## 8. Development Tooling

I used Claude Code throughout, for architecture, implementation, and live
debugging against the real provisioned database and AI Gateway rather than
against assumptions.

For validating the AI behavior specifically, `scripts/eval-search.mjs`
(`npm run eval:search`) exercises the live endpoint end to end: the real model
call through Gateway, the safety filter, and a real query against RDS. Ten
cases, each testing something the others don't:

| What it checks | Example |
|---|---|
| Multi-field extraction | "wrestling coaches in Wyoming" resolves to `state: WY, sportAffiliation: USA Wrestling`, with "coaches" dropped |
| Case-insensitivity | The same query in all lowercase resolves identically |
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
statistical eval, which is the right size for a feature this small but worth
being explicit about.

---

## 9. Platform Feedback

Specific things I hit building this, good and bad.

### Worked well

**The Gateway model string removed real operational work.** Once deployed, the
search feature needed no Anthropic API key at all, because Vercel Functions
authenticate to Gateway with the project's own OIDC token. One less secret to
provision, rotate or leak.

**The cache-tag model is easy to reason about and easy to verify.** `cacheTag`
plus `updateTag` reduces to a claim you can actually test, one write
invalidates one entry, which mattered here because that claim is the whole
value proposition.

**Structured outputs made an LLM-in-front-of-a-database design feel safe to
build.** `generateText` with a typed `Output.object` schema draws a clean line
between what the model said and what a parameterized query runs. Without that
line I'm not sure I'd have been comfortable putting a model in front of live
case data.

### Frustrations, each with a suggestion

**Gateway's per-key Spend Budget is easy to mistake for billing.** It reads like
a dial controlling whether a key can call paid models. It actually caps spend
against a team balance that has to be funded separately at the team level. That
cost me real debugging time telling "the team has no billing set up" apart from
"this key has no budget." Surfacing team-level plan and billing status on the
per-key page, not only on a separate billing screen, would have saved it.

**`mssql` failed only inside Next.js, with an error that pointed nowhere
useful.** `parameter.type.validate is not a function` gave no hint that the
cause was Turbopack bundling two copies of the module and breaking the driver's
internal identity checks. The fix, `serverExternalPackages`, is one line once
you know to look. When a "not a function" error surfaces from a dependency
that isn't listed there, a dev-mode hint pointing at that setting would be a
reasonable guess to offer.

**Every built-in `cacheLife` profile ships `stale: 300`, and `stale` has a floor
you can't see from the call site.** The default is a quiet footgun for anything
correctness-critical: nothing flags that a client can hold a five-minute-old
copy even with per-record tags configured correctly. Setting `stale: 0` doesn't
fully close it either, because the client router enforces a 30-second minimum
so prefetched links stay usable. That floor is sensible and it is documented,
but it's invisible where you write the code, and `stale: 0` reads like a
guarantee it can't give. Surfacing the effective clamped value in dev, or
warning when a value below the floor is passed, would close the gap between
what's written and what applies.

**The 64KB total environment-variable cap doesn't surface until deploy.** A
multi-line secret like a CA bundle can exceed it locally, where nothing
enforces the limit, and only fail on deploy. A warning as a project approaches
the ceiling, in `vercel env add` or during `next dev`, would catch it earlier.
