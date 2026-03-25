import { Controller, Post, Get, Body, Request, UsePipes } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const MIN_PASSWORD_LENGTH = 8;

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
  name: z.string().min(1).max(100),
  orgName: z.string().max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
  orgId: z.string().uuid().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  register(@Body() body: { email: string; password: string; name: string; orgName?: string }) {
    return this.authService.register(body.email, body.password, body.name, body.orgName);
  }

  @Public()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('login')
  @UsePipes(new ZodValidationPipe(LoginSchema))
  login(@Body() body: { email: string; password: string; orgId?: string }) {
    return this.authService.login(body.email, body.password, body.orgId);
  }

  @Get('profile')
  getProfile(@Request() req: { user: { id: string } }) {
    return this.authService.getProfile(req.user.id);
  }

  @Post('switch-org')
  switchOrg(@Request() req: { user: { id: string } }, @Body() body: { orgId: string }) {
    return this.authService.switchOrg(req.user.id, body.orgId);
  }
}
