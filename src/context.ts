import * as vscode from 'vscode';
import { resolveClaspProject, isProjectInitialized } from './projectResolver';

const IN_PROJECT = 'gasFakes.inProject';
const INITIALIZED = 'gasFakes.initialized';
const SERVING = 'gasFakes.serving';

let lastInProject = false;
let lastInitialized: boolean | undefined;

export function refreshInProject() {
  const editor = vscode.window.activeTextEditor;
  let inProject = false;
  let initialized = false;
  if (editor && /\.(gs|js)$/i.test(editor.document.fileName)) {
    const proj = resolveClaspProject(editor.document.uri);
    if (proj && editor.document.uri.fsPath.startsWith(proj.rootDir)) {
      inProject = true;
      initialized = isProjectInitialized(proj.projectDir);
    }
  }
  if (inProject !== lastInProject) {
    lastInProject = inProject;
    vscode.commands.executeCommand('setContext', IN_PROJECT, inProject);
  }
  if (initialized !== lastInitialized) {
    lastInitialized = initialized;
    vscode.commands.executeCommand('setContext', INITIALIZED, initialized);
  }
}

export function initContextKeys(_context: vscode.ExtensionContext): vscode.Disposable {
  refreshInProject();
  vscode.commands.executeCommand('setContext', SERVING, false);

  const subs: vscode.Disposable[] = [
    vscode.window.onDidChangeActiveTextEditor(() => refreshInProject()),
    // .clasp.json appearing/disappearing should re-evaluate.
    (() => {
      const w = vscode.workspace.createFileSystemWatcher('**/.clasp.json');
      w.onDidCreate(() => refreshInProject());
      w.onDidDelete(() => refreshInProject());
      return w;
    })(),
  ];
  return vscode.Disposable.from(...subs);
}

export function setServing(serving: boolean) {
  vscode.commands.executeCommand('setContext', SERVING, serving);
}
