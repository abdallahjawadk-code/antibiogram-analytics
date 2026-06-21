import { lazy, Suspense, useEffect, useState } from 'react';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { AuthGate } from './components/AuthGate';
import { Layout } from './components/Layout';

const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const RegionalDashboard = lazy(() => import('./components/RegionalDashboard').then(m => ({ default: m.RegionalDashboard })));
const HospitalsPage = lazy(() => import('./components/HospitalsPage').then(m => ({ default: m.HospitalsPage })));
const AntibiogramPage = lazy(() => import('./components/AntibiogramPage').then(m => ({ default: m.AntibiogramPage })));
const WiscaPage = lazy(() => import('./components/WiscaPage').then(m => ({ default: m.WiscaPage })));
const ComparisonPage = lazy(() => import('./components/ComparisonPage').then(m => ({ default: m.ComparisonPage })));
const TrendsPage = lazy(() => import('./components/TrendsPage').then(m => ({ default: m.TrendsPage })));
const AlertsPage = lazy(() => import('./components/AlertsPage').then(m => ({ default: m.AlertsPage })));
const ReportsPage = lazy(() => import('./components/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const UploadHistoryPage = lazy(() => import('./components/UploadHistoryPage').then(m => ({ default: m.UploadHistoryPage })));

function AppContent() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const { setLanguage } = useLanguage();

  // Wire the native Electron menu (File / View / Language) into the SPA.
  // No-op in a plain browser where window.electronAPI is undefined.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onMenuNavigate((page) => setCurrentPage(page));
    api.onMenuNewHospital(() => setCurrentPage('hospitals'));
    api.onMenuImportFile(() => setCurrentPage('hospitals'));
    api.onMenuLanguage((lang) => setLanguage(lang));
    api.onMenuPrint(() => window.print());
    api.onMenuExportPDF(() => window.print());
    api.onMenuExportExcel(() => setCurrentPage('reports'));
    api.onMenuExportWord(() => setCurrentPage('reports'));

    return () => {
      [
        'menu-navigate', 'menu-new-hospital', 'menu-import-file', 'menu-language',
        'menu-print', 'menu-export-pdf', 'menu-export-excel', 'menu-export-word',
      ].forEach((ch) => api.removeAllListeners(ch));
    };
  }, [setLanguage]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'regional':
        return <RegionalDashboard />;
      case 'hospitals':
        return <HospitalsPage />;
      case 'antibiogram':
        return <AntibiogramPage />;
      case 'wisca':
        return <WiscaPage />;
      case 'comparison':
        return <ComparisonPage />;
      case 'trends':
        return <TrendsPage />;
      case 'alerts':
        return <AlertsPage />;
      case 'reports':
        return <ReportsPage onNavigate={setCurrentPage} />;
      case 'settings':
        return <SettingsPage />;
      case 'history':
        return <UploadHistoryPage />;
      default:
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent" />
          </div>
        }
      >
        {renderPage()}
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AuthGate>
        <AppContent />
      </AuthGate>
    </LanguageProvider>
  );
}

export default App;
