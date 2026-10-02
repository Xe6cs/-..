// Writes assets/js/supabase-config.js from environment variables during the Netlify
// build, so no Supabase values are stored in the repository.
//
// Only PUBLIC values belong here: the project URL and the publishable key (called
// the "anon" key in older projects). Supabase protects the data with Row Level
// Security, not by hiding these. The build refuses to publish a secret key.
//
// Netlify: Site configuration → Environment variables (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
// Local:   copy .env.example to .env, fill it in, run `node scripts/write-supabase-config.mjs`

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const out = new URL('assets/js/supabase-config.js', root);

// Local runs read .env; on Netlify the real environment variables win.
const envFile = new URL('.env', root);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

function stop(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (key.startsWith('sb_secret_')) {
  stop('SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Never publish it: replace it with the '
    + 'publishable key, and rotate the secret key in Supabase if it was shared.');
}
if (key.split('.').length === 3) {
  let role;
  try {
    role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    stop('SUPABASE_PUBLISHABLE_KEY is not a valid Supabase key.');
  }
  if (role !== 'anon') {
    stop(`SUPABASE_PUBLISHABLE_KEY has the "${role}" role. Only the anon / publishable key may be `
      + 'published; rotate this key in Supabase if it was shared.');
  }
}
if (url && !/^https:\/\/[^\s/]+$/.test(url)) {
  stop('SUPABASE_URL should look like https://your-project.supabase.co');
}

const config = { url: url || null, publishableKey: key || null };
writeFileSync(out, '// Generated during deploy by scripts/write-supabase-config.mjs. Do not edit or commit.\n'
  + `window.BAINBAG_SUPABASE = ${JSON.stringify(config)};\n`);

if (url && key) {
  console.log(`✔ Supabase config written for ${url}`);
} else {
  console.warn('⚠ SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set yet; wrote an empty config. '
    + 'The site still works; it just is not connected to Supabase.');
}
console.log(`  → ${fileURLToPath(out)}`);
