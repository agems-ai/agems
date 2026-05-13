/**
 * Channel adapter contract — the shape EVERY messenger integration
 * (Telegram / Slack / Discord / WhatsApp / Signal / generic webhook)
 * has to implement. Inspired by OpenClaw's `ChannelPlugin<>` type and
 * Hermes' `BasePlatformAdapter` + `MessageEvent` dataclass.
 *
 * Why we want this contract: AGEMS today only has Telegram. Adding a
 * second messenger today means another bespoke service. With this
 * contract, the comms gateway sees ONE shape — `InboundEvent` from any
 * platform, `OutboundDirective` going back out — and the platform-
 * specific code is one adapter file per messenger.
 *
 * This module owns:
 *   - InboundEvent / OutboundDirective normalised shapes
 *   - ChannelAdapter interface (every adapter must implement)
 *   - ChannelAdapterRegistry — simple Map-of-factories
 *   - Helpers to normalise common inbound fields
 *
 * Does NOT own:
 *   - Actual platform clients (Telegram bot lib, Slack SDK, etc.) —
 *     each adapter brings its own
 *   - WebSocket / HTTP transport — comms.gateway / a webhook controller
 *     wraps the adapter
 *
 * Pure: this file has no I/O, no DB, no platform SDKs. The adapter
 * IMPLEMENTATIONS will obviously do I/O.
 */

/** Generic inbound message event from any channel. */
export interface InboundEvent {
  /** Channel adapter that produced this event (e.g. "slack-webhook"). */
  adapter: string;
  /** Stable identifier for the source channel (e.g. Slack channel id). */
  channelExternalId: string;
  /** Stable identifier for the sender (e.g. Slack user id). */
  senderExternalId: string;
  /** Display name of the sender (best-effort — may be empty). */
  senderDisplayName?: string;
  /** Plain text content. Already stripped of platform-specific markup. */
  text: string;
  /** Raw payload the platform delivered, for adapters that need to
   *  look back at platform-specific fields (mentions, attachments). */
  raw?: unknown;
  /** External id of the message this is a reply to (threading). */
  replyToExternalId?: string;
  /** Text the reply is in response to (for UX context — optional). */
  replyToText?: string;
  /** Attached media URLs the agent might want to look at. */
  mediaUrls?: string[];
  /** Was this an internal/system notification rather than a user message? */
  internal?: boolean;
  /** Platform-side timestamp (best-effort — null if unavailable). */
  timestamp?: Date;
}

/** Generic outbound message directive — adapter renders it for its
 *  platform. */
export interface OutboundDirective {
  channelExternalId: string;
  text: string;
  /** Optional rich-content blocks. Adapters that don't support rich
   *  rendering fall back to text. */
  blocks?: OutboundBlock[];
  /** External id of message we're replying to (for threading). */
  replyToExternalId?: string;
  /** Optional metadata propagated to the adapter (e.g. parse_mode). */
  metadata?: Record<string, unknown>;
}

export type OutboundBlock =
  | { type: 'text'; text: string; usageHint?: 'heading' | 'body' | 'caption' }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'link'; url: string; label?: string };

/** Result of an outbound send. */
export interface SendResult {
  /** External message id assigned by the platform. */
  externalId?: string;
  /** True when message was split into multiple platform messages
   *  (long messages on Telegram, threading on Slack). */
  chunked?: boolean;
  /** For chunked sends, the external ids of every chunk, in order. */
  continuationExternalIds?: string[];
}

/** The contract every adapter implements. */
export interface ChannelAdapter {
  /** Slug for the registry + audit logs. */
  readonly name: string;

  /** Verify an inbound HTTPS payload (HMAC signature, Bearer token).
   *  Returns true if the request is from the platform. Used by webhook
   *  controllers BEFORE feeding the body into `normalizeInbound`. */
  verifyInbound?(args: { body: string | Buffer; headers: Record<string, string | string[] | undefined> }): boolean;

  /** Convert a raw platform payload into the normalised event shape.
   *  Returns null if the payload is not a message (e.g. typing indicator). */
  normalizeInbound(rawPayload: unknown): InboundEvent | null;

  /** Send a message back to the platform. Adapter is responsible for
   *  chunking, threading, rate-limiting. */
  send(directive: OutboundDirective): Promise<SendResult>;
}

/** Minimal registry — adapters self-register via `register()`. The
 *  comms gateway and webhook controller look adapters up by name. */
export class ChannelAdapterRegistry {
  private adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`channel adapter "${adapter.name}" is already registered`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }
}

/**
 * Normalise common inbound fields from a generic webhook bot payload.
 * Both Slack incoming-webhooks and Discord incoming-webhooks use a
 * superset of these fields; the helper lets a simple webhook adapter
 * be implemented in ~20 lines on top.
 *
 * Returns null when the payload isn't a message (no text, no media).
 */
export function normalizeGenericWebhook(payload: unknown, adapter: string): InboundEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  // Heuristic field map — accept either Slack-shape or Discord-shape
  // or our internal-shape. Empty / unknown fields just stay undefined.
  const text =
    (typeof p.text === 'string' && p.text) ||
    (typeof p.content === 'string' && p.content) ||
    '';
  const channelExternalId =
    (typeof p.channel === 'string' && p.channel) ||
    (typeof p.channel_id === 'string' && p.channel_id) ||
    (typeof p.channelId === 'string' && p.channelId) ||
    '';
  const senderExternalId =
    (typeof p.user === 'string' && p.user) ||
    (typeof p.user_id === 'string' && p.user_id) ||
    (typeof p.author_id === 'string' && p.author_id) ||
    '';
  const senderDisplayName =
    (typeof p.username === 'string' && p.username) ||
    (typeof p.author === 'string' && p.author) ||
    undefined;
  const ts =
    typeof p.ts === 'string' ? new Date(parseFloat(p.ts) * 1000) :
    typeof p.timestamp === 'string' ? new Date(p.timestamp) :
    typeof p.timestamp === 'number' ? new Date(p.timestamp) :
    undefined;

  if (!text || !channelExternalId || !senderExternalId) return null;

  return {
    adapter,
    channelExternalId,
    senderExternalId,
    senderDisplayName,
    text,
    raw: p,
    timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : undefined,
  };
}
