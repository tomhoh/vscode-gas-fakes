import * as vscode from 'vscode';
import { resolveClaspProject } from './projectResolver';

export function initStatusBar(_context: vscode.ExtensionContext): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'gasFakes.runFunction';

  const refresh = () => {
    const proj = resolveClaspProject();
    if (proj) {
      const tag = proj.scriptId ? proj.scriptId.slice(0, 8) + '…' : 'ready';
      item.text = `$(beaker) GAS Fakes: ${tag}`;
      item.tooltip = `Click to run a function from ${proj.projectDir}`;
      item.show();
    } else {
      item.hide();
    }
  };

  refresh();
  const watcher = vscode.workspace.createFileSystemWatcher('**/.clasp.json');
  const subs: vscode.Disposable[] = [
    item,
    watcher,
    watcher.onDidCreate(refresh),
    watcher.onDidDelete(refresh),
    watcher.onDidChange(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
  ];
  return vscode.Disposable.from(...subs);
}
