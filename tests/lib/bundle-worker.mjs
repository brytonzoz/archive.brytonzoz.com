import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load Worker modules with the same embedded binary assets Wrangler supplies. */
export async function bundleWorker(entry) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), 'shipped-worker-test-'));
  const outfile = path.join(dir, 'worker.cjs');
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      loader: { '.wasm': 'binary', '.ttf': 'binary' },
      logLevel: 'silent',
    });
    return createRequire(import.meta.url)(outfile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
