import * as vscode from 'vscode';
import { resolveClaspProject } from './projectResolver';
import { indexFunctions } from './functionIndexer';

export class GasFakesCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  refresh() {
    this._onDidChange.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('gasFakes');
    if (cfg.get<boolean>('codeLens.enabled', true) === false) return [];
    if (!/\.(gs|js)$/i.test(doc.fileName)) return [];

    const proj = resolveClaspProject(doc.uri);
    if (!proj) return [];
    if (!doc.uri.fsPath.startsWith(proj.rootDir)) return [];

    const fns = indexFunctions([doc.uri.fsPath]);
    const lenses: vscode.CodeLens[] = [];
    for (const fn of fns) {
      const range = new vscode.Range(fn.line - 1, 0, fn.line - 1, 0);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '▶ Run',
          command: 'gasFakes.runFunctionByName',
          arguments: [fn.name, doc.uri],
          tooltip: `Run ${fn.name}() under @mcpher/gas-fakes`,
        }),
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: '🐞 Debug',
          command: 'gasFakes.debugFunction',
          arguments: [fn.name, doc.uri],
          tooltip: `Debug ${fn.name}() — set breakpoints in this file`,
        }),
      );
    }
    return lenses;
  }
}

export function registerCodeLens(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = new GasFakesCodeLensProvider();
  const selectors: vscode.DocumentSelector = [
    { language: 'javascript', scheme: 'file' },
    { pattern: '**/*.gs', scheme: 'file' },
  ];
  const reg = vscode.languages.registerCodeLensProvider(selectors, provider);

  // Re-evaluate on file save so newly-added functions show up immediately.
  const onSave = vscode.workspace.onDidSaveTextDocument(() => provider.refresh());
  // And when configuration changes (e.g. codeLens.enabled toggled).
  const onCfg = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('gasFakes')) provider.refresh();
  });

  return vscode.Disposable.from(reg, onSave, onCfg);
}
