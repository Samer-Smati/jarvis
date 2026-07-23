import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { BrainGraphComponent } from './brain-graph.component';

@NgModule({
  declarations: [BrainGraphComponent],
  imports: [CommonModule],
  exports: [BrainGraphComponent],
})
export class BrainModule {}
