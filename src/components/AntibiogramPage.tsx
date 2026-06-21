import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData, getOrganisms, getYears, getPeriods, getTemplates, saveAntibioticOrder, createTemplate, deleteTemplate, updateTemplate, getSpecimenTypes, getAntibioticCatalog, getAntibioticOrder } from '../lib/supabase';
import { Hospital, AntibiogramData, AntibiogramTemplate, Period, PERIOD_OPTIONS, AntibioticCatalogEntry } from '../types/database';
import { AntibiogramChart } from './AntibiogramChart';
import { AntibiogramMatrix } from './AntibiogramMatrix';
import { PolicyBadge } from './PolicyBadge';
import { AIInsightsPanel } from './AIInsightsPanel';
import { computeSIR } from '../lib/clinical';
import { printReport, downloadWordReport, exportExcelReport, printCommitteeReport, ReportMeta } from '../lib/reportExport';
import { Building2, Microscope, Calendar, Filter, Printer, Download, Layers, Save, Settings2, Lock, Unlock, GripVertical, FileText, FileSpreadsheet, Trash2, FlaskConical, ChevronDown, CheckSquare, Square, LayoutGrid } from 'lucide-react';

export function AntibiogramPage() {
  const { t, isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [organisms, setOrganisms] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [, setPeriods] = useState<string[]>([]);
  const [templates, setTemplates] = useState<AntibiogramTemplate[]>([]);
  const [selectedHospitals, setSelectedHospitals] = useState<Set<string>>(new Set());
  const [hospitalView, setHospitalView] = useState<'combined' | 'separate'>('combined');
  const [showHospitalDropdown, setShowHospitalDropdown] = useState(false);
  const [selectedOrganism, setSelectedOrganism] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [selectedSpecimen, setSelectedSpecimen] = useState<string>('all');
  const [specimenTypes, setSpecimenTypes] = useState<string[]>([]);
  const [data, setData] = useState<AntibiogramData[]>([]);
  const [allYearsData, setAllYearsData] = useState<AntibiogramData[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('chart');
  const [chartScope, setChartScope] = useState<'unified' | 'organism'>('unified');
  // Interpretation standard shown on the page (persisted, shared with Settings).
  const [standard, setStandard] = useState<'CLSI' | 'EUCAST'>(
    () => (localStorage.getItem('antibiogram-standard') as 'CLSI' | 'EUCAST') || 'CLSI',
  );
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [antibiotics, setAntibiotics] = useState<string[]>([]);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [antibioticCatalog, setAntibioticCatalog] = useState<AntibioticCatalogEntry[]>([]);

  useEffect(() => {
    getAntibioticCatalog()
      .then(setAntibioticCatalog)
      .catch((err) => console.error('Failed to load antibiotic catalog:', err));
  }, []);

  useEffect(() => {
    async function loadFilters() {
      try {
        const [hospitalsData, organismsData, yearsData, specimenTypesData] = await Promise.all([
          getHospitals(),
          getOrganisms(),
          getYears(),
          getSpecimenTypes(),
        ]);
        setHospitals(hospitalsData);
        setOrganisms(organismsData);
        setYears(yearsData);
        setSpecimenTypes(specimenTypesData);
      } catch (error) {
        console.error('Error loading filters:', error);
      }
    }
    loadFilters();
  }, []);

  const activeSingleHospital = selectedHospitals.size === 1 ? [...selectedHospitals][0] : null;

  useEffect(() => {
    async function loadPeriodsAndTemplates() {
      if (activeSingleHospital) {
        try {
          const [periodsData, templatesData] = await Promise.all([
            getPeriods(activeSingleHospital),
            getTemplates(activeSingleHospital),
          ]);
          setPeriods(periodsData);
          setTemplates(templatesData);
        } catch (error) {
          console.error('Error loading periods:', error);
        }
      } else {
        setTemplates([]);
      }
    }
    loadPeriodsAndTemplates();
  }, [activeSingleHospital]);

  const hospitalsFilterKey = [...selectedHospitals].sort().join(',');

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const filters: { hospitalIds?: string[]; organism?: string; year?: number; period?: string; specimenType?: string } = {};
        if (selectedHospitals.size > 0) filters.hospitalIds = [...selectedHospitals];
        if (selectedOrganism !== 'all') filters.organism = selectedOrganism;
        if (selectedYear !== 'all') filters.year = selectedYear;
        if (selectedPeriod !== 'all') filters.period = selectedPeriod;
        if (selectedSpecimen !== 'all') filters.specimenType = selectedSpecimen;

        const antibiogramData = await getAntibiogramData(filters);
        setData(antibiogramData);
        // Load all years for sparklines (no year filter)
        if (selectedYear !== 'all') {
          const sparkFilters = { ...filters }; delete sparkFilters.year;
          getAntibiogramData(sparkFilters).then(setAllYearsData).catch(() => {});
        } else {
          setAllYearsData(antibiogramData);
        }

        const uniqueAntibiotics = [...new Set(antibiogramData.map((d: AntibiogramData) => d.antibiotic))];
        let orderedAntibiotics = uniqueAntibiotics;
        if (activeSingleHospital) {
          try {
            const orderData = await getAntibioticOrder(activeSingleHospital, 'default');
            const savedOrder = orderData?.[0]?.antibiotics_order as string[] | undefined;
            if (savedOrder && savedOrder.length > 0) {
              const present = new Set(uniqueAntibiotics);
              const inSaved = savedOrder.filter((a) => present.has(a));
              const remaining = uniqueAntibiotics.filter((a) => !new Set(inSaved).has(a));
              orderedAntibiotics = [...inSaved, ...remaining];
            }
          } catch { /* non-fatal */ }
        }
        setAntibiotics(orderedAntibiotics);
      } catch (error) {
        console.error('Error loading antibiogram data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalsFilterKey, selectedOrganism, selectedYear, selectedPeriod, selectedSpecimen, standard]);

  function buildReportMeta(): ReportMeta {
    const hospitalName = selectedHospitals.size === 0
      ? t.antibiogram.allHospitals
      : selectedHospitals.size === 1
        ? hospitals.find((h) => h.id === [...selectedHospitals][0])?.name || ''
        : [...selectedHospitals].map((id) => hospitals.find((h) => h.id === id)?.name || id).join(', ');
    return {
      title: t.print.title,
      subtitle: t.print.subtitle,
      hospitalName,
      year: selectedYear === 'all' ? '—' : selectedYear,
      period: selectedPeriod === 'all' ? undefined : getPeriodLabel(selectedPeriod),
      standard,
      generatedOn: new Date().toLocaleDateString(),
      isRTL,
      labels: {
        hospital: t.print.hospital,
        year: t.print.year,
        standard: t.print.standard,
        generatedOn: t.print.generatedOn,
        period: t.antibiogram.selectPeriod,
        antibiotic: t.antibiogram.antibiotic,
        susceptible: t.antibiogram.susceptible,
        intermediate: t.antibiogram.intermediate,
        resistant: t.antibiogram.resistant,
        total: t.antibiogram.total,
        results: t.reports.results,
        disclaimer: t.print.disclaimer,
        confidential: t.print.confidential,
        unreliableNote: isRTL
          ? 'تقدير غير موثوق لقلة عدد العزلات'
          : 'Unreliable estimate due to low isolate count',
      },
    };
  }

  const reportBaseName = `antibiogram_${selectedYear === 'all' ? 'all' : selectedYear}_${new Date().toISOString().split('T')[0]}`;

  function handlePrint() {
    printReport(data, buildReportMeta());
  }

  function handlePrintCommittee() {
    printCommitteeReport(data, buildReportMeta());
  }

  function handleExportPDF() {
    // Browser print dialog offers "Save as PDF" as the destination.
    printReport(data, buildReportMeta());
  }

  function handleExportWord() {
    downloadWordReport(data, buildReportMeta(), `${reportBaseName}.doc`);
  }

  function handleExportExcel() {
    exportExcelReport(data, buildReportMeta(), `${reportBaseName}.xlsx`);
  }

  function buildChartDataFromRows(rows: AntibiogramData[]) {
    const agg = new Map<string, { organism: string; antibiotic: string; s: number; i: number; r: number; total: number }>();
    for (const d of rows) {
      const key = `${d.organism}|${d.antibiotic}`;
      let a = agg.get(key);
      if (!a) { a = { organism: d.organism, antibiotic: d.antibiotic, s: 0, i: 0, r: 0, total: 0 }; agg.set(key, a); }
      a.s += d.susceptible_count || 0;
      a.i += d.intermediate_count || 0;
      a.r += d.resistant_count || 0;
      a.total += d.total_tested || 0;
    }
    return [...agg.values()].map((a) => {
      const sir = computeSIR({
        susceptible_count: a.s, intermediate_count: a.i, resistant_count: a.r,
        total_tested: a.total, susceptible_percent: 0,
      });
      return { antibiotic: a.antibiotic, susceptible: sir.susceptible, intermediate: sir.intermediate, resistant: sir.resistant, total: sir.total, organism: a.organism };
    });
  }

  const chartData = buildChartDataFromRows(data);

  // Sparklines: %S per organism|antibiotic sorted by year across all years
  const sparklines = useMemo(() => {
    const map = new Map<string, number[]>();
    const grouped = new Map<string, { year: number; pct: number }[]>();
    for (const row of allYearsData) {
      const key = `${row.organism}|${row.antibiotic}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({ year: row.year ?? 0, pct: row.susceptible_percent ?? 0 });
    }
    grouped.forEach((entries, key) => {
      const sorted = entries.sort((a, b) => a.year - b.year);
      if (sorted.length >= 2) map.set(key, sorted.map((e) => e.pct));
    });
    return map;
  }, [allYearsData]);

  // Apply custom ordering if set
  const sortedChartData = [...chartData].sort((a, b) => {
    const aIndex = antibiotics.indexOf(a.antibiotic);
    const bIndex = antibiotics.indexOf(b.antibiotic);
    return aIndex - bIndex;
  });

  const groupedData: Record<string, typeof sortedChartData> = {};
  sortedChartData.forEach((d) => {
    if (!groupedData[d.organism]) groupedData[d.organism] = [];
    groupedData[d.organism].push(d);
  });

  async function handleSaveTemplate() {
    if (!templateName.trim() || !activeSingleHospital) return;

    try {
      await createTemplate({
        hospital_id: activeSingleHospital,
        name: templateName,
        period_type: selectedPeriod === 'all' ? null : selectedPeriod as Period,
        year: selectedYear === 'all' ? new Date().getFullYear() : selectedYear,
        organisms: selectedOrganism === 'all' ? organisms : [selectedOrganism],
        antibiotics,
        layout_settings: {},
        is_default: templates.length === 0,
        is_locked: false,
      });
      setShowTemplateModal(false);
      setTemplateName('');
      if (activeSingleHospital) {
        const templatesData = await getTemplates(activeSingleHospital);
        setTemplates(templatesData);
      }
    } catch (error) {
      console.error('Error saving template:', error);
    }
  }

  async function handleDeleteTemplate(id: string) {
    try {
      await deleteTemplate(id);
      if (activeSingleHospital) {
        const templatesData = await getTemplates(activeSingleHospital);
        setTemplates(templatesData);
      }
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  }

  async function handleLockTemplate(template: AntibiogramTemplate) {
    try {
      await updateTemplate(template.id, { is_locked: !template.is_locked });
      if (activeSingleHospital) {
        const templatesData = await getTemplates(activeSingleHospital);
        setTemplates(templatesData);
      }
    } catch (error) {
      console.error('Error updating template:', error);
    }
  }

  async function handleSaveAntibioticOrder() {
    if (!activeSingleHospital) return;

    try {
      await saveAntibioticOrder(activeSingleHospital, 'default', antibiotics);
      setShowCustomizeModal(false);
    } catch (error) {
      console.error('Error saving antibiotic order:', error);
    }
  }

  function handleDragStart(antibiotic: string) {
    setDraggedItem(antibiotic);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (!draggedItem) return;

    const draggedIndex = antibiotics.indexOf(draggedItem);
    if (draggedIndex === index) return;

    const newOrder = [...antibiotics];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);
    setAntibiotics(newOrder);
  }

  function handleDragEnd() {
    setDraggedItem(null);
  }

  const getPeriodLabel = (periodValue: string) => {
    const option = PERIOD_OPTIONS.find(o => o.value === periodValue);
    if (option) {
      return t.antibiogram[option.labelKey as keyof typeof t.antibiogram];
    }
    return periodValue === 'annual' ? t.antibiogram.annual : periodValue;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.antibiogram.title}</h1>
          <p className="text-slate-500 mt-1">{t.antibiogram.subtitle}</p>
        </div>
        <div className="flex gap-3">
          {activeSingleHospital && (
            <>
              <button
                onClick={() => setShowCustomizeModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 rounded-2xl font-medium border border-slate-200 hover:bg-slate-50 transition-all print:hidden"
              >
                <Settings2 className="w-4 h-4" />
                {t.antibiogram.customizeOrder}
              </button>
              <button
                onClick={() => setShowTemplateModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 rounded-2xl font-medium border border-slate-200 hover:bg-slate-50 transition-all print:hidden"
              >
                <Save className="w-4 h-4" />
                {t.antibiogram.saveAsTemplate}
              </button>
            </>
          )}
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 rounded-2xl font-medium border border-slate-200 hover:bg-slate-50 transition-all print:hidden"
          >
            <Printer className="w-4 h-4" />
            {t.antibiogram.print}
          </button>
          <button
            onClick={handlePrintCommittee}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-700 to-slate-900 text-white rounded-2xl font-medium hover:shadow-lg transition-all print:hidden"
            title={isRTL ? 'تقرير لجنة A4 أفقي' : 'A4 landscape committee report'}
          >
            <FileText className="w-4 h-4" />
            {isRTL ? 'تقرير اللجنة' : 'Committee Report'}
          </button>
          <button
            onClick={handleExportWord}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 rounded-2xl font-medium border border-slate-200 hover:bg-slate-50 transition-all print:hidden"
          >
            <FileText className="w-4 h-4" />
            {t.reports.wordFormat}
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 rounded-2xl font-medium border border-slate-200 hover:bg-slate-50 transition-all print:hidden"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {t.reports.excelFormat}
          </button>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl transition-all"
          >
            <Download className="w-4 h-4" />
            {t.antibiogram.export}
          </button>
        </div>
      </div>

      {/* Templates */}
      {templates.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <h3 className="text-sm font-medium text-slate-600 mb-3">{t.antibiogram.savedTemplates}</h3>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl ${
                  template.is_default ? 'bg-teal-50 border border-teal-200' : 'bg-slate-50'
                }`}
              >
                <span className="text-sm font-medium text-slate-700">{template.name}</span>
                {template.is_locked && <Lock className="w-3 h-3 text-slate-400" />}
                <button
                  onClick={() => handleLockTemplate(template)}
                  className="p-1 hover:bg-slate-200 rounded transition-colors"
                  aria-label={template.is_locked ? t.antibiogram.unlockTemplate : t.antibiogram.lockTemplate}
                  title={template.is_locked ? t.antibiogram.unlockTemplate : t.antibiogram.lockTemplate}
                >
                  {template.is_locked ? (
                    <Lock className="w-3 h-3 text-amber-500" />
                  ) : (
                    <Unlock className="w-3 h-3 text-slate-400" />
                  )}
                </button>
                {!template.is_locked && (
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    aria-label={isRTL ? 'حذف' : 'Delete'}
                    className="p-1 hover:bg-rose-100 rounded transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-rose-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 print:hidden">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-teal-600" />
          <h3 className="font-medium text-slate-800">{t.common.filter}</h3>
        </div>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {/* ── Multi-hospital selector ── */}
          <div className="min-w-0 relative">
            <label className="mb-3 flex min-h-10 items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-tight text-slate-600">
              <Building2 className="h-4 w-4 shrink-0" />
              {t.antibiogram.selectHospital}
              {selectedHospitals.size > 0 && (
                <span className="ml-1 rounded-full bg-teal-500 px-1.5 py-0.5 text-xs text-white leading-none">
                  {selectedHospitals.size}
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={() => setShowHospitalDropdown((v) => !v)}
              className="h-[52px] w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <span className="truncate">
                {selectedHospitals.size === 0
                  ? t.antibiogram.allHospitals
                  : selectedHospitals.size === 1
                    ? hospitals.find((h) => h.id === [...selectedHospitals][0])?.name
                    : isRTL ? `${selectedHospitals.size} مستشفيات` : `${selectedHospitals.size} hospitals`}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </button>

            {showHospitalDropdown && (
              <div
                className="absolute z-30 mt-1 w-full rounded-2xl border border-slate-200 bg-white shadow-xl"
                onMouseLeave={() => setShowHospitalDropdown(false)}
              >
                {/* All hospitals option */}
                <button
                  type="button"
                  onClick={() => { setSelectedHospitals(new Set()); setShowHospitalDropdown(false); }}
                  className={`flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-slate-50 rounded-t-2xl transition-colors ${selectedHospitals.size === 0 ? 'text-teal-700 font-semibold' : 'text-slate-700'}`}
                >
                  {selectedHospitals.size === 0 ? <CheckSquare className="h-4 w-4 text-teal-500" /> : <Square className="h-4 w-4 text-slate-300" />}
                  {t.antibiogram.allHospitals}
                </button>

                <div className="border-t border-slate-100 max-h-52 overflow-y-auto">
                  {hospitals.map((h) => {
                    const checked = selectedHospitals.has(h.id);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => {
                          setSelectedHospitals((prev) => {
                            const next = new Set(prev);
                            checked ? next.delete(h.id) : next.add(h.id);
                            return next;
                          });
                        }}
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors last:rounded-b-2xl ${checked ? 'text-teal-700 font-medium bg-teal-50/60' : 'text-slate-700'}`}
                      >
                        {checked ? <CheckSquare className="h-4 w-4 shrink-0 text-teal-500" /> : <Square className="h-4 w-4 shrink-0 text-slate-300" />}
                        <span className="truncate">{h.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* View mode toggle (combined / separate) */}
                {selectedHospitals.size > 1 && (
                  <div className="border-t border-slate-100 px-3 py-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setHospitalView('combined')}
                      className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${hospitalView === 'combined' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {isRTL ? 'مجمّع' : 'Combined'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setHospitalView('separate')}
                      className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${hospitalView === 'separate' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                      <LayoutGrid className="inline h-3 w-3 mr-1" />
                      {isRTL ? 'منفصل' : 'Separate'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <label htmlFor="filter-organism" className="mb-3 flex min-h-10 items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-tight text-slate-600">
              <Microscope className="h-4 w-4 shrink-0" />
              {t.antibiogram.selectOrganism}
            </label>
            <select
              id="filter-organism"
              value={selectedOrganism}
              onChange={(e) => setSelectedOrganism(e.target.value)}
              className="h-[52px] w-full min-w-0 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="all">{t.antibiogram.allOrganisms}</option>
              {organisms.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="filter-year" className="mb-3 flex min-h-10 items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-tight text-slate-600">
              <Calendar className="h-4 w-4 shrink-0" />
              {t.antibiogram.selectYear}
            </label>
            <select
              id="filter-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
              className="h-[52px] w-full min-w-0 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="all">{t.antibiogram.selectYear}</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="filter-period" className="mb-3 flex min-h-10 items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-tight text-slate-600">
              <Layers className="h-4 w-4 shrink-0" />
              {t.antibiogram.selectPeriod}
            </label>
            <select
              id="filter-period"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="h-[52px] w-full min-w-0 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="all">{t.antibiogram.allPeriods}</option>
              <option value="annual">{t.antibiogram.annual}</option>
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t.antibiogram[p.labelKey as keyof typeof t.antibiogram]}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="filter-specimen" className="mb-3 flex min-h-10 items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-tight text-slate-600">
              <FlaskConical className="h-4 w-4 shrink-0" />
              {isRTL ? t.antibiogram.selectSpecimen : 'Specimen Type'}
            </label>
            <select
              id="filter-specimen"
              value={selectedSpecimen}
              onChange={(e) => setSelectedSpecimen(e.target.value)}
              className="h-[52px] w-full min-w-0 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="all">{t.antibiogram.allSpecimens}</option>
              {specimenTypes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          </div>

          <div className="w-full shrink-0 xl:w-44">
            <label htmlFor="filter-standard" className="mb-3 flex min-h-10 items-center justify-center whitespace-nowrap text-center text-sm font-medium leading-tight text-slate-600">
              {t.settings.standard}
            </label>
            <select
              id="filter-standard"
              value={standard}
              onChange={(e) => {
                const next = e.target.value as 'CLSI' | 'EUCAST';
                setStandard(next);
                localStorage.setItem('antibiogram-standard', next);
              }}
              className="h-[52px] w-full min-w-0 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="CLSI">{t.settings.clsi}</option>
              <option value="EUCAST">{t.settings.eucast}</option>
            </select>
          </div>

          <div className="w-full shrink-0 xl:w-44">
            <label htmlFor="filter-view" className="mb-3 flex min-h-10 items-center justify-center whitespace-nowrap text-center text-sm font-medium leading-tight text-slate-600">
              {t.common.view}
            </label>
            <select
              id="filter-view"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as 'chart' | 'table')}
              className="h-[52px] w-full min-w-0 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="chart">{t.common.chart}</option>
              <option value="table">{t.common.table}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
            <Microscope className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-xl font-semibold text-slate-800 mb-2">{t.antibiogram.noData}</h3>
          <p className="text-slate-500">{t.antibiogram.uploadPrompt}</p>
        </div>
      ) : viewMode === 'chart' && hospitalView === 'separate' && selectedHospitals.size > 1 ? (
        /* ── Separate per-hospital matrices ── */
        <div className="space-y-8">
          {[...selectedHospitals].map((hid) => {
            const hName = hospitals.find((h) => h.id === hid)?.name || hid;
            const hRows = data.filter((d) => d.hospital_id === hid);
            if (hRows.length === 0) return null;
            const hChart = buildChartDataFromRows(hRows);
            return (
              <div key={hid} className="space-y-3">
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-teal-600" />
                  <h2 className="text-lg font-semibold text-slate-800">{hName}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {hRows.reduce((s, r) => s + (r.total_tested || 0), 0)} {isRTL ? 'عزلة' : 'isolates'}
                  </span>
                </div>
                <AntibiogramMatrix data={hChart} antibioticOrder={antibiotics} standard={standard} sparklines={sparklines} />
              </div>
            );
          })}
        </div>
      ) : viewMode === 'chart' ? (
        <div className="space-y-6">
          <div className="flex justify-end">
            <label htmlFor="chart-scope" className="flex items-center gap-2 text-sm font-medium text-slate-600">
              {t.antibiogram.chartScope}
              <select
                id="chart-scope"
                value={chartScope}
                onChange={(e) => setChartScope(e.target.value as 'unified' | 'organism')}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="unified">{t.antibiogram.unifiedChart}</option>
                <option value="organism">{t.antibiogram.byOrganismChart}</option>
              </select>
            </label>
          </div>
          {chartScope === 'unified' ? (
            <AntibiogramMatrix data={chartData} antibioticOrder={antibiotics} standard={standard} sparklines={sparklines} />
          ) : Object.entries(groupedData).map(([organism, organismData]) => (
            <AntibiogramChart
              key={organism}
              organism={organism}
              data={organismData}
              standard={standard}
              hospital={selectedHospitals.size === 0 ? t.antibiogram.allHospitals : selectedHospitals.size === 1 ? hospitals.find(h => h.id === [...selectedHospitals][0])?.name || '' : `${selectedHospitals.size} hospitals`}
              year={selectedYear === 'all' ? t.antibiogram.selectYear : String(selectedYear)}
              period={selectedPeriod === 'all' ? t.antibiogram.allPeriods : getPeriodLabel(selectedPeriod)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-r from-slate-50 to-slate-100">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">{t.antibiogram.selectOrganism}</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">{t.antibiogram.antibiotic}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{t.antibiogram.susceptible}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{t.antibiogram.intermediate}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{t.antibiogram.resistant}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{t.antibiogram.total}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{t.antibiogram.percent}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((row, idx) => {
                  const policy = antibioticCatalog.find(
                    (c) => c.name.trim().toLowerCase() === row.antibiotic.trim().toLowerCase()
                  );
                  return (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-800">{row.organism}</td>
                      <td className="px-6 py-4 text-slate-600">
                        <div className="flex items-center gap-2">
                          <span>{row.antibiotic}</span>
                          {policy?.policy_status && (
                            <PolicyBadge status={policy.policy_status} notes={policy.policy_notes} />
                          )}
                        </div>
                      </td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-medium">
                        {row.susceptible_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-3 py-1 rounded-lg bg-amber-100 text-amber-700 font-medium">
                        {row.intermediate_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-3 py-1 rounded-lg bg-rose-100 text-rose-700 font-medium">
                        {row.resistant_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-slate-700">{row.total_tested}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-3 py-1 rounded-lg font-bold ${
                        row.susceptible_percent >= 80
                          ? 'bg-emerald-100 text-emerald-700'
                          : row.susceptible_percent >= 60
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}>
                        {row.susceptible_percent}%
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Insights (optional — only active when enabled in Settings) */}
      {!loading && data.length > 0 && (
        <AIInsightsPanel
          hospitalName={selectedHospitals.size === 0 ? t.antibiogram.allHospitals : selectedHospitals.size === 1 ? hospitals.find(h => h.id === [...selectedHospitals][0])?.name || '' : `${selectedHospitals.size} hospitals`}
          year={selectedYear === 'all' ? '—' : selectedYear}
          period={selectedPeriod === 'all' ? undefined : getPeriodLabel(selectedPeriod)}
          standard={(localStorage.getItem('antibiogram-standard') as string) || data[0]?.standard || 'CLSI'}
          data={data}
        />
      )}

      {/* Customize Order Modal */}
      {showCustomizeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCustomizeModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-semibold text-slate-800">{t.antibiogram.customizeOrder}</h2>
              <p className="text-sm text-slate-500 mt-1">{t.hospitals.files}</p>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4">
                {t.antibiogram.customizeOrder}
              </p>
              <div className="space-y-2">
                {antibiotics.map((antibiotic, index) => (
                  <div
                    key={antibiotic}
                    draggable
                    onDragStart={() => handleDragStart(antibiotic)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-move hover:bg-slate-100 transition-colors"
                  >
                    <GripVertical className="w-5 h-5 text-slate-400" />
                    <span className="flex-1 text-slate-700">{antibiotic}</span>
                    <span className="text-xs text-slate-400">{index + 1}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCustomizeModal(false)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleSaveAntibioticOrder}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg hover:shadow-xl transition-all"
                >
                  {t.common.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowTemplateModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-semibold text-slate-800">{t.antibiogram.saveAsTemplate}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="template-name" className="block text-sm font-medium text-slate-700 mb-2">
                  {t.antibiogram.templateName}
                </label>
                <input
                  id="template-name"
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={t.antibiogram.templateName}
                  className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl">
                <p className="text-sm text-slate-600">
                  <span className="font-medium">{t.hospitals.files}:</span> {activeSingleHospital ? hospitals.find(h => h.id === activeSingleHospital)?.name : '—'}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  <span className="font-medium">{t.antibiogram.selectYear}:</span> {selectedYear === 'all' ? t.antibiogram.selectYear : selectedYear}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  <span className="font-medium">{t.antibiogram.selectPeriod}:</span> {selectedPeriod === 'all' ? t.antibiogram.allPeriods : getPeriodLabel(selectedPeriod)}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowTemplateModal(false)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  {t.common.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
