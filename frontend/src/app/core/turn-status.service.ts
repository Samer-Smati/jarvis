import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ActiveTurnStatus, TurnStatusEvent } from './models';

export const TURN_SLOW_MS = 18_000;
export const TURN_TIMEOUT_WS_MS = 120_000;
export const TURN_TIMEOUT_SSE_MS = 300_000;

export interface TurnTimeoutEvent {
  requestId: string;
  conversationId: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class TurnStatusService implements OnDestroy {
  private readonly statusSubject = new BehaviorSubject<ActiveTurnStatus | null>(null);
  private readonly timeoutSubject = new BehaviorSubject<TurnTimeoutEvent | null>(null);
  private slowTimer?: ReturnType<typeof setTimeout>;
  private hardTimer?: ReturnType<typeof setTimeout>;
  private onHardTimeout?: () => void;

  status$: Observable<ActiveTurnStatus | null> = this.statusSubject.asObservable();
  timeout$: Observable<TurnTimeoutEvent | null> = this.timeoutSubject.asObservable();

  constructor(private zone: NgZone) {}

  get snapshot(): ActiveTurnStatus | null {
    return this.statusSubject.value;
  }

  beginTurn(
    requestId: string,
    conversationId: string,
    message = 'Sending…',
    onHardTimeout?: () => void,
  ): void {
    this.clearTimers();
    this.onHardTimeout = onHardTimeout;
    const now = Date.now();
    this.statusSubject.next({
      requestId,
      conversationId,
      stage: 'queued',
      message,
      slow: false,
      retryable: false,
      isTerminal: false,
      startedAt: now,
      lastEventAt: now,
    });
    this.armWatchdogs(requestId, conversationId);
  }

  touch(requestId: string): void {
    const current = this.statusSubject.value;
    if (!current || current.requestId !== requestId || current.isTerminal) {
      return;
    }
    this.statusSubject.next({ ...current, lastEventAt: Date.now(), slow: false });
    this.armWatchdogs(requestId, current.conversationId);
  }

  updateFromStatus(
    requestId: string,
    conversationId: string,
    event: TurnStatusEvent,
  ): void {
    const current = this.statusSubject.value;
    if (current?.requestId !== requestId) {
      return;
    }
    const now = Date.now();
    this.statusSubject.next({
      requestId,
      conversationId,
      stage: event.stage,
      message: event.message,
      slow: current.slow,
      retryable: event.retryable ?? false,
      isTerminal: event.stage === 'done' || event.stage === 'error' || event.stage === 'timeout',
      startedAt: current.startedAt,
      lastEventAt: now,
    });
    this.touch(requestId);
  }

  updateMessage(requestId: string, message: string, stage?: string): void {
    const current = this.statusSubject.value;
    if (!current || current.requestId !== requestId || current.isTerminal) {
      return;
    }
    this.statusSubject.next({
      ...current,
      message,
      stage: stage ?? current.stage,
      lastEventAt: Date.now(),
    });
    this.touch(requestId);
  }

  markSlow(requestId: string): void {
    const current = this.statusSubject.value;
    if (!current || current.requestId !== requestId || current.isTerminal) {
      return;
    }
    this.statusSubject.next({
      ...current,
      slow: true,
      message: 'Still working, sir — this is taking longer than usual.',
    });
  }

  completeTurn(requestId: string): void {
    const current = this.statusSubject.value;
    if (current?.requestId === requestId) {
      this.clearTimers();
      this.statusSubject.next(null);
    }
  }

  failTurn(
    requestId: string,
    conversationId: string,
    message: string,
    retryable = true,
  ): void {
    this.clearTimers();
    this.statusSubject.next({
      requestId,
      conversationId,
      stage: 'error',
      message,
      slow: false,
      retryable,
      isTerminal: true,
      startedAt: this.statusSubject.value?.startedAt ?? Date.now(),
      lastEventAt: Date.now(),
    });
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  private armWatchdogs(requestId: string, conversationId: string): void {
    this.clearTimers();
    this.slowTimer = setTimeout(() => {
      this.zone.run(() => this.markSlow(requestId));
    }, TURN_SLOW_MS);
    const hardMs = environment.useSse ? TURN_TIMEOUT_SSE_MS : TURN_TIMEOUT_WS_MS;
    this.hardTimer = setTimeout(() => {
      this.zone.run(() => {
        const message = 'Request timed out — want me to retry?';
        this.failTurn(requestId, conversationId, message, true);
        this.timeoutSubject.next({ requestId, conversationId, message });
        this.onHardTimeout?.();
      });
    }, hardMs);
  }

  private clearTimers(): void {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = undefined;
    }
    if (this.hardTimer) {
      clearTimeout(this.hardTimer);
      this.hardTimer = undefined;
    }
  }
}
