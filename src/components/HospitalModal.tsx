import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Hospital } from '../types/database';
import { X, Building2, MapPin, Mail, Phone, User, FileCode, Building, Briefcase, GraduationCap, AlertCircle, Loader2 } from 'lucide-react';

interface HospitalModalProps {
  hospital: Hospital | null;
  onClose: () => void;
  onSave: (data: Omit<Hospital, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
}

export function HospitalModal({ hospital, onClose, onSave }: HospitalModalProps) {
  const { t, isRTL } = useLanguage();
  const [formData, setFormData] = useState({
    name: hospital?.name || '',
    code: hospital?.code || '',
    city: hospital?.city || '',
    country: hospital?.country || 'Iraq',
    hospital_type: hospital?.hospital_type || 'government' as const,
    contact_person: hospital?.contact_person || '',
    email: hospital?.email || '',
    phone: hospital?.phone || '',
    address: hospital?.address || '',
    is_active: hospital?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function validate() {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = t.common.required;
    if (!formData.code.trim()) newErrors.code = t.common.required;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    // Postgres unique_violation on the hospitals.code column
    if (code === '23505' || /duplicate key|unique/i.test(msg)) {
      return isRTL
        ? 'رمز المستشفى مستخدم بالفعل. اختر رمزاً مختلفاً.'
        : 'This hospital code is already in use. Choose a different code.';
    }
    return (isRTL ? 'تعذّر الحفظ: ' : 'Could not save: ') + msg;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || saving) return;
    setSubmitError(null);
    setSaving(true);
    try {
      await onSave(formData);
      // On success the parent unmounts this modal.
    } catch (err) {
      setSubmitError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  const typeButtons = [
    { value: 'government', label: t.hospitals.government, icon: Building },
    { value: 'private', label: t.hospitals.private, icon: Briefcase },
    { value: 'teaching', label: t.hospitals.teaching, icon: GraduationCap },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800">
              {hospital ? t.hospitals.edit : t.hospitals.addNew}
            </h2>
          </div>
          <button onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label htmlFor="hospital-name" className="block text-sm font-medium text-slate-700 mb-2">
              {t.hospitals.name} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Building2 className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
              <input
                id="hospital-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-slate-50 rounded-2xl border ${errors.name ? 'border-rose-300' : 'border-slate-200'} focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all`}
                placeholder={t.hospitals.name}
              />
            </div>
            {errors.name && <p className="text-sm text-rose-500 mt-1">{errors.name}</p>}
          </div>

          {/* Code */}
          <div>
            <label htmlFor="hospital-code" className="block text-sm font-medium text-slate-700 mb-2">
              {t.hospitals.code} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <FileCode className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
              <input
                id="hospital-code"
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-slate-50 rounded-2xl border ${errors.code ? 'border-rose-300' : 'border-slate-200'} focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-mono`}
                placeholder="HOSP001"
              />
            </div>
            {errors.code && <p className="text-sm text-rose-500 mt-1">{errors.code}</p>}
          </div>

          {/* Hospital Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t.hospitals.type}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {typeButtons.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, hospital_type: type.value })}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                      formData.hospital_type === type.value
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${formData.hospital_type === type.value ? 'text-teal-600' : 'text-slate-400'}`} />
                    <span className={`text-sm font-medium ${formData.hospital_type === type.value ? 'text-teal-700' : 'text-slate-600'}`}>
                      {type.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* City and Country */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{t.hospitals.city}</label>
              <div className="relative">
                <MapPin className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all`}
                  placeholder={t.hospitals.city}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{t.hospitals.country}</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                placeholder={t.hospitals.country}
              />
            </div>
          </div>

          {/* Contact Person */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t.hospitals.contact}</label>
            <div className="relative">
              <User className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
              <input
                type="text"
                value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all`}
                placeholder={t.hospitals.contact}
              />
            </div>
          </div>

          {/* Email and Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{t.hospitals.email}</label>
              <div className="relative">
                <Mail className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all`}
                  placeholder={t.hospitals.email}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{t.hospitals.phone}</label>
              <div className="relative">
                <Phone className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`} />
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className={`w-full ${isRTL ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all`}
                  placeholder={t.hospitals.phone}
                />
              </div>
            </div>
          </div>

          {/* Status Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
            <div>
              <p className="font-medium text-slate-800">{t.hospitals.status}</p>
              <p className="text-sm text-slate-500">{formData.is_active ? t.hospitals.active : t.hospitals.inactive}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={formData.is_active}
              aria-label={t.hospitals.status}
              onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
              className={`relative w-14 h-8 rounded-full transition-colors ${formData.is_active ? 'bg-teal-500' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-all ${formData.is_active ? (isRTL ? 'left-1' : 'right-1') : (isRTL ? 'right-1' : 'left-1')}`} />
            </button>
          </div>

          {submitError && (
            <div className="flex items-center gap-3 p-4 bg-rose-50 text-rose-700 rounded-2xl text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl transition-all disabled:opacity-60"
            >
              {saving && <Loader2 className="w-5 h-5 animate-spin" />}
              {t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
