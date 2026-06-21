import type { XlsxParseResult, XlsxParseError } from '../workers/xlsxParse.worker';

let _WorkerClass: (new () => Worker) | null = null;

async function getWorkerClass() {
  if (_WorkerClass) return _WorkerClass;
  try {
    // Dynamic import so the worker chunk is only loaded when needed
    const mod = await import('../workers/xlsxParse.worker?worker');
    _WorkerClass = mod.default;
    return _WorkerClass;
  } catch {
    return null;
  }
}

export type WorkerSheetData = Omit<XlsxParseResult, 'ok'>;

/**
 * Parse an Excel file off the main thread.
 * Falls back to null on any error — caller should fall through to main-thread parsing.
 */
export async function parseExcelOffThread(
  file: File,
  firstSheetOnly = false,
): Promise<WorkerSheetData | null> {
  const WorkerClass = await getWorkerClass();
  if (!WorkerClass) return null;

  const buffer = await file.arrayBuffer();
  return new Promise((resolve) => {
    const worker = new WorkerClass();
    const timeout = setTimeout(() => { worker.terminate(); resolve(null); }, 30_000);

    worker.onmessage = (e: MessageEvent<XlsxParseResult | XlsxParseError>) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(e.data.ok ? e.data : null);
    };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); resolve(null); };
    worker.postMessage({ buffer, firstSheetOnly }, [buffer]);
  });
}
