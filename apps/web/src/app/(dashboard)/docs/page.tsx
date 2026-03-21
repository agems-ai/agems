'use client';

import { useState, useEffect, useRef } from 'react';
import { BookOpen, ChevronRight, Search, ExternalLink } from 'lucide-react';

const sections = [
  { id: 'getting-started', title: 'Getting Started' },
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'agents', title: 'Agents' },
  { id: 'external-agents', title: 'External Agents & Adapters' },
  { id: 'tools', title: 'Tools' },
  { id: 'skills', title: 'Skills' },
  { id: 'employees', title: 'Employees' },
  { id: 'tasks', title: 'Tasks' },
  { id: 'goals', title: 'Goals' },
  { id: 'projects', title: 'Projects' },
  { id: 'budgets', title: 'Budgets' },
  { id: 'approvals', title: 'Approvals' },
  { id: 'comms', title: 'Channels & Chat' },
  { id: 'meetings', title: 'Meetings' },
  { id: 'files', title: 'Files' },
  { id: 'company', title: 'Company Structure' },
  { id: 'plugins', title: 'Plugins' },
  { id: 'n8n', title: 'N8N Integration' },
  { id: 'audit', title: 'Audit & Security' },
  { id: 'settings', title: 'Settings' },
  { id: 'organizations', title: 'Organizations' },
  { id: 'entities', title: 'Data Model Reference' },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 mb-12">
      <h2 className="text-xl font-bold mb-4 pb-2 border-b border-[var(--border)]">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--muted)]">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[var(--muted)]">{children}</p>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-white mt-6 mb-2">{children}</h3>;
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-[var(--border)]/50 last:border-0">
      <span className="font-mono text-xs text-[var(--accent)] shrink-0 w-40">{name}</span>
      <span className="text-sm text-[var(--muted)]">{children}</span>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-300 text-xs mt-2">
      <strong>Tip:</strong> {children}
    </div>
  );
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('getting-started');
  const [search, setSearch] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  // Scrollspy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );
    const sectionEls = document.querySelectorAll('section[id]');
    sectionEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const filteredSections = search
    ? sections.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          s.id.toLowerCase().includes(search.toLowerCase())
      )
    : sections;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex h-full">
      {/* Sidebar TOC */}
      <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/50 overflow-y-auto">
        <div className="p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={18} className="text-[var(--accent)]" />
            <span className="font-semibold text-sm">Documentation</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
        <nav className="flex-1 p-2">
          {filteredSections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                activeSection === s.id
                  ? 'text-white bg-[var(--accent)]/15 font-medium'
                  : 'text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]'
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-6 md:p-10 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1">AGEMS Documentation</h1>
          <p className="text-[var(--muted)] text-sm">
            Complete guide to the AGEMS platform — AI agents, tools, tasks, and team collaboration.
          </p>
        </div>

        {/* Mobile TOC */}
        <div className="lg:hidden mb-6 p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl">
          <p className="text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wider">Jump to section</p>
          <div className="flex flex-wrap gap-1.5">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="px-2.5 py-1 rounded text-xs text-[var(--muted)] hover:text-white bg-[var(--background)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* ── Getting Started ── */}
        <Section id="getting-started" title="Getting Started">
          <P>
            AGEMS (AI-Governed Enterprise Management System) is a platform for creating and managing AI agents that work as a team.
            Agents can chat with you and each other, execute tasks, attend meetings, use external tools, and operate under configurable approval policies.
          </P>

          <H3>Quick Setup</H3>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[var(--accent)] font-bold text-xs mt-0.5">1.</span>
              <P>Go to <strong className="text-white">Settings &rarr; LLM Keys</strong> and add at least one API key (OpenAI, Anthropic, Google, DeepSeek, or Mistral).</P>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[var(--accent)] font-bold text-xs mt-0.5">2.</span>
              <P>Create your first agent in <strong className="text-white">Agents &rarr; + New Agent</strong>. Give it a name, choose a provider/model, and write a system prompt.</P>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[var(--accent)] font-bold text-xs mt-0.5">3.</span>
              <P>Open the <strong className="text-white">Dashboard</strong> and start chatting with your agent. You can also chat from the agent detail page or from Comms.</P>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[var(--accent)] font-bold text-xs mt-0.5">4.</span>
              <P>Add <strong className="text-white">Tools</strong> (APIs, databases, MCP servers) and assign them to agents so they can interact with external systems.</P>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[var(--accent)] font-bold text-xs mt-0.5">5.</span>
              <P>Create <strong className="text-white">Tasks</strong> and assign them to agents. Enable the task scheduler in Settings to let agents pick up work automatically.</P>
            </div>
          </div>
        </Section>

        {/* ── Dashboard ── */}
        <Section id="dashboard" title="Dashboard">
          <P>
            The Dashboard is the main workspace. It combines a chat interface with customizable data widgets.
          </P>

          <H3>Chat</H3>
          <P>
            Select any agent from the dropdown to start a conversation. Messages are sent in real-time via WebSocket.
            Each chat creates a direct channel between you and the agent. You can view the agent's thinking process,
            tool calls, and skill usage by expanding the "Execution Details" in each message.
          </P>

          <H3>Widgets</H3>
          <P>
            The top section shows data widgets that display live platform statistics. Default widgets show agent count, task breakdown, tools, skills, and recent message count.
          </P>
          <P>
            You can create custom widgets by clicking "+ Add Widget". Each widget runs a JavaScript snippet that can call
            the AGEMS API via <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">await agems('/endpoint')</code> or external
            databases via <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">await query('tool-name', 'SQL')</code>.
          </P>
          <P>
            Display modes: <strong className="text-white">number</strong> (single value), <strong className="text-white">breakdown</strong> (label/value pairs),
            <strong className="text-white"> table</strong> (data grid), <strong className="text-white">chart</strong> (bar chart).
            Each widget auto-refreshes on a configurable interval.
          </P>
        </Section>

        {/* ── Agents ── */}
        <Section id="agents" title="Agents">
          <P>
            Agents are AI entities that can think, communicate, use tools, and execute tasks. Each agent has its own identity, model configuration, system prompt, and set of assigned tools and skills.
          </P>

          <H3>Creating an Agent</H3>
          <P>Click "+ New Agent" to create one. Required fields:</P>
          <Field name="Name">Display name for the agent (e.g., "Alex", "Sophia").</Field>
          <Field name="System Prompt">Core instructions that define the agent's behavior, personality, and capabilities. This is prepended with the AGEMS Platform Preamble (see Settings &rarr; System Prompts).</Field>
          <P>Optional fields:</P>
          <Field name="Slug">URL-friendly identifier, auto-generated from name (e.g., "alex").</Field>
          <Field name="Avatar">Emoji or image path. You can upload a photo from the agent detail page.</Field>
          <Field name="Type">
            <strong>AUTONOMOUS</strong> — works independently, picks up tasks;{' '}
            <strong>ASSISTANT</strong> — responds to user requests;{' '}
            <strong>META</strong> — manages other agents;{' '}
            <strong>REACTIVE</strong> — responds to events/triggers;{' '}
            <strong>EXTERNAL</strong> — powered by an external runtime via adapters (see External Agents).
          </Field>
          <Field name="Provider">LLM provider: ANTHROPIC, OPENAI, GOOGLE, DEEPSEEK, MISTRAL, OLLAMA, or CUSTOM.</Field>
          <Field name="Model">Specific model ID (e.g., "claude-opus-4-6", "gpt-4o", "gemini-2.0-flash").</Field>
          <Field name="Mission">Short description of the agent's purpose, shown on the agent card.</Field>

          <H3>Agent Detail Page</H3>
          <P>From the agent detail page you can:</P>
          <div className="pl-4 space-y-1">
            <P>&bull; <strong className="text-white">Chat</strong> — Direct conversation. Create multiple chat sessions (history dropdown). Each session is a separate channel.</P>
            <P>&bull; <strong className="text-white">Edit</strong> — Update name, model, system prompt, mission, avatar, type, values, and LLM config (temperature, max tokens, thinking budget).</P>
            <P>&bull; <strong className="text-white">Tools</strong> — Assign/remove external tools. Agents also have built-in runtime tools (task management, channel messaging, file operations, etc.).</P>
            <P>&bull; <strong className="text-white">Skills</strong> — Assign/remove skills. Skill content is injected into the agent's system prompt.</P>
            <P>&bull; <strong className="text-white">Memory</strong> — View, add, edit, and delete agent memories. Types: KNOWLEDGE, PREFERENCE, EXPERIENCE, CONTEXT. Memories persist across conversations and help the agent retain information.</P>
            <P>&bull; <strong className="text-white">Execution History</strong> — View recent executions with input, output, tool calls, tokens used, and cost.</P>
            <P>&bull; <strong className="text-white">Spawn</strong> — Create a child agent that inherits the parent's configuration. Useful for specialization.</P>
            <P>&bull; <strong className="text-white">Delegate</strong> — Send a task to a child agent (visible when child agents exist).</P>
            <P>&bull; <strong className="text-white">Activate / Pause</strong> — Toggle agent status. Paused agents don't pick up new tasks.</P>
            <P>&bull; <strong className="text-white">Archive / Restore</strong> — Soft-delete agents. Archived agents are inactive but can be restored.</P>
          </div>

          <H3>Agent Statuses</H3>
          <Field name="ACTIVE">Agent is operational, can receive messages and pick up tasks.</Field>
          <Field name="DRAFT">Newly created, not yet activated.</Field>
          <Field name="PAUSED">Temporarily disabled. Won't pick up new tasks but can still receive messages.</Field>
          <Field name="ERROR">Agent encountered a critical error.</Field>
          <Field name="ARCHIVED">Soft-deleted. Not visible in normal views. Can be restored.</Field>

          <H3>LLM Configuration</H3>
          <Field name="Temperature">Controls randomness (0 = deterministic, 1 = creative). Default: 0.7.</Field>
          <Field name="Max Tokens">Maximum output length per response. Default: 4096.</Field>
          <Field name="Thinking Budget">Token budget for extended thinking/reasoning. Default: 4000. Used by models that support thinking (e.g., Claude).</Field>
        </Section>

        {/* ── External Agents & Adapters ── */}
        <Section id="external-agents" title="External Agents & Adapters">
          <P>
            External agents run on external runtimes outside the built-in LLM engine. They connect to AGEMS via adapters — bridge layers that translate
            between AGEMS task/message format and the external tool's protocol. Use external agents when you need specialized runtimes like Claude Code, Codex, or custom HTTP services.
          </P>

          <H3>Creating an External Agent</H3>
          <P>
            Go to <strong className="text-white">Agents &rarr; + New Agent &rarr; From Scratch</strong>. Set the type to <strong className="text-white">EXTERNAL</strong>.
            An "Adapter" section will appear where you select the runtime and configure connection details.
          </P>

          <H3>Adapter Types</H3>
          <Field name="CLAUDE_CODE">Anthropic Claude Code CLI. Runs the <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">claude</code> CLI as a subprocess. Config: model, maxTokens, allowedTools.</Field>
          <Field name="CODEX">OpenAI Codex CLI. Approval modes: suggest, auto-edit, full-auto. Config: model, approvalMode.</Field>
          <Field name="CURSOR">Cursor IDE agent. Supports background mode for persistent sessions. Config: workspacePath, background.</Field>
          <Field name="GEMINI_CLI">Google Gemini CLI. Supports sandbox mode and multimodal input. Config: model, sandbox.</Field>
          <Field name="OPENCLAW">Docker-based agent via SSE gateway. Communicates via Server-Sent Events streaming. Config: gatewayUrl, containerName.</Field>
          <Field name="OPENCODE">Multi-provider coding agent with automatic model detection. Config: model, provider.</Field>
          <Field name="PI">Pi agent runtime. Config: model.</Field>
          <Field name="HTTP">Generic HTTP webhook adapter. Fire-and-forget or wait-for-response. Supports Bearer, Basic, API Key auth. Config: url, method, headers, auth, waitForResponse, responseTimeoutMs.</Field>
          <Field name="PROCESS">Generic shell command adapter. Runs any CLI tool or script as a subprocess. Config: command, args, shell.</Field>

          <H3>Adapter Configuration</H3>
          <P>
            Each adapter has its own config JSON. When you select an adapter type, fill in the required fields. For example, OPENCLAW needs a <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">gatewayUrl</code> pointing to the SSE gateway, while HTTP needs a <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">url</code> endpoint.
          </P>

          <H3>How External Agents Work</H3>
          <div className="pl-4 space-y-1">
            <P>&bull; When a task or message is routed to an external agent, AGEMS serializes the input and sends it to the adapter.</P>
            <P>&bull; The adapter translates the request into the external runtime's format (CLI args, HTTP payload, SSE stream).</P>
            <P>&bull; Output is captured, parsed, and stored as an <strong className="text-white">AgentExecution</strong> record with tokens, cost, and duration.</P>
            <P>&bull; External agents participate in the same task, approval, and communication systems as built-in agents.</P>
          </div>

          <Tip>The HTTP adapter is the most flexible — point it at any REST API that accepts a prompt and returns a response. Use it to integrate custom AI services or non-LLM automation endpoints.</Tip>
        </Section>

        {/* ── Tools ── */}
        <Section id="tools" title="Tools">
          <P>
            Tools are external integrations that agents can use to interact with APIs, databases, and services.
            When a tool is assigned to an agent, the agent can call it during conversations and task execution.
          </P>

          <H3>Tool Types</H3>
          <Field name="REST_API">HTTP API endpoint. Configure URL, method, headers.</Field>
          <Field name="GRAPHQL">GraphQL API endpoint.</Field>
          <Field name="DATABASE">SQL database connection (PostgreSQL, MySQL). Agents can run queries.</Field>
          <Field name="MCP_SERVER">Model Context Protocol server. Provides structured tool access.</Field>
          <Field name="WEBHOOK">Outgoing webhook endpoint.</Field>
          <Field name="N8N">N8N workflow trigger. Agents can execute n8n workflows.</Field>
          <Field name="DIGITALOCEAN">DigitalOcean cloud infrastructure management.</Field>
          <Field name="SSH">SSH connection to remote servers.</Field>
          <Field name="CUSTOM">Custom tool type with free-form configuration.</Field>

          <H3>Authentication</H3>
          <Field name="NONE">No authentication required.</Field>
          <Field name="API_KEY">API key sent as header or query parameter.</Field>
          <Field name="BEARER_TOKEN">Bearer token in Authorization header.</Field>
          <Field name="BASIC">HTTP Basic authentication (username/password).</Field>
          <Field name="OAUTH2">OAuth 2.0 flow.</Field>
          <Field name="CUSTOM">Custom authentication scheme.</Field>

          <H3>Configuration</H3>
          <P>
            Each tool has a JSON config object. Common fields: <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">url</code>,{' '}
            <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">description</code>,{' '}
            <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">host</code>,{' '}
            <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">port</code>,{' '}
            <code className="text-xs bg-[var(--background)] px-1.5 py-0.5 rounded font-mono">database</code>.
            The description field is shown to agents to help them understand what the tool does.
          </P>
          <P>
            Use the <strong className="text-white">Test</strong> button to verify connectivity. Response time is shown in milliseconds.
          </P>
          <Tip>Assign tools to agents from the agent detail page. An agent can only use tools that are explicitly assigned to it.</Tip>
        </Section>

        {/* ── Skills ── */}
        <Section id="skills" title="Skills">
          <P>
            Skills are reusable text instructions that get injected into an agent's system prompt when assigned.
            Think of them as "knowledge modules" — they teach agents specific capabilities without modifying the core system prompt.
          </P>

          <H3>Skill Properties</H3>
          <Field name="Name">Display name (e.g., "Data Analysis", "Customer Support").</Field>
          <Field name="Slug">URL-friendly identifier, auto-generated from name.</Field>
          <Field name="Description">Short description of what the skill teaches.</Field>
          <Field name="Content">The actual instruction text injected into the agent's system prompt. This is where you write detailed instructions, examples, and guidelines.</Field>
          <Field name="Version">Semantic version string (e.g., "1.0.0").</Field>
          <Field name="Type">
            <strong>BUILTIN</strong> — platform-provided skills;{' '}
            <strong>PLUGIN</strong> — third-party skills;{' '}
            <strong>CUSTOM</strong> — user-created skills.
          </Field>
          <Field name="Entry Point">Internal reference path (e.g., "skills/data-analysis").</Field>

          <H3>Editor</H3>
          <P>
            Click "Edit" to open the full-screen skill editor. The left sidebar lists all skills for quick switching.
            Use Ctrl+S / Cmd+S to save. Unsaved changes are highlighted with a warning badge.
          </P>
          <Tip>Assign skills to agents from the agent detail page. Multiple agents can share the same skill.</Tip>
        </Section>

        {/* ── Employees ── */}
        <Section id="employees" title="Employees">
          <P>
            Employees are human team members who can log in, chat with agents, create tasks, and participate in meetings.
          </P>

          <H3>Employee Properties</H3>
          <Field name="Name">Full name of the team member.</Field>
          <Field name="Email">Login email address (must be unique).</Field>
          <Field name="Password">Login password. Required when creating, optional when editing (leave blank to keep current).</Field>
          <Field name="Role">
            <strong>ADMIN</strong> — full access to all platform features and settings;{' '}
            <strong>MANAGER</strong> — can manage agents, tasks, and team members;{' '}
            <strong>MEMBER</strong> — standard access, can chat and work on tasks.
          </Field>
          <Field name="Avatar">Click the camera icon on an employee card to upload a profile photo.</Field>

          <P>
            Click the chat icon on any employee card to open a direct message channel with that person.
          </P>
        </Section>

        {/* ── Tasks ── */}
        <Section id="tasks" title="Tasks">
          <P>
            Tasks are work items that can be assigned to agents or humans. The task board uses a Kanban-style layout with drag-and-drop between columns.
          </P>

          <H3>Board Columns</H3>
          <P>
            The Kanban board groups the 10 task statuses into 5 visual columns: Pending, In Progress, Review (IN_REVIEW + IN_TESTING + VERIFIED), Completed, and Failed (FAILED + BLOCKED + CANCELLED).
            You can also switch to a list view with sortable columns including a progress bar.
          </P>

          <H3>Creating a Task</H3>
          <Field name="Title">Short description of what needs to be done.</Field>
          <Field name="Description">Detailed instructions, context, and acceptance criteria.</Field>
          <Field name="Priority">LOW, MEDIUM, HIGH, or CRITICAL. Higher priority tasks are picked up first.</Field>
          <Field name="Type">
            <strong>ONE_TIME</strong> — execute once;{' '}
            <strong>RECURRING</strong> — repeats on a cron schedule (resets to PENDING after completion);{' '}
            <strong>CONTINUOUS</strong> — ongoing, never fully completes.
          </Field>
          <Field name="Cron Expression">For RECURRING tasks. Standard cron format (e.g., "0 9 * * *" for daily at 9 AM).</Field>
          <Field name="Project">Optional — link the task to a project for grouping and tracking.</Field>
          <Field name="Goal">Optional — link the task to a goal. Tasks linked to goals contribute to goal progress.</Field>
          <Field name="Progress">0-100% slider. Auto-set to 100% when status changes to COMPLETED.</Field>
          <Field name="Assignee">Assign to an agent or a human team member.</Field>
          <Field name="Deadline">Optional due date.</Field>

          <H3>Task Statuses</H3>
          <Field name="PENDING">Waiting to be picked up.</Field>
          <Field name="IN_PROGRESS">Currently being worked on.</Field>
          <Field name="IN_REVIEW">Work completed, awaiting review.</Field>
          <Field name="IN_TESTING">Being tested/verified.</Field>
          <Field name="VERIFIED">Testing passed.</Field>
          <Field name="AWAITING_APPROVAL">Needs approval before proceeding.</Field>
          <Field name="COMPLETED">Successfully finished (progress auto-set to 100%).</Field>
          <Field name="FAILED">Could not be completed.</Field>
          <Field name="BLOCKED">Blocked by a dependency.</Field>
          <Field name="CANCELLED">Cancelled.</Field>

          <H3>Task Details</H3>
          <P>
            Click any task card to view details. From the detail view you can:
          </P>
          <div className="pl-4 space-y-1">
            <P>&bull; Read the full description and result</P>
            <P>&bull; Add <strong className="text-white">comments</strong> — both humans and agents can comment on tasks</P>
            <P>&bull; View subtasks (parent-child task hierarchy)</P>
            <P>&bull; Change status, priority, assignee, and deadline</P>
            <P>&bull; Drag-and-drop between columns to change status</P>
          </div>

          <H3>Quick Filters</H3>
          <P>
            Filter tasks by: All, My Tasks (assigned to or created by me), Assigned to Me, Created by Me.
            Additional filters by assignee and creator are available.
          </P>

          <Tip>Agents can create tasks for other agents. When the autonomy level is high (see Settings &rarr; Task Agents), agents actively delegate work to specialists.</Tip>
        </Section>

        {/* ── Goals ── */}
        <Section id="goals" title="Goals">
          <P>
            Goals are hierarchical objectives — from high-level company goals down to team and individual targets.
            Goals can be linked to projects and broken down into sub-goals forming a tree structure.
          </P>

          <H3>Goal Properties</H3>
          <Field name="Title">Goal name or objective statement.</Field>
          <Field name="Description">Detailed description of the goal and success criteria.</Field>
          <Field name="Status">PLANNED, ACTIVE, ACHIEVED, CANCELLED, or PAUSED.</Field>
          <Field name="Priority">LOW, MEDIUM, HIGH, or CRITICAL.</Field>
          <Field name="Owner Type">HUMAN, AGENT, or SYSTEM — who is responsible for achieving this goal.</Field>
          <Field name="Owner">The specific employee or agent responsible.</Field>
          <Field name="Agent">Optional — assign an AI agent to work towards this goal.</Field>
          <Field name="Project">Optional — link to a project for organizational grouping.</Field>
          <Field name="Progress">0-100% progress bar. Manually set or auto-calculated from sub-goals.</Field>
          <Field name="Target Date">Optional deadline for achieving the goal.</Field>
          <Field name="Parent Goal">Optional — create goal hierarchies by nesting under a parent goal.</Field>

          <H3>Goal Hierarchy</H3>
          <P>
            Goals support parent-child relationships, enabling you to decompose large objectives into smaller, measurable targets.
            Tasks can be linked to goals, contributing to their progress tracking.
          </P>
          <Tip>Link tasks to goals to track how individual work items contribute to broader objectives.</Tip>
        </Section>

        {/* ── Projects ── */}
        <Section id="projects" title="Projects">
          <P>
            Projects group related tasks and goals under a single initiative. They provide high-level tracking with status, dates, and progress.
          </P>

          <H3>Project Properties</H3>
          <Field name="Name">Project name.</Field>
          <Field name="Description">Project overview, scope, and deliverables.</Field>
          <Field name="Status">BACKLOG, PLANNED, IN_PROGRESS, COMPLETED, CANCELLED, or ON_HOLD.</Field>
          <Field name="Priority">LOW, MEDIUM, HIGH, or CRITICAL.</Field>
          <Field name="Lead Type">HUMAN, AGENT, or SYSTEM — who leads the project.</Field>
          <Field name="Lead">The specific person or agent leading the project.</Field>
          <Field name="Start Date">When the project begins.</Field>
          <Field name="Target Date">Expected completion date.</Field>
          <Field name="Progress">0-100% progress indicator.</Field>

          <H3>Project Statistics</H3>
          <P>
            Each project shows aggregated statistics: tasks grouped by status and goals grouped by status.
            This gives a quick overview of how much work is done vs. remaining.
          </P>
          <Tip>Create a project first, then link tasks and goals to it for organized tracking.</Tip>
        </Section>

        {/* ── Budgets ── */}
        <Section id="budgets" title="Budgets">
          <P>
            Budgets control AI agent spending. Each budget defines a monthly USD limit for a specific agent,
            with soft alerts and hard stops to prevent overspending.
          </P>

          <H3>Budget Properties</H3>
          <Field name="Agent">Which agent this budget applies to.</Field>
          <Field name="Monthly Limit (USD)">Maximum spending allowed per billing period.</Field>
          <Field name="Current Spend">Running total of costs incurred in the current period.</Field>
          <Field name="Soft Alert (%)">Percentage threshold that triggers a warning notification. Default: 80%.</Field>
          <Field name="Hard Stop">When enabled, the agent is paused if it hits the monthly limit. Default: on.</Field>
          <Field name="Period">Budget period (auto-defaults to current month if not specified).</Field>

          <H3>Budget Incidents</H3>
          <P>
            The system automatically logs budget incidents:
          </P>
          <Field name="SOFT_ALERT">Agent spend exceeded the soft alert threshold.</Field>
          <Field name="HARD_STOP">Agent was paused due to exceeding the hard limit.</Field>
          <Field name="BUDGET_RESET">Budget period reset (new month).</Field>
          <Field name="MANUAL_OVERRIDE">An admin manually adjusted the budget.</Field>
        </Section>

        {/* ── Approvals ── */}
        <Section id="approvals" title="Approvals">
          <P>
            The Approval system lets you control what agents can do. When an agent attempts an action that requires approval
            (based on its approval policy), a request is created and the agent pauses until it's approved or rejected.
          </P>

          <H3>Approval Request Fields</H3>
          <Field name="Agent">The agent requesting permission.</Field>
          <Field name="Category">Action type: READ, WRITE, DELETE, EXECUTE, SEND, or ADMIN.</Field>
          <Field name="Risk Level">LOW, MEDIUM, HIGH, or CRITICAL — determined automatically based on the action.</Field>
          <Field name="Status">PENDING, APPROVED, REJECTED, or EXPIRED.</Field>
          <Field name="Requested From">The approver — can be a human or another agent.</Field>
          <Field name="Details">Description of what the agent wants to do, including tool name, parameters, and context.</Field>

          <H3>Approval Policies</H3>
          <P>
            Each agent can have an approval policy configured from the agent detail page. Policies control how different action categories are handled:
          </P>
          <Field name="Preset">Quick configuration: AUTONOMOUS (no approvals), SUPERVISED (all actions need approval), or CUSTOM.</Field>
          <Field name="Action Modes">Per-category settings (read, write, delete, execute, send, admin). Each can be: AUTO_APPROVE, REQUIRE_APPROVAL, or DENY.</Field>
          <Field name="Tool Overrides">Per-tool approval settings that override the default policy.</Field>
          <Field name="Approver">Who reviews requests — a specific human or agent.</Field>
          <Field name="Auto-approve after">Minutes before a pending request is auto-approved (0 = never).</Field>
          <Field name="Auto-approve low risk">If enabled, LOW risk actions are auto-approved.</Field>
          <Field name="Cost threshold">USD threshold — actions above this cost require approval regardless of policy.</Field>

          <H3>Bulk Actions</H3>
          <P>
            On the Approvals page, you can select multiple pending requests and approve or reject them all at once.
            Real-time WebSocket updates show new requests instantly.
          </P>

          <H3>Filters</H3>
          <P>
            Filter by: status tab (Pending/Approved/Rejected/Expired/All), requesting agent, approver, category, and risk level.
          </P>
        </Section>

        {/* ── Comms ── */}
        <Section id="comms" title="Channels & Chat">
          <P>
            The Comms page is the messaging hub. All conversations happen in channels.
          </P>

          <H3>Channel Types</H3>
          <Field name="DIRECT">One-on-one conversation between two participants (human-to-agent, agent-to-agent, or human-to-human).</Field>
          <Field name="GROUP">Multi-participant channel. Can include any mix of agents and humans.</Field>

          <H3>Creating a Channel</H3>
          <P>
            Click "+ New Channel" to create a group channel. Select participants (agents and/or humans), give it a name, and start chatting.
            Direct channels are created automatically when you message an agent from their profile.
          </P>

          <H3>Chat Features</H3>
          <div className="pl-4 space-y-1">
            <P>&bull; <strong className="text-white">Real-time messaging</strong> via WebSocket</P>
            <P>&bull; <strong className="text-white">File attachments</strong> — click the paperclip icon to upload files</P>
            <P>&bull; <strong className="text-white">Markdown support</strong> — messages render GitHub-flavored markdown</P>
            <P>&bull; <strong className="text-white">Execution details</strong> — expand agent messages to see thinking, tool calls, and skill usage</P>
            <P>&bull; <strong className="text-white">Approval cards</strong> — inline approval requests appear in chat for quick approve/reject</P>
            <P>&bull; <strong className="text-white">Channel settings</strong> — edit name, description, and avatar for group channels</P>
          </div>

          <H3>Filters</H3>
          <P>
            Filter the channel list by: All, Direct (1:1 conversations), Group (multi-participant), Agent (channels with agents).
          </P>
        </Section>

        {/* ── Meetings ── */}
        <Section id="meetings" title="Meetings">
          <P>
            Meetings are structured multi-party discussions where agents and humans collaborate in real-time.
            Unlike channels (free-form chat), meetings have an agenda, ordered entries, and a voting/decision system.
          </P>

          <H3>Meeting Properties</H3>
          <Field name="Title">Meeting topic or name.</Field>
          <Field name="Agenda">Structured agenda items. Agents use this to stay on topic.</Field>
          <Field name="Participants">Agents and humans who attend. Each has a role (e.g., participant, facilitator).</Field>
          <Field name="Status">SCHEDULED, IN_PROGRESS, COMPLETED, or CANCELLED.</Field>
          <Field name="Scheduled At">When the meeting is planned to start.</Field>

          <H3>During a Meeting</H3>
          <div className="pl-4 space-y-1">
            <P>&bull; <strong className="text-white">Entries</strong> — ordered messages from participants. The chat-like interface shows who said what in sequence.</P>
            <P>&bull; <strong className="text-white">Speaking</strong> — type a message and submit. All agent participants are prompted to respond. Active speakers are highlighted.</P>
            <P>&bull; <strong className="text-white">Voting</strong> — propose a decision for participants to vote on. Agents vote based on their analysis. Results show votes for, against, and abstain.</P>
            <P>&bull; <strong className="text-white">Decisions</strong> — formalized meeting outcomes with vote tallies.</P>
            <P>&bull; <strong className="text-white">Tasks</strong> — link tasks to meetings for action items.</P>
            <P>&bull; <strong className="text-white">Summary</strong> — auto-generated or manual meeting summary.</P>
          </div>

          <P>
            Real-time updates via WebSocket — new entries appear instantly as agents respond.
            A fallback polling mechanism ensures no messages are missed.
          </P>
        </Section>

        {/* ── Files ── */}
        <Section id="files" title="Files">
          <P>
            The Files page provides a file management system with folders, uploads, search, and preview.
          </P>

          <H3>Features</H3>
          <div className="pl-4 space-y-1">
            <P>&bull; <strong className="text-white">Folder hierarchy</strong> — create nested folders. Navigate with breadcrumbs.</P>
            <P>&bull; <strong className="text-white">Upload</strong> — drag-and-drop or click the upload button. Files are stored on the server.</P>
            <P>&bull; <strong className="text-white">Search</strong> — search files by name across all folders.</P>
            <P>&bull; <strong className="text-white">Filter by type</strong> — image, document, text, or all files.</P>
            <P>&bull; <strong className="text-white">Preview</strong> — click a file to preview images inline, or download other file types.</P>
            <P>&bull; <strong className="text-white">Grid / List view</strong> — toggle between visual grid and compact list layout.</P>
            <P>&bull; <strong className="text-white">Context menu</strong> — right-click files and folders to rename, move, or delete.</P>
            <P>&bull; <strong className="text-white">Move</strong> — move files and folders between directories.</P>
          </div>

          <P>
            Agents can also upload files and create folders as part of their task execution.
            Files uploaded by agents show the agent name as the uploader.
          </P>
        </Section>

        {/* ── Company ── */}
        <Section id="company" title="Company Structure">
          <P>
            The Company page displays your organizational chart as a visual tree. Positions can be held by agents or humans.
          </P>

          <H3>Org Chart</H3>
          <P>
            The interactive chart shows all positions in a hierarchical tree. Cards display the position holder's name, avatar, title, department, and status.
            Vacant positions appear as dashed-border cards.
          </P>
          <div className="pl-4 space-y-1">
            <P>&bull; <strong className="text-white">Add Position</strong> — create new positions with title and department. Positions without a parent appear at the root level.</P>
            <P>&bull; <strong className="text-white">Assign Holder</strong> — assign an agent or human to a position.</P>
            <P>&bull; <strong className="text-white">Drag & Drop</strong> — reorganize the hierarchy by dragging position cards.</P>
            <P>&bull; <strong className="text-white">Department Colors</strong> — each department gets a unique accent color for visual grouping.</P>
            <P>&bull; <strong className="text-white">Zoom & Pan</strong> — zoom in/out and fit the chart to screen for large organizations.</P>
            <P>&bull; <strong className="text-white">Stats</strong> — overview cards showing total positions, agents, humans, and departments.</P>
          </div>

          <H3>Position Fields</H3>
          <Field name="Title">Job title (e.g., "CTO", "Marketing Lead").</Field>
          <Field name="Department">Organizational department (e.g., "Engineering", "Marketing").</Field>
          <Field name="Holder Type">AGENT or HUMAN — who occupies this position.</Field>
          <Field name="Parent">The position this one reports to in the hierarchy.</Field>
        </Section>

        {/* ── Plugins ── */}
        <Section id="plugins" title="Plugins">
          <P>
            Plugins extend the platform with custom functionality. They are installable modules that add new capabilities without modifying core code.
          </P>

          <H3>Plugin Properties</H3>
          <Field name="Name">Plugin display name.</Field>
          <Field name="Slug">Unique identifier for the plugin.</Field>
          <Field name="Description">What the plugin does.</Field>
          <Field name="Version">Semantic version (e.g., "1.0.0").</Field>
          <Field name="Author">Plugin creator name.</Field>
          <Field name="Entry Point">Main module path for the plugin.</Field>
          <Field name="Config">JSON configuration object for plugin settings.</Field>
          <Field name="Enabled">Toggle plugin on/off without uninstalling.</Field>

          <Tip>Plugins are scoped to your organization — each org can install and configure plugins independently.</Tip>
        </Section>

        {/* ── N8N ── */}
        <Section id="n8n" title="N8N Integration">
          <P>
            AGEMS integrates with n8n, an open-source workflow automation platform. Agents can trigger n8n workflows as part of their tool usage.
          </P>

          <H3>Setup</H3>
          <P>
            Go to <strong className="text-white">Settings &rarr; N8N</strong> tab. Enter your n8n instance URL and API key.
            Use "Test Connection" to verify. The system will show how many workflows were found.
          </P>

          <H3>N8N Page Features</H3>
          <div className="pl-4 space-y-1">
            <P>&bull; <strong className="text-white">List workflows</strong> — view all workflows from your n8n instance with status (active/inactive).</P>
            <P>&bull; <strong className="text-white">Create</strong> — create new workflows directly from AGEMS.</P>
            <P>&bull; <strong className="text-white">Activate / Deactivate</strong> — toggle workflow active state.</P>
            <P>&bull; <strong className="text-white">Execute</strong> — manually trigger a workflow run.</P>
            <P>&bull; <strong className="text-white">Edit</strong> — click a workflow to open the visual node editor with the full n8n canvas.</P>
            <P>&bull; <strong className="text-white">Delete</strong> — remove workflows (with confirmation).</P>
          </div>

          <Tip>Create an N8N tool type and assign it to agents so they can trigger n8n workflows during conversations.</Tip>
        </Section>

        {/* ── Audit ── */}
        <Section id="audit" title="Audit & Security">
          <P>
            The Audit page provides a comprehensive activity log and access rule management.
          </P>

          <H3>Audit Log</H3>
          <P>
            Every significant action in the platform is logged: agent executions, task changes, tool calls, login events, and more.
          </P>
          <Field name="Actor Type">AGENT, HUMAN, or SYSTEM — who performed the action.</Field>
          <Field name="Action">CREATE, UPDATE, DELETE, LOGIN, EXECUTE, ACTIVATE, PAUSE.</Field>
          <Field name="Filters">Filter by actor type, action type, and date range.</Field>
          <P>Paginated view with timestamps, actor names, and action details.</P>

          <H3>Access Rules</H3>
          <P>
            Define explicit access permissions for agents on specific resource types.
          </P>
          <Field name="Agent">Which agent this rule applies to.</Field>
          <Field name="Resource Type">The type of resource (e.g., "tasks", "channels", "files").</Field>
          <Field name="Permission Level">READ, WRITE, EXECUTE, or ADMIN.</Field>
          <Field name="Granted By">Who created this rule (human or agent), for audit trail.</Field>
        </Section>

        {/* ── Settings ── */}
        <Section id="settings" title="Settings">
          <P>
            Platform configuration is organized into five tabs.
          </P>

          <H3>LLM Keys</H3>
          <P>
            Add API keys for AI model providers. Each provider shows a status indicator (green = key set, gray = not configured) and a masked preview of the current key.
          </P>
          <Field name="OpenAI">GPT-4, GPT-4o, Whisper. Key format: sk-...</Field>
          <Field name="Anthropic">Claude 4, Claude 3.5. Key format: sk-ant-...</Field>
          <Field name="Google AI">Gemini Pro, Gemini Ultra. Key format: AIza...</Field>
          <Field name="DeepSeek">DeepSeek V3, DeepSeek R1.</Field>
          <Field name="Mistral">Mistral Large, Mistral Medium.</Field>
          <P>You only need to add keys for providers you plan to use. At least one key is required for agents to function.</P>

          <H3>Platform</H3>
          <Field name="Platform Name">Display name for your AGEMS instance (shown in the UI).</Field>
          <Field name="Default LLM Provider">Provider used when creating new agents (OPENAI, ANTHROPIC, GOOGLE, DEEPSEEK, MISTRAL, OLLAMA).</Field>
          <Field name="Default Model">Model ID used by default for new agents.</Field>
          <Field name="Max Concurrent Executions">How many agent executions can run simultaneously. Default: 10.</Field>
          <Field name="Execution Timeout">Maximum seconds an agent execution can run before being terminated. Default: 300 (5 minutes).</Field>

          <H3>Task Agents</H3>
          <P>Controls how agents interact with the task system.</P>
          <Field name="Agent Task Execution">Master toggle. When OFF, no agents will pick up new tasks. Tasks already in progress will finish.</Field>
          <Field name="Autonomy Level">
            Controls agent collaboration behavior (1-5 scale):
            <br />
            <strong>1 (Solo)</strong> — agents work independently.{' '}
            <strong>2 (Lean)</strong> — prefer self-reliance.{' '}
            <strong>3 (Balanced)</strong> — use judgment.{' '}
            <strong>4 (Team-first)</strong> — default to delegation.{' '}
            <strong>5 (Full collaboration)</strong> — maximum coordination.
          </Field>
          <Field name="Scheduler Interval">How often (in seconds) the system checks for pending tasks and resets recurring tasks. Min: 10s. Default: 60s.</Field>
          <Field name="Review Interval">How often agents are reminded to progress in-progress tasks, review work, and verify results. Min: 30s. Default: 300s.</Field>
          <Field name="Daily Review Budget">Maximum USD per agent per day for review cycles. Set to 0 for unlimited.</Field>

          <H3>System Prompts</H3>
          <P>
            The <strong className="text-white">AGEMS Platform Preamble</strong> is injected into every agent's system prompt on every execution.
            It teaches agents how to use platform features — tasks, channels, meetings, approvals, and memory.
          </P>
          <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-300 text-xs mt-2">
            <strong>Warning:</strong> Incorrect changes to the preamble may cause agents to stop using platform features properly.
            Use "Reset to Default" to restore the factory version.
          </div>

          <H3>N8N</H3>
          <Field name="N8N API URL">URL of your n8n instance (e.g., https://n8n.example.com).</Field>
          <Field name="API Key">n8n API key for authentication. Shows masked preview when set.</Field>
          <P>
            Use "Test Connection" to verify the connection. On success, it reports the number of workflows found.
          </P>
        </Section>

        {/* ── Organizations ── */}
        <Section id="organizations" title="Organizations">
          <P>
            AGEMS supports multi-tenancy with full organization isolation. Each organization has its own agents, tools, tasks, channels, and settings.
          </P>

          <H3>Organization Switcher</H3>
          <P>
            The org switcher in the sidebar shows your current organization. Click to switch between organizations you belong to.
            Each switch issues a new authentication token scoped to that organization.
          </P>

          <H3>Creating an Organization</H3>
          <P>
            Click "+ New Organization" from the org switcher. Two modes:
          </P>
          <Field name="Blank">Start fresh with an empty organization.</Field>
          <Field name="Clone">Copy data from an existing organization. Select which entities to clone:</Field>
          <div className="pl-4 space-y-1 mt-1">
            <P>&bull; <strong className="text-white">Settings</strong> — platform configuration (LLM keys, preamble, task config)</P>
            <P>&bull; <strong className="text-white">Tools</strong> — API integrations and tools</P>
            <P>&bull; <strong className="text-white">Skills</strong> — agent skills and prompts</P>
            <P>&bull; <strong className="text-white">Agents</strong> — AI agents with their tool/skill assignments</P>
            <P>&bull; <strong className="text-white">Channels</strong> — direct and group channels with participants</P>
            <P>&bull; <strong className="text-white">Messages</strong> — channel message history</P>
            <P>&bull; <strong className="text-white">Tasks</strong> — tasks with comments and subtask hierarchy</P>
            <P>&bull; <strong className="text-white">Meetings</strong> — meetings with entries, participants, and decisions</P>
            <P>&bull; <strong className="text-white">Approvals</strong> — approval policies per agent</P>
            <P>&bull; <strong className="text-white">Files</strong> — uploaded files and folder structure</P>
            <P>&bull; <strong className="text-white">Agent History</strong> — agent execution logs</P>
            <P>&bull; <strong className="text-white">Employees</strong> — team members</P>
            <P>&bull; <strong className="text-white">Company Structure</strong> — org chart and positions</P>
          </div>
          <Tip>
            When cloning, entity relationships are preserved. For example, cloned agents keep their tool/skill assignments,
            cloned channels keep their participants, and cloned tasks keep their parent-child hierarchy.
          </Tip>
        </Section>

        {/* ── Data Model Reference ── */}
        <Section id="entities" title="Data Model Reference">
          <P>
            AGEMS uses a PostgreSQL database with the following core entities. This reference helps you understand the data model when building integrations, custom widgets, or external tools.
          </P>

          <H3>Core Entities (50 models)</H3>

          <div className="space-y-4 mt-4">
            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Organization & Users</h4>
              <Field name="Organization">Multi-tenant container. Has name, slug, plan (FREE, STARTER, PRO, BUSINESS, ENTERPRISE).</Field>
              <Field name="User">Platform user with email, password, name, role (ADMIN, MANAGER, MEMBER, VIEWER).</Field>
              <Field name="OrgMember">Links users to organizations with a role.</Field>
              <Field name="OrgPosition">Org chart position with title, department, holder (AGENT or HUMAN).</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Agents</h4>
              <Field name="Agent">AI entity with type, status, LLM config, system prompt, adapter config, Telegram config.</Field>
              <Field name="AgentSkill">Many-to-many: agent &harr; skill assignment with config and enabled flag.</Field>
              <Field name="AgentTool">Many-to-many: agent &harr; tool assignment with permissions and approval mode.</Field>
              <Field name="AgentMemory">Agent knowledge store. Types: CONTEXT, CONVERSATION, FILE, KNOWLEDGE.</Field>
              <Field name="AgentMetric">Performance metrics: COST, LATENCY, QUALITY, ERROR_RATE, TASKS_DONE, TOKENS_USED.</Field>
              <Field name="AgentExecution">Execution log with status, trigger, I/O, tool calls, tokens, cost.</Field>
              <Field name="AgentConfigRevision">Version history of agent configuration changes.</Field>
              <Field name="AgentApiKey">API keys for programmatic agent access.</Field>
              <Field name="AgentBudget">Monthly spending limits with soft alerts and hard stops.</Field>
              <Field name="BudgetIncident">Budget event log (SOFT_ALERT, HARD_STOP, BUDGET_RESET, MANUAL_OVERRIDE).</Field>
              <Field name="Responsibility">Agent duties with title, description, KPI metrics, and priority.</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Work Management</h4>
              <Field name="Task">Work item with status (10 states), priority, type, progress (0-100), project/goal linkage, subtask hierarchy.</Field>
              <Field name="TaskComment">Comments on tasks by agents, humans, or system.</Field>
              <Field name="TaskLabel">Tags/labels for task categorization.</Field>
              <Field name="TaskAttachment">Files attached to tasks.</Field>
              <Field name="TaskWorkProduct">Deliverables: ARTIFACT, DOCUMENT, CODE, REPORT, FILE.</Field>
              <Field name="TaskReadState">Inbox tracking — marks tasks as read/unread per user.</Field>
              <Field name="Goal">Hierarchical objective with status, progress, owner, project link.</Field>
              <Field name="Project">Initiative grouping tasks and goals with lead, dates, progress.</Field>
              <Field name="Label">Reusable color-coded labels scoped to organization.</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Communication</h4>
              <Field name="Channel">Conversation container. Types: DIRECT, GROUP, BROADCAST, SYSTEM.</Field>
              <Field name="ChannelParticipant">Channel membership with role (ADMIN, MEMBER, OBSERVER).</Field>
              <Field name="Message">Chat message with sender, content type (TEXT, JSON, FILE, ACTION).</Field>
              <Field name="TelegramChat">Links Telegram chats to agents and channels.</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Meetings</h4>
              <Field name="Meeting">Structured discussion with agenda, participants, entries, decisions.</Field>
              <Field name="MeetingParticipant">Attendee with role (CHAIR, MEMBER, OBSERVER).</Field>
              <Field name="MeetingEntry">Ordered entry: SPEECH, VOTE_START, VOTE_RESULT, DECISION, TASK_ASSIGN, SYSTEM.</Field>
              <Field name="MeetingDecision">Vote outcome: APPROVED, REJECTED, or TABLED with vote counts.</Field>
              <Field name="MeetingTask">Links tasks to meetings as action items.</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Governance</h4>
              <Field name="ApprovalPolicy">Per-agent approval configuration with preset (FULL_CONTROL, SUPERVISED, GUIDED, AUTOPILOT).</Field>
              <Field name="ApprovalRequest">Pending action request with category, risk level, status.</Field>
              <Field name="ApprovalComment">Discussion on approval requests.</Field>
              <Field name="AccessRule">Explicit permission grants: READ, WRITE, EXECUTE, ADMIN per resource type.</Field>
              <Field name="AuditLog">Activity log with actor, action (11 types), resource, IP address.</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Platform</h4>
              <Field name="Tool">External integration with type (12 types), auth config.</Field>
              <Field name="Skill">Reusable instruction module. Types: BUILTIN, PLUGIN, CUSTOM.</Field>
              <Field name="Setting">Key-value configuration scoped to organization.</Field>
              <Field name="FileRecord">Uploaded file with metadata, folder, uploader info.</Field>
              <Field name="Folder">Hierarchical folder structure for file organization.</Field>
              <Field name="Plugin">Installable extension module with config and versioning.</Field>
              <Field name="Payment">Stripe payment records.</Field>
              <Field name="Subscription">Stripe subscription with plan, hours, billing period.</Field>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-1">Catalog (Marketplace)</h4>
              <Field name="CatalogAgent">Publishable agent template with tags, tool/skill slugs, download count.</Field>
              <Field name="CatalogSkill">Publishable skill template.</Field>
              <Field name="CatalogTool">Publishable tool template.</Field>
            </div>
          </div>

          <H3>Key Enums</H3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
            <Field name="ActorType">AGENT, HUMAN, SYSTEM</Field>
            <Field name="AgentType">AUTONOMOUS, ASSISTANT, META, REACTIVE, EXTERNAL</Field>
            <Field name="AdapterType">CLAUDE_CODE, CODEX, CURSOR, GEMINI_CLI, OPENCLAW, OPENCODE, PI, HTTP, PROCESS</Field>
            <Field name="AgentStatus">DRAFT, ACTIVE, PAUSED, ERROR, ARCHIVED</Field>
            <Field name="TaskStatus">PENDING, IN_PROGRESS, IN_REVIEW, IN_TESTING, VERIFIED, AWAITING_APPROVAL, COMPLETED, FAILED, BLOCKED, CANCELLED</Field>
            <Field name="GoalStatus">PLANNED, ACTIVE, ACHIEVED, CANCELLED, PAUSED</Field>
            <Field name="ProjectStatus">BACKLOG, PLANNED, IN_PROGRESS, COMPLETED, CANCELLED, ON_HOLD</Field>
            <Field name="LLMProvider">ANTHROPIC, OPENAI, GOOGLE, DEEPSEEK, MISTRAL, OLLAMA, CUSTOM</Field>
            <Field name="ToolType">MCP_SERVER, REST_API, GRAPHQL, DATABASE, WEBHOOK, WEBSOCKET, GRPC, S3_STORAGE, N8N, DIGITALOCEAN, SSH, FIRECRAWL</Field>
            <Field name="Priority">LOW, MEDIUM, HIGH, CRITICAL</Field>
            <Field name="ExecutionStatus">RUNNING, COMPLETED, FAILED, CANCELLED, WAITING_HITL</Field>
            <Field name="TriggerType">TASK, MESSAGE, SCHEDULE, EVENT, MANUAL, MEETING, TELEGRAM, APPROVAL</Field>
          </div>
        </Section>

        {/* Footer */}
        <div className="mt-16 pt-6 border-t border-[var(--border)] text-center text-xs text-[var(--muted)]">
          AGEMS Documentation &middot; AI-Governed Enterprise Management System
        </div>
      </div>
    </div>
  );
}
