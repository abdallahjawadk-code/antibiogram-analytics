import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { getUploadHistory, rollbackUpload } from '../lib/supabase';
import { UploadHistory } from '../types/database';
import { Clock, CheckCircle, XCircle, Loader2, RotateCcw, Trash2, FileSpreadsheet } from 'lucide-react';

export function UploadHistoryPage() {
  const { isRTL } = useLanguage();
  const [history, setHistory] = useState<(UploadHistory & { hospitals?: { name: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    getUploadHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleRollback = async (record: UploadHistory) => {
    const confirmMsg = isRTL
      ? `هل تريد حذف بيانات الرفع "${record.filename}" (${record.year})؟ لا يمكن التراجع عن هذا الإجراء.`
      : `Delete all data from upload "${record.filename}" (${record.year})? This cannot be undone.`;
    if (!confirm(confirmMsg)) return;
    setRollingBack(record.id);
    try {
      await rollbackUpload(record.id, record.hospital_id, record.uploaded_at);
      setMessage({ type: 'success', text: isRTL ? 'تم التراجع عن الرفع بنجاح' : 'Upload rolled back successfully' });
      load();
    } catch {
      setMessage({ type: 'error', text: isRTL ? 'فشل التراجع عن الرفع' : 'Rollback failed' });
    } finally {
      setRollingBack(null);
    }
  };

  const tx = {
    title: isRTL ? 'سجل الرفع' : 'Upload History',
    subtitle: isRTL ? 'سجل جميع عمليات رفع البيانات مع إمكانية التراجع' : 'All data uploads with rollback capability',
    file: isRTL ? 'الملف' : 'File',
    hospital: isRTL ? 'المستشفى' : 'Hospital',
    year: isRTL ? 'السنة' : 'Year',
    records: isRTL ? 'السجلات' : 'Records',
    status: isRTL ? 'الحالة' : 'Status',
    date: isRTL ? 'التاريخ' : 'Date',
    actions: isRTL ? 'الإجراءات' : 'Actions',
    rollback: isRTL ? 'تراجع' : 'Rollback',
    noData: isRTL ? 'لا يوجد سجل رفع بعد' : 'No upload history yet',
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    if (status === 'error') return <XCircle className="w-4 h-4 text-rose-500" />;
    return <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
          <Clock className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{tx.title}</h1>
          <p className="text-slate-500 mt-0.5">{tx.subtitle}</p>
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 p-4 rounded-2xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ms-auto text-current opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-teal-500 border-t-transparent" />
        </div>
      ) : history.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
          <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500">{tx.noData}</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {[tx.file, tx.hospital, tx.year, tx.records, tx.status, tx.date, tx.actions].map((h) => (
                    <th key={h} className="px-4 py-3 text-start font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {history.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px] truncate">{row.filename}</td>
                    <td className="px-4 py-3 text-slate-600">{row.hospitals?.name || row.hospital_id}</td>
                    <td className="px-4 py-3 text-slate-600">{row.year}</td>
                    <td className="px-4 py-3 text-slate-600">{row.records_count?.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        {statusIcon(row.status)}
                        <span className={row.status === 'success' ? 'text-emerald-700' : row.status === 'error' ? 'text-rose-700' : 'text-amber-700'}>
                          {row.status}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : '?'}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'success' && (
                        <button
                          onClick={() => void handleRollback(row)}
                          disabled={rollingBack === row.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors disabled:opacity-40"
                        >
                          {rollingBack === row.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <RotateCcw className="w-3 h-3" />}
                          {tx.rollback}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 p-4 bg-amber-50 text-amber-700 text-xs rounded-2xl border border-amber-100">
        <Trash2 className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          {isRTL
            ? 'التراجع يحذف جميع بيانات الاختبارات المرتبطة بعملية الرفع هذه. تأكد من وجود نسخة احتياطية قبل المتابعة.'
            : 'Rollback permanently removes all test records associated with that upload batch. Ensure you have a backup before proceeding.'}
        </span>
      </div>
    </div>
  );
}
