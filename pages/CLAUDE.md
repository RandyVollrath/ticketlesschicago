# Web App Instructions (Next.js Pages)

## Architecture
- **Pages Router** (not App Router) — files in `pages/` map directly to routes
- **API Routes** in `pages/api/` — serverless functions deployed to Vercel (60s timeout)
- **Components** in `components/` — shared React components
- **Libs** in `lib/` — backend utilities, Supabase client, scrapers

## Patterns
- All API routes must validate auth via Supabase session before accessing user data
- Supabase RLS is enabled on all tables — queries MUST include `user_id` filtering
- Use `@supabase/ssr` for server-side auth in API routes
- Environment variables: accessed via `process.env` (server) or `NEXT_PUBLIC_` prefix (client)

## Styling
- Tailwind CSS with `@tailwindcss/forms` plugin
- Global styles in `styles/globals.css`
- Component-scoped styles via CSS modules in `styles/`

## Deployment
- `npx vercel --prod --yes` from repo root deploys the web app
- Cron jobs are configured in `vercel.json` — 21 scheduled functions
- Serverless function timeout: 60 seconds (configured in `vercel.json`)

## Quality Checks
- Run `npm run lint` before committing web changes
- Run `npm run type-check` to catch TypeScript errors (the build silently ignores them)
- TypeScript strict mode is OFF — be extra careful with nullability
