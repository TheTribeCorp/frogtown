import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getConversationKeyChanges,
  trustConversationKeyChange,
} from '../src/lib/e2ee-key-trust.ts';

const viewer = 'r111111111111111111111111111111111';
const partner = 'r222222222222222222222222222222222';
const ownKey = '{"kty":"EC","crv":"P-256","x":"viewer"}';
const partnerKey = '{"kty":"EC","crv":"P-256","x":"partner-v1"}';
const changedPartnerKey = '{"kty":"EC","crv":"P-256","x":"partner-v2"}';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('first-seen conversation keys are pinned per wallet and do not flag the viewer own key', () => {
  const storage = createStorage();
  const members = [
    { walletAddress: viewer, publicKey: ownKey },
    { walletAddress: partner, publicKey: partnerKey },
  ];

  assert.deepEqual(getConversationKeyChanges(viewer, members, storage), []);
  assert.deepEqual(getConversationKeyChanges(viewer, members, storage), []);
});

test('changed partner keys remain flagged until the member verifies and trusts the current key', () => {
  const storage = createStorage();
  const originalMembers = [
    { walletAddress: viewer, publicKey: ownKey },
    { walletAddress: partner, publicKey: partnerKey },
  ];
  const changedMembers = [
    { walletAddress: viewer, publicKey: ownKey },
    { walletAddress: partner, publicKey: changedPartnerKey },
  ];
  getConversationKeyChanges(viewer, originalMembers, storage);

  const warning = [{ walletAddress: partner, publicKey: changedPartnerKey }];
  assert.deepEqual(getConversationKeyChanges(viewer, changedMembers, storage), warning);
  assert.deepEqual(getConversationKeyChanges(viewer, changedMembers, storage), warning, 'reading a change must not silently trust it');

  trustConversationKeyChange(viewer, partner, changedPartnerKey, storage);
  assert.deepEqual(getConversationKeyChanges(viewer, changedMembers, storage), []);
});

test('members without registered keys are not pinned as trusted keys', () => {
  const storage = createStorage();
  const missingMember = { walletAddress: partner, publicKey: null };
  assert.deepEqual(getConversationKeyChanges(viewer, [missingMember], storage), []);
  assert.deepEqual(getConversationKeyChanges(viewer, [{ ...missingMember, publicKey: partnerKey }], storage), []);
});

test('unreadable local trust history fails rather than silently resetting trust', () => {
  const storage = {
    getItem: () => '{not-json',
    setItem: () => {},
  };
  assert.throws(
    () => getConversationKeyChanges(viewer, [{ walletAddress: partner, publicKey: partnerKey }], storage),
    /history is unreadable/i,
  );
});
