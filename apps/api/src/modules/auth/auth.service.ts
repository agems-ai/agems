import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(email: string, password: string, name: string, orgName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    const org = await this.prisma.org.create({
      data: {
        name: orgName || `${name}'s Organization`,
        slug: `org-${Date.now()}`,
        ownerEmail: email,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'ADMIN',
        orgId: org.id,
      },
    });

    return this.buildAuthResponse(user.id, user.email, user.role, user.orgId);
  }

  async login(email: string, password: string, orgId?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.buildAuthResponse(user.id, user.email, user.role, orgId || user.orgId);
  }

  async switchOrg(userId: string, orgId: string) {
    const membership = await this.prisma.orgMember.findFirst({ where: { userId, orgId } });
    if (!membership) throw new UnauthorizedException('You are not a member of this organization');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { orgId },
    });
    return this.buildAuthResponse(user.id, user.email, user.role, orgId);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, orgId: true, avatarUrl: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private buildAuthResponse(userId: string, email: string, role: string, orgId: string) {
    const token = this.jwt.sign({ sub: userId, email, role, orgId });
    return { accessToken: token, user: { id: userId, email, role, orgId } };
  }
}
