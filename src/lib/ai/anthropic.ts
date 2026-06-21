/**
 * Anthropic (Claude) provider — the recommended, first-class AI backend.
 * Uses the official @anthropic-ai/sdk. Runs in the renderer with the user's
 * own key (dangerouslyAllowBrowser), which is appropriate for a desktop app
 * where the key never leaves the user's machine.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIModelInfo, AISettings, GenerateParams } from './types';

/** Capability order, best-first — used by auto-select. */
const PREFERENCE = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

function rank(id: string): number {
  const i = PREFERENCE.findIndex((p) => id.startsWith(p));
  return i === -1 ? PREFERENCE.length : i;
}

function makeClient(settings: AISettings): Anthropic {
  return new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
}

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  needsBaseURL: false,

  async listModels(settings: AISettings): Promise<AIModelInfo[]> {
    const client = makeClient(settings);
    const models: AIModelInfo[] = [];
    // The models list endpoint auto-paginates when iterated.
    for await (const m of client.models.list()) {
      models.push({ id: m.id, label: m.display_name || m.id });
    }
    return models;
  },

  rankModels(models: AIModelInfo[]): AIModelInfo[] {
    return [...models].sort((a, b) => {
      const d = rank(a.id) - rank(b.id);
      return d !== 0 ? d : b.id.localeCompare(a.id);
    });
  },

  async streamText(settings: AISettings, params: GenerateParams): Promise<string> {
    const client = makeClient(settings);
    const stream = client.messages.stream(
      {
        model: settings.model || 'claude-opus-4-8',
        max_tokens: params.maxTokens ?? 2048,
        system: params.system,
        messages: [{ role: 'user', content: params.prompt }],
      },
      { signal: params.signal },
    );

    if (params.onDelta) {
      stream.on('text', (delta) => params.onDelta!(delta));
    }

    const final = await stream.finalMessage();
    return final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  },
};
