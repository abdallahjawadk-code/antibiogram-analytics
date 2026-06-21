import { Download, Printer } from 'lucide-react';

interface ChartExportActionsProps {
  targetId: string;
  title: string;
  fileName: string;
  compact?: boolean;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').toLowerCase();
}

function chartSvg(targetId: string): string | null {
  const target = document.getElementById(targetId);
  const svg = target?.querySelector('svg.recharts-surface') || target?.querySelector('svg');
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.max(1, Math.round(box.width))));
  clone.setAttribute('height', String(Math.max(1, Math.round(box.height))));
  clone.setAttribute('viewBox', `0 0 ${Math.max(1, Math.round(box.width))} ${Math.max(1, Math.round(box.height))}`);
  return new XMLSerializer().serializeToString(clone);
}

export function ChartExportActions({ targetId, title, fileName, compact = false }: ChartExportActionsProps) {
  const labels = document.documentElement.dir === 'rtl'
    ? { print: 'طباعة', save: 'حفظ SVG', missing: 'تعذر العثور على الرسم للتصدير.' }
    : { print: 'Print', save: 'Save SVG', missing: 'The chart could not be found for export.' };
  const name = `${sanitizeFileName(fileName)}.svg`;

  const save = async () => {
    const svg = chartSvg(targetId);
    if (!svg) return window.alert(labels.missing);
    if (window.electronAPI) {
      await window.electronAPI.saveFile({ defaultName: name, content: svg, filters: [{ name: 'SVG image', extensions: ['svg'] }] });
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const print = async () => {
    const svg = chartSvg(targetId);
    if (!svg) return window.alert(labels.missing);
    const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:24px;font-family:Arial,sans-serif}h1{font-size:18px;color:#0f172a;margin:0 0 18px}img{width:100%;height:auto}@page{margin:12mm}</style></head><body><h1>${title}</h1><img src="${image}" alt="${title}"></body></html>`;
    if (window.electronAPI) {
      await window.electronAPI.printHTML({ html, title });
      return;
    }
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  return (
    <div className={`flex items-center gap-2 print:hidden ${compact ? '' : 'shrink-0'}`}>
      <button type="button" onClick={() => void print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50" title={labels.print}>
        <Printer className="h-3.5 w-3.5" />{labels.print}
      </button>
      <button type="button" onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50" title={labels.save}>
        <Download className="h-3.5 w-3.5" />{labels.save}
      </button>
    </div>
  );
}
