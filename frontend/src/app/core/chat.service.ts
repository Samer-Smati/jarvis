import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { ConfirmationRequest, PermissionRequest, Reminder, TurnStatusEvent } from './models';
import { clientPlatform } from './platform.util';
import { TurnStatusService } from './turn-status.service';

export interface ChatStreamEventBase {
  conversationId: string;
  requestId?: string;
  ts?: number;
  elapsedMs?: number;
}

export interface TokenEvent extends ChatStreamEventBase {
  token: string;
}

export interface ThinkingEvent extends ChatStreamEventBase {
  token: string;
}

export interface ProgressEvent extends ChatStreamEventBase, TurnStatusEvent {}

export interface ToolStartEvent extends ChatStreamEventBase {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent extends ChatStreamEventBase {
  toolName: string;
  output: string;
  success: boolean;
}

export interface DoneEvent extends ChatStreamEventBase {
  finalText: string;
  interactionId?: string;
  taskRoute?: string;
  superseded?: boolean;
}

export interface AgentErrorEvent extends ChatStreamEventBase {
  message: string;
  retryable?: boolean;
}

export interface SupersededEvent extends ChatStreamEventBase {
  reason?: string;
}

export interface BriefingEvent {
  text: string;
}

export interface ConnectionStatusEvent {
  connected: boolean;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private socket?: Socket;
  private connected = false;
  private useSse = !!environment.useSse;
  private sseAbort?: AbortController;
  private activeSseRequestId?: string;
  private disconnectTimer?: ReturnType<typeof setTimeout>;

  private tokenSubject = new Subject<TokenEvent>();
  private thinkingSubject = new Subject<ThinkingEvent>();
  private progressSubject = new Subject<ProgressEvent>();
  private turnStatusSubject = new Subject<ProgressEvent>();
  private toolStartSubject = new Subject<ToolStartEvent>();
  private toolEndSubject = new Subject<ToolEndEvent>();
  private confirmationSubject = new Subject<ConfirmationRequest>();
  private permissionSubject = new Subject<PermissionRequest>();
  private doneSubject = new Subject<DoneEvent>();
  private errorSubject = new Subject<AgentErrorEvent>();
  private startedSubject = new Subject<ChatStreamEventBase>();
  private heartbeatSubject = new Subject<ChatStreamEventBase>();
  private supersededSubject = new Subject<SupersededEvent>();
  private connectionSubject = new Subject<ConnectionStatusEvent>();
  private reminderSubject = new Subject<Reminder>();
  private briefingSubject = new Subject<BriefingEvent>();

  token$: Observable<TokenEvent> = this.tokenSubject.asObservable();
  thinking$: Observable<ThinkingEvent> = this.thinkingSubject.asObservable();
  progress$: Observable<ProgressEvent> = this.progressSubject.asObservable();
  turnStatus$: Observable<ProgressEvent> = this.turnStatusSubject.asObservable();
  toolStart$: Observable<ToolStartEvent> = this.toolStartSubject.asObservable();
  toolEnd$: Observable<ToolEndEvent> = this.toolEndSubject.asObservable();
  confirmation$: Observable<ConfirmationRequest> = this.confirmationSubject.asObservable();
  permission$: Observable<PermissionRequest> = this.permissionSubject.asObservable();
  done$: Observable<DoneEvent> = this.doneSubject.asObservable();
  error$: Observable<AgentErrorEvent> = this.errorSubject.asObservable();
  started$: Observable<ChatStreamEventBase> = this.startedSubject.asObservable();
  heartbeat$: Observable<ChatStreamEventBase> = this.heartbeatSubject.asObservable();
  superseded$: Observable<SupersededEvent> = this.supersededSubject.asObservable();
  connection$: Observable<ConnectionStatusEvent> = this.connectionSubject.asObservable();
  reminder$: Observable<Reminder> = this.reminderSubject.asObservable();
  briefing$: Observable<BriefingEvent> = this.briefingSubject.asObservable();

  constructor(
    private zone: NgZone,
    private turnStatus: TurnStatusService,
  ) {}

  connect(): void {
    if (this.connected || this.useSse) {
      this.connected = true;
      return;
    }
    this.connected = true;
    const url = environment.apiUrl || undefined;
    this.socket = io(url);
    this.zone.runOutsideAngular(() => {
      this.socket?.on('token', (data: TokenEvent) => this.handleStreamEvent(data, () => this.tokenSubject.next(data)));
      this.socket?.on('thinking', (data: ThinkingEvent) =>
        this.handleStreamEvent(data, () => this.thinkingSubject.next(data)),
      );
    });
    this.bind('progress', this.progressSubject);
    this.bind('turn_status', this.turnStatusSubject);
    this.bind('tool_start', this.toolStartSubject);
    this.bind('tool_end', this.toolEndSubject);
    this.bind('done', this.doneSubject);
    this.bind('agent_error', this.errorSubject);
    this.bind('started', this.startedSubject);
    this.bind('heartbeat', this.heartbeatSubject);
    this.socket?.on('reminder_fired', (data: Reminder) => {
      this.zone.run(() => this.reminderSubject.next(data));
    });
    this.socket?.on('morning_briefing', (data: BriefingEvent) => {
      this.zone.run(() => this.briefingSubject.next(data));
    });
    this.socket.on('confirmation_request', (data: { request: ConfirmationRequest }) => {
      this.zone.run(() => this.confirmationSubject.next(data?.request));
    });
    this.socket.on('permission_request', (data: { request: PermissionRequest }) => {
      this.zone.run(() => this.permissionSubject.next(data?.request));
    });
    this.socket.on('connect', () => {
      this.zone.run(() => {
        if (this.disconnectTimer) {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = undefined;
        }
        this.connectionSubject.next({ connected: true });
      });
    });
    this.socket.on('disconnect', () => {
      this.zone.run(() => {
        this.connectionSubject.next({
          connected: false,
          message: 'Connection lost — reconnecting…',
        });
        if (this.disconnectTimer) {
          clearTimeout(this.disconnectTimer);
        }
        this.disconnectTimer = setTimeout(() => {
          this.zone.run(() => {
            const active = this.turnStatus.snapshot;
            if (active && !active.isTerminal && active.requestId) {
              this.errorSubject.next({
                conversationId: active.conversationId,
                requestId: active.requestId,
                message: 'Connection lost before JARVIS could finish, sir. Please retry.',
                retryable: true,
              });
            }
          });
        }, 10_000);
      });
    });
    this.socket.on('connect_error', () => {
      this.zone.run(() =>
        this.connectionSubject.next({
          connected: false,
          message: 'Connection error — retrying…',
        }),
      );
    });
  }

  sendMessage(
    conversationId: string,
    requestId: string,
    text: string,
    history?: Array<{ role: string; content: string; createdAt?: string }>,
    images?: Array<{ mimeType: string; data: string }>,
  ): void {
    this.turnStatus.beginTurn(requestId, conversationId, 'Jarvis is thinking…', () => {
      this.abortActiveStream(requestId);
      void this.killSwitch(conversationId);
    });
    this.connect();
    if (this.useSse) {
      void this.sendViaSse(conversationId, requestId, text, history, images);
      return;
    }
    this.socket?.emit('user_message', {
      conversationId,
      requestId,
      text,
      platform: clientPlatform(),
      history,
      images,
    });
  }

  abortActiveStream(nextRequestId?: string): void {
    if (this.sseAbort) {
      const priorId = this.activeSseRequestId;
      this.sseAbort.abort();
      this.sseAbort = undefined;
      if (priorId && priorId !== nextRequestId) {
        this.zone.run(() =>
          this.supersededSubject.next({
            conversationId: this.turnStatus.snapshot?.conversationId ?? '',
            requestId: priorId,
            reason: 'Superseded by a newer message.',
          }),
        );
      }
    }
  }

  respondToConfirmation(id: string, approved: boolean): void {
    if (this.useSse) {
      void this.postJson('/api/chat/confirmation', { id, approved });
      return;
    }
    this.connect();
    this.socket?.emit('confirmation_response', { id, approved });
  }

  respondToPermission(id: string, approved: boolean): void {
    if (this.useSse) {
      void this.postJson('/api/chat/permission', { id, approved, platform: clientPlatform() });
      return;
    }
    this.connect();
    this.socket?.emit('permission_response', { id, approved, platform: clientPlatform() });
  }

  private async killSwitch(conversationId: string): Promise<void> {
    const base = environment.apiUrl || '';
    try {
      await fetch(`${base}/api/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });
    } catch {
      /* best-effort abort of stale server run */
    }
  }

  private async postJson(path: string, body: unknown): Promise<void> {
    const base = environment.apiUrl || '';
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
    } catch (error) {
      this.zone.run(() =>
        this.connectionSubject.next({
          connected: false,
          message: (error as Error).message,
        }),
      );
    }
  }

  private async sendViaSse(
    conversationId: string,
    requestId: string,
    text: string,
    history?: Array<{ role: string; content: string; createdAt?: string }>,
    images?: Array<{ mimeType: string; data: string }>,
  ): Promise<void> {
    this.abortActiveStream(requestId);
    const abort = new AbortController();
    this.sseAbort = abort;
    this.activeSseRequestId = requestId;
    const base = environment.apiUrl || '';
    let finished = false;
    const markFinished = () => {
      finished = true;
      if (this.sseAbort === abort) {
        this.sseAbort = undefined;
        this.activeSseRequestId = undefined;
      }
    };
    try {
      const res = await fetch(`${base}/api/chat/stream`, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          conversationId,
          requestId,
          text,
          platform: clientPlatform(),
          history,
          images,
        }),
      });
      if (!res.ok || !res.body) {
        if (abort.signal.aborted) {
          return;
        }
        const detail =
          res.status === 413
            ? 'Image too large for cloud upload — try a smaller screenshot or one image at a time.'
            : `Chat failed (${res.status})`;
        this.zone.run(() =>
          this.errorSubject.next({ conversationId, requestId, message: detail, retryable: true }),
        );
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = this.consumeSseBuffer(buffer, markFinished);
      }
      buffer = this.consumeSseBuffer(`${buffer}\n\n`, markFinished);
      if (!finished && !abort.signal.aborted) {
        this.zone.run(() =>
          this.errorSubject.next({
            conversationId,
            requestId,
            message:
              'Connection ended early, sir. If upgrade steps ran, check GitHub for a new branch or say "open PR".',
            retryable: true,
          }),
        );
      }
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      this.zone.run(() =>
        this.errorSubject.next({
          conversationId,
          requestId,
          message: (error as Error).message,
          retryable: true,
        }),
      );
    }
  }

  private consumeSseBuffer(buffer: string, onFinished?: () => void): string {
    const blocks = buffer.split('\n\n');
    const rest = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.trim()) {
        continue;
      }
      let event = 'message';
      let dataLine = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLine = line.slice(5).trim();
        }
      }
      if (!dataLine) {
        continue;
      }
      try {
        const payload = JSON.parse(dataLine);
        this.zone.run(() => this.dispatchSse(event, payload, onFinished));
      } catch {
        /* ignore malformed chunk */
      }
    }
    return rest;
  }

  private dispatchSse(event: string, payload: unknown, onFinished?: () => void): void {
    switch (event) {
      case 'token':
        this.handleStreamEvent(payload as TokenEvent, () => this.tokenSubject.next(payload as TokenEvent));
        break;
      case 'thinking':
        this.handleStreamEvent(payload as ThinkingEvent, () =>
          this.thinkingSubject.next(payload as ThinkingEvent),
        );
        break;
      case 'progress':
        this.handleStreamEvent(payload as ProgressEvent, () => {
          const progress = payload as ProgressEvent;
          if (progress.requestId && progress.conversationId) {
            this.turnStatus.updateFromStatus(progress.requestId, progress.conversationId, progress);
          }
          this.progressSubject.next(progress);
        });
        break;
      case 'turn_status':
        this.handleStreamEvent(payload as ProgressEvent, () => {
          const status = payload as ProgressEvent;
          if (status.requestId && status.conversationId) {
            this.turnStatus.updateFromStatus(status.requestId, status.conversationId, status);
          }
          this.turnStatusSubject.next(status);
        });
        break;
      case 'started':
        this.handleStreamEvent(payload as ChatStreamEventBase, () => {
          this.startedSubject.next(payload as ChatStreamEventBase);
          const base = payload as ChatStreamEventBase;
          if (base.requestId && base.conversationId) {
            this.turnStatus.updateMessage(base.requestId, 'Connected, sir…', 'accepted');
          }
        });
        break;
      case 'heartbeat':
        this.handleStreamEvent(payload as ChatStreamEventBase, () =>
          this.heartbeatSubject.next(payload as ChatStreamEventBase),
        );
        break;
      case 'tool_start':
        this.handleStreamEvent(payload as ToolStartEvent, () =>
          this.toolStartSubject.next(payload as ToolStartEvent),
        );
        break;
      case 'tool_end':
        this.handleStreamEvent(payload as ToolEndEvent, () =>
          this.toolEndSubject.next(payload as ToolEndEvent),
        );
        break;
      case 'confirmation_request':
        this.confirmationSubject.next((payload as { request: ConfirmationRequest }).request);
        break;
      case 'permission_request':
        this.permissionSubject.next((payload as { request: PermissionRequest }).request);
        break;
      case 'done':
        onFinished?.();
        this.doneSubject.next(payload as DoneEvent);
        break;
      case 'agent_error':
        onFinished?.();
        this.errorSubject.next(payload as AgentErrorEvent);
        break;
      default:
        break;
    }
  }

  private handleStreamEvent<T extends ChatStreamEventBase>(event: T, emit: () => void): void {
    if (event.requestId) {
      this.turnStatus.touch(event.requestId);
    }
    emit();
  }

  private bind<T extends ChatStreamEventBase>(event: string, subject: Subject<T>): void {
    this.socket?.on(event, (data: T) => {
      this.zone.run(() => {
        if (event === 'progress' || event === 'turn_status') {
          const progress = data as T & TurnStatusEvent;
          if (data.requestId && data.conversationId) {
            this.turnStatus.updateFromStatus(data.requestId, data.conversationId, progress);
          }
        }
        if (event === 'started' && data.requestId && data.conversationId) {
          this.turnStatus.updateMessage(data.requestId, 'Connected, sir…', 'accepted');
        }
        if (data.requestId) {
          this.turnStatus.touch(data.requestId);
        }
        if (event === 'agent_error') {
          const err = data as T & AgentErrorEvent;
          if (data.requestId && data.conversationId) {
            this.turnStatus.failTurn(
              data.requestId,
              data.conversationId,
              err.message,
              err.retryable ?? true,
            );
          }
        }
        if (event === 'done') {
          const done = data as T & DoneEvent;
          if (done.requestId && !done.superseded) {
            this.turnStatus.completeTurn(done.requestId);
          }
        }
        subject.next(data);
      });
    });
  }
}
