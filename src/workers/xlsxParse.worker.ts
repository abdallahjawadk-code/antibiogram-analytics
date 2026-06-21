import * as XLSX from 'xlsx';

export interface XlsxParseRequest {
  buffer: ArrayBuffer;
  firstSheetOnly?: boolean;
}

export interface XlsxParseResult {
  ok: true;
  sheetNames: string[];
  /** Raw 2D arrays per sheet name */
  sheets: Record<string, (string | number | null)[][]>;
}

export interface XlsxParseError {
  ok: false;
  error: string;
}

self.onmessage = (e: MessageEvent<XlsxParseRequest>) => {
  try {
    const { buffer, firstSheetOnly } = e.data;
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetNames = firstSheetOnly ? [wb.SheetNames[0]] : wb.SheetNames;
    const sheets: Record<string, (string | number | null)[][]> = {};
    for (const name of sheetNames) {
      const ws = wb.Sheets[name];
      if (ws) {
        sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][];
      }
    }
    self.postMessage({ ok: true, sheetNames: wb.SheetNames, sheets } satisfies XlsxParseResult);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) } satisfies XlsxParseError);
  }
};
