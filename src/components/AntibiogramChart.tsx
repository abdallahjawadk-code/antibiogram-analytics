import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Info, BarChart3, Table } from 'lucide-react';
import { SUSCEPTIBILITY_THRESHOLDS, BAND_COLORS, susceptibilityBand, isReliable, MIN_RELIABLE_ISOLATES, wilson95CI } from '../lib/clinical';
import { getAntibioticCatalog } from '../lib/supabase';
import { AntibioticCatalogEntry } from '../types/database';
import { PolicyBadge } from './PolicyBadge';
import { ChartExportActions } from './ChartExportActions';

interface ChartData {
  antibiotic: string;
  susceptible: number;
  intermediate: number;
  resistant: number;
  total: number;
  organism: string;
  mic_distribution?: Record<string, number> | null;
}

interface AntibiogramChartProps {
  organism: string;
  data: ChartData[];
  standard: 'CLSI' | 'EUCAST';
  hospital: string;
  year: string;
  period?: string;
}

export function AntibiogramChart({ organism, data, standard, hospital, year, period }: AntibiogramChartProps) {
  const { t, isRTL } = useLanguage();
  const [viewMode, setViewMode] = useState<'chart' | 'bars'>('chart');
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AntibioticCatalogEntry[]>([]);

  useEffect(() => {
    getAntibioticCatalog()
      .then(setCatalog)
      .catch((err) => console.error('Failed to load antibiotic catalog in chart:', err));
  }, []);

  const getPolicy = (name: string) => {
    return catalog.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  };


  const getBarColor = (percent: number) => BAND_COLORS[susceptibilityBand(percent)];

  const chartData = data.map((d) => ({
    ...d,
    name: d.antibiotic,
    value: d.susceptible,
    fill: getBarColor(d.susceptible),
    reliable: isReliable(d.total),
  }));

  const totalIsolates = data.reduce((sum, d) => sum + d.total, 0);

  const micDataItems = data.filter(
    (d) => d.mic_distribution && Object.keys(d.mic_distribution).length > 0
  );

  const [selectedMicAntibiotic, setSelectedMicAntibiotic] = useState<string | null>(null);

  const currentSelected = selectedMicAntibiotic && micDataItems.some(d => d.antibiotic === selectedMicAntibiotic)
    ? selectedMicAntibiotic
    : (micDataItems[0]?.antibiotic || null);

  const selectedItem = micDataItems.find(d => d.antibiotic === currentSelected);
  const micDistribution = selectedItem?.mic_distribution || {};

  const getMicNumericValue = (key: string): number => {
    const numStr = key.replace(/[^\d.]/g, '');
    const val = parseFloat(numStr);
    return isNaN(val) ? 0 : val;
  };

  const histogramData = Object.entries(micDistribution)
    .map(([mic, count]) => ({
      mic,
      count: Number(count),
      numericValue: getMicNumericValue(mic),
    }))
    .sort((a, b) => a.numericValue - b.numericValue);

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">{organism}</h3>
            <p className="text-teal-100 text-sm mt-1">
              {t.antibiogram.isolateCount}: {totalIsolates.toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {viewMode === 'chart' && <ChartExportActions targetId={`antibiogram-chart-${organism}`} title={`${organism} – ${isRTL ? 'مخطط الحساسية' : 'Susceptibility chart'}`} fileName={`${organism}-susceptibility`} compact />}
            <button
              onClick={() => setViewMode('chart')}
              aria-label={isRTL ? 'عرض بياني' : 'Chart view'}
              aria-pressed={viewMode === 'chart'}
              className={`p-2 rounded-xl transition-colors ${
                viewMode === 'chart' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'
              }`}
            >
              <BarChart3 className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('bars')}
              aria-label={isRTL ? 'عرض جدول' : 'Bar list view'}
              aria-pressed={viewMode === 'bars'}
              className={`p-2 rounded-xl transition-colors ${
                viewMode === 'bars' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'
              }`}
            >
              <Table className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Info Bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-slate-50 border-b border-slate-100 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500" />
          <span>{t.antibiogram.susceptible} (≥{SUSCEPTIBILITY_THRESHOLDS.good}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          <span>{t.antibiogram.intermediate} ({SUSCEPTIBILITY_THRESHOLDS.moderate}-{SUSCEPTIBILITY_THRESHOLDS.good - 1}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-rose-500" />
          <span>{t.antibiogram.resistant} (&lt;{SUSCEPTIBILITY_THRESHOLDS.moderate}%)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span className="font-bold">*</span>
          <span>n &lt; {MIN_RELIABLE_ISOLATES}</span>
        </div>
        <div className="mr-auto flex items-center gap-1 text-slate-400">
          <Info className="w-4 h-4" />
          <span>{standard === 'CLSI' ? t.antibiogram.clsiStandards : t.antibiogram.eucastStandards}</span>
        </div>
      </div>

      {/* Chart */}
      {viewMode === 'chart' ? (
        <div className="p-6">
          <div
            id={`antibiogram-chart-${organism}`}
            className="h-[400px]"
            role="img"
            aria-label={
              (isRTL
                ? `مخطط نسبة الحساسية لـ ${organism}: `
                : `Susceptibility chart for ${organism}: `) +
              chartData.map((d) => `${d.antibiotic} ${d.susceptible.toFixed(0)}%`).join(', ')
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <ReferenceLine x={SUSCEPTIBILITY_THRESHOLDS.good} stroke="#10b981" strokeDasharray="5 5" />
                <ReferenceLine x={SUSCEPTIBILITY_THRESHOLDS.moderate} stroke="#f59e0b" strokeDasharray="5 5" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as ChartData;
                    const policy = getPolicy(d.antibiotic);
                    return (
                      <div className="bg-white rounded-xl shadow-xl p-4 border border-slate-100">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-semibold text-slate-800">{d.antibiotic}</p>
                          {policy?.policy_status && (
                            <PolicyBadge status={policy.policy_status} notes={policy.policy_notes} />
                          )}
                        </div>
                        {!isReliable(d.total) && (
                          <p className="text-xs text-amber-600 mb-2">
                            * n &lt; {MIN_RELIABLE_ISOLATES} — {standard === 'CLSI' ? 'CLSI M39' : ''} unreliable estimate
                          </p>
                        )}
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">{t.antibiogram.susceptible}</span>
                            <span className="font-medium text-emerald-600">{d.susceptible.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">{t.antibiogram.intermediate}</span>
                            <span className="font-medium text-amber-600">{d.intermediate.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">{t.antibiogram.resistant}</span>
                            <span className="font-medium text-rose-600">{d.resistant.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between gap-4 border-t pt-1 mt-1">
                            <span className="text-slate-500">{t.antibiogram.total}</span>
                            <span className="font-medium text-slate-700">{d.total}</span>
                          </div>
                          {(() => {
                            const ci = wilson95CI(Math.round((d.susceptible / 100) * d.total), d.total);
                            return (
                              <div className="flex justify-between gap-4">
                                <span className="text-slate-500">95% CI</span>
                                <span className="font-medium text-slate-700">{ci.low}–{ci.high}%</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="susceptible"
                  radius={[0, 4, 4, 0]}
                  animationDuration={800}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.fill}
                      onMouseEnter={() => setHoveredBar(entry.name)}
                      onMouseLeave={() => setHoveredBar(null)}
                      style={{
                        filter: hoveredBar === entry.name ? 'brightness(1.1)' : 'none',
                        transition: 'filter 0.2s',
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="p-6 space-y-3">
          {chartData.map((d, idx) => (
            <div
              key={idx}
              aria-label={`${d.antibiotic}: ${d.susceptible.toFixed(0)}% ${t.antibiogram.susceptible} (n=${d.total})`}
              className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-800 truncate">
                    {d.antibiotic}
                    {!d.reliable && <span className="text-amber-500 ml-1" title={`n < ${MIN_RELIABLE_ISOLATES}`}>*</span>}
                  </p>
                  {(() => {
                    const policy = getPolicy(d.antibiotic);
                    return policy?.policy_status ? (
                      <PolicyBadge status={policy.policy_status} notes={policy.policy_notes} />
                    ) : null;
                  })()}
                </div>
                <p className="text-xs text-slate-400">{t.antibiogram.total}: {d.total}</p>
              </div>
              <div className="w-32 flex items-center gap-2">
                <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${d.susceptible}%`, backgroundColor: d.fill }}
                  />
                </div>
                <span
                  className="text-sm font-bold"
                  style={{ color: BAND_COLORS[susceptibilityBand(d.susceptible)] }}
                >
                  {d.susceptible.toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MIC Distribution Section */}
      {micDataItems.length > 0 && currentSelected && (
        <div className="border-t border-slate-100 p-6 bg-slate-50/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h4 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-teal-600" />
                {t.antibiogram.micDistribution}
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                {isRTL
                  ? `ملف تعريف تكرار الحد الأدنى للتركيز المثبط لـ ${currentSelected}`
                  : `Minimum Inhibitory Concentration frequency profile for ${currentSelected}`}
              </p>
            </div>
            {micDataItems.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="mic-antibiotic-select" className="text-xs font-medium text-slate-500 whitespace-nowrap">
                  {t.antibiogram.selectAntibioticForMic}:
                </label>
                <select
                  id="mic-antibiotic-select"
                  value={currentSelected}
                  onChange={(e) => setSelectedMicAntibiotic(e.target.value)}
                  className="text-sm px-3 py-1.5 bg-white rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                >
                  {micDataItems.map((item) => (
                    <option key={item.antibiotic} value={item.antibiotic}>
                      {item.antibiotic}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="h-[280px] w-full bg-white rounded-2xl border border-slate-100 p-4 shadow-sm relative">
            <div className="absolute end-4 top-4 z-10">
              <ChartExportActions targetId={`mic-chart-${organism}`} title={`${organism} – MIC ${currentSelected}`} fileName={`${organism}-mic-${currentSelected}`} compact />
            </div>
            <div id={`mic-chart-${organism}`} className="h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={histogramData}
                margin={{ top: 20, right: 20, left: 10, bottom: 25 }}
              >
                <defs>
                  <linearGradient id="micGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.85}/>
                    <stop offset="95%" stopColor="#0891b2" stopOpacity={0.85}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="mic"
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                  label={{
                    value: t.antibiogram.micValue,
                    position: 'insideBottom',
                    offset: -12,
                    fill: '#64748b',
                    fontSize: 12,
                    fontWeight: 600
                  }}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                  label={{
                    value: t.antibiogram.frequency,
                    angle: -90,
                    position: 'insideLeft',
                    offset: 0,
                    fill: '#64748b',
                    fontSize: 12,
                    fontWeight: 600
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.05)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-xl p-3 border border-slate-100 text-xs">
                        <p className="font-semibold text-slate-800">
                          {t.antibiogram.micValue}: {d.mic}
                        </p>
                        <p className="text-slate-500 mt-1.5 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-teal-500" />
                          {t.antibiogram.frequency}: <span className="font-bold text-slate-800">{d.count.toLocaleString()}</span>
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {((d.count / (selectedItem?.total || 1)) * 100).toFixed(1)}% of total tested ({selectedItem?.total})
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="url(#micGradient)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={60}
                  animationDuration={800}
                />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 flex items-center justify-between">
        <span>{t.print.hospital}: {hospital || t.antibiogram.allHospitals}</span>
        <span>{t.print.year}: {year}</span>
        {period && <span>{t.antibiogram.selectPeriod}: {period}</span>}
        <span>{t.print.standard}: {standard}</span>
      </div>
    </div>
  );
}
