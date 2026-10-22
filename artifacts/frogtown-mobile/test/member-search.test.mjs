import assert from 'node:assert/strict';
import test from 'node:test';
import { memberSearchTerm } from '../lib/member-search.ts';

test('member autocomplete normalizes @names and accepts usernames and full wallets', () => {
  assert.equal(memberSearchTerm(' @Frog_7 '), 'Frog_7');
  assert.equal(memberSearchTerm('a'.repeat(17)), 'a'.repeat(17));
  assert.equal(memberSearchTerm('r123456789ABCDEFGHJKLMNPQRSTUVWXYZ'), 'r123456789ABCDEFGHJKLMNPQRSTUVWXYZ');
  assert.equal(memberSearchTerm(`0x${'ab'.repeat(20)}`), `0x${'ab'.repeat(20)}`);
});

test('incomplete and invalid searches never trigger a member API request', () => {
  for (const input of ['', '@', 'abc', '@abc', 'frog town', 'frog!', 'a'.repeat(18), '0x', '@@frog']) {
    assert.equal(memberSearchTerm(input), null, input);
  }
});
