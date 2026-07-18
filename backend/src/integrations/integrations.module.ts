import { Global, Module } from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';
import { IntegrationsController } from './integrations.controller';

@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class IntegrationsModule {}
