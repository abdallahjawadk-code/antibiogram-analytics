import { useMemo } from 'react';
import { Download, Printer } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { susceptibilityBand, BAND_COLORS, isReliable, MIN_RELIABLE_ISOLATES, SUSCEPTIBILITY_THRESHOLDS } from '../lib/clinical';
import { Sparkline } from './Sparkline';

interface Cell { organism: string; antibiotic: string; susceptible: number; total: number; }

interface AntibiogramMatrixProps {
  /** aggregated rows: one per organism+antibiotic (already summed) */
  data: Cell[];
  /** preferred antibiotic column order */
  antibioticOrder: string[];
  standard: string;
  /** historical %S per organism|antibiotic key, sorted oldest→newest */
  sparklines?: Map<string, number[]>;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character] || character);
}

function splitSvgLabel(value: string, maxLength = 13): string[] {
  const words = value.replace(/-/g, '- ').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (word.length > maxLength) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Unified cumulative antibiogram: organisms (rows) × antibiotics (columns),
 * each cell coloured by %S. One tidy view across all organisms and hospitals.
 */
export function AntibiogramMatrix({ data, antibioticOrder, standard, sparklines }: AntibiogramMatrixProps) {
  const { isRTL } = useLanguage();

  const { organisms, antibiotics, cells } = useMemo(() => {
    const cellMap = new Map<string, Cell>();
    const orgSet = new Set<string>();
    const abSet = new Set<string>();
    for (const c of data) {
      cellMap.set(`${c.organism}|${c.antibiotic}`, c);
      orgSet.add(c.organism);
      abSet.add(c.antibiotic);
    }
    const ordered = antibioticOrder.filter((a) => abSet.has(a));
    const rest = [...abSet].filter((a) => !ordered.includes(a)).sort();
    return {
      organisms: [...orgSet].sort(),
      antibiotics: [...ordered, ...rest],
      cells: cellMap,
    };
  }, [data, antibioticOrder]);

  const tx = isRTL
    ? { title: 'أنتيبايوغرام موحّد', subtitle: 'كل الكائنات × كل المضادات', organism: 'الكائن', noData: 'لا بيانات' }
    : { title: 'Unified antibiogram', subtitle: 'All organisms × all antibiotics', organism: 'Organism', noData: 'No data' };

  if (organisms.length === 0 || antibiotics.length === 0) return null;

  const startCol = isRTL ? 'right-0' : 'left-0';

  const buildSvg = () => {
    const firstColumnWidth = 200;
    const columnWidth = 110;
    const headerHeight = 126;
    const rowHeight = 58;
    const width = firstColumnWidth + (antibiotics.length * columnWidth);
    const height = headerHeight + (organisms.length * rowHeight);
    const headerCells = antibiotics.map((antibiotic, index) => {
      const x = firstColumnWidth + (index * columnWidth);
      const lines = splitSvgLabel(antibiotic);
      const headerText = lines.map((line, lineIndex) => (
        `<tspan x="${x + (columnWidth / 2)}" dy="${lineIndex === 0 ? 0 : 13}">${escapeXml(line)}</tspan>`
      )).join('');
      const textY = 78 - ((lines.length - 1) * 6);
      return `<rect x="${x}" y="54" width="${columnWidth}" height="${headerHeight - 54}" fill="#f1f5f9" stroke="#e2e8f0"/>`
        + `<text x="${x + (columnWidth / 2)}" y="${textY}" text-anchor="middle" font-size="11" font-weight="600" fill="#475569">${headerText}</text>`;
    }).join('');
    const rows = organisms.map((organism, rowIndex) => {
      const y = headerHeight + (rowIndex * rowHeight);
      const cellSvg = antibiotics.map((antibiotic, columnIndex) => {
        const cell = cells.get(`${organism}|${antibiotic}`);
        const x = firstColumnWidth + (columnIndex * columnWidth);
        const hasData = Boolean(cell && cell.total > 0);
        const fill = hasData && cell ? BAND_COLORS[susceptibilityBand(cell.susceptible)] : '#f8fafc';
        const value = hasData && cell ? `${cell.susceptible.toFixed(0)}%` : '–';
        const sample = hasData && cell ? `n=${cell.total}` : '';
        const textColor = hasData ? '#ffffff' : '#94a3b8';
        return `<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="${fill}" stroke="#e2e8f0"/>`
          + `<text x="${x + (columnWidth / 2)}" y="${y + 25}" text-anchor="middle" font-size="15" font-weight="700" fill="${textColor}">${value}</text>`
          + `<text x="${x + (columnWidth / 2)}" y="${y + 43}" text-anchor="middle" font-size="11" fill="${textColor}">${sample}</text>`;
      }).join('');
      return `<rect x="0" y="${y}" width="${firstColumnWidth}" height="${rowHeight}" fill="#ffffff" stroke="#e2e8f0"/>`
        + `<text x="12" y="${y + 34}" font-size="14" font-weight="600" fill="#1e293b">${escapeXml(organism)}</text>${cellSvg}`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `<rect width="100%" height="100%" fill="#ffffff"/><rect width="100%" height="54" fill="#0f172a"/>`
      + `<text x="16" y="25" font-size="18" font-weight="700" fill="#ffffff">${escapeXml(tx.title)}</text>`
      + `<text x="16" y="43" font-size="11" fill="#cbd5e1">${escapeXml(`${tx.subtitle} · ${standard}`)}</text>`
      + `<rect x="0" y="54" width="${firstColumnWidth}" height="${headerHeight - 54}" fill="#f1f5f9" stroke="#e2e8f0"/>`
      + `<text x="12" y="84" font-size="12" font-weight="700" fill="#475569">${escapeXml(tx.organism)}</text>${headerCells}${rows}</svg>`;
  };

  const saveChart = async () => {
    const svg = buildSvg();
    if (window.electronAPI) {
      await window.electronAPI.saveFile({
        defaultName: 'unified-antibiogram.svg',
        content: svg,
        filters: [{ name: 'SVG image', extensions: ['svg'] }],
      });
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'unified-antibiogram.svg';
    link.click();
    URL.revokeObjectURL(url);
  };

  const printChart = async () => {
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSvg())}`;
    const html = `<!doctype html><html><head><title>${escapeXml(tx.title)}</title><style>body{margin:24px;font-family:Arial,sans-serif}img{width:100%;height:auto}</style></head><body><img src="${source}" alt="${escapeXml(tx.title)}"></body></html>`;
    if (window.electronAPI) {
      await window.electronAPI.printHTML({ html, title: tx.title });
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="relative bg-gradient-to-r from-slate-700 to-slate-900 p-5">
        <div className="absolute end-4 top-4 flex gap-2 print:hidden">
          <button type="button" onClick={() => void printChart()} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/25">
            <Printer className="h-4 w-4" />
            {isRTL ? 'طباعة الرسم' : 'Print chart'}
          </button>
          <button type="button" onClick={() => void saveChart()} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100">
            <Download className="h-4 w-4" />
            {isRTL ? 'حفظ الرسم' : 'Save chart'}
          </button>
        </div>
        <h3 className="text-lg font-bold text-white">{tx.title}</h3>
        <p className="text-slate-300 text-xs mt-0.5">{tx.subtitle} · {standard}</p>
      </div>

      <div className="flex items-center gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLORS.good }} />≥{SUSCEPTIBILITY_THRESHOLDS.good}%</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLORS.moderate }} />{SUSCEPTIBILITY_THRESHOLDS.moderate}–{SUSCEPTIBILITY_THRESHOLDS.good - 1}%</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLORS.poor }} />&lt;{SUSCEPTIBILITY_THRESHOLDS.moderate}%</span>
        <span className="text-slate-400">* n &lt; {MIN_RELIABLE_ISOLATES}</span>
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className={`sticky top-0 ${startCol} z-20 bg-slate-100 px-4 py-3 text-start font-semibold text-slate-700 border-b border-slate-200`}>
                {tx.organism}
              </th>
              {antibiotics.map((ab) => (
                <th key={ab} className="sticky top-0 z-10 bg-slate-100 px-3 py-3 font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap text-xs min-w-[84px] align-bottom">
                  {ab}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {organisms.map((org) => (
              <tr key={org} className="hover:bg-slate-50/60">
                <th className={`sticky ${startCol} z-10 bg-white px-4 py-2 text-start font-medium text-slate-800 border-b border-slate-100 whitespace-nowrap`}>
                  {org}
                </th>
                {antibiotics.map((ab) => {
                  const c = cells.get(`${org}|${ab}`);
                  if (!c || c.total === 0) {
                    return <td key={ab} className="px-3 py-2 text-center text-slate-300 border-b border-slate-100">–</td>;
                  }
                  const color = BAND_COLORS[susceptibilityBand(c.susceptible)];
                  const reliable = isReliable(c.total);
                  return (
                    <td
                      key={ab}
                      className="px-3 py-2 text-center border-b border-slate-100"
                      style={{ backgroundColor: color, color: '#fff' }}
                      title={`${org} · ${ab}: ${c.susceptible.toFixed(1)}% S (n=${c.total})`}
                    >
                      <div className="font-bold leading-none">{c.susceptible.toFixed(0)}%{!reliable && <span className="opacity-80">*</span>}</div>
                      <div className="text-[10px] opacity-90 leading-none mt-0.5">n={c.total}</div>
                      {sparklines?.has(`${org}|${ab}`) && (
                        <div className="mt-0.5 flex justify-center opacity-90">
                          <Sparkline values={sparklines.get(`${org}|${ab}`)!} width={34} height={12} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
