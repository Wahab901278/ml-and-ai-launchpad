// Workflow 1 — Daily Job Scan.
// Discovers jobs, scores them against the master resume, writes a review queue
// to Google Sheets. Sends nothing: review and applying happen by hand in the
// spreadsheet. The only outbound email is the daily summary.

import { node, codeNode, setNode, geminiNode, workflow, resetIds, CRED } from './lib.mjs';

export function build() {
  resetIds();

  const trigger = node(
    'Daily Trigger',
    'n8n-nodes-base.scheduleTrigger',
    { rule: { interval: [{ triggerAtHour: 8, triggerAtMinute: 0 }] } },
    { typeVersion: 1.2, notes: 'Runs once per day at 08:00 local time.' },
  );

  // Lets the workflow be started on demand — by `n8n execute --id=...`, or by
  // another workflow — without waiting for 08:00. The Schedule Trigger above
  // remains the production entry point; both feed the same Config node.
  const manualTrigger = node(
    'Run Now (manual)',
    'n8n-nodes-base.executeWorkflowTrigger',
    { inputSource: 'passthrough' },
    { typeVersion: 1.1, notes: 'Test entry point. Does not affect the daily schedule.' },
  );

  // ---------------------------------------------------------------- config
  const config = setNode(
    'Config',
    `={{ {
  "keywords": ["AI engineer", "AI automation engineer", "full stack developer"],
  "locations": ["Pakistan"],
  "datePosted": "week",

  "apifyActor": "worldunboxer~rapid-linkedin-scraper",
  "apifyJobsEntries": 100,
  "apifyExperience": "Mid-Senior",
  "apifyEmploymentType": "Full-time",
  "apifyWorkArrangement": "",
  "apifyEasyApply": false,

  "minMatchScore": 60,
  "maxJobsPerDay": 12,

  "geminiFastModel": "gemini-3.6-flash",
  "geminiProModel": "gemini-pro-latest",

  "sheetId": $env.JOBS_SHEET_ID,
  "resumeFileId": $env.RESUME_FILE_ID,
  "candidateLocation": "Karachi, Pakistan. Fully authorized to work in Pakistan — no visa or sponsorship needed for any Pakistan-based role. Open to onsite, hybrid and remote work within Pakistan, and to remote roles for foreign companies that hire international contractors.",
  "yourName": "Tahir Murtaza",
  "summaryTo": "tahirmurtaza5152@gmail.com"
} }}`,
    {
      notes:
        'sheetId and resumeFileId come from the container environment (.env), so ' +
        'there is nothing to paste here. Re-run scripts/check-env.mjs to ' +
        'confirm the Gemini model IDs still exist — Google rotates these often.',
    },
  );

  // ------------------------------------------------------------- resume in
  const getResume = node(
    'Download Master Resume',
    'n8n-nodes-base.googleDrive',
    {
      operation: 'download',
      fileId: { __rl: true, value: '={{ $json.resumeFileId }}', mode: 'id' },
      options: { googleFileConversion: { conversion: { docsToFormat: 'text/plain' } } },
    },
    { typeVersion: 3, credentials: CRED.drive, retry: { maxTries: 2 } },
  );

  const extractResume = node(
    'Extract Resume Text',
    'n8n-nodes-base.extractFromFile',
    { operation: 'pdf', options: {} },
    {
      typeVersion: 1,
      notes:
        'If your master resume is a .docx or Google Doc, switch operation to ' +
        '"text" — the Drive node above already converts Google Docs to plain text.',
    },
  );

  const holdResume = codeNode(
    'Hold Resume Text',
    `
    // Normalise whatever the extractor produced into one clean string and stash
    // it on the workflow's static data so later nodes can read it cheaply.
    const item = $input.first().json;
    const text = (item.text || item.data || '').replace(/\\r/g, '').trim();

    if (text.length < 200) {
      throw new Error(
        'Resume text came back as ' + text.length + ' chars. That is almost ' +
        'certainly a failed extraction — check the Drive file ID and file type.'
      );
    }

    return [{ json: { resumeText: text, resumeChars: text.length } }];
    `,
  );

  // ------------------------------------------------------------- discovery
  const buildQueries = codeNode(
    'Build Search Queries',
    `
    // This actor takes jobs_titles as an ARRAY, so all keywords go in ONE run.
    // Billing is per result, so apifyJobsEntries is the real cost lever:
    // roughly $0.0005 per row (1000 rows measured at ~$0.52).
    const cfg = $('Config').first().json;
    const resume = $('Hold Resume Text').first().json;

    // The actor expects LinkedIn's human-readable recency labels.
    const POSTED_WITHIN = {
      today: 'Past 24 hours',
      '3days': 'Past Week',
      week: 'Past Week',
      month: 'Past Month',
      all: 'Any Time',
    };

    // The actor's location field is a single string, so multiple locations mean
    // one actor run each. Cost scales with locations x apifyJobsEntries, so
    // apifyJobsEntries is PER RUN, not per day — drop it when adding locations.
    const locations = Array.isArray(cfg.locations)
      ? cfg.locations
      : [cfg.locations || 'Worldwide'];

    const clean = locations
      .map((l) => String(l ?? '').trim())
      .filter(Boolean)
      .map((l) => (l === 'Anywhere' ? 'Worldwide' : l));

    if (!clean.length) throw new Error('Config.locations is empty — set at least one location.');

    console.log(
      'Searching ' + clean.length + ' location(s): ' + clean.join(', ') +
      ' x ' + cfg.apifyJobsEntries + ' results each'
    );

    return clean.map((location) => ({
      json: {
        jobs_titles: cfg.keywords,
        location,
        posted_within: POSTED_WITHIN[cfg.datePosted] ?? 'Past Week',
        resumeText: resume.resumeText,
      },
    }));
    `,
  );

  const discovery = node(
    'Apify: LinkedIn Jobs',
    'n8n-nodes-base.httpRequest',
    {
      method: 'POST',
      // run-sync-get-dataset-items blocks until the actor finishes and returns
      // the scraped rows directly, so no polling loop is needed.
      url: "=https://api.apify.com/v2/acts/{{ $('Config').first().json.apifyActor }}/run-sync-get-dataset-items?token={{ $env.APIFY_TOKEN }}",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify(Object.fromEntries(Object.entries({
  jobs_titles: $json.jobs_titles,
  location: $json.location,
  posted_within: $json.posted_within,
  jobs_entries: $('Config').first().json.apifyJobsEntries,
  experience: $('Config').first().json.apifyExperience,
  employment_type: $('Config').first().json.apifyEmploymentType,
  work_arrangement: $('Config').first().json.apifyWorkArrangement,
  easy_apply: $('Config').first().json.apifyEasyApply
}).filter(([, v]) => v !== '' && v !== null && v !== undefined))) }}`,
      options: {
        // Actors routinely take 1-3 minutes; the default timeout is far too low.
        timeout: 300000,
        response: { response: { neverError: true } },
      },
    },
    {
      typeVersion: 4.2,
      retry: { maxTries: 2, wait: 15000 },
      continueOnFail: true,
      alwaysOutputData: true,
      notes:
        'Body matches worldunboxer/rapid-linkedin-scraper. Empty Config values ' +
        'are stripped so optional filters (work_arrangement) can be left off. ' +
        'A different actor needs a different body — check its Input tab.',
    },
  );

  const normalize = codeNode(
    'Normalize & Dedupe',
    `
    // Flatten discovery responses into one common job shape, drop duplicates and
    // drop anything without enough description text to score against.
    //
    // Written to survive a change of source: Apify returns a bare array of rows
    // (n8n splits it into one item each). Field names differ too, so every
    // value is read through a list of candidate keys rather than one hard-coded
    // spelling.
    const out = new Map();
    const problems = [];
    const dropped = { redacted: 0, aggregator: 0, thin: 0, dupe: 0, incomplete: 0 };
    const seenDupeKeys = new Set();
    let sawRows = 0;
    let sampleKeys = null;

    // Scraper/repost sites that republish listings with the real employer name
    // stripped out. They host on throwaway PaaS domains, so the employer's real
    // contact is unknowable and the JD is useless for a cover letter.
    const AGGREGATOR_HOST = /(railway\\.app|liveblog365\\.com|herokuapp\\.com|vercel\\.app|netlify\\.app|onrender\\.com|repl\\.co|glitch\\.me)$/i;
    const AGGREGATOR_NAME = /^(flexboard|remote click jobs|remote zest jobs|vacancy global pro|jobleads|grabjobs|recruit\\.net|joblist)/i;

    // These sites replace the employer name with a placeholder throughout the
    // text. One or two hits could be coincidence; repeated hits cannot.
    const isRedacted = (text) =>
      (text.match(/reputed company/gi) || []).length >= 3;

    const first = (obj, names) => {
      for (const n of names) {
        const v = n.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };

    const looksLikeJob = (o) =>
      o && typeof o === 'object' &&
      Boolean(first(o, ['job_title', 'title', 'jobTitle', 'name']));

    const findRows = (p) => {
      // Apify's dataset endpoint returns a bare array, and n8n splits that into
      // one item per row — so a payload may itself already BE a job.
      if (looksLikeJob(p)) return [p];
      const candidates = [
        p?.data?.jobs, p?.data?.results, p?.data?.items,
        p?.data, p?.jobs, p?.results, p?.items,
      ];
      return candidates.find((v) => Array.isArray(v));
    };

    for (const item of $input.all()) {
      const payload = item.json;
      const rows = findRows(payload);

      if (!rows) {
        problems.push(
          payload?.error?.message ??
          payload?.message ??
          'no jobs array found; top-level keys: ' + Object.keys(payload ?? {}).join(',') +
            '; data keys: ' + Object.keys(payload?.data ?? {}).join(',')
        );
        continue;
      }

      sawRows += rows.length;

      for (const j of rows) {
        if (!sampleKeys) sampleKeys = Object.keys(j);

        const title = String(first(j, ['job_title', 'title', 'jobTitle', 'name']) ?? '').trim();
        const company = String(
          first(j, ['employer_name', 'companyName', 'company_name', 'company', 'employer.name', 'organization']) ?? ''
        ).trim();
        // Strip the HTML variant so it never reaches the LLM as markup.
        if (!first(j, ['job_description', 'descriptionText', 'description'])) {
          const html = first(j, ['job_description_raw_html', 'descriptionHtml']);
          if (html) j.description = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        const description = String(
          first(j, ['job_description', 'descriptionText', 'description', 'descriptionHtml', 'job_summary', 'snippet']) ?? ''
        ).trim();

        if (!title || !company || description.length < 200) { dropped.thin++; continue; }

        // Reject reposts before they cost us Gemini quota.
        if (isRedacted(description)) { dropped.redacted++; continue; }
        if (AGGREGATOR_NAME.test(company)) { dropped.aggregator++; continue; }

        // Prefer the real company domain so a found contact can be cached on it.
        const website = first(j, [
          'employer_website', 'companyWebsite', 'company_website', 'employer.website', 'company_url',
        ]);
        let domain = '';
        try {
          if (website) domain = new URL(String(website)).hostname.replace(/^www\\./, '');
        } catch (e) { /* malformed URL, leave blank */ }

        // companyLinkedinUrl and friends resolve to the job board, not the
        // employer. A normalized domain of linkedin.com (or any other job
        // board) is meaningless and would poison the contact cache.
        // Match the registrable name anywhere in the host: LinkedIn serves
        // country subdomains like in.linkedin.com, which an anchored pattern
        // would let through.
        if (/(^|\\.)(linkedin|indeed|glassdoor|ziprecruiter|monster|dice|jobgether|jobleads|naukri|bayt|rozee|wellfound|greenhouse|lever|workable|smartrecruiters)\\./i.test(domain)) {
          domain = '';
        }

        if (domain && AGGREGATOR_HOST.test(domain)) { dropped.aggregator++; continue; }

        // Prefer the source's own posting id: it is stable across runs even if
        // the title is edited. Fall back to company+title only when absent.
        const sourceId = String(first(j, ['job_id', 'jobId', 'id']) ?? '').trim();
        const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Normalised title strips seniority/formatting noise so "Sr. AI Engineer"
        // and "Senior AI Engineer (Remote)" collapse to one entry.
        const titleKey = slug(
          title
            .replace(/[\\(\\[]\\s*(remote|hybrid|on-?site|contract|full[- ]?time|part[- ]?time)\\s*[\\)\\]]/gi, ' ')
            .replace(/\\b(sr|snr)\\b\\.?/gi, 'senior')
            .replace(/\\b(jr)\\b\\.?/gi, 'junior')
            .replace(/\\s*[|\\-\u2013\u2014,].*$/, '')
        );
        const dupeKey = slug(company) + '::' + titleKey;

        const key = sourceId ? 'lj-' + sourceId : dupeKey;

        // Reject both an exact id repeat and a same-company same-role repeat.
        if (out.has(key) || seenDupeKeys.has(dupeKey)) { dropped.dupe++; continue; }
        seenDupeKeys.add(dupeKey);

        const locationRaw = first(j, ['job_location', 'location']);
        const location = typeof locationRaw === 'string'
          ? locationRaw
          : [
              first(j, ['job_city', 'city', 'location.city']),
              first(j, ['job_state', 'state', 'location.state']),
              first(j, ['job_country', 'country', 'location.country']),
            ].filter(Boolean).join(', ');

        out.set(key, {
          job_id: key,
          dupe_key: dupeKey,
          title,
          company,
          domain,
          location,
          is_remote: Boolean(first(j, ['job_is_remote', 'is_remote', 'remote'])) ||
            /remote/i.test(String(first(j, ['job_location', 'location', 'workplaceType']) ?? '')),
          url: String(first(j, ['job_apply_link', 'apply_link', 'apply_url', 'jobUrl', 'applyUrl', 'job_url', 'url', 'link', 'job_google_link']) ?? ''),
          apply_is_direct: Boolean(first(j, ['job_apply_is_direct', 'apply_is_direct'])),
          posted_at: String(first(j, ['job_posted_at_datetime_utc', 'postedAt', 'publishedAt', 'time_posted', 'posted_at', 'date_posted', 'job_posted_at']) ?? ''),
          // This actor sometimes surfaces a contact address straight from the
          // posting. When it does, it is the only contact we keep.
          posting_email: String(first(j, ['contact_email', 'contactEmail']) ?? '').trim().toLowerCase(),
          seniority: String(first(j, ['seniority_level', 'seniorityLevel']) ?? ''),
          publisher: String(first(j, ['job_publisher', 'publisher', 'source']) ?? 'LinkedIn'),
          description,
        });
      }
    }

    // Distinguish the three ways this can come back empty, so a quiet zero is
    // never mistaken for "no jobs today".
    if (!out.size) {
      if (problems.length === $input.all().length) {
        throw new Error(
          'Every discovery response was unusable — API shape or subscription changed. ' +
          'First problem: ' + problems[0]
        );
      }
      if (sawRows > 0) {
        // Distinguish "field names changed" from "everything was spam".
        if (dropped.redacted + dropped.aggregator > 0) {
          console.log(
            'All ' + sawRows + ' results were filtered out: ' +
            JSON.stringify(dropped) + '. Job boards were dominated by reposts today.'
          );
          return [];
        }
        throw new Error(
          'Discovery returned ' + sawRows + ' rows but none had a usable title/company/' +
          'description (needs 200+ chars). Field names likely changed. ' +
          'Keys on the first row: ' + (sampleKeys ?? []).join(', ')
        );
      }
      // rows existed but were genuinely empty — nothing posted in the window.
      return [];
    }

    console.log(
      'Kept ' + out.size + ' of ' + sawRows + ' results. Dropped: ' + JSON.stringify(dropped)
    );

    return [...out.values()].map((json) => ({ json }));
    `,
    { notes: 'Deterministic. No LLM involved — cheap filtering before we spend quota.' },
  );

  // ------------------------------------------------------------ dedupe vs log
  const readQueue = node(
    'Read Existing Queue',
    'n8n-nodes-base.googleSheets',
    {
      documentId: { __rl: true, value: "={{ $('Config').first().json.sheetId }}", mode: 'id' },
      sheetName: { __rl: true, value: 'Queue', mode: 'name' },
      options: {},
    },
    { typeVersion: 4.5, credentials: CRED.sheets, alwaysOutputData: true, continueOnFail: true },
  );

  const readContacts = node(
    'Read Contact Cache',
    'n8n-nodes-base.googleSheets',
    {
      documentId: { __rl: true, value: "={{ $('Config').first().json.sheetId }}", mode: 'id' },
      sheetName: { __rl: true, value: 'Contacts', mode: 'name' },
      options: {},
    },
    {
      typeVersion: 4.5,
      credentials: CRED.sheets,
      alwaysOutputData: true,
      continueOnFail: true,
      notes: 'Domain -> recruiter cache: reuse a posting email across repeat postings.',
    },
  );

  const filterNew = codeNode(
    'Filter To New Jobs',
    `
    const cfg = $('Config').first().json;
    const jobs = $('Normalize & Dedupe').all().map((i) => i.json);
    const prior = $('Read Existing Queue').all().map((i) => i.json);

    const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Three independent ways a posting can already be known, so a re-listing
    // under a new id, or an id scheme change, still will not produce a repeat.
    const seenIds = new Set(prior.map((r) => r.job_id).filter(Boolean));
    const seenUrls = new Set(prior.map((r) => String(r.url || '').trim()).filter(Boolean));
    const seenPairs = new Set(prior.map((r) => slug(r.company) + '::' + slug(r.title)));

    // Don't re-approach the same company within 30 days, whatever the role.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentCompanies = new Set(
      $('Read Existing Queue')
        .all()
        .map((i) => i.json)
        .filter((r) => r.date_found && Date.parse(r.date_found) > cutoff)
        .map((r) => String(r.company || '').toLowerCase())
    );

    const fresh = jobs
      .filter((j) => !seenIds.has(j.job_id))
      .filter((j) => !(j.url && seenUrls.has(j.url.trim())))
      .filter((j) => !seenPairs.has(slug(j.company) + '::' + slug(j.title)))
      .filter((j) => !(j.dupe_key && seenPairs.has(j.dupe_key)))
      .filter((j) => !recentCompanies.has(j.company.toLowerCase()))
      .slice(0, cfg.maxJobsPerDay);

    console.log(
      'Discovered ' + jobs.length + ', already known ' + (jobs.length - fresh.length) +
      ', processing ' + fresh.length
    );

    if (!fresh.length) return [];
    return fresh.map((json) => ({ json }));
    `,
  );

  const loop = node(
    'Loop Over Jobs',
    'n8n-nodes-base.splitInBatches',
    { batchSize: 1, options: { reset: false } },
    { typeVersion: 3, notes: 'One job at a time: keeps us under Gemini free-tier RPM.' },
  );

  // -------------------------------------------------------------- scoring
  const matchPrompt = geminiNode(
    'Gemini: Score Match',
    `={{ JSON.stringify({
  contents: [{ parts: [{ text:
    "You are a blunt technical recruiter. Compare the CANDIDATE RESUME to the JOB DESCRIPTION and score the fit.\\n\\n" +
    "TODAY'S DATE IS " + $now.toFormat('d LLLL yyyy') + ". " +
    "Treat that as the present. Resume dates on or before it are in the past and are NOT errors — " +
    "never flag recent or current employment dates as impossible or future.\\n\\n" +
    "Rules:\\n" +
    "- Score 0-100 on genuine fit. Be harsh. Most jobs are NOT a good fit.\\n" +
    "- Never assume a skill the resume does not evidence.\\n" +
    "- red_flags: hard blockers only. Treat these as blockers given the candidate's situation below: " +
    "requires onsite/hybrid attendance in another country, requires existing work authorization the candidate lacks, " +
    "explicitly excludes the candidate's region, requires security clearance, or demands far more years than the resume shows.\\n" +
    "- ats_keywords: the exact hard terms an ATS would filter on, taken verbatim from the job description.\\n\\n" +
    "CANDIDATE LOCATION & CONSTRAINTS: " + $('Config').first().json.candidateLocation + "\\n\\n" +
    "CANDIDATE RESUME:\\n" + $('Hold Resume Text').first().json.resumeText.slice(0, 12000) +
    "\\n\\nJOB TITLE: " + $json.title +
    "\\nCOMPANY: " + $json.company +
    "\\nJOB DESCRIPTION:\\n" + $json.description.slice(0, 12000)
  }] }],
  generationConfig: {
    temperature: 0.1,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        match_score: { type: "INTEGER" },
        verdict: { type: "STRING" },
        matched_skills: { type: "ARRAY", items: { type: "STRING" } },
        missing_skills: { type: "ARRAY", items: { type: "STRING" } },
        ats_keywords: { type: "ARRAY", items: { type: "STRING" } },
        red_flags: { type: "ARRAY", items: { type: "STRING" } },
        reasoning: { type: "STRING" }
      },
      required: ["match_score", "verdict", "matched_skills", "missing_skills", "ats_keywords", "red_flags"]
    }
  }
}) }}`,
  );

  const parseMatch = codeNode(
    'Parse Match Result',
    `
    // Gemini is asked for strict JSON, but never trust that blindly — a quota
    // error or a safety block returns a completely different shape.
    const job = $('Loop Over Jobs').first().json;
    const res = $input.first().json;

    function safeParse(raw) {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) {}
      const m = raw.match(/\\{[\\s\\S]*\\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
      return null;
    }

    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = safeParse(text);

    if (!parsed) {
      return [{ json: {
        ...job,
        match_score: 0,
        verdict: 'error',
        matched_skills: [],
        missing_skills: [],
        ats_keywords: [],
        red_flags: [],
        error: 'Gemini returned no parsable JSON: ' + JSON.stringify(res?.error ?? res).slice(0, 300),
      } }];
    }

    return [{ json: {
      ...job,
      match_score: Number(parsed.match_score) || 0,
      verdict: parsed.verdict ?? '',
      matched_skills: parsed.matched_skills ?? [],
      missing_skills: parsed.missing_skills ?? [],
      ats_keywords: parsed.ats_keywords ?? [],
      red_flags: parsed.red_flags ?? [],
      reasoning: parsed.reasoning ?? '',
    } }];
    `,
  );

  const scoreGate = node(
    'Score Gate',
    'n8n-nodes-base.if',
    {
      conditions: {
        options: { caseSensitive: true, version: 2, typeValidation: 'loose' },
        combinator: 'and',
        conditions: [
          {
            id: 'score',
            operator: { type: 'number', operation: 'gte' },
            leftValue: '={{ $json.match_score }}',
            rightValue: "={{ $('Config').first().json.minMatchScore }}",
          },
          {
            id: 'noflags',
            operator: { type: 'number', operation: 'equals' },
            leftValue: '={{ $json.red_flags.length }}',
            rightValue: 0,
          },
        ],
      },
      options: {},
    },
    { typeVersion: 2.2 },
  );

  // ------------------------------------------------------------ ATS scoring
  const atsScore = codeNode(
    'ATS Keyword Score',
    `
    // Deterministic ATS check against the MASTER resume (we are not rewriting it).
    // This tells you which keywords your resume is missing so you can decide
    // whether to hand-edit before applying.
    const job = $input.first().json;
    const resume = $('Hold Resume Text').first().json.resumeText.toLowerCase();

    const keywords = (job.ats_keywords || [])
      .map((k) => String(k).trim())
      .filter((k) => k.length > 1);

    const present = [];
    const missing = [];

    for (const kw of keywords) {
      const needle = kw.toLowerCase();
      // Word-ish boundary match so "go" doesn't match "google".
      const re = new RegExp('(^|[^a-z0-9+#.])' + needle.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '([^a-z0-9+#.]|$)', 'i');
      (re.test(resume) ? present : missing).push(kw);
    }

    const ats_score = keywords.length
      ? Math.round((present.length / keywords.length) * 100)
      : 0;

    return [{ json: {
      ...job,
      ats_score,
      ats_present: present,
      ats_missing: missing,
      ats_note: ats_score < 60
        ? 'Low keyword coverage — consider hand-editing the resume before sending.'
        : 'Coverage acceptable.',
    } }];
    `,
  );

  // ---------------------------------------------------------- cover letter
  const coverLetter = geminiNode(
    'Gemini: Write Cover Letter',
    `={{ JSON.stringify({
  contents: [{ parts: [{ text:
    "Write a cover letter for this candidate applying to this role.\\n\\n" +
    "Hard rules:\\n" +
    "- 180-240 words. Plain prose, no bullet points, no markdown.\\n" +
    "- Use ONLY achievements that appear in the resume. Invent nothing: no metrics, employers, dates or skills that are not there.\\n" +
    "- Open with a specific reason for this company/role, not a generic greeting.\\n" +
    "- Name 2-3 of the matched skills naturally.\\n" +
    "- Never mention the missing skills.\\n" +
    "- End with a short call to action. Sign off as " + $('Config').first().json.yourName + ".\\n" +
    "- Also produce a concise email subject line (max 70 chars) referencing the role and company.\\n\\n" +
    "MATCHED SKILLS: " + ($json.matched_skills || []).join(', ') +
    "\\n\\nCANDIDATE RESUME:\\n" + $('Hold Resume Text').first().json.resumeText.slice(0, 10000) +
    "\\n\\nJOB TITLE: " + $json.title +
    "\\nCOMPANY: " + $json.company +
    "\\nJOB DESCRIPTION:\\n" + $json.description.slice(0, 8000)
  }] }],
  generationConfig: {
    temperature: 0.6,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        subject: { type: "STRING" },
        cover_letter: { type: "STRING" }
      },
      required: ["subject", "cover_letter"]
    }
  }
}) }}`,
    { modelKey: 'geminiProModel' },
  );

  const parseLetter = codeNode(
    'Parse Cover Letter',
    `
    const job = $('ATS Keyword Score').first().json;
    const res = $input.first().json;

    function safeParse(raw) {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) {}
      const m = raw.match(/\\{[\\s\\S]*\\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
      return null;
    }

    const parsed = safeParse(res?.candidates?.[0]?.content?.parts?.[0]?.text) ?? {};

    return [{ json: {
      ...job,
      subject: parsed.subject || \`Application: \${job.title} at \${job.company}\`,
      cover_letter: parsed.cover_letter || '',
      cover_letter_ok: Boolean(parsed.cover_letter),
    } }];
    `,
  );

  // ---------------------------------------------------------- contact email
  const decideContact = codeNode(
    'Decide Contact',
    `
    const job = $input.first().json;

    // A contact address published in the posting itself is gold: it is free
    // and comes straight from the employer.
    if (job.posting_email && /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(job.posting_email)) {
      return [{ json: {
        ...job,
        recruiter_name: '',
        recruiter_email: job.posting_email,
        recruiter_title: 'From job posting',
        contact_source: 'posting',
        // Cache it against the domain (when one exists) so repeat postings
        // by the same company never have to be re-found.
        cacheable: Boolean(job.domain),
      } }];
    }

    // Reuse a domain's cached contact. Read by domain when we have one,
    // otherwise by company name.
    const cacheKey = String(job.domain || job.company || '').toLowerCase();
    const cache = $('Read Contact Cache').all().map((i) => i.json);
    const hit = cacheKey
      ? cache.find((c) =>
          [c.domain, c.company].some((v) => String(v || '').toLowerCase() === cacheKey) &&
          c.recruiter_email)
      : null;

    if (hit) {
      return [{ json: {
        ...job,
        recruiter_name: hit.recruiter_name || '',
        recruiter_email: hit.recruiter_email,
        recruiter_title: hit.recruiter_title || '',
        contact_source: 'cache',
        cacheable: false,
      } }];
    }

    return [{ json: {
      ...job,
      recruiter_name: '',
      recruiter_email: '',
      recruiter_title: '',
      contact_source: 'none',
      cacheable: false,
    } }];
    `,
  );

  const cacheGate = node(
    'Cache Contact?',
    'n8n-nodes-base.if',
    {
      conditions: {
        options: { caseSensitive: true, version: 2, typeValidation: 'loose' },
        combinator: 'and',
        conditions: [
          {
            id: 'cacheable',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            leftValue: '={{ $json.cacheable }}',
          },
        ],
      },
      options: {},
    },
    { typeVersion: 2.2 },
  );

  const mergeContact = node(
    'Merge Contact Paths',
    'n8n-nodes-base.merge',
    { numberInputs: 2 },
    { typeVersion: 3 },
  );

  // ------------------------------------------------------------- write row
  const buildRow = codeNode(
    'Build Queue Row',
    `
    const j = $input.first().json;

    // status drives the review column in the sheet:
    //   needs_review  -> we have a recruiter email, waiting on your review
    //   manual_apply  -> no email found, apply through the posting URL yourself
    const status = j.recruiter_email ? 'needs_review' : 'manual_apply';

    // A row is only written when every field the review workflow depends on is
    // actually present. Half-filled rows are worse than
    // no row: they look actionable and fail at apply time.
    const issues = [];
    if (!j.title) issues.push('no title');
    if (!j.company) issues.push('no company');
    if (!j.url) issues.push('no apply URL');
    if (!(j.description || '').trim()) issues.push('no description');
    if (!Number.isFinite(Number(j.match_score))) issues.push('no match score');
    if (!Number.isFinite(Number(j.ats_score))) issues.push('no ATS score');
    if (!(j.subject || '').trim()) issues.push('no email subject');
    if ((j.cover_letter || '').trim().length < 120) issues.push('cover letter missing or too short');
    if (j.recruiter_email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(j.recruiter_email)) {
      issues.push('malformed recruiter email');
    }

    return [{ json: {
      row_valid: issues.length === 0,
      row_issues: issues.join('; '),
      job_id: j.job_id,
      date_found: new Date().toISOString(),
      title: j.title,
      company: j.company,
      domain: j.domain || '',
      location: j.location || '',
      is_remote: j.is_remote ? 'TRUE' : 'FALSE',
      url: j.url || '',
      match_score: j.match_score,
      ats_score: j.ats_score,
      verdict: j.verdict || '',
      matched_skills: (j.matched_skills || []).join(', '),
      ats_missing: (j.ats_missing || []).join(', '),
      ats_note: j.ats_note || '',
      reasoning: (j.reasoning || '').slice(0, 900),
      recruiter_name: j.recruiter_name || '',
      recruiter_email: j.recruiter_email || '',
      recruiter_title: j.recruiter_title || '',
      contact_source: j.contact_source || '',
      subject: j.subject || '',
      cover_letter: j.cover_letter || '',
      status,
      sent_at: '',
      notes: '',
    } }];
    `,
  );

  const rowComplete = node(
    'Row Complete?',
    'n8n-nodes-base.if',
    {
      conditions: {
        options: { caseSensitive: true, version: 2, typeValidation: 'loose' },
        combinator: 'and',
        conditions: [
          {
            id: 'valid',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            leftValue: '={{ $json.row_valid }}',
          },
        ],
      },
      options: {},
    },
    {
      typeVersion: 2.2,
      notes: 'Incomplete rows go to the Skipped tab with a reason instead of ' +
        'being written to Queue as half-filled entries.',
    },
  );

  const appendQueue = node(
    'Append To Queue',
    'n8n-nodes-base.googleSheets',
    {
      operation: 'append',
      documentId: { __rl: true, value: "={{ $('Config').first().json.sheetId }}", mode: 'id' },
      sheetName: { __rl: true, value: 'Queue', mode: 'name' },
      columns: { mappingMode: 'autoMapInputData', matchingColumns: ['job_id'], value: {} },
      options: {},
    },
    { typeVersion: 4.5, credentials: CRED.sheets, retry: { maxTries: 2 } },
  );

  const cacheContact = node(
    'Cache Contact',
    'n8n-nodes-base.googleSheets',
    {
      operation: 'appendOrUpdate',
      documentId: { __rl: true, value: "={{ $('Config').first().json.sheetId }}", mode: 'id' },
      sheetName: { __rl: true, value: 'Contacts', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['domain'],
        value: {
          domain: '={{ $json.domain }}',
          company: '={{ $json.company }}',
          recruiter_name: '={{ $json.recruiter_name }}',
          recruiter_email: '={{ $json.recruiter_email }}',
          recruiter_title: '={{ $json.recruiter_title }}',
          found_at: '={{ $now.toISO() }}',
        },
      },
      options: {},
    },
    {
      typeVersion: 4.5,
      credentials: CRED.sheets,
      continueOnFail: true,
      notes: 'Stashes a posting-provided contact on the domain for reuse later.',
    },
  );

  const throttle = node(
    'Throttle',
    'n8n-nodes-base.wait',
    { amount: 8, unit: 'seconds' },
    { typeVersion: 1.1, notes: 'Keeps Gemini free-tier requests-per-minute happy.' },
  );

  // --------------------------------------------------------- rejected path
  const logSkipped = node(
    'Log Skipped Job',
    'n8n-nodes-base.googleSheets',
    {
      operation: 'append',
      documentId: { __rl: true, value: "={{ $('Config').first().json.sheetId }}", mode: 'id' },
      sheetName: { __rl: true, value: 'Skipped', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          date_found: '={{ $now.toISO() }}',
          job_id: '={{ $json.job_id }}',
          title: '={{ $json.title }}',
          company: '={{ $json.company }}',
          url: '={{ $json.url }}',
          match_score: '={{ $json.match_score }}',
          reason: '={{ $json.row_issues ? "incomplete row: " + $json.row_issues : (($json.red_flags || []).length ? "red flags: " + $json.red_flags.join("; ") : "below match threshold") }}',
        },
      },
      options: {},
    },
    { typeVersion: 4.5, credentials: CRED.sheets, continueOnFail: true },
  );

  // -------------------------------------------------------------- summary
  const summarize = codeNode(
    'Build Daily Summary',
    `
    const cfg = $('Config').first().json;
    const scanned = $('Normalize & Dedupe').all().length;
    const considered = $('Filter To New Jobs').all().length;

    let queued = [];
    try { queued = $('Build Queue Row').all().map((i) => i.json); } catch (e) {}

    const ready = queued.filter((q) => q.status === 'needs_review');
    const manual = queued.filter((q) => q.status === 'manual_apply');

    const row = (q) =>
      \`<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">\${q.title}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">\${q.company}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">\${q.match_score}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">\${q.ats_score}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">\${q.recruiter_email || '—'}</td>
      </tr>\`;

    const html = \`
      <div style="font-family:system-ui,sans-serif;max-width:720px">
        <h2 style="margin-bottom:4px">Job scan — \${new Date().toDateString()}</h2>
        <p style="color:#555">
          Scanned <b>\${scanned}</b> postings ·
          <b>\${considered}</b> new ·
          <b>\${ready.length}</b> ready to review ·
          <b>\${manual.length}</b> need manual apply
        </p>
        \${queued.length ? \`<table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr style="text-align:left;background:#f6f6f6">
            <th style="padding:8px 10px">Role</th><th style="padding:8px 10px">Company</th>
            <th style="padding:8px 10px">Match</th><th style="padding:8px 10px">ATS</th>
            <th style="padding:8px 10px">Recruiter</th>
          </tr>
          \${queued.map(row).join('')}
        </table>\` : '<p>No new matches today.</p>'}
        <p style="margin-top:20px">
          <a href="https://docs.google.com/spreadsheets/d/{{ $('Config').first().json.sheetId }}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
            Open review sheet
          </a>
        </p>
        <p style="color:#888;font-size:12px">Jobs are queued in Google Sheets. Review and apply from there.</p>
      </div>\`;

    return [{ json: { html, to: cfg.summaryTo, scanned, considered, ready: ready.length, manual: manual.length } }];
    `,
  );

  const sendSummary = node(
    'Email Daily Summary',
    'n8n-nodes-base.gmail',
    {
      sendTo: '={{ $json.to }}',
      subject:
        '=Job scan: {{ $json.ready }} ready to review, {{ $json.manual }} manual',
      message: '={{ $json.html }}',
      options: { appendAttribution: false },
    },
    { typeVersion: 2.1, credentials: CRED.gmail, continueOnFail: true },
  );

  const nodes = [
    trigger, manualTrigger, config, getResume, extractResume, holdResume,
    buildQueries, discovery, normalize, readQueue, readContacts,
    filterNew, loop, matchPrompt, parseMatch, scoreGate,
    atsScore, coverLetter, parseLetter, decideContact, cacheGate,
    mergeContact, buildRow, rowComplete,
    appendQueue, cacheContact, throttle, logSkipped, summarize,
    sendSummary,
  ];

  const edges = [
    ['Daily Trigger', 'Config'],
    ['Run Now (manual)', 'Config'],
    ['Config', 'Download Master Resume'],
    ['Download Master Resume', 'Extract Resume Text'],
    ['Extract Resume Text', 'Hold Resume Text'],
    ['Hold Resume Text', 'Build Search Queries'],
    ['Build Search Queries', 'Apify: LinkedIn Jobs'],
    ['Apify: LinkedIn Jobs', 'Normalize & Dedupe'],
    ['Normalize & Dedupe', 'Read Existing Queue'],
    ['Read Existing Queue', 'Read Contact Cache'],
    ['Read Contact Cache', 'Filter To New Jobs'],
    ['Filter To New Jobs', 'Loop Over Jobs'],

    // batch output (index 1) = per-item branch; done output (index 0) = summary
    ['Loop Over Jobs', 'Build Daily Summary', { output: 0 }],
    ['Loop Over Jobs', 'Gemini: Score Match', { output: 1 }],

    ['Gemini: Score Match', 'Parse Match Result'],
    ['Parse Match Result', 'Score Gate'],
    ['Score Gate', 'ATS Keyword Score', { output: 0 }],
    ['Score Gate', 'Log Skipped Job', { output: 1 }],
    ['Log Skipped Job', 'Loop Over Jobs'],

    ['ATS Keyword Score', 'Gemini: Write Cover Letter'],
    ['Gemini: Write Cover Letter', 'Parse Cover Letter'],
    ['Parse Cover Letter', 'Decide Contact'],
    ['Decide Contact', 'Cache Contact?'],
    ['Cache Contact?', 'Cache Contact', { output: 0 }],
    ['Cache Contact?', 'Merge Contact Paths', { output: 1, input: 1 }],
    ['Cache Contact', 'Merge Contact Paths', { input: 0 }],
    ['Merge Contact Paths', 'Build Queue Row'],
    ['Build Queue Row', 'Row Complete?'],
    ['Row Complete?', 'Append To Queue', { output: 0 }],
    ['Row Complete?', 'Log Skipped Job', { output: 1 }],
    ['Append To Queue', 'Throttle'],
    ['Throttle', 'Loop Over Jobs'],

    ['Build Daily Summary', 'Email Daily Summary'],
  ];

  return workflow('01 — Daily Job Scan', nodes, edges, { layout: { cols: 5 } });
}
