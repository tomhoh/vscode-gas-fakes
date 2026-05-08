import * as fs from 'fs';
import * as vscode from 'vscode';

export interface RunnableFunction {
  name: string;
  file: string;
  line: number;
}

const DEFAULT_PATTERN = '^function\\s+([a-zA-Z_$][\\w$]*)\\s*\\(\\s*\\)\\s*\\{';

export function indexFunctions(files: string[]): RunnableFunction[] {
  const config = vscode.workspace.getConfiguration('gasFakes');
  const patternStr = config.get<string>('entryFunctionPattern') || DEFAULT_PATTERN;

  const result: RunnableFunction[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const pattern = new RegExp(patternStr, 'gm');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      result.push({ name: m[1], file, line });
    }
  }
  return result;
}
