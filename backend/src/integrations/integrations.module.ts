import { Global, Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { GoogleCalendarService } from './google-calendar.service';
import { IntegrationsController } from './integrations.controller';
import { VercelDeployService } from './vercel-deploy.service';

@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [GoogleCalendarService, GitHubService, VercelDeployService],
  exports: [GoogleCalendarService, GitHubService, VercelDeployService],
})
export class IntegrationsModule {}
