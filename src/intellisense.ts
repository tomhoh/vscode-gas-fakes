import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GAS_DOCS } from './gasDocs';
import { resolveClaspProject } from './projectResolver';
import { output } from './output';

// IntelliSense support for Apps Script projects:
//  - hover docs (description + link to Google reference) for GAS services/methods
//  - one-time workspace setup that copies the bundled @types/google-apps-script
//    into the project and writes a jsconfig.json so tsserver picks them up

class GasHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    if (!vscode.workspace.getConfiguration('gasFakes').get<boolean>('hoverDocs.enabled', true)) {
      return null;
    }
    if (!isGasContext(document)) return null;

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    const docInfo = GAS_DOCS[word];
    if (!docInfo) return null;

    // Method-style entries (lowercase first letter) only make sense after a
    // dot — `sheet.getRange(...)` — otherwise plain identifiers like a local
    // `create` or `get` would light up with unrelated GAS docs.
    if (/^[a-z]/.test(word)) {
      const before = wordRange.start.character - 1;
      if (before < 0 || document.lineAt(wordRange.start.line).text[before] !== '.') {
        return null;
      }
    }

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.appendMarkdown(`**${docInfo.name}**\n\n`);
    markdown.appendMarkdown(`${docInfo.description}\n\n`);
    markdown.appendMarkdown(`[📚 View Google Documentation](${docInfo.link})\n\n`);
    if (docInfo.example) {
      markdown.appendCodeblock(docInfo.example, 'javascript');
    }
    return new vscode.Hover(markdown, wordRange);
  }
}

// .gs files are always Apps Script; .js files only count inside a clasp
// project's rootDir (mirrors the title-bar visibility rule in context.ts).
function isGasContext(document: vscode.TextDocument): boolean {
  if (document.fileName.endsWith('.gs')) return true;
  if (!/\.js$/i.test(document.fileName)) return false;
  const proj = resolveClaspProject(document.uri);
  return !!proj && document.fileName.startsWith(proj.rootDir);
}

// The jsconfig + node_modules/@types copy lands in the clasp project dir when
// there is one, else the document's workspace folder.
function resolveSetupTarget(docUri?: vscode.Uri): string | undefined {
  const proj = resolveClaspProject(docUri);
  if (proj) return proj.projectDir;
  if (docUri) {
    const folder = vscode.workspace.getWorkspaceFolder(docUri);
    if (folder) return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function setupWorkspaceTypes(
  targetDir: string,
  extensionPath: string,
  opts: { quiet?: boolean } = {},
): Promise<boolean> {
  if (
    fs.existsSync(path.join(targetDir, 'jsconfig.json')) ||
    fs.existsSync(path.join(targetDir, 'tsconfig.json'))
  ) {
    output.appendLine(`intellisense: ${targetDir} already has a js/tsconfig — skipping setup`);
    if (!opts.quiet) {
      vscode.window.showInformationMessage(
        'GAS Fakes: workspace already configured (existing jsconfig/tsconfig found).',
      );
    }
    return true;
  }

  const bundledTypes = path.join(extensionPath, 'typedefs', 'google-apps-script');
  if (!fs.existsSync(bundledTypes)) {
    vscode.window.showErrorMessage(
      'GAS Fakes: bundled type definitions not found — try reinstalling the extension.',
    );
    return false;
  }

  try {
    fs.cpSync(bundledTypes, path.join(targetDir, 'node_modules', '@types', 'google-apps-script'), {
      recursive: true,
    });
    const jsconfig = {
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020'],
        checkJs: false,
      },
      include: ['**/*.js', '**/*.gs'],
      exclude: ['node_modules'],
      typeAcquisition: {
        include: ['google-apps-script'],
      },
    };
    fs.writeFileSync(path.join(targetDir, 'jsconfig.json'), JSON.stringify(jsconfig, null, 2));
    output.appendLine(`intellisense: wrote jsconfig.json and GAS types in ${targetDir}`);

    // Quiet mode (init flow) skips the reload prompt — reloading the window
    // would kill the npm install still running in the init terminal.
    if (!opts.quiet) {
      const choice = await vscode.window.showInformationMessage(
        'GAS Fakes: Apps Script IntelliSense configured. Reload the window to activate it.',
        'Reload Now',
        'Later',
      );
      if (choice === 'Reload Now') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }
    return true;
  } catch (err) {
    const msg = `failed to set up GAS types in ${targetDir}: ${err}`;
    output.appendLine(`intellisense: ${msg}`);
    vscode.window.showErrorMessage(`GAS Fakes: ${msg}`);
    return false;
  }
}

// Asked at most once per project dir; "No" leaves the door open for next time.
async function maybePromptSetup(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<void> {
  if (!document.fileName.endsWith('.gs')) return;
  const targetDir = resolveSetupTarget(document.uri);
  if (!targetDir) return;

  const stateKey = `gasFakes.intellisense.setup.${targetDir}`;
  const state = context.workspaceState.get<string>(stateKey);
  if (state === 'completed' || state === 'declined') return;

  if (
    fs.existsSync(path.join(targetDir, 'jsconfig.json')) ||
    fs.existsSync(path.join(targetDir, 'tsconfig.json'))
  ) {
    await context.workspaceState.update(stateKey, 'completed');
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    'GAS Fakes can set up Apps Script IntelliSense for this project (creates jsconfig.json and copies type definitions). Set up now?',
    'Yes',
    'No',
    "Don't Ask Again",
  );
  if (choice === 'Yes') {
    if (await setupWorkspaceTypes(targetDir, context.extensionPath)) {
      await context.workspaceState.update(stateKey, 'completed');
    }
  } else if (choice === "Don't Ask Again") {
    await context.workspaceState.update(stateKey, 'declined');
    vscode.window.showInformationMessage(
      'You can set it up later with "GAS Fakes: Setup IntelliSense" from the command palette.',
    );
  }
}

export function registerIntellisense(context: vscode.ExtensionContext): vscode.Disposable {
  const subs: vscode.Disposable[] = [
    vscode.languages.registerHoverProvider(
      ['javascript', 'javascriptreact'],
      new GasHoverProvider(),
    ),
    vscode.commands.registerCommand('gasFakes.setupIntellisense', async () => {
      const targetDir = resolveSetupTarget(vscode.window.activeTextEditor?.document.uri);
      if (!targetDir) {
        vscode.window.showWarningMessage('GAS Fakes: no workspace folder open.');
        return;
      }
      if (await setupWorkspaceTypes(targetDir, context.extensionPath)) {
        await context.workspaceState.update(
          `gasFakes.intellisense.setup.${targetDir}`,
          'completed',
        );
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => void maybePromptSetup(context, doc)),
  ];

  for (const doc of vscode.workspace.textDocuments) {
    void maybePromptSetup(context, doc);
  }

  return vscode.Disposable.from(...subs);
}
