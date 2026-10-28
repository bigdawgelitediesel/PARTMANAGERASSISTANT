# Parts Manager Assistant

Job parts tracker for Elite Diesel Service. Create a job, paste in vendor quotes and Fullbay received-parts lists, and click each part through Needed → Ordered → Received → Installed. Prices ride along on every line so the job's quoted, received, installed and still-needed dollars are always visible.

Live: deployed on Vercel from this repo.

## How it works

- **Jobs** are tabs across the top. Each job holds its quotes and a single reconciled parts list.
- **Add quote** pastes a vendor quote (text copied off a PDF, or a CSV/TSV with columns pn, description, qty, price). Lines are previewed and editable before they go in. Parts already on the job by the same part number get their price and qty updated instead of duplicated.
- **Add received list** pastes a Fullbay parts list. Part numbers that match a quote line flip that line to Received. Part numbers that don't match are added as received extras, and you can set which quoted part they cover (supersession) by opening the line.
- **Click a line** to edit it: description, qty, price, core, status, supersession, notes.
- **Click the status pill** to cycle Needed → Ordered → Received → Installed. The checkbox at the right is a one-tap Installed toggle.
- **Export / Import** moves all jobs as a JSON file between devices. Data lives in the browser's localStorage, so back it up with Export.

## Seeded job

`data/seed.js` ships with job **6657**, the Simper Trucking CAT C18 swap, reconciled 2026-10-28:

- Jackson Group Peterbilt Q38373 (74 lines, $22,874.78 with cores and promos)
- Fullbay RO 25166952 received list (18 lines) matched against the quote, with supersessions:
  - 5560701 bare liners replace the 20R0630 reman cylinder packs (liners only; pistons, rings, pins still open)
  - 1550809 / 1550810 / 1552793 individual liner seals replace the 3483295 liner seal kit
  - 360466 PAI spacer plate came in place of the Cat 6I4421 that was never on a quote
- GAP lines (pistons, pins, retainers, rings, rods, rod bearings, head studs) that no vendor quoted, priced from our own C15 ACERT purchase history.

Source documents are in `jobs/6657/`.

## Deploy

Static site, no build step. `vercel deploy --prod` from the repo root, or let the Vercel GitHub integration deploy on push to `main`.
