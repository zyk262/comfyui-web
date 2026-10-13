import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

await build({
  entryPoints:[fileURLToPath(new URL('./src/player.tsx',import.meta.url))],
  outfile:fileURLToPath(new URL('../public/remotion-player.js',import.meta.url)),
  bundle:true, minify:true, format:'iife', target:['es2020'],
  define:{'process.env.NODE_ENV':'"production"'}, legalComments:'eof',
});
console.log('Built self-contained Remotion Player for GitHub Pages');
