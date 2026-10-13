import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleHermitTick } from '../src/lib/hermit-tick-display.ts';

test('checked holder results show their verified tick', () => {
  assert.equal(visibleHermitTick({ tick: 'green', checkStatus: 'checked' }), 'green');
  assert.equal(visibleHermitTick({ tick: 'gold', checkStatus: 'checked' }), 'gold');
});

test('unavailable or failed checks never show a cached tick', () => {
  assert.equal(visibleHermitTick({ tick: null, checkStatus: 'unavailable' }), null);
  assert.equal(visibleHermitTick({ tick: 'gold', checkStatus: 'unavailable' }), null);
  assert.equal(visibleHermitTick({ tick: 'green', checkStatus: 'checked' }, true), null);
  assert.equal(visibleHermitTick(undefined), null);
});

test('a successful check with no qualifying holding shows no tick', () => {
  assert.equal(visibleHermitTick({ tick: null, checkStatus: 'checked' }), null);
});
