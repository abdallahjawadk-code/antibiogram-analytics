import { ReactNode } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { LayoutDashboard, Building2, BarChart3, FileText, Settings, Globe, Activity, GitCompare, TrendingUp, AlertTriangle, Syringe, Clock } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { language, setLanguage, t, isRTL } = useLanguage();

  const navItems = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'regional', label: t.nav.regional, icon: Globe },
    { id: 'hospitals', label: t.nav.hospitals, icon: Building2 },
    { id: 'antibiogram', label: t.nav.antibiogram, icon: BarChart3 },
    { id: 'wisca', label: t.nav.wisca, icon: Syringe },
    { id: 'comparison', label: t.nav.comparison, icon: GitCompare },
    { id: 'trends', label: t.nav.trends, icon: TrendingUp },
    { id: 'alerts', label: t.nav.alerts, icon: AlertTriangle },
    { id: 'reports', label: t.nav.reports, icon: FileText },
    { id: 'history', label: t.nav.history, icon: Clock },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 ${isRTL ? 'font-arabic' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 right-0 z-40 lg:fixed lg:top-0 lg:bottom-0 lg:w-72 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-lg lg:shadow-xl ${isRTL ? 'lg:right-0 lg:left-auto lg:border-l lg:border-r-0 lg:rounded-l-3xl' : 'lg:left-0 lg:right-auto lg:border-r lg:border-l-0 lg:rounded-r-3xl'}`}>
        {/* Logo */}
        <div className="flex items-center justify-between lg:flex-col lg:justify-start p-4 lg:p-6 lg:border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/30">
                <Activity className="w-5 h-5 lg:w-6 lg:h-6 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-white animate-pulse" />
            </div>
            <div className="hidden lg:block">
              <h1 className="text-lg font-bold bg-gradient-to-r from-teal-600 to-cyan-700 bg-clip-text text-transparent">
                {t.appName}
              </h1>
              <p className="text-xs text-slate-500">{t.appSubtitle}</p>
            </div>
          </div>

          {/* Language Toggle */}
          <button
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            aria-label={isRTL ? 'تبديل اللغة' : 'Toggle language'}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all duration-300 hover:scale-105"
          >
            <Globe className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-medium text-slate-700">
              {language === 'ar' ? 'EN' : 'ع'}
            </span>
          </button>
        </div>

        {/* Navigation - Desktop */}
        <nav className="hidden lg:block p-4 space-y-1 max-h-[calc(100vh-160px)] overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 group ${
                  isActive
                    ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-lg shadow-teal-500/30'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-teal-600'}`} />
                <span className="font-medium">{item.label}</span>
                {isActive && (
                  <div className={`w-2 h-2 rounded-full bg-white ml-auto ${isRTL ? 'mr-auto ml-0' : ''}`} />
                )}
              </button>
            );
          })}
        </nav>

        {/* Navigation - Mobile */}
        <nav className="lg:hidden flex items-center justify-around p-2 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all min-w-[60px] ${
                  isActive ? 'text-teal-600 bg-teal-50' : 'text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium truncate max-w-[50px]">{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
          <button
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            aria-label={isRTL ? 'تبديل اللغة' : 'Toggle language'}
            className="flex flex-col items-center gap-1 p-2 text-slate-400 min-w-[60px]"
          >
            <Globe className="w-5 h-5" />
            <span className="text-xs font-medium">{language === 'ar' ? 'EN' : 'ع'}</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className={`pt-24 lg:pt-0 min-h-screen ${isRTL ? 'lg:mr-72' : 'lg:ml-72'}`}>
        <div className="p-4 lg:p-8">
          {children}
        </div>
      </main>

      {/* Custom Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap');

        body {
          font-family: 'Inter', 'Noto Sans Arabic', sans-serif;
        }

        .font-arabic {
          font-family: 'Noto Sans Arabic', 'Inter', sans-serif;
        }
      `}</style>
    </div>
  );
}
