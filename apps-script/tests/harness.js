import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function loadAppsScript({
  files = ['Spreadsheet.gs', 'Security.gs', 'Ownership.gs', 'Api.gs'],
  properties = {},
  globals = {},
} = {}) {
  const openedIds = [];
  const context = vm.createContext({
    JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error, Math, console,
    Logger: { log() {} },
    Utilities: { getUuid() { return globals.__uuid || 'server-generated-uuid'; } },
    LockService: {
      getScriptLock() {
        return {
          waitLock() { globals.__lockEvents?.push('lock'); },
          releaseLock() { globals.__lockEvents?.push('unlock'); },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty(name) { return properties[name] ?? null; } };
      },
    },
    SpreadsheetApp: {
      openById(id) {
        openedIds.push(id);
        return globals.__spreadsheet || { id };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content,
          mimeType: null,
          setMimeType(value) { this.mimeType = value; return this; },
          getContent() { return this.content; },
        };
      },
    },
    ...globals,
  });

  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return { context, openedIds };
}

export function call(context, expression) {
  return vm.runInContext(expression, context);
}

export function event(body) {
  return { postData: { contents: JSON.stringify(body) } };
}

export function outputJson(output) {
  return JSON.parse(output.getContent());
}
