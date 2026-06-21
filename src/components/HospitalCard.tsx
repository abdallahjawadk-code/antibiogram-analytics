import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Hospital } from '../types/database';
import { Building2, MapPin, Mail, Phone, Calendar, MoreVertical, Edit2, Trash2, FileUp, Eye, Building, Briefcase, GraduationCap, Check } from 'lucide-react';

interface HospitalCardProps {
  hospital: Hospital;
  isolates: number;
  filesCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: () => void;
  onViewDetails: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export function HospitalCard({ hospital, isolates, filesCount, onEdit, onDelete, onUpload, onViewDetails, selectionMode, selected, onSelect }: HospitalCardProps) {
  const { t, isRTL } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);
  const [, setIsHovered] = useState(false);

  const typeIcons = {
    government: Building,
    private: Briefcase,
    teaching: GraduationCap,
  };

  const TypeIcon = typeIcons[hospital.hospital_type] || Building2;

  const typeColors = {
    government: 'from-blue-500 to-indigo-600',
    private: 'from-amber-500 to-orange-600',
    teaching: 'from-emerald-500 to-teal-600',
  };

  const typeLabels = {
    government: t.hospitals.government,
    private: t.hospitals.private,
    teaching: t.hospitals.teaching,
  };

  return (
    <div
      className={`group relative bg-white rounded-3xl shadow-sm border overflow-hidden transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 ${
        selectionMode && selected
          ? 'border-rose-400 ring-2 ring-rose-300 shadow-rose-100'
          : 'border-slate-100 hover:border-slate-200'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={selectionMode ? onSelect : undefined}
      style={selectionMode ? { cursor: 'pointer' } : undefined}
    >
      {/* Gradient Top Bar */}
      <div className={`h-2 bg-gradient-to-r ${typeColors[hospital.hospital_type]}`} />

      {/* Status Indicator */}
      <div className={`absolute top-5 ${isRTL ? 'left-4' : 'right-4'}`}>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
          hospital.is_active
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-slate-100 text-slate-600'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            hospital.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
          }`} />
          <span className="text-xs font-medium">
            {hospital.is_active ? t.hospitals.active : t.hospitals.inactive}
          </span>
        </div>
      </div>

      {/* Selection Checkbox / Menu Button */}
      {selectionMode ? (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
          className={`absolute top-5 ${isRTL ? 'right-4' : 'left-4'} w-8 h-8 rounded-xl flex items-center justify-center transition-all z-10 ${
            selected
              ? 'bg-rose-500 text-white shadow-md shadow-rose-300'
              : 'bg-slate-100 hover:bg-slate-200 border-2 border-slate-300'
          }`}
          aria-label={selected ? (isRTL ? 'إلغاء التحديد' : 'Deselect') : (isRTL ? 'تحديد' : 'Select')}
          aria-pressed={selected}
        >
          {selected && <Check className="w-4 h-4" />}
        </button>
      ) : (
        <button
          onClick={() => setShowMenu(!showMenu)}
          className={`absolute top-5 ${isRTL ? 'right-4' : 'left-4'} p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors z-10`}
          aria-label={`${t.common.edit} ${hospital.name}`}
          aria-haspopup="menu"
          aria-expanded={showMenu}
        >
          <MoreVertical className="w-4 h-4 text-slate-500" />
        </button>
      )}

      {/* Dropdown Menu */}
      {showMenu && (
        <div role="menu" className={`absolute ${isRTL ? 'right-4' : 'left-4'} top-16 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 z-20 min-w-[160px]`} onClick={() => setShowMenu(false)}>
          <button
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); onViewDetails(); setShowMenu(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
          >
            <Eye className="w-4 h-4" />
            <span className="text-sm font-medium">{t.hospitals.viewDetails}</span>
          </button>
          <button
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); onEdit(); setShowMenu(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            <span className="text-sm font-medium">{t.common.edit}</span>
          </button>
          <button
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); onUpload(); setShowMenu(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-teal-600 hover:bg-teal-50 rounded-xl transition-colors"
          >
            <FileUp className="w-4 h-4" />
            <span className="text-sm font-medium">{t.hospitals.uploadFile}</span>
          </button>
          <div className="h-px bg-slate-100 my-1" />
          <button
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm font-medium">{t.common.delete}</span>
          </button>
        </div>
      )}

      {/* Content */}
      <div className="p-6 pt-12">
        {/* Hospital Icon */}
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${typeColors[hospital.hospital_type]} flex items-center justify-center shadow-lg mb-4 group-hover:scale-110 transition-transform duration-500`}
          style={{ boxShadow: `${typeColors[hospital.hospital_type].includes('blue') ? '0 10px 30px -10px rgba(59, 130, 246, 0.5)' : typeColors[hospital.hospital_type].includes('amber') ? '0 10px 30px -10px rgba(245, 158, 11, 0.5)' : '0 10px 30px -10px rgba(16, 185, 129, 0.5)'}` }}
        >
          <TypeIcon className="w-8 h-8 text-white" />
        </div>

        {/* Hospital Name */}
        <h3 className="text-xl font-bold text-slate-800 mb-1 group-hover:text-teal-700 transition-colors">
          {hospital.name}
        </h3>

        {/* Hospital Code */}
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
          <span className="px-2 py-0.5 bg-slate-100 rounded-lg font-mono">
            {hospital.code}
          </span>
          <span className="text-slate-300">|</span>
          <span>{typeLabels[hospital.hospital_type]}</span>
        </div>

        {/* Location */}
        {hospital.city && (
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <MapPin className="w-4 h-4 text-slate-400" />
            <span>{hospital.city}{hospital.country ? `, ${hospital.country}` : ''}</span>
          </div>
        )}

        {/* Contact Info */}
        <div className="space-y-2 mb-4">
          {hospital.email && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Mail className="w-4 h-4 text-slate-400" />
              <span className="truncate">{hospital.email}</span>
            </div>
          )}
          {hospital.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Phone className="w-4 h-4 text-slate-400" />
              <span>{hospital.phone}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-teal-100 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-teal-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">{filesCount}</p>
                <p className="text-xs text-slate-400">{t.hospitals.files}</p>
              </div>
            </div>
          </div>
          <div className="w-px h-12 bg-slate-100" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">{isolates.toLocaleString()}</p>
                <p className="text-xs text-slate-400">{t.hospitals.isolates}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hover Overlay */}
      <div className={`absolute inset-0 bg-gradient-to-t from-teal-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`} />
    </div>
  );
}
