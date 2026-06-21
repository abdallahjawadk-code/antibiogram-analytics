import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Globe, Database, Printer, Check, Info } from 'lucide-react';
import { AISettingsSection } from './AISettingsSection';
import { CatalogSettingsSection } from './CatalogSettingsSection';

export function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const [selectedStandard, setSelectedStandard] = useState<'CLSI' | 'EUCAST'>(
    () => (localStorage.getItem('antibiogram-standard') as 'CLSI' | 'EUCAST') || 'CLSI'
  );
  const [saved, setSaved] = useState(false);

  function handleSave() {
    localStorage.setItem('antibiogram-standard', selectedStandard);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex gap-8 items-start">
    <div className="flex-1 space-y-6 min-w-0">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.settings.title}</h1>
        <p className="text-slate-500 mt-1">{t.settings.general}</p>
      </div>

      {/* Language Settings */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">{t.settings.language}</h3>
              <p className="text-sm text-slate-500">{t.appSubtitle}</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-3">
          <button
            onClick={() => setLanguage('ar')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
              language === 'ar'
                ? 'border-teal-500 bg-teal-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-lg">
              ع
            </div>
            <div className="flex-1 text-start">
              <p className="font-semibold text-slate-800">{t.settings.arabicLanguage}</p>
              <p className="text-sm text-slate-500">{t.settings.arabicLanguageDescription}</p>
            </div>
            {language === 'ar' && (
              <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </button>

          <button
            onClick={() => setLanguage('en')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
              language === 'en'
                ? 'border-teal-500 bg-teal-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              EN
            </div>
            <div className="flex-1 text-start">
              <p className="font-semibold text-slate-800">{t.settings.englishLanguage}</p>
              <p className="text-sm text-slate-500">{t.settings.englishLanguageDescription}</p>
            </div>
            {language === 'en' && (
              <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Standard Settings */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">{t.settings.standard}</h3>
              <p className="text-sm text-slate-500">{t.antibiogram.interpretation}</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-3">
          <button
            onClick={() => setSelectedStandard('CLSI')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
              selectedStandard === 'CLSI'
                ? 'border-teal-500 bg-teal-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex-1 text-start">
              <p className="font-semibold text-slate-800">{t.settings.clsi}</p>
              <p className="text-sm text-slate-500">{t.settings.clsiDescription}</p>
            </div>
            {selectedStandard === 'CLSI' && (
              <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </button>

          <button
            onClick={() => setSelectedStandard('EUCAST')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
              selectedStandard === 'EUCAST'
                ? 'border-teal-500 bg-teal-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex-1 text-start">
              <p className="font-semibold text-slate-800">{t.settings.eucast}</p>
              <p className="text-sm text-slate-500">{t.settings.eucastDescription}</p>
            </div>
            {selectedStandard === 'EUCAST' && (
              <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </button>

          <div className="flex items-start gap-2 p-4 bg-blue-50 text-blue-700 rounded-2xl">
            <Info className="w-5 h-5 mt-0.5" />
            <p className="text-sm">{t.antibiogram.breakpoints}</p>
          </div>

          {/* Breakpoint version banner */}
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                {language === 'ar' ? 'إصدار نقاط الكسر المُحمَّلة' : 'Loaded breakpoint version'}
              </span>
            </div>
            {selectedStandard === 'CLSI' ? (
              <div className="px-4 py-3 bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-800">CLSI M100</span>
                    <span className="ms-2 px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-semibold rounded-lg">Ed. 35 · 2025</span>
                  </div>
                  <span className="text-xs text-slate-400">{language === 'ar' ? 'تحديث: يناير 2025' : 'Updated: Jan 2025'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {language === 'ar'
                    ? 'جداول S/I/R لمضادات الميكروبات — معايير الحساسية المعيارية للأداء CLSI'
                    : 'Performance Standards for Antimicrobial Susceptibility Testing, CLSI S/I/R tables'}
                </p>
              </div>
            ) : (
              <div className="px-4 py-3 bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-800">EUCAST</span>
                    <span className="ms-2 px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs font-semibold rounded-lg">v14.0 · 2024</span>
                  </div>
                  <span className="text-xs text-slate-400">{language === 'ar' ? 'تحديث: يناير 2024' : 'Updated: Jan 2024'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {language === 'ar'
                    ? 'نقاط الكسر الأوروبية لمضادات الميكروبات — EUCAST الإصدار 14.0'
                    : 'European Committee on Antimicrobial Susceptibility Testing breakpoints v14.0'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auto-discovered catalogs */}
      <CatalogSettingsSection kind="organism" />
      <CatalogSettingsSection kind="antibiotic" />

      {/* AI Settings */}
      <AISettingsSection />

      {/* Print Settings */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">{t.settings.printSettings}</h3>
              <p className="text-sm text-slate-500">{t.settings.display}</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="setting-header-logo" className="block text-sm font-medium text-slate-700 mb-2">{t.settings.headerLogo}</label>
            <select id="setting-header-logo" className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none">
              <option>{t.settings.defaultLogo}</option>
              <option>{t.settings.customLogo}</option>
            </select>
          </div>
          <div>
            <label htmlFor="setting-footer-text" className="block text-sm font-medium text-slate-700 mb-2">{t.settings.footerText}</label>
            <input
              id="setting-footer-text"
              type="text"
              placeholder={t.print.disclaimer}
              className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="setting-font-family" className="block text-sm font-medium text-slate-700 mb-2">{t.settings.fontFamily}</label>
              <select id="setting-font-family" className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none">
                <option>Inter</option>
                <option>Noto Sans Arabic</option>
              </select>
            </div>
            <div>
              <label htmlFor="setting-font-size" className="block text-sm font-medium text-slate-700 mb-2">{t.settings.fontSize}</label>
              <select id="setting-font-size" defaultValue="medium" className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none">
                <option value="small">{t.settings.small}</option>
                <option value="medium">{t.settings.medium}</option>
                <option value="large">{t.settings.large}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold transition-all ${
          saved
            ? 'bg-emerald-500 text-white'
            : 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-lg shadow-teal-500/30 hover:shadow-xl'
        }`}
      >
        {saved ? (
          <>
            <Check className="w-5 h-5" />
            {t.common.success}
          </>
        ) : (
          t.common.save
        )}
      </button>
    </div>

    {/* ── Attribution Panel ─────────────────────────────────────── */}
    <div className="hidden xl:flex flex-col items-center w-72 shrink-0 sticky top-6">
      {/* Decorative card */}
      <div className="w-full bg-gradient-to-b from-teal-600 to-cyan-700 rounded-3xl p-6 shadow-2xl shadow-teal-500/30 text-center relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-40 h-40 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-32 h-32 bg-white rounded-full translate-x-1/2 translate-y-1/2" />
        </div>

        {/* Crescent + star emblem */}
        <div className="relative z-10 w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-inner">
          <svg viewBox="0 0 48 48" className="w-10 h-10 text-white" fill="currentColor">
            <path d="M24 6C14.06 6 6 14.06 6 24s8.06 18 18 18c4.42 0 8.47-1.6 11.6-4.24A14 14 0 0 1 22 24a14 14 0 0 1 13.6-13.76A17.93 17.93 0 0 0 24 6z"/>
            <polygon points="36,4 37.5,8.5 42,8.5 38.5,11.5 40,16 36,13 32,16 33.5,11.5 30,8.5 34.5,8.5"/>
          </svg>
        </div>

        {/* Hierarchy items */}
        <div className="relative z-10 space-y-0 text-white">
          {[
            { ar: 'جمهورية العراق', en: 'Republic of Iraq', size: 'text-sm font-bold' },
            { ar: 'وزارة الصحة', en: 'Ministry of Health', size: 'text-base font-bold' },
            { ar: 'دائرة صحة بابل', en: 'Babylon Health Directorate', size: 'text-sm font-semibold' },
            { ar: 'قسم الصيدلة', en: 'Pharmacy Department', size: 'text-sm font-medium' },
            { ar: 'شعبة الصيدلة السريرية', en: 'Clinical Pharmacy Division', size: 'text-sm font-medium' },
            { ar: 'بالتعاون مع', en: 'In cooperation with', size: 'text-xs font-normal italic', dim: true },
            { ar: 'وحدة متابعة لجان الصيدلة والعلاج', en: 'Pharmacy & Treatment Committee Unit', size: 'text-xs font-semibold' },
          ].map((item, idx, arr) => (
            <div key={idx} className="flex flex-col items-center">
              <p className={`${item.size} leading-snug ${item.dim ? 'text-white/60' : 'text-white'} text-center`} dir="rtl">
                {item.ar}
              </p>
              {idx < arr.length - 1 && (
                <div className="w-px h-4 bg-white/30 my-0.5" />
              )}
            </div>
          ))}

          {/* Divider */}
          <div className="my-4 flex items-center gap-2">
            <div className="flex-1 h-px bg-white/30" />
            <div className="w-1.5 h-1.5 rounded-full bg-white/50" />
            <div className="flex-1 h-px bg-white/30" />
          </div>

          {/* Author */}
          <p className="text-base font-bold tracking-wide">Abdallah Jawad Kadhim</p>
          <p className="text-white/70 text-sm mt-0.5">© 2026</p>
        </div>
      </div>

      {/* Subtle bottom label */}
      <p className="mt-4 text-xs text-slate-400 text-center leading-relaxed">
        AntibioGram Pro — Clinical Pharmacy Platform
      </p>
    </div>
    </div>
  );
}
