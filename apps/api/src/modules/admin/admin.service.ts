import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

interface GitHubRepoStats {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  contributors: number;
  language: string;
  topics: string[];
  createdAt: string;
  updatedAt: string;
  size: number;
}

interface GitHubAchievement {
  name: string;
  description: string;
  icon: string;
  tier: string | null;
  requirement: string;
  progress: number;
  maxProgress: number;
  unlocked: boolean;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly GITHUB_REPO = 'agems-ai/agems';

  constructor(private prisma: PrismaService) {}

  async isGlobalAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === 'ADMIN';
  }

  async getStats() {
    const [
      totalOrgs,
      enterpriseOrgs,
      proOrgs,
      freeOrgs,
      totalUsers,
      totalAgents,
      recentOrgs,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { plan: 'ENTERPRISE' } }),
      this.prisma.organization.count({ where: { plan: 'PRO' } }),
      this.prisma.organization.count({ where: { plan: 'FREE' } }),
      this.prisma.user.count(),
      this.prisma.agent.count(),
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          createdAt: true,
          metadata: true,
          _count: { select: { members: true, agents: true } },
        },
      }),
    ]);

    return {
      companies: {
        total: totalOrgs,
        enterprise: enterpriseOrgs,
        pro: proOrgs,
        free: freeOrgs,
      },
      users: totalUsers,
      agents: totalAgents,
      recentOrgs,
    };
  }

  async getGitHubStats(): Promise<GitHubRepoStats | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${this.GITHUB_REPO}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (!res.ok) return null;
      const data = await res.json();

      // Get contributor count
      let contributors = 0;
      try {
        const contribRes = await fetch(`https://api.github.com/repos/${this.GITHUB_REPO}/contributors?per_page=1`, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
        });
        // Parse Link header for total count
        const linkHeader = contribRes.headers.get('link');
        if (linkHeader) {
          const match = linkHeader.match(/page=(\d+)>; rel="last"/);
          contributors = match ? parseInt(match[1]) : 1;
        } else {
          const contribData = await contribRes.json();
          contributors = Array.isArray(contribData) ? contribData.length : 0;
        }
      } catch {
        contributors = 0;
      }

      return {
        stars: data.stargazers_count || 0,
        forks: data.forks_count || 0,
        watchers: data.subscribers_count || 0,
        openIssues: data.open_issues_count || 0,
        contributors,
        language: data.language || 'TypeScript',
        topics: data.topics || [],
        createdAt: data.created_at,
        updatedAt: data.pushed_at,
        size: data.size || 0,
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch GitHub stats: ${err}`);
      return null;
    }
  }

  getGitHubAchievements(stats: GitHubRepoStats | null): GitHubAchievement[] {
    const stars = stats?.stars || 0;
    const forks = stats?.forks || 0;
    const contributors = stats?.contributors || 0;

    return [
      {
        name: 'Starstruck',
        description: 'Repository gets stars from the community',
        icon: '⭐',
        tier: stars >= 4096 ? 'Gold' : stars >= 512 ? 'Silver' : stars >= 128 ? 'Bronze' : stars >= 16 ? 'Default' : null,
        requirement: 'Next: ' + (stars < 16 ? '16 stars' : stars < 128 ? '128 stars' : stars < 512 ? '512 stars' : stars < 4096 ? '4,096 stars' : 'Max tier!'),
        progress: stars,
        maxProgress: stars < 16 ? 16 : stars < 128 ? 128 : stars < 512 ? 512 : 4096,
        unlocked: stars >= 16,
      },
      {
        name: 'Pull Shark',
        description: 'Merged pull requests',
        icon: '🦈',
        tier: null,
        requirement: '2 merged PRs for Default, 16 for Bronze, 128 for Gold',
        progress: 0,
        maxProgress: 2,
        unlocked: false,
      },
      {
        name: 'Galaxy Brain',
        description: 'Accepted answers in Discussions',
        icon: '🧠',
        tier: null,
        requirement: 'Enable Discussions, get 2 accepted answers',
        progress: 0,
        maxProgress: 2,
        unlocked: false,
      },
      {
        name: 'YOLO',
        description: 'Merged own PR without code review',
        icon: '🤠',
        tier: null,
        requirement: 'Merge 1 PR without review',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
      {
        name: 'Quickdraw',
        description: 'Closed an issue or PR within 5 minutes of opening',
        icon: '🔫',
        tier: null,
        requirement: 'Close issue/PR within 5 min',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
      {
        name: 'Pair Extraordinaire',
        description: 'Co-authored merged pull requests',
        icon: '👯',
        tier: null,
        requirement: '1 co-authored PR for Default, 10 for Bronze',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
      {
        name: 'Open Sourcerer',
        description: 'Merged PRs in multiple public repos',
        icon: '🧙',
        tier: null,
        requirement: 'Merge PRs in multiple public repos',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
      {
        name: 'GitHub Sponsor',
        description: 'Sponsored an open-source developer or project',
        icon: '💖',
        tier: null,
        requirement: 'Set up GitHub Sponsors and get a sponsor',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
      {
        name: 'Arctic Code Vault',
        description: 'Contributed to repos archived in GitHub Arctic Code Vault',
        icon: '🏔️',
        tier: null,
        requirement: 'Retired — was for 2020 Arctic Code Vault program',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
      {
        name: 'Mars 2020 Helicopter',
        description: 'Contributed to repos used in Mars 2020 mission',
        icon: '🚁',
        tier: null,
        requirement: 'Retired — was for Mars 2020 Helicopter repos',
        progress: 0,
        maxProgress: 1,
        unlocked: false,
      },
    ];
  }
}
