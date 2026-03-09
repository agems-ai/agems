'use client';

import { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Plus, Trash2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// ── Department color palette ──
const PALETTE = ['#6c5ce7', '#00cec9', '#0984e3', '#e17055', '#00b894', '#e84393', '#fdcb6e', '#74b9ff', '#a29bfe', '#55efc4', '#fab1a0', '#81ecec'];
function getDeptColor(dept: string, allDepts: string[]): string {
  const i = allDepts.indexOf(dept);
  return i >= 0 ? PALETTE[i % PALETTE.length] : PALETTE[0];
}

const STATUS_DOT: Record<string, string> = {
  ACTIVE: '#00b894', PAUSED: '#fdcb6e', DRAFT: '#636e72', ERROR: '#e84393', ARCHIVED: '#636e72',
};

// ── Avatar ──
function Avatar({ name, avatar, size = 40 }: { name: string; avatar?: string | null; size?: number }) {
  if (avatar?.startsWith('/')) {
    return <img src={avatar} alt={name} className="rounded-full object-cover object-top" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0 font-semibold text-[var(--accent)]"
      style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {avatar || name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

// ── Stat Card ──
function StatCard({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex-1 min-w-[80px] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-center">
      <div className="text-xl font-bold" style={color ? { color } : {}}>{value}</div>
      <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ── Size presets based on node count ──
type ChartSize = 'lg' | 'md' | 'sm' | 'xs';
function getChartSize(totalNodes: number): ChartSize {
  if (totalNodes <= 6) return 'lg';
  if (totalNodes <= 12) return 'md';
  if (totalNodes <= 20) return 'sm';
  return 'xs';
}
const sizeConfig = {
  lg: { card: 190, avatar: 52, name: 13, title: 11, badge: 9, gap: 16, lineH: 40, px: 4 },
  md: { card: 150, avatar: 40, name: 12, title: 10, badge: 8, gap: 10, lineH: 30, px: 3 },
  sm: { card: 120, avatar: 32, name: 11, title: 9, badge: 7, gap: 6, lineH: 22, px: 2 },
  xs: { card: 105, avatar: 28, name: 10, title: 8, badge: 7, gap: 4, lineH: 18, px: 2 },
};

// ── Org Chart Card ──
function ChartCard({ node, deptColor, onAssign, onDelete, isDragging, isDropTarget, onDragStart, onDragOver, onDragLeave, onDrop, sz = 'lg' }: {
  node: any; deptColor?: string;
  onAssign: (id: string) => void; onDelete: (id: string) => void;
  isDragging: boolean; isDropTarget: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
  sz?: ChartSize;
}) {
  const s = sizeConfig[sz];
  const holder = node.holderType === 'AGENT' && node.agent
    ? { name: node.agent.name, avatar: node.agent.avatar, type: 'agent' as const, status: node.agent.status, id: node.agent.id }
    : node.holderType === 'HUMAN' && node.user
      ? { name: node.user.name, avatar: node.user.avatarUrl || null, type: 'human' as const, status: 'ACTIVE', id: node.user.id }
      : null;
  const vacant = !holder;

  return (
    <div className="group relative"
      draggable
      onDragStart={(e) => onDragStart(e, node.id)}
      onDragOver={(e) => onDragOver(e, node.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, node.id)}
    >
      <div className={`rounded-xl text-center transition-all duration-200 ${
        vacant
          ? 'border border-dashed border-[var(--border)] bg-[var(--bg)]/30'
          : 'border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:shadow-lg hover:shadow-[var(--accent)]/5'
      } ${isDragging ? 'opacity-40 scale-95' : ''} ${isDropTarget ? 'ring-2 ring-[var(--accent)] border-[var(--accent)]!' : ''}`}
        style={{ width: s.card, paddingBlock: sz === 'sm' ? 8 : sz === 'md' ? 12 : 16, paddingInline: s.px * 4 }}
      >
        {/* Department accent bar */}
        {deptColor && !vacant && (
          <div className="absolute top-0 left-4 right-4 h-[2px] rounded-b" style={{ backgroundColor: deptColor }} />
        )}

        {/* Avatar */}
        <div className="flex justify-center mb-1.5">
          {holder ? (
            <div className="relative">
              <Avatar name={holder.name} avatar={holder.avatar} size={s.avatar} />
              {holder.type === 'agent' && (
                <div className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[var(--card)]"
                  style={{ backgroundColor: STATUS_DOT[holder.status] || '#636e72', width: sz === 'sm' ? 10 : 14, height: sz === 'sm' ? 10 : 14 }} />
              )}
            </div>
          ) : (
            <div className="rounded-full border-2 border-dashed border-[var(--border)] flex items-center justify-center text-[var(--muted)] opacity-40"
              style={{ width: s.avatar, height: s.avatar, fontSize: s.avatar * 0.4 }}>+</div>
          )}
        </div>

        {/* Name */}
        {holder ? (
          <div className="font-semibold truncate leading-tight" style={{ fontSize: s.name }}>{holder.name}</div>
        ) : (
          <div className="italic text-[var(--muted)] opacity-60" style={{ fontSize: s.name }}>Vacant</div>
        )}

        {/* Position title */}
        <div className="text-[var(--muted)] mt-0.5 truncate" style={{ fontSize: s.title }}>{node.title}</div>

        {/* Department */}
        {node.department && (
          <div className="mt-1.5 flex justify-center">
            <span className="px-1.5 py-[1px] rounded-full font-medium tracking-wide"
              style={{ fontSize: s.badge, backgroundColor: (deptColor || '#6c5ce7') + '18', color: deptColor }}>
              {node.department}
            </span>
          </div>
        )}

        {/* Type badge */}
        {holder?.type === 'agent' && (
          <div className="mt-1 flex justify-center">
            <span className="px-1.5 py-[1px] rounded text-[var(--accent)] bg-[var(--accent)]/10" style={{ fontSize: s.badge }}>AI Agent</span>
          </div>
        )}
        {holder?.type === 'human' && (
          <div className="mt-1 flex justify-center">
            <span className="px-1.5 py-[1px] rounded text-emerald-400 bg-emerald-500/10" style={{ fontSize: s.badge }}>Employee</span>
          </div>
        )}
      </div>

      {/* Hover actions */}
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition z-20">
        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); onAssign(node.id); }}
          className="text-[9px] px-2 py-[3px] rounded-full bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)]/60 hover:text-white text-[var(--muted)] shadow-sm transition whitespace-nowrap">
          {vacant ? '+ Assign' : 'Reassign'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(node.id); }}
          className="text-[9px] px-1.5 py-[3px] rounded-full bg-[var(--card)] border border-red-500/20 text-red-400/50 hover:text-red-400 hover:border-red-500/40 shadow-sm transition">
          ✕
        </button>
      </div>

      {/* Clickable link to agent page */}
      {holder?.type === 'agent' && (
        <Link href={`/agents/${holder.id}`} className="absolute inset-0 z-10 rounded-xl" tabIndex={-1} />
      )}
    </div>
  );
}

// ── Recursive Org Chart Tree (top-down centered) ──
function ChartTree({ node, onAssign, onDelete, allDepts, dragId, dropTarget, onDragStart, onDragOver, onDragLeave, onDrop, sz = 'lg' }: {
  node: any; onAssign: (id: string) => void; onDelete: (id: string) => void; allDepts: string[];
  dragId: string | null; dropTarget: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
  sz?: ChartSize;
}) {
  const children: any[] = node.children || [];
  const deptColor = node.department ? getDeptColor(node.department, allDepts) : undefined;
  const s = sizeConfig[sz];

  return (
    <div className="flex flex-col items-center">
      <ChartCard
        node={node} deptColor={deptColor}
        onAssign={onAssign} onDelete={onDelete}
        isDragging={dragId === node.id}
        isDropTarget={dropTarget === node.id}
        onDragStart={onDragStart} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        sz={sz}
      />

      {children.length > 0 && (
        <>
          <div className="w-px bg-[var(--border)]/60" style={{ height: s.lineH }} />

          <div className="flex">
            {children.map((child: any, i: number) => (
              <div key={child.id} className="flex flex-col items-center relative" style={{ paddingTop: s.lineH, paddingInline: s.gap }}>
                <div className="absolute top-0 left-1/2 -translate-x-px w-px bg-[var(--border)]/60" style={{ height: s.lineH }} />

                {children.length > 1 && (
                  <div className={`absolute top-0 h-px bg-[var(--border)]/60 ${
                    i === 0 ? 'left-1/2 right-0' :
                    i === children.length - 1 ? 'left-0 right-1/2' :
                    'left-0 right-0'
                  }`} />
                )}

                <ChartTree
                  node={child} onAssign={onAssign} onDelete={onDelete} allDepts={allDepts}
                  dragId={dragId} dropTarget={dropTarget}
                  onDragStart={onDragStart} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                  sz={sz}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Helper: check if nodeId is a descendant of ancestorId ──
function isDescendant(nodeId: string, ancestorId: string, tree: any[]): boolean {
  function search(nodes: any[]): boolean {
    for (const n of nodes) {
      if (n.id === ancestorId) {
        return hasChild(n, nodeId);
      }
      if (n.children && search(n.children)) return true;
    }
    return false;
  }
  function hasChild(node: any, targetId: string): boolean {
    if (!node.children) return false;
    for (const c of node.children) {
      if (c.id === targetId) return true;
      if (hasChild(c, targetId)) return true;
    }
    return false;
  }
  return search(tree);
}

// ── Company Profile Fields ──
const companyFields = [
  { key: 'company_name', label: 'Company Name', placeholder: 'Acme Corp', type: 'input' },
  { key: 'company_industry', label: 'Industry', placeholder: 'Technology', type: 'input' },
  { key: 'company_description', label: 'Description', placeholder: 'What does the company do?', type: 'textarea', rows: 3 },
  { key: 'company_mission', label: 'Mission', placeholder: 'Company mission statement...', type: 'textarea', rows: 2 },
  { key: 'company_vision', label: 'Vision', placeholder: 'Where is the company heading?', type: 'textarea', rows: 2 },
  { key: 'company_goals', label: 'Goals', placeholder: 'Key business goals...', type: 'textarea', rows: 3 },
  { key: 'company_constitution', label: 'Constitution', placeholder: 'Mandatory rules and policies for all AI agents...', type: 'textarea', rows: 6 },
  { key: 'company_values', label: 'Core Values', placeholder: 'Innovation, quality, customer focus...', type: 'textarea', rows: 2 },
  { key: 'company_products', label: 'Products & Services', placeholder: 'Describe products and services...', type: 'textarea', rows: 3 },
  { key: 'company_target_audience', label: 'Target Audience', placeholder: 'Who are your customers?', type: 'textarea', rows: 2 },
  { key: 'company_tone', label: 'Communication Tone', placeholder: 'Professional, friendly, formal...', type: 'input' },
  { key: 'company_languages', label: 'Supported Languages', placeholder: 'English, Russian, Hebrew, ...', type: 'input' },
];

// ── Link Categories & Platforms ──
const LINK_CATEGORIES: { label: string; platforms: string[] }[] = [
  {
    label: 'Social Networks',
    platforms: [
      'Facebook', 'Instagram', 'X (Twitter)', 'LinkedIn', 'YouTube',
      'TikTok', 'Telegram', 'WhatsApp', 'Discord', 'Reddit',
      'Pinterest', 'Threads', 'Bluesky',
    ],
  },
  {
    label: 'Content & Media',
    platforms: [
      'Medium', 'Substack', 'Twitch', 'Spotify', 'Apple Podcasts',
      'SoundCloud', 'Vimeo',
    ],
  },
  {
    label: 'Developer & Design',
    platforms: [
      'GitHub', 'GitLab', 'Dribbble', 'Behance', 'Figma',
    ],
  },
  {
    label: 'App Stores',
    platforms: [
      'App Store (iOS)', 'Google Play', 'Microsoft Store',
    ],
  },
  {
    label: 'Marketplaces',
    platforms: [
      'Amazon', 'eBay', 'Etsy', 'Shopify', 'AliExpress',
    ],
  },
  {
    label: 'Review & Listing',
    platforms: [
      'Google Business', 'Trustpilot', 'G2', 'Capterra', 'Product Hunt',
      'Crunchbase',
    ],
  },
  {
    label: 'Other',
    platforms: ['Other'],
  },
];

const ALL_PLATFORMS = LINK_CATEGORIES.flatMap(c => c.platforms);

interface SocialLink { platform: string; url: string }

// ═══════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════
export default function CompanyPage() {
  // Company Profile
  const [companyForm, setCompanyForm] = useState<Record<string, string>>({});
  const [savingCompany, setSavingCompany] = useState(false);
  const [socials, setSocials] = useState<SocialLink[]>([]);

  // Org Structure
  const [tree, setTree] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', department: '', parentId: '' });

  // Drag & Drop
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Canvas zoom & pan
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartContentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });

  const loadOrg = async () => {
    const [t, p] = await Promise.all([api.getOrgTree(), api.getOrgPositions()]);
    setTree(t);
    setPositions(p);
  };

  useEffect(() => {
    Promise.all([
      api.getCompanyProfile().then((p: Record<string, string>) => {
        setCompanyForm(p);
        try { setSocials(JSON.parse(p.company_socials || '[]')); } catch { setSocials([]); }
      }).catch(() => {}),
      api.getOrgTree().then(setTree).catch(() => {}),
      api.getOrgPositions().then(setPositions).catch(() => {}),
      api.getAgents().then((r: any) => setAgents(r.data || r || [])).catch(() => {}),
      api.getUsers().then((r: any) => setUsers(r || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // ── Fit chart to container ──
  const fitToScreen = useCallback(() => {
    const container = chartContainerRef.current;
    const content = chartContentRef.current;
    if (!container || !content) return;
    // Measure at scale=1
    const prev = content.style.transform;
    content.style.transform = 'scale(1) translate(0px, 0px)';
    requestAnimationFrame(() => {
      const cw = container.clientWidth;
      const ch = container.clientHeight || window.innerHeight * 0.65;
      const nw = content.scrollWidth;
      const nh = content.scrollHeight;
      if (nw === 0 || nh === 0) { content.style.transform = prev; return; }
      const sx = (cw - 48) / nw;
      const sy = (ch - 48) / nh;
      const s = Math.min(1, sx, sy);
      const fitZoom = Math.max(0.15, s);
      // Center the content
      const px = (cw - nw * fitZoom) / 2;
      const py = (ch - nh * fitZoom) / 2;
      setZoom(fitZoom);
      setPan({ x: Math.max(0, px), y: Math.max(0, py) });
    });
  }, []);

  useEffect(() => {
    if (tree.length === 0) return;
    const timer = setTimeout(fitToScreen, 80);
    const ro = new ResizeObserver(() => fitToScreen());
    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [tree, fitToScreen]);

  // ── Ctrl+scroll zoom (native listener to prevent browser zoom) ──
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(prev => {
        const next = Math.min(3, Math.max(0.1, prev * factor));
        const ratio = next / prev;
        setPan(p => ({
          x: mx - ratio * (mx - p.x),
          y: my - ratio * (my - p.y),
        }));
        return next;
      });
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  // ── Mouse pan ──
  const handlePanStart = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    // Only pan on middle-click or when clicking on empty canvas area
    if (e.button === 1 || (e.target as HTMLElement).closest('[data-chart-container]') === e.currentTarget) {
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { ...pan };
      e.currentTarget.style.cursor = 'grabbing';
    }
  }, [pan]);

  const handlePanMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!isPanning.current) return;
    setPan({
      x: panOrigin.current.x + (e.clientX - panStart.current.x),
      y: panOrigin.current.y + (e.clientY - panStart.current.y),
    });
  }, []);

  const handlePanEnd = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (isPanning.current) {
      isPanning.current = false;
      e.currentTarget.style.cursor = '';
    }
  }, []);

  // ── Stats ──
  const stats = useMemo(() => {
    const agentCount = positions.filter(p => p.holderType === 'AGENT' && p.agentId).length;
    const humanCount = positions.filter(p => p.holderType === 'HUMAN' && p.userId).length;
    const vacant = positions.length - agentCount - humanCount;
    const departments = [...new Set(positions.map(p => p.department).filter(Boolean))];
    return { total: positions.length, agents: agentCount, humans: humanCount, vacant, departments };
  }, [positions]);

  // ── Drag & Drop handlers ──
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    // Prevent dropping onto own descendants
    if (isDescendant(targetId, dragId, tree)) return;
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(targetId);
  }, [dragId, tree]);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    setDragId(null);
    setDropTarget(null);
    if (!sourceId || sourceId === targetId) return;
    if (isDescendant(targetId, sourceId, tree)) return;

    await api.updateOrgPosition(sourceId, { parentId: targetId });
    loadOrg();
  }, [tree]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTarget(null);
  }, []);

  // ── CRUD handlers ──
  const [companySaved, setCompanySaved] = useState(false);
  const handleSaveCompany = async () => {
    setSavingCompany(true);
    try {
      const activeSocials = socials.filter(s => s.url.trim());
      const result = await api.setCompanyProfile({ ...companyForm, company_socials: JSON.stringify(activeSocials) });
      setCompanyForm(result as any);
      window.dispatchEvent(new CustomEvent('company-name-changed', { detail: (result as any).company_name || '' }));
      setCompanySaved(true);
      setTimeout(() => setCompanySaved(false), 2000);
    } finally {
      setSavingCompany(false);
    }
  };

  const handleCreatePosition = async () => {
    if (!form.title.trim()) return;
    await api.createOrgPosition({
      title: form.title,
      department: form.department || undefined,
      parentId: form.parentId || undefined,
    });
    setShowCreate(false);
    setForm({ title: '', department: '', parentId: '' });
    loadOrg();
  };

  const handleAssign = async (positionId: string, holderType: string, holderId?: string) => {
    await api.assignOrgHolder(positionId, {
      holderType,
      ...(holderType === 'AGENT' ? { agentId: holderId } : { userId: holderId }),
    });
    setShowAssign(null);
    loadOrg();
  };

  const handleDeletePosition = async (id: string) => {
    await api.deleteOrgPosition(id);
    setDeleteConfirm(null);
    loadOrg();
  };

  const cn = companyForm.company_name || 'Company';
  const chartSz = getChartSize(positions.length);

  return (
    <div className="h-full flex flex-col p-3 md:p-6 gap-4 overflow-y-auto no-scrollbar" onDragEnd={handleDragEnd}>
      {/* ── Company Identity Header ── */}
      <div className="shrink-0 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 md:p-5">
        <div className="flex flex-col sm:flex-row items-start justify-between mb-2 gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl md:text-3xl font-bold">{cn}</h1>
              {companyForm.company_industry && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                  {companyForm.company_industry}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {companyForm.company_website && (
                <a href={companyForm.company_website} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-[var(--muted)] hover:text-[var(--accent)] transition">
                  {companyForm.company_website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {socials.filter(s => s.url.trim()).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-white hover:border-[var(--accent)]/50 transition"
                  title={s.url}>
                  {s.platform}
                </a>
              ))}
            </div>
            {companyForm.company_mission && (
              <p className="text-sm text-[var(--muted)] mt-1 max-w-3xl italic truncate">
                &ldquo;{companyForm.company_mission}&rdquo;
              </p>
            )}
          </div>
          <a href="#company-profile"
            className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] text-sm text-[var(--muted)] hover:text-white transition shrink-0">
            Edit Profile
          </a>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-2">
          <StatCard value={stats.total} label="Positions" />
          <StatCard value={stats.agents} label="AI Agents" color="#6c5ce7" />
          <StatCard value={stats.humans} label="Employees" color="#00cec9" />
          <StatCard value={stats.vacant} label="Vacant" color={stats.vacant > 0 ? '#e17055' : '#636e72'} />
          <StatCard value={stats.departments.length} label="Departments" />
        </div>
      </div>

      {/* ── Org Chart Canvas ── */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl flex flex-col">
        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-[var(--border)] flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-base md:text-lg font-semibold">Organization Structure</h2>
            <span className="text-xs text-[var(--muted)] hidden md:inline">Ctrl+Scroll to zoom · Drag to pan</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[var(--bg)] rounded-lg border border-[var(--border)] p-0.5">
              <button onClick={() => setZoom(z => Math.max(0.1, z / 1.25))}
                className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition" title="Zoom out">
                <ZoomOut size={16} />
              </button>
              <span className="text-xs text-[var(--muted)] w-12 text-center select-none">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(3, z * 1.25))}
                className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition" title="Zoom in">
                <ZoomIn size={16} />
              </button>
              <button onClick={fitToScreen}
                className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition" title="Fit to screen">
                <Maximize2 size={16} />
              </button>
            </div>
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm">
              + New Position
            </button>
          </div>
        </div>

        <div
          ref={chartContainerRef}
          data-chart-container
          className="relative overflow-hidden cursor-grab select-none"
          style={{ height: '65vh' }}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-[var(--muted)]">Loading...</div>
          ) : tree.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-4xl mb-4">🏢</p>
                <p className="text-lg font-medium mb-2">No positions yet</p>
                <p className="text-[var(--muted)] mb-4">Build your organizational structure</p>
                <button onClick={() => setShowCreate(true)}
                  className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">
                  + Add First Position
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={chartContentRef}
              className="pb-8 inline-block"
              style={{
                transformOrigin: '0 0',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                pointerEvents: 'auto',
              }}
            >
              {tree.length === 1 ? (
                <ChartTree
                  node={tree[0]} onAssign={(id) => setShowAssign(id)} onDelete={(id) => setDeleteConfirm(id)}
                  allDepts={stats.departments}
                  dragId={dragId} dropTarget={dropTarget}
                  onDragStart={handleDragStart} onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave} onDrop={handleDrop}
                  sz={chartSz}
                />
              ) : (
                <div className="flex" style={{ gap: sizeConfig[chartSz].gap * 3 }}>
                  {tree.map((root) => (
                    <ChartTree
                      key={root.id} node={root}
                      onAssign={(id) => setShowAssign(id)} onDelete={(id) => setDeleteConfirm(id)}
                      allDepts={stats.departments}
                      dragId={dragId} dropTarget={dropTarget}
                      onDragStart={handleDragStart} onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave} onDrop={handleDrop}
                      sz={chartSz}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Minimap-style dot grid background */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        </div>

        {/* Department legend */}
        {stats.departments.length > 0 && (
          <div className="flex items-center gap-3 md:gap-4 px-3 md:px-6 py-2 border-t border-[var(--border)] flex-wrap">
            {stats.departments.map((dept) => (
              <div key={dept} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getDeptColor(dept, stats.departments) }} />
                <span className="text-[11px] text-[var(--muted)]">{dept}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Company Profile Section (inline) ── */}
      <div id="company-profile" className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Company Profile</h2>
          <div className="flex items-center gap-3">
            {companySaved && <span className="text-green-500 text-sm">Saved!</span>}
            <button onClick={handleSaveCompany} disabled={savingCompany}
              className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              {savingCompany ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)] mb-5">This context is injected into every agent&apos;s system prompt.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Name & Industry */}
          {companyFields.filter(f => f.type === 'input' && ['company_name', 'company_industry'].includes(f.key)).map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-medium mb-1">{f.label}</label>
              <input
                value={companyForm[f.key] || ''}
                onChange={(e) => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
              />
            </div>
          ))}

          {/* ── Website & Links ── */}
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Website & Links</label>
              <div className="relative group">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 hover:bg-[var(--accent)]/20 text-xs font-medium text-[var(--accent)] transition">
                  <Plus size={14} /> Add Link
                </button>
                <div className="absolute right-0 top-full mt-1 w-[260px] max-h-[360px] overflow-y-auto bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl z-30 hidden group-focus-within:block hover:block">
                  {LINK_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-[var(--bg)]/50 sticky top-0">
                        {cat.label}
                      </div>
                      {cat.platforms
                        .filter(p => !socials.some(s => s.platform === p))
                        .map(p => (
                          <button key={p} onClick={() => setSocials([...socials, { platform: p, url: '' }])}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition">
                            {p}
                          </button>
                        ))
                      }
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--muted)] w-[80px] md:w-[110px] shrink-0">Website</span>
                <input
                  value={companyForm.company_website || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, company_website: e.target.value })}
                  placeholder="https://..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm min-w-0"
                />
              </div>
              {socials.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--muted)] w-[80px] md:w-[110px] shrink-0 truncate">{s.platform}</span>
                  <input
                    value={s.url}
                    onChange={(e) => {
                      const next = [...socials];
                      next[i] = { ...s, url: e.target.value };
                      setSocials(next);
                    }}
                    placeholder="https://..."
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm min-w-0"
                  />
                  <button onClick={() => setSocials(socials.filter((_, j) => j !== i))}
                    className="p-1 rounded text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Remaining fields (Description, Mission, etc.) */}
          {companyFields.filter(f => !['company_name', 'company_industry'].includes(f.key)).map((f) => (
            <div key={f.key} className={f.type === 'textarea' ? 'col-span-2' : ''}>
              <label className="block text-sm font-medium mb-1">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea
                  value={companyForm[f.key] || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                  rows={f.rows || 2} placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                />
              ) : (
                <input
                  value={companyForm[f.key] || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* MODALS */}
      {/* ═══════════════════════════════════════════ */}

      {/* Create Position Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Position</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" placeholder="e.g. CTO, Head of Sales" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Department</label>
                <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" placeholder="e.g. Engineering" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Report to</label>
                <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <option value="">None (root)</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}{p.agent ? ` (${p.agent.name})` : p.user ? ` (${p.user.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleCreatePosition} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign to Position Modal */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAssign(null)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Assign to Position</h3>
            <div className="space-y-2">
              <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-2">AI Agents</p>
              {agents.map((a) => (
                <button key={a.id} onClick={() => handleAssign(showAssign, 'AGENT', a.id)}
                  className="w-full text-left p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] hover:border-[var(--accent)]/50 transition flex items-center gap-3">
                  <Avatar name={a.name} avatar={a.avatar} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{a.name}</div>
                    <div className="text-xs text-[var(--muted)] truncate">
                      {a.positions?.[0]?.title || a.type}
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT[a.status] || '#636e72' }} />
                </button>
              ))}
              {users.length > 0 && (
                <>
                  <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-2 mt-4">Employees</p>
                  {users.map((u) => (
                    <button key={u.id} onClick={() => handleAssign(showAssign, 'HUMAN', u.id)}
                      className="w-full text-left p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)] hover:border-[var(--accent)]/50 transition flex items-center gap-3">
                      <Avatar name={u.name || u.email} avatar={u.avatarUrl} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{u.name}</div>
                        <div className="text-xs text-[var(--muted)]">{u.email}</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
              <button onClick={() => handleAssign(showAssign, 'AGENT')}
                className="w-full text-left p-3 rounded-lg border border-dashed border-[var(--border)] hover:bg-[var(--hover)] text-[var(--muted)] text-sm mt-2">
                Clear assignment (vacant)
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowAssign(null)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[400px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Delete Position</h3>
            <p className="text-sm text-[var(--muted)] mb-6">This will also remove all child positions. Are you sure?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={() => handleDeletePosition(deleteConfirm)} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
