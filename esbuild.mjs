import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

const targets = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
  },
  {
    // Web-app runner: bundle busboy and friends, but always require @mcpher/gas-fakes
    // from the user's project at runtime so versions match their CI.
    ...shared,
    entryPoints: ['runner/runner-web.cjs'],
    outfile: 'dist/runner-web.cjs',
    external: ['@mcpher/gas-fakes'],
  },
  {
    ...shared,
    entryPoints: ['runner/runner.cjs'],
    outfile: 'dist/runner.cjs',
    external: ['@mcpher/gas-fakes'],
  },
];

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  for (const t of targets) {
    const ctx = await esbuild.context(t);
    await ctx.rebuild();
    await ctx.dispose();
  }
}
