# Public Disciplinary Database (PDD) Modernization Demo

A small Next.js app on Vercel demonstrating a modernized architecture for a Public Disciplinary Database (PDD) lookup tool, inspired by real-world sports-safety disciplinary databases.

All data in this repo is fictional, and this project is not affiliated with or endorsed by any real organization.

**Live demo:** https://tech-demo-inky.vercel.app

## Running it locally

Requires a SQL Server database (RDS or otherwise) and a Vercel AI Gateway key.

```bash
cp .env.example .env.local
# fill in DB_HOST, DB_USER, DB_PASSWORD, DB_CA_CERT, AI_GATEWAY_API_KEY
# see the comments in .env.example for where each value comes from

npm install
npm run db:migrate   # creates the database and seeds 10 fictional records
npm run dev
```

## Verifying the search feature

```bash
npm run eval:search
```

Runs a small set of live regression checks against `/api/search` - multi-field extraction, case-insensitivity, the deterministic minor-context safety rule (two independent trigger terms), and a deliberately ambiguous query. See `scripts/eval-search.mjs` for the full case list.

## Verifying the sanction-update workflow

Simulating a sanction update on the homepage doesn't write to RDS directly. It proposes a change, which pauses as a real **Vercel Workflow** run (`workflows/sanction-update.ts`) until someone reviews it in the "Workflow run" section. Approving is what actually writes the record; rejecting means the write never happens at all, since it was never applied in the first place. No extra local setup is needed, since `npm run dev` bundles the workflow backend automatically.

To see it working, submit an update from the homepage, then approve or reject it under "Workflow run." Check `dbo.pdd_record_audit` to see the proposal's row move from `pending` to `approved`/`rejected`, and `dbo.pdd_records` to see the write land only after an approval. Once deployed, runs also show up under Observability > Workflows in the Vercel dashboard. The search feature deliberately doesn't use Workflows, since a single short-lived model call doesn't need that machinery - see the comment at the top of `app/api/search/route.ts` for the full reasoning.

## Vercel primitives used

Caching is handled with **Cache Components**, enabled via `cacheComponents: true` in `next.config.ts`, and each record gets its own `cacheTag`/`cacheLife` pair through `"use cache: remote"` in `lib/db.ts`, so a write to one record invalidates only that record instead of the whole page or the other nine.

The search endpoint in `app/api/search/route.ts` uses the **AI SDK**'s `generateText` with a structured `Output` schema to turn a plain-language query directly into the filter object the search runs on, instead of hand-parsing the model's response.

That same call goes through **AI Gateway**, via a provider-prefixed model string rather than a provider SDK directly, which is what gives it failover and per-call cost tracking.

The sanction-update path runs through **Workflows**, as described above, so the actual approval gate is a durable, resumable pause rather than a write that already happened by the time anyone reviews it.

The database connection is still authenticated with a username, password, and pinned TLS certificate on every request (see `lib/db.ts`), but the RDS instance itself is not currently restricted to Vercel's egress IPs. That would take either **Static IPs** ($100/month per project on Pro) or **Secure Compute** (Enterprise-only, custom pricing), neither of which this project is set up to use right now - see the comment in `.env.example` for what adding one would involve.

All of the `DB_*` values and the AI Gateway credential are stored as **sensitive environment variables**, meaning they're encrypted at rest, can never be read back once set, and are only injected into the running function at request time.
