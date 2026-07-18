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
    if (this.connected) {
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
    this.socket?.emit('user_message', { conversationId, text, platform: clientPlatform() });
  }

  respondToConfirmation(id: string, approved: boolean): void {
    this.connect();
    this.socket?.emit('confirmation_response', { id, approved });
  }

  respondToPermission(id: string, approved: boolean): void {
    this.connect();
    this.socket?.emit('permission_response', { id, approved, platform: clientPlatform() });
  }

  private bind<T>(event: string, subject: Subject<T>): void {
    this.socket?.on(event, (data: T) => this.zone.run(() => subject.next(data)));
  }
}
