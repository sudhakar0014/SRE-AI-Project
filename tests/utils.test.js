import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySeverity, safeText, makeSystemPrompt } from '../src/utils.js';

test('classifySeverity identifies critical incidents', () => {
  assert.equal(classifySeverity('Production down for all users'), 'critical');
});
test('classifySeverity recognizes common SRE symptoms', () => {
  assert.equal(classifySeverity('HTTP 5xx spike after deploy'), 'high');
  assert.equal(classifySeverity('slow dashboard'), 'medium');
  assert.equal(classifySeverity('routine capacity review'), 'low');
});
test('safeText trims and limits user input', () => {
  assert.equal(safeText('  hello  '), 'hello');
  assert.equal(safeText('123456', 3), '123');
  assert.equal(safeText(null), '');
});
test('system prompt requires evidence-first responses', () => {
  const prompt = makeSystemPrompt();
  assert.match(prompt, /OBSERVED FACTS/);
  assert.match(prompt, /human approval/i);
});
