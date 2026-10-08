import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

function cloneRows(rows) {
  return rows.map((row) => [...row]);
}

export function createMemorySpreadsheet(initialSheets = {}) {
  const sheets = new Map();

  class MemorySheet {
    constructor(name, rows = []) {
      this.name = name;
      this.rows = cloneRows(rows);
    }

    getName() { return this.name; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
    getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
    appendRow(row) { this.rows.push([...row]); return this; }

    getRange(row, column, rowCount = 1, columnCount = 1) {
      const sheet = this;
      return {
        getValues() {
          const values = [];
          for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            const source = sheet.rows[row - 1 + rowOffset] || [];
            const result = [];
            for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
              result.push(source[column - 1 + columnOffset] ?? '');
            }
            values.push(result);
          }
          return values;
        },
        getValue() { return this.getValues()[0]?.[0] ?? ''; },
        setValues(values) {
          for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            const targetRow = row - 1 + rowOffset;
            while (sheet.rows.length <= targetRow) sheet.rows.push([]);
            for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
              sheet.rows[targetRow][column - 1 + columnOffset] = values[rowOffset][columnOffset];
            }
          }
          return this;
        },
        setValue(value) { return this.setValues([[value]]); },
        clearContent() {
          return this.setValues(Array.from({ length: rowCount }, () => Array(columnCount).fill('')));
        },
      };
    }
  }

  for (const [name, rows] of Object.entries(initialSheets)) sheets.set(name, new MemorySheet(name, rows));

  return {
    getSheetByName(name) { return sheets.get(name) || null; },
    insertSheet(name) {
      if (sheets.has(name)) throw new Error(`Duplicate sheet: ${name}`);
      const sheet = new MemorySheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
    getSheets() { return [...sheets.values()]; },
  };
}

export async function loadAppsScript({
  files = ['Spreadsheet.gs', 'Security.gs', 'Ownership.gs', 'Api.gs'],
  properties = {},
  globals = {},
} = {}) {
  const openedIds = [];
  const context = vm.createContext({
    JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error, Math, console,
    Logger: { log() {} },
    Utilities: {
      Charset: { UTF_8: 'UTF_8' },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid() { return globals.__uuid || 'server-generated-uuid'; },
      computeDigest(_algorithm, value) {
        return [...createHash('sha256').update(String(value), 'utf8').digest()]
          .map((byte) => (byte > 127 ? byte - 256 : byte));
      },
      formatDate(value, _timezone, pattern) {
        const date = value instanceof Date ? value : new Date(value);
        if (pattern === 'HH:mm') {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: _timezone,
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
          }).formatToParts(date);
          const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
          return `${values.hour}:${values.minute}`;
        }
        if (pattern === 'yyyy-MM-dd') {
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: _timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
          }).formatToParts(date);
          const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
          return `${values.year}-${values.month}-${values.day}`;
        }
        return date.toISOString();
      },
    },
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
        return {
          getProperty(name) { return properties[name] ?? null; },
          setProperty(name, value) { properties[name] = String(value); return this; },
          deleteProperty(name) { delete properties[name]; return this; },
          getProperties() { return { ...properties }; },
        };
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
