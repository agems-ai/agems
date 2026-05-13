/**
 * Company portability — serialize an org snapshot to a markdown
 * directory tree. Inspired by Paperclip's companies.sh export.
 *
 * Why a directory of .md files instead of one big JSON: agents,
 * skills, projects are inherently document-shaped (system prompt =
 * markdown). Diffing two exports in git is meaningful. A README at
 * the root makes the export self-describing.
 *
 * Output shape:
 *
 *   COMPANY.md                  — org metadata + values
 *   README.md                   — human-readable index
 *   manifest.json               — structured manifest (versions, slugs)
 *   agents/<slug>/AGENT.md      — agent system prompt + frontmatter
 *   skills/<slug>/SKILL.md      — skill markdown + frontmatter
 *   tools/<slug>/TOOL.md        — tool description (REST/MCP/DB)
 *   projects/<slug>/PROJECT.md  — project metadata + active goals
 *
 * Secrets are scrubbed via the redact() helper before serialisation.
 * Inline values in `auth` blocks become {type: "secret_ref"} prompts
 * for the importer to fill in.
 *
 * Pure module: takes a plain input object, returns a flat
 * file-path → content map. No I/O. No Prisma. No Nest. Tests inject
 * inputs directly. Caller (controller / CLI script) writes the map
 * to disk or pipes it through zip.
 */
import { redact } from '../../common/redaction';

export interface PortableAgent {
  slug: string;
  name: string;
  description?: string | null;
  systemPrompt: string;
  mission?: string | null;
  llmProvider: string;
  llmModel: string;
  values?: Record<string, unknown> | null;
  toolSlugs?: string[];
  skillSlugs?: string[];
  adapterType?: string | null;
  adapterConfig?: Record<string, unknown> | null;
}

export interface PortableSkill {
  slug: string;
  name: string;
  description: string;
  content: string;
  version: string;
  type: string;
}

export interface PortableTool {
  slug: string;
  name: string;
  description?: string | null;
  type: string;
  configTemplate?: Record<string, unknown>;
  authType?: string | null;
}

export interface PortableProject {
  slug: string;
  name: string;
  description?: string | null;
  status: string;
  priority: string;
  targetDate?: Date | null;
  goalSlugs?: string[];
}

export interface PortableGoal {
  slug: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  parentSlug?: string | null;
  targetDate?: Date | null;
}

export interface PortabilityInput {
  company: {
    name: string;
    slug: string;
    plan?: string;
    description?: string | null;
    values?: Record<string, unknown> | null;
  };
  agents?: PortableAgent[];
  skills?: PortableSkill[];
  tools?: PortableTool[];
  projects?: PortableProject[];
  goals?: PortableGoal[];
  /** ISO timestamp of when the export was taken. Test-injectable. */
  exportedAt?: Date;
}

export interface PortabilityExport {
  /** Flat map of relative path → file content. */
  files: Record<string, string>;
  manifest: PortabilityManifest;
}

export interface PortabilityManifest {
  format: 'agems-company/v1';
  exportedAt: string;
  company: { name: string; slug: string };
  counts: { agents: number; skills: number; tools: number; projects: number; goals: number };
  /** Lists slugs by entity so the importer can verify completeness. */
  slugs: { agents: string[]; skills: string[]; tools: string[]; projects: string[]; goals: string[] };
}

/**
 * Serialise a simple JSON object to a frontmatter block. We don't need
 * a full YAML emitter — frontmatter for our shapes is always scalar
 * key:value plus optional `tags: [a, b]` arrays. Anything deeper goes
 * to manifest.json instead.
 *
 * Returns "---\n<lines>\n---\n" or "" when input is empty.
 */
export function toFrontmatter(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `${k}: ${formatScalar(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function formatScalar(v: unknown): string {
  if (typeof v === 'string') {
    // Quote only when the string contains chars that would confuse a
    // naive YAML reader. We're conservative — quote anything not
    // [A-Za-z0-9-_./].
    return /^[A-Za-z0-9_.\/-]+$/.test(v) ? v : JSON.stringify(v);
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(formatScalar).join(', ')}]`;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** Render the COMPANY.md root file. */
export function renderCompanyMd(input: PortabilityInput): string {
  const c = input.company;
  const fm = toFrontmatter({
    slug: c.slug,
    plan: c.plan,
    exported_at: (input.exportedAt ?? new Date()).toISOString(),
    format: 'agems-company/v1',
  });
  const body: string[] = [`# ${c.name}\n`];
  if (c.description) body.push(c.description, '');
  if (c.values && Object.keys(c.values).length > 0) {
    body.push('## Values\n');
    body.push('```json');
    body.push(JSON.stringify(redact(c.values), null, 2));
    body.push('```');
  }
  return fm + body.join('\n');
}

export function renderAgentMd(agent: PortableAgent): string {
  const fm = toFrontmatter({
    slug: agent.slug,
    name: agent.name,
    llm_provider: agent.llmProvider,
    llm_model: agent.llmModel,
    adapter: agent.adapterType ?? undefined,
    tools: agent.toolSlugs && agent.toolSlugs.length > 0 ? agent.toolSlugs : undefined,
    skills: agent.skillSlugs && agent.skillSlugs.length > 0 ? agent.skillSlugs : undefined,
  });
  const body: string[] = [`# ${agent.name}\n`];
  if (agent.description) body.push(agent.description, '');
  if (agent.mission) body.push('## Mission\n', agent.mission, '');
  body.push('## System Prompt\n', agent.systemPrompt);
  if (agent.adapterConfig) {
    body.push('\n## Adapter Config\n', '```json', JSON.stringify(redact(agent.adapterConfig), null, 2), '```');
  }
  return fm + body.join('\n');
}

export function renderSkillMd(skill: PortableSkill): string {
  const fm = toFrontmatter({
    slug: skill.slug,
    name: skill.name,
    version: skill.version,
    type: skill.type,
    description: skill.description,
  });
  return fm + skill.content;
}

export function renderToolMd(tool: PortableTool): string {
  const fm = toFrontmatter({
    slug: tool.slug,
    name: tool.name,
    type: tool.type,
    auth: tool.authType ?? undefined,
  });
  const body: string[] = [`# ${tool.name}\n`];
  if (tool.description) body.push(tool.description, '');
  if (tool.configTemplate) {
    body.push('## Config Template\n', '```json', JSON.stringify(redact(tool.configTemplate), null, 2), '```');
  }
  return fm + body.join('\n');
}

export function renderProjectMd(project: PortableProject): string {
  const fm = toFrontmatter({
    slug: project.slug,
    status: project.status,
    priority: project.priority,
    target_date: project.targetDate,
    goals: project.goalSlugs,
  });
  const body = [`# ${project.name}\n`];
  if (project.description) body.push(project.description);
  return fm + body.join('\n');
}

export function renderReadmeMd(input: PortabilityInput): string {
  const c = input.company;
  const counts = entityCounts(input);
  return [
    `# ${c.name} — AGEMS export`,
    '',
    `This directory is a portable snapshot of the **${c.name}** organisation, exported from AGEMS.`,
    '',
    `## Contents`,
    '',
    `- ${counts.agents} agents`,
    `- ${counts.skills} skills`,
    `- ${counts.tools} tools`,
    `- ${counts.projects} projects`,
    `- ${counts.goals} goals`,
    '',
    `## Format`,
    '',
    'Each entity lives in its own subdirectory with a markdown file + YAML frontmatter.',
    'Secrets are scrubbed — `auth` blocks become `{type: "secret_ref"}` prompts the importer fills in.',
    '',
    `## Importing`,
    '',
    '```bash',
    'pnpm agems import ./',
    '```',
    '',
  ].join('\n');
}

function entityCounts(input: PortabilityInput): PortabilityManifest['counts'] {
  return {
    agents: input.agents?.length ?? 0,
    skills: input.skills?.length ?? 0,
    tools: input.tools?.length ?? 0,
    projects: input.projects?.length ?? 0,
    goals: input.goals?.length ?? 0,
  };
}

function entitySlugs(input: PortabilityInput): PortabilityManifest['slugs'] {
  return {
    agents:   (input.agents   ?? []).map(a => a.slug),
    skills:   (input.skills   ?? []).map(s => s.slug),
    tools:    (input.tools    ?? []).map(t => t.slug),
    projects: (input.projects ?? []).map(p => p.slug),
    goals:    (input.goals    ?? []).map(g => g.slug),
  };
}

/**
 * Build the full export bundle. Returns a flat path → content map plus
 * a structured manifest. The caller writes to disk / zips / streams.
 */
export function serializeCompany(input: PortabilityInput): PortabilityExport {
  const exportedAt = input.exportedAt ?? new Date();
  const files: Record<string, string> = {};

  files['README.md']   = renderReadmeMd(input);
  files['COMPANY.md']  = renderCompanyMd({ ...input, exportedAt });

  for (const a of input.agents ?? []) {
    files[`agents/${a.slug}/AGENT.md`] = renderAgentMd(a);
  }
  for (const s of input.skills ?? []) {
    files[`skills/${s.slug}/SKILL.md`] = renderSkillMd(s);
  }
  for (const t of input.tools ?? []) {
    files[`tools/${t.slug}/TOOL.md`] = renderToolMd(t);
  }
  for (const p of input.projects ?? []) {
    files[`projects/${p.slug}/PROJECT.md`] = renderProjectMd(p);
  }

  // Goals are flat (one file each) — they're cheap and tree structure is
  // encoded via `parent_slug` in frontmatter.
  for (const g of input.goals ?? []) {
    const fm = toFrontmatter({
      slug: g.slug,
      title: g.title,
      status: g.status,
      priority: g.priority,
      parent: g.parentSlug ?? undefined,
      target_date: g.targetDate,
    });
    const body = g.description ? `\n${g.description}\n` : '';
    files[`goals/${g.slug}.md`] = fm + body;
  }

  const manifest: PortabilityManifest = {
    format: 'agems-company/v1',
    exportedAt: exportedAt.toISOString(),
    company: { name: input.company.name, slug: input.company.slug },
    counts: entityCounts(input),
    slugs: entitySlugs(input),
  };
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';

  return { files, manifest };
}
