/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

const buildSha = process.env.VITE_BUILD_SHA || 'dev';
const buildTime = new Date().toISOString();

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'generate-version-json',
      writeBundle(options) {
        const outDir = options.dir || 'dist';
        writeFileSync(
          resolve(outDir, 'version.json'),
          JSON.stringify({ sha: buildSha, built: buildTime }, null, 2),
        );
      },
    },
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../../packages/shared-types/src'),
      '@sazinka/countries': resolve(__dirname, '../../packages/countries/src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
