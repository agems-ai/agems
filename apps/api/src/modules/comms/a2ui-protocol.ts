/**
 * Validator + builder for Google A2UI protocol messages over JSONL/WS.
 * First phase of #2 (Live Canvas) from the external-projects analysis,
 * inspired by OpenClaw's `extensions/canvas/src/a2ui-jsonl.ts`.
 *
 * Protocol surface we support (subset of v0.8 / v0.9):
 *
 *   beginRendering    { surfaceId, root: ComponentRef }
 *   createSurface     { surfaceId, name?, intent?: 'modal' | 'panel' | 'inline' }
 *   surfaceUpdate     { surfaceId, components: ComponentDef[] }
 *   dataModelUpdate   { surfaceId, key, value }
 *   deleteSurface     { surfaceId }
 *
 * Each message is one line of JSON over the wire. This module owns the
 * parse + validate path and the build helpers; the actual transport
 * (WebSocket from comms.gateway) wraps it.
 *
 * Components are intentionally a thin subset of the A2UI types — Column,
 * Text, Button, Input. Enough to demo agent → UI flow without a full
 * A2UI client lib in apps/web. Extensible via componentTypes whitelist.
 *
 * Pure module. No DB, no Nest, no WS coupling. Returns typed unions or
 * structured errors.
 */

export type A2uiMessageKind =
  | 'beginRendering'
  | 'createSurface'
  | 'surfaceUpdate'
  | 'dataModelUpdate'
  | 'deleteSurface';

export interface ComponentRef {
  ref: string;
}

export interface ComponentDef {
  id: string;
  type: 'Column' | 'Row' | 'Text' | 'Button' | 'Input' | 'Image';
  /** Type-specific properties. Validated only for the recognised types. */
  properties?: Record<string, unknown>;
  /** Refs to child components by id. */
  children?: string[];
  /** Optional data-binding hint: literal string vs. data-model lookup. */
  usageHint?: 'body' | 'heading' | 'caption' | 'cta';
}

export type A2uiMessage =
  | { kind: 'beginRendering';  surfaceId: string; root: ComponentRef }
  | { kind: 'createSurface';   surfaceId: string; name?: string; intent?: 'modal' | 'panel' | 'inline' }
  | { kind: 'surfaceUpdate';   surfaceId: string; components: ComponentDef[] }
  | { kind: 'dataModelUpdate'; surfaceId: string; key: string; value: unknown }
  | { kind: 'deleteSurface';   surfaceId: string };

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const ALLOWED_COMPONENT_TYPES = ['Column', 'Row', 'Text', 'Button', 'Input', 'Image'] as const;
const ALLOWED_INTENTS = ['modal', 'panel', 'inline'] as const;
const ALLOWED_USAGE_HINTS = ['body', 'heading', 'caption', 'cta'] as const;

const MESSAGE_KINDS: A2uiMessageKind[] = [
  'beginRendering', 'createSurface', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface',
];

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate a single component def. */
export function validateComponent(c: unknown): ValidateResult<ComponentDef> {
  if (!isObject(c)) return { ok: false, reason: 'component must be an object' };
  if (!isString(c.id)) return { ok: false, reason: 'component.id is required' };
  if (!isString(c.type)) return { ok: false, reason: 'component.type is required' };
  if (!ALLOWED_COMPONENT_TYPES.includes(c.type as any)) {
    return { ok: false, reason: `component.type must be one of ${ALLOWED_COMPONENT_TYPES.join(', ')}; got "${c.type}"` };
  }
  if (c.properties !== undefined && !isObject(c.properties)) {
    return { ok: false, reason: 'component.properties must be an object when present' };
  }
  if (c.children !== undefined) {
    if (!Array.isArray(c.children)) return { ok: false, reason: 'component.children must be an array' };
    if (!(c.children as unknown[]).every(isString)) {
      return { ok: false, reason: 'every child must be a non-empty string id' };
    }
  }
  if (c.usageHint !== undefined && !ALLOWED_USAGE_HINTS.includes(c.usageHint as any)) {
    return { ok: false, reason: `component.usageHint must be one of ${ALLOWED_USAGE_HINTS.join(', ')}` };
  }
  return { ok: true, value: c as unknown as ComponentDef };
}

/** Validate a parsed-but-untyped A2UI message envelope. */
export function validateMessage(raw: unknown): ValidateResult<A2uiMessage> {
  if (!isObject(raw)) return { ok: false, reason: 'message must be a JSON object' };
  const kind = raw.kind;
  if (!isString(kind)) return { ok: false, reason: 'message.kind is required' };
  if (!MESSAGE_KINDS.includes(kind as A2uiMessageKind)) {
    return { ok: false, reason: `unknown kind "${kind}"` };
  }
  if (!isString(raw.surfaceId)) return { ok: false, reason: 'message.surfaceId is required' };

  switch (kind as A2uiMessageKind) {
    case 'beginRendering': {
      if (!isObject(raw.root) || !isString((raw.root as any).ref)) {
        return { ok: false, reason: 'beginRendering requires root.ref string' };
      }
      return { ok: true, value: { kind: 'beginRendering', surfaceId: raw.surfaceId as string, root: { ref: (raw.root as any).ref } } };
    }
    case 'createSurface': {
      if (raw.intent !== undefined && !ALLOWED_INTENTS.includes(raw.intent as any)) {
        return { ok: false, reason: `intent must be one of ${ALLOWED_INTENTS.join(', ')}` };
      }
      return { ok: true, value: {
        kind: 'createSurface',
        surfaceId: raw.surfaceId as string,
        name: typeof raw.name === 'string' ? raw.name : undefined,
        intent: raw.intent as any,
      } };
    }
    case 'surfaceUpdate': {
      if (!Array.isArray(raw.components)) return { ok: false, reason: 'surfaceUpdate.components must be an array' };
      const validatedComponents: ComponentDef[] = [];
      for (const c of raw.components as unknown[]) {
        const r = validateComponent(c);
        if (!r.ok) return { ok: false, reason: `invalid component: ${r.reason}` };
        validatedComponents.push(r.value);
      }
      return { ok: true, value: { kind: 'surfaceUpdate', surfaceId: raw.surfaceId as string, components: validatedComponents } };
    }
    case 'dataModelUpdate': {
      if (!isString(raw.key)) return { ok: false, reason: 'dataModelUpdate.key is required' };
      return { ok: true, value: { kind: 'dataModelUpdate', surfaceId: raw.surfaceId as string, key: raw.key as string, value: raw.value } };
    }
    case 'deleteSurface': {
      return { ok: true, value: { kind: 'deleteSurface', surfaceId: raw.surfaceId as string } };
    }
  }
}

/** Parse a single JSONL line into a validated message. */
export function parseLine(line: string): ValidateResult<A2uiMessage> {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, reason: 'empty line' };
  let raw: unknown;
  try { raw = JSON.parse(trimmed); }
  catch (e) { return { ok: false, reason: `JSON parse error: ${(e as Error).message}` }; }
  return validateMessage(raw);
}

/** Parse a multi-line JSONL stream. Returns one result per line so the
 *  caller can decide whether to stop on first error or collect them. */
export function parseStream(jsonl: string): ValidateResult<A2uiMessage>[] {
  return jsonl
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(parseLine);
}

// ── Builders (typed constructors used by tool implementations) ──

export function buildCreateSurface(args: { surfaceId: string; name?: string; intent?: 'modal' | 'panel' | 'inline' }): A2uiMessage {
  return { kind: 'createSurface', ...args };
}

export function buildSurfaceUpdate(args: { surfaceId: string; components: ComponentDef[] }): A2uiMessage {
  return { kind: 'surfaceUpdate', ...args };
}

export function buildBeginRendering(args: { surfaceId: string; rootComponentId: string }): A2uiMessage {
  return { kind: 'beginRendering', surfaceId: args.surfaceId, root: { ref: args.rootComponentId } };
}

export function buildDataModelUpdate(args: { surfaceId: string; key: string; value: unknown }): A2uiMessage {
  return { kind: 'dataModelUpdate', ...args };
}

export function buildDeleteSurface(args: { surfaceId: string }): A2uiMessage {
  return { kind: 'deleteSurface', ...args };
}

/** Serialise a message to the JSONL wire form (one line, newline-terminated). */
export function toJsonl(msg: A2uiMessage): string {
  return JSON.stringify(msg) + '\n';
}
