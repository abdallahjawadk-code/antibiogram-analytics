/**
 * AI subsystem types.
 *
 * The AI layer is fully optional and provider-extensible. A "provider" knows
 * how to (1) discover the models available to the user's credentials and
 * (2) stream a text completion. Anthropic (Claude) is the first-class,
 * recommended provider; an OpenAI-compatible provider lets the user point at
 * any compatible endpoint (local or hosted) to expand model choice.
 */
export type AIProviderId = 'anthropic' | 'openai-compatible';

export interface AIModelInfo {
  id: string;
  label: string;
}

export interface AISettings {
  /** master switch — when false the app behaves exactly as before */
  enabled: boolean;
  providerId: AIProviderId;
  /** the user's own API key (stored locally on this machine only) */
  apiKey: string;
  /** base URL for the OpenAI-compatible provider (ignored by Anthropic) */
  baseURL: string;
  /** when true, discovery auto-picks the most capable model */
  autoSelect: boolean;
  /** the currently selected model id */
  model: string;
}

export interface GenerateParams {
  system: string;
  prompt: string;
  /** called with each streamed text chunk */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  /** soft output cap */
  maxTokens?: number;
}

export interface AIProvider {
  id: AIProviderId;
  label: string;
  /** whether this provider needs a base URL configured */
  needsBaseURL: boolean;
  /** discover the models available to these credentials */
  listModels(settings: AISettings): Promise<AIModelInfo[]>;
  /** order models best-first so auto-select can pick index 0 */
  rankModels(models: AIModelInfo[]): AIModelInfo[];
  /** stream a completion; resolves with the full text */
  streamText(settings: AISettings, params: GenerateParams): Promise<string>;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  providerId: 'anthropic',
  apiKey: '',
  baseURL: 'https://api.openai.com/v1',
  autoSelect: true,
  model: 'claude-opus-4-8',
};
