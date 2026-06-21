import { useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { AntibiogramData } from '../types/database';
import {
  loadAISettings, isAIReady, summarizeAntibiogram, askAboutData, AIReportContext,
} from '../lib/ai';
import { Sparkles, Send, Loader2, Square, AlertCircle, Settings2 } from 'lucide-react';

interface AIInsightsPanelProps {
  hospitalName: string;
  year: number | string;
  period?: string;
  standard: string;
  data: AntibiogramData[];
}

export function AIInsightsPanel({ hospitalName, year, period, standard, data }: AIInsightsPanelProps) {
  const { isRTL } = useLanguage();
  const settings = loadAISettings();
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const tx = isRTL
    ? {
        title: 'رؤى الذكاء الاصطناعي',
        subtitle: 'ملخّص سردي و"اسأل بياناتك" (اختياري)',
        summarize: 'لخّص الأنتيبايوغرام',
        askPlaceholder: 'اسأل عن بياناتك…',
        off: 'ميزات الذكاء الاصطناعي معطّلة. فعّلها من الإعدادات.',
        notReady: 'أكمل إعداد المزوّد والمفتاح والموديل في الإعدادات.',
        noData: 'لا توجد بيانات لتحليلها.',
        stop: 'إيقاف',
        caveat: 'دعم قرار فقط — راجع الإرشادات المحلية وأخصائي الأحياء الدقيقة/الأمراض المعدية.',
        failed: 'فشل الطلب',
      }
    : {
        title: 'AI Insights',
        subtitle: 'Narrative summary & ask-your-data (optional)',
        summarize: 'Summarize antibiogram',
        askPlaceholder: 'Ask about your data…',
        off: 'AI features are off. Enable them in Settings.',
        notReady: 'Finish configuring provider, API key, and model in Settings.',
        noData: 'No data to analyze.',
        stop: 'Stop',
        caveat: 'Decision support only — consult local guidelines and a microbiology/ID specialist.',
        failed: 'Request failed',
      };

  if (!settings.enabled) {
    return (
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 print:hidden">
        <div className="flex items-center gap-3 text-slate-500">
          <Settings2 className="w-5 h-5" />
          <p className="text-sm">{tx.off}</p>
        </div>
      </div>
    );
  }

  const ctx: AIReportContext = { hospitalName, year, period, standard, data };
  const ready = isAIReady(settings);

  async function run(kind: 'summary' | 'ask') {
    if (!ready || busy) return;
    if (data.length === 0) { setError(tx.noData); return; }
    setError(null);
    setOutput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const onDelta = (t: string) => setOutput((prev) => prev + t);
      if (kind === 'summary') {
        await summarizeAntibiogram(settings, ctx, isRTL, onDelta, controller.signal);
      } else {
        await askAboutData(settings, ctx, question.trim(), isRTL, onDelta, controller.signal);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(`${tx.failed}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 print:hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">{tx.title}</h3>
            <p className="text-xs text-slate-500">{tx.subtitle}</p>
          </div>
        </div>
        {settings.model && (
          <span className="text-xs text-slate-400 font-mono">{settings.model}</span>
        )}
      </div>

      {!ready ? (
        <div className="flex items-center gap-3 p-4 bg-amber-50 text-amber-700 rounded-2xl text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {tx.notReady}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <button
              onClick={() => run('summary')}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white rounded-2xl font-medium shadow-lg shadow-violet-500/30 hover:shadow-xl transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {tx.summarize}
            </button>
            {busy && (
              <button
                onClick={stop}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
              >
                <Square className="w-4 h-4" />
                {tx.stop}
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); run('ask'); }}
            className="flex gap-2 mb-4"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={tx.askPlaceholder}
              disabled={busy}
              className="flex-1 px-4 py-2.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              aria-label={isRTL ? 'إرسال' : 'Send'}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-2xl font-medium hover:bg-slate-900 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          {error && (
            <div className="flex items-center gap-3 p-4 bg-rose-50 text-rose-700 rounded-2xl text-sm mb-4">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}

          {output && (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <p className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{output}</p>
              <p className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-400">{tx.caveat}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
