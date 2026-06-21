import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData, getOrganisms, getYears } from '../lib/supabase';
import { Hospital, AntibiogramData } from '../types/database';
import { computeSIR } from '../lib/clinical';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, Line, Legend } from 'recharts';
import { Building2, Microscope, TrendingUp, TrendingDown, Minus, Calendar, AlertTriangle, Info, ArrowUpRight, ArrowDownRight, Waves } from 'lucide-react';
import { calculateResistanceRegression, forecastSusceptibility } from '../lib/stats';
import { ChartExportActions } from './ChartExportActions';

const FORECAST_YEARS = [2027, 2028, 2029] as const;
const CRITICAL_RESISTANCE_THRESHOLD = 30;

type ForecastChartPoint = {
  year: number;
  historicalValue: number | null;
  forecastValue: number | null;
};

export function TrendsPage() {
  const { t, language } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [organisms, setOrganisms] = useState<string[]>([]);
  const [, setYears] = useState<number[]>([]);
  const [allData, setAllData] = useState<AntibiogramData[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<string>('all');
  const [selectedOrganism, setSelectedOrganism] = useState<string>('all');
  const [selectedAntibiotic, setSelectedAntibiotic] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<'1' | '3' | '5' | 'all'>('all');
  const [loading, setLoading] = useState(true);

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

        // Load all data initially
        const data = await getAntibiogramData({});
        setAllData(data);

        // Set initial antibiotic to first found
        if (data.length > 0) {
          const antibiotics = [...new Set(data.map(d => d.antibiotic))];
          if (antibiotics.length > 0) {
            setSelectedAntibiotic(antibiotics[0]);
          }
        }
      } catch (error) {
        console.error('Error loading filters:', error);
      } finally {
        setLoading(false);
      }
    }
    loadFilters();
  }, []);

  // Filter data
  const filteredData = allData.filter((d) => {
    if (selectedHospital !== 'all' && d.hospital_id !== selectedHospital) return false;
    if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
    if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;

    const currentYear = new Date().getFullYear();
    if (timeRange === '1' && d.year < currentYear - 1) return false;
    if (timeRange === '3' && d.year < currentYear - 3) return false;
    if (timeRange === '5' && d.year < currentYear - 5) return false;

    return true;
  });

  // Group by year for trend
  const trendData: { year: number; value: number; count: number }[] = [];
  const yearMap: Record<number, { susceptible: number; tested: number }> = {};

  filteredData.forEach((d) => {
    if (!yearMap[d.year]) {
      yearMap[d.year] = { susceptible: 0, tested: 0 };
    }
    const sir = computeSIR(d);
    if (sir.total <= 0) return;
    yearMap[d.year].susceptible += (sir.susceptible / 100) * sir.total;
    yearMap[d.year].tested += sir.total;
  });

  Object.entries(yearMap)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([year, stats]) => {
      trendData.push({
        year: parseInt(year),
        value: stats.tested > 0 ? (stats.susceptible / stats.tested) * 100 : 0,
        count: stats.tested,
      });
    });

  // Calculate trend
  const calculateTrend = () => {
    if (trendData.length < 2) return { direction: 'stable', change: 0 };

    const first = trendData[0].value;
    const last = trendData[trendData.length - 1].value;
    const change = last - first;

    if (Math.abs(change) < 2) return { direction: 'stable', change };
    return {
      direction: change > 0 ? 'increasing' : 'decreasing',
      change: Math.abs(change),
    };
  };

  const trend = calculateTrend();

  // Localize organism and antibiotic names
  const getLocalizedOrganism = (org: string) => {
    const orgMap: Record<string, string> = {
      'e. coli': 'ecoli',
      'k. pneumoniae': 'klebsiella',
      'klebsiella pneumoniae': 'klebsiella',
      'p. aeruginosa': 'pseudomonas',
      'pseudomonas aeruginosa': 'pseudomonas',
      'a. baumannii': 'acinetobacter',
      'acinetobacter baumannii': 'acinetobacter',
      's. aureus': 'saphylococcus',
      'staphylococcus aureus': 'saphylococcus',
      's. marcescens': 'serratia',
      'serratia marcescens': 'serratia',
      'e. cloacae': 'enterobacter',
      'enterobacter cloacae': 'enterobacter',
      'e. faecalis': 'enterococcus',
      'enterococcus faecalis': 'enterococcus',
      's. pneumoniae': 'streptococcus',
      'streptococcus pneumoniae': 'streptococcus',
      'salmonella spp.': 'salmonella',
      'salmonella': 'salmonella',
      'p. mirabilis': 'proteus',
      'proteus mirabilis': 'proteus'
    };
    const key = orgMap[org.toLowerCase().trim()];
    if (key && t.organisms[key as keyof typeof t.organisms]) {
      return t.organisms[key as keyof typeof t.organisms];
    }
    return org;
  };

  const getLocalizedAntibiotic = (anti: string) => {
    const antiMap: Record<string, string> = {
      'ampicillin': 'ampicillin',
      'amoxicillin-clavulanate': 'amoxiclav',
      'amoxiclav': 'amoxiclav',
      'piperacillin-tazobactam': 'piperacillin',
      'ceftriaxone': 'ceftriaxone',
      'cefepime': 'cefepime',
      'ceftazidime': 'ceftazidime',
      'meropenem': 'meropenem',
      'imipenem': 'imipenem',
      'ertapenem': 'ertapenem',
      'ciprofloxacin': 'ciprofloxacin',
      'levofloxacin': 'levofloxacin',
      'gentamicin': 'gentamicin',
      'amikacin': 'amikacin',
      'tobramycin': 'tobramycin',
      'trimethoprim-sulfamethoxazole': 'cotrimoxazole',
      'cotrimoxazole': 'cotrimoxazole',
      'nitrofurantoin': 'nitrofurantoin',
      'vancomycin': 'vancomycin',
      'linezolid': 'linezolid',
      'daptomycin': 'daptomycin',
      'tigecycline': 'tigecycline',
      'colistin': 'colistin'
    };
    const key = antiMap[anti.toLowerCase().trim()];
    if (key && t.antibiotics[key as keyof typeof t.antibiotics]) {
      return t.antibiotics[key as keyof typeof t.antibiotics];
    }
    return anti;
  };

  // Find all combos at risk
  const getAtRiskCombos = () => {
    const dataForRegression = allData.filter((d) => {
      if (d.year > 2026) return false;
      if (selectedHospital !== 'all' && d.hospital_id !== selectedHospital) return false;
      if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
      if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
      if (timeRange === '1' && d.year < 2025) return false;
      if (timeRange === '3' && d.year < 2023) return false;
      if (timeRange === '5' && d.year < 2021) return false;
      return true;
    });
    
    // Group by organism + antibiotic and then by year
    const groups: Record<string, Record<number, { susceptible: number; tested: number }>> = {};
    dataForRegression.forEach((d) => {
      // If user has selected a specific organism, only process that organism
      if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return;
      // If user has selected a specific antibiotic, only process that antibiotic
      if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return;

      const key = `${d.organism}::${d.antibiotic}`;
      if (!groups[key]) {
        groups[key] = {};
      }
      if (!groups[key][d.year]) {
        groups[key][d.year] = { susceptible: 0, tested: 0 };
      }
      const sir = computeSIR(d);
      if (sir.total <= 0) return;
      groups[key][d.year].susceptible += (sir.susceptible / 100) * sir.total;
      groups[key][d.year].tested += sir.total;
    });

    const results: {
      organism: string;
      antibiotic: string;
      year: number;
      value: number;
    }[] = [];

    Object.entries(groups).forEach(([key, yearMap]) => {
      const [organism, antibiotic] = key.split('::');
      const points = Object.entries(yearMap)
        .map(([year, stats]) => ({
          year: parseInt(year),
          susceptible: stats.tested > 0 ? (stats.susceptible / stats.tested) * 100 : 0,
        }))
        .sort((a, b) => a.year - b.year);

      if (points.length < 2) return; // Need at least 2 years for slope

      const regression = calculateResistanceRegression(points.map((point) => ({
        year: point.year,
        value: point.susceptible,
      })));
      if (!regression) return;

      // Predict for 2027, 2028, 2029
      for (const year of FORECAST_YEARS) {
        const predictedResistance = regression.slope * year + regression.intercept;
        if (predictedResistance > CRITICAL_RESISTANCE_THRESHOLD) {
          results.push({
            organism,
            antibiotic,
            year,
            value: Math.max(0, Math.min(100, predictedResistance)),
          });
          // Only report the earliest year it crosses
          break;
        }
      }
    });

    // Sort by resistance percentage descending
    return results.sort((a, b) => b.value - a.value);
  };

  const atRiskCombos = getAtRiskCombos();

  // Calculate regression specifically for the chart's trendData
  const chartRegression = calculateResistanceRegression(trendData);
  const hasForecast = chartRegression !== null;

  // Combined chart data
  const chartData: ForecastChartPoint[] = [];
  
  trendData.forEach((d) => {
    chartData.push({
      year: d.year,
      historicalValue: d.value,
      forecastValue: null,
    });
  });

  if (trendData.length > 0 && hasForecast) {
    const lastHistorical = trendData[trendData.length - 1];
    
    // Connect forecast to historical: set the last historical point's forecastValue
    chartData[chartData.length - 1].forecastValue = lastHistorical.value;

    // Forecasts are deliberately limited to the requested 2027–2029 horizon.
    FORECAST_YEARS.filter((year) => year > lastHistorical.year).forEach((year) => {
      const predictedSusceptibility = forecastSusceptibility(chartRegression, year, lastHistorical.value);
      chartData.push({
        year,
        historicalValue: null,
        forecastValue: parseFloat(predictedSusceptibility.toFixed(1)),
      });
    });
  }

  // Get unique antibiotics for dropdown
  const antibiotics = [...new Set(allData
    .filter(d => selectedOrganism === 'all' || d.organism === selectedOrganism)
    .map(d => d.antibiotic))];

  // Emerging resistance alerts
  const resistanceAlerts: { antibiotic: string; organism: string; rate: number; trend: string }[] = [];
  const groupedAlerts: Record<string, Record<string, { susceptible: number; tested: number }>> = {};

  allData.forEach((d) => {
    if (!groupedAlerts[d.organism]) {
      groupedAlerts[d.organism] = {};
    }
    if (!groupedAlerts[d.organism][d.antibiotic]) {
      groupedAlerts[d.organism][d.antibiotic] = { susceptible: 0, tested: 0 };
    }
    const sir = computeSIR(d);
    if (sir.total <= 0) return;
    groupedAlerts[d.organism][d.antibiotic].susceptible += (sir.susceptible / 100) * sir.total;
    groupedAlerts[d.organism][d.antibiotic].tested += sir.total;
  });

  Object.entries(groupedAlerts).forEach(([organism, antibiotics]) => {
    Object.entries(antibiotics).forEach(([antibiotic, stats]) => {
      const avgRate = stats.tested > 0 ? (stats.susceptible / stats.tested) * 100 : 0;
      if (avgRate < 50) {
        resistanceAlerts.push({
          antibiotic,
          organism,
          rate: avgRate,
          trend: 'high',
        });
      }
    });
  });

  resistanceAlerts.sort((a, b) => a.rate - b.rate);

  // Seasonality analysis: group by quarter (period field)
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
  const quarterStats: Record<string, { susceptible: number; tested: number }> = {};
  QUARTERS.forEach((q) => { quarterStats[q] = { susceptible: 0, tested: 0 }; });
  const seasonData = allData.filter((d) => {
    if (selectedHospital !== 'all' && d.hospital_id !== selectedHospital) return false;
    if (selectedOrganism !== 'all' && d.organism !== selectedOrganism) return false;
    if (selectedAntibiotic !== 'all' && d.antibiotic !== selectedAntibiotic) return false;
    return QUARTERS.includes(d.period as typeof QUARTERS[number]);
  });
  seasonData.forEach((d) => {
    const q = d.period as typeof QUARTERS[number];
    const sir = computeSIR(d);
    if (sir.total <= 0) return;
    quarterStats[q].susceptible += (sir.susceptible / 100) * sir.total;
    quarterStats[q].tested += sir.total;
  });
  const quarterPcts = QUARTERS.map((q) => ({
    q,
    pct: quarterStats[q].tested > 0 ? (quarterStats[q].susceptible / quarterStats[q].tested) * 100 : null,
    n: quarterStats[q].tested,
  }));
  const validQPcts = quarterPcts.filter((x) => x.pct !== null);
  const seasonMean = validQPcts.length > 0
    ? validQPcts.reduce((s, x) => s + x.pct!, 0) / validQPcts.length : null;
  const hasSeasonalData = validQPcts.length >= 2;
  const seasonalAnomaly = hasSeasonalData && seasonMean !== null
    ? validQPcts.filter((x) => Math.abs(x.pct! - seasonMean) > 5)
    : [];

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
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.trends.title}</h1>
        <p className="text-slate-500 mt-1">{t.trends.subtitle}</p>
      </div>

      {/* Early Warning Card/Banner */}
      {atRiskCombos.length > 0 && (
        <div className="bg-rose-50/60 border border-rose-200 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center animate-pulse">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-rose-900">{t.forecasting.warningTitle}</h3>
              <p className="text-sm text-rose-700/80">
                {language === 'ar' 
                  ? 'تم اكتشاف اتجاهات مقاومة حرجة تتجاوز الحد المسموح به (30٪)' 
                  : 'Critical resistance trends detected exceeding the 30% limit'}
              </p>
            </div>
          </div>
          
          <div className="max-h-[300px] overflow-y-auto space-y-4 pe-1 scrollbar-thin scrollbar-thumb-rose-200">
            {atRiskCombos.map((combo, idx) => {
              const localizedOrg = getLocalizedOrganism(combo.organism);
              const localizedAnti = getLocalizedAntibiotic(combo.antibiotic);
              const desc = t.forecasting.warningDesc
                .replace('{organism}', localizedOrg)
                .replace('{antibiotic}', localizedAnti)
                .replace('{year}', String(combo.year))
                .replace('{value}', combo.value.toFixed(1));

              return (
                <div key={idx} className="bg-white/80 rounded-2xl p-4 border border-rose-100 space-y-3">
                  <p className="text-sm md:text-base text-rose-950 font-medium leading-relaxed">
                    {desc}
                  </p>
                  
                  {/* Recommendations */}
                  <div className="pt-2 border-t border-rose-100/50">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-800 mb-2">
                      {language === 'ar' ? 'التوصيات السريرية وإجراءات الإشراف:' : 'Clinical Recommendations & Stewardship Actions:'}
                    </h4>
                    <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs md:text-sm text-rose-900/90">
                      <li className="flex gap-2 items-start bg-rose-50/40 p-2.5 rounded-xl border border-rose-100/30">
                        <span className="text-base">🔍</span>
                        <div>
                          <strong className="block text-rose-950">
                            {language === 'ar' ? 'مراجعة الإشراف' : 'Stewardship Review'}
                          </strong>
                          <span>
                            {language === 'ar' 
                              ? `تقييد استخدام ${localizedAnti} لعدوى ${localizedOrg}.` 
                              : `Restrict ${localizedAnti} usage for ${localizedOrg} infections.`}
                          </span>
                        </div>
                      </li>
                      <li className="flex gap-2 items-start bg-rose-50/40 p-2.5 rounded-xl border border-rose-100/30">
                        <span className="text-base">🧼</span>
                        <div>
                          <strong className="block text-rose-950">
                            {language === 'ar' ? 'مكافحة العدوى' : 'Infection Control'}
                          </strong>
                          <span>
                            {language === 'ar' 
                              ? 'تشديد احتياطات التلامس وغسيل الأيدي ونظافة البيئة.' 
                              : 'Enhance contact precautions, hand hygiene, and sanitation.'}
                          </span>
                        </div>
                      </li>
                      <li className="flex gap-2 items-start bg-rose-50/40 p-2.5 rounded-xl border border-rose-100/30">
                        <span className="text-base">🔬</span>
                        <div>
                          <strong className="block text-rose-950">
                            {language === 'ar' ? 'المراقبة المخبرية' : 'Lab Surveillance'}
                          </strong>
                          <span>
                            {language === 'ar' 
                              ? 'زيادة مراقبة سلالات المقاومة وفحص الجينات المقاومة.' 
                              : 'Increase screening for resistance mechanism genes.'}
                          </span>
                        </div>
                      </li>
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">
              <Building2 className="w-4 h-4 inline-block me-1" />
              {t.trends.selectHospital}
            </label>
            <select
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
            <label className="block text-sm font-medium text-slate-600 mb-2">
              <Microscope className="w-4 h-4 inline-block me-1" />
              {t.trends.selectOrganism}
            </label>
            <select
              value={selectedOrganism}
              onChange={(e) => setSelectedOrganism(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
            >
              <option value="all">{t.antibiogram.allOrganisms}</option>
              {organisms.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">
              {t.trends.selectAntibiotic}
            </label>
            <select
              value={selectedAntibiotic}
              onChange={(e) => setSelectedAntibiotic(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
            >
              <option value="all">{t.antibiogram.allAntibiotics}</option>
              {antibiotics.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">
              <Calendar className="w-4 h-4 inline-block me-1" />
              {t.trends.timeRange}
            </label>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as '1' | '3' | '5' | 'all')}
              className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 outline-none"
            >
              <option value="1">{t.trends.lastYear}</option>
              <option value="3">{t.trends.last3Years}</option>
              <option value="5">{t.trends.last5Years}</option>
              <option value="all">{t.trends.allTime}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">{t.trends.status}</label>
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${
              trend.direction === 'increasing'
                ? 'bg-emerald-50 text-emerald-700'
                : trend.direction === 'decreasing'
                ? 'bg-rose-50 text-rose-700'
                : 'bg-slate-50 text-slate-600'
            }`}>
              {trend.direction === 'increasing' ? (
                <TrendingUp className="w-5 h-5" />
              ) : trend.direction === 'decreasing' ? (
                <TrendingDown className="w-5 h-5" />
              ) : (
                <Minus className="w-5 h-5" />
              )}
              <span className="font-medium">
                {trend.direction === 'increasing'
                  ? t.trends.improving
                  : trend.direction === 'decreasing'
                  ? t.trends.worsening
                  : t.trends.stable}
              </span>
              <span className="text-sm opacity-70">
                ({trend.change > 0 ? '+' : ''}{trend.change.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trend Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 text-emerald-600 mb-2">
            <ArrowUpRight className="w-6 h-6" />
            <span className="font-semibold">{t.antibiogram.increasing}</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {Math.max(0, trendData.filter((d, i) => i === 0 || d.value > trendData[i - 1].value).length - 1)}
          </p>
          <p className="text-sm text-slate-500">{t.trends.yearOverYear}</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 text-rose-600 mb-2">
            <ArrowDownRight className="w-6 h-6" />
            <span className="font-semibold">{t.antibiogram.decreasing}</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {trendData.filter((d, i) => i > 0 && d.value < trendData[i - 1].value).length}
          </p>
          <p className="text-sm text-slate-500">{t.trends.yearOverYear}</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 text-slate-600 mb-2">
            <Microscope className="w-6 h-6" />
            <span className="font-semibold">{t.antibiogram.isolateCount}</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {filteredData.reduce((sum, d) => sum + d.total_tested, 0).toLocaleString()}
          </p>
          <p className="text-sm text-slate-500">{t.antibiogram.total}</p>
        </div>
      </div>

      {/* Trend Chart */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
          <h3 className="font-semibold text-slate-800">{t.trends.trendLine}</h3>
          <p className="text-sm text-slate-500 mt-1">
            {hasForecast ? t.forecasting.forecastYears : t.forecasting.insufficientData}
          </p>
          </div>
          <ChartExportActions targetId="trends-chart" title={t.trends.trendLine} fileName="susceptibility-trends" compact />
        </div>
        {trendData.length > 0 ? (
          <div id="trends-chart" className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(value, _name, props) => {
                    const isForecast = props.dataKey === 'forecastValue';
                    const label = isForecast 
                      ? (t.forecasting?.dottedLineLegend || 'Forecasted Trend')
                      : t.antibiogram.susceptibility;
                    return [`${Number(value).toFixed(1)}%`, label];
                  }}
                  labelFormatter={(label) => `${t.antibiogram.selectYear}: ${label}`}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
                />
                <Legend verticalAlign="top" height={36} />
                <ReferenceLine y={80} stroke="#10b981" strokeDasharray="5 5" label={{ value: '80%', position: 'right', fill: '#10b981' }} />
                <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: '60%', position: 'right', fill: '#f59e0b' }} />
                <Area
                  type="monotone"
                  dataKey="historicalValue"
                  name={t.antibiogram.susceptibility}
                  stroke="#14b8a6"
                  strokeWidth={3}
                  fill="url(#colorValue)"
                  connectNulls={false}
                />
                {hasForecast && (
                  <Line
                    type="monotone"
                    dataKey="forecastValue"
                    name={t.forecasting?.dottedLineLegend || 'Forecasted Trend'}
                    stroke="#14b8a6"
                    strokeWidth={3}
                    strokeDasharray="5 5"
                    dot={{ r: 4, stroke: '#14b8a6', strokeWidth: 2, fill: '#fff' }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-slate-400">
            {t.antibiogram.noData}
          </div>
        )}
      </div>

      {/* Emerging Resistance Alerts */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-slate-800">{t.trends.emergingResistance}</h3>
        </div>
        {resistanceAlerts.length > 0 ? (
          <div className="space-y-3">
            {resistanceAlerts.slice(0, 10).map((alert, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-4 p-4 rounded-xl ${
                  alert.rate < 30
                    ? 'bg-rose-50 border border-rose-200'
                    : alert.rate < 50
                    ? 'bg-amber-50 border border-amber-200'
                    : 'bg-slate-50'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-800">{alert.organism} - {alert.antibiotic}</p>
                  <p className="text-sm text-slate-500">
                    {t.antibiogram.susceptibility}: {alert.rate.toFixed(1)}%
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  alert.rate < 30
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {alert.rate < 30 ? t.alerts.critical : t.alerts.high}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Info className="w-5 h-5 mr-2" />
            {t.antibiogram.noData}
          </div>
        )}
      </div>

      {/* Year-over-Year Comparison Table */}
      {trendData.length > 1 && (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-4">{t.trends.yearOverYear}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t.antibiogram.selectYear}</th>
                  <th className="px-4 py-3 text-center font-medium text-slate-600">{t.antibiogram.susceptibility}</th>
                  <th className="px-4 py-3 text-center font-medium text-slate-600">{t.antibiogram.isolateCount}</th>
                  <th className="px-4 py-3 text-center font-medium text-slate-600">{t.trends.changePercent}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trendData.map((d, idx) => {
                  const prev = idx > 0 ? trendData[idx - 1].value : d.value;
                  const change = d.value - prev;

                  return (
                    <tr key={d.year} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{d.year}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-3 py-1 rounded-lg font-medium ${
                          d.value >= 80 ? 'bg-emerald-100 text-emerald-700' :
                          d.value >= 60 ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>
                          {d.value.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{d.count}</td>
                      <td className="px-4 py-3 text-center">
                        {idx > 0 && (
                          <span className={`flex items-center justify-center gap-1 ${
                            change > 0 ? 'text-emerald-600' : change < 0 ? 'text-rose-600' : 'text-slate-400'
                          }`}>
                            {change > 0 ? <ArrowUpRight className="w-4 h-4" /> : change < 0 ? <ArrowDownRight className="w-4 h-4" /> : null}
                            {change > 0 ? '+' : ''}{change.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Seasonality Detection Panel */}
      {hasSeasonalData && (
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Waves className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">
                {language === 'ar' ? 'التحليل الموسمي' : 'Seasonality Analysis'}
              </h3>
              <p className="text-sm text-slate-500">
                {language === 'ar' ? 'مقارنة الحساسية بين الأرباع' : 'Susceptibility by quarter'}
              </p>
            </div>
            {seasonalAnomaly.length > 0 && (
              <span className="ms-auto px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-xl">
                {language === 'ar' ? `${seasonalAnomaly.length} ربع شاذ` : `${seasonalAnomaly.length} quarter deviation`}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quarterPcts.map(({ q, pct, n }) => {
              const anomalous = seasonMean !== null && pct !== null && Math.abs(pct - seasonMean) > 5;
              const noData = pct === null;
              return (
                <div
                  key={q}
                  className={`rounded-2xl p-4 border text-center ${
                    noData ? 'bg-slate-50 border-slate-200' :
                    anomalous ? 'bg-amber-50 border-amber-200' :
                    'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-500 mb-1">{q}</div>
                  <div className={`text-2xl font-bold ${
                    noData ? 'text-slate-300' :
                    anomalous ? 'text-amber-700' : 'text-emerald-700'
                  }`}>
                    {noData ? '—' : `${pct!.toFixed(0)}%`}
                  </div>
                  {!noData && seasonMean !== null && (
                    <div className={`text-xs mt-1 ${
                      pct! - seasonMean > 5 ? 'text-emerald-600' :
                      pct! - seasonMean < -5 ? 'text-rose-600' : 'text-slate-400'
                    }`}>
                      {pct! - seasonMean > 0 ? '+' : ''}{(pct! - seasonMean).toFixed(1)}%
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1">n={n}</div>
                </div>
              );
            })}
          </div>
          {seasonalAnomaly.length > 0 && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 rounded-xl text-xs text-amber-700 border border-amber-100">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {language === 'ar'
                  ? `${seasonalAnomaly.map((x) => x.q).join('، ')} تُظهر انحرافاً عن المعدل الفصلي بأكثر من 5%`
                  : `${seasonalAnomaly.map((x) => x.q).join(', ')} deviate >5% from the quarterly mean — possible seasonal effect`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
