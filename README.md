# TTS Equipment Maintenance

Static first version of the equipment maintenance website. It uses the Excel workbook as seed data and is ready to push to GitHub Pages, Vercel, or later connect to Supabase.

## What is included

- Live equipment status board
- Machine detail view with imported maintenance history
- Maintenance log form with down/up event times
- PM schedule calendar and due-by-hours table
- Work order queue
- Asset and Settings editors
- Optional Supabase persistence with Auth
- Excel import script
- Supabase schema and seed exporter

## Local preview

Open `index.html` directly, or run a static server from this folder.

```bash
npm install
npm run dev
```

## Build check

```bash
npm run build
```

## Data import

The app reads `data/equipment-data.json`. To refresh it from the workbook, run:

```bash
python tools/import_excel.py
```

The importer keeps a local workbook copy at `data/source-equipment-status.xlsx` and exports structured machine, update, work order, PM, and forklift seed data.

## Supabase

The app works locally with browser storage when `config.js` is blank. When Supabase is configured, it redirects users to `login.html` and reads/writes through Supabase REST using the signed-in user's access token.

Launch flow:

1. Create a Supabase project.
2. In Supabase SQL Editor, run `docs/supabase-schema.sql`.
3. Generate seed SQL:

```bash
npm run seed:sql
```

4. In Supabase SQL Editor, run the generated `docs/supabase-seed.sql`.
5. In Supabase Auth, create at least one email/password user.
6. Copy `config.example.js` into `config.js`, then paste your Supabase project URL and public anon key.
7. Deploy the `site/` folder to Vercel, GitHub Pages, or another static host.

The anon key is safe to expose in browser code. Do not put the Supabase service role key in `config.js`.

## Launch checklist

- Confirm every shop user has a Supabase Auth account.
- Test asset create/edit, work order create/edit/close/delete, and maintenance logs on the deployed URL.
- Confirm mobile/tablet layout for the log form.
- Export or back up data regularly from Supabase.
