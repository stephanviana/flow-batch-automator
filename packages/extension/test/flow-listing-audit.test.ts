import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditListing, auditMessage } from '../src/flow-listing-audit.js';

function record(
  workflow: string,
  prompt: string,
  project = 'project',
): unknown[] {
  const detail: unknown[] = Array(9).fill(null);
  detail[1] = prompt;
  detail[6] = [null, [['model', ['frame']]]];
  detail[8] = [6];
  return [workflow, project, 'media', null, null, detail, null, [[]]];
}

test('the audit distinguishes missing IDs from another workflow carrying the exact prompt and frame', () => {
  const audit = auditListing(
    [
      record('actual', 'private copy'),
      record('wrong', 'other copy'),
      record('foreign', 'private copy', 'foreign'),
    ],
    'project',
    'private copy',
    'saved',
    'frame',
  );
  assert.equal(audit.generations, 2);
  assert.equal(audit.identified, 0);
  assert.equal(audit.matches, 1);
  assert.equal(audit.hasFrame, true);
  assert.match(auditMessage(audit, 'saved'), /outra operação/);
  assert.equal(auditMessage(audit, 'saved').includes('private copy'), false);
});
test('multiple identical prompts cannot establish a unique workflow', () => {
  const audit = auditListing(
    [record('a', 'copy'), record('b', 'copy')],
    'project',
    'copy',
    'saved',
    'frame',
  );
  assert.equal(audit.mappedWorkflow, undefined);
  assert.match(auditMessage(audit, 'saved'), /sem vínculo único/);
});
