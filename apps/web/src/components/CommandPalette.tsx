'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface CommandItem {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  action: () => void;
  category: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const commands: CommandItem[] = [
    // Navigation
    { id: 'nav-dashboard', label: 'Go to Dashboard', icon: '📊', category: 'Navigation', action: () => router.push('/dashboard') },
    { id: 'nav-agents', label: 'Go to Agents', icon: '🤖', category: 'Navigation', action: () => router.push('/agents') },
    { id: 'nav-tasks', label: 'Go to Tasks', icon: '✅', category: 'Navigation', action: () => router.push('/tasks') },
    { id: 'nav-goals', label: 'Go to Goals', icon: '🎯', category: 'Navigation', action: () => router.push('/goals') },
    { id: 'nav-projects', label: 'Go to Projects', icon: '📁', category: 'Navigation', action: () => router.push('/projects') },
    { id: 'nav-budgets', label: 'Go to Budgets', icon: '💰', category: 'Navigation', action: () => router.push('/budgets') },
    { id: 'nav-inbox', label: 'Go to Inbox', icon: '📥', category: 'Navigation', action: () => router.push('/inbox') },
    { id: 'nav-comms', label: 'Go to Communications', icon: '💬', category: 'Navigation', action: () => router.push('/comms') },
    { id: 'nav-meetings', label: 'Go to Meetings', icon: '📅', category: 'Navigation', action: () => router.push('/meetings') },
    { id: 'nav-approvals', label: 'Go to Approvals', icon: '🛡', category: 'Navigation', action: () => router.push('/approvals') },
    { id: 'nav-tools', label: 'Go to Tools', icon: '🔧', category: 'Navigation', action: () => router.push('/tools') },
    { id: 'nav-skills', label: 'Go to Skills', icon: '⚡', category: 'Navigation', action: () => router.push('/skills') },
    { id: 'nav-files', label: 'Go to Files', icon: '📄', category: 'Navigation', action: () => router.push('/files') },
    { id: 'nav-settings', label: 'Go to Settings', icon: '⚙', category: 'Navigation', action: () => router.push('/settings') },
    { id: 'nav-security', label: 'Go to Security', icon: '🔒', category: 'Navigation', action: () => router.push('/security') },
    { id: 'nav-plugins', label: 'Go to Plugins', icon: '🧩', category: 'Navigation', action: () => router.push('/plugins') },
    { id: 'nav-org', label: 'Go to Org Structure', icon: '🏢', category: 'Navigation', action: () => router.push('/org') },
    // Actions
    { id: 'act-new-agent', label: 'Create New Agent', icon: '➕', category: 'Actions', action: () => router.push('/agents?action=create') },
    { id: 'act-new-task', label: 'Create New Task', icon: '➕', category: 'Actions', action: () => router.push('/tasks?action=create') },
    { id: 'act-new-goal', label: 'Create New Goal', icon: '➕', category: 'Actions', action: () => router.push('/goals?action=create') },
    { id: 'act-new-project', label: 'Create New Project', icon: '➕', category: 'Actions', action: () => router.push('/projects?action=create') },
    { id: 'act-new-meeting', label: 'Create New Meeting', icon: '➕', category: 'Actions', action: () => router.push('/meetings?action=create') },
    // Theme
    { id: 'theme-dark', label: 'Switch to Dark Theme', icon: '🌙', category: 'Preferences', action: () => { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('agems_theme', 'dark'); } },
    { id: 'theme-light', label: 'Switch to Light Theme', icon: '☀', category: 'Preferences', action: () => { document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('agems_theme', 'light'); } },
  ];

  const filtered = query
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.category.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  const grouped = filtered.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, CommandItem[]>);

  const flatFiltered = Object.values(grouped).flat();

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatFiltered[selectedIndex]) {
        flatFiltered[selectedIndex].action();
        setOpen(false);
      }
    }
  }, [flatFiltered, selectedIndex]);

  // Reset index on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  let itemIndex = -1;

  return (
    <div className="command-palette-overlay" onClick={() => setOpen(false)}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command or search..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette-results">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-5 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                {category}
              </div>
              {items.map(item => {
                itemIndex++;
                const idx = itemIndex;
                return (
                  <div
                    key={item.id}
                    className="command-palette-item"
                    data-selected={idx === selectedIndex}
                    onClick={() => { item.action(); setOpen(false); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="text-lg">{item.icon}</span>
                    <span className="label">{item.label}</span>
                    {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {flatFiltered.length === 0 && (
            <div className="px-5 py-8 text-center" style={{ color: 'var(--muted)' }}>
              No commands found
            </div>
          )}
        </div>
        <div className="px-5 py-2 text-xs border-t" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          <span className="mr-4">↑↓ Navigate</span>
          <span className="mr-4">↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
