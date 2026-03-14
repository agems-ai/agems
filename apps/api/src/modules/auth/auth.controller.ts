import { Controller, Post, Get, Body, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() body: { email: string; password: string; name: string; orgName?: string }) {
    return this.authService.register(body.email, body.password, body.name, body.orgName);
  }

  @Public()
  @Post('login')
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
