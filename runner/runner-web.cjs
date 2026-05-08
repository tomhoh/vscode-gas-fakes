'use strict';

// Spawned by the VS Code "Serve Web App" command. argv[2] is a JSON payload:
//   { sources: string[], rootDir: string, projectDir: string, port?: number }
// Loads @mcpher/gas-fakes, evals user sources at global scope, installs an
// HtmlService shim that handles createHtmlOutputFromFile / createTemplateFromFile
// with scriptlet processing, and serves doGet over HTTP. POST /_gasfakes/run/:fn
// invokes server-side functions for google.script.run.

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const vm = require('vm');
const Busboy = require('busboy');

const args = JSON.parse(process.argv[2] || '{}');
const { sources, rootDir, projectDir, port = 0, sandboxIframe = true } = args;

if (!projectDir || !rootDir || !Array.isArray(sources)) {
  console.error('runner-web: missing projectDir / rootDir / sources');
  process.exit(2);
}

let gasFakesPath;
try {
  gasFakesPath = require.resolve('@mcpher/gas-fakes', { paths: [projectDir] });
} catch {
  console.error(
    'runner-web: cannot find @mcpher/gas-fakes in this project.\n' +
      'Run "GAS Fakes: Init in This Project" or `npm i -D @mcpher/gas-fakes`.',
  );
  process.exit(2);
}
require(gasFakesPath);

// ---------- HtmlService shim ---------------------------------------------

const htmlSvc = require('./_htmlservice.cjs');
const { htmlEscape, HtmlOutput } = htmlSvc;
htmlSvc.install(rootDir);

// ---------- ScriptApp.getService stub ------------------------------------
//
// gas-fakes doesn't implement ScriptApp.getService(). Real GAS web apps use it
// to get the deployed URL (e.g. for building self-referential proxy links).
// We back it with the local server URL once the listener is up.
let _webAppUrl = null;
const _scriptAppExtras = {
  getService() {
    return {
      getUrl: () => _webAppUrl,
    };
  },
};
// Apply after gas-fakes has loaded so we don't fight its install.
function installScriptAppExtras() {
  const existing = globalThis.ScriptApp;
  if (!existing) {
    globalThis.ScriptApp = _scriptAppExtras;
    return;
  }
  if (typeof existing.getService !== 'function') {
    try {
      existing.getService = _scriptAppExtras.getService;
    } catch {
      // existing was a frozen object — shadow it.
      const merged = Object.assign({}, existing, _scriptAppExtras);
      Object.defineProperty(globalThis, 'ScriptApp', {
        value: merged, writable: true, configurable: true, enumerable: true,
      });
    }
  }
}

// ---------- Load user sources at global scope ----------------------------

// Load each source as its own vm.Script so stack traces / debugger see the
// real .gs/.js file. Top-level `function foo()` lands on globalThis just like
// Apps Script's shared namespace.
for (const f of sources) {
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInThisContext();
  } catch (err) {
    console.error(`runner-web: error loading ${path.relative(projectDir, f)}`);
    console.error((err && err.stack) || err);
    process.exit(1);
  }
}

// ---------- Client polyfills ----------------------------------------------
//
// Two polyfills depending on sandbox mode:
//   * UNSANDBOXED: page does fetch() directly (simpler, less faithful to GAS).
//   * SANDBOXED:   page is in a sandboxed iframe without allow-same-origin,
//                  so it can't do same-origin fetch. It postMessages to the
//                  outer parent, which performs the fetch and posts back.
//                  This mirrors how google.script.run actually works in prod.

const DIRECT_POLYFILL = `
<script>
(function () {
  if (window.google && window.google.script && window.google.script.run) return;
  function callServer(name, args, state) {
    var hasFiles = args.some(function (a) { return a instanceof File || a instanceof Blob; });
    var p;
    if (!hasFiles) {
      p = fetch('/_gasfakes/run/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: args })
      });
    } else {
      var fd = new FormData();
      var jsonArgs = args.map(function (a, i) {
        if (a instanceof File || a instanceof Blob) {
          fd.append('file_' + i, a, (a.name || ('blob_' + i)));
          return { __gasfakesFile: i, name: a.name || ('blob_' + i), type: a.type || 'application/octet-stream' };
        }
        return a;
      });
      fd.append('jsonArgs', JSON.stringify(jsonArgs));
      p = fetch('/_gasfakes/run/' + encodeURIComponent(name), { method: 'POST', body: fd });
    }
    p.then(function (r) { return r.json(); })
     .then(function (data) {
       if (data.ok) { state.success && state.success(data.result, state.userObject); }
       else { state.failure && state.failure(new Error(data.error || 'server error'), state.userObject); }
     })
     .catch(function (err) { state.failure && state.failure(err, state.userObject); });
  }
  function makeRunner(state) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (cb) { return makeRunner(Object.assign({}, state, { success: cb })); };
        if (name === 'withFailureHandler') return function (cb) { return makeRunner(Object.assign({}, state, { failure: cb })); };
        if (name === 'withUserObject')     return function (o)  { return makeRunner(Object.assign({}, state, { userObject: o })); };
        return function () { callServer(name, Array.prototype.slice.call(arguments), state); };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner({ success: null, failure: null, userObject: null });
  window.google.script.url = {
    getLocation: function (cb) {
      var sp = new URLSearchParams(window.location.search);
      var parameter = {}, parameters = {};
      sp.forEach(function (v, k) { parameter[k] = v; (parameters[k] = parameters[k] || []).push(v); });
      cb({ hash: window.location.hash.replace(/^#/, ''), parameter: parameter, parameters: parameters });
    }
  };
  window.google.script.host = {
    close: function () { window.close(); }, setHeight: function () {}, setWidth: function () {},
    editor: { focus: function () {} }, origin: window.location.origin
  };
  window.google.script.history = { push: function () {}, replace: function () {} };
})();
</script>
`;

const SANDBOXED_POLYFILL = `
<script>
(function () {
  if (window.google && window.google.script && window.google.script.run) return;
  var nextId = 0;
  var pending = {};

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.__gasfakes !== true || msg.type !== 'result') return;
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    if (msg.ok) { try { p.success && p.success(msg.result, p.userObject); } catch (e) { console.error(e); } }
    else        { try { p.failure && p.failure(new Error(msg.error || 'server error'), p.userObject); } catch (e) { console.error(e); } }
  });

  function callServer(name, args, state) {
    var id = ++nextId;
    pending[id] = state;
    // File and Blob are structured-cloneable, so we can pass them through postMessage.
    var fileMap = {};
    var hasFiles = false;
    var jsonArgs = args.map(function (a, i) {
      if (a instanceof File || a instanceof Blob) {
        hasFiles = true;
        fileMap[i] = a;
        return { __gasfakesFile: i, name: a.name || ('blob_' + i), type: a.type || 'application/octet-stream' };
      }
      return a;
    });
    window.parent.postMessage({
      __gasfakes: true, type: 'run', id: id, name: name,
      jsonArgs: jsonArgs, files: hasFiles ? fileMap : null
    }, '*');
  }

  function makeRunner(state) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (cb) { return makeRunner(Object.assign({}, state, { success: cb })); };
        if (name === 'withFailureHandler') return function (cb) { return makeRunner(Object.assign({}, state, { failure: cb })); };
        if (name === 'withUserObject')     return function (o)  { return makeRunner(Object.assign({}, state, { userObject: o })); };
        return function () { callServer(name, Array.prototype.slice.call(arguments), state); };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner({ success: null, failure: null, userObject: null });
  window.google.script.url = {
    getLocation: function (cb) {
      var sp = new URLSearchParams(window.location.search);
      var parameter = {}, parameters = {};
      sp.forEach(function (v, k) { parameter[k] = v; (parameters[k] = parameters[k] || []).push(v); });
      cb({ hash: window.location.hash.replace(/^#/, ''), parameter: parameter, parameters: parameters });
    }
  };
  window.google.script.host = {
    close:     function ()  { window.parent.postMessage({ __gasfakes: true, type: 'host.close' }, '*'); try { window.close(); } catch (e) {} },
    setHeight: function (h) { window.parent.postMessage({ __gasfakes: true, type: 'host.setHeight', value: h }, '*'); },
    setWidth:  function (w) { window.parent.postMessage({ __gasfakes: true, type: 'host.setWidth',  value: w }, '*'); },
    editor: { focus: function () {} },
    origin: window.location.origin
  };
  window.google.script.history = { push: function () {}, replace: function () {} };
})();
</script>
`;

const CLIENT_POLYFILL = sandboxIframe ? SANDBOXED_POLYFILL : DIRECT_POLYFILL;

// Outer wrapper page: hosts a sandboxed iframe that loads the user's HTML, and
// proxies google.script.run calls between the inner frame and the local server.
function wrapperHtml(initialQuery) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>GAS Fakes — Web App</title>
<style>html,body{margin:0;padding:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body>
<iframe id="app" src="/_inner/${initialQuery}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-modals allow-downloads"></iframe>
<script>
(function () {
  var iframe = document.getElementById('app');
  window.addEventListener('message', async function (event) {
    if (!event.data || event.data.__gasfakes !== true) return;
    if (event.source !== iframe.contentWindow) return;
    var msg = event.data;
    if (msg.type === 'run') {
      try {
        var fd = new FormData();
        fd.append('jsonArgs', JSON.stringify(msg.jsonArgs));
        if (msg.files) {
          for (var k in msg.files) {
            fd.append('file_' + k, msg.files[k], msg.files[k].name || ('blob_' + k));
          }
        }
        var res = await fetch('/_gasfakes/run/' + encodeURIComponent(msg.name), {
          method: 'POST', body: fd, credentials: 'same-origin'
        });
        var data = await res.json();
        iframe.contentWindow.postMessage({
          __gasfakes: true, type: 'result', id: msg.id,
          ok: data.ok, result: data.result, error: data.error
        }, '*');
      } catch (err) {
        iframe.contentWindow.postMessage({
          __gasfakes: true, type: 'result', id: msg.id, ok: false, error: String(err)
        }, '*');
      }
    } else if (msg.type === 'host.setHeight') {
      // No-op: real GAS sets the iframe height; we let the iframe fill the viewport.
    } else if (msg.type === 'host.setWidth') {
      // No-op for the same reason.
    } else if (msg.type === 'host.close') {
      // Only meaningful for popup-style web apps.
    }
  });
})();
</script>
</body></html>`;
}

// ---------- Render an HtmlOutput into a full HTML response ---------------

function renderResponse(htmlOutput) {
  let body = htmlOutput.getContent();

  // Inject extra meta tags into <head>
  const metas = htmlOutput._metaTags
    .map((m) => `<meta name="${htmlEscape(m.name)}" content="${htmlEscape(m.content)}">`)
    .join('\n');
  if (metas && /<\/head>/i.test(body)) {
    body = body.replace(/<\/head>/i, `${metas}\n</head>`);
  }

  // Override <title> if setTitle was used
  if (htmlOutput._title != null) {
    if (/<title>[\s\S]*?<\/title>/i.test(body)) {
      body = body.replace(/<title>[\s\S]*?<\/title>/i, `<title>${htmlEscape(htmlOutput._title)}</title>`);
    } else if (/<\/head>/i.test(body)) {
      body = body.replace(/<\/head>/i, `<title>${htmlEscape(htmlOutput._title)}</title>\n</head>`);
    }
  }

  // Inject favicon
  if (htmlOutput._faviconUrl && /<\/head>/i.test(body)) {
    body = body.replace(
      /<\/head>/i,
      `<link rel="icon" href="${htmlEscape(htmlOutput._faviconUrl)}">\n</head>`,
    );
  }

  // Inject the google.script.run polyfill before </body>, or append
  if (/<\/body>/i.test(body)) {
    body = body.replace(/<\/body>/i, `${CLIENT_POLYFILL}\n</body>`);
  } else {
    body = body + CLIENT_POLYFILL;
  }
  return body;
}

// ---------- HTTP server --------------------------------------------------

function buildEvent(req, parsedUrl, bodyText) {
  const query = parsedUrl.query || {};
  const parameter = {};
  const parameters = {};
  for (const [k, v] of Object.entries(query)) {
    parameters[k] = Array.isArray(v) ? v : [v];
    parameter[k] = Array.isArray(v) ? v[v.length - 1] : v;
  }
  const e = {
    parameter,
    parameters,
    queryString: parsedUrl.search ? parsedUrl.search.slice(1) : '',
    contextPath: '',
    pathInfo: parsedUrl.pathname && parsedUrl.pathname !== '/' ? parsedUrl.pathname.slice(1) : '',
  };
  if (bodyText != null) {
    e.postData = {
      contents: bodyText,
      length: Buffer.byteLength(bodyText, 'utf8'),
      type: req.headers['content-type'] || '',
      name: 'postData',
    };
  }
  return e;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    const fields = {};
    const files = {};
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        files[name] = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          mimeType: info.mimeType,
        };
      });
    });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('error', reject);
    bb.on('close', () => resolve({ fields, files }));
    req.pipe(bb);
  });
}

// Build a GAS-Blob-ish object out of an uploaded file. If gas-fakes exposes
// Utilities.newBlob, we delegate to it so user code that does
// `blob instanceof <gas-fakes Blob>` keeps working; otherwise we duck-type.
function makeBlob(buffer, name, contentType) {
  const Utilities = globalThis.Utilities;
  if (Utilities && typeof Utilities.newBlob === 'function') {
    try {
      return Utilities.newBlob(Array.from(buffer), contentType || 'application/octet-stream', name || '');
    } catch {
      // fall through to duck type
    }
  }
  let buf = buffer;
  let bName = name || '';
  let bType = contentType || 'application/octet-stream';
  return {
    getBytes() { return Array.from(buf); },
    getDataAsString(charset) { return buf.toString(charset || 'utf-8'); },
    getContentType() { return bType; },
    getName() { return bName; },
    setName(n) { bName = String(n); return this; },
    setContentType(t) { bType = String(t); return this; },
    setBytes(bytes) { buf = Buffer.from(bytes); return this; },
    setDataFromString(s, charset) { buf = Buffer.from(String(s), charset || 'utf-8'); return this; },
    isGoogleType() { return false; },
    copyBlob() { return makeBlob(Buffer.from(buf), bName, bType); },
    getAs(_t) { return this; },
  };
}

async function handleRunRpc(req, res, fnName) {
  const fn = globalThis[fnName];
  if (typeof fn !== 'function') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `function "${fnName}" not found` }));
    return;
  }
  try {
    const ct = req.headers['content-type'] || '';
    let callArgs;
    if (ct.startsWith('multipart/form-data')) {
      const { fields, files } = await parseMultipart(req);
      const jsonArgs = JSON.parse(fields.jsonArgs || '[]');
      callArgs = jsonArgs.map((a) => {
        if (a && typeof a === 'object' && '__gasfakesFile' in a) {
          const f = files['file_' + a.__gasfakesFile];
          if (!f) return null;
          return makeBlob(f.buffer, f.filename || a.name, f.mimeType || a.type);
        }
        return a;
      });
    } else {
      const bodyText = await readBody(req);
      const body = bodyText ? JSON.parse(bodyText) : {};
      callArgs = Array.isArray(body.args) ? body.args : [];
    }
    const result = await Promise.resolve(fn.apply(null, callArgs));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: result ?? null }));
  } catch (err) {
    console.error(`[run/${fnName}]`, (err && err.stack) || err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
  }
}

async function renderDoGetOrPost(req, res, parsedUrl) {
  const handler = req.method === 'POST' ? globalThis.doPost : globalThis.doGet;
  if (typeof handler !== 'function') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`No ${req.method === 'POST' ? 'doPost' : 'doGet'}() defined.`);
    return;
  }
  try {
    const bodyText = req.method === 'POST' ? await readBody(req) : null;
    const e = buildEvent(req, parsedUrl, bodyText);
    const result = await Promise.resolve(handler(e));
    if (result instanceof HtmlOutput) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderResponse(result));
    } else if (result && typeof result.getContent === 'function') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(String(result.getContent()));
    } else {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(result == null ? '' : String(result));
    }
  } catch (err) {
    console.error('[doGet/doPost]', (err && err.stack) || err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`Server error: ${(err && err.message) || err}`);
  }
}

async function handle(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  // google.script.run dispatch
  if (req.method === 'POST' && pathname.startsWith('/_gasfakes/run/')) {
    const fnName = decodeURIComponent(pathname.slice('/_gasfakes/run/'.length));
    return handleRunRpc(req, res, fnName);
  }

  if (sandboxIframe) {
    // Outer wrapper: any GET to / (or any non-/_inner path) serves a wrapper
    // page hosting the user's HTML in a sandboxed iframe.
    if (req.method === 'GET' && !pathname.startsWith('/_inner') && !pathname.startsWith('/_gasfakes/')) {
      // Pass query string through to the inner frame so doGet sees the right `e`.
      const search = parsedUrl.search || '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(wrapperHtml(search));
      return;
    }

    // Inner frame: serve doGet output. The path under /_inner/ (plus its query
    // string) becomes the synthetic GAS request.
    if (pathname.startsWith('/_inner')) {
      const innerPath = pathname.slice('/_inner'.length) || '/';
      // Static file pass-through for assets co-located with sources
      if (req.method === 'GET' && innerPath !== '/' && !innerPath.startsWith('/_gasfakes/')) {
        const requested = path.normalize(path.join(rootDir, innerPath));
        if (requested.startsWith(rootDir) && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
          res.writeHead(200);
          fs.createReadStream(requested).pipe(res);
          return;
        }
      }
      const innerParsed = { ...parsedUrl, pathname: innerPath };
      return renderDoGetOrPost(req, res, innerParsed);
    }
  } else {
    // Unsandboxed mode: user's HTML served directly from /
    if (req.method === 'GET' && pathname !== '/' && !pathname.startsWith('/_gasfakes/')) {
      const requested = path.normalize(path.join(rootDir, pathname));
      if (requested.startsWith(rootDir) && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
        res.writeHead(200);
        fs.createReadStream(requested).pipe(res);
        return;
      }
    }
    return renderDoGetOrPost(req, res, parsedUrl);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('handler crash:', (err && err.stack) || err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  _webAppUrl = `http://127.0.0.1:${actualPort}/`;
  installScriptAppExtras();
  // Stdout line that the extension parses to learn the URL.
  console.log(`GASFAKES_LISTENING_AT ${_webAppUrl}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
