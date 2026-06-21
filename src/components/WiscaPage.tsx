import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData, getYears, getOrganisms, getSpecimenTypes, getSyndromeCatalog, addSyndrome, deleteSyndrome } from '../lib/supabase';
import { Hospital, AntibiogramData, SyndromeCatalogEntry } from '../types/database';
import { weightedCoverage, coverageBand, BAND_COLORS, MIN_RELIABLE_ISOLATES } from '../lib/clinical';
import { Syringe, Building2, Calendar, Bug, Info, Layers, ChevronDown, X, Search, Check, FlaskConical, ThumbsUp, AlertCircle, GitMerge } from 'lucide-react';

/** Period options: all / annual / quarterly / semi-annual. */
const PERIODS: { v: string; en: string; ar: string }[] = [
  { v: 'all', en: 'All periods', ar: 'كل الفترات' },
  { v: 'annual', en: 'Annual', ar: 'سنوي' },
  { v: 'Q1', en: 'Q1 (Jan–Mar)', ar: 'الربع الأول' },
  { v: 'Q2', en: 'Q2 (Apr–Jun)', ar: 'الربع الثاني' },
  { v: 'Q3', en: 'Q3 (Jul–Sep)', ar: 'الربع الثالث' },
  { v: 'Q4', en: 'Q4 (Oct–Dec)', ar: 'الربع الرابع' },
  { v: 'H1', en: 'H1 (Jan–Jun)', ar: 'النصف الأول' },
  { v: 'H2', en: 'H2 (Jul–Dec)', ar: 'النصف الثاني' },
];

export function WiscaPage() {
  const { isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [organisms, setOrganisms] = useState<string[]>([]);
  const [data, setData] = useState<AntibiogramData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHospital, setSelectedHospital] = useState('all');
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [selectedSpecimen, setSelectedSpecimen] = useState('all');
  const [specimenTypes, setSpecimenTypes] = useState<string[]>([]);

  // Organism picker state
  const [selectedOrganisms, setSelectedOrganisms] = useState<string[]>([]);
  const [organismDropdownOpen, setOrganismDropdownOpen] = useState(false);
  const [organismSearch, setOrganismSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Saved syndromes / presets state
  const [syndromes, setSyndromes] = useState<SyndromeCatalogEntry[]>([]);
  const [presetName, setPresetName] = useState('');

  const reloadSyndromes = () => {
    getSyndromeCatalog().then(setSyndromes).catch(() => setSyndromes([]));
  };

  useEffect(() => {
    reloadSyndromes();
  }, []);

  const applySyndrome = (syndrome: SyndromeCatalogEntry) => {
    setSelectedOrganisms(syndrome.organisms.filter((o) => organisms.includes(o)));
  };

  const handleDeleteSyndrome = async (id: string) => {
    try {
      await deleteSyndrome(id);
      reloadSyndromes();
    } catch {
      // ignore
    }
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name || selectedOrganisms.length === 0) return;
    try {
      await addSyndrome(name, selectedOrganisms);
      setPresetName('');
      reloadSyndromes();
    } catch {
      // ignore
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOrganismDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOrganism = (org: string) => {
    setSelectedOrganisms((prev) =>
      prev.includes(org) ? prev.filter((o) => o !== org) : [...prev, org],
    );
  };

  const tx = isRTL
    ? {
        title: 'التغطية التجريبية (WISCA)',
        subtitle: 'أي مضاد أرجح أن ينجح قبل ظهور نتيجة الزرع؟',
        hospital: 'المستشفى', allHospitals: 'كل المستشفيات',
        year: 'السنة', allYears: 'كل السنوات',
        period: 'الفترة',
        organism: 'اختيار الكائن',
        specimen: 'نموذج العزلة', allSpecimens: 'كل النماذج',
        antibiotic: 'المضاد الحيوي', coverage: 'التغطية المتوقّعة', isolates: 'العزلات', orgs: 'الكائنات',
        noData: 'لا توجد بيانات. ارفع بيانات أو غيّر الفلاتر.',
        note: 'تقدير مرجّح من البيانات المُجمَّعة (تقريبي). أقل من 90% قد لا يكفي كعلاج تجريبي أوّلي. دعم قرار فقط — راجع الإرشادات المحلية.',
        low: '* عزلات قليلة (n < ' + MIN_RELIABLE_ISOLATES + ')',
        allOrganisms: 'كل الكائنات',
        selectOrganisms: 'اختر الكائنات...',
        searchOrganisms: 'ابحث عن كائن...',
        selectedCount: 'كائن محدد',
        clearAll: 'مسح الكل',
        noMatch: 'لا توجد نتائج',
        savedSyndromes: 'المتلازمات المحفوظة',
        presetNamePlaceholder: 'اسم المجموعة...',
        savePreset: 'حفظ كقالب',
      }
    : {
        title: 'Empiric Coverage (WISCA)',
        subtitle: 'Which antibiotic is most likely to work before culture results?',
        hospital: 'Hospital', allHospitals: 'All hospitals',
        year: 'Year', allYears: 'All years',
        period: 'Period',
        organism: 'Select organism',
        specimen: 'Specimen type', allSpecimens: 'All specimens',
        antibiotic: 'Antibiotic', coverage: 'Expected coverage', isolates: 'Isolates', orgs: 'Organisms',
        noData: 'No data. Upload data or change the filters.',
        note: 'Weighted estimate from aggregated data (approximate). Below 90% may be insufficient for first-line empiric therapy. Decision support only — consult local guidelines.',
        low: '* low isolate count (n < ' + MIN_RELIABLE_ISOLATES + ')',
        allOrganisms: 'All organisms',
        selectOrganisms: 'Select organisms...',
        searchOrganisms: 'Search organism...',
        selectedCount: 'selected',
        clearAll: 'Clear all',
        noMatch: 'No results',
        savedSyndromes: 'Saved syndromes',
        presetNamePlaceholder: 'Preset name...',
        savePreset: 'Save as preset',
      };

  useEffect(() => {
    getYears().then(setYears).catch(() => {});
    getHospitals().then(setHospitals).catch(() => {});
    // Catalog-merged organism universe (active catalog ∪ data, minus disabled).
    getOrganisms().then(setOrganisms).catch(() => {});
    getSpecimenTypes().then(setSpecimenTypes).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const filters: { hospitalId?: string; year?: number; period?: string; specimenType?: string } = {};
    if (selectedHospital !== 'all') filters.hospitalId = selectedHospital;
    if (selectedYear !== 'all') filters.year = selectedYear;
    if (selectedPeriod !== 'all') filters.period = selectedPeriod;
    if (selectedSpecimen !== 'all') filters.specimenType = selectedSpecimen;
    getAntibiogramData(filters)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [selectedHospital, selectedYear, selectedPeriod, selectedSpecimen]);

  // When no organisms are selected → use all; otherwise use the picked ones
  const includedOrganisms = useMemo(() => {
    if (selectedOrganisms.length === 0) return organisms;
    return selectedOrganisms.filter((o) => organisms.includes(o));
  }, [selectedOrganisms, organisms]);

  const coverage = useMemo(
    () => weightedCoverage(data, includedOrganisms),
    [data, includedOrganisms],
  );

  // Drug synergy: top combinations of 2 reliable antibiotics by union coverage
  const synergyCombos = useMemo(() => {
    const reliable = coverage.filter((r) => r.reliable && r.coverage > 0);
    if (reliable.length < 2) return [];
    const top = reliable.slice(0, Math.min(8, reliable.length)); // limit to top 8 for performance
    const combos: { a: string; b: string; combined: number; gain: number }[] = [];
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const pA = top[i].coverage / 100;
        const pB = top[j].coverage / 100;
        // P(A∪B) assuming independence: pA + pB - pA*pB
        const combined = Math.min(100, (pA + pB - pA * pB) * 100);
        combos.push({ a: top[i].antibiotic, b: top[j].antibiotic, combined, gain: combined - Math.max(top[i].coverage, top[j].coverage) });
      }
    }
    return combos.sort((a, b) => b.combined - a.combined).slice(0, 6);
  }, [coverage]);

  // Filtered organism list for dropdown search
  const filteredOrganisms = useMemo(() => {
    if (!organismSearch.trim()) return organisms;
    const q = organismSearch.toLowerCase();
    return organisms.filter((o) => o.toLowerCase().includes(q));
  }, [organisms, organismSearch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
          <Syringe className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{tx.title}</h1>
          <p className="text-slate-500 mt-0.5">{tx.subtitle}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div>
          <label htmlFor="wisca-hospital" className="block text-sm font-medium text-slate-600 mb-2">
            <Building2 className="w-4 h-4 inline-block mr-1" />{tx.hospital}
          </label>
          <select id="wisca-hospital" value={selectedHospital} onChange={(e) => setSelectedHospital(e.target.value)}
            className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none">
            <option value="all">{tx.allHospitals}</option>
            {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="wisca-year" className="block text-sm font-medium text-slate-600 mb-2">
            <Calendar className="w-4 h-4 inline-block mr-1" />{tx.year}
          </label>
          <select id="wisca-year" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none">
            <option value="all">{tx.allYears}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="wisca-period" className="block text-sm font-medium text-slate-600 mb-2">
            <Layers className="w-4 h-4 inline-block mr-1" />{tx.period}
          </label>
          <select id="wisca-period" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}
            className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none">
            {PERIODS.map((p) => <option key={p.v} value={p.v}>{isRTL ? p.ar : p.en}</option>)}
          </select>
        </div>

        {/* ── Specimen type filter ── */}
        <div>
          <label htmlFor="wisca-specimen" className="block text-sm font-medium text-slate-600 mb-2">
            <FlaskConical className="w-4 h-4 inline-block mr-1" />{tx.specimen}
          </label>
          <select id="wisca-specimen" value={selectedSpecimen} onChange={(e) => setSelectedSpecimen(e.target.value)}
            className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none">
            <option value="all">{tx.allSpecimens}</option>
            {specimenTypes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* ── Organism picker ── */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">
            <Bug className="w-4 h-4 inline-block mr-1" />{tx.organism}
          </label>

          {/* ── Saved syndromes / presets ── */}
          <div className="mb-2">
            {syndromes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {syndromes.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-xl text-xs font-medium
                               bg-gradient-to-r from-teal-50 to-cyan-50 text-teal-700 border border-teal-200"
                  >
                    <button
                      type="button"
                      onClick={() => applySyndrome(s)}
                      className="hover:underline"
                      title={tx.savedSyndromes}
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSyndrome(s.id)}
                      aria-label={isRTL ? `حذف ${s.name}` : `Delete ${s.name}`}
                      className="p-0.5 rounded-full hover:bg-teal-200 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={tx.presetNamePlaceholder}
                className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-slate-50 rounded-xl border border-slate-200
                           focus:border-teal-500 outline-none placeholder:text-slate-300"
              />
              <button
                type="button"
                onClick={handleSavePreset}
                disabled={selectedOrganisms.length === 0 || !presetName.trim()}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-xl border border-teal-200
                           bg-gradient-to-r from-teal-500 to-cyan-600 text-white
                           hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {tx.savePreset}
              </button>
            </div>
          </div>

          <div className="relative" ref={dropdownRef}>
            {/* Trigger button */}
            <button
              type="button"
              onClick={() => setOrganismDropdownOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={organismDropdownOpen}
              aria-label={tx.organism}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl border border-slate-200
                         hover:border-teal-400 focus:border-teal-500 outline-none transition-colors text-sm text-left"
            >
              <span className={selectedOrganisms.length === 0 ? 'text-slate-400' : 'text-slate-700 font-medium'}>
                {selectedOrganisms.length === 0
                  ? tx.allOrganisms
                  : `${selectedOrganisms.length} ${tx.selectedCount}`}
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${organismDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Selected organism tags */}
            {selectedOrganisms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedOrganisms.map((org) => (
                  <span
                    key={org}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium
                               bg-gradient-to-r from-teal-50 to-cyan-50 text-teal-700 border border-teal-200"
                  >
                    {org}
                    <button
                      type="button"
                      onClick={() => toggleOrganism(org)}
                      aria-label={isRTL ? `إزالة ${org}` : `Remove ${org}`}
                      className="p-0.5 rounded-full hover:bg-teal-200 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedOrganisms([])}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1"
                >
                  {tx.clearAll}
                </button>
              </div>
            )}

            {/* Dropdown panel */}
            {organismDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-xl
                              max-h-64 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                {/* Search input */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={organismSearch}
                    onChange={(e) => setOrganismSearch(e.target.value)}
                    placeholder={tx.searchOrganisms}
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-300"
                    autoFocus
                  />
                </div>
                {/* Organism list */}
                <div className="overflow-y-auto flex-1 py-1">
                  {filteredOrganisms.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">{tx.noMatch}</div>
                  ) : (
                    filteredOrganisms.map((org) => {
                      const selected = selectedOrganisms.includes(org);
                      return (
                        <button
                          key={org}
                          type="button"
                          onClick={() => toggleOrganism(org)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                            ${selected
                              ? 'bg-teal-50 text-teal-700 font-medium'
                              : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all
                            ${selected
                              ? 'border-teal-500 bg-teal-500'
                              : 'border-slate-300'}`}>
                            {selected && <Check className="w-3.5 h-3.5 text-white" />}
                          </span>
                          {org}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
        </div>
      ) : coverage.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 text-slate-500">{tx.noData}</div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">{tx.antibiotic}</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 w-1/2">{tx.coverage}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{tx.isolates}</th>
                  <th className="px-6 py-4 text-center font-semibold text-slate-700">{tx.orgs}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coverage.map((row) => {
                  const color = BAND_COLORS[coverageBand(row.coverage)];
                  return (
                    <tr key={row.antibiotic} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-800">
                        {row.antibiotic}{!row.reliable && <span className="text-amber-500 ml-1" title={tx.low}>*</span>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${row.coverage}%`, backgroundColor: color }} />
                          </div>
                          <span className="font-bold w-12 text-right" style={{ color }}>{row.coverage.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center text-slate-600">{row.isolates.toLocaleString()}</td>
                      <td className="px-6 py-4 text-center text-slate-600">{row.organisms}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Treatment recommendation banner */}
          {(() => {
            const top = coverage.filter((r) => r.reliable).sort((a, b) => b.coverage - a.coverage);
            const best = top[0];
            const adequate = top.filter((r) => r.coverage >= 90);
            if (!best) return null;
            const hasAdequate = adequate.length > 0;
            return (
              <div className={`px-6 py-4 border-t ${hasAdequate ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
                <div className="flex items-start gap-3">
                  {hasAdequate
                    ? <ThumbsUp className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
                  <div>
                    <p className={`text-sm font-semibold ${hasAdequate ? 'text-emerald-800' : 'text-amber-800'}`}>
                      {hasAdequate
                        ? (isRTL ? `التوصية: ${adequate[0].antibiotic} (تغطية ${adequate[0].coverage.toFixed(0)}%)` : `Recommended empiric: ${adequate[0].antibiotic} (${adequate[0].coverage.toFixed(0)}% coverage)`)
                        : (isRTL ? `أفضل خيار متاح: ${best.antibiotic} (${best.coverage.toFixed(0)}%) — لا يوجد مضاد يتجاوز 90%` : `Best available: ${best.antibiotic} (${best.coverage.toFixed(0)}%) — no agent exceeds 90%`)}
                    </p>
                    {hasAdequate && adequate.length > 1 && (
                      <p className="text-xs text-emerald-600 mt-0.5">
                        {isRTL
                          ? `بدائل مقبولة: ${adequate.slice(1, 3).map((r) => `${r.antibiotic} (${r.coverage.toFixed(0)}%)`).join('، ')}`
                          : `Alternatives ≥90%: ${adequate.slice(1, 3).map((r) => `${r.antibiotic} (${r.coverage.toFixed(0)}%)`).join(', ')}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="flex items-start gap-2 px-6 py-4 bg-amber-50 text-amber-700 text-xs border-t border-amber-100">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{tx.note}</span>
          </div>
        </div>
      )}

      {/* Drug Synergy Analysis */}
      {synergyCombos.length > 0 && (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <GitMerge className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">
                {isRTL ? 'تحليل التآزر الدوائي' : 'Drug Synergy Analysis'}
              </h3>
              <p className="text-sm text-slate-500">
                {isRTL ? 'التغطية المجمعة لثنائيات المضادات الحيوية (نموذج الاستقلالية)' : 'Combined coverage for antibiotic pairs (independence model)'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {synergyCombos.map(({ a, b, combined, gain }, idx) => {
              const isAdequate = combined >= 90;
              return (
                <div
                  key={idx}
                  className={`rounded-2xl p-4 border ${isAdequate ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-lg font-bold ${isAdequate ? 'text-emerald-700' : 'text-slate-700'}`}>
                      {combined.toFixed(0)}%
                    </span>
                    {gain > 0 && (
                      <span className="text-xs font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg border border-violet-200">
                        +{gain.toFixed(0)}% {isRTL ? 'مكسب' : 'gain'}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full ${isAdequate ? 'bg-emerald-500' : 'bg-violet-400'}`}
                      style={{ width: `${combined}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-slate-700 bg-white px-2 py-1 rounded-lg border border-slate-200">{a}</span>
                    <span className="text-[10px] text-slate-400">+</span>
                    <span className="text-xs font-medium text-slate-700 bg-white px-2 py-1 rounded-lg border border-slate-200">{b}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {isRTL
                ? 'يُحسب باستخدام نموذج الاستقلالية: P(A∪B) = P(A) + P(B) - P(A)×P(B). للاستخدام في التخطيط فقط — استشر الفريق الميكروبيولوجي قبل الاستخدام السريري.'
                : 'Computed via independence model: P(A∪B) = P(A) + P(B) − P(A)×P(B). For planning use only — consult microbiology before clinical application.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
