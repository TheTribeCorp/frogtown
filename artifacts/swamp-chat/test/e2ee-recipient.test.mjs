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
    'This message was sent before this wallet joined the room.',
  );
});
