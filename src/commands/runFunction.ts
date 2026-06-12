import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  resolveClaspProjectDeep,
  listSourceFiles,
  showClaspNotFoundError,
  ClaspProject,
} from '../projectResolver';
import { indexFunctions } from '../functionIndexer';
import { ensureInitialized } from './init';
import { output } from '../output';

async function gatherSources(uri?: vscode.Uri): Promise<{ proj: ClaspProject; sources: string[] } | undefined> {
  const proj = await resolveClaspProjectDeep(uri);
  if (!proj) {
    showClaspNotFoundError();
    return undefined;
  }
  if (!(await ensureInitialized(proj))) return undefined;
  const sources = listSourceFiles(proj.rootDir);
  if (sources.length === 0) {
    vscode.window.showErrorMessage(`GAS Fakes: no .gs/.js sources in ${proj.rootDir}.`);
    return undefined;
  }
  return { proj, sources };
}

function spawnRunner(
  context: vscode.ExtensionContext,
  proj: ClaspProject,
  sources: string[],
  target: string,
) {
  const node =
    vscode.workspace.getConfiguration('gasFakes').get<string>('nodeBinary') || 'node';
  const runner = path.join(context.extensionPath, 'dist', 'runner.cjs');
  const payload = JSON.stringify({
    sources,
    target,
    projectDir: proj.projectDir,
    rootDir: proj.rootDir,
  });

  output.show(true);
  output.appendLine(`\n▶ ${target}() — ${proj.projectDir}`);

  const child = spawn(node, [runner, payload], {
    cwd: proj.projectDir,
    env: process.env,
  });
  child.stdout.on('data', (d: Buffer) => output.append(d.toString()));
  child.stderr.on('data', (d: Buffer) => output.append(d.toString()));
  child.on('close', (code) => output.appendLine(`\n— exited with ${code} —`));
  child.on('error', (e) => output.appendLine(`spawn error: ${e.message}`));
}

export function registerRunCommand(context: vscode.ExtensionContext): vscode.Disposable {
  // Picker variant — invoked from the command palette / status bar.
  const pickAndRun = vscode.commands.registerCommand('gasFakes.runFunction', async () => {
    const ctx = await gatherSources();
    if (!ctx) return;
    const fns = indexFunctions(ctx.sources);
    if (fns.length === 0) {
      vscode.window.showErrorMessage('GAS Fakes: no zero-argument top-level functions found.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      fns.map((f) => ({
        label: f.name,
        description: `${path.basename(f.file)}:${f.line}`,
        fn: f,
      })),
      { placeHolder: 'Select a function to run' },
    );
    if (!pick) return;
    spawnRunner(context, ctx.proj, ctx.sources, pick.fn.name);
  });

  // CodeLens variant — invoked with the function name already known.
  const runByName = vscode.commands.registerCommand(
    'gasFakes.runFunctionByName',
    async (name: string, uri?: vscode.Uri) => {
      if (!name) return;
      const ctx = await gatherSources(uri);
      if (!ctx) return;
      spawnRunner(context, ctx.proj, ctx.sources, name);
    },
  );

  return vscode.Disposable.from(pickAndRun, runByName);
}
