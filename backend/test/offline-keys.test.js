import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptForDevice, openTotp, sealTotp, unwrapKey, wrapKey } from '../src/security.js';

test('wrapKey/unwrapKey: ida e volta e IV diferente a cada vez', () => {
  const raw = crypto.randomBytes(32);
  const a = wrapKey(raw);
  assert.notEqual(wrapKey(raw), a);
  assert.deepEqual(unwrapKey(a), raw);
});

test('unwrapKey: dado adulterado falha (AES-GCM autenticado)', () => {
  const buf = Buffer.from(wrapKey(crypto.randomBytes(32)), 'base64');
  buf[20] ^= 1;
  assert.throws(() => unwrapKey(buf.toString('base64')));
});

test('sealTotp/openTotp: segredo do 2FA cifrado', () => {
  const sealed = sealTotp('JBSWY3DPEHPK3PXP');
  assert.ok(!sealed.includes('JBSWY3DP'));
  assert.equal(openTotp(sealed), 'JBSWY3DPEHPK3PXP');
});

test('encryptForDevice: formato IV(12) + dados + tag(16) do WebCrypto', () => {
  const key = crypto.randomBytes(32);
  const data = Buffer.from('áudio de teste');
  const out = encryptForDevice(key, data);
  assert.equal(out.length, 12 + data.length + 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, out.subarray(0, 12));
  d.setAuthTag(out.subarray(out.length - 16));
  assert.equal(Buffer.concat([d.update(out.subarray(12, out.length - 16)), d.final()]).toString(), 'áudio de teste');
});
