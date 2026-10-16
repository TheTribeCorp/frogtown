import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearPendingEncryptedMessages,
  findPendingEncryptedMessage,
  loadPendingEncryptedMessages,
  removePendingEncryptedMessage,
  savePendingEncryptedMessage,
} from '../src/lib/message-outbox.ts';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const pending = {
  conversationId: 'room-123',
  messageId: 'f1234567-89ab-4cde-8f01-23456789abcd',
  encryptedBody: 'e2ee:v1:ciphertext-only',
  createdAt: '2026-10-16T12:00:00.000Z',
};

test('encrypted outbox is wallet-scoped and stores no plaintext', () => {
  const storage = new MemoryStorage();
  savePendingEncryptedMessage('rWalletA', pending, storage);
  assert.deepEqual(findPendingEncryptedMessage('rWalletA', 'room-123', storage), pending);
  assert.deepEqual(loadPendingEncryptedMessages('rWalletB', storage), []);
  assert.equal([...storage.values.values()].join('').includes('plaintext'), false);
});

test('retry records keep the same ciphertext and prevent a second pending send per chat', () => {
  const storage = new MemoryStorage();
  savePendingEncryptedMessage('rWalletA', pending, storage);
  savePendingEncryptedMessage('rWalletA', pending, storage);
  assert.deepEqual(loadPendingEncryptedMessages('rWalletA', storage), [pending]);
  assert.throws(
    () => savePendingEncryptedMessage('rWalletA', { ...pending, messageId: '01234567-89ab-4cde-8f01-23456789abcd' }, storage),
    /Another message in this chat/,
  );
});

test('confirmed retries can be removed from the outbox', () => {
  const storage = new MemoryStorage();
  savePendingEncryptedMessage('rWalletA', pending, storage);
  removePendingEncryptedMessage('rWalletA', pending.messageId, storage);
  assert.deepEqual(loadPendingEncryptedMessages('rWalletA', storage), []);
});

test('a fresh-start reset clears only this wallet tab’s pending encrypted retries', () => {
  const storage = new MemoryStorage();
  savePendingEncryptedMessage('rWalletA', pending, storage);
  savePendingEncryptedMessage('rWalletB', { ...pending, conversationId: 'room-456' }, storage);
  clearPendingEncryptedMessages('rWalletA', storage);
  assert.deepEqual(loadPendingEncryptedMessages('rWalletA', storage), []);
  assert.deepEqual(loadPendingEncryptedMessages('rWalletB', storage), [{ ...pending, conversationId: 'room-456' }]);
});
