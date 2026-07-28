import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-persona-review',
  template: `
    <div class="persona-review hud-panel" *ngIf="loaded">
      <span class="hud-label">// Persona review</span>
      <p *ngIf="!changed">Draft matches active persona.</p>
      <div class="diff" *ngIf="changed">
        <div class="col">
          <h4>Active</h4>
          <pre>{{ active }}</pre>
        </div>
        <div class="col">
          <h4>Draft</h4>
          <pre>{{ draft }}</pre>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .persona-review { padding: 0.75rem; margin: 0.5rem 0; }
      .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
      pre { white-space: pre-wrap; font-size: 0.75rem; max-height: 200px; overflow: auto; }
    `,
  ],
  standalone: false,
})
export class PersonaReviewComponent implements OnInit {
  active = '';
  draft = '';
  changed = false;
  loaded = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.personaCompare().subscribe({
      next: (res) => {
        this.active = res.active ?? '';
        this.draft = res.draft ?? '';
        this.changed = !!res.changed;
        this.loaded = true;
      },
      error: () => {
        this.loaded = true;
      },
    });
  }
}
