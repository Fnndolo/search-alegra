import { Controller, Get } from '@nestjs/common';
import { ScheduledTasksService } from './scheduled-tasks.service';

@Controller('scheduled-tasks')
export class ScheduledTasksController {
  constructor(private readonly scheduledTasksService: ScheduledTasksService) {}

  @Get('sync-now')
  async triggerSync() {
    return await this.scheduledTasksService.syncAllData();
  }
}
