/**
 * Unit tests for company portability export.
 *
 * If these break, exports either leak secrets or are unimportable.
 * The format key in manifest.json is a contract — bumping it is a
 * breaking change the importer must handle.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toFrontmatter,
  renderCompanyMd,
  renderAgentMd,
  renderSkillMd,
  serializeCompany,
} from './portability';

const exportedAt = new Date('2026-05-13T10:00:00.000Z');

// ── toFrontmatter ────────────────────────────────────────────────

describe('toFrontmatter', () => {
  it('returns empty string when no entries', () => {
    assert.equal(toFrontmatter({}), '');
  });

  it('skips null and undefined entries', () => {
    const fm = toFrontmatter({ a: 'x', b: null, c: undefined });
    assert.equal(fm.includes('a: x'), true);
    assert.equal(fm.includes('b:'), false);
    assert.equal(fm.includes('c:'), false);
  });

  it('emits scalar values unquoted when they fit the safe-char set', () => {
    const fm = toFrontmatter({ slug: 'my-agent', version: '1.0.0' });
    assert.match(fm, /slug: my-agent/);
    assert.match(fm, /version: 1\.0\.0/);
  });

  it('quotes strings containing whitespace or punctuation', () => {
    const fm = toFrontmatter({ name: 'Hello, World!' });
    assert.match(fm, /name: "Hello, World!"/);
  });

  it('emits arrays in flow form', () => {
    const fm = toFrontmatter({ tools: ['a', 'b', 'c'] });
    assert.match(fm, /tools: \[a, b, c\]/);
  });

  it('emits Date as ISO 8601', () => {
    const fm = toFrontmatter({ created: new Date('2026-05-13T10:00:00.000Z') });
    assert.match(fm, /created: 2026-05-13T10:00:00\.000Z/);
  });

  it('wraps output in --- delimiters', () => {
    const fm = toFrontmatter({ a: 'x' });
    assert.equal(fm.startsWith('---\n'), true);
    assert.equal(fm.endsWith('---\n'), true);
  });
});

// ── renderCompanyMd ──────────────────────────────────────────────

describe('renderCompanyMd', () => {
  it('emits frontmatter with slug + format', () => {
    const md = renderCompanyMd({
      company: { name: 'Survive', slug: 'survive', plan: 'PRO' },
      exportedAt,
    });
    assert.match(md, /slug: survive/);
    assert.match(md, /plan: PRO/);
    assert.match(md, /format: agems-company\/v1/);
  });

  it('embeds redacted values block', () => {
    const md = renderCompanyMd({
      company: {
        name: 'X', slug: 'x',
        values: { mission: 'public', apiKey: 'sk-leaked' },
      },
      exportedAt,
    });
    assert.equal(md.includes('sk-leaked'), false, 'apiKey value must be redacted');
    assert.match(md, /\[REDACTED\]/);
  });
});

// ── renderAgentMd ────────────────────────────────────────────────

describe('renderAgentMd', () => {
  it('emits agent frontmatter with provider/model/tools/skills', () => {
    const md = renderAgentMd({
      slug: 'sophia', name: 'Sophia',
      systemPrompt: 'You are a CMO.',
      llmProvider: 'ANTHROPIC', llmModel: 'claude-sonnet-4-6',
      toolSlugs: ['meta-ads', 'analytics'],
      skillSlugs: ['copywriting'],
    });
    assert.match(md, /slug: sophia/);
    assert.match(md, /llm_provider: ANTHROPIC/);
    assert.match(md, /tools: \[meta-ads, analytics\]/);
    assert.match(md, /skills: \[copywriting\]/);
    assert.ok(md.includes('You are a CMO.'));
  });

  it('omits adapter fields when not present (clean frontmatter)', () => {
    const md = renderAgentMd({
      slug: 'a', name: 'A', systemPrompt: 'p',
      llmProvider: 'OPENAI', llmModel: 'gpt-4o',
    });
    assert.equal(md.includes('adapter:'), false);
    assert.equal(md.includes('tools:'), false);
  });

  it('redacts adapterConfig containing secrets', () => {
    const md = renderAgentMd({
      slug: 'a', name: 'A', systemPrompt: 'p',
      llmProvider: 'OPENAI', llmModel: 'gpt-4o',
      adapterType: 'CLAUDE_CODE',
      adapterConfig: { apiKey: 'sk-leaked', workdir: '/repos/x' },
    });
    assert.equal(md.includes('sk-leaked'), false);
    assert.match(md, /\[REDACTED\]/);
    assert.ok(md.includes('/repos/x'));
  });
});

// ── renderSkillMd ────────────────────────────────────────────────

describe('renderSkillMd', () => {
  it('preserves skill body verbatim (it IS the content)', () => {
    const body = '## Steps\n\n1. Do A\n2. Do B\n';
    const md = renderSkillMd({
      slug: 'gh-issues', name: 'GH Issues', description: 'd',
      version: '1.0.0', type: 'CUSTOM', content: body,
    });
    assert.ok(md.includes(body));
  });
});

// ── serializeCompany ─────────────────────────────────────────────

describe('serializeCompany', () => {
  it('produces COMPANY.md, README.md, manifest.json at root', () => {
    const out = serializeCompany({
      company: { name: 'Survive', slug: 'survive' },
      exportedAt,
    });
    assert.ok(out.files['README.md']);
    assert.ok(out.files['COMPANY.md']);
    assert.ok(out.files['manifest.json']);
  });

  it('places each agent under agents/<slug>/AGENT.md', () => {
    const out = serializeCompany({
      company: { name: 'X', slug: 'x' },
      agents: [
        { slug: 'a1', name: 'A1', systemPrompt: 'p1', llmProvider: 'OPENAI', llmModel: 'gpt-4o' },
        { slug: 'a2', name: 'A2', systemPrompt: 'p2', llmProvider: 'OPENAI', llmModel: 'gpt-4o' },
      ],
    });
    assert.ok(out.files['agents/a1/AGENT.md']);
    assert.ok(out.files['agents/a2/AGENT.md']);
  });

  it('places each skill / tool / project under its own subdir', () => {
    const out = serializeCompany({
      company: { name: 'X', slug: 'x' },
      skills: [{ slug: 's1', name: 'S1', description: 'd', content: 'c', version: '1', type: 'CUSTOM' }],
      tools: [{ slug: 't1', name: 'T1', type: 'REST_API' }],
      projects: [{ slug: 'p1', name: 'P1', status: 'ACTIVE', priority: 'HIGH' }],
    });
    assert.ok(out.files['skills/s1/SKILL.md']);
    assert.ok(out.files['tools/t1/TOOL.md']);
    assert.ok(out.files['projects/p1/PROJECT.md']);
  });

  it('places goals flat under goals/<slug>.md (no subdir)', () => {
    const out = serializeCompany({
      company: { name: 'X', slug: 'x' },
      goals: [{ slug: 'g1', title: 'G1', status: 'ACTIVE', priority: 'HIGH' }],
    });
    assert.ok(out.files['goals/g1.md']);
  });

  it('manifest counts match file map', () => {
    const out = serializeCompany({
      company: { name: 'X', slug: 'x' },
      agents:   [{ slug: 'a', name: 'A', systemPrompt: 'p', llmProvider: 'OPENAI', llmModel: 'gpt-4o' }],
      skills:   [{ slug: 's', name: 'S', description: 'd', content: 'c', version: '1', type: 'CUSTOM' }],
      tools:    [{ slug: 't', name: 'T', type: 'REST_API' }],
      projects: [{ slug: 'p', name: 'P', status: 'ACTIVE', priority: 'HIGH' }],
      goals:    [{ slug: 'g', title: 'G', status: 'ACTIVE', priority: 'HIGH' }],
    });
    assert.equal(out.manifest.counts.agents, 1);
    assert.equal(out.manifest.counts.skills, 1);
    assert.equal(out.manifest.counts.tools, 1);
    assert.equal(out.manifest.counts.projects, 1);
    assert.equal(out.manifest.counts.goals, 1);
  });

  it('manifest slugs list every entity for importer verification', () => {
    const out = serializeCompany({
      company: { name: 'X', slug: 'x' },
      agents: [
        { slug: 'a1', name: 'A1', systemPrompt: 'p', llmProvider: 'OPENAI', llmModel: 'gpt-4o' },
        { slug: 'a2', name: 'A2', systemPrompt: 'p', llmProvider: 'OPENAI', llmModel: 'gpt-4o' },
      ],
    });
    assert.deepEqual(out.manifest.slugs.agents.sort(), ['a1', 'a2']);
  });

  it('format tag is "agems-company/v1" — bumping this is a breaking change', () => {
    const out = serializeCompany({ company: { name: 'X', slug: 'x' } });
    assert.equal(out.manifest.format, 'agems-company/v1');
  });

  it('exportedAt is propagated to manifest', () => {
    const out = serializeCompany({ company: { name: 'X', slug: 'x' }, exportedAt });
    assert.equal(out.manifest.exportedAt, exportedAt.toISOString());
  });
});

// ── secret scrubbing in nested adapter configs ───────────────────

describe('serializeCompany — no secrets leak', () => {
  it('redacts secrets in adapterConfig across nested agents', () => {
    const out = serializeCompany({
      company: { name: 'X', slug: 'x' },
      agents: [{
        slug: 'a', name: 'A', systemPrompt: 'p', llmProvider: 'OPENAI', llmModel: 'gpt-4o',
        adapterType: 'HTTP',
        adapterConfig: { url: 'https://x.com/hook', auth: { type: 'bearer', token: 'sk-leaked-xxx' } },
      }],
    });
    const agentFile = out.files['agents/a/AGENT.md'];
    assert.equal(agentFile.includes('sk-leaked-xxx'), false, 'token must be scrubbed');
    assert.ok(agentFile.includes('https://x.com/hook'), 'non-sensitive url preserved');
  });
});
