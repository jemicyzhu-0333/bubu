'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const breakdown = require('../src/core/breakdown-proposal');
const enrich = require('../src/core/enrich-proposal');
const contract = require('../src/core/llm/validate-steps');

const steps = () => [
  { title: '打开文件', dependsOn: null, safeStopAfter: false },
  { title: '写第一句', dependsOn: 0, safeStopAfter: false },
  { title: '保存草稿', dependsOn: 1, safeStopAfter: true }
];
const proposal = () => ({ steps: steps(), clarifyingQuestion: null });
const enrichment = () => ({ steps: steps(), completionCriteria: null, energy: null, estimateMinutes: null, tags: [] });

test('both proposal schemas retain exact step values and serialized property order', () => {
  const expected = {
    type: 'array', minItems: 3, maxItems: 7,
    description: 'Between 3 and 7 steps, in the order they should be done.',
    items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'dependsOn', 'safeStopAfter'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200, description: contract.STEP_TITLE_DESCRIPTION },
        dependsOn: {
          anyOf: [{ type: 'null' }, { type: 'integer', minimum: 0, maximum: 5 }],
          description: contract.DEPENDS_ON_DESCRIPTION
        },
        safeStopAfter: { type: 'boolean', description: contract.SAFE_STOP_DESCRIPTION }
      }
    }
  };
  assert.equal(JSON.stringify(breakdown.PROPOSAL_JSON_SCHEMA.properties.steps), JSON.stringify(expected));
  for (const tags of [undefined, null, [], ['工作'], [' b ', 'a', 'b'], [null, 1, '', 'x'.repeat(21)]]) {
    const schema = enrich.buildEnrichJsonSchema(tags);
    assert.equal(JSON.stringify(schema.properties.steps), JSON.stringify(expected));
    assert.deepEqual(Object.keys(schema), ['type', 'additionalProperties', 'required', 'properties']);
    assert.deepEqual(Object.keys(schema.properties), ['steps', 'completionCriteria', 'energy', 'estimateMinutes', 'tags']);
  }
});

test('schema roots remain shallow frozen and nested step objects remain independently mutable', () => {
  const left = enrich.buildEnrichJsonSchema(['work']);
  const right = enrich.buildEnrichJsonSchema(['work']);
  const saved = JSON.stringify(right);
  const breakdownBefore = JSON.stringify(breakdown.PROPOSAL_JSON_SCHEMA);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(breakdown.PROPOSAL_JSON_SCHEMA), true);
  assert.equal(Object.isFrozen(left.properties), false);
  assert.equal(Object.isFrozen(left.properties.steps), false);
  assert.equal(Object.isFrozen(breakdown.PROPOSAL_JSON_SCHEMA.properties.steps), false);
  left.properties.steps.items.required.push('extra');
  left.properties.steps.items.properties.dependsOn.anyOf[1].maximum = 99;
  left.properties.steps.items.properties.title.description = 'changed';
  left.properties.steps.items.properties.safeStopAfter.type = 'string';
  left.properties.steps.description = 'changed';
  left.properties.tags.items.enum.push('new');
  assert.equal(JSON.stringify(right), saved);
  assert.equal(JSON.stringify(enrich.buildEnrichJsonSchema(['work'])), saved);
  assert.equal(JSON.stringify(breakdown.PROPOSAL_JSON_SCHEMA), breakdownBefore);
});

test('tag schema retains empty vocabulary branch and normalized insertion order', () => {
  for (const tags of [undefined, null, false, 'work', [], [null, 1, ' ']]) {
    assert.deepEqual(enrich.buildEnrichJsonSchema(tags).properties.tags, {
      type: 'array', maxItems: 0, items: { type: 'string' },
      description: 'The user has no tags yet, so this must be an empty array.'
    });
  }
  const value = enrich.buildEnrichJsonSchema([' b ', 'a', 'b', 'x'.repeat(21)]).properties.tags;
  assert.equal(value.maxItems, 3);
  assert.deepEqual(value.items.enum, ['b', 'a', 'x'.repeat(20)]);
  assert.deepEqual(Object.keys(value), ['type', 'maxItems', 'items', 'description']);
});

test('normalized proposal and step records keep their existing freeze depth', () => {
  for (const value of [breakdown.validateProposal(proposal()), enrich.validateEnrichProposal(enrichment())]) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.isFrozen(value.steps), false);
    assert.equal(Object.isFrozen(value.steps[0]), true);
    assert.deepEqual(value.steps, steps());
  }
});

test('shared step validation preserves bounds and first failure ordering', () => {
  const validate = source => breakdown.validateProposal({ steps: source, clarifyingQuestion: null });
  for (const count of [2, 3, 7, 8]) {
    const source = Array.from({ length: count }, (_, index) => ({ title: '检查结果', dependsOn: index ? index - 1 : null, safeStopAfter: index === count - 1 }));
    if (count === 2 || count === 8) assert.throws(() => validate(source), { name: 'RangeError', message: 'proposal must contain 3–7 steps' });
    else assert.equal(validate(source).steps.length, count);
  }
  const extra = steps(); extra[0] = { title: '', dependsOn: 99, safeStopAfter: 'yes', extra: true };
  assert.throws(() => validate(extra), { name: 'TypeError', message: 'steps[0] contains unknown or missing fields' });
  const invalidTitle = steps(); invalidTitle[0].title = '';
  assert.throws(() => validate(invalidTitle), { name: 'RangeError', message: 'steps[0].title is invalid' });
  const dependency = steps(); dependency[0].dependsOn = 0;
  assert.throws(() => validate(dependency), { name: 'RangeError', message: 'steps[0].dependsOn must reference an earlier step' });
  const unsafe = steps(); unsafe[2].safeStopAfter = false;
  assert.throws(() => validate(unsafe), { name: 'RangeError', message: 'the final step must be a safe stop' });
});

test('raw proposal byte budget and malformed JSON remain unchanged', () => {
  for (const [raw, validate] of [[proposal(), breakdown.validateProposal], [enrichment(), enrich.validateEnrichProposal]]) {
    const serialized = JSON.stringify(raw);
    const padding = 8192 - Buffer.byteLength(serialized, 'utf8');
    assert.deepEqual(validate(serialized + ' '.repeat(padding)), validate(raw));
    assert.throws(() => validate(serialized + ' '.repeat(padding + 1)), { name: 'RangeError', message: 'proposal exceeds 8 KB' });
    assert.throws(() => validate('{'), { name: 'TypeError', message: 'proposal is not valid JSON' });
  }
});

test('enrich-only validation preserves fields, vocabulary and first error', () => {
  assert.deepEqual(enrich.validateEnrichProposal({ ...enrichment(), energy: 'low', estimateMinutes: 5, tags: [' 工作 ', '工作'] }, { allowedTags: ['工作'] }).tags, ['工作']);
  assert.throws(() => enrich.validateEnrichProposal({ ...enrichment(), energy: 'invalid', estimateMinutes: 0 }), { name: 'TypeError', message: 'energy is invalid' });
  assert.throws(() => enrich.validateEnrichProposal({ ...enrichment(), estimateMinutes: 481 }), { name: 'RangeError', message: 'estimateMinutes is invalid' });
  assert.throws(() => enrich.validateEnrichProposal({ ...enrichment(), tags: ['new'] }), { name: 'TypeError', message: 'tags may only reuse existing tags' });
});

test('deterministic fallbacks retain padding, dependency and effort behavior', () => {
  const basic = breakdown.buildDeterministicProposal(['草稿']);
  assert.equal(basic.steps.length, 3);
  assert.equal(basic.steps[0].title, '完成：草稿');
  assert.deepEqual(basic.steps.map(step => step.dependsOn), [null, 0, 1]);
  assert.deepEqual(basic.steps.map(step => step.safeStopAfter), [false, false, true]);
  const enhanced = enrich.buildDeterministicEnrich({ steps: ['草稿'], energy: 'unknown', estimateMinutes: 9999 });
  assert.deepEqual(enhanced.steps, basic.steps);
  assert.equal(enhanced.energy, null);
  assert.equal(enhanced.estimateMinutes, 480);
  assert.equal(enhanced.completionCriteria, null);
  assert.deepEqual(enhanced.tags, []);
});
