import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../config/prisma.service';
import { DemoSeedService } from '../bootstrap/demo-seed.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private demoSeed: DemoSeedService,
  ) {}

  async register(email: string, password: string, name: string, orgName?: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    if (password.length > 128) {
      throw new BadRequestException('Password must be at most 128 characters');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });

    const result = await this.prisma.$transaction(async (tx) => {
      // Reuse existing user or create new one
      let user: any;
      if (existing) {
        // Verify password for existing user
        const valid = await bcrypt.compare(password, existing.passwordHash);
        if (!valid) throw new UnauthorizedException('Invalid credentials for existing account');
        user = existing;
      } else {
        const passwordHash = await bcrypt.hash(password, 10);
        user = await tx.user.create({
          data: { email, passwordHash, name, role: 'ADMIN' },
        });
      }

      const slug = (orgName || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const org = await tx.organization.create({
        data: {
          name: orgName || `${name}'s Organization`,
          slug: `${slug}-${user.id.slice(0, 8)}-${Date.now().toString(36)}`,
          plan: 'FREE',
        },
      });

      await tx.orgMember.create({
        data: { orgId: org.id, userId: user.id, role: 'ADMIN' },
      });

      // Auto-create root OrgPosition for the org creator
      await tx.orgPosition.create({
        data: {
          orgId: org.id,
          title: user.name || name,
          holderType: 'HUMAN',
          userId: user.id,
        },
      });

      return { user, org };
    });

    const { user, org } = result;
    const token = this.jwt.sign({
      sub: user.id, email: user.email, name: user.name, role: 'ADMIN', orgId: org.id,
    });

    // Create demo orgs in background (don't block registration)
    this.demoSeed.ensureDemoOrgs(user.id).catch(err => {
      this.logger.error(`Failed to create demo orgs for user ${user.id}: ${err.message}`);
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: 'ADMIN' },
      org: { id: org.id, name: org.name, slug: org.slug, plan: org.plan },
      token,
    };
  }

  async login(email: string, password: string, orgId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { org: true }, orderBy: { joinedAt: 'asc' } } },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.memberships.length === 0) throw new UnauthorizedException('No organization found');

    // Ensure demo orgs exist for this user (await so new orgs appear in org picker)
    try {
      await this.demoSeed.ensureDemoOrgs(user.id);
    } catch (err: any) {
      this.logger.error(`Failed to ensure demo orgs for user ${user.id}: ${err.message}`);
    }

    // Re-fetch memberships (demo orgs may have been created above)
    const freshUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { memberships: { include: { org: true }, orderBy: { joinedAt: 'asc' } } },
    });
    const memberships = freshUser?.memberships || user.memberships;

    // If user has multiple orgs and no orgId specified, return org list for picker
    if (memberships.length > 1 && !orgId) {
      return {
        requireOrgSelection: true,
        user: { id: user.id, email: user.email, name: user.name },
        organizations: memberships.map(m => ({
          id: m.org.id, name: m.org.name, slug: m.org.slug, plan: m.org.plan, role: m.role,
        })),
      };
    }

    // Select the specified org or default to first
    const membership = orgId
      ? memberships.find(m => m.orgId === orgId)
      : memberships[0];
    if (!membership) throw new UnauthorizedException('Not a member of this organization');

    const token = this.jwt.sign({
      sub: user.id, email: user.email, name: user.name, role: membership.role, orgId: membership.orgId,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: membership.role },
      org: { id: membership.org.id, name: membership.org.name, slug: membership.org.slug, plan: membership.org.plan },
      organizations: user.memberships.map(m => ({
        id: m.org.id, name: m.org.name, slug: m.org.slug, plan: m.org.plan, role: m.role,
      })),
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, role: true, avatarUrl: true, createdAt: true,
        memberships: { include: { org: { select: { id: true, name: true, slug: true, plan: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  async switchOrg(userId: string, orgId: string) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { org: true, user: true },
    });
    if (!membership) throw new UnauthorizedException('Not a member of this organization');

    const token = this.jwt.sign({
      sub: membership.user.id, email: membership.user.email, name: membership.user.name,
      role: membership.role, orgId: membership.orgId,
    });

    return {
      org: { id: membership.org.id, name: membership.org.name, slug: membership.org.slug, plan: membership.org.plan },
      token,
    };
  }
}
