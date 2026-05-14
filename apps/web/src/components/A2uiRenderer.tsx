'use client';

/**
 * Minimal A2UI renderer (Google A2UI v0.8/v0.9 subset).
 *
 * Receives the same shape the backend validator emits
 * (apps/api/src/modules/comms/a2ui-protocol.ts): an array of
 * components + a root component id + optional data model. Renders
 * the tree.
 *
 * Six whitelisted component types — same as the backend whitelist:
 *   Column, Row, Text, Button, Input, Image
 *
 * Anything outside this whitelist is dropped (defensive — backend
 * validator already rejected unknown types, but front-end double-
 * checks before rendering arbitrary tags).
 *
 * `onAction` callback receives ({ componentId, kind, payload }) when
 * a user interacts (button click, input change). ChatPanel can wire
 * it to send back a dataModelUpdate to the agent.
 */
import { useMemo, useState } from 'react';

type AllowedType = 'Column' | 'Row' | 'Text' | 'Button' | 'Input' | 'Image';

interface ComponentDef {
  id: string;
  type: AllowedType | string;
  properties?: Record<string, any>;
  children?: string[];
  usageHint?: 'body' | 'heading' | 'caption' | 'cta';
}

interface SurfacePayload {
  rootId: string;
  components: ComponentDef[];
  dataModel?: Record<string, any>;
}

interface Props {
  surface: SurfacePayload;
  onAction?: (e: { componentId: string; kind: 'button' | 'input'; value?: any }) => void;
}

const ALLOWED = new Set<AllowedType>(['Column', 'Row', 'Text', 'Button', 'Input', 'Image']);

export function A2uiRenderer({ surface, onAction }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, ComponentDef>();
    for (const c of surface.components ?? []) m.set(c.id, c);
    return m;
  }, [surface.components]);
  const [localData, setLocalData] = useState<Record<string, any>>(surface.dataModel ?? {});

  function renderNode(id: string, depth = 0): React.ReactNode {
    if (depth > 12) return null; // hard recursion stop
    const c = byId.get(id);
    if (!c) return <div key={id} className="text-xs text-rose-400">[unknown ref: {id}]</div>;
    if (!ALLOWED.has(c.type as AllowedType)) {
      return <div key={c.id} className="text-xs text-rose-400">[disallowed: {c.type}]</div>;
    }
    const props = c.properties ?? {};

    switch (c.type) {
      case 'Column': {
        const gap = props.gap ?? 'gap-2';
        return (
          <div key={c.id} className={`flex flex-col ${gap}`}>
            {(c.children ?? []).map((cid) => renderNode(cid, depth + 1))}
          </div>
        );
      }
      case 'Row': {
        const gap = props.gap ?? 'gap-2';
        return (
          <div key={c.id} className={`flex flex-row items-center ${gap}`}>
            {(c.children ?? []).map((cid) => renderNode(cid, depth + 1))}
          </div>
        );
      }
      case 'Text': {
        const text = resolveBinding(props.text ?? '', localData);
        const className =
          c.usageHint === 'heading' ? 'text-lg font-semibold' :
          c.usageHint === 'caption' ? 'text-xs text-[var(--muted)]' :
          c.usageHint === 'cta' ? 'text-sm font-medium' :
          'text-sm';
        return <span key={c.id} className={className}>{text}</span>;
      }
      case 'Button': {
        const label = resolveBinding(props.label ?? 'OK', localData);
        return (
          <button
            key={c.id}
            className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-white hover:opacity-90"
            onClick={() => onAction?.({ componentId: c.id, kind: 'button' })}
          >
            {label}
          </button>
        );
      }
      case 'Input': {
        const bindKey = props.bind as string | undefined;
        const value = bindKey ? (localData[bindKey] ?? '') : (props.value ?? '');
        return (
          <input
            key={c.id}
            type={props.type === 'number' ? 'number' : 'text'}
            placeholder={props.placeholder ?? ''}
            value={value}
            className="px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg)]"
            onChange={(e) => {
              const v = e.target.value;
              if (bindKey) setLocalData({ ...localData, [bindKey]: v });
              onAction?.({ componentId: c.id, kind: 'input', value: v });
            }}
          />
        );
      }
      case 'Image': {
        const src = resolveBinding(props.src ?? '', localData);
        const alt = props.alt ?? '';
        // Reject non-http(s) sources defensively to avoid javascript: URIs.
        const safe = typeof src === 'string' && /^https?:\/\//i.test(src);
        if (!safe) return <span key={c.id} className="text-xs text-rose-400">[blocked image]</span>;
        return <img key={c.id} src={src} alt={alt} className="max-w-full rounded" />;
      }
      default:
        return null;
    }
  }

  return (
    <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg)]">
      {renderNode(surface.rootId)}
    </div>
  );
}

/** Resolve `{dataKey}` substitution from the data model. */
function resolveBinding(template: any, data: Record<string, any>): string {
  if (typeof template !== 'string') return String(template ?? '');
  return template.replace(/\{(\w+)\}/g, (_m, key) => {
    const v = data[key];
    return v == null ? '' : String(v);
  });
}
