import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCharacters, QUALITY_PROMPT } from '../characters.mjs';
import { prepareWorkflow, characterRandomMetadata, ARTIST_TAGS } from '../workflow.mjs';

const characters = parseCharacters(await readFile(new URL('../角色.txt', import.meta.url), 'utf8'));
const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const original = JSON.parse(await readFile(new URL('../' + config.workflow, import.meta.url), 'utf8'));

test('all published buttons map to the exact character catalog, with valid unique names', async () => {
  assert.ok(characters.length > 0);
  const published = JSON.parse(await readFile(new URL('../public/characters.json', import.meta.url), 'utf8'));
  assert.deepEqual(published, characters.map(({ id, name }) => ({ id, name })));
  assert.equal(parseCharacters('\uFEFF角色: 1girl, blue eyes,\r\n')[0].prompt, '1girl, blue eyes,');
  assert.throws(() => parseCharacters('角色：a\n角色：b'), /重复/);
  assert.throws(() => parseCharacters('名称但没有提示词'), /第 1 行/);
});

test('every character reaches character_tags exactly, quality and artists stay fixed, and only clothing, pose and background randomize', () => {
  const snapshot = structuredClone(original);
  for (const character of characters) {
    const workflow = prepareWorkflow(original, true, character);
    const [id, plus] = Object.entries(workflow).find(([, node]) => node.class_type === 'AnimaPromptPlusClipEncode');
    assert.equal(plus.inputs.character_tags, character.prompt);
    assert.equal(plus.inputs.quality_prompt, QUALITY_PROMPT);
    assert.equal(plus.inputs.artist_tags, ARTIST_TAGS);
    assert.equal(plus.inputs.extra_prompt, '');
    for (const field of ['clothing_tags', 'pose_tags', 'background_tags']) assert.equal(plus.inputs[field], '');
    assert.equal(Object.values(workflow).some(node => node.class_type === 'AnimaPromptComposer'), false, 'no extra random character can be appended');
    const metadata = characterRandomMetadata(workflow).extra_pnginfo.workflow.nodes[0];
    assert.equal(String(metadata.id), id);
    assert.deepEqual(metadata.properties.anima_selector_random, { artist: false, character: false, clothing: true, pose: true, background: true });
    assert.equal(metadata.widgets_values.character_tags, character.prompt);
    assert.equal(metadata.widgets_values.artist_tags, ARTIST_TAGS);
    for (const [nodeId, node] of Object.entries(snapshot)) {
      if (node.class_type === 'KSampler') {
        const { seed, ...before } = node.inputs;
        const { seed: nextSeed, ...after } = workflow[nodeId].inputs;
        assert.deepEqual(after, before);
        assert.ok(Number.isSafeInteger(nextSeed));
      } else if (node.class_type !== 'AnimaPromptPlusClipEncode') assert.deepEqual(workflow[nodeId], node);
    }
  }
  assert.deepEqual(original, snapshot);
});
