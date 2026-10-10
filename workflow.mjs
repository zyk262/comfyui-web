import { randomInt, randomBytes } from 'node:crypto';

export function prepareWorkflow(original, randomize = true) {
  const workflow = structuredClone(original);
  if (!workflow || Array.isArray(workflow) || workflow.nodes) {
    throw new Error('请使用 ComfyUI 导出的 API 格式工作流。');
  }
  const plus = Object.values(workflow).find(n => n.class_type === 'AnimaPromptPlusClipEncode');
  const fields = ['quality_prompt', 'artist_tags', 'character_tags', 'clothing_tags', 'pose_tags', 'background_tags', 'extra_prompt'];
  if (plus && fields.every(key => !plus.inputs[key])) {
    const id = String(Math.max(0, ...Object.keys(workflow).map(Number).filter(Number.isFinite)) + 1);
    workflow[id] = {
      class_type: 'AnimaPromptComposer',
      inputs: {
        enable_artist: true, enable_character: true, enable_clothing: true,
        enable_background: true, enable_pose: true, character_detail: 'trigger',
        seed: -1, artist_count: 1, preview_collapsed: true, resolved_prompt: ''
      },
      _meta: { title: '网页 · 随机提示词' }
    };
    plus.inputs.extra_prompt = [id, 0];
  }
  if (randomize) {
    for (const node of Object.values(workflow)) {
      if (['KSampler', 'KSamplerAdvanced'].includes(node.class_type)) {
        node.inputs.seed = randomBytes(6).readUIntLE(0, 6);
      }
      if (node.class_type === 'AnimaPromptComposer') {
        node.inputs.seed = randomInt(0, 2147483647);
        node.inputs.resolved_prompt = '';
      }
    }
  }
  return workflow;
}

export function historyError(entry) {
  const messages = entry?.status?.messages || [];
  const failure = messages.find(([type]) => ['execution_error', 'execution_interrupted'].includes(type));
  if (failure) return failure[1]?.exception_message || 'ComfyUI 的生成任务已中断。';
  if (entry?.status?.status_str === 'error') return 'ComfyUI 生成失败，请查看 ComfyUI 日志。';
  return null;
}

export function historyImages(entry) {
  return Object.values(entry?.outputs || {}).flatMap(output => output.images || []).filter(image => image.type === 'output');
}
