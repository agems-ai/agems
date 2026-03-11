import { Controller, Get, ForbiddenException, Request } from '@nestjs/common';
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
}
