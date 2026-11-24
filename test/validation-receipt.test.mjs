import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {createTypedMark} from '@red-cup-engineering/typed-content';
import {EPUB_VALIDATOR_PROFILES, kindleValidationReceiptType, signKindleValidationReceipt, verifyKindleValidationReceipt} from '@red-cup-engineering/ebook-engineering-services-section/kindle-validation';

test('sign and reopen the same validation receipt; reject an edited book', () => {
  const epub = {name:'game.epub', bytes:42, sha256:'a'.repeat(64)};
  const content = {type:'KindleValidationReceipt',version:2,book:'Game guide',
    validatedAt:'2026-09-30T01:24:52.149Z',passed:true,validatorProfile:EPUB_VALIDATOR_PROFILES.release,
    artifacts:{epub,cover:{...epub,name:'cover.jpg'}},
    checks:{conformance:{},accessibility:{},features:{},navigation:{},portability:{},readingSystems:[],cover:{}}};
  const mark = createTypedMark(kindleValidationReceiptType, content);
  assert.equal(mark.ok, true);
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const receipt = signKindleValidationReceipt(mark.value, privateKey, 'test');
  assert.equal(verifyKindleValidationReceipt(JSON.parse(JSON.stringify(receipt)), publicKey), true);
  const edited = structuredClone(receipt);
  edited.cell.content.book = 'Another guide';
  assert.equal(verifyKindleValidationReceipt(edited, publicKey), false);
  assert.throws(() => signKindleValidationReceipt(edited.cell, privateKey, 'test'), /content address/);
});
