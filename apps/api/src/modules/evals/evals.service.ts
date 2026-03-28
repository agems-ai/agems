import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

interface TestCase {
  input: string;
  expectedOutput: string;
}

interface EvalResult {
  input: string;
  output: string;
  expected: string;
  passed: boolean;
  score: number;
}

interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  avgScore: number;
}

@Injectable()
export class EvalsService {
  private readonly logger = new Logger(EvalsService.name);

  constructor(private prisma: PrismaService) {}

  async runEval(
    orgId: string,
    agentId: string,
    testCases: TestCase[],
    modelOverride?: string,
  ): Promise<{ results: EvalResult[]; summary: EvalSummary }> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, orgId },
    });
    if (!agent) throw new NotFoundException('Agent not found');

    const model = modelOverride || agent.llmModel;
    const provider = agent.llmProvider;
    const systemPrompt = agent.systemPrompt;

    const results: EvalResult[] = [];

    for (const testCase of testCases) {
      const output = await this.callLLM(provider, model, systemPrompt, testCase.input, agent.llmConfig as any);
      const { passed, score } = this.scoreOutput(output, testCase.expectedOutput);
      results.push({
        input: testCase.input,
        output,
        expected: testCase.expectedOutput,
        passed,
        score,
      });
    }

    const summary = this.buildSummary(results);

    // Store as AgentMetric with type QUALITY
    const now = new Date();
    await this.prisma.agentMetric.create({
      data: {
        agentId,
        metricType: 'QUALITY',
        value: summary.avgScore,
        periodStart: now,
        periodEnd: now,
        metadata: {
          evalType: 'promptfoo',
          model,
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          results: results.map(r => ({
            input: r.input,
            passed: r.passed,
            score: r.score,
          })),
        },
      },
    });

    return { results, summary };
  }

  async getHistory(orgId: string, agentId?: string, limit: number = 50) {
    const where: any = { metricType: 'QUALITY' };

    if (agentId) {
      const agent = await this.prisma.agent.findFirst({ where: { id: agentId, orgId } });
      if (!agent) throw new NotFoundException('Agent not found');
      where.agentId = agentId;
    } else {
      // Filter to agents in this org
      const agentIds = await this.prisma.agent.findMany({
        where: { orgId },
        select: { id: true },
      });
      where.agentId = { in: agentIds.map(a => a.id) };
    }

    return this.prisma.agentMetric.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: limit,
      include: { agent: { select: { id: true, name: true, llmModel: true } } },
    });
  }

  async compareAgents(
    orgId: string,
    agentIdA: string,
    agentIdB: string,
    testCases: TestCase[],
    modelOverride?: string,
  ) {
    const [resultA, resultB] = await Promise.all([
      this.runEval(orgId, agentIdA, testCases, modelOverride),
      this.runEval(orgId, agentIdB, testCases, modelOverride),
    ]);

    const agentA = await this.prisma.agent.findFirst({ where: { id: agentIdA, orgId }, select: { id: true, name: true, llmModel: true } });
    const agentB = await this.prisma.agent.findFirst({ where: { id: agentIdB, orgId }, select: { id: true, name: true, llmModel: true } });

    return {
      agentA: { ...agentA, ...resultA },
      agentB: { ...agentB, ...resultB },
      winner: resultA.summary.avgScore >= resultB.summary.avgScore ? 'A' : 'B',
      scoreDiff: Math.abs(resultA.summary.avgScore - resultB.summary.avgScore),
    };
  }

  // ── Private helpers ──

  private scoreOutput(output: string, expected: string): { passed: boolean; score: number } {
    const normalizedOutput = output.trim().toLowerCase();
    const normalizedExpected = expected.trim().toLowerCase();

    // Exact match
    if (normalizedOutput === normalizedExpected) {
      return { passed: true, score: 1.0 };
    }

    // Contains check
    if (normalizedOutput.includes(normalizedExpected) || normalizedExpected.includes(normalizedOutput)) {
      return { passed: true, score: 0.8 };
    }

    // Word overlap scoring
    const outputWords = new Set(normalizedOutput.split(/\s+/));
    const expectedWords = new Set(normalizedExpected.split(/\s+/));
    let overlap = 0;
    for (const word of expectedWords) {
      if (outputWords.has(word)) overlap++;
    }
    const score = expectedWords.size > 0 ? overlap / expectedWords.size : 0;
    const passed = score >= 0.5;

    return { passed, score: Math.round(score * 100) / 100 };
  }

  private buildSummary(results: EvalResult[]): EvalSummary {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    const avgScore = total > 0
      ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / total) * 100) / 100
      : 0;
    return { total, passed, failed, avgScore };
  }

  private async callLLM(
    provider: string,
    model: string,
    systemPrompt: string,
    userInput: string,
    llmConfig: any,
  ): Promise<string> {
    try {
      switch (provider) {
        case 'OPENAI':
          return await this.callOpenAI(model, systemPrompt, userInput, llmConfig);
        case 'ANTHROPIC':
          return await this.callAnthropic(model, systemPrompt, userInput, llmConfig);
        case 'GOOGLE':
          return await this.callGoogle(model, systemPrompt, userInput, llmConfig);
        default:
          return await this.callOpenAI(model, systemPrompt, userInput, llmConfig);
      }
    } catch (error) {
      this.logger.error(`LLM call failed: ${error.message}`);
      return `[ERROR] ${error.message}`;
    }
  }

  private async callOpenAI(model: string, systemPrompt: string, userInput: string, config: any): Promise<string> {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput },
        ],
        temperature: config?.temperature ?? 0,
        max_tokens: config?.maxTokens ?? 2000,
      }),
    });

    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI request failed');
    return data.choices?.[0]?.message?.content || '';
  }

  private async callAnthropic(model: string, systemPrompt: string, userInput: string, config: any): Promise<string> {
    const apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userInput }],
        temperature: config?.temperature ?? 0,
        max_tokens: config?.maxTokens ?? 2000,
      }),
    });

    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error?.message || 'Anthropic request failed');
    return data.content?.[0]?.text || '';
  }

  private async callGoogle(model: string, systemPrompt: string, userInput: string, config: any): Promise<string> {
    const apiKey = config?.apiKey || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('Google AI API key not configured');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userInput }] }],
          generationConfig: {
            temperature: config?.temperature ?? 0,
            maxOutputTokens: config?.maxTokens ?? 2000,
          },
        }),
      },
    );

    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error?.message || 'Google AI request failed');
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}
