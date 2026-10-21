import { createHash, createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { loadAppsScriptSource } from './appsscript-source';

type Cell = unknown;
class Sheet {
  rows: Cell[][] = [];
  constructor(public name: string, private failWrite: (name: string, values: Cell[][]) => void) {}
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, row) => Math.max(n, row.length), 0); }
  getMaxRows() { return 200; }
  getFrozenRows() { return 1; }
  setFrozenRows() {}
  setColumnWidth() {}
  setRowHeight() {}
  hideColumns() {}
  deleteRows(start: number, count: number) { this.rows.splice(start - 1, count); }
  clear() { this.rows = []; }
  getDataRange() { return { getValues: () => this.rows.map(row => [...row]) }; }
  appendRow(row: Cell[]) { this.failWrite(this.name, [row]); this.rows.push([...row]); }
  deleteRow(row: number) { this.rows.splice(row - 1, 1); }
  getRange(row: number, col: number, count = 1, cols = 1) {
    const range: any = {
      getValues: () => Array.from({ length: count }, (_, r) => Array.from({ length: cols }, (_, c) => this.rows[row - 1 + r]?.[col - 1 + c] ?? '')),
      setValues: (values: Cell[][]) => {
        this.failWrite(this.name, values);
        values.forEach((line, r) => {
          while (this.rows.length < row + r) this.rows.push([]);
          line.forEach((value, c) => { this.rows[row - 1 + r][col - 1 + c] = value; });
        });
        return range;
      },
      setValue: (value: Cell) => range.setValues([[value]]),
    };
    for (const fn of ['setFontWeight', 'setFontColor', 'setBackground', 'setVerticalAlignment', 'setHorizontalAlignment', 'setWrap', 'setNumberFormat', 'setFontSize']) range[fn] = () => range;
    return range;
  }
}

export function environment() {
  const properties: Record<string, string> = { DB_SPREADSHEET_ID: 'TEST', SCHEMA_VERSION: '1', SHARED_SECRET: 'test-only' };
  let crash: ((name: string, values: Cell[][]) => boolean) | undefined;
  const sheets = new Map<string, Sheet>();
  const failWrite = (name: string, values: Cell[][]) => { if (crash?.(name, values)) { crash = undefined; throw new Error('simulated interrupted write'); } };
  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => { const sheet = new Sheet(name, failWrite); sheets.set(name, sheet); return sheet; },
    getSheets: () => [...sheets.values()], getId: () => 'TEST', getUrl: () => 'test://spreadsheet', deleteSheet: () => {},
  };
  const files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; bytes: number[] }>();
  let driveCreates = 0;
  let failAfterCreate = false;
  const makeBlob = (bytes: number[] | Buffer, mimeType = '', name = '') => ({ getBytes: () => [...bytes], getContentType: () => mimeType, getName: () => name, getDataAsString: () => Buffer.from(bytes).toString('utf8') });
  const folder = (id: string) => ({ getId: () => id, getFoldersByName: (name: string) => ({ hasNext: () => false, next: () => folder(`${id}/${name}`) }), createFolder: (name: string) => folder(`${id}/${name}`) });
  const sandbox: any = {
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] ?? null, setProperty: (key: string, value: string) => { properties[key] = value; }, setProperties: (values: Record<string, string>) => Object.assign(properties, values) }) },
    SpreadsheetApp: { openById: () => spreadsheet, create: () => spreadsheet, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text: string) => ({ setMimeType: () => text }) },
    ScriptApp: { getService: () => ({ getUrl: () => '' }) },
    Utilities: {
      getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeHmacSha256Signature: (value: string, key: string) => [...createHmac('sha256', key).update(value).digest()],
      computeDigest: (_algorithm: string, value: string | number[]) => [...createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value.map(x => x & 255))).digest()],
      base64Encode: (value: string | number[]) => Buffer.from(value as any).toString('base64'),
      base64Decode: (value: string) => [...Buffer.from(value, 'base64')],
      base64EncodeWebSafe: (value: string) => Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe: (value: string) => [...Buffer.from(value, 'base64url')],
      newBlob: makeBlob,
    },
    DriveApp: {
      getFolderById: folder,
      getFileById: (id: string) => { const f = files.get(id); if (!f) throw new Error('not found'); return { getBlob: () => makeBlob(f.bytes, f.mimeType, f.name), getId: () => id, getName: () => f.name, getMimeType: () => f.mimeType, getSize: () => f.bytes.length }; },
    },
    Drive: { Permissions: { list: () => ({ permissions: [] }) }, Files: {
      generateIds: () => ({ ids: [randomUUID()] }),
      get: (id: string) => { const f = files.get(id); if (!f) throw new Error('not found'); return { ...f, size: String(f.bytes.length), sha256Checksum: createHash('sha256').update(Buffer.from(f.bytes)).digest('hex'), trashed: false }; },
      create: (metadata: any, blob: any) => {
        if (files.has(metadata.id)) throw new Error('already exists');
        driveCreates++;
        const f = { ...metadata, bytes: blob.getBytes() };
        files.set(metadata.id, f);
        if (failAfterCreate) { failAfterCreate = false; throw new Error('response lost after Drive creation'); }
        return f;
      },
    } },
  };
  vm.createContext(sandbox);
  vm.runInContext(loadAppsScriptSource(), sandbox, { filename: 'Code.gs' });
  const jobs = spreadsheet.insertSheet('Jobs'); jobs.rows = [[...sandbox.JOB_HEADERS]];
  spreadsheet.insertSheet('AuditLog').rows = [[...sandbox.LOG_HEADERS]];
  spreadsheet.insertSheet('Users').rows = [[...sandbox.USER_HEADERS]];
  spreadsheet.insertSheet('Sessions').rows = [[...sandbox.SESSION_HEADERS]];
  const editor = { email: 'editor@example.com', name: 'Editor', role: 'editor' };
  const other = { email: 'other@example.com', name: 'Other', role: 'editor' };
  const viewer = { email: 'viewer@example.com', name: 'Viewer', role: 'viewer' };
  const admin = { email: 'admin@example.com', name: 'Admin', role: 'admin' };
  const call = (fn: string, ...args: any[]) => { const result = sandbox[fn](...args); return result === undefined ? undefined : JSON.parse(JSON.stringify(result)); };
  const createJob = (id = 'job-1') => call('saveJob_', editor, { recordId: id, status: 'Draft', customer: { customerName: 'Test' } }, { protocolVersion: 2, mutationId: randomUUID(), expectedRevision: 0 });
  const mutate = (kind: string, itemId: string, payload: unknown, options: any = {}, user = editor) => call('mutateJobItem_', user, { jobId: 'job-1', kind, itemId, operation: 'create', expectedRevision: 0, mutationId: randomUUID(), payload, ...options });
  return { sandbox, properties, sheets, files, editor, other, viewer, admin, call, createJob, mutate, crashOn: (fn: typeof crash) => { crash = fn; }, loseDriveAck: () => { failAfterCreate = true; }, driveCreates: () => driveCreates };
}


