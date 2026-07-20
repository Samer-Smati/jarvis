import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from './github.service';
import { GoogleCalendarService } from './google-calendar.service';
import { VercelDeployService } from './vercel-deploy.service';

@Controller('api/integrations')
export class IntegrationsController {
  constructor(
    private readonly config: ConfigService,
    private readonly googleCalendar: GoogleCalendarService,
    private readonly github: GitHubService,
    private readonly vercel: VercelDeployService,
  ) {}

  @Get('status')
  status() {
    return {
      googleCalendar: this.googleCalendar.isConfigured(),
      email: !!(
        this.config.get<string>('SMTP_HOST')?.trim() && this.config.get<string>('SMTP_USER')?.trim()
      ),
      smartHome: !!(
        this.config.get<string>('HOME_ASSISTANT_URL')?.trim() &&
        this.config.get<string>('HOME_ASSISTANT_TOKEN')?.trim()
      ),
      codingSandbox: this.config.get<string>('SANDBOX_ENABLED') !== 'false',
      selfImprove: {
        github: this.github.isConfigured(),
        githubRepo: this.github.repoLabel(),
        vercelDeployApi: this.vercel.isConfigured(),
        projectRoot: this.config.get<string>('JARVIS_PROJECT_ROOT')?.trim() || null,
      },
      wakeWord: true,
      mobilePwa: true,
    };
  }

  @Get('mobile')
  mobile() {
    return {
      platform: 'pwa',
      minVersion: '1.0.24',
      endpoints: {
        status: '/api/status',
        integrations: '/api/integrations/status',
        chat: '/socket.io',
      },
      installHint: 'Add JARVIS to your home screen from the browser menu for a mobile HUD.',
    };
  }
}
