# Public Disciplinary Database (PDD) Modernization Demo

A small Next.js app on Vercel demonstrating a modernized architecture for a Public Disciplinary Database (PDD) lookup tool, inspired by real-world sports-safety disciplinary databases.

All data in this repo is fictional, and this project is not affiliated with or endorsed by any real organization.

**Live demo:** _TODO - add the deployed Vercel URL here_

See [SUBMISSION.md](./SUBMISSION.md) for the problem statement, architecture, Vercel primitive choices, rollout plan, success measures, and known limitations.

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
