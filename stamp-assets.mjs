import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Fresh HTML points to new asset URLs whenever the contents change.
const publicDir = new URL('./public/', import.meta.url);
const index = new URL('index.html', publicDir);
let html = await readFile(index, 'utf8');
const assets = [
  ['style.css', /(href="\.\/style\.css)(?:\?[^\"]*)?"/],
  ['app.js', /(src="\.\/app\.js)(?:\?[^\"]*)?"/],
  ['remotion-player.js', /(src="\.\/remotion-player\.js)(?:\?[^\"]*)?"/]
];
for (const [name, pattern] of assets) {
  const bytes = await readFile(new URL(name, publicDir));
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  if (!pattern.test(html)) throw new Error(`Missing local asset reference: ${name}`);
  html = html.replace(pattern, `$1?v=${version}"`);
  console.log(`${name}: ${version}`);
}
await writeFile(fileURLToPath(index), html, 'utf8');
