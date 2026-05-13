/**
 * Unit tests for A2UI JSONL protocol validator + builders.
 *
 * If these break, the agent's UI emissions either crash the chat
 * renderer (malformed shape) or open up XSS via unvalidated component
 * properties. The validator is the trust boundary between agent output
 * and the front-end renderer.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateComponent,
  validateMessage,
  parseLine,
  parseStream,
  buildCreateSurface,
  buildSurfaceUpdate,
  buildBeginRendering,
  buildDataModelUpdate,
  buildDeleteSurface,
  toJsonl,
} from './a2ui-protocol';

// ── validateComponent ───────────────────────────────────────────

describe('validateComponent', () => {
  it('accepts a minimal Text component', () => {
    const r = validateComponent({ id: 't1', type: 'Text' });
    assert.equal(r.ok, true);
  });

  it('rejects missing id', () => {
    const r = validateComponent({ type: 'Text' });
    assert.equal(r.ok, false);
  });

  it('rejects an unknown type (prevents arbitrary tag injection)', () => {
    const r = validateComponent({ id: 't1', type: 'Script' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /component\.type/);
  });

  it('accepts all six allowed types', () => {
    for (const type of ['Column', 'Row', 'Text', 'Button', 'Input', 'Image']) {
      assert.equal(validateComponent({ id: 'x', type }).ok, true, type);
    }
  });

  it('rejects non-object properties', () => {
    const r = validateComponent({ id: 't', type: 'Text', properties: 'foo' });
    assert.equal(r.ok, false);
  });

  it('rejects non-string child id', () => {
    const r = validateComponent({ id: 'c', type: 'Column', children: ['a', 42] });
    assert.equal(r.ok, false);
  });

  it('rejects unknown usageHint', () => {
    const r = validateComponent({ id: 't', type: 'Text', usageHint: 'sidebar' });
    assert.equal(r.ok, false);
  });

  it('accepts a heading-hint Text', () => {
    const r = validateComponent({ id: 't', type: 'Text', usageHint: 'heading' });
    assert.equal(r.ok, true);
  });
});

// ── validateMessage — protocol envelope ─────────────────────────

describe('validateMessage', () => {
  it('rejects missing kind', () => {
    assert.equal(validateMessage({ surfaceId: 's' }).ok, false);
  });

  it('rejects unknown kind', () => {
    assert.equal(validateMessage({ kind: 'eval', surfaceId: 's' }).ok, false);
  });

  it('rejects missing surfaceId', () => {
    assert.equal(validateMessage({ kind: 'deleteSurface' }).ok, false);
  });
});

// ── beginRendering ──────────────────────────────────────────────

describe('validateMessage — beginRendering', () => {
  it('requires root.ref string', () => {
    assert.equal(validateMessage({ kind: 'beginRendering', surfaceId: 's' }).ok, false);
    assert.equal(validateMessage({ kind: 'beginRendering', surfaceId: 's', root: {} }).ok, false);
  });

  it('accepts a valid envelope', () => {
    const r = validateMessage({ kind: 'beginRendering', surfaceId: 's', root: { ref: 'root-component' } });
    assert.equal(r.ok, true);
  });
});

// ── createSurface ───────────────────────────────────────────────

describe('validateMessage — createSurface', () => {
  it('accepts minimal envelope', () => {
    const r = validateMessage({ kind: 'createSurface', surfaceId: 's1' });
    assert.equal(r.ok, true);
  });

  it('rejects unknown intent', () => {
    assert.equal(validateMessage({ kind: 'createSurface', surfaceId: 's1', intent: 'sidebar' }).ok, false);
  });

  it('accepts each allowed intent', () => {
    for (const intent of ['modal', 'panel', 'inline']) {
      assert.equal(validateMessage({ kind: 'createSurface', surfaceId: 's', intent }).ok, true, intent);
    }
  });
});

// ── surfaceUpdate ───────────────────────────────────────────────

describe('validateMessage — surfaceUpdate', () => {
  it('requires components array', () => {
    assert.equal(validateMessage({ kind: 'surfaceUpdate', surfaceId: 's' }).ok, false);
  });

  it('validates each component (fail-fast on bad one)', () => {
    const r = validateMessage({
      kind: 'surfaceUpdate', surfaceId: 's',
      components: [{ id: 'a', type: 'Text' }, { id: 'b', type: 'Script' /* invalid */ }],
    });
    assert.equal(r.ok, false);
  });

  it('accepts a tree of components', () => {
    const r = validateMessage({
      kind: 'surfaceUpdate', surfaceId: 's',
      components: [
        { id: 'root', type: 'Column', children: ['t', 'b'] },
        { id: 't', type: 'Text', properties: { text: 'Hello' }, usageHint: 'heading' },
        { id: 'b', type: 'Button', properties: { label: 'OK' } },
      ],
    });
    assert.equal(r.ok, true);
  });
});

// ── dataModelUpdate ─────────────────────────────────────────────

describe('validateMessage — dataModelUpdate', () => {
  it('requires key', () => {
    assert.equal(validateMessage({ kind: 'dataModelUpdate', surfaceId: 's', value: 1 }).ok, false);
  });
  it('accepts any value (the data model is intentionally loose)', () => {
    assert.equal(validateMessage({ kind: 'dataModelUpdate', surfaceId: 's', key: 'count', value: 42 }).ok, true);
    assert.equal(validateMessage({ kind: 'dataModelUpdate', surfaceId: 's', key: 'obj', value: { a: 1 } }).ok, true);
    assert.equal(validateMessage({ kind: 'dataModelUpdate', surfaceId: 's', key: 'null', value: null }).ok, true);
  });
});

// ── deleteSurface ───────────────────────────────────────────────

describe('validateMessage — deleteSurface', () => {
  it('accepts envelope with just surfaceId', () => {
    const r = validateMessage({ kind: 'deleteSurface', surfaceId: 's' });
    assert.equal(r.ok, true);
  });
});

// ── parseLine / parseStream ─────────────────────────────────────

describe('parseLine', () => {
  it('parses a valid JSONL line', () => {
    const r = parseLine('{"kind":"deleteSurface","surfaceId":"s"}');
    assert.equal(r.ok, true);
  });

  it('returns parse-error on malformed JSON', () => {
    const r = parseLine('{not json');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /parse/i);
  });

  it('rejects empty lines', () => {
    assert.equal(parseLine('').ok, false);
    assert.equal(parseLine('   ').ok, false);
  });
});

describe('parseStream', () => {
  it('returns one result per non-empty line', () => {
    const jsonl = [
      '{"kind":"createSurface","surfaceId":"s1"}',
      '',
      '{"kind":"deleteSurface","surfaceId":"s1"}',
    ].join('\n');
    const out = parseStream(jsonl);
    assert.equal(out.length, 2);
    assert.equal(out[0].ok, true);
    assert.equal(out[1].ok, true);
  });

  it('mixes successes and failures without throwing', () => {
    const jsonl = '{"kind":"createSurface","surfaceId":"s1"}\nnot-json';
    const out = parseStream(jsonl);
    assert.equal(out.length, 2);
    assert.equal(out[0].ok, true);
    assert.equal(out[1].ok, false);
  });
});

// ── builders + toJsonl ──────────────────────────────────────────

describe('builders + toJsonl roundtrip', () => {
  it('buildCreateSurface → validateMessage', () => {
    const m = buildCreateSurface({ surfaceId: 's1', name: 'Demo', intent: 'modal' });
    const r = validateMessage(JSON.parse(JSON.stringify(m)));
    assert.equal(r.ok, true);
  });

  it('buildSurfaceUpdate → validateMessage', () => {
    const m = buildSurfaceUpdate({
      surfaceId: 's', components: [{ id: 'root', type: 'Column', children: [] }],
    });
    assert.equal(validateMessage(JSON.parse(JSON.stringify(m))).ok, true);
  });

  it('buildBeginRendering, buildDataModelUpdate, buildDeleteSurface roundtrip', () => {
    const a = buildBeginRendering({ surfaceId: 's', rootComponentId: 'r' });
    const b = buildDataModelUpdate({ surfaceId: 's', key: 'k', value: 1 });
    const c = buildDeleteSurface({ surfaceId: 's' });
    for (const m of [a, b, c]) {
      assert.equal(validateMessage(JSON.parse(JSON.stringify(m))).ok, true);
    }
  });

  it('toJsonl emits a newline-terminated single line', () => {
    const m = buildDeleteSurface({ surfaceId: 's' });
    const wire = toJsonl(m);
    assert.equal(wire.endsWith('\n'), true);
    assert.equal(wire.split('\n').filter(l => l).length, 1);
  });
});
