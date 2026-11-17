import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src/config',
  base: './',
  build: {
    outDir: '../../dist/config',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/config/index.html'),
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: {
    port: 3001,
    cors: true,
  },
  plugins: [],
});
