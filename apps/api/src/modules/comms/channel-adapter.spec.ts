/**
 * Unit tests for ChannelAdapter contract + registry.
 *
 * If these break, multi-channel routing either drops messages silently
 * (bad normalisation) or double-registers an adapter (last-write-wins
 * for the same channel — a tenant could hijack another's adapter).
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelAdapterRegistry,
  normalizeGenericWebhook,
  type ChannelAdapter,
  type InboundEvent,
} from './channel-adapter';

function fakeAdapter(name: string): ChannelAdapter {
  return {
    name,
    normalizeInbound: () => null,
    send: async () => ({ externalId: 'x' }),
  };
}

// ── ChannelAdapterRegistry ──────────────────────────────────────

describe('ChannelAdapterRegistry', () => {
  it('register + get round-trips', () => {
    const reg = new ChannelAdapterRegistry();
    const a = fakeAdapter('slack');
    reg.register(a);
    assert.equal(reg.get('slack'), a);
  });

  it('returns undefined for unknown name (no throw)', () => {
    const reg = new ChannelAdapterRegistry();
    assert.equal(reg.get('nope'), undefined);
  });

  it('refuses to register the same name twice', () => {
    const reg = new ChannelAdapterRegistry();
    reg.register(fakeAdapter('slack'));
    assert.throws(() => reg.register(fakeAdapter('slack')), /already registered/);
  });

  it('list() returns sorted names', () => {
    const reg = new ChannelAdapterRegistry();
    reg.register(fakeAdapter('z'));
    reg.register(fakeAdapter('a'));
    reg.register(fakeAdapter('m'));
    assert.deepEqual(reg.list(), ['a', 'm', 'z']);
  });
});

// ── normalizeGenericWebhook ────────────────────────────────────

describe('normalizeGenericWebhook', () => {
  it('handles Slack-style payload', () => {
    const r = normalizeGenericWebhook({
      channel: 'C12345',
      user: 'U987',
      text: 'hello agents',
      ts: '1715593200.000123',
    }, 'slack-webhook') as InboundEvent;
    assert.equal(r.adapter, 'slack-webhook');
    assert.equal(r.channelExternalId, 'C12345');
    assert.equal(r.senderExternalId, 'U987');
    assert.equal(r.text, 'hello agents');
    assert.ok(r.timestamp instanceof Date);
  });

  it('handles Discord-style payload (content + author_id + channel_id)', () => {
    const r = normalizeGenericWebhook({
      channel_id: '111', author_id: '222', author: 'maxbot',
      content: 'hi', timestamp: '2026-05-13T10:00:00Z',
    }, 'discord-webhook') as InboundEvent;
    assert.equal(r.channelExternalId, '111');
    assert.equal(r.senderExternalId, '222');
    assert.equal(r.senderDisplayName, 'maxbot');
    assert.equal(r.text, 'hi');
  });

  it('handles internal-shape payload (channelId + user_id)', () => {
    const r = normalizeGenericWebhook({
      channelId: 'X', user_id: 'Y', text: 't', username: 'me',
    }, 'generic') as InboundEvent;
    assert.equal(r.senderDisplayName, 'me');
  });

  it('returns null when text is empty', () => {
    const r = normalizeGenericWebhook({ channel: 'C', user: 'U', text: '' }, 'x');
    assert.equal(r, null);
  });

  it('returns null when channel id is missing', () => {
    const r = normalizeGenericWebhook({ user: 'U', text: 'hi' }, 'x');
    assert.equal(r, null);
  });

  it('returns null when sender id is missing', () => {
    const r = normalizeGenericWebhook({ channel: 'C', text: 'hi' }, 'x');
    assert.equal(r, null);
  });

  it('returns null on non-object input (defensive)', () => {
    assert.equal(normalizeGenericWebhook(null, 'x'), null);
    assert.equal(normalizeGenericWebhook('text-not-object', 'x'), null);
    assert.equal(normalizeGenericWebhook(42, 'x'), null);
  });

  it('preserves raw payload for adapters that need platform-specific fields', () => {
    const raw = { channel: 'C', user: 'U', text: 't', mentions: ['@x'] };
    const r = normalizeGenericWebhook(raw, 'x') as InboundEvent;
    assert.deepEqual(r.raw, raw);
  });

  it('survives malformed timestamps without throwing', () => {
    const r = normalizeGenericWebhook({
      channel: 'C', user: 'U', text: 't', timestamp: 'not-a-date',
    }, 'x') as InboundEvent;
    // Bad timestamp → undefined, not a NaN-Date
    assert.equal(r.timestamp, undefined);
  });
});
