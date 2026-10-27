/**
 * Google API keys travel in the x-goog-api-key header, never in the URL (URLs end up in logs, proxies and
 * error messages), and Telegram voice notes use a current model (gemini-2.0-flash is gone).
 * Run with: cd apps/api && npx tsx --test src/modules/telegram/google-key-header.spec.ts
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramMediaService } from './telegram-media.service';
import { EvalsService } from '../evals/evals.service';

const KEY = 'AIza-test-key-sentinel';
const realFetch = globalThis.fetch;
const calls: Array<{ url: string; headers: Record<string, string> }> = [];

function stubFetch(body: unknown) {
  calls.length = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: { ...(init?.headers || {}) } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
}

afterEach(() => { globalThis.fetch = realFetch; });

describe('Google key placement', () => {
  it('Telegram STT: current model, key in header only', async () => {
    stubFetch({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] });
    const svc = new TelegramMediaService({ get: async () => KEY, plaintext: async () => KEY } as any);
    (svc as any).getGeminiKey = async () => KEY;
    const text = await svc.transcribeAudio(Buffer.from('ogg'));
    assert.equal(text, 'hello');
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].url.includes(KEY), 'key must not be in the URL');
    assert.ok(!calls[0].url.includes('?key='));
    assert.match(calls[0].url, /models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  });

  it('evals: key in header, model kept to one path segment', async () => {
    stubFetch({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    const svc = new EvalsService({} as any);
    await (svc as any).callGoogle('../../v1/files?x=', 'sys', 'hi', { apiKey: KEY });
    assert.ok(!calls[0].url.includes(KEY));
    assert.match(calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/?]+:generateContent$/);
    assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  });
});
