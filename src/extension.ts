import * as vscode from 'vscode';
import { registerInitCommand } from './commands/init';
import { registerSignInCommand } from './commands/signIn';
import { registerRunCommand } from './commands/runFunction';
import { registerServeCommand } from './commands/serveWebApp';
import { registerDebugCommand } from './commands/debugFunction';
import { registerCodeLens } from './codeLens';
import { registerIntellisense } from './intellisense';
import { initStatusBar } from './statusBar';
import { initContextKeys } from './context';
import { output } from './output';

export function activate(context: vscode.ExtensionContext) {
  output.appendLine('GAS Fakes activated.');
  context.subscriptions.push(
    output,
    initContextKeys(context),
    registerInitCommand(context),
    registerSignInCommand(context),
    registerRunCommand(context),
    registerServeCommand(context),
    registerDebugCommand(context),
    registerCodeLens(context),
    registerIntellisense(context),
    initStatusBar(context),
  );
}

export function deactivate() {}
