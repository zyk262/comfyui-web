import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkflow, historyError, historyImages } from '../workflow.mjs';

const fixture = () => ({
  '1': { class_type: 'AnimaPromptPlusClipEncode', inputs: { quality_prompt: '', artist_tags: '', character_tags: '', clothing_tags: '', pose_tags: '', background_tags: '', extra_prompt: '', clip: ['2', 0] } },
  '3': { class_type: 'KSampler', inputs: { seed: 17, steps: 8, cfg: 1, model: ['4', 0] } }
});

test('empty Anima prompt gets a linked runtime randomizer without changing source or sampling settings', () => {
  const source = fixture();
  const snapshot = structuredClone(source);
  const output = prepareWorkflow(source);
  assert.deepEqual(source, snapshot);
  const id = output['1'].inputs.extra_prompt[0];
  assert.equal(output[id].class_type, 'AnimaPromptComposer');
  assert.equal(output['3'].inputs.steps, 8);
  assert.equal(output['3'].inputs.cfg, 1);
  assert.ok(Number.isSafeInteger(output['3'].inputs.seed));
  assert.notEqual(prepareWorkflow(source)[id].inputs.seed, output[id].inputs.seed);
});

test('existing prompts and upstream randomizer links are preserved', () => {
  const source = fixture();
  source['1'].inputs.extra_prompt = ['12', 0];
  const output = prepareWorkflow(source);
  assert.deepEqual(output['1'].inputs.extra_prompt, ['12', 0]);
  assert.equal(Object.keys(output).length, 2);
});

test('only durable output images are used; interrupted tasks expose their error', () => {
  const entry = { outputs: { '18': { images: [{ filename: 'a.png', type: 'output' }, { filename: 'preview.png', type: 'temp' }] } }, status: { messages: [['execution_error', { exception_message: 'GPU out of memory' }]] } };
  assert.equal(historyImages(entry).length, 1);
  assert.equal(historyError(entry), 'GPU out of memory');
  assert.equal(historyError({ status: { messages: [['execution_interrupted', {}]] } }), 'ComfyUI 的生成任务已中断。');
});
