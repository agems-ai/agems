import { Controller, Get, Patch, Param, Body, ForbiddenException, Request } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @Roles('ADMIN')
  async getStats(@Request() req: { user: RequestUser }) {
    const isGlobal = await this.adminService.isGlobalAdmin(req.user.id);
    if (!isGlobal) throw new ForbiddenException('Global admin access required');

    const [stats, github] = await Promise.all([
      this.adminService.getStats(),
      this.adminService.getGitHubStats(),
    ]);

    const achievements = this.adminService.getGitHubAchievements(github);

    return { ...stats, github, achievements };
  }

  @Get('users')
  @Roles('ADMIN')
  async getUsers(@Request() req: { user: RequestUser }) {
    const isGlobal = await this.adminService.isGlobalAdmin(req.user.id);
    if (!isGlobal) throw new ForbiddenException('Global admin access required');
    return this.adminService.getAllUsers();
  }

  @Patch('users/:id/password')
  @Roles('ADMIN')
  async resetPassword(
    @Request() req: { user: RequestUser },
    @Param('id') userId: string,
    @Body() body: { password: string },
  ) {
    const isGlobal = await this.adminService.isGlobalAdmin(req.user.id);
    if (!isGlobal) throw new ForbiddenException('Global admin access required');
    return this.adminService.resetUserPassword(userId, body.password);
  }
}
