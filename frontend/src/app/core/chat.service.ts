import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { ConfirmationRequest, PermissionRequest, Reminder } from './models';
import { clientPlatform } from './platform.util';

export interface TokenEvent {
  conversationId: string;
  token: string;
}

export interface ToolStartEvent {
  conversationId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent {
  conversationId: string;
  toolName: string;
  output: string;
  success: boolean;
}

export interface DoneEvent {
  conversationId: string;
  finalText: string;
}

export interface AgentErrorEvent {
  conversationId: string;
  message: string;
}

export interface BriefingEvent {
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private socket?: Socket;
  private connected = false;
  private useSse = !!environment.useSse;

  private tokenSubject = new Subject<TokenEvent>();
  private toolStartSubject = new Subject<ToolStartEvent>();
  private toolEndSubject = new Subject<ToolEndEvent>();
  private confirmationSubject = new Subject<ConfirmationRequest>();
  private permissionSubject = new Subject<PermissionRequest>();
  private doneSubject = new Subject<DoneEvent>();
  private errorSubject = new Subject<AgentErrorEvent>();
  private reminderSubject = new Subject<Reminder>();
  private briefingSubject = new Subject<BriefingEvent>();

  token$: Observable<TokenEvent> = this.tokenSubject.asObservable();
  toolStart$: Observable<ToolStartEvent> = this.toolStartSubject.asObservable();
  toolEnd$: Observable<ToolEndEvent> = this.toolEndSubject.asObservable();
  confirmation$: Observable<ConfirmationRequest> = this.confirmationSubject.asObservable();
  permission$: Observable<PermissionRequest> = this.permissionSubject.asObservable();
  done$: Observable<DoneEvent> = this.doneSubject.asObservable();
  error$: Observable<AgentErrorEvent> = this.errorSubject.asObservable();
  reminder$: Observable<Reminder> = this.reminderSubject.asObservable();
  briefing$: Observable<BriefingEvent> = this.briefingSubject.asObservable();

  constructor(private zone: NgZone) {}

  connect(): void {
    if (this.connected || this.useSse) {
      this.connected = true;
      return;
    }
    this.connected = true;
    const url = environment.apiUrl || undefined;
    this.socket = io(url);
    this.zone.runOutsideAngular(() => {
      this.socket?.on('token', (data: TokenEvent) => this.tokenSubject.next(data));
    });
    this.bind('tool_start', this.toolStartSubject);
    this.bind('tool_end', this.toolEndSubject);
    this.bind('done', this.doneSubject);
    this.bind('agent_error', this.errorSubject);
    this.bind('reminder_fired', this.reminderSubject);
    this.bind('morning_briefing', this.briefingSubject);
    this.socket.on('confirmation_request', (data: { request: ConfirmationRequest }) => {
      this.zone.run(() => this.confirmationSubject.next(data?.request));
    });
    this.socket.on('permission_request', (data: { request: PermissionRequest }) => {
      this.zone.run(() => this.permissionSubject.next(data?.request));
    });
  }

  sendMessage(conversationId: string, text: string): void {
    this.connect();
    if (this.useSse) {
      void this.sendViaSse(conversationId, text);
      return;
    }
    this.socket?.emit('user_message', { conversationId, text, platform: clientPlatform() });
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

  private apiBase(): string {
    return environment.apiUrl ? `${environment.apiUrl}/api` : '/api';
  }

  private async postJson(path: string, body: unknown): Promise<void> {
    const base = environment.apiUrl || '';
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async sendViaSse(conversationId: string, text: string): Promise<void> {
    const base = environment.apiUrl || '';
    try {
      const res = await fetch(`${base}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ conversationId, text, platform: clientPlatform() }),
      });
      if (!res.ok || !res.body) {
        this.zone.run(() =>
          this.errorSubject.next({ conversationId, message: `Chat failed (${res.status})` }),
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
        buffer = this.consumeSseBuffer(buffer);
      }
      buffer = this.consumeSseBuffer(`${buffer}\n\n`);
    } catch (error) {
      this.zone.run(() =>
        this.errorSubject.next({ conversationId, message: (error as Error).message }),
      );
    }
  }

  private consumeSseBuffer(buffer: string): string {
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
        this.zone.run(() => this.dispatchSse(event, payload));
      } catch {
        /* ignore malformed chunk */
      }
    }
    return rest;
  }

  private dispatchSse(event: string, payload: unknown): void {
    switch (event) {
      case 'token':
        this.tokenSubject.next(payload as TokenEvent);
        break;
      case 'tool_start':
        this.toolStartSubject.next(payload as ToolStartEvent);
        break;
      case 'tool_end':
        this.toolEndSubject.next(payload as ToolEndEvent);
        break;
      case 'confirmation_request':
        this.confirmationSubject.next((payload as { request: ConfirmationRequest }).request);
        break;
      case 'permission_request':
        this.permissionSubject.next((payload as { request: PermissionRequest }).request);
        break;
      case 'done':
        this.doneSubject.next(payload as DoneEvent);
        break;
      case 'agent_error':
        this.errorSubject.next(payload as AgentErrorEvent);
        break;
      default:
        break;
    }
  }

  private bind<T>(event: string, subject: Subject<T>): void {
    this.socket?.on(event, (data: T) => this.zone.run(() => subject.next(data)));
  }
}
