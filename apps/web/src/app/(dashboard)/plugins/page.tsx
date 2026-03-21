'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Puzzle, Plus, Settings, Trash2, Power, ExternalLink, X, ChevronRight, Package } from 'lucide-react';

interface Plugin {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string;
  author: string | null;
  homepage: string | null;
  entryPoint: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

const emptyForm = {
  name: '',
  slug: '',
  version: '1.0.0',
  description: '',
  author: '',
  homepage: '',
  entryPoint: '',
};

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.getPlugins();
      setPlugins(Array.isArray(data) ? data : data.data || []);
    } catch {
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleInstall = async () => {
    if (!form.name.trim() || !form.slug.trim() || !form.entryPoint.trim()) return;
    setSaving(true);
    try {
      const plugin = await api.installPlugin({
        name: form.name.trim(),
        slug: form.slug.trim(),
        version: form.version.trim() || '1.0.0',
        description: form.description.trim() || undefined,
        author: form.author.trim() || undefined,
        homepage: form.homepage.trim() || undefined,
        entryPoint: form.entryPoint.trim(),
      });
      setPlugins((prev) => [plugin, ...prev]);
      setShowInstall(false);
      setForm({ ...emptyForm });
    } catch (err: any) {
      alert(err.message || 'Failed to install plugin');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (plugin: Plugin) => {
    setTogglingId(plugin.id);
    try {
      const updated = plugin.enabled
        ? await api.disablePlugin(plugin.id)
        : await api.enablePlugin(plugin.id);
      setPlugins((prev) => prev.map((p) => (p.id === plugin.id ? { ...p, ...(updated as Plugin) } : p)));
      if (selectedPlugin?.id === plugin.id) {
        setSelectedPlugin({ ...selectedPlugin, ...(updated as Plugin) });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to toggle plugin');
    } finally {
      setTogglingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this plugin? This action cannot be undone.')) return;
    try {
      await api.removePlugin(id);
      setPlugins((prev) => prev.filter((p) => p.id !== id));
      if (selectedPlugin?.id === id) setSelectedPlugin(null);
    } catch (err: any) {
      alert(err.message || 'Failed to remove plugin');
    }
  };

  const autoSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <div style={{ color: 'var(--muted)', fontSize: 15 }}>Loading plugins...</div>
      </div>
    );
  }

  // Detail view
  if (selectedPlugin) {
    return (
      <div style={{ padding: 32, maxWidth: 720 }}>
        <button
          onClick={() => setSelectedPlugin(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            marginBottom: 24,
          }}
        >
          <ChevronRight style={{ transform: 'rotate(180deg)', width: 16, height: 16 }} />
          Back to plugins
        </button>

        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 32,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: selectedPlugin.enabled ? 'var(--accent)' : 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: selectedPlugin.enabled ? 1 : 0.5,
                }}
              >
                <Puzzle style={{ width: 24, height: 24, color: 'white' }} />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                  {selectedPlugin.name}
                </h1>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {selectedPlugin.slug} v{selectedPlugin.version}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleToggle(selectedPlugin)}
                disabled={togglingId === selectedPlugin.id}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: selectedPlugin.enabled ? 'var(--card)' : 'var(--accent)',
                  color: selectedPlugin.enabled ? 'var(--foreground)' : 'white',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Power style={{ width: 14, height: 14 }} />
                {selectedPlugin.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => handleRemove(selectedPlugin.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Trash2 style={{ width: 14, height: 14 }} />
                Remove
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {selectedPlugin.description && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Description
                </div>
                <div style={{ fontSize: 14, color: 'var(--foreground)', lineHeight: 1.5 }}>
                  {selectedPlugin.description}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {selectedPlugin.author && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                    Author
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--foreground)' }}>{selectedPlugin.author}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Entry Point
                </div>
                <div style={{ fontSize: 14, color: 'var(--foreground)', fontFamily: 'monospace' }}>
                  {selectedPlugin.entryPoint}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Status
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: selectedPlugin.enabled ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.12)',
                    color: selectedPlugin.enabled ? '#22c55e' : 'var(--muted)',
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: selectedPlugin.enabled ? '#22c55e' : 'var(--muted)',
                    }}
                  />
                  {selectedPlugin.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Installed
                </div>
                <div style={{ fontSize: 14, color: 'var(--foreground)' }}>
                  {new Date(selectedPlugin.installedAt).toLocaleDateString()}
                </div>
              </div>
            </div>

            {selectedPlugin.homepage && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Homepage
                </div>
                <a
                  href={selectedPlugin.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 14, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {selectedPlugin.homepage}
                  <ExternalLink style={{ width: 12, height: 12 }} />
                </a>
              </div>
            )}

            {selectedPlugin.config && Object.keys(selectedPlugin.config).length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Configuration
                </div>
                <pre
                  style={{
                    fontSize: 13,
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 16,
                    overflow: 'auto',
                    margin: 0,
                    color: 'var(--foreground)',
                  }}
                >
                  {JSON.stringify(selectedPlugin.config, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>Plugins</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: '4px 0 0' }}>
            Extend platform capabilities with plugins
          </p>
        </div>
        <button
          onClick={() => setShowInstall(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <Plus style={{ width: 16, height: 16 }} />
          Install Plugin
        </button>
      </div>

      {/* Empty state */}
      {plugins.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 20px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <Package style={{ width: 48, height: 48, color: 'var(--muted)', marginBottom: 16 }} />
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 6px', color: 'var(--foreground)' }}>
            No plugins installed
          </h3>
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 20px' }}>
            Install a plugin to extend your platform with new features, hooks, and tools.
          </p>
          <button
            onClick={() => setShowInstall(true)}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'white',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Install Your First Plugin
          </button>
        </div>
      )}

      {/* Plugin cards grid */}
      {plugins.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}
        >
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                opacity: plugin.enabled ? 1 : 0.65,
                transition: 'opacity 0.2s, box-shadow 0.2s',
              }}
            >
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: plugin.enabled ? 'var(--accent)' : 'var(--muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Puzzle style={{ width: 20, height: 20, color: 'white' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)' }}>{plugin.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      v{plugin.version}
                      {plugin.author ? ` by ${plugin.author}` : ''}
                    </div>
                  </div>
                </div>

                {/* Status badge */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: plugin.enabled ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.12)',
                    color: plugin.enabled ? '#22c55e' : 'var(--muted)',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: plugin.enabled ? '#22c55e' : 'var(--muted)',
                    }}
                  />
                  {plugin.enabled ? 'On' : 'Off'}
                </span>
              </div>

              {/* Description */}
              {plugin.description && (
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  {plugin.description}
                </p>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
                <button
                  onClick={() => handleToggle(plugin)}
                  disabled={togglingId === plugin.id}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Power style={{ width: 14, height: 14 }} />
                  {plugin.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => setSelectedPlugin(plugin)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="Settings"
                >
                  <Settings style={{ width: 14, height: 14 }} />
                </button>
                <button
                  onClick={() => handleRemove(plugin.id)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="Remove"
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Install modal */}
      {showInstall && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowInstall(false);
          }}
        >
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 28,
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>Install Plugin</h2>
              <button
                onClick={() => setShowInstall(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({
                      ...f,
                      name,
                      slug: f.slug === autoSlug(f.name) || !f.slug ? autoSlug(name) : f.slug,
                    }));
                  }}
                  placeholder="My Plugin"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--background)',
                    color: 'var(--foreground)',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                  Slug *
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="my-plugin"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--background)',
                    color: 'var(--foreground)',
                    fontSize: 14,
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                    Version
                  </label>
                  <input
                    type="text"
                    value={form.version}
                    onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                    placeholder="1.0.0"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                    Author
                  </label>
                  <input
                    type="text"
                    value={form.author}
                    onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
                    placeholder="Your name"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What does this plugin do?"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--background)',
                    color: 'var(--foreground)',
                    fontSize: 14,
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                  Entry Point *
                </label>
                <input
                  type="text"
                  value={form.entryPoint}
                  onChange={(e) => setForm((f) => ({ ...f, entryPoint: e.target.value }))}
                  placeholder="./plugins/my-plugin/index.ts"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--background)',
                    color: 'var(--foreground)',
                    fontSize: 14,
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                  Homepage
                </label>
                <input
                  type="url"
                  value={form.homepage}
                  onChange={(e) => setForm((f) => ({ ...f, homepage: e.target.value }))}
                  placeholder="https://github.com/..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--background)',
                    color: 'var(--foreground)',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button
                onClick={() => {
                  setShowInstall(false);
                  setForm({ ...emptyForm });
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                disabled={saving || !form.name.trim() || !form.slug.trim() || !form.entryPoint.trim()}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: 'none',
                  background: !form.name.trim() || !form.slug.trim() || !form.entryPoint.trim() ? 'var(--muted)' : 'var(--accent)',
                  color: 'white',
                  cursor: !form.name.trim() || !form.slug.trim() || !form.entryPoint.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Installing...' : 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
