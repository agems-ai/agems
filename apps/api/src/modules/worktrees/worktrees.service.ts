import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

interface WorktreeEntry {
  id: string;
  orgId: string;
  agentId: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  createdAt: string;
}

@Injectable()
export class WorktreesService {
  private readonly logger = new Logger(WorktreesService.name);
  private readonly worktrees = new Map<string, WorktreeEntry>();
  private readonly storePath = path.join(process.cwd(), '.worktrees.json');

  constructor() {
    this.loadFromDisk();
  }

  async create(orgId: string, agentId: string, repoPath: string, branchName?: string): Promise<WorktreeEntry> {
    // Validate repo path exists and is a git repo
    if (!fs.existsSync(repoPath)) {
      throw new BadRequestException(`Repository path does not exist: ${repoPath}`);
    }

    try {
      await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--git-dir']);
    } catch {
      throw new BadRequestException(`Path is not a git repository: ${repoPath}`);
    }

    const id = crypto.randomUUID();
    const branch = branchName || `agent/${agentId}/${Date.now().toString(36)}`;
    const worktreePath = path.join(repoPath, '..', `.worktrees`, `${agentId}-${id.slice(0, 8)}`);

    try {
      // Create the worktree with a new branch
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, '-b', branch]);
    } catch (error) {
      throw new BadRequestException(`Failed to create worktree: ${error.message}`);
    }

    const entry: WorktreeEntry = {
      id,
      orgId,
      agentId,
      repoPath,
      worktreePath,
      branchName: branch,
      createdAt: new Date().toISOString(),
    };

    this.worktrees.set(id, entry);
    this.saveToDisk();
    this.logger.log(`Created worktree ${id} at ${worktreePath} on branch ${branch}`);

    return entry;
  }

  findAll(orgId: string): WorktreeEntry[] {
    return Array.from(this.worktrees.values()).filter(w => w.orgId === orgId);
  }

  findOne(orgId: string, id: string): WorktreeEntry {
    const entry = this.worktrees.get(id);
    if (!entry || entry.orgId !== orgId) {
      throw new NotFoundException('Worktree not found');
    }
    return entry;
  }

  async remove(orgId: string, id: string): Promise<{ message: string }> {
    const entry = this.worktrees.get(id);
    if (!entry || entry.orgId !== orgId) {
      throw new NotFoundException('Worktree not found');
    }

    try {
      await execFileAsync('git', ['-C', entry.repoPath, 'worktree', 'remove', entry.worktreePath, '--force']);
    } catch (error) {
      this.logger.warn(`Failed to git-remove worktree, cleaning up manually: ${error.message}`);
      // Try manual cleanup if git worktree remove fails
      if (fs.existsSync(entry.worktreePath)) {
        fs.rmSync(entry.worktreePath, { recursive: true, force: true });
      }
      // Prune stale worktree references
      try {
        await execFileAsync('git', ['-C', entry.repoPath, 'worktree', 'prune']);
      } catch {
        // Ignore prune errors
      }
    }

    // Optionally delete the branch
    try {
      await execFileAsync('git', ['-C', entry.repoPath, 'branch', '-D', entry.branchName]);
    } catch {
      // Branch may have been merged or deleted already
    }

    this.worktrees.delete(id);
    this.saveToDisk();
    this.logger.log(`Removed worktree ${id} at ${entry.worktreePath}`);

    return { message: `Worktree ${id} removed successfully` };
  }

  // ── Persistence helpers (JSON file, not DB) ──

  private saveToDisk(): void {
    try {
      const data = Object.fromEntries(this.worktrees);
      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.warn(`Failed to save worktrees to disk: ${error.message}`);
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const data = JSON.parse(raw);
        for (const [key, value] of Object.entries(data)) {
          this.worktrees.set(key, value as WorktreeEntry);
        }
        this.logger.log(`Loaded ${this.worktrees.size} worktrees from disk`);
      }
    } catch (error) {
      this.logger.warn(`Failed to load worktrees from disk: ${error.message}`);
    }
  }
}
