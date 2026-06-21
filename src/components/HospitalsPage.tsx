import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Hospital } from '../types/database';
import { getHospitals, createHospital, updateHospital, deleteHospital, getAntibiogramData, getUploadHistory } from '../lib/supabase';
import { HospitalCard } from './HospitalCard';
import { HospitalModal } from './HospitalModal';
import { UploadModal } from './UploadModal';
import { Plus, Search, Grid, List, Building2, X, Layers, CheckSquare, Trash2, ShieldCheck, AlertCircle } from 'lucide-react';

export function HospitalsPage() {
  const { t, isRTL } = useLanguage();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterType, setFilterType] = useState<string>('all');
  const [showHospitalModal, setShowHospitalModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [editingHospital, setEditingHospital] = useState<Hospital | null>(null);
  const [uploadingToHospital, setUploadingToHospital] = useState<Hospital | null>(null);
  const [viewingHospital, setViewingHospital] = useState<Hospital | null>(null);
  const [hospitalStats, setHospitalStats] = useState<Record<string, { isolates: number; files: number }>>({});
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedHospitals, setSelectedHospitals] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showMultiUploadModal, setShowMultiUploadModal] = useState(false);

  useEffect(() => {
    loadHospitals();
  }, []);

  async function loadHospitals() {
    try {
      setLoading(true);
      const data = await getHospitals();
      setHospitals(data);

      // Load stats for each hospital
      const stats: Record<string, { isolates: number; files: number }> = {};
      for (const hospital of data) {
        const [antibiogramData, uploads] = await Promise.all([
          getAntibiogramData({ hospitalId: hospital.id }),
          getUploadHistory(hospital.id),
        ]);
        stats[hospital.id] = {
          isolates: antibiogramData.reduce((sum, d) => sum + (d.total_tested || 0), 0),
          files: uploads.filter(u => u.status === 'success').length,
        };
      }
      setHospitalStats(stats);
    } catch (error) {
      console.error('Error loading hospitals:', error);
    } finally {
      setLoading(false);
    }
  }

  // Throws on failure so the modal can surface the reason (e.g. duplicate code)
  // instead of silently doing nothing.
  async function handleSaveHospital(data: Omit<Hospital, 'id' | 'created_at' | 'updated_at'>) {
    if (editingHospital) {
      await updateHospital(editingHospital.id, data);
    } else {
      await createHospital(data);
    }
    setShowHospitalModal(false);
    setEditingHospital(null);
    loadHospitals();
  }

  async function handleDeleteHospital(id: string) {
    try {
      await deleteHospital(id);
      setShowDeleteConfirm(null);
      loadHospitals();
    } catch (error) {
      console.error('Error deleting hospital:', error);
    }
  }

  async function handleBulkDelete() {
    try {
      for (const id of selectedHospitals) {
        await deleteHospital(id);
      }
      setShowBulkDeleteConfirm(false);
      setSelectionMode(false);
      setSelectedHospitals(new Set());
      loadHospitals();
    } catch (error) {
      console.error('Error deleting hospitals:', error);
    }
  }

  function toggleHospitalSelection(id: string) {
    setSelectedHospitals(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedHospitals(new Set());
  }

  const filteredHospitals = hospitals.filter(h => {
    const matchesSearch = h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'all' || h.hospital_type === filterType;
    return matchesSearch && matchesFilter;
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
      {/* Admin Data Completeness Dashboard */}
      {hospitals.length > 0 && (
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-teal-600" />
            <h3 className="font-semibold text-slate-800">
              {isRTL ? 'لوحة اكتمال البيانات' : 'Data Completeness Dashboard'}
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              {
                label: isRTL ? 'إجمالي المستشفيات' : 'Total Hospitals',
                value: hospitals.length,
                color: 'teal',
              },
              {
                label: isRTL ? 'مستشفيات بها بيانات' : 'With Data',
                value: hospitals.filter((h) => (hospitalStats[h.id]?.isolates ?? 0) > 0).length,
                color: 'emerald',
              },
              {
                label: isRTL ? 'بدون بيانات' : 'No Data',
                value: hospitals.filter((h) => (hospitalStats[h.id]?.isolates ?? 0) === 0).length,
                color: 'rose',
              },
              {
                label: isRTL ? 'إجمالي العزلات' : 'Total Isolates',
                value: Object.values(hospitalStats).reduce((s, v) => s + (v.isolates ?? 0), 0).toLocaleString(),
                color: 'slate',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className={`rounded-2xl p-3 bg-${color}-50 border border-${color}-100`}>
                <div className={`text-xl font-bold text-${color}-700`}>{value}</div>
                <div className={`text-xs text-${color}-500 mt-0.5`}>{label}</div>
              </div>
            ))}
          </div>
          {/* Per-hospital completeness bars */}
          <div className="space-y-2">
            {hospitals.map((h) => {
              const stats = hospitalStats[h.id];
              const isolates = stats?.isolates ?? 0;
              const files = stats?.files ?? 0;
              const maxIsolates = Math.max(1, ...Object.values(hospitalStats).map((s) => s.isolates ?? 0));
              const pct = Math.round((isolates / maxIsolates) * 100);
              const hasData = isolates > 0;
              return (
                <div key={h.id} className="flex items-center gap-3 text-sm">
                  <span className="w-36 truncate text-slate-700 shrink-0">{h.name}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${hasData ? 'bg-teal-500' : 'bg-slate-200'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 w-28 text-end">
                    {isolates > 0 ? `${isolates.toLocaleString()} isolates · ${files} uploads` : (
                      <span className="flex items-center justify-end gap-1 text-amber-600">
                        <AlertCircle className="w-3 h-3" />{isRTL ? 'لا بيانات' : 'No data'}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-800">{t.hospitals.title}</h1>
          <p className="text-slate-500 mt-1">{t.hospitals.addFirst}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Multi-hospital file upload */}
          <button
            onClick={() => setShowMultiUploadModal(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-2xl font-medium shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 transition-all duration-300 hover:-translate-y-0.5"
          >
            <Layers className="w-5 h-5" />
            {isRTL ? 'رفع ملف متعدد المستشفيات' : 'Multi-Hospital Upload'}
          </button>

          {/* Selection mode toggle */}
          <button
            onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl font-medium transition-all duration-300 hover:-translate-y-0.5 ${
              selectionMode
                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <CheckSquare className="w-5 h-5" />
            {selectionMode
              ? (isRTL ? 'إلغاء التحديد' : 'Cancel')
              : (isRTL ? 'تحديد متعدد' : 'Select')}
          </button>

          {/* Bulk delete — only when something is selected */}
          {selectionMode && selectedHospitals.size > 0 && (
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500 text-white rounded-2xl font-medium shadow-lg shadow-rose-500/30 hover:shadow-xl hover:shadow-rose-500/40 transition-all duration-300 hover:-translate-y-0.5"
            >
              <Trash2 className="w-5 h-5" />
              {isRTL ? `حذف (${selectedHospitals.size})` : `Delete (${selectedHospitals.size})`}
            </button>
          )}

          {/* Add new hospital */}
          <button
            onClick={() => {
              setEditingHospital(null);
              setShowHospitalModal(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl hover:shadow-teal-500/40 transition-all duration-300 hover:-translate-y-0.5"
          >
            <Plus className="w-5 h-5" />
            {t.hospitals.addNew}
          </button>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
          <input
            type="text"
            placeholder={t.common.search}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-white rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all`}
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-3 bg-white rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
          >
            <option value="all">{t.antibiogram.allHospitals}</option>
            <option value="government">{t.hospitals.government}</option>
            <option value="private">{t.hospitals.private}</option>
            <option value="teaching">{t.hospitals.teaching}</option>
          </select>
          <div className="flex bg-white rounded-2xl border border-slate-200 p-1">
            <button
              onClick={() => setViewMode('grid')}
              aria-label={isRTL ? 'عرض شبكي' : 'Grid view'}
              aria-pressed={viewMode === 'grid'}
              className={`p-2 rounded-xl transition-colors ${viewMode === 'grid' ? 'bg-teal-500 text-white' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Grid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              aria-label={isRTL ? 'عرض قائمة' : 'List view'}
              aria-pressed={viewMode === 'list'}
              className={`p-2 rounded-xl transition-colors ${viewMode === 'list' ? 'bg-teal-500 text-white' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Hospitals Grid/List */}
      {filteredHospitals.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
            <Building2 className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-xl font-semibold text-slate-800 mb-2">{t.hospitals.noHospitals}</h3>
          <p className="text-slate-500 mb-6">{t.hospitals.addFirst}</p>
          <button
            onClick={() => setShowHospitalModal(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg hover:shadow-xl transition-all"
          >
            <Plus className="w-5 h-5" />
            {t.hospitals.addNew}
          </button>
        </div>
      ) : (
        <div className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
          {filteredHospitals.map((hospital) => (
            <HospitalCard
              key={hospital.id}
              hospital={hospital}
              isolates={hospitalStats[hospital.id]?.isolates || 0}
              filesCount={hospitalStats[hospital.id]?.files || 0}
              onEdit={() => {
                setEditingHospital(hospital);
                setShowHospitalModal(true);
              }}
              onDelete={() => setShowDeleteConfirm(hospital.id)}
              onUpload={() => {
                setUploadingToHospital(hospital);
                setShowUploadModal(true);
              }}
              onViewDetails={() => setViewingHospital(hospital)}
              selectionMode={selectionMode}
              selected={selectedHospitals.has(hospital.id)}
              onSelect={() => toggleHospitalSelection(hospital.id)}
            />
          ))}
        </div>
      )}

      {/* Hospital Modal */}
      {showHospitalModal && (
        <HospitalModal
          hospital={editingHospital}
          onClose={() => {
            setShowHospitalModal(false);
            setEditingHospital(null);
          }}
          onSave={handleSaveHospital}
        />
      )}

      {/* Upload Modal — single hospital */}
      {showUploadModal && uploadingToHospital && (
        <UploadModal
          hospital={uploadingToHospital}
          onClose={() => {
            setShowUploadModal(false);
            setUploadingToHospital(null);
          }}
          onSuccess={loadHospitals}
        />
      )}

      {/* Multi-Hospital Upload Modal — no pre-selected hospital */}
      {showMultiUploadModal && (
        <UploadModal
          onClose={() => setShowMultiUploadModal(false)}
          onSuccess={loadHospitals}
          onHospitalsCreated={loadHospitals}
        />
      )}

      {/* Bulk Delete Confirmation */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowBulkDeleteConfirm(false)}>
          <div className="bg-white rounded-3xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-rose-100 flex items-center justify-center">
                <Trash2 className="w-8 h-8 text-rose-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-800 mb-2">
                {isRTL ? 'حذف المستشفيات المحددة' : 'Delete Selected Hospitals'}
              </h3>
              <p className="text-slate-500 mb-6">
                {isRTL
                  ? `سيتم حذف ${selectedHospitals.size} مستشفى بشكل نهائي مع جميع بياناتها. هذا الإجراء لا يمكن التراجع عنه.`
                  : `${selectedHospitals.size} hospital(s) and all their data will be permanently deleted. This action cannot be undone.`}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex-1 px-4 py-3 bg-rose-500 text-white rounded-2xl font-medium hover:bg-rose-600 transition-colors"
                >
                  {isRTL ? `حذف ${selectedHospitals.size}` : `Delete ${selectedHospitals.size}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-rose-100 flex items-center justify-center">
                <X className="w-8 h-8 text-rose-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-800 mb-2">{t.hospitals.delete}</h3>
              <p className="text-slate-500 mb-6">{t.hospitals.confirmDelete}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => handleDeleteHospital(showDeleteConfirm)}
                  className="flex-1 px-4 py-3 bg-rose-500 text-white rounded-2xl font-medium hover:bg-rose-600 transition-colors"
                >
                  {t.common.delete}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hospital Details Modal */}
      {viewingHospital && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewingHospital(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-slate-800">{viewingHospital.name}</h3>
              <button onClick={() => setViewingHospital(null)} aria-label={isRTL ? 'إغلاق' : 'Close'} className="p-2 hover:bg-slate-100 rounded-xl">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">{t.hospitals.code}</span>
                <span className="font-medium text-slate-800">{viewingHospital.code}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">{t.hospitals.city}</span>
                <span className="font-medium text-slate-800">{viewingHospital.city || '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">{t.hospitals.type}</span>
                <span className="font-medium text-slate-800">{viewingHospital.hospital_type}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">{t.hospitals.email}</span>
                <span className="font-medium text-slate-800">{viewingHospital.email || '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">{t.hospitals.phone}</span>
                <span className="font-medium text-slate-800">{viewingHospital.phone || '-'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
