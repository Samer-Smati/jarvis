import { Component, Input } from '@angular/core';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-feedback-actions',
  template: `
    <div class="feedback-row" *ngIf="interactionId && !streaming">
      <button type="button" class="fb-btn" [class.active]="feedback === 'up'" (click)="rate(5)" title="Good">
        <i class="pi pi-thumbs-up"></i>
      </button>
      <button type="button" class="fb-btn" [class.active]="feedback === 'down'" (click)="rate(1)" title="Needs work">
        <i class="pi pi-thumbs-down"></i>
      </button>
      <button type="button" class="fb-btn" (click)="toggleCorrection()" title="Correct">
        <i class="pi pi-pencil"></i>
      </button>
    </div>
    <div class="correction-box" *ngIf="showCorrection">
      <textarea pTextarea [(ngModel)]="correctionText" rows="2" placeholder="Better answer…"></textarea>
      <button type="button" pButton label="Save correction" (click)="saveCorrection()"></button>
    </div>
  `,
  styles: [
    `
      .feedback-row { display: flex; gap: 0.35rem; margin-top: 0.35rem; opacity: 0.85; }
      .fb-btn { background: transparent; border: 1px solid rgba(0, 212, 255, 0.25); color: #8ecae6; border-radius: 4px; padding: 0.15rem 0.4rem; cursor: pointer; }
      .fb-btn.active { color: #00d4ff; border-color: #00d4ff; }
      .correction-box { margin-top: 0.35rem; display: flex; flex-direction: column; gap: 0.35rem; }
    `,
  ],
  standalone: false,
})
export class FeedbackActionsComponent {
  @Input() interactionId?: string;
  @Input() streaming = false;
  feedback: 'up' | 'down' | null = null;
  showCorrection = false;
  correctionText = '';

  constructor(private api: ApiService) {}

  rate(rating: number): void {
    if (!this.interactionId) {
      return;
    }
    this.feedback = rating >= 4 ? 'up' : 'down';
    this.api.rateFeedback(this.interactionId, rating).subscribe();
  }

  toggleCorrection(): void {
    this.showCorrection = !this.showCorrection;
  }

  saveCorrection(): void {
    if (!this.interactionId || !this.correctionText.trim()) {
      return;
    }
    this.feedback = 'down';
    this.api.rateFeedback(this.interactionId, 2, this.correctionText.trim()).subscribe();
    this.showCorrection = false;
  }
}
