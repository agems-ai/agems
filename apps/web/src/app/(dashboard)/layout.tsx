'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import { ChatManagerProvider, ChatDock } from '@/components/chat';
import {
  LayoutDashboard,
  Building2,
  Bot,
  Users,
  ListChecks,
  ShieldAlert,
  MessageSquare,
  Video,
  Wrench,
  Sparkles,
  ShieldCheck,
  Settings,
  Crown,
  LogOut,
  FolderOpen,
  Store,
  Menu,
  X,
  ChevronsUpDown,
  Plus,
  Check,
  BookOpen,
  Target,
  FolderKanban,
  DollarSign,
  Inbox,
} from 'lucide-react';
import CommandPalette from '@/components/CommandPalette';
import ThemeToggle from '@/components/ThemeToggle';

const navItems = [
  // Overview
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/company', label: 'Company', icon: Building2 },
  // AI core
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/tools', label: 'Tools', icon: Wrench },
  { href: '/catalog', label: 'Catalog', icon: Store },
  // Work management
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  // Communication
  { href: '/comms', label: 'Comms', icon: MessageSquare },
  { href: '/meetings', label: 'Meetings', icon: Video },
  // Organization
  { href: '/employees', label: 'Employees', icon: Users },
  // Governance & resources
  { href: '/approvals', label: 'Approvals', icon: ShieldAlert },
  { href: '/budgets', label: 'Budgets', icon: DollarSign },
  { href: '/files', label: 'Files', icon: FolderOpen },
  { href: '/security', label: 'Audit', icon: ShieldCheck },
  // System
  { href: '/docs', label: 'Docs', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/admin', label: 'Admin', icon: Crown, adminOnly: true },
];

const mobileNavItems = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/comms', label: 'Chat', icon: MessageSquare },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [companyName, setCompanyName] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Org switcher state
  const [orgs, setOrgs] = useState<any[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState('');
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const orgDropdownRef = useRef<HTMLDivElement>(null);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Close org dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    const tokenUser = api.getUserFromToken();
    if (tokenUser) setCurrentOrgId(tokenUser.orgId);

    Promise.all([
      api.fetch('/auth/profile'),
      api.getCompanyProfile().catch(() => ({})),
    ]).then(([profile, company]: any[]) => {
      setUser(profile);
      setOrgs(profile.memberships?.map((m: any) => ({ id: m.org.id, name: m.org.name, slug: m.org.slug, plan: m.org.plan })) || []);
      setCompanyName(company?.company_name || '');
      setReady(true);
    }).catch(() => {
      api.clearToken();
      router.replace('/login');
    });

    // Fetch pending approval count
    api.getPendingApprovalCount().then((r) => setPendingApprovals(r.count)).catch(() => {});
    const interval = setInterval(() => {
      api.getPendingApprovalCount().then((r) => setPendingApprovals(r.count)).catch(() => {});
    }, 30000);

    const onCompanyUpdate = (e: Event) => setCompanyName((e as CustomEvent).detail || '');
    window.addEventListener('company-name-changed', onCompanyUpdate);
    return () => {
      clearInterval(interval);
      window.removeEventListener('company-name-changed', onCompanyUpdate);
    };
  }, [router]);

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === currentOrgId) {
      setOrgDropdownOpen(false);
      return;
    }
    try {
      const res = await api.switchOrg(orgId);
      api.setToken(res.token);
      setCurrentOrgId(orgId);
      setOrgDropdownOpen(false);
      window.location.reload();
    } catch (err: any) {
      console.error('Failed to switch org:', err);
    }
  };

  const currentOrg = orgs.find(o => o.id === currentOrgId);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-14 bg-[var(--card)] border-b border-[var(--border)] lg:hidden">
        <button onClick={() => setSidebarOpen(true)} className="p-1 -ml-1 text-[var(--muted)] hover:text-white">
          <Menu size={22} />
        </button>
        <Link href="/dashboard" className="text-lg font-bold">
          {companyName && <span className="text-white mr-1.5">{companyName}</span>}
          <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">AGEMS</span>
        </Link>
      </div>

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-56 bg-[var(--card)] border-r border-[var(--border)] flex flex-col
        transform transition-transform duration-200 ease-in-out
        lg:static lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-bold">
            {companyName && (
              <span className="text-white mr-1.5">{companyName}</span>
            )}
            <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">
              AGEMS
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button onClick={() => setSidebarOpen(false)} className="p-1 text-[var(--muted)] hover:text-white lg:hidden">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Org Switcher */}
        {orgs.length > 0 && (
          <div className="px-2 pt-2" ref={orgDropdownRef}>
            <button
              onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-colors text-left"
            >
              <div className="w-6 h-6 rounded bg-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
                <Building2 size={13} className="text-[var(--accent)]" />
              </div>
              <span className="text-xs font-medium truncate flex-1">{currentOrg?.name || 'Organization'}</span>
              <ChevronsUpDown size={12} className="text-[var(--muted)] flex-shrink-0" />
            </button>

            {orgDropdownOpen && (
              <div className="absolute left-2 right-2 mt-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="p-1 max-h-48 overflow-y-auto">
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => handleSwitchOrg(org.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-[var(--card-hover)] transition-colors"
                    >
                      <div className="w-5 h-5 rounded bg-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
                        <Building2 size={11} className="text-[var(--accent)]" />
                      </div>
                      <span className="text-xs truncate flex-1">{org.name}</span>
                      {org.id === currentOrgId && <Check size={12} className="text-[var(--accent)]" />}
                    </button>
                  ))}
                </div>
                <div className="border-t border-[var(--border)] p-1">
                  <button
                    onClick={() => { setOrgDropdownOpen(false); router.push('/org/new'); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-[var(--card-hover)] transition-colors text-[var(--muted)]"
                  >
                    <Plus size={14} />
                    <span className="text-xs">New Organization</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <nav className="flex-1 p-2 overflow-y-auto">
          {navItems.filter((item) => !(item as any).adminOnly || user?.role === 'ADMIN').map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'text-white bg-[var(--accent)]/20'
                    : 'text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]'
                }`}
              >
                <item.icon size={18} strokeWidth={1.5} />
                <span className="flex-1">{item.label}</span>
                {item.href === '/approvals' && pendingApprovals > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-amber-500 text-white">
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {/* User info + logout */}
        <div className="p-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-2 px-2">
            <div className="w-7 h-7 rounded-full bg-[var(--accent)]/30 flex items-center justify-center text-xs font-medium">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.name}</p>
              <p className="text-[10px] text-[var(--muted)] truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => { api.clearToken(); router.replace('/login'); }}
              className="text-[var(--muted)] hover:text-white p-1 rounded transition-colors"
              title="Logout"
            >
              <LogOut size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-14 lg:pt-0 main-content-mobile-pad">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <div className="mobile-bottom-nav lg:hidden">
        {mobileNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} data-active={isActive}>
              <item.icon size={20} strokeWidth={1.5} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette />

      {/* Multi-chat system — Gemma + incoming agent/human chats */}
      <ChatManagerProvider>
        <ChatDock />
      </ChatManagerProvider>
    </div>
  );
}
