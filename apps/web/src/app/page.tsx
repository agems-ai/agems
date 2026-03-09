'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Bot, MessageSquare, ListChecks, Wrench, Shield, Video,
  Workflow, Sparkles, ArrowRight, Github, Zap, Lock, Globe,
  Building2, Users, Brain, Database, FileText, ClipboardCheck,
  BookOpen, Send, Layers, Eye, Key, ChevronRight, Server, Cpu,
  Radio, FolderOpen, Code2, Briefcase, Target,
  TrendingUp, Megaphone, Headphones,
  Rocket, Globe2, LayoutDashboard, Settings,
  AlertTriangle, CheckCircle2, Clock, Gauge, Network, Plug,
  GitBranch,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   Section: Navigation
   ═══════════════════════════════════════════════════════════ */

function Nav({ isAuth }: { isAuth: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <nav className={`border-b border-[var(--border)] sticky top-0 z-50 transition-all ${scrolled ? 'bg-[var(--background)]/95 backdrop-blur-md' : 'bg-[var(--background)]/80 backdrop-blur-sm'}`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">
          <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">AGEMS</span>
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm text-[var(--muted)]">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#preview" className="hover:text-white transition-colors">Preview</a>
          <a href="#security" className="hover:text-white transition-colors">Security</a>
          <a href="#modules" className="hover:text-white transition-colors">Modules</a>
          <a href="#use-cases" className="hover:text-white transition-colors">Use Cases</a>
          <Link href="/enterprise" className="hover:text-white transition-colors">Enterprise</Link>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://github.com/agems-ai/agems" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition-colors">
            <Github size={18} /> GitHub
          </a>
          <Link href={isAuth ? '/dashboard' : '/login'}
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors">
            {isAuth ? 'Dashboard' : 'Get Started'}
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Hero
   ═══════════════════════════════════════════════════════════ */

function Hero({ isAuth }: { isAuth: boolean }) {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] text-xs font-medium mb-6">
        <Sparkles size={14} />
        Open Source AI Agent Platform
      </div>
      <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
        <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">
          Agent Management
        </span>
        <br />
        <span className="text-white">System</span>
      </h1>
      <p className="text-lg text-[var(--muted)] max-w-2xl mx-auto mb-10">
        The operating system for AI-native businesses. Build your org chart with AI agents
        and humans side by side — they communicate, execute tasks, use tools, and run your operations.
      </p>
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <Link href={isAuth ? '/dashboard' : '/login'}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors">
          {isAuth ? 'Open Dashboard' : 'Get Started'} <ArrowRight size={18} />
        </Link>
        <a href="https://github.com/agems-ai/agems" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg font-medium transition-colors">
          <Github size={18} /> View on GitHub
        </a>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Capabilities Bar
   ═══════════════════════════════════════════════════════════ */

function CapabilitiesBar() {
  const capabilities = [
    { icon: Zap, title: 'Multi-Provider AI', desc: 'OpenAI, Anthropic, Google, DeepSeek, Mistral, Ollama' },
    { icon: Lock, title: 'Multi-Tenant', desc: 'Org-scoped isolation with role-based access' },
    { icon: Globe, title: 'Fair Code', desc: 'Source available, self-hosted, fully customizable' },
  ];

  return (
    <section className="border-y border-[var(--border)] bg-[var(--card)]/50">
      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {capabilities.map((cap) => (
          <div key={cap.title} className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
              <cap.icon size={20} className="text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{cap.title}</p>
              <p className="text-xs text-[var(--muted)]">{cap.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Feature Overview Grid
   ═══════════════════════════════════════════════════════════ */

function FeatureGrid() {
  const features = [
    { icon: Bot, title: 'AI Agents', desc: 'Create agents with any LLM. Configure personality, mission, tools, and approval policies.' },
    { icon: MessageSquare, title: 'Real-time Chat', desc: 'WebSocket-powered channels between agents and humans with file sharing and streaming.' },
    { icon: ListChecks, title: 'Task Management', desc: 'One-time, recurring, and continuous tasks. Agents pick up and execute automatically.' },
    { icon: Wrench, title: 'Tool Integration', desc: 'REST APIs, databases, MCP servers, N8N workflows, SSH, S3 — as callable agent tools.' },
    { icon: Shield, title: 'Human-in-the-Loop', desc: 'Approval policies from full control to autopilot. Per-tool and per-category overrides.' },
    { icon: Video, title: 'Agent Meetings', desc: 'Multi-agent meetings with agendas, voting, decisions, and auto-generated summaries.' },
    { icon: Workflow, title: 'N8N Integration', desc: 'Execute and manage N8N automation workflows directly from the platform.' },
    { icon: Sparkles, title: 'Skills System', desc: 'Reusable knowledge modules agents load on-demand. Build once, assign to many.' },
  ];

  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl font-bold mb-4">Everything you need to manage AI agents</h2>
        <p className="text-[var(--muted)] max-w-xl mx-auto">
          A complete platform for building, deploying, and orchestrating AI agent teams.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((f) => (
          <div key={f.title} className="p-6 bg-[var(--card)] border border-[var(--border)] rounded-xl hover:border-[var(--accent)]/40 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center mb-4">
              <f.icon size={20} className="text-[var(--accent)]" />
            </div>
            <h3 className="font-semibold mb-2">{f.title}</h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Product Preview — Styled UI Mockups
   ═══════════════════════════════════════════════════════════ */

function ProductPreview() {
  return (
    <section id="preview" className="border-y border-[var(--border)] bg-[var(--card)]/30">
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">See it in action</h2>
          <p className="text-[var(--muted)] max-w-xl mx-auto">
            A unified interface where agents and humans work side by side.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Preview 1: Org Chart */}
          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <span className="text-xs text-[var(--muted)] ml-2">Company &mdash; Org Chart</span>
            </div>
            <div className="p-6">
              <div className="flex justify-center mb-4">
                <div className="px-4 py-2.5 bg-[var(--card)] border border-[var(--accent)]/40 rounded-lg text-center">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center mx-auto mb-1.5">
                    <span className="text-xs font-bold text-[var(--accent)]">A</span>
                  </div>
                  <div className="text-xs font-semibold text-white">Gemma</div>
                  <div className="text-[10px] text-[var(--accent)]">System Director</div>
                  <div className="flex items-center gap-1 justify-center mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="text-[9px] text-[var(--muted)]">AI Agent</span>
                  </div>
                </div>
              </div>
              <div className="flex justify-center mb-4">
                <div className="w-px h-6 bg-[var(--border)]" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { name: 'Sarah', title: 'Marketing Lead', type: 'Human', color: '#e17055' },
                  { name: 'Atlas', title: 'Sales Manager', type: 'AI Agent', color: '#00cec9' },
                  { name: 'Dev-1', title: 'DevOps', type: 'AI Agent', color: '#6c5ce7' },
                ].map((p) => (
                  <div key={p.name} className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-center">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mb-1" style={{ backgroundColor: `${p.color}20` }}>
                      <span className="text-[10px] font-bold" style={{ color: p.color }}>{p.name[0]}</span>
                    </div>
                    <div className="text-[10px] font-semibold text-white">{p.name}</div>
                    <div className="text-[9px] text-[var(--muted)]">{p.title}</div>
                    <div className="flex items-center gap-1 justify-center mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${p.type === 'Human' ? 'bg-blue-400' : 'bg-green-400'}`} />
                      <span className="text-[8px] text-[var(--muted)]">{p.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Preview 2: Agent Config */}
          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <span className="text-xs text-[var(--muted)] ml-2">Agents &mdash; Atlas Configuration</span>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#00cec9]/20 flex items-center justify-center">
                  <span className="text-sm font-bold text-[#00cec9]">A</span>
                </div>
                <div>
                  <div className="font-semibold text-white text-sm">Atlas</div>
                  <div className="text-[var(--muted)]">Sales Manager &bull; Autonomous</div>
                </div>
                <div className="ml-auto px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-medium">Active</div>
              </div>
              {[
                { label: 'Brain', value: 'Anthropic Claude 3.5 Sonnet' },
                { label: 'Mission', value: 'Close deals, manage pipeline, train junior agents' },
                { label: 'Tools', value: 'CRM DB, Email API, Calendar, N8N Workflows' },
                { label: 'Skills', value: 'Sales Playbook, Objection Handling, Pricing' },
                { label: 'Approval', value: 'Supervised — writes need approval, reads are free' },
                { label: 'Memory', value: '47 entries (knowledge, context, conversations)' },
              ].map((r) => (
                <div key={r.label} className="flex items-start gap-2 py-1.5 border-b border-[var(--border)]/50 last:border-0">
                  <span className="text-[var(--accent)] w-16 shrink-0 font-medium">{r.label}</span>
                  <span className="text-[var(--muted)]">{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Preview 3: Chat with Approval */}
          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <span className="text-xs text-[var(--muted)] ml-2">Comms &mdash; #sales-team</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[9px] font-bold text-blue-400">S</span>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--muted)]">Sarah &bull; 2 min ago</div>
                  <div className="text-xs text-white/90 mt-0.5">Atlas, how&apos;s the pipeline looking this week?</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-[#00cec9]/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[9px] font-bold text-[#00cec9]">A</span>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] text-[var(--muted)]">Atlas &bull; just now</div>
                  <div className="text-xs text-white/90 mt-0.5">Pipeline is at $342K across 12 deals. 3 closing this week. Should I follow up with Acme Corp?</div>
                  <div className="mt-1.5 flex items-center gap-2 text-[9px] text-[var(--muted)]/60">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--accent)]/8 text-[var(--accent)]/70">db_query</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--accent)]/8 text-[var(--accent)]/70">analysis</span>
                    <span>847 tokens</span>
                  </div>
                </div>
              </div>
              <div className="ml-8 bg-yellow-500/8 border border-yellow-500/20 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] text-yellow-400 font-medium mb-1">
                  <AlertTriangle size={11} /> Approval Required
                </div>
                <div className="text-[10px] text-[var(--muted)] mb-2">Atlas wants to send email to acme@example.com</div>
                <div className="flex gap-2">
                  <div className="px-2.5 py-1 rounded bg-green-500/15 text-green-400 text-[10px] font-medium cursor-default">Approve</div>
                  <div className="px-2.5 py-1 rounded bg-red-500/15 text-red-400 text-[10px] font-medium cursor-default">Reject</div>
                </div>
              </div>
            </div>
          </div>

          {/* Preview 4: Dashboard */}
          <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <span className="text-xs text-[var(--muted)] ml-2">Dashboard &mdash; KPI Widgets</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Agents', value: '8', sub: '6 active' },
                  { label: 'Tasks', value: '143', sub: '12 in progress' },
                  { label: 'Messages', value: '2,847', sub: '+23% this week' },
                ].map((w) => (
                  <div key={w.label} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-white">{w.value}</div>
                    <div className="text-[9px] text-[var(--muted)] uppercase tracking-wider">{w.label}</div>
                    <div className="text-[8px] text-[var(--accent)]/60 mt-0.5">{w.sub}</div>
                  </div>
                ))}
              </div>
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3">
                <div className="text-[10px] text-[var(--muted)] mb-2">Revenue (custom widget)</div>
                <div className="flex items-end gap-1.5 h-12">
                  {[40, 55, 45, 60, 75, 65, 80, 90, 72, 88, 95, 78].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-[var(--accent)]/30" style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-[8px] text-[var(--muted)]">Jan</span>
                  <span className="text-[8px] text-[var(--muted)]">Dec</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Security & Agent Control
   ═══════════════════════════════════════════════════════════ */

function SecurityControl() {
  const controls = [
    { icon: Shield, title: 'Approval Policies', desc: '4 presets from Full Control to Autopilot. Override per category or per tool. Cost thresholds for auto-approval.' },
    { icon: Eye, title: 'Audit Trail', desc: 'Every action logged with actor, timestamp, and metadata. 11 action types. Filter and search.' },
    { icon: Lock, title: 'Tenant Isolation', desc: 'All data scoped to organization. JWT tokens carry orgId. Complete data separation.' },
    { icon: Key, title: 'RBAC', desc: '4 roles with granular permissions. Per-agent tool access control. Multi-org support.' },
    { icon: AlertTriangle, title: 'Honesty Policy', desc: 'Immutable system preamble prevents agents from hallucinating actions. Only real tool calls.' },
    { icon: Gauge, title: 'Execution Monitoring', desc: 'Real-time streaming of agent thinking. Stop button. Loop detection. Cost tracking.' },
  ];

  return (
    <section id="security" className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl font-bold mb-4">Security & agent control</h2>
        <p className="text-[var(--muted)] max-w-xl mx-auto">
          Complete control over what agents can do, with full transparency into what they did.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {controls.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.title} className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-red-500/8 flex items-center justify-center mb-3">
                <Icon size={20} className="text-red-400/80" />
              </div>
              <h3 className="font-semibold mb-1.5 text-white">{c.title}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">{c.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: How It Works
   ═══════════════════════════════════════════════════════════ */

function HowItWorks() {
  const steps = [
    { num: '01', title: 'Set Up Company', desc: 'Create your org and describe your business. Context is shared with all agents.', icon: Building2 },
    { num: '02', title: 'Build Org Chart', desc: 'Create departments and positions for humans, agents, or both.', icon: Network },
    { num: '03', title: 'Configure Agents', desc: 'Choose LLM, write system prompt, assign tools and skills, set approval policy.', icon: Bot },
    { num: '04', title: 'Connect Tools', desc: 'Register databases, APIs, N8N workflows as callable tools with permissions.', icon: Plug },
    { num: '05', title: 'Start Working', desc: 'Assign tasks, send messages, and watch agents work. Monitor via dashboards.', icon: Rocket },
  ];

  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl font-bold mb-4">How it works</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.num} className="text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--accent)]/10 flex items-center justify-center mx-auto mb-4">
                <Icon size={22} className="text-[var(--accent)]" />
              </div>
              <div className="text-xs text-[var(--accent)] font-mono font-bold mb-1">{s.num}</div>
              <h3 className="font-semibold text-sm mb-2">{s.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Platform Modules (compact grid)
   ═══════════════════════════════════════════════════════════ */

function ModulesSection() {
  const modules = [
    { icon: Building2, title: 'Company', desc: 'Org chart with departments and positions for humans, agents, or both' },
    { icon: Bot, title: 'Agents', desc: 'Any LLM, persistent memory, system prompt, mission, lifecycle management' },
    { icon: Users, title: 'Employees', desc: '4 roles (Admin to Viewer), multi-org, profiles, JWT auth' },
    { icon: ListChecks, title: 'Tasks', desc: 'One-time, recurring, continuous. Subtasks, priorities, auto-execution' },
    { icon: MessageSquare, title: 'Communications', desc: 'Real-time channels, multi-agent dialogue, file sharing, streaming' },
    { icon: Shield, title: 'Approvals', desc: '4 presets, per-tool overrides, cost thresholds, inline approve/reject' },
    { icon: Video, title: 'Meetings', desc: 'Agendas, real-time discussion, voting, decisions, AI summaries' },
    { icon: Wrench, title: 'Tools', desc: '11 types: REST, DB, MCP, N8N, SSH, S3, GraphQL, gRPC, and more' },
    { icon: BookOpen, title: 'Skills', desc: 'Reusable knowledge modules loaded on-demand by agents' },
    { icon: Workflow, title: 'N8N', desc: 'Execute, activate, and monitor automation workflows' },
    { icon: LayoutDashboard, title: 'Dashboard', desc: 'Custom widgets with JS code, auto-refresh, charts and KPIs' },
    { icon: FolderOpen, title: 'Files', desc: 'Upload, paste, share. Agents understand images via vision models' },
    { icon: Eye, title: 'Audit Log', desc: 'Every action tracked: who, what, when. Full compliance trail' },
    { icon: Send, title: 'Telegram', desc: 'Per-agent bots, cross-platform context, voice and image support' },
    { icon: Settings, title: 'Settings', desc: 'Company context, API keys, org configuration' },
  ];

  return (
    <section id="modules" className="border-y border-[var(--border)] bg-[var(--card)]/30">
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">15 modules, one platform</h2>
          <p className="text-[var(--muted)] max-w-xl mx-auto">
            Everything you need to run a company where AI agents and humans work as one team.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.title} className="flex items-start gap-3 p-4 bg-[var(--background)] border border-[var(--border)] rounded-xl hover:border-[var(--accent)]/30 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-[var(--accent)]" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-white">{m.title}</h3>
                  <p className="text-xs text-[var(--muted)] leading-relaxed mt-0.5">{m.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Use Cases
   ═══════════════════════════════════════════════════════════ */

function UseCasesSection() {
  const useCases = [
    { icon: Megaphone, category: 'Marketing', title: 'Ads & Social Media', desc: 'Monitor campaigns, analyze ROAS, adjust budgets, auto-post content, and generate performance reports across platforms.' },
    { icon: TrendingUp, category: 'Sales', title: 'Lead Qualification & CRM', desc: 'Score inbound leads, send follow-up sequences via email and WhatsApp, update CRM, and generate pipeline reports.' },
    { icon: Headphones, category: 'Support', title: 'Call Analytics & QA', desc: 'Transcribe calls, analyze quality metrics (politeness, resolution, trust), and generate feedback for operators and managers.' },
    { icon: Code2, category: 'Engineering', title: 'DevOps & Infrastructure', desc: 'Monitor servers, manage deployments via SSH, handle incidents, and trigger CI/CD pipelines through N8N.' },
    { icon: Briefcase, category: 'Operations', title: 'Full Company Management', desc: 'The META agent coordinates all departments, generates KPI reports, schedules meetings, and delegates across agent teams.' },
    { icon: Globe2, category: 'Localization', title: 'Multi-language Support', desc: 'Agents detect language, respond in-kind, localize templates with variable substitution across 16+ languages.' },
  ];

  return (
    <section id="use-cases" className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl font-bold mb-4">Use cases</h2>
        <p className="text-[var(--muted)] max-w-xl mx-auto">
          From marketing automation to full company management.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {useCases.map((uc) => {
          const Icon = uc.icon;
          return (
            <div key={uc.title} className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl hover:border-[var(--accent)]/30 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-[var(--accent)]" />
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium">{uc.category}</span>
                  <h3 className="font-semibold text-sm text-white leading-tight">{uc.title}</h3>
                </div>
              </div>
              <p className="text-sm text-[var(--muted)] leading-relaxed">{uc.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Architecture
   ═══════════════════════════════════════════════════════════ */

function Architecture() {
  const stack = [
    { label: 'Backend', value: 'NestJS 11 + Prisma + PostgreSQL', icon: Server },
    { label: 'Frontend', value: 'Next.js 15 + React 19 + Tailwind 4', icon: Layers },
    { label: 'AI Runtime', value: 'Vercel AI SDK — multi-provider tool loop', icon: Cpu },
    { label: 'Real-time', value: 'Socket.io WebSocket', icon: Radio },
    { label: 'Queue', value: 'BullMQ + Redis', icon: Clock },
    { label: 'Auth', value: 'JWT + RBAC, 4 roles, multi-org', icon: Key },
    { label: 'Monorepo', value: 'Turborepo + pnpm workspaces', icon: GitBranch },
    { label: 'License', value: 'Sustainable Use License (fair-code)', icon: FileText },
    { label: 'Deploy', value: 'Docker + docker-compose', icon: Database },
  ];

  return (
    <section id="architecture" className="border-y border-[var(--border)] bg-[var(--card)]/30">
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Built for production</h2>
          <p className="text-[var(--muted)] max-w-xl mx-auto">
            Modern stack. Self-host anywhere. Customize everything.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {stack.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-[var(--accent)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{item.label}</p>
                  <p className="text-xs text-[var(--muted)]">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="max-w-2xl mx-auto mt-16 bg-[var(--background)] border border-[var(--border)] rounded-xl p-6 font-mono text-sm">
          <div className="text-[var(--accent)]/70 space-y-0.5">
            <div>agems/</div>
            <div className="ml-4">apps/</div>
            <div className="ml-8 text-[var(--muted)]">api/ <span className="text-[var(--accent)]/40">— NestJS backend</span></div>
            <div className="ml-8 text-[var(--muted)]">web/ <span className="text-[var(--accent)]/40">— Next.js frontend</span></div>
            <div className="ml-4">packages/</div>
            <div className="ml-8 text-[var(--muted)]">ai/ <span className="text-[var(--accent)]/40">— AgentRunner, providers</span></div>
            <div className="ml-8 text-[var(--muted)]">db/ <span className="text-[var(--accent)]/40">— Prisma schema</span></div>
            <div className="ml-8 text-[var(--muted)]">shared/ <span className="text-[var(--accent)]/40">— Types & validation</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Quick Start
   ═══════════════════════════════════════════════════════════ */

function QuickStart() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold mb-4">Get started in minutes</h2>
      </div>
      <div className="max-w-2xl mx-auto bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 font-mono text-sm">
        <div className="text-[var(--success)] mb-3">
          git clone https://github.com/agems-ai/agems.git<br />
          cd agems && pnpm install
        </div>
        <div className="text-[var(--success)] mb-3">
          docker-compose up -d postgres redis
        </div>
        <div className="text-[var(--success)] mb-3">
          cp .env.example .env <span className="text-[var(--muted)]"># add your LLM API keys</span>
        </div>
        <div className="text-[var(--success)] mb-3">
          pnpm db:push && pnpm dev
        </div>
        <div className="text-[var(--muted)]">
          # Open http://localhost:3000
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: CTA
   ═══════════════════════════════════════════════════════════ */

function CTA({ isAuth }: { isAuth: boolean }) {
  return (
    <section className="border-t border-[var(--border)]">
      <div className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to build your AI team?</h2>
        <p className="text-[var(--muted)] mb-8 max-w-md mx-auto">
          Deploy AGEMS and start managing AI agents alongside your team. Free and open source.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href={isAuth ? '/dashboard' : '/login'}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors">
            {isAuth ? 'Open Dashboard' : 'Create Account'} <ArrowRight size={18} />
          </Link>
          <a href="https://github.com/agems-ai/agems" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg font-medium transition-colors">
            <Github size={18} /> Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Section: Footer
   ═══════════════════════════════════════════════════════════ */

function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--card)]/30">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-[var(--muted)]">
          <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent font-semibold">
            AGEMS
          </span>
          {' '}&mdash; Agent Management System
        </div>
        <div className="flex items-center gap-6 text-sm text-[var(--muted)]">
          <a href="https://github.com/agems-ai/agems" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition-colors">GitHub</a>
          <a href="https://github.com/agems-ai/agems/issues" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition-colors">Issues</a>
          <span>Sustainable Use License</span>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════ */

export default function LandingPage() {
  const [isAuth, setIsAuth] = useState<boolean | null>(null);

  useEffect(() => {
    setIsAuth(!!api.getToken());
  }, []);

  if (isAuth === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Nav isAuth={isAuth} />
      <Hero isAuth={isAuth} />
      <CapabilitiesBar />
      <FeatureGrid />
      <ProductPreview />
      <SecurityControl />
      <HowItWorks />
      <ModulesSection />
      <UseCasesSection />
      <Architecture />
      <QuickStart />
      <CTA isAuth={isAuth} />
      <Footer />
    </div>
  );
}
