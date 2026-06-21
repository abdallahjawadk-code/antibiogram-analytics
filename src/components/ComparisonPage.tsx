import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData, getOrganisms, getYears, getAntibioticCatalog } from '../lib/supabase';
import { Hospital, AntibiogramData, AntibioticCatalogEntry } from '../types/database';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { Building2, Microscope, Calendar, TrendingUp, TrendingDown, Minus, AlertTriangle, Award, AlertCircle, Zap } from 'lucide-react';
import { PolicyBadge } from './PolicyBadge';
import { chiSquareTest } from '../lib/stats';
import { ChartExportActions } from './ChartExportActions';

export function ComparisonPage() {
  const { t, isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [organisms, setOrganisms] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [selectedHospitals, setSelectedHospitals] = useState<string[]>([]);
  const [selectedOrganism, setSelectedOrganism] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [data, setData] = useState<AntibiogramData[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'bar' | 'radar' | 'table'>('bar');
  const [antibioticCatalog, setAntibioticCatalog] = useState<AntibioticCatalogEntry[]>([]);

  useEffect(() => {
    getAntibioticCatalog()
      .then(setAntibioticCatalog)
      .catch((err) => console.error('Failed to load antibiotic catalog in comparison:', err));
  }, []);

  useEffect(() => {
    async function loadFilters() {
      try {
        const [hospitalsData, organismsData, yearsData] = await Promise.all([
          getHospitals(),
          getOrganisms(),
          getYears(),
        ]);
        setHospitals(hospitalsData);
        setOrganisms(organismsData);
        setYears(yearsData);
      } catch (error) {
        console.error('Error loading filters:', error);
      }
    }
    loadFilters();
  }, []);

  useEffect(() => {
    async function loadData() {
      if (selectedHospitals.length === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const allData: AntibiogramData[] = [];

        for (const hospitalId of selectedHospitals) {
          const filters: { hospitalId?: string; organism?: string; year?: number } = {
            hospitalId,
          };
          if (selectedOrganism !== 'all') filters.organism = selectedOrganism;
          if (selectedYear !== 'all') filters.year = selectedYear;

          const hospitalData = await getAntibiogramData(filters);
          allData.push(...hospitalData);
        }

        setData(allData);
      } catch (error) {
        console.error('Error loading comparison data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedHospitals, selectedOrganism, selectedYear]);

  function toggleHospital(id: string) {
    setSelectedHospitals((prev) =>
      prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]
    );
  }

  function selectAllHospitals() {
    setSelectedHospitals(hospitals.map((h) => h.id));
  }

  function deselectAllHospitals() {
    setSelectedHospitals([]);
  }

  // Quick Compare: auto-select the 2 hospitals with the most extreme overall susceptibility
  async function quickCompare(mode: 'best-worst' | 'most-data') {
    if (hospitals.length < 2) return;
    if (mode === 'most-data') {
      // Pick the 2 hospitals with the most uploaded records
      const allRows = await (await import('../lib/supabase')).getAntibiogramData({});
      const counts: Record<string, number> = {};
      allRows.forEach((r) => { counts[r.hospital_id] = (counts[r.hospital_id] ?? 0) + 1; });
      const sorted = hospitals
        .map((h) => ({ id: h.id, n: counts[h.id] ?? 0 }))
        .sort((a, b) => b.n - a.n);
      setSelectedHospitals(sorted.slice(0, 2).map((x) => x.id));
    } else {
      // Top susceptibility vs bottom (need at least one data point per hospital)
      const allRows = await (await import('../lib/supabase')).getAntibiogramData({});
      const stats: Record<string, { s: number; n: number }> = {};
      allRows.forEach((r) => {
        if (!stats[r.hospital_id]) stats[r.hospital_id] = { s: 0, n: 0 };
        stats[r.hospital_id].s += r.susceptible_count ?? 0;
        stats[r.hospital_id].n += r.total_tested ?? 0;
      });
      const ranked = hospitals
        .filter((h) => (stats[h.id]?.n ?? 0) >= 30)
        .map((h) => ({ id: h.id, pct: stats[h.id].n > 0 ? (stats[h.id].s / stats[h.id].n) * 100 : 50 }))
        .sort((a, b) => b.pct - a.pct);
      if (ranked.length >= 2) setSelectedHospitals([ranked[0].id, ranked[ranked.length - 1].id]);
      else if (ranked.length === 1) setSelectedHospitals([ranked[0].id]);
    }
  }

  const colors = ['#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#3b82f6', '#10b981', '#f97316', '#06b6d4'];

  // Group data by antibiotic for comparison
  const comparisonData: Record<string, { antibiotic: string; [key: string]: string | number }> = {};
  const hospitalNames: Record<string, string> = {};

  hospitals.forEach((h) => {
    hospitalNames[h.id] = h.name;
  });

  data.forEach((d) => {
    if (!comparisonData[d.antibiotic]) {
      comparisonData[d.antibiotic] = { antibiotic: d.antibiotic };
    }
    comparisonData[d.antibiotic][hospitalNames[d.hospital_id]] = d.susceptible_percent;
  });

  const chartData = Object.values(comparisonData);

  // Calculate averages and identify best/worst performers
  const hospitalStats: Record<string, { total: number; count: number; average: number }> = {};
  data.forEach((d) => {
    const name = hospitalNames[d.hospital_id];
    if (!hospitalStats[name]) {
      hospitalStats[name] = { total: 0, count: 0, average: 0 };
    }
    hospitalStats[name].total += d.susceptible_percent;
    hospitalStats[name].count += 1;
  });

  Object.keys(hospitalStats).forEach((name) => {
    hospitalStats[name].average = hospitalStats[name].count > 0
      ? hospitalStats[name].total / hospitalStats[name].count
      : 0;
  });

  const sortedStats = Object.entries(hospitalStats)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.average - a.average);

  const regionalAverage = sortedStats.length > 0
    ? sortedStats.reduce((sum, s) => sum + s.average, 0) / sortedStats.length
    : 0;

  const dualComparisonList = useMemo(() => {
    if (selectedHospitals.length !== 2) return [];
    const id1 = selectedHospitals[0];
    const id2 = selectedHospitals[1];
    
    const abMap = new Map<string, {
      antibiotic: string;
      h1: { s: number; total: number };
      h2: { s: number; total: number };
    }>();
    
    data.forEach((row) => {
      if (row.hospital_id !== id1 && row.hospital_id !== id2) return;
      let abData = abMap.get(row.antibiotic);
      if (!abData) {
        abData = {
          antibiotic: row.antibiotic,
          h1: { s: 0, total: 0 },
          h2: { s: 0, total: 0 },
        };
        abMap.set(row.antibiotic, abData);
      }
      
      const target = row.hospital_id === id1 ? abData.h1 : abData.h2;
      target.s += row.susceptible_count || 0;
      target.total += row.total_tested || 0;
    });
    
    return Array.from(abMap.values())
      .filter(item => item.h1.total > 0 && item.h2.total > 0)
      .map(item => {
        const s1 = item.h1.s;
        const ns1 = item.h1.total - s1;
        const s2 = item.h2.s;
        const ns2 = item.h2.total - s2;
        
        const testResult = chiSquareTest(s1, ns1, s2, ns2);
        
        const r1 = (s1 / item.h1.total) * 100;
        const r2 = (s2 / item.h2.total) * 100;
        
        return {
          antibiotic: item.antibiotic,
          rate1: r1,
          total1: item.h1.total,
          rate2: r2,
          total2: item.h2.total,
          diff: Math.abs(r1 - r2),
          chi2: testResult.chi2,
          pValue: testResult.pValue,
          significant: testResult.pValue < 0.05,
          higher: r1 > r2 ? 'h1' : 'h2',
        };
      })
      .sort((a, b) => b.diff - a.diff);
  }, [data, selectedHospitals]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.comparison.title}</h1>
        <p className="text-slate-500 mt-1">{t.comparison.subtitle}</p>
      </div>

      {/* Hospital Selection */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">{t.comparison.selectHospitals}</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => void quickCompare('best-worst')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 font-medium transition-colors"
              title={isRTL ? 'أعلى وأدنى مستشفيين' : 'Best vs worst hospital'}
            >
              <Zap className="w-3.5 h-3.5" />
              {isRTL ? 'مقارنة سريعة' : 'Quick Compare'}
            </button>
            <button
              onClick={() => void quickCompare('most-data')}
              className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 font-medium transition-colors"
            >
              {isRTL ? 'أكثر بيانات' : 'Most data'}
            </button>
            <span className="text-slate-200">|</span>
            <button
              onClick={selectAllHospitals}
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              {t.common.selectAll}
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={deselectAllHospitals}
              className="text-sm text-slate-500 hover:text-slate-600 font-medium"
            >
              {t.common.deselectAll}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {hospitals.map((hospital) => (
            <button
              key={hospital.id}
              onClick={() => toggleHospital(hospital.id)}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                selectedHospitals.includes(hospital.id)
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                style={{
                  backgroundColor: selectedHospitals.includes(hospital.id)
                    ? colors[selectedHospitals.indexOf(hospital.id) % colors.length]
                    : '#94a3b8',
                }}
              >
                {hospital.name.charAt(0)}
              </div>
              <span className="text-sm font-medium text-slate-700 truncate">{hospital.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">
            <Microscope className="w-4 h-4 inline-block mr-1" />
            {t.comparison.selectOrganism}
          </label>
          <select
            value={selectedOrganism}
            onChange={(e) => setSelectedOrganism(e.target.value)}
            className="w-full px-4 py-3 bg-white rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
          >
            <option value="all">{t.antibiogram.allOrganisms}</option>
            {organisms.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">
            <Calendar className="w-4 h-4 inline-block mr-1" />
            {t.comparison.selectYear}
          </label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            className="w-full px-4 py-3 bg-white rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
          >
            <option value="all">{t.antibiogram.selectYear}</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">
            {t.common.view}
          </label>
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setViewMode('bar')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'bar' ? 'bg-white shadow text-teal-600' : 'text-slate-500'
              }`}
            >
              {t.comparison.susceptibilityRates}
            </button>
            <button
              onClick={() => setViewMode('radar')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'radar' ? 'bg-white shadow text-teal-600' : 'text-slate-500'
              }`}
            >
              {t.comparison.hospitalPerformance}
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'table' ? 'bg-white shadow text-teal-600' : 'text-slate-500'
              }`}
            >
              {t.hospitals.files}
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && selectedHospitals.length > 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
        </div>
      ) : selectedHospitals.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
          <Building2 className="w-16 h-16 mx-auto mb-4 text-slate-300" />
          <p className="text-slate-500">{t.comparison.selectHospitals}</p>
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-slate-300" />
          <p className="text-slate-500">{t.antibiogram.noData}</p>
        </div>
      ) : (
        <>
          {/* Performance Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Best Performer */}
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-6 text-white">
              <div className="flex items-center gap-3 mb-4">
                <Award className="w-8 h-8" />
                <h3 className="text-lg font-semibold">{t.comparison.bestPerforming}</h3>
              </div>
              {sortedStats[0] && (
                <div>
                  <p className="text-2xl font-bold">{sortedStats[0].name}</p>
                  <p className="text-emerald-100 mt-1">
                    {t.antibiogram.susceptibility}: {sortedStats[0].average.toFixed(1)}%
                  </p>
                </div>
              )}
            </div>

            {/* Needs Attention */}
            <div className="bg-gradient-to-br from-rose-500 to-pink-600 rounded-3xl p-6 text-white">
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle className="w-8 h-8" />
                <h3 className="text-lg font-semibold">{t.comparison.needsAttention}</h3>
              </div>
              {sortedStats[sortedStats.length - 1] && (
                <div>
                  <p className="text-2xl font-bold">{sortedStats[sortedStats.length - 1].name}</p>
                  <p className="text-rose-100 mt-1">
                    {t.antibiogram.susceptibility}: {sortedStats[sortedStats.length - 1].average.toFixed(1)}%
                  </p>
                </div>
              )}
            </div>

            {/* Regional Average */}
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl p-6 text-white">
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="w-8 h-8" />
                <h3 className="text-lg font-semibold">{t.comparison.regionalAverage}</h3>
              </div>
              <div>
                <p className="text-4xl font-bold">{regionalAverage.toFixed(1)}%</p>
                <p className="text-blue-100 mt-1">{t.antibiogram.susceptibility}</p>
              </div>
            </div>
          </div>

          {/* Dual Hospital Statistical Analytics */}
          {selectedHospitals.length === 2 && dualComparisonList.length > 0 && (
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    {t.comparison.dualTitle || 'Dual Hospital Analytics'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {isRTL
                      ? `مقارنة الحساسية والدلالة الإحصائية بين ${hospitalNames[selectedHospitals[0]]} و ${hospitalNames[selectedHospitals[1]]}`
                      : `Susceptibility comparison & statistical significance between ${hospitalNames[selectedHospitals[0]]} and ${hospitalNames[selectedHospitals[1]]}`}
                  </p>
                </div>
                <div className="px-3 py-1 bg-teal-50 border border-teal-200 text-teal-700 rounded-xl text-xs font-semibold">
                  {isRTL ? 'اختبار مربع كاي (درجة حرية=1)' : 'Chi-Square test (df=1)'}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 font-semibold text-center">
                    <tr>
                      <th className="px-6 py-3 text-left">{t.antibiogram.antibiotic}</th>
                      <th className="px-6 py-3 text-center">{hospitalNames[selectedHospitals[0]]}</th>
                      <th className="px-6 py-3 text-center">{hospitalNames[selectedHospitals[1]]}</th>
                      <th className="px-6 py-3 text-center">{isRTL ? 'الفرق المطلق' : 'Abs. Difference'}</th>
                      <th className="px-6 py-3 text-center">{t.comparison.pValue || 'P-Value'}</th>
                      <th className="px-6 py-3 text-center">{t.comparison.sigDifference || 'Significance'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {dualComparisonList.map((item) => {
                      const pFormatted = item.pValue < 0.001
                        ? '<0.001'
                        : item.pValue < 0.01
                        ? '<0.01'
                        : item.pValue.toFixed(3);
                      
                      let badgeStyle = 'bg-slate-100 text-slate-600';
                      let badgeText = t.comparison.noSig || 'No Significant Difference';
                      
                      if (item.significant) {
                        if (item.higher === 'h1') {
                          badgeStyle = 'bg-emerald-100 text-emerald-800';
                          badgeText = isRTL
                            ? `أعلى بدلالة في ${hospitalNames[selectedHospitals[0]].substring(0, 12)}...`
                            : `Higher in ${hospitalNames[selectedHospitals[0]].substring(0, 10)}...`;
                        } else {
                          badgeStyle = 'bg-violet-100 text-violet-800';
                          badgeText = isRTL
                            ? `أعلى بدلالة في ${hospitalNames[selectedHospitals[1]].substring(0, 12)}...`
                            : `Higher in ${hospitalNames[selectedHospitals[1]].substring(0, 10)}...`;
                        }
                      }
                      
                      const policy = antibioticCatalog.find(
                        (c) => c.name.trim().toLowerCase() === item.antibiotic.trim().toLowerCase()
                      );
                      return (
                        <tr key={item.antibiotic} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3.5 font-medium text-slate-800 text-left">
                            <div className="flex items-center gap-2">
                              <span>{item.antibiotic}</span>
                              {policy?.policy_status && (
                                <PolicyBadge status={policy.policy_status} notes={policy.policy_notes} />
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span className="font-semibold text-slate-700">{item.rate1.toFixed(1)}%</span>
                            <span className="text-xs text-slate-400 block">n = {item.total1}</span>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span className="font-semibold text-slate-700">{item.rate2.toFixed(1)}%</span>
                            <span className="text-xs text-slate-400 block">n = {item.total2}</span>
                          </td>
                          <td className="px-6 py-3.5 text-center font-medium text-slate-600">
                            {item.diff.toFixed(1)}%
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span className={`font-mono text-xs ${item.significant ? 'text-slate-800 font-bold' : 'text-slate-400'}`}>
                              {pFormatted}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-center font-medium">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${badgeStyle}`}>
                              {badgeText}
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

          {/* Hospital Stats */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-800 mb-4">{t.comparison.hospitalPerformance}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedStats.map((stat, index) => {
                const diff = stat.average - regionalAverage;
                const Icon = diff > 5 ? TrendingUp : diff < -5 ? TrendingDown : Minus;
                const color = diff > 5 ? 'text-emerald-600' : diff < -5 ? 'text-rose-600' : 'text-slate-400';

                return (
                  <div
                    key={stat.name}
                    className={`flex items-center gap-4 p-4 rounded-2xl ${
                      index === 0 ? 'bg-emerald-50 border border-emerald-200' :
                      index === sortedStats.length - 1 ? 'bg-rose-50 border border-rose-200' :
                      'bg-slate-50'
                    }`}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: colors[index % colors.length] }}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{stat.name}</p>
                      <p className="text-sm text-slate-500">
                        {stat.average.toFixed(1)}% ({stat.count} tests)
                      </p>
                    </div>
                    <div className={`flex items-center gap-1 ${color}`}>
                      <Icon className="w-5 h-5" />
                      <span className="text-sm font-medium">
                        {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          {viewMode === 'bar' && (
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <div className="mb-6 flex items-center justify-between gap-4"><h3 className="font-semibold text-slate-800">{t.comparison.susceptibilityRates}</h3><ChartExportActions targetId="comparison-bar-chart" title={t.comparison.susceptibilityRates} fileName="hospital-comparison" compact /></div>
              <div id="comparison-bar-chart" className="h-[500px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="antibiotic"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: '#64748b', fontSize: 12 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(value) => [`${Number(value).toFixed(1)}%`, '']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
                    />
                    <Legend />
                    {selectedHospitals.map((id, idx) => (
                      <Bar
                        key={id}
                        dataKey={hospitalNames[id]}
                        fill={colors[idx % colors.length]}
                        radius={[4, 4, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Radar Chart */}
          {viewMode === 'radar' && (
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <div className="mb-6 flex items-center justify-between gap-4"><h3 className="font-semibold text-slate-800">{t.comparison.hospitalPerformance}</h3><ChartExportActions targetId="comparison-radar-chart" title={t.comparison.hospitalPerformance} fileName="hospital-performance" compact /></div>
              <div id="comparison-radar-chart" className="h-[500px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={chartData.slice(0, 8)}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="antibiotic" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
                    {selectedHospitals.map((id, idx) => (
                      <Radar
                        key={id}
                        name={hospitalNames[id]}
                        dataKey={hospitalNames[id]}
                        stroke={colors[idx % colors.length]}
                        fill={colors[idx % colors.length]}
                        fillOpacity={0.2}
                      />
                    ))}
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Table View */}
          {viewMode === 'table' && (
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gradient-to-r from-slate-50 to-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-left font-semibold text-slate-700">{t.antibiogram.antibiotic}</th>
                      {selectedHospitals.map((id) => (
                        <th key={id} className="px-6 py-4 text-center font-semibold text-slate-700">
                          {hospitalNames[id]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {chartData.map((row, idx) => {
                      const policy = antibioticCatalog.find(
                        (c) => c.name.trim().toLowerCase() === row.antibiotic.trim().toLowerCase()
                      );
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-6 py-4 font-medium text-slate-800">
                            <div className="flex items-center gap-2">
                              <span>{row.antibiotic}</span>
                              {policy?.policy_status && (
                                <PolicyBadge status={policy.policy_status} notes={policy.policy_notes} />
                              )}
                            </div>
                          </td>
                        {selectedHospitals.map((id) => {
                          const value = row[hospitalNames[id]] as number | undefined;
                          return (
                            <td key={id} className="px-6 py-4 text-center">
                              {value !== undefined ? (
                                <span className={`px-3 py-1 rounded-lg font-medium ${
                                  value >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                  value >= 60 ? 'bg-amber-100 text-amber-700' :
                                  'bg-rose-100 text-rose-700'
                                }`}>
                                  {value.toFixed(1)}%
                                </span>
                              ) : '-'}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
