// Dev loop: Vite dev server for the renderer + rebuilt main process + Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

await import('./build-main.mjs');
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[quire] renderer at ${url}`);
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, QUIRE_DEV_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
