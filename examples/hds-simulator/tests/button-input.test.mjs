import assert from 'node:assert/strict';
import test from 'node:test';
import { createButtonInput } from '../src/button-input.mjs';
import { advance, createState, dispatch, snapshot } from '../src/state.mjs';

function fixture() {
  let state = advance(createState(), 1000);
  const send = event => { state = dispatch(state, event); };
  const getSnapshot = () => snapshot(state);
  return { input: createButtonInput(send, getSnapshot), send, getSnapshot };
}

test('button ownership prevents remote or local releases from stealing a hold', () => {
  const { input, getSnapshot } = fixture();
  assert.equal(input.down('square', 'api:one'), true);
  assert.equal(input.down('square', 'local'), false);
  assert.equal(input.up('square', 'local'), false);
  assert.equal(input.up('square', 'api:two'), false);
  assert.equal(getSnapshot().held.square, true);
  assert.equal(input.up('square', 'api:one'), true);
  assert.equal(getSnapshot().timerRunning, true);
  assert.equal(input.up('square', 'api:one'), false);
});

test('disconnect cancellation affects only its owner and never activates a button', () => {
  const { input, getSnapshot } = fixture();
  input.down('circle', 'local');
  input.down('square', 'api:one');
  input.cancel('api:two');
  assert.deepEqual(getSnapshot().held, { circle: true, square: true });
  input.cancelRemote();
  assert.deepEqual(getSnapshot().held, { circle: true, square: false });
  assert.equal(getSnapshot().timerRunning, false);
  input.cancel('local');
  assert.deepEqual(getSnapshot().held, { circle: false, square: false });
  assert.equal(getSnapshot().tareUntil, 0);
});

test('restart or scene changes clear stale ownership before the next press', () => {
  const { input, send, getSnapshot } = fixture();
  input.down('circle', 'api:one');
  send({ type: 'jump', screen: 'main' });
  assert.equal(input.down('circle', 'api:two'), true);
  assert.equal(input.up('circle', 'api:one'), false);
  input.up('circle', 'api:two');
  assert.equal(getSnapshot().menu.selected, 1);
});
