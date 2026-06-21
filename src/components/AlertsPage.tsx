import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getHospitals, getAntibiogramData } from '../lib/supabase';
import { Hospital, AntibiogramData } from '../types/database';
import { resistanceRate, isReliable, getOrganismGroup } from '../lib/clinical';
import { detectResistanceFlag } from '../lib/stats';
import { AlertTriangle, CheckCircle, Bell, Settings, ChevronDown, ChevronUp, Lightbulb, Shield, AlertOctagon, Biohazard } from 'lucide-react';

interface AlertItem {
  id: string;
  type: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  organism: string;
  antibiotic: string;
  hospital: string;
  hospitalId: string;
  rate: number;
  threshold: number;
  recommendation: string;
  empiricTherapy: string;
  infectionControl: string;
  timestamp: string;
  acknowledged: boolean;
}

const RECOMMENDATIONS: Record<string, { therapy: string; control: string }> = {
  carbapenem: {
    therapy: 'Review the local empiric-treatment pathway and patient-specific susceptibility results with infectious diseases / microbiology before changing therapy.',
    control: 'Ask the infection-prevention team to assess whether local precautions and surveillance are indicated.',
  },
  e_sbl: {
    therapy: 'Review the local empiric-treatment pathway and patient-specific susceptibility results with infectious diseases / microbiology before changing therapy.',
    control: 'Ask the infection-prevention team to assess whether local precautions and surveillance are indicated.',
  },
  mrsa: {
    therapy: 'Review the local empiric-treatment pathway and patient-specific susceptibility results with infectious diseases / microbiology before changing therapy.',
    control: 'Ask the infection-prevention team to assess whether local precautions and surveillance are indicated.',
  },
  vre: {
    therapy: 'Review the local empiric-treatment pathway and patient-specific susceptibility results with infectious diseases / microbiology before changing therapy.',
    control: 'Ask the infection-prevention team to assess whether local precautions and surveillance are indicated.',
  },
  cre: {
    therapy: 'Escalate promptly to infectious diseases / microbiology. This aggregate resistance signal cannot confirm an individual CRE isolate or select treatment.',
    control: 'Ask the infection-prevention team to assess whether local precautions and surveillance are indicated.',
  },
  vrsa: {
    therapy: 'Escalate promptly to infectious diseases / microbiology. This aggregate resistance signal cannot confirm an individual VRSA isolate or select treatment.',
    control: 'Ask the infection-prevention team to assess whether local precautions and surveillance are indicated.',
  },
  default: {
    therapy: 'Review susceptibility results and the local treatment pathway with infectious diseases / microbiology before changing therapy.',
    control: 'Review the finding with the infection-prevention team as appropriate.',
  },
};

export function AlertsPage() {
  const { t, isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [rawData, setRawData] = useState<AntibiogramData[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [filteredAlerts, setFilteredAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [filterHospital, setFilterHospital] = useState<string>('all');
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [thresholds, setThresholds] = useState(() => {
    const saved = localStorage.getItem('antibiogram-alert-thresholds');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.critical === 'number') return parsed;
      } catch {
        /* fall through to defaults */
      }
    }
    return { critical: 30, high: 50, medium: 70 };
  });

  // Persist thresholds so they survive a restart.
  useEffect(() => {
    localStorage.setItem('antibiogram-alert-thresholds', JSON.stringify(thresholds));
  }, [thresholds]);

  // Fetch the underlying data once. Threshold changes must NOT trigger a
  // network round-trip — classification happens locally below.
  useEffect(() => {
    async function loadData() {
      try {
        const [hospitalsData, antibiogramData] = await Promise.all([
          getHospitals(),
          getAntibiogramData(),
        ]);
        setHospitals(hospitalsData);
        setRawData(antibiogramData);
      } catch (error) {
        console.error('Error loading alerts:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Re-classify locally whenever the data or thresholds change.
  useEffect(() => {
    function getAlertTitle(_severity: string, d: AntibiogramData): string {
      const abLower = d.antibiotic.toLowerCase();
      const orgLower = d.organism.toLowerCase();
      const orgGroup = getOrganismGroup(d.organism);

      if (orgGroup === 'Enterobacterales' && (abLower.includes('meropenem') || abLower.includes('imipenem') || abLower.includes('ertapenem') || abLower.includes('doripenem'))) {
        return t.alerts.creAlert || 'Carbapenem-resistance signal in Enterobacterales';
      }
      if (orgGroup === 'Staphylococcus' && orgLower.includes('aureus') && abLower.includes('vancomycin')) {
        return t.alerts.vrsaAlert || 'Vancomycin-resistance signal in S. aureus';
      }
      if (abLower.includes('meropenem') || abLower.includes('imipenem') || abLower.includes('ertapenem')) {
        return t.alerts.carbapenemResistance;
      }
      if (d.organism.toLowerCase().includes('aureus')) {
        return t.alerts.mrsaAlert;
      }
      if (d.organism.toLowerCase().includes('enterococcus') && abLower.includes('vancomycin')) {
        return t.alerts.vreAlert;
      }
      if (d.susceptible_percent < 30) {
        return t.alerts.multiDrugResistance;
      }
      return t.alerts.newAlert;
    }

    const hospitalMap: Record<string, string> = {};
    hospitals.forEach((h) => {
      hospitalMap[h.id] = h.name;
    });

    // Generate alerts based on data
    const generatedAlerts: AlertItem[] = [];

    rawData.forEach((d: AntibiogramData) => {
          const abLower = d.antibiotic.toLowerCase();
          const rate = resistanceRate(d);

          // Aggregate antibiogram data can flag resistance signals, but cannot
          // establish an isolate-level CRE/VRSA diagnosis.
          const flag = detectResistanceFlag(d.organism, d.antibiotic);
          const isCRE = flag?.type === 'CRE' && rate > 0;
          const isVRSA = flag?.type === 'VRSA' && rate > 0;

          let severity: 'critical' | 'high' | 'medium' | 'low' | null = null;
          let alertType = 'default';

          if (isCRE) {
            severity = 'critical';
            alertType = 'cre';
          } else if (isVRSA) {
            severity = 'critical';
            alertType = 'vrsa';
          } else {
            // Skip statistically unreliable combinations (CLSI M39, n < 30) so
            // we don't raise alarms off a handful of isolates.
            if (!isReliable(d.total_tested)) return;

            // True resistance rate (%R), not 100 − %S, so intermediate isolates
            // are not miscounted as resistant.
            if (rate >= 100 - thresholds.critical) severity = 'critical';
            else if (rate >= 100 - thresholds.high) severity = 'high';
            else if (rate >= 100 - thresholds.medium) severity = 'medium';

            if (severity) {
              // Determine alert type
              if (abLower.includes('meropenem') || abLower.includes('imipenem') || abLower.includes('ertapenem')) {
                alertType = 'carbapenem';
              } else if (abLower.includes('ceftriaxone') || abLower.includes('cefepime') || abLower.includes('ceftazidime')) {
                alertType = 'e_sbl';
              } else if (d.organism.toLowerCase().includes('aureus') || d.organism.toLowerCase().includes('staph')) {
                alertType = 'mrsa';
              } else if (d.organism.toLowerCase().includes('enterococcus') && abLower.includes('vancomycin')) {
                alertType = 'vre';
              }
            }
          }

          if (severity) {
            generatedAlerts.push({
              id: `${d.id}-${severity}`,
              type: severity,
              title: getAlertTitle(severity, d),
              organism: d.organism,
              antibiotic: d.antibiotic,
              hospital: hospitalMap[d.hospital_id] || 'Unknown',
              hospitalId: d.hospital_id,
              rate,
              threshold: severity === 'critical' && (isCRE || isVRSA) ? 0 : 100 - thresholds[severity],
              recommendation: RECOMMENDATIONS[alertType].therapy,
              empiricTherapy: RECOMMENDATIONS[alertType].therapy,
              infectionControl: RECOMMENDATIONS[alertType].control,
              timestamp: d.created_at || new Date().toISOString(),
              acknowledged: false,
            });
          }
        });

        // Deduplicate and sort by severity
        const uniqueAlerts = generatedAlerts.reduce<Record<string, AlertItem>>((acc, alert) => {
          const key = `${alert.hospitalId}-${alert.organism}-${alert.antibiotic}`;
          if (!acc[key] || acc[key].rate < alert.rate) {
            acc[key] = alert;
          }
          return acc;
        }, {});

        const sortedAlerts = Object.values(uniqueAlerts).sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.type] - severityOrder[b.type];
        });

        setAlerts(sortedAlerts);
        setFilteredAlerts(sortedAlerts);
  }, [rawData, hospitals, thresholds, t]);

  useEffect(() => {
    let filtered = alerts;

    if (filterSeverity !== 'all') {
      filtered = filtered.filter((a) => a.type === filterSeverity);
    }

    if (filterHospital !== 'all') {
      filtered = filtered.filter((a) => a.hospitalId === filterHospital);
    }

    if (!showResolved) {
      filtered = filtered.filter((a) => !a.acknowledged);
    }

    setFilteredAlerts(filtered);
  }, [filterSeverity, filterHospital, showResolved, alerts]);

  function acknowledgeAlert(alertId: string) {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId ? { ...a, acknowledged: true } : a
      )
    );
  }

  const severityColors = {
    critical: 'from-rose-500 to-red-600',
    high: 'from-orange-500 to-amber-600',
    medium: 'from-yellow-500 to-amber-500',
    low: 'from-slate-400 to-slate-500',
  };

  const severityBgColors = {
    critical: 'bg-rose-50 border-rose-200',
    high: 'bg-orange-50 border-orange-200',
    medium: 'bg-yellow-50 border-yellow-200',
    low: 'bg-slate-50 border-slate-200',
  };

  const alertCounts = {
    critical: alerts.filter((a) => a.type === 'critical' && !a.acknowledged).length,
    high: alerts.filter((a) => a.type === 'high' && !a.acknowledged).length,
    medium: alerts.filter((a) => a.type === 'medium' && !a.acknowledged).length,
    low: alerts.filter((a) => a.type === 'low' && !a.acknowledged).length,
  };

  // ESKAPE pathogen summary computed from rawData
  const eskapePanel = [
    { key: 'E.faecium', label: 'E. faecium', orgKw: 'faecium', abKw: 'vancomycin', marker: 'VRE', color: 'purple' },
    { key: 'S.aureus', label: 'S. aureus', orgKw: 'aureus', abKw: 'oxacillin', marker: 'MRSA', color: 'rose' },
    { key: 'K.pneumoniae', label: 'K. pneumoniae', orgKw: 'klebsiella', abKw: 'meropenem', marker: 'CRE', color: 'red' },
    { key: 'A.baumannii', label: 'A. baumannii', orgKw: 'acinetobacter', abKw: 'meropenem', marker: 'CRAB', color: 'orange' },
    { key: 'P.aeruginosa', label: 'P. aeruginosa', orgKw: 'aeruginosa', abKw: 'meropenem', marker: 'CRPA', color: 'amber' },
    { key: 'Enterobacter', label: 'Enterobacter spp.', orgKw: 'enterobacter', abKw: 'meropenem', marker: 'CRE', color: 'yellow' },
  ].map(({ key, label, orgKw, abKw, marker, color }) => {
    const rows = rawData.filter(
      (d) => d.organism.toLowerCase().includes(orgKw) && d.antibiotic.toLowerCase().includes(abKw),
    );
    const totalS = rows.reduce((s, d) => s + (d.susceptible_count ?? 0), 0);
    const totalN = rows.reduce((s, d) => s + (d.total_tested ?? 0), 0);
    const resistPct = totalN > 0 ? 100 - (totalS / totalN) * 100 : null;
    return { key, label, marker, color, resistPct, totalN, reliable: totalN >= 30 };
  });

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.alerts.title}</h1>
          <p className="text-slate-500 mt-1">{t.alerts.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Bell className="w-6 h-6 text-teal-600" />
          <span className="text-2xl font-bold text-slate-800">
            {alerts.filter((a) => !a.acknowledged).length}
          </span>
          <span className="text-sm text-slate-500">{t.alerts.newAlert}</span>
        </div>
      </div>

      {/* Alert Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(['critical', 'high', 'medium', 'low'] as const).map((severity) => (
          <button
            key={severity}
            onClick={() => setFilterSeverity(filterSeverity === severity ? 'all' : severity)}
            className={`p-4 rounded-2xl border-2 transition-all ${
              filterSeverity === severity
                ? severityBgColors[severity]
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${severityColors[severity]} flex items-center justify-center`}>
                <AlertOctagon className="w-5 h-5 text-white" />
              </div>
              <span className="text-3xl font-bold text-slate-800">{alertCounts[severity]}</span>
            </div>
            <p className={`text-sm font-medium mt-2 ${
              severity === 'critical' ? 'text-rose-700' :
              severity === 'high' ? 'text-orange-700' :
              severity === 'medium' ? 'text-yellow-700' :
              'text-slate-600'
            }`}>
              {t.alerts[severity]}
            </p>
          </button>
        ))}
      </div>

      {/* ESKAPE Pathogens Panel */}
      <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Biohazard className="w-5 h-5 text-rose-600" />
          <h3 className="font-semibold text-slate-800">{isRTL ? 'ممرضات ESKAPE ذات الأولوية' : 'ESKAPE Priority Pathogens'}</h3>
          <span className="text-xs text-slate-400 ms-1">{isRTL ? '(مؤشر المقاومة الرئيسي)' : '(key resistance marker)'}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {eskapePanel.map(({ key, label, marker, color, resistPct, totalN, reliable }) => {
            const pct = resistPct ?? null;
            const noData = pct === null;
            const danger = !noData && pct >= 20;
            const warn = !noData && !danger && pct >= 10;
            return (
              <div
                key={key}
                className={`rounded-2xl p-3 border text-center ${
                  noData ? 'bg-slate-50 border-slate-100' :
                  danger ? `bg-rose-50 border-rose-200` :
                  warn ? 'bg-amber-50 border-amber-200' :
                  'bg-emerald-50 border-emerald-200'
                }`}
              >
                <div className={`text-xs font-semibold mb-0.5 ${
                  noData ? 'text-slate-400' :
                  danger ? `text-${color}-700` :
                  warn ? 'text-amber-700' : 'text-emerald-700'
                }`}>{marker}</div>
                <div className={`text-xl font-bold ${
                  noData ? 'text-slate-400' :
                  danger ? 'text-rose-700' :
                  warn ? 'text-amber-700' : 'text-emerald-700'
                }`}>
                  {noData ? '—' : `${pct.toFixed(0)}%R`}
                </div>
                <div className="text-[11px] text-slate-600 font-medium mt-0.5 leading-tight">{label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {noData ? (isRTL ? 'لا بيانات' : 'no data') : !reliable ? `n=${totalN} ⚠` : `n=${totalN}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="w-48">
          <select
            value={filterHospital}
            onChange={(e) => setFilterHospital(e.target.value)}
            className="w-full px-4 py-2 bg-white rounded-xl border border-slate-200 focus:border-teal-500 outline-none text-sm"
          >
            <option value="all">{t.antibiogram.allHospitals}</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          {t.alerts.resolved}
        </label>
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
          <h3 className="text-xl font-semibold text-slate-800">{t.common.success}</h3>
          <p className="text-slate-500 mt-2">
            {t.antibiogram.noData}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${
                alert.acknowledged ? 'opacity-60' : ''
              } ${severityBgColors[alert.type]}`}
            >
              <div
                className="p-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-inset"
                role="button"
                tabIndex={0}
                aria-expanded={selectedAlert?.id === alert.id}
                aria-label={`${alert.title}. ${selectedAlert?.id === alert.id ? 'Collapse' : 'Expand'} alert details`}
                onClick={() => setSelectedAlert(selectedAlert?.id === alert.id ? null : alert)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedAlert(selectedAlert?.id === alert.id ? null : alert);
                  }
                }}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${severityColors[alert.type]} flex items-center justify-center`}>
                    <AlertTriangle className="w-6 h-6 text-white" />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        alert.type === 'critical' ? 'bg-rose-100 text-rose-700' :
                        alert.type === 'high' ? 'bg-orange-100 text-orange-700' :
                        alert.type === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {t.alerts[alert.type]}
                      </span>
                      <span className="text-sm text-slate-400">
                        {new Date(alert.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 className="font-semibold text-slate-800">{alert.title}</h4>
                    <p className="text-sm text-slate-600">
                      {alert.organism} - {alert.antibiotic} ({alert.hospital})
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-800">{alert.rate.toFixed(0)}%</p>
                    <p className="text-xs text-slate-500">{t.antibiogram.resistant}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedAlert?.id === alert.id ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {selectedAlert?.id === alert.id && (
                <div className="border-t border-slate-100 p-6 bg-slate-50">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Empiric Therapy */}
                    <div className="bg-white rounded-xl p-4 border border-slate-100">
                      <div className="flex items-center gap-2 mb-3">
                        <Lightbulb className="w-5 h-5 text-teal-600" />
                        <h5 className="font-semibold text-slate-800">{t.alerts.empiricTherapy}</h5>
                      </div>
                      <p className="text-sm text-slate-600">{alert.empiricTherapy}</p>
                    </div>

                    {/* Infection Control */}
                    <div className="bg-white rounded-xl p-4 border border-slate-100">
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="w-5 h-5 text-blue-600" />
                        <h5 className="font-semibold text-slate-800">{t.alerts.infectionControl}</h5>
                      </div>
                      <p className="text-sm text-slate-600">{alert.infectionControl}</p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-end gap-3 mt-6">
                    {alert.acknowledged ? (
                      <span className="flex items-center gap-2 text-emerald-600">
                        <CheckCircle className="w-5 h-5" />
                        {t.alerts.resolved}
                      </span>
                    ) : (
                      <button
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition-colors"
                      >
                        <CheckCircle className="w-4 h-4" />
                        {t.alerts.acknowledge}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Threshold Settings */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-slate-600" />
          <h3 className="font-semibold text-slate-800">{t.alerts.thresholdSettings}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <label htmlFor="critical-resistance-threshold" className="block text-sm font-medium text-slate-600 mb-2">
              {t.alerts.criticalResistanceThreshold} ({t.alerts.critical})
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                id="critical-resistance-threshold"
                min="50"
                max="90"
                value={100 - thresholds.critical}
                onChange={(e) => setThresholds({ ...thresholds, critical: 100 - parseInt(e.target.value) })}
                className="flex-1 accent-rose-500"
              />
              <span className="w-12 text-center font-medium text-slate-700">{100 - thresholds.critical}%</span>
            </div>
          </div>

          <div>
            <label htmlFor="high-resistance-threshold" className="block text-sm font-medium text-slate-600 mb-2">
              {t.alerts.highResistanceThreshold} ({t.alerts.high})
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                id="high-resistance-threshold"
                min="30"
                max="70"
                value={100 - thresholds.high}
                onChange={(e) => setThresholds({ ...thresholds, high: 100 - parseInt(e.target.value) })}
                className="flex-1 accent-orange-500"
              />
              <span className="w-12 text-center font-medium text-slate-700">{100 - thresholds.high}%</span>
            </div>
          </div>

          <div>
            <label htmlFor="medium-resistance-threshold" className="block text-sm font-medium text-slate-600 mb-2">
              {t.alerts.medium}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                id="medium-resistance-threshold"
                min="10"
                max="50"
                value={100 - thresholds.medium}
                onChange={(e) => setThresholds({ ...thresholds, medium: 100 - parseInt(e.target.value) })}
                className="flex-1 accent-yellow-500"
              />
              <span className="w-12 text-center font-medium text-slate-700">{100 - thresholds.medium}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
