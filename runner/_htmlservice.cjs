'use strict';

// Shared HtmlService shim. gas-fakes does not implement HtmlService, so we
// provide one. Used by both the function runner (so functions that touch
// HtmlService don't crash) and the web runner (where it actually drives
// page rendering).

const fs = require('fs');
const path = require('path');

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readHtmlFile(rootDir, name) {
  const candidates = name.endsWith('.html')
    ? [path.join(rootDir, name)]
    : [path.join(rootDir, `${name}.html`)];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error(`HtmlService: file not found: ${name} (looked in ${rootDir})`);
}

function processScriptlets(content, templateThis) {
  return content.replace(/<\?(!=|=)?\s*([\s\S]*?)\s*\?>/g, (match, op, code) => {
    const expr = code.replace(/[\s;]+$/, '');
    let result;
    try {
      result = new Function(`with(this){ return (${expr}) }`).call(templateThis);
    } catch {
      try {
        new Function(`with(this){ ${code} }`).call(templateThis);
        result = '';
      } catch (e) {
        throw new Error(`HtmlService scriptlet failed: ${match}\n  ${e.message}`);
      }
    }
    if (op === '=') return htmlEscape(result == null ? '' : result);
    if (op === '!=') return result == null ? '' : String(result);
    return '';
  });
}

class HtmlOutput {
  constructor(content = '') {
    this._content = content;
    this._title = null;
    this._metaTags = [];
    this._faviconUrl = null;
  }
  getContent() { return this._content; }
  setContent(c) { this._content = String(c); return this; }
  append(c) { this._content += String(c); return this; }
  appendUntrusted(c) { this._content += htmlEscape(c); return this; }
  setTitle(t) { this._title = String(t); return this; }
  setXFrameOptionsMode(_m) { return this; }
  addMetaTag(name, content) { this._metaTags.push({ name, content }); return this; }
  setFaviconUrl(u) { this._faviconUrl = String(u); return this; }
  setSandboxMode(_m) { return this; }
  setWidth(_w) { return this; }
  setHeight(_h) { return this; }
  asTemplate() { return new HtmlTemplate(this._content); }
}

class HtmlTemplate {
  constructor(content = '') {
    this._content = content;
  }
  getCode() { return this._content; }
  evaluate() {
    return new HtmlOutput(processScriptlets(this._content, this));
  }
}

function makeService(rootDir) {
  return {
    createHtmlOutput(content) { return new HtmlOutput(content == null ? '' : String(content)); },
    createHtmlOutputFromFile(name) { return new HtmlOutput(readHtmlFile(rootDir, name)); },
    createTemplate(content) { return new HtmlTemplate(content == null ? '' : String(content)); },
    createTemplateFromFile(name) { return new HtmlTemplate(readHtmlFile(rootDir, name)); },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    SandboxMode: { IFRAME: 'IFRAME', NATIVE: 'NATIVE' },
  };
}

function install(rootDir) {
  Object.defineProperty(globalThis, 'HtmlService', {
    value: makeService(rootDir),
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

module.exports = { install, htmlEscape, HtmlOutput, HtmlTemplate, processScriptlets };
