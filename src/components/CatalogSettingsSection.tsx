import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  getOrganismCatalog, setOrganismActive, deleteOrganismFromCatalog,
  getAntibioticCatalog, setAntibioticActive, deleteAntibioticFromCatalog,
  updateAntibioticPolicy,
} from '../lib/supabase';
import { OrganismCatalogEntry, AntibioticCatalogEntry } from '../types/database';
import { Microscope, Pill, Trash2, Loader2 } from 'lucide-react';
import { PolicyBadge } from './PolicyBadge';

type Kind = 'organism' | 'antibiotic';

/**
 * Management-only catalog view. Entries are auto-discovered from uploaded Excel
 * files — there is no manual add. The user can disable (hide everywhere) or
 * delete an entry.
 */
export function CatalogSettingsSection({ kind }: { kind: Kind }) {
  const { t, isRTL } = useLanguage();
  const [items, setItems] = useState<(OrganismCatalogEntry | AntibioticCatalogEntry)[]>([]);
  const [loading, setLoading] = useState(true);

  const api = kind === 'organism'
    ? { fetch: getOrganismCatalog, setActive: setOrganismActive, remove: deleteOrganismFromCatalog }
    : { fetch: getAntibioticCatalog, setActive: setAntibioticActive, remove: deleteAntibioticFromCatalog };

  const tx = isRTL
    ? {
        title: kind === 'organism' ? 'الكائنات الدقيقة' : 'المضادات الحيوية',
        subtitle: kind === 'organism' 
          ? 'تُكتشف تلقائياً من ملفات Excel — يمكنك تعطيلها أو حذفها'
          : 'تُكتشف تلقائياً من ملفات Excel — حدد حالة السياسة واكتب ملاحظاتك',
        empty: 'لا توجد عناصر بعد. ارفع ملف Excel لاكتشافها تلقائياً.',
        active: 'مُفعّل', disabled: 'مُعطّل',
      }
    : {
        title: kind === 'organism' ? 'Organisms' : 'Antibiotics',
        subtitle: kind === 'organism'
          ? 'Auto-discovered from Excel files — you can disable or delete them'
          : 'Auto-discovered from Excel files — configure stewardship policies and notes',
        empty: 'Nothing yet. Upload an Excel file to auto-discover entries.',
        active: 'Active', disabled: 'Disabled',
      };

  async function load() {
    setLoading(true);
    try {
      setItems(await api.fetch());
    } catch (e) {
      console.error('Failed to load catalog:', e);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [kind]);

  async function toggle(item: OrganismCatalogEntry | AntibioticCatalogEntry) {
    await api.setActive(item.id, !item.is_active);
    load();
  }

  async function remove(item: OrganismCatalogEntry | AntibioticCatalogEntry) {
    await api.remove(item.id);
    load();
  }

  async function handlePolicyChange(
    item: AntibioticCatalogEntry,
    status: 'first_line' | 'restricted' | 'unrestricted' | null,
    notes: string | null
  ) {
    const finalStatus = !status ? null : status;
    const finalNotes = !notes ? null : notes;

    // Snappy optimistic UI update
    setItems((prev) =>
      prev.map((p) =>
        p.id === item.id
          ? { ...p, policy_status: finalStatus, policy_notes: finalNotes }
          : p
      )
    );

    try {
      await updateAntibioticPolicy(item.id, finalStatus, finalNotes);
      // Reload in background to sync with db
      const freshData = await getAntibioticCatalog();
      setItems(freshData);
    } catch (error) {
      console.error('Failed to update policy:', error);
      load();
    }
  }

  const Icon = kind === 'organism' ? Microscope : Pill;
  const accent = kind === 'organism' ? 'from-emerald-500 to-teal-600' : 'from-indigo-500 to-violet-600';

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden transition-all duration-300 hover:shadow-md">
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${accent} flex items-center justify-center shadow-inner`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">{tx.title}</h3>
            <p className="text-sm text-slate-500">{tx.subtitle}</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">{tx.empty}</p>
        ) : kind === 'organism' ? (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-100 rounded-2xl transition-all duration-200"
              >
                <span
                  className={`flex-1 font-medium ${
                    item.is_active ? 'text-slate-700' : 'text-slate-400 line-through'
                  }`}
                >
                  {item.name}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={item.is_active}
                  aria-label={item.name}
                  onClick={() => toggle(item)}
                  className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${
                    item.is_active ? 'bg-teal-500' : 'bg-slate-300'
                  }`}
                  title={item.is_active ? tx.active : tx.disabled}
                >
                  <div
                    className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all duration-300 ${
                      item.is_active
                        ? isRTL
                          ? 'left-1'
                          : 'right-1'
                        : isRTL
                        ? 'right-1'
                        : 'left-1'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  aria-label={isRTL ? `حذف ${item.name}` : `Delete ${item.name}`}
                  className="p-2 hover:bg-rose-100 rounded-xl text-rose-500 transition-colors duration-200"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {(items as AntibioticCatalogEntry[]).map((item) => (
              <div
                key={item.id}
                className="p-4 bg-slate-50 hover:bg-slate-100/50 border border-slate-200/60 rounded-2xl space-y-3.5 transition-all duration-300 shadow-sm"
              >
                {/* Top Row: Title, Active switch, delete */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-semibold text-base ${
                        item.is_active ? 'text-slate-800' : 'text-slate-400 line-through'
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.is_active && item.policy_status && (
                      <PolicyBadge status={item.policy_status} notes={item.policy_notes} />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.is_active}
                      aria-label={item.name}
                      onClick={() => toggle(item)}
                      className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${
                        item.is_active ? 'bg-teal-500' : 'bg-slate-300'
                      }`}
                      title={item.is_active ? tx.active : tx.disabled}
                    >
                      <div
                        className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all duration-300 ${
                          item.is_active
                            ? isRTL
                              ? 'left-1'
                              : 'right-1'
                            : isRTL
                            ? 'right-1'
                            : 'left-1'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      aria-label={isRTL ? `حذف ${item.name}` : `Delete ${item.name}`}
                      className="p-2 hover:bg-rose-100 rounded-xl text-rose-500 transition-colors duration-200"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Bottom Row: Stewardship Controls */}
                <div
                  className={`grid grid-cols-1 md:grid-cols-12 gap-3 transition-all duration-300 ${
                    item.is_active ? 'opacity-100' : 'opacity-40 pointer-events-none'
                  }`}
                >
                  <div className="md:col-span-4">
                    <label htmlFor={`policy-status-${item.id}`} className="block text-xs font-semibold text-slate-500 mb-1">
                      {t.stewardship.status}
                    </label>
                    <select
                      id={`policy-status-${item.id}`}
                      value={item.policy_status || ''}
                      onChange={(e) =>
                        handlePolicyChange(item,
                          e.target.value === 'first_line' || e.target.value === 'restricted' || e.target.value === 'unrestricted'
                            ? e.target.value
                            : null,
                          item.policy_notes || null)
                      }
                      className="w-full bg-white border border-slate-200/80 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
                    >
                      <option value="">--</option>
                      <option value="first_line">{t.stewardship.firstLine}</option>
                      <option value="restricted">{t.stewardship.restricted}</option>
                      <option value="unrestricted">{t.stewardship.unrestricted}</option>
                    </select>
                  </div>
                  <div className="md:col-span-8">
                    <label htmlFor={`policy-notes-${item.id}`} className="block text-xs font-semibold text-slate-500 mb-1">
                      {t.stewardship.notes}
                    </label>
                    <input
                      id={`policy-notes-${item.id}`}
                      type="text"
                      defaultValue={item.policy_notes || ''}
                      placeholder={
                        isRTL ? 'أدخل ملاحظات سريرية...' : 'Enter clinical notes...'
                      }
                      onBlur={(e) =>
                        handlePolicyChange(
                          item,
                          item.policy_status || null,
                          e.target.value || null
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-full bg-white border border-slate-200/80 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
