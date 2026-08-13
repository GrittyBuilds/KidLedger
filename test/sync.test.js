'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planSync } = require('../sync');

test('no remote file yet -> create', () => {
  assert.equal(planSync({ remoteExists: false, localUpdatedAt: 5, baseUpdatedAt: 0 }), 'create');
});

test('nothing changed on either side -> in-sync', () => {
  assert.equal(planSync({ remoteExists: true, localUpdatedAt: 100, remoteUpdatedAt: 100, baseUpdatedAt: 100 }), 'in-sync');
});

test('only local changed -> push', () => {
  assert.equal(planSync({ remoteExists: true, localUpdatedAt: 200, remoteUpdatedAt: 100, baseUpdatedAt: 100 }), 'push');
});

test('only remote changed -> pull', () => {
  assert.equal(planSync({ remoteExists: true, localUpdatedAt: 100, remoteUpdatedAt: 200, baseUpdatedAt: 100 }), 'pull');
});

test('both sides changed since last sync -> conflict', () => {
  assert.equal(planSync({ remoteExists: true, localUpdatedAt: 200, remoteUpdatedAt: 300, baseUpdatedAt: 100 }), 'conflict');
});

test('first-ever sync with a fresh local doc and no remote -> create', () => {
  assert.equal(planSync({ remoteExists: false, localUpdatedAt: 0, baseUpdatedAt: 0 }), 'create');
});

test('missing timestamps default to 0 (treated as in-sync when all absent)', () => {
  assert.equal(planSync({ remoteExists: true }), 'in-sync');
});
