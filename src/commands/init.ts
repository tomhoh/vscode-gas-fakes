import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveClaspProjectDeep, showClaspNotFoundError } from '../projectResolver';
import { setupWorkspaceTypes } from '../intellisense';
import { output } from '../output';

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

    // Also set up Apps Script IntelliSense (jsconfig + bundled GAS types).
    // Quiet: an already-configured project shouldn't nag during init.
    await setupWorkspaceTypes(proj.projectDir, context.extensionPath, { quiet: true });
  });
}
