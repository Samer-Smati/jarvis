import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';
import { LessonEntity } from './entities/lesson.entity';
import { LessonsController } from './lessons.controller';
import { LessonsRepository } from './lessons.repository';
import { LessonsService } from './lessons.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([LessonEntity, InteractionLogEntity])],
  controllers: [LessonsController],
  providers: [LessonsRepository, LessonsService],
  exports: [LessonsService],
})
export class LessonsModule {}
