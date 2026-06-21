import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Building2, Microscope, TrendingUp, Clock, Plus, Upload, ArrowUpRight, AlertTriangle, TrendingDown, Activity, AlertOctagon } from 'lucide-react';
import { getStatistics, getHospitals, getUploadHistory, getAntibiogramData } from '../lib/supabase';
import { computeSIR, resistanceRate } from '../lib/clinical';
import { detectResistanceFlag } from '../lib/stats';
import { Hospital, UploadHistory, AntibiogramData } from '../types/database';

interface Stats {
  totalHospitals: number;
  totalIsolates: number;
  avgResistance: number;
  mdrIndex: number;
}

export function Dashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { t, isRTL } = useLanguage();
  const [stats, setStats] = useState<Stats>({ totalHospitals: 0, totalIsolates: 0, avgResistance: 0, mdrIndex: 0 });
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [uploads, setUploads] = useState<(UploadHistory & { hospitals?: { name: string } })[]>([]);
  const [alerts, setAlerts] = useState<{ organism: string; antibiotic: string; rate: number; isSuperbug?: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [statsData, hospitalsData, uploadsData, antibiogramData] = await Promise.all([
          getStatistics(),
          getHospitals(),
          getUploadHistory(),
          getAntibiogramData(),
        ]);
        
        // Calculate MDR Index
        let mdrResistantCount = 0;
        let mdrTotalTested = 0;

        antibiogramData.forEach((d: AntibiogramData) => {
          const flag = detectResistanceFlag(d.organism, d.antibiotic);

          if (flag) {
            const sir = computeSIR(d);
            const total = d.total_tested || (d.susceptible_count + d.intermediate_count + d.resistant_count) || 0;
            const resistantCount = d.resistant_count || Math.round(total * sir.resistant / 100);
            mdrResistantCount += resistantCount;
            mdrTotalTested += total;
          }
        });

        const mdrIndexVal = mdrTotalTested > 0 ? (mdrResistantCount / mdrTotalTested) * 100 : 0;

        setStats({
          ...statsData,
          mdrIndex: Math.round(mdrIndexVal * 10) / 10,
        });
        setHospitals(hospitalsData);
        setUploads(uploadsData.slice(0, 5));

        // Calculate high resistance alerts and superbug detections
        const resistanceAlerts: { organism: string; antibiotic: string; rate: number; isSuperbug: boolean }[] = [];
        const groupedData: Record<string, { total: number; count: number }> = {};

        antibiogramData.forEach((d: AntibiogramData) => {
          const key = `${d.organism}-${d.antibiotic}`;
          if (!groupedData[key]) {
            groupedData[key] = { total: 0, count: 0 };
          }
          groupedData[key].total += resistanceRate(d);
          groupedData[key].count += 1;
        });

        Object.entries(groupedData).forEach(([key, data]) => {
          const avgRate = data.count > 0 ? data.total / data.count : 0;
          const [organism, antibiotic] = key.split('-');

          const flag = detectResistanceFlag(organism, antibiotic);
          const isSuperbug = (flag?.type === 'CRE' || flag?.type === 'VRSA') && avgRate > 0;

          if (avgRate > 50 || isSuperbug) {
            resistanceAlerts.push({ organism, antibiotic, rate: avgRate, isSuperbug });
          }
        });

        const sortedAlerts = resistanceAlerts.sort((a, b) => {
          if (a.isSuperbug && !b.isSuperbug) return -1;
          if (!a.isSuperbug && b.isSuperbug) return 1;
          return b.rate - a.rate;
        }).slice(0, 3);

        setAlerts(sortedAlerts);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  const statCards = [
    {
      label: t.dashboard.totalHospitals,
      value: stats.totalHospitals,
      icon: Building2,
      color: 'from-blue-500 to-indigo-600',
      shadowColor: 'shadow-blue-500/30',
      change: '+2',
    },
    {
      label: t.dashboard.totalIsolates,
      value: stats.totalIsolates.toLocaleString(),
      icon: Microscope,
      color: 'from-teal-500 to-cyan-600',
      shadowColor: 'shadow-teal-500/30',
      change: '+156',
    },
    {
      label: t.dashboard.recentUploads,
      value: uploads.filter(u => u.status === 'success').length,
      icon: Clock,
      color: 'from-amber-500 to-orange-600',
      shadowColor: 'shadow-amber-500/30',
      change: '3',
    },
    {
      label: t.dashboard.avgResistance,
      value: `${stats.avgResistance}%`,
      icon: TrendingUp,
      color: stats.avgResistance > 50 ? 'from-rose-500 to-pink-600' : 'from-emerald-500 to-teal-600',
      shadowColor: stats.avgResistance > 50 ? 'shadow-rose-500/30' : 'shadow-emerald-500/30',
      change: stats.avgResistance > 50 ? '+2.1%' : '-1.5%',
    },
    {
      label: t.dashboard.mdrIndex,
      value: `${stats.mdrIndex}%`,
      icon: AlertOctagon,
      color: stats.mdrIndex > 20 ? 'from-purple-500 to-pink-600' : 'from-violet-500 to-purple-600',
      shadowColor: 'shadow-purple-500/30',
      change: stats.mdrIndex > 20 ? t.alerts.high : t.alerts.low,
    },
  ];

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.dashboard.title}</h1>
          <p className="text-slate-500 mt-1">{t.dashboard.welcome}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => onNavigate('hospitals')}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl hover:shadow-teal-500/40 transition-all duration-300 hover:-translate-y-0.5"
          >
            <Plus className="w-4 h-4" />
            {t.dashboard.addHospital}
          </button>
          <button
            onClick={() => onNavigate('antibiogram')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 rounded-2xl font-medium border border-slate-200 hover:bg-slate-50 transition-all duration-300"
          >
            <Upload className="w-4 h-4" />
            {t.dashboard.uploadData}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 lg:gap-6">
        {statCards.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className="group relative bg-white rounded-3xl p-5 lg:p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:border-slate-200 transition-all duration-500 overflow-hidden"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${stat.color} ${stat.shadowColor} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <span className={`text-xs font-medium ${
                    index === 3
                      ? (stats.avgResistance > 50 ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50')
                      : index === 4
                      ? (stats.mdrIndex > 20 ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50')
                      : 'text-emerald-600 bg-emerald-50'
                  } px-2 py-1 rounded-lg`}>
                    {stat.change}
                  </span>
                </div>
                <p className="text-2xl lg:text-3xl font-bold text-slate-800 mb-1">{stat.value}</p>
                <p className="text-sm text-slate-500">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Critical Alerts */}
      {alerts.length > 0 && (
        <div className="bg-gradient-to-r from-rose-500 to-pink-600 rounded-3xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6" />
            <h2 className="text-lg font-semibold">{t.dashboard.criticalAlerts}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {alerts.map((alert, idx) => (
              <div
                key={idx}
                className={`rounded-2xl p-4 backdrop-blur-sm ${
                  alert.isSuperbug 
                    ? 'bg-red-950/40 border border-red-500/30' 
                    : 'bg-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-rose-200" />
                    <span className="font-medium">{alert.rate.toFixed(0)}% {t.antibiogram.resistant}</span>
                  </div>
                  {alert.isSuperbug && (
                    <span className="bg-rose-600 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full tracking-wider animate-pulse text-white">
                      Superbug
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold opacity-90">{alert.organism}</p>
                <p className="text-xs opacity-75">{alert.antibiotic}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => onNavigate('alerts')}
            className="mt-4 flex items-center gap-2 text-white/80 hover:text-white transition-colors"
          >
            {t.common.view} <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">{t.dashboard.quickActions}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <button
            onClick={() => onNavigate('hospitals')}
            className="flex items-center gap-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl hover:from-teal-50 hover:to-cyan-50 transition-all duration-300 group"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div className={isRTL ? 'text-right' : 'text-left'}>
              <p className="font-semibold text-slate-800">{t.dashboard.addHospital}</p>
              <p className="text-sm text-slate-500">{t.hospitals.addNew}</p>
            </div>
            <ArrowUpRight className={`w-5 h-5 text-slate-400 ${isRTL ? 'mr-auto' : 'ml-auto'}`} />
          </button>

          <button
            onClick={() => onNavigate('antibiogram')}
            className="flex items-center gap-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl hover:from-teal-50 hover:to-cyan-50 transition-all duration-300 group"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/20 group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6 text-white" />
            </div>
            <div className={isRTL ? 'text-right' : 'text-left'}>
              <p className="font-semibold text-slate-800">{t.dashboard.uploadData}</p>
              <p className="text-sm text-slate-500">{t.upload.title}</p>
            </div>
            <ArrowUpRight className={`w-5 h-5 text-slate-400 ${isRTL ? 'mr-auto' : 'ml-auto'}`} />
          </button>

          <button
            onClick={() => onNavigate('comparison')}
            className="flex items-center gap-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl hover:from-teal-50 hover:to-cyan-50 transition-all duration-300 group"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div className={isRTL ? 'text-right' : 'text-left'}>
              <p className="font-semibold text-slate-800">{t.nav.comparison}</p>
              <p className="text-sm text-slate-500">{t.comparison.subtitle}</p>
            </div>
            <ArrowUpRight className={`w-5 h-5 text-slate-400 ${isRTL ? 'mr-auto' : 'ml-auto'}`} />
          </button>

          <button
            onClick={() => onNavigate('trends')}
            className="flex items-center gap-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl hover:from-teal-50 hover:to-cyan-50 transition-all duration-300 group"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-110 transition-transform">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div className={isRTL ? 'text-right' : 'text-left'}>
              <p className="font-semibold text-slate-800">{t.nav.trends}</p>
              <p className="text-sm text-slate-500">{t.trends.subtitle}</p>
            </div>
            <ArrowUpRight className={`w-5 h-5 text-slate-400 ${isRTL ? 'mr-auto' : 'ml-auto'}`} />
          </button>
        </div>
      </div>

      {/* Recent Hospitals */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">{t.hospitals.title}</h2>
            <button
              onClick={() => onNavigate('hospitals')}
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              {t.common.view}
            </button>
          </div>
          <div className="space-y-3">
            {hospitals.slice(0, 4).map((hospital) => (
              <div
                key={hospital.id}
                className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white font-bold text-sm">
                  {hospital.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{hospital.name}</p>
                  <p className="text-sm text-slate-500">{hospital.city}</p>
                </div>
                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                  hospital.is_active
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {hospital.is_active ? t.hospitals.active : t.hospitals.inactive}
                </span>
              </div>
            ))}
            {hospitals.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <Building2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>{t.hospitals.noHospitals}</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Uploads */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">{t.dashboard.recentActivity}</h2>
          </div>
          <div className="space-y-3">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  upload.status === 'success'
                    ? 'bg-emerald-100'
                    : upload.status === 'error'
                    ? 'bg-rose-100'
                    : 'bg-amber-100'
                }`}>
                  <Upload className={`w-5 h-5 ${
                    upload.status === 'success'
                      ? 'text-emerald-600'
                      : upload.status === 'error'
                      ? 'text-rose-600'
                      : 'text-amber-600'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{upload.filename}</p>
                  <p className="text-sm text-slate-500">{upload.hospitals?.name}</p>
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(upload.uploaded_at).toLocaleDateString()}
                </span>
              </div>
            ))}
            {uploads.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>{t.common.noData}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
