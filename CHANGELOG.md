# Changelog

## 0.3.0

### Added
- **Apps Script IntelliSense** (integrated from [gas-intellisense](https://github.com/apenara/gas-intellisense), MIT) —
  - **Bundled type definitions** — `@types/google-apps-script` v2.0.7 ships inside the extension. **GAS Fakes: Setup IntelliSense** (or the one-time prompt when a `.gs` file opens) copies them into the project's `node_modules/@types` and writes a `jsconfig.json`, so tsserver autocompletes `SpreadsheetApp.`, `GmailApp.`, and the other 30+ services with no npm setup. Works offline.
  - **28 code snippets** — `onOpen`, `onEdit`, `doGet`, `doPost`, `getValues`, `appendRow`, `sendEmail`, `tryCatch`, and friends. Available in any `.gs`/`.js` file.
  - **Hover docs** — hover over GAS services and common methods to see a description, an example, and a link to the official Google reference. Method names (e.g. `getRange`) only match after a dot, so unrelated identifiers don't light up. Toggleable via `gasFakes.hoverDocs.enabled`.
- **Init** now also configures IntelliSense (jsconfig + bundled types) in the same pass.
- Extension also activates in workspaces containing `.gs` files (not just clasp projects), so IntelliSense works before you've set up clasp.

## 0.2.0

### Added
- **Serve Web App** — `doGet(e)` rendered into a sandboxed `<iframe>`, with a postMessage bridge that mirrors how Apps Script's userContent iframe talks to its parent in production. `google.script.run.foo(...)` calls flow through the bridge to a Node child process.
- **File/Blob uploads** through `google.script.run` — `File`/`Blob` args are detected client-side, transferred via structured clone, and reconstructed server-side as GAS-Blob-shaped objects (`getBytes`, `getName`, `getContentType`, `getDataAsString`). Multipart bodies handled via `busboy`.
- **`HtmlService` shim** — `createHtmlOutput`, `createHtmlOutputFromFile`, `createTemplate`, `createTemplateFromFile`, scriptlets (`<?= ?>`, `<?!= ?>`, `<? ?>`), and the chainable methods (`setTitle`, `addMetaTag`, `setFaviconUrl`, etc.). Loaded by both runners so functions that touch `HtmlService` from `Run` no longer crash.
- **`ScriptApp.getService().getUrl()` stub** — returns the local server URL.
- **CodeLens** — `▶ Run` and `🐞 Debug` lenses above each zero-arg top-level function in `.gs`/`.js` files inside a clasp project. Toggleable via `gasFakes.codeLens.enabled`.
- **Debug command** — clicks `🐞` to launch Node's debugger pointed at the runner; breakpoints in `.gs` files Just Work because both runners now load sources via `vm.Script` with original filenames.
- **Editor title-bar buttons** — `▶ 🐞 🌐 ⏹` appear automatically on `.gs`/`.js` files in clasp projects. Driven by `gasFakes.inProject` / `gasFakes.serving` context keys.
- **`.gs` ↔ JavaScript association** via `contributes.languages` — syntax highlighting + IntelliSense.
- **Custom OAuth client support** — Sign In auto-reads `CLIENT_CREDENTIAL_FILE` from the project's `.env` and passes `--client-id-file` to `gcloud`. Required for accessing Workspace scopes (Sheets/Drive) since Google blocked the default gcloud client.
- **Manifest scope auto-merging** — Sign In reads `oauthScopes` from `appsscript.json` and unions them with base scopes for the `gcloud` login command.
- **`gasFakes.sandboxIframe` setting** — `true` (default) for production-fidelity sandbox; `false` for direct fetch (simpler, less faithful).
- **Status-bar item** showing the active clasp project, click-to-run.

### Changed
- **Init** now defaults to `--auth-type adc` (consumer-account path) and runs `npm i` against a private cache (`~/.cache/gas-fakes-npm`) so a broken `~/.npm` doesn't sink the install.
- **Project resolver** now tries every workspace folder, with a `findFiles('**/.clasp.json')` fallback. Empty-string `rootDir` in `.clasp.json` is normalized correctly.
- **Function runner** prints a one-line summary (`HtmlOutput  109507 chars  (Title)`) instead of dumping a serialized blob when the result has `.getContent()`.
- **`google.script.url.getLocation`** now returns `parameters` arrays correctly (not just empty objects).

### Fixed
- `ReferenceError: HtmlService is not defined` when running a `doGet` via the function runner — shim now installed in both runners.
- `localStorage` SecurityError in the served web app — iframe sandbox now includes `allow-same-origin`.
- `Sign In` failed silently with a confusing terminal message when `gcloud` wasn't installed — popup now offers Homebrew install or opens install docs.

## 0.1.0 — initial

- Detect clasp projects via `.clasp.json`.
- Command: **GAS Fakes: Init in This Project** (installs `@mcpher/gas-fakes`, runs `gas-fakes init`).
- Command: **GAS Fakes: Sign In (ADC)** (`gcloud auth application-default login`).
- Command: **GAS Fakes: Run Function** — quick-pick of zero-arg top-level functions from all `.gs`/`.js` files in `rootDir`, runs the chosen one through `@mcpher/gas-fakes` and streams output.
- Status bar item showing the active clasp project.
