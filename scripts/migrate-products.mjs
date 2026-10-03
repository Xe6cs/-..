// Copies the site's current product photos into Supabase Storage (bucket "site-images")
// and adds one row per photo to public.products, in the same order as on the site.
//
// Runs ONLY on your computer. It needs a TEMPORARY Supabase secret key, read from
// .env.local (ignored by git, never uploaded). Setup: supabase/MIGRATION.md
//
//   node scripts/migrate-products.mjs --dry-run   show the plan; no keys needed, changes nothing
//   node scripts/migrate-products.mjs --trial     the first 3 photos of "5 سنتميتر"
//   node scripts/migrate-products.mjs --verify    re-check what is in Supabase; changes nothing
//   node scripts/migrate-products.mjs --all       every product photo (the next step)
//
// Never overwrites or deletes anything. Photos already copied are skipped, so it is
// safe to run again. The original files in assets/img/products are left untouched.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const ROOT = new URL('../', import.meta.url);
const BUCKET = 'site-images';
const TRIAL = { slug: 'ties-5cm', count: 3 };

// Page on the current site → section slug in public.categories (order = home page order).
const PAGES = [
  ['ties-7cm.html', 'ties-7cm'],
  ['ties-9cm.html', 'ties-9cm'],
  ['ties-5cm.html', 'ties-5cm'],
  ['pajamas.html', 'pajamas'],
  ['bow-ties.html', 'bow-ties'],
  ['suspenders.html', 'suspenders'],
];

const mode = ['--dry-run', '--trial', '--verify', '--all'].find(m => process.argv.includes(m));
if (!mode) stop('Choose one: --dry-run, --trial, --verify or --all');

function stop(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. The products as they appear on the site today (read from the HTML pages)
// ---------------------------------------------------------------------------
function productsOnSite() {
  const list = [];
  for (const [page, slug] of PAGES) {
    const html = readFileSync(new URL(page, ROOT), 'utf8');
    const tiles = html.match(/<figure class="tile[^"]*">\s*<img\b[^>]*>/g) || [];
    tiles.forEach((tile, i) => {
      const src = tile.match(/\bsrc="([^"]+)"/)[1];
      const alt = (tile.match(/\balt="([^"]*)"/) || [])[1] || null;
      const file = src.split('/').pop();
      list.push({ slug, sortOrder: i + 1, localPath: src, alt, storagePath: `products/${slug}/${file}` });
    });
  }
  return list;
}

const all = productsOnSite();
const chosen = mode === '--all' ? all
  : mode === '--verify' ? all
  : all.filter(p => p.slug === TRIAL.slug).slice(0, TRIAL.count);

if (mode === '--dry-run') {
  const trial = all.filter(p => p.slug === TRIAL.slug).slice(0, TRIAL.count);
  console.log(`Products on the site today: ${all.length}`);
  for (const [, slug] of PAGES) console.log(`  ${slug.padEnd(11)} ${all.filter(p => p.slug === slug).length}`);
  console.log('\nThe trial (--trial) would copy these 3, in this order:');
  for (const p of trial) {
    const kb = Math.round(statSync(new URL(p.localPath, ROOT)).size / 1024);
    console.log(`  #${p.sortOrder}  ${p.localPath}  (${kb} KB)  →  ${BUCKET}/${p.storagePath}`);
  }
  console.log('\nNothing was changed.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Settings from .env.local, with safety checks. Key values are never printed.
// ---------------------------------------------------------------------------
const envFile = new URL('.env.local', ROOT);
if (!existsSync(envFile)) stop('.env.local was not found. Follow supabase/MIGRATION.md first.');
try {
  execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: ROOT, stdio: 'ignore' });
} catch {
  stop('.env.local is NOT ignored by git, so it could be uploaded. Stopping without using it.');
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
const secretKey = env.SUPABASE_SECRET_KEY || '';

if (!/^https:\/\/[^\s/]+$/.test(url)) stop('SUPABASE_URL in .env.local should look like https://xxxx.supabase.co');
if (!publishableKey) stop('SUPABASE_PUBLISHABLE_KEY is empty in .env.local.');
if (publishableKey.startsWith('sb_secret_')) stop('SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Swap the two values.');

function jwtRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role; } catch { return null; }
}
const secretLooksRight = secretKey.startsWith('sb_secret_')
  || (secretKey.split('.').length === 3 && jwtRole(secretKey) === 'service_role');
if (mode !== '--verify' && !secretLooksRight) {
  stop('SUPABASE_SECRET_KEY is missing or is not a secret key (it should start with sb_secret_).');
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = secretLooksRight ? createClient(url, secretKey, options) : null;   // bypasses the locks: used only to copy
const visitor = createClient(url, publishableKey, options);                         // exactly what a site visitor has

// ---------------------------------------------------------------------------
// 3. Copy photos and add product rows (never overwrites, never deletes)
// ---------------------------------------------------------------------------
async function sectionIds(client) {
  const { data, error } = await client.from('categories').select('id, slug');
  if (error) stop(`Could not read the sections: ${error.message}`);
  return Object.fromEntries(data.map(c => [c.slug, c.id]));
}

if (mode === '--trial' || mode === '--all') {
  const ids = await sectionIds(admin);
  const missing = [...new Set(chosen.map(p => p.slug))].filter(s => !ids[s]);
  if (missing.length) stop(`These sections are missing in Supabase: ${missing.join(', ')}. Run supabase/2-seed.sql first.`);

  console.log(`Copying ${chosen.length} product photo(s) to ${url} …\n`);
  let uploaded = 0, added = 0, skipped = 0;
  for (const p of chosen) {
    const bytes = readFileSync(new URL(p.localPath, ROOT));
    const up = await admin.storage.from(BUCKET).upload(p.storagePath, bytes, { contentType: 'image/webp', upsert: false });
    let photo = 'uploaded';
    if (up.error) {
      if (/exist|duplicate/i.test(up.error.message)) { photo = 'already there'; skipped++; }
      else stop(`Upload failed for ${p.storagePath}: ${up.error.message}`);
    } else uploaded++;

    const found = await admin.from('products').select('id').eq('image_path', p.storagePath).maybeSingle();
    if (found.error) stop(`Could not check products: ${found.error.message}`);
    let row = 'already there';
    if (!found.data) {
      const ins = await admin.from('products').insert({
        category_id: ids[p.slug], image_path: p.storagePath, alt_text: p.alt, sort_order: p.sortOrder, is_visible: true,
      });
      if (ins.error) stop(`Could not add the product row for ${p.storagePath}: ${ins.error.message}`);
      row = 'added'; added++;
    }
    console.log(`  #${String(p.sortOrder).padEnd(3)} ${p.storagePath.padEnd(36)} photo: ${photo.padEnd(14)} row: ${row}`);
  }
  console.log(`\nPhotos uploaded: ${uploaded}, product rows added: ${added}, already there: ${skipped}\n`);
}

// ---------------------------------------------------------------------------
// 4. Verification: photos in the bucket, rows in the table, locks unchanged
// ---------------------------------------------------------------------------
let ok = 0, bad = 0;
function check(name, pass, detail = '') {
  pass ? ok++ : bad++;
  console.log(`  ${pass ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const reader = admin || visitor;
const ids = await sectionIds(reader);
const toCheck = mode === '--verify' ? null : chosen;

// Photos: each is in its section folder and opens publicly, byte-for-byte identical
// to the original. Small runs list every photo; big runs list only problems, then
// one summary line per section folder (which must hold exactly the expected files).
const verbose = (toCheck || []).length <= 10;
console.log('Photos in the "site-images" bucket:');
const folderFiles = {};
if (admin) {
  for (const slug of new Set((toCheck || []).map(p => p.slug))) {
    const { data, error } = await admin.storage.from(BUCKET).list(`products/${slug}`, { limit: 1000 });
    folderFiles[slug] = error ? [] : data.filter(o => o.id).map(o => o.name);
  }
}
const photosOk = {};
for (const p of toCheck || []) {
  const name = p.storagePath.split('/').pop();
  const inBucket = !admin || folderFiles[p.slug].includes(name);
  const res = await fetch(visitor.storage.from(BUCKET).getPublicUrl(p.storagePath).data.publicUrl);
  const body = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const opens = res.ok && res.headers.get('content-type') === 'image/webp'
    && body.equals(readFileSync(new URL(p.localPath, ROOT)));
  photosOk[p.slug] = (photosOk[p.slug] || 0) + (inBucket && opens ? 1 : 0);
  if (verbose || !(inBucket && opens)) {
    check(`${p.storagePath} is in the bucket and opens for visitors`, inBucket && opens,
      opens ? `${Math.round(body.length / 1024)} KB, identical to the original`
        : `HTTP ${res.status}${inBucket ? '' : ', missing from the bucket'}`);
  }
}
if (!verbose) {
  for (const slug of new Set(toCheck.map(p => p.slug))) {
    const expected = toCheck.filter(p => p.slug === slug).length;
    const files = folderFiles[slug] || [];
    check(`products/${slug}/  ${photosOk[slug]} of ${expected} open correctly, ${files.length} file(s) in the folder`,
      photosOk[slug] === expected && files.length === expected);
  }
}

console.log('\nRows in public.products, per section:');
const { data: rows, error: rowsError } = await reader.from('products')
  .select('category_id, image_path, sort_order, is_visible').order('sort_order');
if (rowsError) stop(`Could not read the products: ${rowsError.message}`);
const slugOf = Object.fromEntries(Object.entries(ids).map(([slug, id]) => [id, slug]));
const strict = mode === '--all';
for (const [, slug] of PAGES) {
  const onSite = all.filter(p => p.slug === slug);
  const inDb = rows.filter(r => slugOf[r.category_id] === slug);
  const expected = toCheck ? toCheck.filter(p => p.slug === slug) : [];
  if (!toCheck || (!strict && !expected.length)) {
    console.log(`        ${slug.padEnd(11)} ${inDb.length} of ${onSite.length} on the site`);
    continue;
  }
  const allThere = expected.every(p =>
    inDb.some(r => r.image_path === p.storagePath && r.sort_order === p.sortOrder && r.is_visible));
  const orders = inDb.map(r => r.sort_order);
  const inOrder = orders.every((o, i) => o === i + 1);
  check(`${slug.padEnd(11)} ${inDb.length} of ${onSite.length} on the site, order ${inOrder ? `1–${inDb.length}` : orders.join(',')}`,
    allThere && inOrder && (strict ? inDb.length === onSite.length : inDb.length >= expected.length));
}

console.log('\nTotals and duplicates:');
if (strict || mode === '--verify') {
  check(`the products table holds ${all.length} products`, rows.length === all.length, `${rows.length} found`);
}
check('no photo is listed twice', new Set(rows.map(r => r.image_path)).size === rows.length);
check('no two products share a position in the same section',
  new Set(rows.map(r => `${r.category_id}:${r.sort_order}`)).size === rows.length);
check('every product belongs to an existing section', rows.every(r => slugOf[r.category_id]));

console.log('\nLocks for visitors (tested with the public key, exactly like the website):');
const NOBODY = '00000000-0000-0000-0000-000000000000';
const denied = r => r.error && (r.error.code === '42501' || /row-level security|permission denied|Unauthorized/i.test(r.error.message));
const vRead = await visitor.from('products').select('id', { count: 'exact', head: true });
check('visitors can read products', !vRead.error, vRead.error?.message || `${vRead.count} visible`);
check('visitors cannot add a product',
  denied(await visitor.from('products').insert({ category_id: NOBODY, image_path: 'permission-test' })));
check('visitors cannot edit products',
  denied(await visitor.from('products').update({ sort_order: 0 }).eq('id', NOBODY)));
check('visitors cannot delete products',
  denied(await visitor.from('products').delete().eq('id', NOBODY)));
check('visitors cannot edit site settings',
  denied(await visitor.from('site_settings').update({ hero_title: 'permission-test' }).eq('id', false)));
check('visitors cannot see the admins list',
  denied(await visitor.from('admins').select('user_id')));
// 1×1 WebP. If the bucket ever accepted it, remove it straight away and report FAIL.
const pixel = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const testPath = 'permission-test/visitor-upload.webp';
const vUp = await visitor.storage.from(BUCKET).upload(testPath, pixel, { contentType: 'image/webp' });
if (!vUp.error && admin) await admin.storage.from(BUCKET).remove([testPath]);
check('visitors cannot upload photos', !!vUp.error, vUp.error ? '' : 'UPLOAD WAS ACCEPTED, removed again');
const authSettings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } })
  .then(r => r.json()).catch(() => ({}));
check('nobody can create an account (public sign-up is off)', authSettings.disable_signup === true);

// Read-only: the admin setup is still in place. (Writing as the admin is not tested
// here, because that would need the admin's password.)
if (admin) {
  console.log('\nAdmin account (read-only check):');
  const { data: admins, error: adminsError } = await admin.from('admins').select('user_id');
  check('exactly one account in public.admins', !adminsError && admins.length === 1,
    adminsError?.message || `${admins.length} found`);
  if (!adminsError && admins.length) {
    const { data, error } = await admin.auth.admin.getUserById(admins[0].user_id);
    check('that account exists and its email is confirmed', !error && !!data?.user?.email_confirmed_at, error?.message || '');
  }
}

console.log(`\n${ok} OK, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
