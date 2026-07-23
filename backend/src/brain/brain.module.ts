import { Global, Module } from '@nestjs/common';
import { BrainService } from './brain.service';

@Global()
@Module({
  providers: [BrainService],
  exports: [BrainService],
})
export class BrainModule {}
