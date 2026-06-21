import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  loadAISettings, saveAISettings, getProvider, AI_PROVIDERS,
  AISettings, AIModelInfo, AIProviderId,
} from '../lib/ai';
import { Sparkles, Loader2, Check, AlertCircle, RefreshCw } from 'lucide-react';

export function AISettingsSection() {
  const { isRTL } = useLanguage();
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings());
  const [models, setModels] = useState<AIModelInfo[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const tx = isRTL
    ? {
        title: 'الذكاء الاصطناعي',
        subtitle: 'اختياري — يستخدم مفتاحك الخاص ويُخزَّن محلياً على هذا الجهاز فقط',
        enable: 'تفعيل ميزات الذكاء الاصطناعي',
        provider: 'المزوّد',
        apiKey: 'مفتاح API',
        baseURL: 'عنوان الخادم (Base URL)',
        autoSelect: 'اختيار الموديل الأنسب تلقائياً عند الاكتشاف',
        discover: 'اكتشاف الموديلات',
        discovering: 'جارٍ الاكتشاف…',
        model: 'الموديل',
        modelPlaceholder: 'مثال: claude-opus-4-8',
        discovered: 'تم اكتشاف {n} موديل',
        failed: 'فشل الاكتشاف',
        keyNote: 'لا يُرسَل مفتاحك إلى أي خادم سوى مزوّد الذكاء الاصطناعي الذي اخترته.',
      }
    : {
        title: 'Artificial Intelligence',
        subtitle: 'Optional — uses your own key, stored locally on this machine only',
        enable: 'Enable AI features',
        provider: 'Provider',
        apiKey: 'API key',
        baseURL: 'Base URL',
        autoSelect: 'Auto-select the most capable model on discovery',
        discover: 'Discover models',
        discovering: 'Discovering…',
        model: 'Model',
        modelPlaceholder: 'e.g. claude-opus-4-8',
        discovered: 'Discovered {n} model(s)',
        failed: 'Discovery failed',
        keyNote: 'Your key is sent only to the AI provider you selected.',
      };

  function update(patch: Partial<AISettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAISettings(next);
  }

  const provider = getProvider(settings.providerId);

  async function discover() {
    setDiscovering(true);
    setStatus(null);
    try {
      const found = await provider.listModels(settings);
      const ranked = provider.rankModels(found);
      setModels(ranked);
      const patch: Partial<AISettings> = {};
      if (settings.autoSelect && ranked[0]) patch.model = ranked[0].id;
      if (Object.keys(patch).length) update(patch);
      setStatus({ kind: 'ok', msg: tx.discovered.replace('{n}', String(ranked.length)) });
    } catch (err) {
      setStatus({ kind: 'err', msg: `${tx.failed}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">{tx.title}</h3>
            <p className="text-sm text-slate-500">{tx.subtitle}</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Enable toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="font-medium text-slate-700">{tx.enable}</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
        </label>

        {settings.enabled && (
          <>
            {/* Provider */}
            <div>
              <label htmlFor="ai-provider" className="block text-sm font-medium text-slate-600 mb-2">{tx.provider}</label>
              <select
                id="ai-provider"
                value={settings.providerId}
                onChange={(e) => { setModels([]); update({ providerId: e.target.value as AIProviderId }); }}
                className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-violet-500 outline-none"
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* API key */}
            <div>
              <label htmlFor="ai-api-key" className="block text-sm font-medium text-slate-600 mb-2">{tx.apiKey}</label>
              <input
                id="ai-api-key"
                type="password"
                value={settings.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                autoComplete="off"
                className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-violet-500 outline-none font-mono text-sm"
              />
              <p className="text-xs text-slate-400 mt-1">{tx.keyNote}</p>
            </div>

            {/* Base URL (OpenAI-compatible only) */}
            {provider.needsBaseURL && (
              <div>
                <label htmlFor="ai-base-url" className="block text-sm font-medium text-slate-600 mb-2">{tx.baseURL}</label>
                <input
                  id="ai-base-url"
                  type="text"
                  value={settings.baseURL}
                  onChange={(e) => update({ baseURL: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-violet-500 outline-none font-mono text-sm"
                />
              </div>
            )}

            {/* Auto-select */}
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
              <input
                type="checkbox"
                checked={settings.autoSelect}
                onChange={(e) => update({ autoSelect: e.target.checked })}
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              {tx.autoSelect}
            </label>

            {/* Discover */}
            <button
              onClick={discover}
              disabled={discovering || !settings.apiKey}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-2xl font-medium hover:bg-slate-900 transition-colors disabled:opacity-50"
            >
              {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {discovering ? tx.discovering : tx.discover}
            </button>

            {status && (
              <div className={`flex items-center gap-2 p-3 rounded-2xl text-sm ${
                status.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}>
                {status.kind === 'ok' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {status.msg}
              </div>
            )}

            {/* Model selection */}
            <div>
              <label htmlFor="ai-model" className="block text-sm font-medium text-slate-600 mb-2">{tx.model}</label>
              {models.length > 0 ? (
                <select
                  id="ai-model"
                  value={settings.model}
                  onChange={(e) => update({ model: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-violet-500 outline-none"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="ai-model"
                  type="text"
                  value={settings.model}
                  onChange={(e) => update({ model: e.target.value })}
                  placeholder={tx.modelPlaceholder}
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:border-violet-500 outline-none font-mono text-sm"
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
