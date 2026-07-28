import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { BrainModule } from '../brain/brain.module';
import { ChatComponent } from './chat.component';
import { FeedbackActionsComponent } from './feedback.component';
import { PersonaReviewComponent } from './persona-review.component';

@NgModule({
  declarations: [ChatComponent, FeedbackActionsComponent, PersonaReviewComponent],
  imports: [
    CommonModule,
    FormsModule,
    BrainModule,
    ButtonModule,
    CardModule,
    TagModule,
    TextareaModule,
    TooltipModule,
    RouterModule.forChild([{ path: '', component: ChatComponent }]),
  ],
})
export class ChatModule {}
