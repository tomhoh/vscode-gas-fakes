import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { output } from './output';

export interface ClaspProject {
  projectDir: string;
  rootDir: string;
  scriptId?: string;
}

function walkUpForClasp(start: string): ClaspProject | undefined {
  let dir: string;
  try {
    dir = fs.statSync(start).isDirectory() ? start : path.dirname(start);
  } catch {
    return undefined;
  }
  while (true) {
    const candidate = path.join(dir, '.clasp.json');
    if (fs.existsSync(candidate)) {
      let parsed: { rootDir?: string; scriptId?: string } = {};
      try {
        parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch {
        // tolerate malformed .clasp.json
      }
      const rootDir =
        parsed.rootDir && parsed.rootDir.trim().length > 0
          ? path.resolve(dir, parsed.rootDir)
          : dir;
      return { projectDir: dir, rootDir, scriptId: parsed.scriptId };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function resolveClaspProject(startUri?: vscode.Uri): ClaspProject | undefined {
  const candidates: string[] = [];
  if (startUri?.fsPath) candidates.push(startUri.fsPath);
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (active) candidates.push(active);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(folder.uri.fsPath);
  }

  for (const start of candidates) {
    const found = walkUpForClasp(start);
    if (found) return found;
  }

  output.appendLine(
    `resolveClaspProject: no .clasp.json found. Tried: ${
      candidates.length ? candidates.join(', ') : '(no candidates — no editor or workspace folder)'
    }`,
  );
  return undefined;
}

export async function resolveClaspProjectDeep(
  startUri?: vscode.Uri,
): Promise<ClaspProject | undefined> {
  const direct = resolveClaspProject(startUri);
  if (direct) return direct;
  const hits = await vscode.workspace.findFiles('**/.clasp.json', '**/node_modules/**', 1);
  if (hits.length === 0) return undefined;
  return walkUpForClasp(hits[0].fsPath);
}

export function showClaspNotFoundError(): void {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const detail = [
    folders.length ? `folders=[${folders.join(', ')}]` : 'folders=(none)',
    active ? `active=${active}` : 'active=(none)',
  ].join('  ');
  const msg = `GAS Fakes: no .clasp.json found. ${detail}`;
  vscode.window.showErrorMessage(msg);
  output.appendLine(msg);
  output.show(true);
}

// "Initialized" = the init command's npm install has landed. The runner
// requires @mcpher/gas-fakes from the project, so this is the gate for
// Run/Debug/Serve actually working.
export function isProjectInitialized(projectDir: string): boolean {
  return fs.existsSync(
    path.join(projectDir, 'node_modules', '@mcpher', 'gas-fakes', 'package.json'),
  );
}

export function listSourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(gs|js)$/.test(entry.name)) {
      out.push(path.join(rootDir, entry.name));
    }
  }
  return out.sort();
}
