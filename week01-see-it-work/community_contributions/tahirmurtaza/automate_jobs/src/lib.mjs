// Shared helpers for building n8n workflow JSON.

let idCounter = 0;
export function resetIds() {
  idCounter = 0;
}

/** Create a node. `code` is sugar for Code nodes: pass a JS function or string. */
export function node(name, type, params = {}, opts = {}) {
  idCounter += 1;
  const n = {
    parameters: params,
    id: `${String(idCounter).padStart(4, '0')}-${slug(name)}`.slice(0, 36),
    name,
    type,
    typeVersion: opts.typeVersion ?? 1,
    position: opts.position ?? [0, 0],
  };
  if (opts.credentials) n.credentials = opts.credentials;
  if (opts.continueOnFail) n.onError = 'continueRegularOutput';
  if (opts.retry) {
    n.retryOnFail = true;
    n.maxTries = opts.retry.maxTries ?? 3;
    n.waitBetweenTries = opts.retry.wait ?? 5000;
  }
  if (opts.alwaysOutputData) n.alwaysOutputData = true;
  if (opts.notes) n.notes = opts.notes;
  return n;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Code node. Pass the body as a template string. */
export function codeNode(name, jsCode, opts = {}) {
  return node(
    name,
    'n8n-nodes-base.code',
    { mode: opts.mode ?? 'runOnceForAllItems', jsCode: dedent(jsCode) },
    { typeVersion: 2, ...opts },
  );
}

/** Set node with raw JSON output. */
export function setNode(name, jsonOutput, opts = {}) {
  return node(
    name,
    'n8n-nodes-base.set',
    { mode: 'raw', jsonOutput, options: {} },
    { typeVersion: 3.4, ...opts },
  );
}

/**
 * Gemini generateContent call over plain HTTP.
 * Avoids the LangChain sub-nodes entirely: stable across n8n versions and
 * gives us strict-JSON responses via responseMimeType.
 */
export function geminiNode(name, promptExpr, opts = {}) {
  return node(
    name,
    'n8n-nodes-base.httpRequest',
    {
      method: 'POST',
      url: `=https://generativelanguage.googleapis.com/v1beta/models/{{ $('Config').first().json.${opts.modelKey ?? 'geminiFastModel'} }}:generateContent`,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'x-goog-api-key', value: '={{ $env.GEMINI_API_KEY }}' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: promptExpr,
      options: { timeout: 120000 },
    },
    {
      typeVersion: 4.2,
      retry: { maxTries: 3, wait: 20000 },
      continueOnFail: true,
      alwaysOutputData: true,
      ...opts,
    },
  );
}

/** Build the connections map from a list of [from, to] or [from, to, {outputIndex}] */
export function connect(edges) {
  const conns = {};
  for (const [from, to, opt = {}] of edges) {
    const outIdx = opt.output ?? 0;
    const inIdx = opt.input ?? 0;
    conns[from] ??= { main: [] };
    while (conns[from].main.length <= outIdx) conns[from].main.push([]);
    conns[from].main[outIdx].push({ node: to, type: 'main', index: inIdx });
  }
  return conns;
}

/** Lay nodes out on a grid so the imported canvas is readable. */
export function layout(nodes, { cols = 5, dx = 300, dy = 200, x0 = 0, y0 = 0 } = {}) {
  nodes.forEach((n, i) => {
    if (n.position && (n.position[0] || n.position[1])) return;
    n.position = [x0 + (i % cols) * dx, y0 + Math.floor(i / cols) * dy];
  });
  return nodes;
}

/**
 * Stable 16-char id derived from the workflow name. `n8n import:workflow`
 * requires a top-level id (the UI generates one, the CLI does not), and making
 * it deterministic means re-importing updates the same workflow instead of
 * creating duplicates.
 */
function stableId(name) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    out += alphabet[h % alphabet.length];
  }
  return out;
}

export function workflow(name, nodes, edges, opts = {}) {
  return {
    id: stableId(name),
    name,
    active: false,
    nodes: layout(nodes, opts.layout),
    connections: connect(edges),
    settings: { executionOrder: 'v1', ...(opts.settings ?? {}) },
    pinData: {},
    versionId: stableId(name + ':version'),
    meta: { instanceId: 'automate-jobs' },
    tags: [],
  };
}

export function dedent(str) {
  const lines = str.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length),
  );
  return lines.map((l) => l.slice(indent)).join('\n');
}

/**
 * Real credential IDs from this n8n instance. Baking them in means re-importing
 * a workflow keeps its credentials attached instead of wiping them — without
 * this, every import silently detaches every Google node.
 *
 * Re-read them after any credential rebuild with:
 *   docker exec n8n-jobs node -e '...SELECT id,name,type FROM credentials_entity...'
 */
export const CRED = {
  sheets: {
    googleSheetsOAuth2Api: { id: '7FbQUaSOembNsfPo', name: 'Google Sheets account' },
  },
  gmail: {
    gmailOAuth2: { id: 'jsvTdnycSWSvSa6J', name: 'Gmail account' },
  },
  drive: {
    googleDriveOAuth2Api: { id: 'j4xLHJ4M4u2PgEYl', name: 'Google Drive account' },
  },
};
