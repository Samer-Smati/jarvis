import { Global, Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { GoogleCalendarService } from './google-calendar.service';
import { IntegrationsController } from './integrations.controller';
import { VercelDeployService } from './vercel-deploy.service';
import { WebFetchService } from './web-fetch.service';

@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [GoogleCalendarService, GitHubService, VercelDeployService, WebFetchService],
  exports: [GoogleCalendarService, GitHubService, VercelDeployService, WebFetchService],
})
export class IntegrationsModule {}
