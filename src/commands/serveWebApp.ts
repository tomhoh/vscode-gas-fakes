import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  resolveClaspProjectDeep,
  listSourceFiles,
  showClaspNotFoundError,
} from '../projectResolver';
import { output } from '../output';
import { setServing } from '../context';

interface RunningServer {
  child: ChildProcess;
  url: string;
  projectDir: string;
}

let active: RunningServer | undefined;

export function registerServeCommand(context: vscode.ExtensionContext): vscode.Disposable {
  const serve = vscode.commands.registerCommand('gasFakes.serveWebApp', async () => {
    const proj = await resolveClaspProjectDeep();
    if (!proj) {
      showClaspNotFoundError();
      return;
    }
    const sources = listSourceFiles(proj.rootDir);
    if (sources.length === 0) {
      vscode.window.showErrorMessage(`GAS Fakes: no .gs/.js sources in ${proj.rootDir}.`);
      return;
    }

    if (active) {
      output.appendLine(`Stopping previous server at ${active.url}`);
      try { active.child.kill('SIGTERM'); } catch {}
      active = undefined;
      setServing(false);
    }

    const cfg = vscode.workspace.getConfiguration('gasFakes');
    const node = cfg.get<string>('nodeBinary') || 'node';
    const runner = path.join(context.extensionPath, 'dist', 'runner-web.cjs');
    const payload = JSON.stringify({
      sources,
      rootDir: proj.rootDir,
      projectDir: proj.projectDir,
      port: 0,
      sandboxIframe: cfg.get<boolean>('sandboxIframe', true),
    });

    output.show(true);
    output.appendLine(`\n▶ serve web app — ${proj.projectDir}`);

    const child = spawn(node, [runner, payload], {
      cwd: proj.projectDir,
      env: process.env,
    });

    let urlReady = false;
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      output.append(text);
      if (!urlReady) {
        const match = text.match(/GASFAKES_LISTENING_AT (http:\/\/[^\s]+)/);
        if (match) {
          urlReady = true;
          const url = match[1];
          active = { child, url, projectDir: proj.projectDir };
          setServing(true);
          output.appendLine(`\n✓ open: ${url}`);
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => output.append(d.toString()));
    child.on('close', (code) => {
      output.appendLine(`\n— web server exited with ${code} —`);
      if (active && active.child === child) {
        active = undefined;
        setServing(false);
      }
    });
    child.on('error', (e) => {
      output.appendLine(`spawn error: ${e.message}`);
    });
  });

  const stop = vscode.commands.registerCommand('gasFakes.stopWebApp', () => {
    if (!active) {
      vscode.window.showInformationMessage('GAS Fakes: no web app server running.');
      return;
    }
    output.appendLine(`Stopping ${active.url}`);
    try { active.child.kill('SIGTERM'); } catch {}
    active = undefined;
    setServing(false);
  });

  return vscode.Disposable.from(serve, stop, {
    dispose: () => {
      if (active) {
        try { active.child.kill('SIGTERM'); } catch {}
        active = undefined;
        setServing(false);
      }
    },
  });
}
