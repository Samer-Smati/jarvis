import { Component, OnDestroy, OnInit } from '@angular/core';
import { forkJoin, Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { AuditEntry, EpisodicEvent, MemoryFact, Reminder, SystemStatus } from '../core/models';

const STATUS_REFRESH_MS = 30000;

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: false,
})
export class DashboardComponent implements OnInit, OnDestroy {
  status?: SystemStatus;
  reminders: Reminder[] = [];
  audit: AuditEntry[] = [];
  events: EpisodicEvent[] = [];
  facts: MemoryFact[] = [];

  private subscription?: Subscription;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadDetails();
    this.subscription = timer(0, STATUS_REFRESH_MS)
      .pipe(switchMap(() => this.api.status()))
      .subscribe({ next: (status) => (this.status = status) });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  refreshDetails(): void {
    this.loadDetails();
  }

  outcomeSeverity(outcome: string): 'success' | 'warn' | 'danger' | 'info' {
    if (outcome === 'success') {
      return 'success';
    }
    if (outcome === 'rejected' || outcome === 'failure' || outcome === 'error') {
      return 'danger';
    }
    if (outcome === 'permission_denied') {
      return 'warn';
    }
    return 'info';
  }

  private loadDetails(): void {
    forkJoin({
      reminders: this.api.reminders(),
      audit: this.api.audit(),
      events: this.api.events(),
      facts: this.api.facts(),
    }).subscribe({
      next: (data) => {
        this.reminders = data.reminders;
        this.audit = data.audit;
        this.events = data.events;
        this.facts = data.facts;
      },
    });
  }
}
