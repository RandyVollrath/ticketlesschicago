// Smoke test for lib/credentials-vault.ts
// Verifies AES-256-GCM round trip + tamper detection. Sets a dummy key in-process.

import { randomBytes } from 'crypto';

process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');

import { encryptCredential, decryptCredential } from '../lib/credentials-vault';

function expect(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

const samples = ['1234', 'A1B2C3D4', '12345678901', ''];
for (const s of samples) {
  if (s === '') {
    let threw = false;
    try {
      encryptCredential(s);
    } catch {
      threw = true;
    }
    expect(threw, 'empty input rejected');
    continue;
  }
  const ct = encryptCredential(s);
  expect(ct.split('.').length === 3, `format(${s}): iv.tag.ct`);
  const pt = decryptCredential(ct);
  expect(pt === s, `round-trip(${s})`);
}

// Tamper: flip a byte in the ciphertext portion.
const ct = encryptCredential('1234');
const [iv, tag, body] = ct.split('.');
const tamperedBody = Buffer.from(body, 'base64');
tamperedBody[0] ^= 0xff;
const tampered = `${iv}.${tag}.${tamperedBody.toString('base64')}`;
let tamperRejected = false;
try {
  decryptCredential(tampered);
} catch {
  tamperRejected = true;
}
expect(tamperRejected, 'tampered ciphertext rejected by GCM auth tag');

// Two encryptions of the same plaintext must differ (random IV).
expect(encryptCredential('1234') !== encryptCredential('1234'), 'IV randomness produces different ciphertext');

console.log('\nALL VAULT SMOKE TESTS PASSED');
