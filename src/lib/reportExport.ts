/**
 * Shared antibiogram report generation (PDF via print, Word, Excel).
 *
 * Replaces the per-component `window.print()` stubs with real, downloadable
 * output. All susceptibility figures are derived through the clinical helpers
 * so the report matches what the charts show (S/I/R from counts, n<30 flagged,
 * unified colour bands).
 */
import * as XLSX from 'xlsx';
import { AntibiogramData } from '../types/database';
import { computeSIR, susceptibilityBand, isReliable, BAND_COLORS, MIN_RELIABLE_ISOLATES } from './clinical';

export interface ReportMeta {
  title: string;
  subtitle: string;
  hospitalName: string;
  year: number | string;
  period?: string;
  standard: 'CLSI' | 'EUCAST';
  generatedOn: string;
  preparedBy?: string;
  isRTL: boolean;
  /** localized column/section labels */
  labels: {
    hospital: string;
    year: string;
    standard: string;
    generatedOn: string;
    period: string;
    antibiotic: string;
    susceptible: string;
    intermediate: string;
    resistant: string;
    total: string;
    results: string;
    disclaimer: string;
    confidential: string;
    unreliableNote: string;
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function groupByOrganism(data: AntibiogramData[]): Record<string, AntibiogramData[]> {
  const groups: Record<string, AntibiogramData[]> = {};
  data.forEach((d) => {
    (groups[d.organism] ||= []).push(d);
  });
  return groups;
}

/** Build the full standalone HTML document used for both print/PDF and Word. */
export function buildReportHTML(data: AntibiogramData[], meta: ReportMeta): string {
  const groups = groupByOrganism(data);
  const L = meta.labels;
  const hasUnreliable = data.some((d) => !isReliable(d.total_tested));

  const organismSections = Object.entries(groups).map(([organism, rows]) => {
    const body = rows.map((d) => {
      const sir = computeSIR(d);
      const color = BAND_COLORS[susceptibilityBand(sir.susceptible)];
      const flag = sir.reliable ? '' : ' *';
      return `
        <tr>
          <td>${escapeHtml(d.antibiotic)}${flag}</td>
          <td style="text-align:center">${d.susceptible_count}</td>
          <td style="text-align:center">${d.intermediate_count}</td>
          <td style="text-align:center">${d.resistant_count}</td>
          <td style="text-align:center">${sir.total}</td>
          <td style="text-align:center;font-weight:600;color:${color}">${sir.susceptible.toFixed(1)}%</td>
        </tr>`;
    }).join('');
    return `
      <h3>${escapeHtml(organism)}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.antibiotic}</th>
            <th style="text-align:center">${L.susceptible}</th>
            <th style="text-align:center">${L.intermediate}</th>
            <th style="text-align:center">${L.resistant}</th>
            <th style="text-align:center">${L.total}</th>
            <th style="text-align:center">%S</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  }).join('');

  return `<!DOCTYPE html>
<html ${meta.isRTL ? 'dir="rtl" lang="ar"' : 'lang="en"'}>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(meta.title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11pt; color: #1e293b; padding: 40px; }
    .header { text-align: center; border-bottom: 3px solid #14b8a6; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 22pt; color: #0f766e; }
    .header .subtitle { font-size: 11pt; color: #64748b; margin-top: 4px; }
    .meta { display: flex; flex-wrap: wrap; gap: 12px 32px; background: #f8fafc; padding: 14px 18px; border-radius: 8px; margin-bottom: 24px; font-size: 10pt; }
    .meta span { color: #64748b; }
    .meta strong { color: #1e293b; }
    h2 { font-size: 15pt; color: #0f766e; margin: 20px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 12pt; color: #334155; margin: 16px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 10pt; }
    th { background: #0f766e; color: #fff; padding: 8px; text-align: ${meta.isRTL ? 'right' : 'left'}; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .note { background: #fffbeb; border-${meta.isRTL ? 'right' : 'left'}: 4px solid #f59e0b; padding: 10px 14px; border-radius: 8px; font-size: 9pt; color: #92400e; margin: 12px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 9pt; color: #64748b; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(meta.title)}</h1>
    <div class="subtitle">${escapeHtml(meta.subtitle)}</div>
  </div>
  <div class="meta">
    <div><span>${L.hospital}:</span> <strong>${escapeHtml(meta.hospitalName)}</strong></div>
    <div><span>${L.year}:</span> <strong>${meta.year}</strong></div>
    ${meta.period ? `<div><span>${L.period}:</span> <strong>${escapeHtml(meta.period)}</strong></div>` : ''}
    <div><span>${L.standard}:</span> <strong>${meta.standard}</strong></div>
    <div><span>${L.generatedOn}:</span> <strong>${escapeHtml(meta.generatedOn)}</strong></div>
    ${meta.preparedBy ? `<div><span>${escapeHtml(meta.preparedBy)}</span></div>` : ''}
  </div>
  <h2>${L.results}</h2>
  ${organismSections || `<p>${escapeHtml(meta.labels.disclaimer)}</p>`}
  ${hasUnreliable ? `<div class="note">* ${escapeHtml(L.unreliableNote)} (n &lt; ${MIN_RELIABLE_ISOLATES})</div>` : ''}
  <div class="footer">${escapeHtml(L.disclaimer)}<br>${escapeHtml(L.confidential)}</div>
</body>
</html>`;
}

/** Open the report in a new window and trigger the browser print/Save-as-PDF dialog. */
export function printReport(data: AntibiogramData[], meta: ReportMeta): void {
  const html = buildReportHTML(data, meta);
  if (window.electronAPI) {
    void window.electronAPI.printHTML({ html, title: meta.title });
    return;
  }
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

/** Download the report as a Word document (.doc, HTML-based — opens in MS Word). */
export function downloadWordReport(data: AntibiogramData[], meta: ReportMeta, filename: string): void {
  const html = buildReportHTML(data, meta);
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  triggerDownload(blob, filename);
}

/** Export the antibiogram data as a multi-sheet Excel workbook. */
export function exportExcelReport(data: AntibiogramData[], meta: ReportMeta, filename: string): void {
  const L = meta.labels;
  const wb = XLSX.utils.book_new();

  const summary = [
    [meta.title],
    [],
    [`${L.hospital}:`, meta.hospitalName],
    [`${L.year}:`, meta.year],
    [`${L.standard}:`, meta.standard],
    [`${L.generatedOn}:`, meta.generatedOn],
    [],
    [L.total, data.reduce((s, d) => s + (d.total_tested || 0), 0)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const header = [L.antibiotic, 'Organism', L.susceptible, L.intermediate, L.resistant, L.total, '%S', `n<${MIN_RELIABLE_ISOLATES}`];
  const rows = data.map((d) => {
    const sir = computeSIR(d);
    return [d.antibiotic, d.organism, d.susceptible_count, d.intermediate_count, d.resistant_count, sir.total, sir.susceptible, sir.reliable ? '' : '*'];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Antibiogram Data');

  XLSX.writeFile(wb, filename);
}

/**
 * A4 committee-grade print template.
 * Produces a polished landscape antibiogram table suitable for antimicrobial
 * stewardship committee meetings, with header/footer, colour-coded cells, and
 * a clinical decision support summary.
 */
export function buildCommitteeReportHTML(data: AntibiogramData[], meta: ReportMeta): string {
  const groups = groupByOrganism(data);
  const L = meta.labels;

  // Build a unique antibiotic list in the order they first appear
  const allAbiotics = [...new Set(data.map((d) => d.antibiotic))];

  const rows = Object.entries(groups).map(([organism, orgRows]) => {
    const abMap = new Map<string, AntibiogramData>();
    orgRows.forEach((r) => abMap.set(r.antibiotic, r));
    const cells = allAbiotics.map((ab) => {
      const d = abMap.get(ab);
      if (!d) return '<td style="background:#f8fafc;color:#cbd5e1">—</td>';
      const sir = computeSIR(d);
      const color = BAND_COLORS[susceptibilityBand(sir.susceptible)];
      const flag = sir.reliable ? '' : '<sup>*</sup>';
      return `<td style="background:${color};color:#fff;text-align:center;font-weight:600">${sir.susceptible.toFixed(0)}%${flag}<div style="font-size:8pt;opacity:.85">n=${sir.total}</div></td>`;
    }).join('');
    return `<tr><td style="font-weight:600;white-space:nowrap">${escapeHtml(organism)}</td>${cells}</tr>`;
  }).join('');

  const abHeaders = allAbiotics.map((ab) =>
    `<th style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;padding:8px 4px;font-size:9pt;background:#0f172a;color:#e2e8f0">${escapeHtml(ab)}</th>`
  ).join('');

  const legendItems = [
    { color: BAND_COLORS.good, label: meta.isRTL ? `≥90%  حساس` : '≥90% Susceptible' },
    { color: BAND_COLORS.moderate, label: meta.isRTL ? '60-89%  متوسط' : '60–89% Moderate' },
    { color: BAND_COLORS.poor, label: meta.isRTL ? '<60%  مقاوم' : '<60% Poor/Resistant' },
  ].map((i) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-${meta.isRTL ? 'left' : 'right'}:18px"><span style="display:inline-block;width:12px;height:12px;background:${i.color};border-radius:2px"></span>${escapeHtml(i.label)}</span>`).join('');

  return `<!DOCTYPE html>
<html ${meta.isRTL ? 'dir="rtl" lang="ar"' : 'lang="en"'}>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(meta.title)}</title>
  <style>
    @page { size: A4 landscape; margin: 15mm 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; direction: ${meta.isRTL ? 'rtl' : 'ltr'}; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #0f766e; padding-bottom: 10px; margin-bottom: 12px; }
    .logo-area h1 { font-size: 16pt; color: #0f766e; font-weight: 800; }
    .logo-area p { font-size: 9pt; color: #64748b; margin-top: 2px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; font-size: 9pt; text-align: ${meta.isRTL ? 'left' : 'right'}; }
    .meta-grid dt { color: #94a3b8; }
    .meta-grid dd { font-weight: 600; color: #1e293b; }
    .committee-badge { background: #0f766e; color: #fff; font-size: 8pt; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; display: inline-block; }
    .matrix-wrap { overflow-x: auto; }
    table { border-collapse: collapse; font-size: 9pt; width: 100%; }
    th, td { border: 1px solid #e2e8f0; padding: 5px 7px; }
    thead th:first-child { background: #f1f5f9; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px; font-size: 8.5pt; padding: 8px 0; border-top: 1px solid #e2e8f0; margin-top: 10px; }
    .disclaimer { font-size: 8pt; color: #64748b; margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="logo-area">
      <h1>${escapeHtml(meta.title)}</h1>
      <p>${escapeHtml(meta.subtitle)}</p>
    </div>
    <dl class="meta-grid">
      <dt>${L.hospital}</dt><dd>${escapeHtml(meta.hospitalName)}</dd>
      <dt>${L.year}</dt><dd>${meta.year}${meta.period ? ` · ${escapeHtml(meta.period)}` : ''}</dd>
      <dt>${L.standard}</dt><dd>${meta.standard}</dd>
      <dt>${L.generatedOn}</dt><dd>${escapeHtml(meta.generatedOn)}</dd>
    </dl>
  </div>
  <div class="committee-badge">${meta.isRTL ? 'تقرير اللجنة' : 'Antimicrobial Stewardship Committee Report'}</div>
  <div class="matrix-wrap">
    <table>
      <thead>
        <tr>
          <th style="background:#0f172a;color:#e2e8f0;min-width:140px;text-align:${meta.isRTL ? 'right' : 'left'}">${meta.isRTL ? 'الكائن الحي' : 'Organism'}</th>
          ${abHeaders}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="legend">${legendItems}  * n &lt; ${MIN_RELIABLE_ISOLATES} — ${meta.isRTL ? 'بيانات غير كافية' : 'insufficient isolates'}</div>
  <div class="disclaimer">${escapeHtml(L.disclaimer)} — ${escapeHtml(L.confidential)}</div>
</body>
</html>`;
}

/** Print the committee-grade A4 landscape report. */
export function printCommitteeReport(data: AntibiogramData[], meta: ReportMeta): void {
  const html = buildCommitteeReportHTML(data, meta);
  if (window.electronAPI) { void window.electronAPI.printHTML({ html, title: meta.title }); return; }
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
