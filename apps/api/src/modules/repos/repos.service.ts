import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { encryptJson, decryptJson } from '../../common/crypto.util';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import * as path from 'path';

const REPOS_BASE_DIR = process.env.REPOS_BASE_DIR ?? path.join(process.cwd(), 'data', 'repos');

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);
  private syncProgress = new Map<string, { stage: string; percent: number }>();

  constructor(private prisma: PrismaService) {}

  // ── Helpers ──

  private sanitize(repo: any) {
    if (!repo) return repo;
    return {
      ...repo,
      authConfig: repo.authConfig ? { configured: true } : null,
    };
  }

  private async getRecord(id: string, orgId: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
      include: { agents: { include: { agent: { select: { id: true, name: true, slug: true } } } } },
    });
    if (!repo || repo.orgId !== orgId) throw new NotFoundException('Repository not found');
    return repo;
  }

  private async assertAgentInOrg(agentId: string, orgId: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
    if (!agent) throw new ForbiddenException('Agent not found in this organization');
  }

  private validateSlug(slug: string) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug) || slug.includes('..')) {
      throw new ForbiddenException('Slug must contain only lowercase letters, digits, and hyphens');
    }
  }

  private buildLocalPath(orgId: string, slug: string): string {
    const localPath = path.resolve(path.join(REPOS_BASE_DIR, orgId, slug));
    if (!localPath.startsWith(path.resolve(REPOS_BASE_DIR))) {
      throw new ForbiddenException('Invalid repository path');
    }
    return localPath;
  }

  private parseHttpUrl(gitUrl: string, authType: string): URL {
    try {
      return new URL(gitUrl);
    } catch {
      throw new ForbiddenException(
        `${authType} auth requires an HTTPS git URL (e.g. https://gitlab.com/org/repo.git), but got: ${gitUrl}`,
      );
    }
  }

  private buildCloneCommand(repo: { gitUrl: string; branch: string; authType: string; authConfig: any }, localPath: string, tempKeyPath?: string): { cmd: string; env?: Record<string, string> } {
    const base = `git clone --progress --depth 1 --branch ${repo.branch} --single-branch`;

    const lfsEnv = {
      GIT_LFS_SKIP_SMUDGE: '1',
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'filter.lfs.smudge',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'filter.lfs.process',
      GIT_CONFIG_VALUE_1: '',
      GIT_CONFIG_KEY_2: 'filter.lfs.required',
      GIT_CONFIG_VALUE_2: 'false',
    };

    switch (repo.authType) {
      case 'SSH_KEY': {
        const env = { ...lfsEnv, GIT_SSH_COMMAND: `ssh -i ${tempKeyPath} -o StrictHostKeyChecking=no` };
        return { cmd: `${base} ${repo.gitUrl} ${localPath}`, env };
      }
      case 'TOKEN': {
        const url = this.parseHttpUrl(repo.gitUrl, 'TOKEN');
        url.username = 'oauth2';
        url.password = repo.authConfig.token;
        return { cmd: `${base} ${url.toString()} ${localPath}`, env: lfsEnv };
      }
      case 'BASIC': {
        const url = this.parseHttpUrl(repo.gitUrl, 'BASIC');
        url.username = repo.authConfig.username;
        url.password = repo.authConfig.password;
        return { cmd: `${base} ${url.toString()} ${localPath}`, env: lfsEnv };
      }
      default:
        return { cmd: `${base} ${repo.gitUrl} ${localPath}`, env: lfsEnv };
    }
  }

  private decryptAuthConfig(repo: any): any {
    if (!repo?.authConfig) return null;
    const ac = repo.authConfig as any;
    if (ac._enc) {
      try {
        return decryptJson(ac._enc);
      } catch {
        return null;
      }
    }
    return ac;
  }

  private spawnGit(cmd: string, repoId: string, opts: { timeout: number; env?: Record<string, string>; cwd?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
        cwd: opts.cwd,
      });

      let stderr = '';
      this.syncProgress.set(repoId, { stage: 'Starting', percent: 0 });

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const lines = text.split(/[\r\n]/);
        for (let i = lines.length - 1; i >= 0; i--) {
          const match = lines[i].match(/([\w][\w ]*?):\s+(\d+)%/);
          if (match) {
            this.syncProgress.set(repoId, { stage: match[1].trim(), percent: parseInt(match[2]) });
            break;
          }
        }
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('Git operation timed out'));
      }, opts.timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.syncProgress.delete(repoId);
        if (code === 0) resolve();
        else reject(new Error(stderr.substring(0, 500) || `git exited with code ${code}`));
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.syncProgress.delete(repoId);
        reject(err);
      });
    });
  }

  private applyExcludes(localPath: string, excludes: string) {
    const lines = excludes.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    for (const pattern of lines) {
      if (!/^[a-zA-Z0-9\/._*?\-\[\]]+$/.test(pattern)) {
        this.logger.warn(`Skipping unsafe exclude pattern: ${pattern}`);
        continue;
      }
      if (pattern.includes('..') || pattern.startsWith('/')) {
        this.logger.warn(`Skipping exclude pattern with path traversal: ${pattern}`);
        continue;
      }
      try {
        execSync(`rm -rf ${pattern}`, { cwd: localPath, timeout: 10_000, stdio: 'ignore' });
      } catch (err: any) {
        this.logger.warn(`Exclude pattern failed: ${pattern}: ${err.message}`);
      }
    }
  }

  getProgress(repoId: string) {
    return this.syncProgress.get(repoId) ?? null;
  }

  // ── CRUD ──

  async create(input: any, userId: string, orgId: string) {
    this.validateSlug(input.slug);
    const localPath = this.buildLocalPath(orgId, input.slug);

    const repo = await this.prisma.repository.create({
      data: {
        name: input.name,
        slug: input.slug,
        gitUrl: input.gitUrl,
        branch: input.branch ?? 'main',
        localPath,
        syncSchedule: input.syncSchedule ?? null,
        authType: input.authType ?? 'NONE',
        authConfig: input.authConfig ? { _enc: encryptJson(input.authConfig) } : {},
        excludes: input.excludes ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
        orgId,
      },
    });

    // Clone in background
    this.cloneRepo(repo.id).catch((err) =>
      this.logger.error(`Background clone failed for ${repo.id}: ${err.message}`),
    );

    return this.sanitize(repo);
  }

  async findAll(orgId: string) {
    const repos = await this.prisma.repository.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { agents: true } } },
    });
    return repos.map((r) => this.sanitize(r));
  }

  async findOne(id: string, orgId: string) {
    const repo = await this.getRecord(id, orgId);
    return this.sanitize(repo);
  }

  async update(id: string, input: any, orgId: string) {
    await this.getRecord(id, orgId);
    const allowed = ['name', 'branch', 'gitUrl', 'syncSchedule', 'authType', 'authConfig', 'excludes', 'description', 'metadata'];
    const safeInput: any = {};
    for (const key of allowed) {
      if (key in input) {
        safeInput[key] = key === 'authConfig'
          ? (input[key] ? { _enc: encryptJson(input[key]) } : null)
          : input[key];
      }
    }
    const repo = await this.prisma.repository.update({ where: { id }, data: safeInput });
    return this.sanitize(repo);
  }

  async delete(id: string, orgId: string) {
    const repo = await this.getRecord(id, orgId);
    await this.prisma.repository.delete({ where: { id } });
    if (repo.localPath && existsSync(repo.localPath)) {
      try {
        rmSync(repo.localPath, { recursive: true, force: true });
      } catch (err: any) {
        this.logger.warn(`Failed to remove repo dir ${repo.localPath}: ${err.message}`);
      }
    }
    return { success: true };
  }

  // ── Git operations ──

  async cloneRepo(repoId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Repository not found');

    await this.prisma.repository.update({
      where: { id: repoId },
      data: { syncStatus: 'CLONING' },
    });

    const localPath = repo.localPath ?? this.buildLocalPath(repo.orgId, repo.slug);
    let tempKeyPath: string | undefined;

    try {
      mkdirSync(path.dirname(localPath), { recursive: true });

      // If directory already exists (e.g. failed previous clone), remove it
      if (existsSync(localPath)) {
        rmSync(localPath, { recursive: true, force: true });
      }

      const authConfig = this.decryptAuthConfig(repo);
      const repoWithAuth = { ...repo, authConfig, authType: repo.authType };

      if (repo.authType === 'SSH_KEY' && authConfig?.privateKey) {
        tempKeyPath = `/tmp/repo_key_${repoId}`;
        writeFileSync(tempKeyPath, authConfig.privateKey, { mode: 0o600 });
      }

      const { cmd, env } = this.buildCloneCommand(repoWithAuth, localPath, tempKeyPath);

      await this.spawnGit(cmd, repoId, { timeout: 600_000, env });

      if (repo.excludes) {
        this.applyExcludes(localPath, repo.excludes);
        this.logger.log(`Applied excludes for repo ${repo.slug}`);
      }

      await this.prisma.repository.update({
        where: { id: repoId },
        data: {
          syncStatus: 'SYNCED',
          lastSyncAt: new Date(),
          lastSyncError: null,
          localPath,
        },
      });

      this.logger.log(`Cloned repo ${repo.slug} → ${localPath}`);
    } catch (err: any) {
      await this.prisma.repository.update({
        where: { id: repoId },
        data: {
          syncStatus: 'ERROR',
          lastSyncError: (err.message || String(err)).substring(0, 500),
        },
      });
      this.logger.error(`Clone failed for ${repo.slug}: ${err.message}`);
    } finally {
      if (tempKeyPath && existsSync(tempKeyPath)) {
        try { unlinkSync(tempKeyPath); } catch { /* ignore */ }
      }
    }
  }

  async pullRepo(repoId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Repository not found');
    if (!repo.localPath || !existsSync(repo.localPath)) {
      return this.cloneRepo(repoId);
    }

    await this.prisma.repository.update({
      where: { id: repoId },
      data: { syncStatus: 'SYNCING' },
    });

    let tempKeyPath: string | undefined;

    try {
      const authConfig = this.decryptAuthConfig(repo);
      let env: Record<string, string> | undefined;

      if (repo.authType === 'SSH_KEY' && authConfig?.privateKey) {
        tempKeyPath = `/tmp/repo_key_${repoId}`;
        writeFileSync(tempKeyPath, authConfig.privateKey, { mode: 0o600 });
        env = { GIT_SSH_COMMAND: `ssh -i ${tempKeyPath} -o StrictHostKeyChecking=no` };
      }

      await this.spawnGit('git pull --progress', repoId, {
        timeout: 60_000,
        env,
        cwd: repo.localPath,
      });

      if (repo.excludes) {
        this.applyExcludes(repo.localPath, repo.excludes);
        this.logger.log(`Applied excludes for repo ${repo.slug}`);
      }

      await this.prisma.repository.update({
        where: { id: repoId },
        data: {
          syncStatus: 'SYNCED',
          lastSyncAt: new Date(),
          lastSyncError: null,
        },
      });

      this.logger.log(`Pulled repo ${repo.slug}`);
    } catch (err: any) {
      await this.prisma.repository.update({
        where: { id: repoId },
        data: {
          syncStatus: 'ERROR',
          lastSyncError: (err.message || String(err)).substring(0, 500),
        },
      });
      this.logger.error(`Pull failed for ${repo.slug}: ${err.message}`);
    } finally {
      if (tempKeyPath && existsSync(tempKeyPath)) {
        try { unlinkSync(tempKeyPath); } catch { /* ignore */ }
      }
    }
  }

  async syncRepo(id: string, orgId: string) {
    const repo = await this.getRecord(id, orgId);
    if (repo.syncStatus === 'PENDING' || !repo.localPath || !existsSync(repo.localPath)) {
      this.cloneRepo(repo.id).catch((err) =>
        this.logger.error(`Sync (clone) failed for ${repo.id}: ${err.message}`),
      );
    } else {
      this.pullRepo(repo.id).catch((err) =>
        this.logger.error(`Sync (pull) failed for ${repo.id}: ${err.message}`),
      );
    }
    return { message: 'Sync started' };
  }

  // ── Agent assignments ──

  async assignToAgent(agentId: string, repoId: string, orgId: string) {
    await this.assertAgentInOrg(agentId, orgId);
    await this.getRecord(repoId, orgId);
    return this.prisma.agentRepository.create({
      data: { agentId, repoId },
    });
  }

  async removeFromAgent(agentId: string, repoId: string, orgId: string) {
    await this.assertAgentInOrg(agentId, orgId);
    await this.getRecord(repoId, orgId);
    const ar = await this.prisma.agentRepository.findFirst({ where: { agentId, repoId } });
    if (!ar) throw new NotFoundException('Agent-repository link not found');
    return this.prisma.agentRepository.delete({ where: { id: ar.id } });
  }
}
