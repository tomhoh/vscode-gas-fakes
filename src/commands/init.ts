import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveClaspProjectDeep,
  showClaspNotFoundError,
  isProjectInitialized,
  ClaspProject,
} from '../projectResolver';
import { setupWorkspaceTypes } from '../intellisense';
import { refreshInProject } from '../context';
import { output } from '../output';

// Pre-flight gate for Run/Debug/Serve: the runner requires @mcpher/gas-fakes
// from the project, so an uninitialized project would only fail later with a
// confusing module-not-found. Offer init instead of proceeding.
export async function ensureInitialized(proj: ClaspProject): Promise<boolean> {
  if (isProjectInitialized(proj.projectDir)) return true;
  const choice = await vscode.window.showInformationMessage(
    'GAS Fakes: this project is not initialized yet.',
    {
      modal: true,
      detail:
        '@mcpher/gas-fakes is not installed in this project. Initialize now? ' +
        'This runs npm install and gas-fakes init in a terminal.',
    },
    'Init Now',
  );
  if (choice === 'Init Now') {
    await vscode.commands.executeCommand('gasFakes.init');
    vscode.window.showInformationMessage(
      'GAS Fakes: initializing — when the terminal finishes, run your function again.',
    );
  }
  return false;
}

// The install runs in a terminal we can't await, so poll until the package
// lands to flip the 🛠 title-bar button off without an editor switch.
function watchForInitCompletion(projectDir: string): void {
  const started = Date.now();
  const timer = setInterval(() => {
    if (isProjectInitialized(projectDir)) {
      clearInterval(timer);
      refreshInProject();
      vscode.window.showInformationMessage(
        'GAS Fakes: project initialized — ▶ Run, 🐞 Debug and 🌐 Serve are ready. ' +
          'If the terminal is still asking setup questions, finish those to create your .env.',
      );
    } else if (Date.now() - started > 10 * 60 * 1000) {
      clearInterval(timer);
    }
  }, 3000);
}

export function registerInitCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('gasFakes.init', async () => {
    const proj = await resolveClaspProjectDeep();
    if (!proj) {
      showClaspNotFoundError();
      return;
    }
    // Use a private npm cache so a broken ~/.npm (root-owned files from an old
    // npm bug) doesn't sink the install. npm creates the dir if missing.
    const cacheDir = path.join(os.homedir(), '.cache', 'gas-fakes-npm');
    const cacheArg = `--cache "${cacheDir}"`;

    const hasPackageJson = fs.existsSync(path.join(proj.projectDir, 'package.json'));
    const steps: string[] = [];
    if (!hasPackageJson) steps.push(`npm init -y ${cacheArg}`);
    steps.push(`npm i ${cacheArg} -D @mcpher/gas-fakes`);
    // Default to ADC — the simpler auth path for consumer Google accounts.
    // Domain-Wide Delegation requires a service account + Workspace admin setup.
    steps.push('npx gas-fakes init --auth-type adc');

    const term = vscode.window.createTerminal({ name: 'GAS Fakes Init', cwd: proj.projectDir });
    term.show();
    term.sendText(steps.join(' && '));
    output.appendLine(`init in ${proj.projectDir}: ${steps.join(' && ')}`);
    if (!isProjectInitialized(proj.projectDir)) watchForInitCompletion(proj.projectDir);

    // Also set up Apps Script IntelliSense (jsconfig + bundled GAS types).
    // Quiet: an already-configured project shouldn't nag during init.
    await setupWorkspaceTypes(proj.projectDir, context.extensionPath, { quiet: true });
  });
}
