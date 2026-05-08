import * as vscode from 'vscode';
import * as path from 'path';
import {
  resolveClaspProjectDeep,
  listSourceFiles,
  showClaspNotFoundError,
} from '../projectResolver';
import { indexFunctions } from '../functionIndexer';
import { output } from '../output';

export function registerDebugCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand(
    'gasFakes.debugFunction',
    async (name?: string, uri?: vscode.Uri) => {
      const proj = await resolveClaspProjectDeep(uri);
      if (!proj) {
        showClaspNotFoundError();
        return;
      }
      const sources = listSourceFiles(proj.rootDir);
      if (sources.length === 0) {
        vscode.window.showErrorMessage(`GAS Fakes: no .gs/.js sources in ${proj.rootDir}.`);
        return;
      }

      let target = name;
      if (!target) {
        const fns = indexFunctions(sources);
        const pick = await vscode.window.showQuickPick(
          fns.map((f) => ({
            label: f.name,
            description: `${path.basename(f.file)}:${f.line}`,
            fn: f,
          })),
          { placeHolder: 'Select a function to debug' },
        );
        if (!pick) return;
        target = pick.fn.name;
      }

      const runner = path.join(context.extensionPath, 'dist', 'runner.cjs');
      const payload = JSON.stringify({
        sources,
        target,
        projectDir: proj.projectDir,
        rootDir: proj.rootDir,
      });

      output.appendLine(`\n🐞 debug ${target}() — ${proj.projectDir}`);

      const folder = vscode.workspace.workspaceFolders?.find((f) =>
        proj.projectDir.startsWith(f.uri.fsPath),
      );

      // Built-in node debugger. vm.Script preserves filenames so breakpoints in
      // the user's .gs files Just Work.
      const ok = await vscode.debug.startDebugging(folder, {
        type: 'node',
        request: 'launch',
        name: `gas-fakes: ${target}`,
        program: runner,
        args: [payload],
        cwd: proj.projectDir,
        console: 'integratedTerminal',
        stopOnEntry: false,
        skipFiles: [
          '<node_internals>/**',
          '**/node_modules/**',
        ],
        sourceMaps: true,
        outputCapture: 'std',
      });

      if (!ok) {
        vscode.window.showErrorMessage('GAS Fakes: failed to start debug session.');
      }
    },
  );
}
