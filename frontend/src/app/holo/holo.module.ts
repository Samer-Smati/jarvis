import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HoloDeckComponent } from './ui/holo-deck.component';

@NgModule({
  declarations: [HoloDeckComponent],
  imports: [CommonModule, RouterModule.forChild([{ path: '', component: HoloDeckComponent }])],
})
export class HoloModule {}
