import { useEffect, useState, ReactNode, FormEvent } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getSession, onAuthChange, signIn, isSupabaseConfigured } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';
import { Loader2, Lock, AlertCircle } from 'lucide-react';

/**
 * Gates the whole application behind a Supabase authenticated session.
 * Required because RLS now denies all access to anonymous requests.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isRTL } = useLanguage();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tx = isRTL
    ? {
        title: 'تحليلات الأنتيبايوغرام',
        subtitle: 'سجّل الدخول للمتابعة',
        email: 'البريد الإلكتروني',
        password: 'كلمة المرور',
        signIn: 'تسجيل الدخول',
        loading: 'جارٍ التحقق…',
        invalid: 'بيانات الدخول غير صحيحة',
        notConfigured: 'لم تتم تهيئة الاتصال بقاعدة البيانات. تحقّق من ملف ‎.env‎ (VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY).',
      }
    : {
        title: 'Antibiogram Analytics',
        subtitle: 'Sign in to continue',
        email: 'Email',
        password: 'Password',
        signIn: 'Sign In',
        loading: 'Verifying…',
        invalid: 'Invalid credentials',
        notConfigured: 'Database connection is not configured. Check your .env file (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).',
      };

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured) {
      setChecking(false);
      return;
    }
    getSession()
      .then((s) => {
        if (active) {
          setSession(s);
          setChecking(false);
        }
      })
      .catch(() => active && setChecking(false));
    const unsub = onAuthChange((s) => active && setSession(s));
    return () => {
      active = false;
      unsub();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch {
      setError(tx.invalid);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-md bg-white rounded-3xl shadow-sm border border-slate-100 p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-100 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-rose-600" />
          </div>
          <p className="text-slate-700">{tx.notConfigured}</p>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-teal-500 animate-spin" />
      </div>
    );
  }

  if (session) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-teal-50 p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{tx.title}</h1>
          <p className="text-slate-500 mt-1">{tx.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{tx.email}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{tx.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 rounded-2xl text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {submitting ? tx.loading : tx.signIn}
          </button>
        </form>
      </div>
    </div>
  );
}
