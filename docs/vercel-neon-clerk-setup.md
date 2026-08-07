# Vercel + Neon + Clerk Setup

## Architecture

- Vercel hosts the static pages and `/api/*` serverless functions.
- Clerk signs users in from the browser and issues JWTs.
- The browser sends Clerk JWTs to `/api/*`.
- Vercel functions verify Clerk JWTs, enforce roles, and query Neon.
- Neon is never accessed directly from the browser.

## Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

```env
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_or_test_...
CLERK_ISSUER_URL=https://your-clerk-domain.clerk.accounts.dev
CLERK_JWKS_URL=https://your-clerk-domain.clerk.accounts.dev/.well-known/jwks.json
ADMIN_EMAILS=first.admin@company.com,second.admin@company.com
```

`DATABASE_URL`, `CLERK_JWKS_URL`, and `ADMIN_EMAILS` are server-side only. Do not put them in `config.js`.

## Neon Database

Run:

```sql
\i docs/neon-schema.sql
```

Then seed initial data:

```bash
npm run seed:neon
```

The generated `docs/supabase-seed.sql` is standard Postgres for this schema. You can run it in Neon SQL Editor after `docs/neon-schema.sql`.

## Clerk Roles

The API recognizes these roles:

- `admin`: full write access
- `supervisor`: work orders, assets, settings
- `technician`: maintenance logs only
- `viewer`: read-only

Set a user role in Clerk custom JWT claims as `role`, `metadata.role`, or `public_metadata.role`.
Emails listed in `ADMIN_EMAILS` are always treated as admins.

## Deploy

From `site/`:

```bash
npm install
npm run build
vercel deploy
vercel deploy --prod
```

For Git deployment, set the Vercel project root to `site/`.
