'use strict';

const assert = require('assert');
const { computeSessionValidityScore } = require('../lib/session-scoring');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} - ${e.message}`);
  }
}

console.log('=== session-scoring tests ===');

test('valid session: logged-in element present, no negatives', () => {
  const result = computeSessionValidityScore({
    isLoginUrl: false,
    hasAuthCookie: true,
    hasLoginText: false,
    hasLoggedInElement: true,
    matchedSelector: '.Avatar',
  });
  assert.strictEqual(result.score, 3);
  assert.strictEqual(result.valid, true);
  assert.ok(result.reason.includes('Avatar'));
});

test('invalid: redirected to login page', () => {
  const result = computeSessionValidityScore({
    isLoginUrl: true,
    hasAuthCookie: true,
    hasLoginText: false,
    hasLoggedInElement: false,
  });
  assert.strictEqual(result.score, -3);
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes('login page'));
});

test('invalid: no auth cookie', () => {
  const result = computeSessionValidityScore({
    isLoginUrl: false,
    hasAuthCookie: false,
    hasLoginText: false,
    hasLoggedInElement: false,
  });
  assert.strictEqual(result.score, -2);
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes('No auth cookies'));
});

test('invalid: multiple negatives stack', () => {
  const result = computeSessionValidityScore({
    isLoginUrl: true,
    hasAuthCookie: false,
    hasLoginText: true,
    hasLoggedInElement: false,
  });
  assert.strictEqual(result.score, -6);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason.split('; ').length, 3);
});

test('border case: logged-in element + login redirect = score 0, invalid', () => {
  const result = computeSessionValidityScore({
    isLoginUrl: true,
    hasAuthCookie: true,
    hasLoginText: false,
    hasLoggedInElement: true,
  });
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.valid, false);
});

test('handles null/undefined input', () => {
  const result = computeSessionValidityScore(null);
  assert.strictEqual(result.score, -2);
  assert.strictEqual(result.valid, false);
});

test('handles empty object', () => {
  const result = computeSessionValidityScore({});
  assert.strictEqual(result.score, -2);
  assert.strictEqual(result.valid, false);
});

test('reason includes matchedSelector when provided', () => {
  const result = computeSessionValidityScore({
    hasLoggedInElement: true,
    matchedSelector: '#csdn-toolbar',
  });
  assert.ok(result.reason.includes('#csdn-toolbar'));
});

test('reason is generic when no matchedSelector', () => {
  const result = computeSessionValidityScore({
    hasLoggedInElement: true,
  });
  assert.ok(result.reason.includes('logged-in element'));
  assert.ok(!result.reason.includes('undefined'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
