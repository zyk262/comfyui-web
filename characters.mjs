export const QUALITY_PROMPT = 'masterpiece, best quality, score_7, safe, very aesthetic, ultra detailed, pale skin, fair skin, high contrast, ';

export function parseCharacters(text) {
  const characters = [];
  const names = new Set();
  for (const [index, line] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!match || !match[2].trim()) throw new Error(`角色.txt 第 ${index + 1} 行需要“名称：提示词”。`);
    const name = match[1].trim();
    if (names.has(name)) throw new Error(`角色.txt 中的角色名称重复：${name}`);
    names.add(name);
    characters.push({ id: name, name, prompt: match[2].trim() });
  }
  if (!characters.length) throw new Error('角色.txt 中没有可用角色。');
  return characters;
}
