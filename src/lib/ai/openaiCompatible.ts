/**
 * OpenAI-compatible provider — lets the user point the app at any endpoint
 * that speaks the OpenAI Chat Completions + Models API (hosted services, local
 * runtimes like Ollama/LM Studio, gateways). This is what "expands" the model
 * choice beyond Claude. Implemented with raw fetch (not the Anthropic SDK).
 */
import { AIProvider, AIModelInfo, AISettings, GenerateParams } from './types';

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export const openAICompatibleProvider: AIProvider = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible',
  needsBaseURL: true,

  async listModels(settings: AISettings): Promise<AIModelInfo[]> {
    const res = await fetch(`${trimBase(settings.baseURL)}/models`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
    if (!res.ok) throw new Error(`Model discovery failed (${res.status})`);
    const json = await res.json();
    const data: Array<{ id: string }> = json?.data || [];
    return data.map((m) => ({ id: m.id, label: m.id }));
  },

  rankModels(models: AIModelInfo[]): AIModelInfo[] {
    // No reliable capability signal here — surface newest-looking ids first.
    return [...models].sort((a, b) => b.id.localeCompare(a.id));
  },

  async streamText(settings: AISettings, params: GenerateParams): Promise<string> {
    const res = await fetch(`${trimBase(settings.baseURL)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      signal: params.signal,
      body: JSON.stringify({
        model: settings.model,
        stream: true,
        max_tokens: params.maxTokens ?? 2048,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.prompt },
        ],
      }),
    });

    if (!res.ok || !res.body) throw new Error(`AI request failed (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta: string = json?.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            params.onDelta?.(delta);
          }
        } catch {
          /* ignore keep-alive / partial frames */
        }
      }
    }
    return full;
  },
};
