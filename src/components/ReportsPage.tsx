import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData, getUploadHistory } from '../lib/supabase';
import { Hospital, AntibiogramData, UploadHistory } from '../types/database';
import { FileText, Download, Printer, Building2, Calendar, Clock, CheckCircle, XCircle, Loader2, FileSpreadsheet, FileImage, File } from 'lucide-react';
import * as XLSX from 'xlsx';
import { computeSIR, susceptibilityBand, BAND_COLORS, isReliable, MIN_RELIABLE_ISOLATES } from '../lib/clinical';

// Report fields originate from uploaded laboratory data. Escape them before
// interpolating into the printable HTML/Word document templates.
function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function ReportsPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { t, isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [uploads, setUploads] = useState<(UploadHistory & { hospitals?: { name: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Report settings
  type ReportType = 'annual' | 'quarterly' | 'hospital' | 'summary';
  const [, setReportType] = useState<ReportType>('annual');
  const [reportFormat, setReportFormat] = useState<'pdf' | 'excel' | 'word'>('pdf');
  const [selectedHospital, setSelectedHospital] = useState<string>('all');
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [includeSections, setIncludeSections] = useState({
    executiveSummary: true,
    methodology: false,
    results: true,
    discussion: false,
    recommendations: true,
    appendices: false,
  });
  const [reportTitle, setReportTitle] = useState(t.print.title);
  const [preparedBy, setPreparedBy] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const [hospitalsData, uploadsData] = await Promise.all([
          getHospitals(),
          getUploadHistory(),
        ]);
        setHospitals(hospitalsData);
        setUploads(uploadsData);
      } catch (error) {
        console.error('Error loading reports:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  async function generateReport() {
    setGeneratingReport(true);

    try {
      // Get data for report
      const filters = {
        ...(selectedHospital !== 'all' ? { hospitalId: selectedHospital } : {}),
        year: reportYear,
      };
      const antibiogramData = await getAntibiogramData(filters);

      if (reportFormat === 'excel') {
        generateExcelReport(antibiogramData);
      } else if (reportFormat === 'pdf') {
        generatePdfReport(antibiogramData);
      } else {
        generateWordReport(antibiogramData);
      }
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGeneratingReport(false);
      setShowReportModal(false);
    }
  }

  // CLSI M39: combinations tested on fewer than MIN_RELIABLE_ISOLATES isolates
  // are statistically unreliable and flagged with an asterisk. Bilingual.
  const reliabilityFootnote = isRTL
    ? `* عدد العزلات أقل من ${MIN_RELIABLE_ISOLATES}؛ النسبة غير موثوقة إحصائياً (CLSI M39).`
    : `* Fewer than ${MIN_RELIABLE_ISOLATES} isolates; percentage is statistically unreliable (CLSI M39).`;

  function generateExcelReport(data: AntibiogramData[]) {
    const hospitalName = selectedHospital === 'all' ? t.antibiogram.allHospitals : hospitals.find(h => h.id === selectedHospital)?.name || '';

    // Summary sheet
    const summaryData = [
      [t.print.title],
      [],
      [t.reports.reportTitle + ':', reportTitle],
      [t.print.hospital + ':', hospitalName],
      [t.print.year + ':', reportYear],
      [t.reports.preparedBy + ':', preparedBy],
      [t.print.generatedOn + ':', new Date().toLocaleDateString()],
      [],
      [t.reports.executiveSummary],
      [],
      [t.dashboard.totalHospitals, hospitals.length],
      [t.dashboard.totalIsolates, data.reduce((sum, d) => sum + (d.total_tested || 0), 0)],
      ['Average Susceptibility %', (() => {
        const totalTested = data.reduce((sum, d) => sum + (d.total_tested || 0), 0);
        const totalSusceptible = data.reduce((sum, d) => sum + (d.susceptible_count || 0), 0);
        return totalTested > 0 ? ((totalSusceptible / totalTested) * 100).toFixed(1) + '%' : 'N/A';
      })()],
      [],
      [reliabilityFootnote],
    ];

    // Main data sheet
    const mainHeaders = [
      t.antibiogram.selectOrganism,
      t.antibiogram.antibiotic,
      t.antibiogram.susceptible,
      t.antibiogram.intermediate,
      t.antibiogram.resistant,
      t.antibiogram.total,
      t.antibiogram.percent,
    ];

    const mainData = data.map(d => {
      const sir = computeSIR(d);
      const flag = !isReliable(d.total_tested) ? ' *' : '';
      return [
        d.organism + flag,
        d.antibiotic,
        sir.susceptible + '%',
        sir.intermediate + '%',
        sir.resistant + '%',
        sir.total,
        sir.susceptible + '%',
      ];
    });

    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    // Data sheet
    const dataWs = XLSX.utils.aoa_to_sheet([mainHeaders, ...mainData]);
    XLSX.utils.book_append_sheet(wb, dataWs, 'Antibiogram Data');

    // Organism breakdown
    const organismGroups: Record<string, AntibiogramData[]> = {};
    data.forEach(d => {
      if (!organismGroups[d.organism]) organismGroups[d.organism] = [];
      organismGroups[d.organism].push(d);
    });

    Object.entries(organismGroups).forEach(([organism, orgData]) => {
      const orgRows = [
        [organism],
        [...mainHeaders],
        ...orgData.map(d => {
          const sir = computeSIR(d);
          const flag = !isReliable(d.total_tested) ? ' *' : '';
          return [
            d.organism + flag,
            d.antibiotic,
            sir.susceptible + '%',
            sir.intermediate + '%',
            sir.resistant + '%',
            sir.total,
            sir.susceptible + '%',
          ];
        }),
      ];
      const orgWs = XLSX.utils.aoa_to_sheet(orgRows);
      const sheetName = organism.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
      XLSX.utils.book_append_sheet(wb, orgWs, sheetName);
    });

    XLSX.writeFile(wb, `antibiogram_report_${reportYear}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  function generatePdfReport(data: AntibiogramData[]) {
    // Create printable HTML content
    const hospitalName = selectedHospital === 'all' ? t.antibiogram.allHospitals : hospitals.find(h => h.id === selectedHospital)?.name || '';
    const totalIsolates = data.reduce((sum, d) => sum + (d.total_tested || 0), 0);
    const totalSusceptibleCount = data.reduce((sum, d) => sum + (d.susceptible_count || 0), 0);
    const avgSusceptibility = totalIsolates > 0 ? ((totalSusceptibleCount / totalIsolates) * 100).toFixed(1) : 'N/A';

    // Group data by organism
    const organismGroups: Record<string, AntibiogramData[]> = {};
    data.forEach(d => {
      if (!organismGroups[d.organism]) organismGroups[d.organism] = [];
      organismGroups[d.organism].push(d);
    });

    const printContent = `
      <!DOCTYPE html>
      <html ${isRTL ? 'dir="rtl" lang="ar"' : ''}>
      <head>
        <meta charset="UTF-8">
        <title>${reportTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: 'Inter', 'Noto Sans Arabic', sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #1e293b;
            padding: 40px;
          }

          .header {
            text-align: center;
            border-bottom: 3px solid #14b8a6;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }

          .header h1 {
            font-size: 24pt;
            color: #0f766e;
            margin-bottom: 8px;
          }

          .header .subtitle {
            font-size: 12pt;
            color: #64748b;
          }

          .meta-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            background: #f8fafc;
            padding: 15px 20px;
            border-radius: 8px;
          }

          .meta-info div {
            font-size: 10pt;
          }

          .meta-info span {
            color: #64748b;
          }

          .meta-info strong {
            color: #1e293b;
          }

          h2 {
            font-size: 16pt;
            color: #0f766e;
            margin: 25px 0 15px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #e2e8f0;
          }

          h3 {
            font-size: 13pt;
            color: #334155;
            margin: 20px 0 10px 0;
          }

          .summary-box {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin: 20px 0;
          }

          .stat-card {
            background: linear-gradient(135deg, #14b8a6, #0891b2);
            color: white;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
          }

          .stat-card .value {
            font-size: 28pt;
            font-weight: 700;
          }

          .stat-card .label {
            font-size: 10pt;
            opacity: 0.9;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            font-size: 10pt;
          }

          th {
            background: #0f766e;
            color: white;
            padding: 10px 8px;
            text-align: ${isRTL ? 'right' : 'left'};
            font-weight: 600;
          }

          td {
            padding: 8px;
            border-bottom: 1px solid #e2e8f0;
          }

          tr:nth-child(even) {
            background: #f8fafc;
          }

          .susceptible { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; }
          .intermediate { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; }
          .resistant { background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; }

          .recommendation {
            background: #fffbeb;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            margin: 15px 0;
            border-radius: 0 8px 8px 0;
          }

          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            font-size: 9pt;
            color: #64748b;
            text-align: center;
          }

          .disclaimer {
            background: #f1f5f9;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 9pt;
            color: #475569;
            margin-top: 20px;
          }

          @media print {
            body { padding: 20px; }
            .page-break { page-break-before: always; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${escapeHtml(reportTitle)}</h1>
          <div class="subtitle">${t.print.subtitle || 'Antimicrobial Susceptibility Analysis Report'}</div>
        </div>

        <div class="meta-info">
          <div><span>${t.print.hospital}:</span> <strong>${escapeHtml(hospitalName)}</strong></div>
          <div><span>${t.print.year}:</span> <strong>${reportYear}</strong></div>
          <div><span>${t.print.standard}:</span> <strong>CLSI</strong></div>
          <div><span>${t.print.generatedOn}:</span> <strong>${new Date().toLocaleDateString()}</strong></div>
        </div>

        ${includeSections.executiveSummary ? `
        <h2>${t.reports.executiveSummary}</h2>
        <div class="summary-box">
          <div class="stat-card">
            <div class="value">${hospitals.length}</div>
            <div class="label">${t.dashboard.totalHospitals}</div>
          </div>
          <div class="stat-card">
            <div class="value">${totalIsolates.toLocaleString()}</div>
            <div class="label">${t.dashboard.totalIsolates}</div>
          </div>
          <div class="stat-card">
            <div class="value">${avgSusceptibility === 'N/A' ? 'N/A' : avgSusceptibility + '%'}</div>
            <div class="label">${t.antibiogram.susceptibility}</div>
          </div>
        </div>
        ` : ''}

        <h2>${t.reports.results}</h2>

        ${Object.entries(organismGroups).map(([organism, orgData]) => `
        <h3>${escapeHtml(organism)}</h3>
        <table>
          <thead>
            <tr>
              <th>${t.antibiogram.antibiotic}</th>
              <th style="text-align: center;">${t.antibiogram.susceptible}</th>
              <th style="text-align: center;">${t.antibiogram.intermediate}</th>
              <th style="text-align: center;">${t.antibiogram.resistant}</th>
              <th style="text-align: center;">${t.antibiogram.total}</th>
              <th style="text-align: center;">%</th>
            </tr>
          </thead>
          <tbody>
            ${orgData.map(d => {
              const sir = computeSIR(d);
              const bandColor = BAND_COLORS[susceptibilityBand(sir.susceptible)];
              const flag = !isReliable(d.total_tested) ? ' *' : '';
              return `
              <tr>
                <td>${escapeHtml(d.antibiotic)}${flag}</td>
                <td style="text-align: center;">${sir.susceptible.toFixed(1)}%</td>
                <td style="text-align: center;">${sir.intermediate.toFixed(1)}%</td>
                <td style="text-align: center;">${sir.resistant.toFixed(1)}%</td>
                <td style="text-align: center;">${sir.total}</td>
                <td style="text-align: center;">
                  <span style="background:${bandColor};color:#fff;padding:2px 8px;border-radius:4px;">
                    ${sir.susceptible.toFixed(1)}%
                  </span>
                </td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
        `).join('')}

        ${includeSections.recommendations ? `
        <div class="page-break"></div>
        <h2>${t.reports.recommendations}</h2>
        <div class="recommendation">
          <strong>${t.alerts.empiricTherapy}:</strong><br>
          This aggregate antibiogram is decision support, not a patient-specific prescription. Confirm the local guideline, infection site, patient factors, and current isolate susceptibility with the treating team before selecting or changing therapy.
        </div>
        <div class="recommendation">
          <strong>${t.alerts.infectionControl}:</strong><br>
          Implement antimicrobial stewardship programs. Monitor resistance trends regularly and communicate findings to clinical teams.
        </div>
        ` : ''}

        <div class="disclaimer">
          ${escapeHtml(reliabilityFootnote)}<br>
          ${t.print.disclaimer}<br>
          ${t.print.confidential}
        </div>

        <div class="footer">
          ${preparedBy ? `${t.reports.preparedBy}: ${escapeHtml(preparedBy)}<br>` : ''}
          ${t.print.preparedByTeam}
        </div>
      </body>
      </html>
    `;

    // Open print window
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  }

  function generateWordReport(data: AntibiogramData[]) {
    // Generate as HTML which can be opened in Word
    const hospitalName = selectedHospital === 'all' ? t.antibiogram.allHospitals : hospitals.find(h => h.id === selectedHospital)?.name || '';

    const htmlContent = `
      <html ${isRTL ? 'dir="rtl" lang="ar"' : 'lang="en"'} xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
        <title>${reportTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
          h1 { color: #0f766e; font-size: 24pt; margin-bottom: 10px; }
          h2 { color: #0f766e; font-size: 16pt; border-bottom: 2px solid #14b8a6; padding-bottom: 5px; margin-top: 20px; }
          h3 { color: #334155; font-size: 13pt; margin-top: 15px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th { background-color: #0f766e; color: white; padding: 10px; text-align: ${isRTL ? 'right' : 'left'}; }
          td { padding: 8px; border-bottom: 1px solid #ddd; }
          .stat-box { background-color: #f8fafc; padding: 15px; margin: 15px 0; }
          .recommendation { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 10px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(reportTitle)}</h1>
        <p><strong>${t.print.hospital}:</strong> ${escapeHtml(hospitalName)} | <strong>${t.print.year}:</strong> ${reportYear} | <strong>${t.print.generatedOn}:</strong> ${new Date().toLocaleDateString()}</p>

        <h2>${t.reports.executiveSummary}</h2>
        <div class="stat-box">
          <p><strong>${t.dashboard.totalHospitals}:</strong> ${hospitals.length}</p>
          <p><strong>${t.dashboard.totalIsolates}:</strong> ${data.reduce((sum, d) => sum + (d.total_tested || 0), 0).toLocaleString()}</p>
          <p><strong>${t.antibiogram.susceptibility}:</strong> ${(() => {
            const totalTested = data.reduce((sum, d) => sum + (d.total_tested || 0), 0);
            const totalSusceptible = data.reduce((sum, d) => sum + (d.susceptible_count || 0), 0);
            return totalTested > 0 ? ((totalSusceptible / totalTested) * 100).toFixed(1) + '%' : 'N/A';
          })()}</p>
        </div>

        <h2>${t.reports.results}</h2>
        ${Object.entries(data.reduce((acc, d) => {
          if (!acc[d.organism]) acc[d.organism] = [];
          acc[d.organism].push(d);
          return acc;
        }, {} as Record<string, AntibiogramData[]>)).map(([organism, orgData]) => `
          <h3>${escapeHtml(organism)}</h3>
          <table>
            <tr><th>${t.antibiogram.antibiotic}</th><th>S</th><th>I</th><th>R</th><th>${t.antibiogram.total}</th><th>%</th></tr>
            ${orgData.map(d => {
              const sir = computeSIR(d);
              const bandColor = BAND_COLORS[susceptibilityBand(sir.susceptible)];
              const flag = !isReliable(d.total_tested) ? ' *' : '';
              return `<tr><td>${escapeHtml(d.antibiotic)}${flag}</td><td>${sir.susceptible}%</td><td>${sir.intermediate}%</td><td>${sir.resistant}%</td><td>${sir.total}</td><td style="color:${bandColor};font-weight:600;">${sir.susceptible}%</td></tr>`;
            }).join('')}
          </table>
        `).join('')}

        <h2>${t.reports.recommendations}</h2>
        <div class="recommendation">
          ${t.alerts.empiricTherapy}: This aggregate antibiogram is decision support, not a patient-specific prescription. Confirm the local guideline, infection site, patient factors, and current isolate susceptibility before selecting or changing therapy.
        </div>

        <p style="margin-top: 24px; font-size: 9pt; color: #64748b;">${escapeHtml(reliabilityFootnote)}</p>
        <p style="margin-top: 16px; font-size: 9pt; color: #64748b;">${t.print.disclaimer}</p>
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antibiogram_report_${reportYear}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.reports.title}</h1>
          <p className="text-slate-500 mt-1">{t.reports.subtitle}</p>
        </div>
        <button
          onClick={() => setShowReportModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl transition-all"
        >
          <FileText className="w-4 h-4" />
          {t.reports.generateReport}
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{hospitals.length}</p>
              <p className="text-sm text-slate-500">{t.dashboard.totalHospitals}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{uploads.filter(u => u.status === 'success').length}</p>
              <p className="text-sm text-slate-500">{t.upload.success}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{uploads.reduce((sum, u) => sum + u.records_count, 0).toLocaleString()}</p>
              <p className="text-sm text-slate-500">{t.hospitals.files}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Report Types */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { type: 'annual', icon: Calendar, color: 'from-blue-500 to-indigo-600' },
          { type: 'quarterly', icon: Clock, color: 'from-teal-500 to-cyan-600' },
          { type: 'hospital', icon: Building2, color: 'from-amber-500 to-orange-600' },
          { type: 'summary', icon: FileText, color: 'from-emerald-500 to-teal-600' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              onClick={() => { setReportType(item.type as ReportType); setShowReportModal(true); }}
              className="group bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:border-slate-200 hover:shadow-lg transition-all"
            >
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-semibold text-slate-800">{t.reports[item.type + 'Report' as keyof typeof t.reports] || item.type}</h3>
              <p className="text-sm text-slate-500 mt-1">{t.reports.selectFormat}</p>
            </button>
          );
        })}
      </div>

      {/* Recent Reports */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="p-6 border-b border-slate-100 border-t-4 border-t-teal-500">
          <h3 className="font-semibold text-slate-800">{t.dashboard.recentActivity}</h3>
          <p className="text-sm text-slate-500 mt-1">{t.upload.title}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 p-6">
          {hospitals.map((hospital) => (
            <div
              key={hospital.id}
              className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors group"
            >
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white font-bold text-lg">
                {hospital.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{hospital.name}</p>
                <p className="text-sm text-slate-500">{hospital.city || hospital.country}</p>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onNavigate('antibiogram')}
                  aria-label={t.antibiogram.print}
                  className="p-2 bg-white hover:bg-teal-50 rounded-xl text-teal-600 transition-colors"
                  title={t.antibiogram.print}
                >
                  <Printer className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onNavigate('antibiogram')}
                  aria-label={t.antibiogram.export}
                  className="p-2 bg-white hover:bg-teal-50 rounded-xl text-teal-600 transition-colors"
                  title={t.antibiogram.export}
                >
                  <Download className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Report Generation Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={() => !generatingReport && setShowReportModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto my-8" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-800">{t.reports.generateReport}</h2>
              {!generatingReport && (
                <button onClick={() => setShowReportModal(false)} aria-label={isRTL ? 'إغلاق' : 'Close'} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <XCircle className="w-5 h-5 text-slate-400" />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Report Title */}
              <div>
                <label htmlFor="report-title" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.reports.reportTitle}
                </label>
                <input
                  id="report-title"
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
              </div>

              {/* Format Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  {t.reports.selectFormat}
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { format: 'pdf', icon: FileImage, label: t.reports.pdfFormat },
                    { format: 'excel', icon: FileSpreadsheet, label: t.reports.excelFormat },
                    { format: 'word', icon: File, label: t.reports.wordFormat },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.format}
                        type="button"
                        onClick={() => setReportFormat(item.format as typeof reportFormat)}
                        className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                          reportFormat === item.format
                            ? 'border-teal-500 bg-teal-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <Icon className={`w-8 h-8 ${reportFormat === item.format ? 'text-teal-600' : 'text-slate-400'}`} />
                        <span className={`text-sm font-medium ${reportFormat === item.format ? 'text-teal-700' : 'text-slate-600'}`}>
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hospital & Year */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="report-hospital" className="block text-sm font-medium text-slate-700 mb-2">
                    {t.antibiogram.selectHospital}
                  </label>
                  <select
                    id="report-hospital"
                    value={selectedHospital}
                    onChange={(e) => setSelectedHospital(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
                  >
                    <option value="all">{t.antibiogram.allHospitals}</option>
                    {hospitals.map((h) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="report-year" className="block text-sm font-medium text-slate-700 mb-2">
                    {t.antibiogram.selectYear}
                  </label>
                  <select
                    id="report-year"
                    value={reportYear}
                    onChange={(e) => setReportYear(parseInt(e.target.value))}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
                  >
                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Prepared By */}
              <div>
                <label htmlFor="report-prepared-by" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.reports.preparedBy}
                </label>
                <input
                  id="report-prepared-by"
                  type="text"
                  value={preparedBy}
                  onChange={(e) => setPreparedBy(e.target.value)}
                  placeholder={t.reports.preparedBy}
                  className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
              </div>

              {/* Include Sections */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  {t.reports.includeSections}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(includeSections).map(([key, value]) => (
                    <label key={key} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => setIncludeSections({ ...includeSections, [key]: e.target.checked })}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-sm text-slate-700">
                        {t.reports[key as keyof typeof t.reports] || key}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowReportModal(false)}
                  disabled={generatingReport}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={generateReport}
                  disabled={generatingReport}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  {generatingReport ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t.common.loading}
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5" />
                      {t.reports.downloadReport}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
