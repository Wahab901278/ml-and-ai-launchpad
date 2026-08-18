# Automated Job Applications

Daily job scan → AI match scoring → ATS keyword check → cover letter → queued to
Google Sheets for your review.

One workflow, no outbound email (except a daily summary to you). Applications
happen by hand, straight from the spreadsheet.

```
n8n (local)                              Google Sheets
┌────────────────────────────┐   ┌────────────────┐
│ 01 Daily Job Scan  (30)    │──▶│   Queue        │
│  schedule 08:00            │   │   Contacts     │
│  daily summary email       │   │   Skipped      │
└────────────────────────────┘   └────────────────┘
```

**30 nodes total.**

---

## 1. Prerequisites

| Service | Get the key at | Free limit |
|---|---|---|
| Gemini | aistudio.google.com | rate-limited, ample here |
| Apify | apify.com → Settings → API token | ~$5/month of platform credit |
| Google Cloud | console.cloud.google.com | free — enable Sheets, Drive, Gmail APIs |
| n8n | `npx n8n` or Docker | free, self-hosted |

## 2. Create the Google Sheet tabs

Create one spreadsheet, then in it: **Extensions → Apps Script**, paste the
contents of [`workflows/sheet-setup.gs`](workflows/sheet-setup.gs), press **Run**,
and approve the one-time permission prompt. It creates the tabs below with the
exact headers and deletes the default `Sheet1`.

Doing it by hand works too, but the headers must match character for character —
the Sheets nodes map by column name, and a typo drops that column silently.
`src/schema.mjs` is the source of truth, and `npm run build:workflows` fails if
the workflow and the schema ever disagree.

**`Queue`**
```
job_id · date_found · title · company · domain · location · is_remote · url ·
match_score · ats_score · verdict · matched_skills · ats_missing · ats_note ·
reasoning · recruiter_name · recruiter_email · recruiter_title · contact_source ·
subject · cover_letter · status · sent_at · notes
```

**`Contacts`** — cache of posting-provided contacts by company domain
```
domain · company · recruiter_name · recruiter_email · recruiter_title · found_at
```

**`Skipped`**
```
date_found · job_id · title · company · url · match_score · reason
```

**`Meta`** — reserved, leave empty for now.

## 3. Start n8n (Docker)

```bash
cp .env.example .env
```

Fill in `.env`, verify it, then bring up the container:

```bash
node scripts/check-env.mjs
docker compose up -d
docker compose logs -f
```

Wait for `Editor is now accessible via: http://localhost:5678`.

Docker is the recommended path: n8n depends on `sqlite3`, a native module that
frequently fails to build against very new Node versions on the host. The image
ships it prebuilt.

`GENERIC_TIMEZONE` is set to `Asia/Karachi` in `docker-compose.yml`. Containers
default to UTC, which would silently shift the "08:00" daily scan by five hours.
Change it if you move.

**Running without Docker** (if you prefer) — note `source`, not
`export $(... | xargs)`; the `xargs` form doesn't strip trailing `# comments`
and will corrupt your keys:

```bash
set -a && source .env && set +a && n8n start
```

### Useful container commands

```bash
docker compose logs -f          # follow logs
docker compose restart          # apply compose changes
docker compose down             # stop (keeps credentials)
docker compose down -v          # DESTROYS credentials and the encryption key
```

`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` matters — without it `$env.GEMINI_API_KEY`
resolves to nothing inside Code nodes and every AI step fails silently.

## 4. Import the workflow

```bash
npm run build:workflows
```

In n8n: **Workflows → Import from File** → `workflows/01-daily-job-scan.json`.

After importing, open the workflow and **re-select the credentials** on the
Google Sheets / Drive / Gmail nodes. The credential IDs in the JSON are
placeholders and will show as "credential not found" until you pick yours.

Then open the **Config** node and set `sheetId`, `resumeFileId`, your name and
email, and your target `keywords`.

Activate the workflow so the 08:00 schedule fires.

## 5. First run

Run `01` manually with **Execute Workflow** before trusting the schedule. Watch
for the two things that usually break first:

- **Extract Resume Text** throwing on a short string → wrong Drive file id, or
  your resume is a `.docx` (switch the node's operation from `pdf` to `text`).
- **Gemini: Score Match** returning an error object → bad API key, or the model
  id in Config no longer exists. Check current model names in AI Studio.

Each run emails you a summary with the day's matches and a link to the review
sheet. Jobs land in the `Queue` tab; rejected/low-score jobs go to `Skipped`.

---

## How the free tiers are respected

**Apify.** Billing is per result. `apifyJobsEntries` (100) is the real cost
lever, roughly $0.0005 per row. Costs scale with `locations × entries`.

**Contacts (no API cost).** The workflow only uses a contact address that the
posting itself publishes. When it finds one it caches it against the company
domain in the `Contacts` tab, so repeat postings from the same company reuse it
without any lookup.

Jobs without a posting-provided email land in the queue as `manual_apply` with
the posting URL. **Expect most jobs to end up here** — most companies don't
publish a recruiter address in the listing. That's the honest ceiling of
discovering contacts without a paid enrichment service, not a bug.

**Gemini.** One job at a time through `Loop Over Jobs`, with an 8-second `Throttle`
between iterations, keeps you under the free requests-per-minute limit.

**Gmail.** One summary email per day — nowhere near any sending limit.

## Design decisions worth knowing

**Your master resume is never rewritten.** You chose this, and it's the right
call — LLMs fabricate employment history when asked to "tailor". Instead the
`ATS Keyword Score` node tells you deterministically which JD keywords your
resume is missing, so you can decide whether to hand-edit before applying.

**Gemini is called over plain HTTP**, not the LangChain sub-nodes. Stable across
n8n versions, and `responseSchema` gives strict JSON. Every response still goes
through a defensive parser — a quota error returns a completely different shape,
and an unguarded `JSON.parse` would kill the run mid-loop.

## Things to watch

- **Apify credit.** 100 rows/day × ~30 days ≈ $1.50/month. Keep an eye on the
  actor's per-row price if it changes.
- **Repost-heavy days.** Scraper sites republish listings with the real employer
  name stripped; `Normalize & Dedupe` filters them, which can make a day look
  empty. That's the filter working, not a broken scan.

## Layout

```
workflows/          generated n8n JSON — import this
src/                workflow source (readable Code-node JS lives here)
scripts/            build-workflows.mjs, check-env.mjs
```

Edit the workflow in `src/wf1-daily-scan.mjs` and re-run `npm run build:workflows`
rather than hand-editing the JSON — the Code nodes are far easier to read there.
