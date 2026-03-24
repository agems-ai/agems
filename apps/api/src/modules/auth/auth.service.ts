import { Controller, Post, Body, BadRequestException, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Request } from 'express';

const MIN_PASSWORD_LENGTH = 8;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('name') name: string,
    @Body('orgName') orgName?: string,
  ) {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return this.authService.register(email, password, name, orgName);
  }

  @Post('login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('orgId') orgId?: string,
  ) {
    return this.authService.login(email, password, orgId);
  }

  @Post('switch-org')
  async switchOrg(
    @Req() req: { user: { id: string } } & Request,
    @Body('orgId') orgId: string,
  ) {
    if (!req.user?.id) throw new BadRequestException('User not authenticated');
    return this.authService.switchOrg(req.user.id, orgId);
  }

  @Post('profile')
  async getProfile(@Req() req: { user: { id: string } } & Request) {
    if (!req.user?.id) throw new BadRequestException('User not authenticated');
    return this.authService.getProfile(req.user.id);
  }
}
