/**
 * LOCAL-ONLY data layer.
 *
 * The app currently stores everything on this device (localStorage) — no cloud,
 * no network, no login required. The exported function surface is unchanged from
 * the previous Supabase client so the rest of the app keeps working as-is.
 */
import type { Session } from '@supabase/supabase-js';
import { resistanceRate, reinterpretFromMic } from './clinical';
import {
  Hospital, AntibiogramData, UploadHistory, AntibiogramTemplate,
  OrganismCatalogEntry, AntibioticCatalogEntry, SyndromeCatalogEntry,
} from '../types/database';

// ── Storage engine: in-memory cache + IndexedDB write-through ─────────────────
// Reads are always synchronous (from _cache). Writes update cache immediately
// and persist to IndexedDB asynchronously (fire-and-forget).
// Falls back to localStorage transparently if IDB is unavailable.
const PREFIX = 'abx_local_';
const IDB_NAME = 'antibiogram_idb';
const IDB_VERSION = 1;
const IDB_STORE = 'kv';

const _cache: Record<string, unknown[]> = {};
let _idb: IDBDatabase | null = null;

function _openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function _idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

function _idbPut(db: IDBDatabase, key: string, value: unknown): void {
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
  } catch { /* silent */ }
}

const TABLES = [
  'hospitals', 'antibiogram_data', 'upload_history', 'organism_catalog',
  'antibiotic_catalog', 'syndrome_catalog', 'hospital_antibiotic_orders', 'antibiogram_templates',
];

/**
 * Call once at app startup (before any data reads).
 * Loads all tables from IndexedDB into the in-memory cache.
 * If IndexedDB has no data, migrates from localStorage.
 */
export async function initStorage(): Promise<void> {
  try {
    _idb = await _openIDB();
    for (const table of TABLES) {
      const idbVal = await _idbGet(_idb, PREFIX + table);
      if (Array.isArray(idbVal) && idbVal.length > 0) {
        _cache[table] = idbVal;
      } else {
        // Migrate from localStorage on first run
        try {
          const lsVal = localStorage.getItem(PREFIX + table);
          _cache[table] = lsVal ? (JSON.parse(lsVal) as unknown[]) : [];
          if (_cache[table].length > 0) _idbPut(_idb, PREFIX + table, _cache[table]);
        } catch { _cache[table] = []; }
      }
    }
  } catch {
    // IDB unavailable — fall back to localStorage
    for (const table of TABLES) {
      try {
        const lsVal = localStorage.getItem(PREFIX + table);
        _cache[table] = lsVal ? (JSON.parse(lsVal) as unknown[]) : [];
      } catch { _cache[table] = []; }
    }
  }
}

function read<T>(table: string): T[] {
  if (!_cache[table]) {
    // Lazy init for tables not in TABLES list
    try { _cache[table] = JSON.parse(localStorage.getItem(PREFIX + table) || '[]') as T[]; }
    catch { _cache[table] = []; }
  }
  return _cache[table] as T[];
}

function write<T>(table: string, rows: T[]): void {
  _cache[table] = rows as unknown[];
  if (_idb) {
    _idbPut(_idb, PREFIX + table, rows);
  } else {
    // Fallback to localStorage, swallow QuotaExceededError gracefully
    try { localStorage.setItem(PREFIX + table, JSON.stringify(rows)); }
    catch (e) {
      if ((e as Error)?.name === 'QuotaExceededError') {
        console.warn(`[Storage] localStorage quota exceeded for "${table}" — data kept in memory only.`);
      }
    }
  }
}
function uid(): string {
  return (crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function nowIso(): string { return new Date().toISOString(); }

/** Mimics a Postgres unique_violation so existing UI error handling still works. */
function uniqueViolation(message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = '23505';
  return e;
}

// --- Authentication (local no-op session so the app opens without login) -----
export const isSupabaseConfigured = true;
const LOCAL_SESSION = { user: { id: 'local-user', email: 'local@device' } } as unknown as Session;

export async function signIn(email: string, password: string) {
  void email; void password;
  return { session: LOCAL_SESSION, user: LOCAL_SESSION.user };
}
export async function signOut() { /* no-op in local mode */ }
export async function getSession(): Promise<Session | null> { return LOCAL_SESSION; }
export function onAuthChange(callback: (session: Session | null) => void) {
  callback(LOCAL_SESSION);
  return () => {};
}

// --- Hospitals ---------------------------------------------------------------
export async function getHospitals(): Promise<Hospital[]> {
  return read<Hospital>('hospitals').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function getHospitalByCode(code: string): Promise<Hospital | null> {
  return read<Hospital>('hospitals').find((h) => h.code === code) || null;
}

export async function createHospital(hospital: Omit<Hospital, 'id' | 'created_at' | 'updated_at'>) {
  const rows = read<Hospital>('hospitals');
  if (rows.some((h) => h.code === hospital.code)) {
    throw uniqueViolation('duplicate key value violates unique constraint "hospitals_code"');
  }
  const row = { ...hospital, id: uid(), created_at: nowIso(), updated_at: nowIso() } as Hospital;
  write('hospitals', [...rows, row]);
  return row;
}

export async function updateHospital(id: string, updates: Partial<Hospital>) {
  const rows = read<Hospital>('hospitals');
  if (updates.code && rows.some((h) => h.code === updates.code && h.id !== id)) {
    throw uniqueViolation('duplicate key value violates unique constraint "hospitals_code"');
  }
  let updated: Hospital | undefined;
  write('hospitals', rows.map((h) => (h.id === id ? (updated = { ...h, ...updates, updated_at: nowIso() }) : h)));
  return updated;
}

export async function deleteHospital(id: string) {
  write('hospitals', read<Hospital>('hospitals').filter((h) => h.id !== id));
  // Cascade: drop dependent rows.
  write('antibiogram_data', read<AntibiogramData>('antibiogram_data').filter((r) => r.hospital_id !== id));
  write('upload_history', read<UploadHistory>('upload_history').filter((r) => r.hospital_id !== id));
  write('hospital_antibiotic_orders', read<{ hospital_id: string }>('hospital_antibiotic_orders').filter((r) => r.hospital_id !== id));
  write('antibiogram_templates', read<AntibiogramTemplate>('antibiogram_templates').filter((r) => r.hospital_id !== id));
}

// --- Organism name normalizer ------------------------------------------------
// Collapses common spelling variants to a single canonical name so that
// "E-coli", "E.coli", "e coli", "Escherichia coli" all appear as one row.
function normalizeOrganismName(raw: string): string {
  const s = raw.trim();
  const lo = s.toLowerCase();
  if (/^e[-.\s]*coli$/i.test(lo) || /^escherichia(\s+coli)?$/i.test(lo)) return 'E. coli';
  if (/^k[-.\s]*pneumoniae$/i.test(lo) || /^klebsiella(\s+pneumoniae)?$/i.test(lo)) return 'K. pneumoniae';
  if (/^p[-.\s]*aeruginosa$/i.test(lo) || /^pseudomonas(\s+aeruginosa)?$/i.test(lo)) return 'P. aeruginosa';
  if (/^a[-.\s]*baumannii$/i.test(lo) || /^acinetobacter(\s+baumannii)?$/i.test(lo)) return 'A. baumannii';
  if (/^s[-.\s]*aureus$/i.test(lo) || /^staphylococcus(\s+aureus)?$/i.test(lo) || lo === 'staph') return 'S. aureus';
  if (/^(mrsa|methicillin[\s-]*resistant\s+s\.?\s*aureus)$/i.test(lo)) return 'MRSA';
  if (/^e[-.\s]*faecalis$/i.test(lo) || /^enterococcus\s+faecalis$/i.test(lo)) return 'E. faecalis';
  if (/^e[-.\s]*faecium$/i.test(lo) || /^enterococcus\s+faecium$/i.test(lo)) return 'E. faecium';
  if (/^enterococcus$/i.test(lo)) return 'E. faecalis';
  if (/^e[-.\s]*cloacae$/i.test(lo) || /^enterobacter(\s+cloacae)?$/i.test(lo)) return 'E. cloacae';
  if (/^s[-.\s]*marcescens$/i.test(lo) || /^serratia(\s+marcescens)?$/i.test(lo)) return 'S. marcescens';
  if (/^p[-.\s]*mirabilis$/i.test(lo) || /^proteus(\s+mirabilis)?$/i.test(lo)) return 'P. mirabilis';
  if (/^s[-.\s]*pneumoniae$/i.test(lo) || /^streptococcus(\s+pneumoniae)?$/i.test(lo)) return 'S. pneumoniae';
  if (/^salmonella\b/i.test(lo)) return 'Salmonella spp.';
  return s;
}

// --- Antibiogram data --------------------------------------------------------
function disabledSets() {
  const orgs = new Set(read<OrganismCatalogEntry>('organism_catalog').filter((c) => !c.is_active).map((c) => c.name));
  const abx = new Set(read<AntibioticCatalogEntry>('antibiotic_catalog').filter((c) => !c.is_active).map((c) => c.name));
  return { orgs, abx };
}

export async function getAntibiogramData(filters?: {
  hospitalId?: string;
  hospitalIds?: string[];
  organism?: string; year?: number; period?: string; specimenType?: string;
}): Promise<AntibiogramData[]> {
  const hospitals = read<Hospital>('hospitals');
  const nameById: Record<string, string> = {};
  hospitals.forEach((h) => { nameById[h.id] = h.name; });
  const { orgs, abx } = disabledSets();
  // The globally selected interpretation standard (shared with the Antibiogram
  // page toggle and Settings). Rows that carry a raw MIC histogram are
  // re-interpreted under this standard so a CLSI↔EUCAST switch re-derives S/I/R
  // everywhere; rows without MICs keep their stored upload-time counts.
  const standard = (localStorage.getItem('antibiogram-standard') as 'CLSI' | 'EUCAST') || 'CLSI';

  // Step 1 — filter
  const filtered = read<AntibiogramData>('antibiogram_data').filter((r) => {
    if (filters?.hospitalIds && filters.hospitalIds.length > 0) {
      if (!filters.hospitalIds.includes(r.hospital_id)) return false;
    } else if (filters?.hospitalId && r.hospital_id !== filters.hospitalId) return false;
    if (filters?.year && r.year !== filters.year) return false;
    if (filters?.period && filters.period !== 'all' && r.period !== filters.period) return false;
    if (filters?.specimenType && filters.specimenType !== 'all' && r.specimen_type !== filters.specimenType) return false;
    // Check catalog exclusions against the NORMALIZED name so variants are caught too
    const normOrg = normalizeOrganismName(r.organism);
    if (orgs.has(r.organism) || orgs.has(normOrg) || abx.has(r.antibiotic)) return false;
    return true;
  });

  // Step 2 — normalize organism names + aggregate rows that become identical after normalization
  const mergedMap = new Map<string, AntibiogramData>();
  for (const r of filtered) {
    const org = normalizeOrganismName(r.organism);
    if (filters?.organism && org !== filters.organism && r.organism !== filters.organism) continue;
    const key = [r.hospital_id, org, r.antibiotic, r.year, r.period, r.standard ?? '', r.specimen_type ?? ''].join('|');
    const ex = mergedMap.get(key);
    if (ex) {
      ex.susceptible_count   = (ex.susceptible_count   ?? 0) + (r.susceptible_count   ?? 0);
      ex.intermediate_count  = (ex.intermediate_count  ?? 0) + (r.intermediate_count  ?? 0);
      ex.resistant_count     = (ex.resistant_count     ?? 0) + (r.resistant_count     ?? 0);
      ex.total_tested        = (ex.total_tested        ?? 0) + (r.total_tested        ?? 0);
      ex.susceptible_percent = ex.total_tested > 0
        ? Math.round((ex.susceptible_count / ex.total_tested) * 10000) / 100
        : 0;
    } else {
      mergedMap.set(key, { ...r, organism: org });
    }
  }

  // Step 3 — apply MIC reinterpretation + join hospital name
  return [...mergedMap.values()]
    .map((r) => {
      const row = { ...r, hospitals: { name: nameById[r.hospital_id] || '' } };
      if (r.mic_distribution && Object.keys(r.mic_distribution).length > 0) {
        const re = reinterpretFromMic(r.organism, r.antibiotic, r.mic_distribution, standard);
        if (re) return { ...row, ...re, standard };
      }
      return row;
    })
    .sort((a, b) => a.antibiotic.localeCompare(b.antibiotic));
}

const ABX_KEY = (r: { hospital_id: string; organism: string; antibiotic: string; year: number; period: string; standard: string; specimen_type?: string | null }) =>
  [r.hospital_id, r.organism, r.antibiotic, r.year, r.period, r.standard, r.specimen_type ?? ''].join('|');

export async function insertAntibiogramData(data: Omit<AntibiogramData, 'id' | 'created_at' | 'upload_date'>[]) {
  const rows = read<AntibiogramData>('antibiogram_data');
  const byKey = new Map(rows.map((r) => [ABX_KEY(r), r]));
  for (const d of data) {
    const row = { ...d, organism: normalizeOrganismName(d.organism), specimen_type: d.specimen_type ?? '' } as AntibiogramData;
    const existing = byKey.get(ABX_KEY(row));
    if (existing) {
      Object.assign(existing, row, { id: existing.id, created_at: existing.created_at, upload_date: nowIso() });
    } else {
      const created = { ...row, id: uid(), created_at: nowIso(), upload_date: nowIso() } as AntibiogramData;
      byKey.set(ABX_KEY(created), created);
    }
  }
  write('antibiogram_data', [...byKey.values()]);
}

export async function getStatistics() {
  const totalHospitals = read<Hospital>('hospitals').length;
  const stats = read<AntibiogramData>('antibiogram_data');
  const totalIsolates = stats.reduce((s, i) => s + (i.total_tested || 0), 0);
  const resistantIsolates = stats.reduce((s, i) => s + (i.total_tested || 0) * resistanceRate(i), 0);
  const avgResistance = totalIsolates > 0 ? resistantIsolates / totalIsolates : 0;
  return { totalHospitals, totalIsolates, avgResistance: Math.round(avgResistance * 10) / 10 };
}

export async function getOrganisms(): Promise<string[]> {
  const set = new Set(read<AntibiogramData>('antibiogram_data').map((r) => normalizeOrganismName(r.organism)));
  const catalog = read<OrganismCatalogEntry>('organism_catalog');
  catalog.forEach((c) => { if (c.is_active) set.add(normalizeOrganismName(c.name)); });
  catalog.forEach((c) => { if (!c.is_active) set.delete(normalizeOrganismName(c.name)); });
  return [...set].sort();
}

export async function getYears(): Promise<number[]> {
  return [...new Set(read<AntibiogramData>('antibiogram_data').map((r) => r.year))].sort((a, b) => b - a);
}

export async function getPeriods(hospitalId?: string): Promise<string[]> {
  const rows = read<AntibiogramData>('antibiogram_data').filter((r) => !hospitalId || r.hospital_id === hospitalId);
  return [...new Set(rows.map((r) => r.period).filter(Boolean))].sort();
}

export async function getSpecimenTypes(): Promise<string[]> {
  return [...new Set(read<AntibiogramData>('antibiogram_data').map((r) => r.specimen_type).filter((s): s is string => !!s))].sort();
}

// --- Upload history ----------------------------------------------------------
export async function getUploadHistory(hospitalId?: string) {
  const nameById: Record<string, string> = {};
  read<Hospital>('hospitals').forEach((h) => { nameById[h.id] = h.name; });
  return read<UploadHistory>('upload_history')
    .filter((r) => !hospitalId || r.hospital_id === hospitalId)
    .map((r) => ({ ...r, hospitals: { name: nameById[r.hospital_id] || '' } }))
    .sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
}

export async function createUploadRecord(record: Omit<UploadHistory, 'id' | 'uploaded_at'>) {
  const row = { ...record, id: uid(), uploaded_at: nowIso() } as UploadHistory;
  write('upload_history', [...read<UploadHistory>('upload_history'), row]);
  return row;
}

export async function updateUploadRecord(id: string, updates: Partial<UploadHistory>) {
  write('upload_history', read<UploadHistory>('upload_history').map((r) => (r.id === id ? { ...r, ...updates } : r)));
}

/** Remove all antibiogram rows that were uploaded in the same batch and mark the history record as rolled back. */
export async function rollbackUpload(uploadId: string, hospitalId: string, uploadDate: string) {
  write('antibiogram_data',
    read<AntibiogramData>('antibiogram_data').filter(
      (r) => !(r.hospital_id === hospitalId && r.upload_date === uploadDate),
    ),
  );
  write('upload_history', read<UploadHistory>('upload_history').filter((r) => r.id !== uploadId));
}

// --- Catalogs (organisms / antibiotics) -------------------------------------
export function invalidateCatalogCache() { /* no cache in local mode */ }

function ensureInCatalog(table: 'organism_catalog' | 'antibiotic_catalog', names: string[]) {
  const rows = read<OrganismCatalogEntry>(table);
  const have = new Set(rows.map((r) => r.name));
  let changed = false;
  const isOrg = table === 'organism_catalog';
  for (const raw of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
    const name = isOrg ? normalizeOrganismName(raw) : raw;
    if (!have.has(name)) { rows.push({ id: uid(), name, is_active: true, created_at: nowIso() }); changed = true; have.add(name); }
  }
  if (changed) write(table, rows);
}

export const ensureOrganismsInCatalog = async (names: string[]) => ensureInCatalog('organism_catalog', names);
export const ensureAntibioticsInCatalog = async (names: string[]) => ensureInCatalog('antibiotic_catalog', names);

export async function getOrganismCatalog(): Promise<OrganismCatalogEntry[]> {
  return read<OrganismCatalogEntry>('organism_catalog').sort((a, b) => a.name.localeCompare(b.name));
}
export async function getAntibioticCatalog(): Promise<AntibioticCatalogEntry[]> {
  return read<AntibioticCatalogEntry>('antibiotic_catalog').sort((a, b) => a.name.localeCompare(b.name));
}

function setActive(table: 'organism_catalog' | 'antibiotic_catalog', id: string, isActive: boolean) {
  write(table, read<OrganismCatalogEntry>(table).map((r) => (r.id === id ? { ...r, is_active: isActive } : r)));
}
export async function setOrganismActive(id: string, isActive: boolean) { setActive('organism_catalog', id, isActive); }
export async function setAntibioticActive(id: string, isActive: boolean) { setActive('antibiotic_catalog', id, isActive); }

export async function updateAntibioticPolicy(
  id: string,
  status: AntibioticCatalogEntry['policy_status'],
  notes: string | null,
) {
  write('antibiotic_catalog', read<AntibioticCatalogEntry>('antibiotic_catalog')
    .map((r) => (r.id === id ? { ...r, policy_status: status, policy_notes: notes } : r)));
}

export async function deleteOrganismFromCatalog(id: string) {
  write('organism_catalog', read<OrganismCatalogEntry>('organism_catalog').filter((r) => r.id !== id));
}
export async function deleteAntibioticFromCatalog(id: string) {
  write('antibiotic_catalog', read<AntibioticCatalogEntry>('antibiotic_catalog').filter((r) => r.id !== id));
}

// --- Syndrome catalog --------------------------------------------------------
export async function getSyndromeCatalog(): Promise<SyndromeCatalogEntry[]> {
  return read<SyndromeCatalogEntry>('syndrome_catalog').sort((a, b) => a.name.localeCompare(b.name));
}
export async function addSyndrome(name: string, organisms: string[]): Promise<SyndromeCatalogEntry> {
  const row = { id: uid(), name: name.trim(), organisms, created_at: nowIso() } as SyndromeCatalogEntry;
  write('syndrome_catalog', [...read<SyndromeCatalogEntry>('syndrome_catalog'), row]);
  return row;
}
export async function deleteSyndrome(id: string): Promise<void> {
  write('syndrome_catalog', read<SyndromeCatalogEntry>('syndrome_catalog').filter((r) => r.id !== id));
}

// --- Antibiotic ordering -----------------------------------------------------
interface OrderRow { id: string; hospital_id: string; antibiotic_group: string; antibiotics_order: string[]; }
export async function getAntibioticOrder(hospitalId: string, group?: string) {
  return read<OrderRow>('hospital_antibiotic_orders')
    .filter((r) => r.hospital_id === hospitalId && (!group || r.antibiotic_group === group));
}
export async function saveAntibioticOrder(hospitalId: string, group: string, order: string[]) {
  const rows = read<OrderRow>('hospital_antibiotic_orders');
  const idx = rows.findIndex((r) => r.hospital_id === hospitalId && r.antibiotic_group === group);
  if (idx >= 0) rows[idx] = { ...rows[idx], antibiotics_order: order };
  else rows.push({ id: uid(), hospital_id: hospitalId, antibiotic_group: group, antibiotics_order: order });
  write('hospital_antibiotic_orders', rows);
}

// --- Templates ---------------------------------------------------------------
export async function getTemplates(hospitalId?: string): Promise<AntibiogramTemplate[]> {
  return read<AntibiogramTemplate>('antibiogram_templates')
    .filter((r) => !hospitalId || r.hospital_id === hospitalId)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
export async function createTemplate(template: Omit<AntibiogramTemplate, 'id' | 'created_at' | 'updated_at'>) {
  const row = { ...template, id: uid(), created_at: nowIso(), updated_at: nowIso() } as AntibiogramTemplate;
  write('antibiogram_templates', [...read<AntibiogramTemplate>('antibiogram_templates'), row]);
  return row;
}
export async function updateTemplate(id: string, updates: Partial<AntibiogramTemplate>) {
  let updated: AntibiogramTemplate | undefined;
  write('antibiogram_templates', read<AntibiogramTemplate>('antibiogram_templates')
    .map((r) => (r.id === id ? (updated = { ...r, ...updates, updated_at: nowIso() }) : r)));
  return updated;
}
export async function deleteTemplate(id: string) {
  write('antibiogram_templates', read<AntibiogramTemplate>('antibiogram_templates').filter((r) => r.id !== id));
}
