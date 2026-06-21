export interface Hospital {
  id: string;
  name: string;
  code: string;
  city?: string;
  country?: string;
  hospital_type: 'government' | 'private' | 'teaching';
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Period = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'annual';

export interface AntibiogramData {
  id: string;
  hospital_id: string;
  organism: string;
  antibiotic: string;
  susceptible_count: number;
  intermediate_count: number;
  resistant_count: number;
  total_tested: number;
  susceptible_percent: number;
  year: number;
  period: Period;
  standard: 'CLSI' | 'EUCAST';
  specimen_type?: string | null;
  patient_id?: string | null;
  mic_distribution?: Record<string, number> | null;
  upload_date: string;
  created_at: string;
}

export interface UploadHistory {
  id: string;
  hospital_id: string;
  filename: string;
  year: number;
  standard: 'CLSI' | 'EUCAST';
  status: 'processing' | 'success' | 'error';
  records_count: number;
  error_message?: string;
  uploaded_at: string;
}

export interface HospitalAntibioticOrder {
  id: string;
  hospital_id: string;
  antibiotic_group: string;
  antibiotics_order: string[];
  created_at: string;
  updated_at: string;
}

export interface AntibiogramTemplate {
  id: string;
  hospital_id: string;
  name: string;
  period_type: Period | null;
  year: number;
  organisms: string[];
  antibiotics: string[];
  layout_settings: Record<string, unknown>;
  is_default: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganismCatalogEntry {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface AntibioticCatalogEntry {
  id: string;
  name: string;
  is_active: boolean;
  policy_status?: 'first_line' | 'restricted' | 'unrestricted' | null;
  policy_notes?: string | null;
  created_at: string;
}

export interface SyndromeCatalogEntry {
  id: string;
  name: string;
  organisms: string[];
  created_at: string;
}

export interface AntibiogramTrend {
  id: string;
  hospital_id: string;
  organism: string;
  antibiotic: string;
  year: number;
  period: Period;
  susceptible_percent: number;
  trend_direction: 'increasing' | 'decreasing' | 'stable';
  change_from_previous: number;
  created_at: string;
}

export interface AntibiogramChartData {
  antibiotic: string;
  susceptible: number;
  intermediate: number;
  resistant: number;
  total: number;
  percent: number;
}

export interface OrganismData {
  name: string;
  data: AntibiogramChartData[];
  totalIsolates: number;
}

export interface ExcelDataRow {
  organism: string;
  antibiotic: string;
  S?: number;
  I?: number;
  R?: number;
  total?: number;
  percent_S?: number;
  specimen_type?: string;
  patient_id?: string;
}

export interface PeriodOption {
  value: Period;
  labelKey: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { value: 'Q1', labelKey: 'q1' },
  { value: 'Q2', labelKey: 'q2' },
  { value: 'Q3', labelKey: 'q3' },
  { value: 'Q4', labelKey: 'q4' },
  { value: 'H1', labelKey: 'h1' },
  { value: 'H2', labelKey: 'h2' },
];
