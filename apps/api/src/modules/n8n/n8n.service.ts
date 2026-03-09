import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);

  constructor(private settings: SettingsService) {}

  /** Get n8n credentials from settings (or override) */
  async getCredentials(override?: { url?: string; key?: string }, orgId?: string) {
    const url = override?.url || (await this.settings.get('n8n_api_url', orgId)) || '';
    const key = override?.key || (await this.settings.get('n8n_api_key', orgId)) || '';
    return { url, key };
  }

  async testConnection(url?: string, key?: string, orgId?: string) {
    const creds = await this.getCredentials({ url, key }, orgId);
    if (!creds.url || !creds.key) return { ok: false, error: 'N8N URL or API key not configured' };

    try {
      const res = await this.request('GET', '/workflows', creds.url, creds.key, { limit: 1 });
      return { ok: true, workflowCount: res.data?.length ?? 0 };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async listWorkflows(orgIdOrOverride?: string | { url: string; key: string }, filters?: { active?: boolean; limit?: number }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    const params: Record<string, unknown> = { limit: filters?.limit ?? 100 };
    if (filters?.active !== undefined) params.active = filters.active;
    return this.request('GET', '/workflows', creds.url, creds.key, params);
  }

  async getWorkflow(id: string, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('GET', `/workflows/${id}`, creds.url, creds.key);
  }

  async createWorkflow(data: { name: string; nodes?: any[]; connections?: any; settings?: any }, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('POST', '/workflows', creds.url, creds.key, undefined, {
      name: data.name,
      nodes: data.nodes ?? [],
      connections: data.connections ?? {},
      settings: data.settings ?? { executionOrder: 'v1' },
    });
  }

  async updateWorkflow(id: string, data: { name: string; nodes: any[]; connections: any; settings?: any; staticData?: any }, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('PUT', `/workflows/${id}`, creds.url, creds.key, undefined, {
      name: data.name,
      nodes: data.nodes,
      connections: data.connections,
      settings: data.settings ?? {},
      staticData: data.staticData ?? null,
    });
  }

  async deleteWorkflow(id: string, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('DELETE', `/workflows/${id}`, creds.url, creds.key);
  }

  async activateWorkflow(id: string, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('POST', `/workflows/${id}/activate`, creds.url, creds.key);
  }

  async deactivateWorkflow(id: string, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('POST', `/workflows/${id}/deactivate`, creds.url, creds.key);
  }

  async executeWorkflow(id: string, data?: any, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    return this.request('POST', `/workflows/${id}/execute`, creds.url, creds.key, undefined, data);
  }

  async getExecutions(filters?: { workflowId?: string; status?: string; limit?: number }, orgIdOrOverride?: string | { url: string; key: string }) {
    const creds = await this.resolveCreds(orgIdOrOverride);
    const params: Record<string, unknown> = { limit: filters?.limit ?? 20 };
    if (filters?.workflowId) params.workflowId = filters.workflowId;
    if (filters?.status) params.status = filters.status;
    return this.request('GET', '/executions', creds.url, creds.key, params);
  }

  /** Resolve credentials from orgId string or direct {url, key} override */
  private async resolveCreds(orgIdOrOverride?: string | { url: string; key: string }) {
    if (typeof orgIdOrOverride === 'object' && orgIdOrOverride) {
      return orgIdOrOverride;
    }
    return this.getCredentials(undefined, orgIdOrOverride);
  }

  /** Generic n8n API request */
  private async request(
    method: string,
    endpoint: string,
    baseUrl: string,
    apiKey: string,
    queryParams?: Record<string, unknown>,
    body?: unknown,
  ) {
    if (!baseUrl || !apiKey) throw new Error('N8N not configured');

    const url = new URL(`/api/v1${endpoint}`, baseUrl);
    if (queryParams) {
      Object.entries(queryParams).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }

    const options: RequestInit = {
      method,
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
    };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`n8n API ${response.status}: ${text || response.statusText}`);
    }

    if (response.status === 204) return { ok: true };
    return response.json();
  }
}
