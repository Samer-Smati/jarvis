import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InteractionLogEntity } from './entities/interaction-log.entity';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([InteractionLogEntity])],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
