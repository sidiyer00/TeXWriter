import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    {
      name: 'texwriter-csp',
      apply: 'build',
      transformIndexHtml: (html: string) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: texwriter-file:; font-src 'self' data:; connect-src 'self' texwriter-file:; worker-src 'self' blob:">`),
    },
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5183, strictPort: true },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
