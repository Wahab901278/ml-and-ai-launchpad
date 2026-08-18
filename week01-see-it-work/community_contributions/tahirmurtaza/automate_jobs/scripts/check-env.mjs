#!/usr/bin/env node
// Validates .env and (optionally) pings each API. Never prints key values.
//
//   node scripts/check-env.mjs           # format checks + free live checks

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let raw;
try {
  raw = readFileSync(join(root, '.env'), 'utf8');
} catch {
  console.error('No .env found. Run: cp .env.example .env');
  process.exit(1);
}

const inlineComments = [];

const env = Object.fromEntries(
  raw
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      const key = l.slice(0, i).trim();
      let val = l.slice(i + 1).trim();

      // `export $(... | xargs)` does NOT strip trailing comments, so a value
      // like `KEY=abc123   # get this from foo.com` silently exports the
      // comment too. Flag it rather than quietly cleaning it up.
      if (/\s#/.test(val)) {
        inlineComments.push(key);
        val = val.replace(/\s+#.*$/, '').trim();
      }

      return [key, val.replace(/^["']|["']$/g, '')];
    })
    .filter(([k]) => k),
);

if (inlineComments.length) {
  console.log('\nInline comments detected — FIX THESE IN .env');
  console.log('─'.repeat(64));
  console.log('  These lines have a # comment after the value. n8n will receive');
  console.log('  the comment as part of the key. Move comments to their own line:');
  for (const k of inlineComments) console.log(`    - ${k}`);
  console.log('  (checks below run against the cleaned values)');
}

const mask = (v) => (!v ? '(empty)' : `${v.length} chars, ends …${v.slice(-4)}`);
const PLACEHOLDER = /change-me|PUT_YOUR|^$/i;

let fatal = 0;
let warn = 0;

function check(key, { required = true, pattern, hint } = {}) {
  const v = env[key];
  if (!v || PLACEHOLDER.test(v)) {
    if (required) {
      console.log(`  FAIL  ${key.padEnd(30)} missing or still a placeholder`);
      fatal++;
    } else {
      console.log(`  warn  ${key.padEnd(30)} not set${hint ? ` — ${hint}` : ''}`);
      warn++;
    }
    return null;
  }
  if (pattern && !pattern.test(v)) {
    console.log(`  warn  ${key.padEnd(30)} set (${mask(v)}) but looks wrong — ${hint}`);
    warn++;
    return v;
  }
  console.log(`  ok    ${key.padEnd(30)} ${mask(v)}`);
  return v;
}

console.log('\nFormat checks');
console.log('─'.repeat(64));
const gemini = check('GEMINI_API_KEY', { pattern: /^AIza[\w-]{30,}$/, hint: 'AI Studio keys start with AIza' });
const apify = check('APIFY_TOKEN', { pattern: /^apify_api_[\w]{20,}$/, hint: 'Apify tokens start with apify_api_' });
check('JOBS_SHEET_ID', { pattern: /^[\w-]{40,}$/, hint: 'Sheet IDs are ~44 chars — paste only the id, not the whole URL' });
check('RESUME_FILE_ID', { pattern: /^[\w-]{25,}$/, hint: 'Drive file IDs are ~33 chars — the part between /d/ and /view' });

const blockEnv = env.N8N_BLOCK_ENV_ACCESS_IN_NODE;
if (blockEnv !== 'false') {
  console.log('  FAIL  N8N_BLOCK_ENV_ACCESS_IN_NODE  must be exactly "false" or Code nodes cannot read $env');
  fatal++;
} else {
  console.log('  ok    N8N_BLOCK_ENV_ACCESS_IN_NODE  false');
}

// ------------------------------------------------------------- live checks
console.log('\nLive API checks');
console.log('─'.repeat(64));

async function live(label, fn) {
  try {
    const msg = await fn();
    console.log(`  ok    ${label.padEnd(30)} ${msg}`);
  } catch (e) {
    console.log(`  FAIL  ${label.padEnd(30)} ${e.message}`);
    fatal++;
  }
}

if (gemini) {
  await live('Gemini', async () => {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': gemini },
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);

    const usable = (d.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      // Exclude previews and specialist variants: this runs unattended daily,
      // so a model that can be withdrawn without notice is a poor default.
      .filter(
        (n) =>
          /^gemini/.test(n) &&
          !/preview|embedding|aqa|image|tts|audio|native|live|robotics|computer-use/i.test(n),
      );

    globalThis.__models = usable;
    return `key valid · ${usable.length} generateContent models available`;
  });
}

if (apify) {
  await live('Apify', async () => {
    const r = await fetch('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${apify}` },
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);
    const plan = d.data?.plan?.id ?? 'unknown';
    const usage = d.data?.plan?.monthlyUsageCreditsUsd;
    const max = d.data?.plan?.maxMonthlyUsageUsd;
    return `token valid \u00b7 user ${d.data?.username} \u00b7 plan ${plan}` +
      (max != null ? ` \u00b7 credit $${(usage ?? 0).toFixed(2)}/$${max}` : '');
  });
}

// ------------------------------------------------------- model suggestions
const models = globalThis.__models;
if (models?.length) {
  // Highest version number wins; "-latest" aliases are a safe fallback.
  const ver = (m) => Number((m.match(/gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
  const pick = (re) =>
    models.filter((m) => re.test(m)).sort((a, b) => ver(b) - ver(a))[0];

  const flash = pick(/flash(?!-lite)/) ?? pick(/flash/) ?? models[0];
  const pro = pick(/-pro(?!-)/) ?? models.find((m) => m === 'gemini-pro-latest') ?? flash;
  console.log('\nSuggested Config node values (verify these exist above)');
  console.log('─'.repeat(64));
  console.log(`  geminiFastModel: "${flash}"`);
  console.log(`  geminiProModel:  "${pro}"`);
}

console.log('\n' + '─'.repeat(64));
console.log(fatal ? `${fatal} blocking problem(s), ${warn} warning(s)` : `All good${warn ? ` (${warn} warning(s))` : ''}`);
process.exit(fatal ? 1 : 0);
