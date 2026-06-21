/**
 * AI subsystem entry point: settings persistence, provider registry, and the
 * two product features (narrative antibiogram summary + ask-your-data).
 *
 * Everything here is inert unless the user explicitly enables AI in Settings
 * and supplies their own API key.
 */
import { AIProvider, AIProviderId, AISettings, DEFAULT_AI_SETTINGS } from './types';
import { anthropicProvider } from './anthropic';
import { openAICompatibleProvider } from './openaiCompatible';
import { AntibiogramData } from '../../types/database';
import { computeSIR, MIN_RELIABLE_ISOLATES } from '../clinical';

export * from './types';

const STORAGE_KEY = 'antibiogram-ai-settings';

const PROVIDERS: Record<AIProviderId, AIProvider> = {
  'anthropic': anthropicProvider,
  'openai-compatible': openAICompatibleProvider,
};

export const AI_PROVIDERS: AIProvider[] = Object.values(PROVIDERS);

export function getProvider(id: AIProviderId): AIProvider {
  return PROVIDERS[id];
}

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_AI_SETTINGS };
}

export function saveAISettings(settings: AISettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** True when AI is enabled AND minimally configured to make a request. */
export function isAIReady(s: AISettings): boolean {
  if (!s.enabled || !s.apiKey || !s.model) return false;
  if (getProvider(s.providerId).needsBaseURL && !s.baseURL) return false;
  return true;
}

// --- Clinical context for the model -----------------------------------------

export interface AIReportContext {
  hospitalName: string;
  year: number | string;
  period?: string;
  standard: string;
  data: AntibiogramData[];
}

/**
 * Render the antibiogram into compact, accurate text the model can reason over.
 * Percentages come from computeSIR so the model never sees the inconsistent
 * stored values, and low-n combinations are flagged per CLSI M39.
 */
export function buildContextText(ctx: AIReportContext): string {
  const byOrg: Record<string, AntibiogramData[]> = {};
  ctx.data.forEach((d) => { (byOrg[d.organism] ||= []).push(d); });

  const lines: string[] = [
    `Hospital: ${ctx.hospitalName}`,
    `Year: ${ctx.year}${ctx.period ? `  Period: ${ctx.period}` : ''}`,
    `Standard: ${ctx.standard}`,
    `Reliability note: combinations with n < ${MIN_RELIABLE_ISOLATES} are marked "*" (estimate not statistically reliable, CLSI M39).`,
    '',
    'Data (organism | antibiotic | %S | %I | %R | n):',
  ];

  for (const [organism, rows] of Object.entries(byOrg)) {
    for (const d of rows) {
      const sir = computeSIR(d);
      const flag = sir.reliable ? '' : ' *';
      lines.push(
        `${organism} | ${d.antibiotic} | ${sir.susceptible.toFixed(0)}% | ` +
        `${sir.intermediate.toFixed(0)}% | ${sir.resistant.toFixed(0)}% | ${sir.total}${flag}`,
      );
    }
  }
  return lines.join('\n');
}

// --- Features ----------------------------------------------------------------

const ARABIC_INSTRUCTION = 'Respond in Arabic.';
const ENGLISH_INSTRUCTION = 'Respond in English.';

function langInstruction(isRTL: boolean): string {
  return isRTL ? ARABIC_INSTRUCTION : ENGLISH_INSTRUCTION;
}

const SUMMARY_SYSTEM = `You are a clinical microbiology assistant supporting an antimicrobial stewardship team. You are given a hospital antibiogram (cumulative susceptibility data). Produce a concise, clinically useful narrative summary: highlight the most notable resistance patterns, any organism/antibiotic combinations of concern, and 2-4 stewardship-relevant observations. Use only the data provided; never invent numbers. Treat any combination marked "*" (n below the reliability threshold) as low-confidence and say so. This is decision support, not a prescription — add a one-line caveat that local guidelines and an ID/microbiology specialist should be consulted.`;

const ASK_SYSTEM = `You are a clinical microbiology assistant. Answer the user's question strictly from the antibiogram data provided below. If the data does not contain the answer, say so plainly. Never fabricate values. Treat combinations marked "*" as low-confidence (n below the CLSI M39 reliability threshold). Keep answers focused and clinically grounded; this is decision support, not a prescription.`;

export async function summarizeAntibiogram(
  settings: AISettings,
  ctx: AIReportContext,
  isRTL: boolean,
  onDelta?: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const provider = getProvider(settings.providerId);
  const context = buildContextText(ctx);
  return provider.streamText(settings, {
    system: `${SUMMARY_SYSTEM}\n\n${langInstruction(isRTL)}`,
    prompt: `Antibiogram:\n\n${context}\n\nWrite the summary now.`,
    onDelta,
    signal,
    maxTokens: 1500,
  });
}

export async function askAboutData(
  settings: AISettings,
  ctx: AIReportContext,
  question: string,
  isRTL: boolean,
  onDelta?: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const provider = getProvider(settings.providerId);
  const context = buildContextText(ctx);
  return provider.streamText(settings, {
    system: `${ASK_SYSTEM}\n\n${langInstruction(isRTL)}`,
    prompt: `Antibiogram:\n\n${context}\n\nQuestion: ${question}`,
    onDelta,
    signal,
    maxTokens: 1200,
  });
}
