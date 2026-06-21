import { useLanguage } from '../i18n/LanguageContext';

interface PolicyBadgeProps {
  status?: 'first_line' | 'restricted' | 'unrestricted' | null;
  notes?: string | null;
  showNotesTooltip?: boolean;
}

export function PolicyBadge({ status, notes, showNotesTooltip = true }: PolicyBadgeProps) {
  const { t } = useLanguage();
  if (!status) return null;

  let bgClass = '';
  let text = '';

  switch (status) {
    case 'first_line':
      bgClass = 'bg-emerald-500 text-white';
      text = t.stewardship.badgeFirstLine;
      break;
    case 'restricted':
      bgClass = 'bg-rose-500 text-white';
      text = t.stewardship.badgeRestricted;
      break;
    case 'unrestricted':
      bgClass = 'bg-amber-500 text-white';
      text = t.stewardship.badgeUnrestricted;
      break;
    default:
      return null;
  }

  // Ensure title has a nice formatting
  const tooltipText = notes 
    ? `${text}: ${notes}` 
    : text;

  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-md shadow-sm select-none transition-all duration-200 ${bgClass}`}
      title={showNotesTooltip ? tooltipText : undefined}
    >
      {text}
    </span>
  );
}
