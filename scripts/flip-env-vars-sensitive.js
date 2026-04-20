#!/usr/bin/env node
/**
 * Flip every type=encrypted env var in the Vercel project to type=sensitive.
 *
 * Reads each value with decrypt=true and sends PATCH {type:'sensitive', value}
 * (the value is required on PATCH — sending type alone wipes the value).
 *
 * Usage:
 *   node scripts/flip-env-vars-sensitive.js --dry-run
 *   node scripts/flip-env-vars-sensitive.js
 *
 * Env required:
 *   VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID
 * or reads ./.vercel/project.json + ~/.local/share/com.vercel.cli/auth.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');

function parseDotenv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

function loadAuth() {
  let token = process.env.VERCEL_TOKEN;
  let projectId = process.env.VERCEL_PROJECT_ID;
  let orgId = process.env.VERCEL_ORG_ID;
  if (!token) {
    const p = path.join(os.homedir(), '.local/share/com.vercel.cli/auth.json');
    if (fs.existsSync(p)) token = JSON.parse(fs.readFileSync(p, 'utf8')).token;
  }
  if (!projectId || !orgId) {
    const p = path.join(process.cwd(), '.vercel/project.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      projectId = projectId || j.projectId;
      orgId = orgId || j.orgId;
    }
  }
  if (!token || !projectId || !orgId) throw new Error('Missing Vercel credentials');
  return { token, projectId, orgId };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { token, projectId, orgId } = loadAuth();
  const base = `https://api.vercel.com/v9/projects/${projectId}/env`;
  const q = `teamId=${orgId}`;

  const prod = parseDotenv(path.join(process.cwd(), '.env.flip.production'));
  const prev = parseDotenv(path.join(process.cwd(), '.env.flip.preview'));
  const dev = parseDotenv(path.join(process.cwd(), '.env.flip.development'));
  const envMap = { production: prod, preview: prev, development: dev };
  if (!Object.keys(prod).length && !Object.keys(prev).length && !Object.keys(dev).length) {
    throw new Error('No .env.flip.{production,preview,development} files found. Run `vercel env pull` first.');
  }

  const res = await fetch(`${base}?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
  const { envs } = await res.json();

  const encryptedAll = envs.filter((e) => e.type === 'encrypted');
  const already = envs.filter((e) => e.type === 'sensitive').length;
  // Vercel API rule: sensitive vars cannot target "development".
  const toFlip = encryptedAll.filter((e) => !(e.target || []).includes('development'));
  const skippedDev = encryptedAll.filter((e) => (e.target || []).includes('development'));
  console.log(
    `Total: ${envs.length} | already sensitive: ${already} | to flip: ${toFlip.length} | skipped (targets development): ${skippedDev.length}${DRY ? ' (DRY RUN)' : ''}`
  );

  const fails = [];
  let i = 0;
  for (const e of toFlip) {
    i++;
    const targets = e.target || [];
    const tag = `[${i}/${toFlip.length}] ${e.key} [${targets.join(',')}]`;

    let value;
    for (const t of targets) {
      if (envMap[t] && envMap[t][e.key] !== undefined) {
        value = envMap[t][e.key];
        break;
      }
    }
    if (value === undefined) {
      console.log(`${tag} — SKIP (no plaintext value found in pulled env files)`);
      fails.push({ id: e.id, key: e.key, reason: 'no plaintext available' });
      continue;
    }
    if (DRY) {
      console.log(`${tag} — would flip (value len=${String(value).length})`);
      continue;
    }

    const patchRes = await fetch(`${base}/${e.id}?${q}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'sensitive', value }),
    });
    if (!patchRes.ok) {
      const body = await patchRes.text();
      console.log(`${tag} — FAIL ${patchRes.status}: ${body.slice(0, 200)}`);
      fails.push({ id: e.id, key: e.key, status: patchRes.status, body });
      continue;
    }
    console.log(`${tag} — ok`);
    await sleep(120); // be nice to the API
  }

  console.log(`\nDone. ${toFlip.length - fails.length}/${toFlip.length} flipped. ${fails.length} failures.`);
  if (fails.length) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log(' ', f.key, '-', f.reason || f.status));
    process.exit(1);
  }

  const verifyRes = await fetch(`${base}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  const { envs: after } = await verifyRes.json();
  const remaining = after.filter((e) => e.type === 'encrypted').length;
  console.log(`Verification: ${after.filter((e) => e.type === 'sensitive').length} sensitive, ${remaining} still encrypted.`);

  if (skippedDev.length) {
    console.log(`\n${skippedDev.length} env vars remain encrypted because they target development (Vercel disallows sensitive+dev):`);
    const grouped = {};
    skippedDev.forEach((e) => {
      const k = (e.target || []).slice().sort().join(',');
      (grouped[k] = grouped[k] || []).push(e.key);
    });
    for (const [targets, keys] of Object.entries(grouped)) {
      console.log(`  targets=[${targets}] (${keys.length}):`);
      keys.sort().forEach((k) => console.log(`    - ${k}`));
    }
  }
}

main().catch((e) => {
  console.error('Crashed:', e);
  process.exit(2);
});
