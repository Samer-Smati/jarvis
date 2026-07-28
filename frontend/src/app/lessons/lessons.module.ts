import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { LessonsPanelComponent } from './lessons-panel.component';

@NgModule({
  declarations: [LessonsPanelComponent],
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TextareaModule,
    RouterModule.forChild([{ path: '', component: LessonsPanelComponent }]),
  ],
})
export class LessonsModule {}
