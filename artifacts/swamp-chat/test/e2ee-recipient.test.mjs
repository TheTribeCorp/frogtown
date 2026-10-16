import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptForConversation,
  encryptForConversation,
} from '../src/lib/e2ee-crypto.ts';

const conversationId = 'conversation-recipient-only-test';
const senderAddress = 'r111111111111111111111111111111111';
const recipientAddress = 'r222222222222222222222222222222222';
const outsiderAddress = 'r333333333333333333333333333333333';

async function createIdentity() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    identity: {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      publicJwk,
    },
    publicKey: JSON.stringify(publicJwk),
  };
}

test('only a message recipient can decrypt its recipient-only ciphertext', async () => {
  const sender = await createIdentity();
  const recipient = await createIdentity();
  const outsider = await createIdentity();
  const members = [
    { walletAddress: senderAddress, publicKey: sender.publicKey },
    { walletAddress: recipientAddress, publicKey: recipient.publicKey },
  ];
  const plaintext = 'private message must remain client-readable only';
  const encryptedBody = await encryptForConversation(
    plaintext,
    conversationId,
    senderAddress,
    sender.identity,
    members,
  );

  assert.ok(encryptedBody.startsWith('e2ee:v1:'));
  assert.ok(!encryptedBody.includes(plaintext));
  const envelope = JSON.parse(
    new TextDecoder().decode(Buffer.from(encryptedBody.slice('e2ee:v1:'.length), 'base64url')),
  );
  assert.deepEqual(Object.keys(envelope.entries).sort(), [senderAddress, recipientAddress].sort());
  assert.equal(
    await decryptForConversation(
      encryptedBody,
      conversationId,
      senderAddress,
      recipientAddress,
      recipient.identity,
      members,
    ),
    plaintext,
  );
  await assert.rejects(
    decryptForConversation(
      encryptedBody,
      conversationId,
      senderAddress,
      recipientAddress,
      outsider.identity,
      members,
    ),
  );
  assert.equal(
    await decryptForConversation(
      encryptedBody,
      conversationId,
      senderAddress,
      outsiderAddress,
      outsider.identity,
      members,
    ),
    'This message was not encrypted for this device.',
  );
});

test('group messages can be encrypted for key-ready members while omitting members without device keys', async () => {
  const sender = await createIdentity();
  const readyMember = await createIdentity();
  const keylessMember = await createIdentity();
  const members = [
    { walletAddress: senderAddress, publicKey: sender.publicKey },
    { walletAddress: recipientAddress, publicKey: readyMember.publicKey },
    { walletAddress: outsiderAddress, publicKey: null },
  ];
  const plaintext = 'the room is ready to talk';
  const encryptedBody = await encryptForConversation(
    plaintext,
    conversationId,
    senderAddress,
    sender.identity,
    members,
    true,
  );
  const envelope = JSON.parse(
    new TextDecoder().decode(Buffer.from(encryptedBody.slice('e2ee:v1:'.length), 'base64url')),
  );
  assert.deepEqual(Object.keys(envelope.entries).sort(), [senderAddress, recipientAddress].sort());
  assert.equal(
    await decryptForConversation(
      encryptedBody,
      conversationId,
      senderAddress,
      recipientAddress,
      readyMember.identity,
      members,
    ),
    plaintext,
  );
  assert.equal(
    await decryptForConversation(
      encryptedBody,
      conversationId,
      senderAddress,
      outsiderAddress,
      keylessMember.identity,
      members,
    ),
    'This message was not encrypted for this device.',
  );
  await assert.rejects(
    encryptForConversation(plaintext, conversationId, senderAddress, sender.identity, members),
    /Every member must connect/,
    'one-to-one/default encryption must continue rejecting a missing member key',
  );
});

test('an existing group member can re-encrypt old history for a new member without server-readable plaintext', async () => {
  const author = await createIdentity();
  const sharer = await createIdentity();
  const newcomer = await createIdentity();
  const originalMembers = [
    { walletAddress: senderAddress, publicKey: author.publicKey },
    { walletAddress: outsiderAddress, publicKey: sharer.publicKey },
  ];
  const plaintext = 'The server must never receive this readable message.';
  const originalCiphertext = await encryptForConversation(
    plaintext,
    conversationId,
    senderAddress,
    author.identity,
    originalMembers,
  );

  const recoveredBySharer = await decryptForConversation(
    originalCiphertext,
    conversationId,
    senderAddress,
    outsiderAddress,
    sharer.identity,
    originalMembers,
  );
  const sharedCiphertext = await encryptForConversation(
    recoveredBySharer,
    conversationId,
    outsiderAddress,
    sharer.identity,
    [{ walletAddress: recipientAddress, publicKey: newcomer.publicKey }],
  );
  const shareEnvelope = JSON.parse(
    new TextDecoder().decode(Buffer.from(sharedCiphertext.slice('e2ee:v1:'.length), 'base64url')),
  );

  assert.deepEqual(Object.keys(shareEnvelope.entries), [recipientAddress]);
  assert.ok(!sharedCiphertext.includes(plaintext));
  assert.equal(
    await decryptForConversation(
      sharedCiphertext,
      conversationId,
      outsiderAddress,
      recipientAddress,
      newcomer.identity,
      [
        { walletAddress: outsiderAddress, publicKey: sharer.publicKey },
        { walletAddress: recipientAddress, publicKey: newcomer.publicKey },
      ],
    ),
    plaintext,
  );
});
