// Builds the browser extension into dist/extension (load it unpacked in Chrome/Edge/Brave).
import { build } from 'vite';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/extension');
mkdirSync(out, { recursive: true });

// 1) avatar page (same renderer as desktop, ?mode=web)
await build({
  configFile: false,
  root: resolve(root, 'src/avatar'),
  base: './',
  logLevel: 'warn',
  build: { outDir: resolve(out, 'avatar'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});

// 2) content script + service worker (single-file IIFE bundles)
for (const [entry, name] of [
  ['src/extension/content.ts', 'content'],
  ['src/extension/background.ts', 'background'],
]) {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: out,
      emptyOutDir: false,
      lib: { entry: resolve(root, entry), formats: ['iife'], name: `plai_${name}`, fileName: () => `${name}.js` },
      minify: true,
    },
  });
}

// 3) static files
cpSync(resolve(root, 'src/extension/static'), out, { recursive: true });
const icon = resolve(root, 'assets/icon.png');
if (existsSync(icon)) cpSync(icon, resolve(out, 'icon.png'));
console.log('Extension built in', out);
