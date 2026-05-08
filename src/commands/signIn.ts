import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { resolveClaspProjectDeep } from '../projectResolver';
import { output } from '../output';

const exec = promisify(execFile);

const BASE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/cloud-platform',
];

async function hasGcloud(): Promise<boolean> {
  try {
    await exec('gcloud', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function readManifestScopes(projectDir: string): string[] {
  try {
    const manifestPath = path.join(projectDir, 'appsscript.json');
    if (!fs.existsSync(manifestPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Array.isArray(parsed.oauthScopes) ? parsed.oauthScopes : [];
  } catch {
    return [];
  }
}

// Read CLIENT_CREDENTIAL_FILE from the project's .env, if present.
// This is the Desktop OAuth client JSON the user downloaded from GCP Console.
// gcloud needs it to bypass the default-client block on Workspace scopes.
function readClientCredentialFile(projectDir: string): string | undefined {
  try {
    const envPath = path.join(projectDir, '.env');
    if (!fs.existsSync(envPath)) return undefined;
    const text = fs.readFileSync(envPath, 'utf8');
    const m = text.match(/^\s*CLIENT_CREDENTIAL_FILE\s*=\s*"([^"\n]+)"/m);
    if (!m) return undefined;
    const p = m[1];
    if (!p.trim()) return undefined;
    return p.startsWith('~/') ? path.join(require('os').homedir(), p.slice(2)) : p;
  } catch {
    return undefined;
  }
}

export function registerSignInCommand(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('gasFakes.signIn', async () => {
    if (!(await hasGcloud())) {
      const choice = await vscode.window.showErrorMessage(
        'GAS Fakes: gcloud CLI not found on PATH. Install Google Cloud SDK to sign in.',
        'Install via Homebrew',
        'Open install docs',
      );
      if (choice === 'Install via Homebrew') {
        const term = vscode.window.createTerminal({ name: 'gcloud install' });
        term.show();
        term.sendText('brew install --cask google-cloud-sdk');
      } else if (choice === 'Open install docs') {
        vscode.env.openExternal(vscode.Uri.parse('https://cloud.google.com/sdk/docs/install'));
      }
      return;
    }

    const proj = await resolveClaspProjectDeep();
    const manifestScopes = proj ? readManifestScopes(proj.projectDir) : [];
    const clientFile = proj ? readClientCredentialFile(proj.projectDir) : undefined;
    // De-dupe and union base + manifest scopes.
    const allScopes = Array.from(new Set([...BASE_SCOPES, ...manifestScopes]));

    const args = ['gcloud', 'auth', 'application-default', 'login'];
    args.push(`--scopes=${allScopes.join(',')}`);
    if (clientFile) args.push(`--client-id-file="${clientFile}"`);

    output.appendLine(
      `signIn: ${manifestScopes.length} scope(s) from appsscript.json + ${BASE_SCOPES.length} default = ${allScopes.length} total` +
        (clientFile ? `\nsignIn: using custom OAuth client at ${clientFile}` : ''),
    );

    const term = vscode.window.createTerminal({
      name: 'GAS Fakes Auth',
      cwd: proj?.projectDir,
    });
    term.show();
    term.sendText(args.join(' '));
  });
}
