'use strict';

// Spawned by the VS Code extension. argv[2] is a JSON payload:
//   { sources: string[], target: string, projectDir: string, rootDir: string }
// Loads @mcpher/gas-fakes from the project's node_modules, installs the
// HtmlService shim (so functions that touch HtmlService don't crash here),
// loads user sources at global scope, then invokes global[target]() and
// prints its result.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = JSON.parse(process.argv[2] || '{}');
const { sources, target, projectDir, rootDir } = args;

if (!projectDir || !Array.isArray(sources) || !target) {
  console.error('runner: missing projectDir / sources / target');
  process.exit(2);
}

let gasFakesPath;
try {
  gasFakesPath = require.resolve('@mcpher/gas-fakes', { paths: [projectDir] });
} catch {
  console.error(
    'runner: cannot find @mcpher/gas-fakes in this project.\n' +
      'Run "GAS Fakes: Init in This Project" or `npm i -D @mcpher/gas-fakes`.',
  );
  process.exit(2);
}
require(gasFakesPath);

// Install our HtmlService shim AFTER gas-fakes has loaded so we win over any
// throwing stub it might have set.
require('./_htmlservice.cjs').install(rootDir || projectDir);

// Load each source as its own vm.Script so stack traces and the debugger see
// the real .gs/.js file (not a concatenated buffer). Top-level `function foo()`
// declarations still land on globalThis — matches Apps Script's one namespace.
for (const f of sources) {
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInThisContext();
  } catch (err) {
    console.error(`runner: error loading ${path.relative(projectDir, f)}`);
    console.error((err && err.stack) || err);
    process.exit(1);
  }
}

const fn = global[target];
if (typeof fn !== 'function') {
  console.error(`runner: function "${target}" not found at global scope`);
  process.exit(2);
}

Promise.resolve()
  .then(() => fn())
  .then((result) => {
    if (typeof result === 'undefined') return;
    // HtmlOutput / TextOutput / anything with .getContent() — print a summary
    // instead of dumping the whole serialized object. Suggest Serve Web App.
    if (result && typeof result.getContent === 'function') {
      const content = String(result.getContent());
      const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i);
      const title = (result._title) || (titleMatch && titleMatch[1]) || null;
      process.stdout.write(
        `${result.constructor && result.constructor.name || 'Output'}` +
          `  ${content.length} chars` +
          (title ? `  (${title})` : '') +
          '\n',
      );
      process.stdout.write(
        'Tip: run "GAS Fakes: Serve Web App" to preview this in a browser.\n',
      );
      return;
    }
    try {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch {
      process.stdout.write(String(result) + '\n');
    }
  })
  .catch((err) => {
    console.error((err && err.stack) || err);
    process.exitCode = 1;
  });
