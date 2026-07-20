import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MessageService } from 'primeng/api';
import { Observable, Subscription } from 'rxjs';
import { pairwise } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { ChatService } from '../core/chat.service';
import { ChatMessage, ConfirmationRequest, PermissionRequest, ToolActivity } from '../core/models';
import { VoiceService } from '../core/voice.service';

const CONVERSATION_ID = 'default';
const RECAP_SESSION_KEY = 'jarvis.recapDone';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('scrollPane') scrollPane?: ElementRef<HTMLElement>;

  messages: ChatMessage[] = [];
  confirmations: ConfirmationRequest[] = [];
  permissionRequests: PermissionRequest[] = [];
  input = '';
  busy = false;

  listening$: Observable<boolean>;
  speaking$: Observable<boolean>;
  transcribing$: Observable<boolean>;
  voiceEnabled$: Observable<boolean>;
  handsFree$: Observable<boolean>;
  sttSupported: boolean;
  bootStep = -1;
  welcomeComplete = false;
  welcomeActive = false;
  sessionRecap: string | null = null;
  recapLoading = false;

  private subscriptions = new Subscription();
  private welcomeStarted = false;
  private recapStarted = false;

  handsFree = false;
  voiceEnabled = false;
  listening = false;
  transcribing = false;

  constructor(
    private chat: ChatService,
    private api: ApiService,
    private toast: MessageService,
    private voice: VoiceService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {
    this.listening$ = voice.listening$;
    this.speaking$ = voice.speaking$;
    this.transcribing$ = voice.transcribing$;
    this.voiceEnabled$ = voice.enabled$;
    this.handsFree$ = voice.handsFree$;
    this.sttSupported = voice.sttSupported;
  }

  ngOnInit(): void {
    this.chat.connect();
    this.subscriptions.add(this.handsFree$.subscribe((v) => { this.handsFree = !!v; this.cdr.markForCheck(); }));
    this.subscriptions.add(this.voiceEnabled$.subscribe((v) => { this.voiceEnabled = !!v; this.cdr.markForCheck(); }));
    this.subscriptions.add(this.listening$.subscribe((v) => { this.listening = !!v; this.cdr.markForCheck(); }));
    this.subscriptions.add(this.transcribing$.subscribe((v) => { this.transcribing = !!v; this.cdr.markForCheck(); }));
    this.loadHistory();

    this.subscriptions.add(
      this.chat.token$.subscribe((event) => {
        this.zone.run(() => {
          const current = this.currentAssistantMessage();
          current.content += event.token;
          this.voice.speakStreamAppend(event.token);
          this.scrollToBottom();
          this.cdr.markForCheck();
        });
      }),
    );

    this.subscriptions.add(
      this.chat.toolStart$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        current.tools = current.tools ?? [];
        current.tools.push({ toolName: event.toolName, args: event.args, running: true });
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.toolEnd$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        const tool = current.tools?.find((t) => t.toolName === event.toolName && t.running);
        if (tool) {
          tool.running = false;
          tool.output = event.output;
          tool.success = event.success;
        }
        if (event.output?.startsWith('WEB_TAB:')) {
          const urlMatch = event.output.match(/WEB_TAB: Navigate this JARVIS tab to (.+?)\./);
          const url = urlMatch?.[1]?.trim();
          if (url) {
            window.location.href = url;
          }
        }
        current.content = '';
        this.voice.speakStreamPauseForTool();
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.confirmation$.subscribe((request) => {
        if (request) {
          this.confirmations.push(request);
          this.scrollToBottom();
          this.cdr.markForCheck();
          this.voice.speak('Sir, this action requires your confirmation.');
        }
      }),
    );

    this.subscriptions.add(
      this.chat.permission$.subscribe((request) => {
        if (request) {
          this.permissionRequests.push(request);
          this.scrollToBottom();
          this.cdr.markForCheck();
          this.voice.speak('Sir, JARVIS is requesting permission to control your devices.');
        }
      }),
    );

    this.subscriptions.add(
      this.chat.done$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        current.content = event.finalText || current.content;
        current.streaming = false;
        this.busy = false;
        this.scrollToBottom();
        this.cdr.markForCheck();
        this.voice.speakStreamFinish(event.finalText || current.content);
      }),
    );

    this.subscriptions.add(
      this.chat.error$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        current.streaming = false;
        this.busy = false;
        this.cdr.markForCheck();
        this.toast.add({ severity: 'error', summary: 'JARVIS', detail: event.message });
      }),
    );

    this.subscriptions.add(
      this.chat.reminder$.subscribe((reminder) => {
        this.toast.add({
          severity: 'info',
          summary: 'Reminder',
          detail: reminder?.text,
          sticky: true,
        });
        this.voice.speak(`Sir, a reminder: ${reminder?.text}`);
      }),
    );

    // Voice input: send the mic transcript as a message.
    this.subscriptions.add(
      this.voice.transcript$.subscribe((transcript) => {
        this.input = transcript;
        this.send();
      }),
    );

    // Hands-free conversation loop: when JARVIS stops speaking, reopen the mic.
    this.subscriptions.add(
      this.voice.speaking$.pipe(pairwise()).subscribe(([wasSpeaking, isSpeaking]) => {
        if (
          wasSpeaking &&
          !isSpeaking &&
          this.voice.handsFree &&
          this.sttSupported &&
          !this.busy
        ) {
          setTimeout(() => this.voice.resumeIdleVoice(), 80);
        }
      }),
    );

    this.subscriptions.add(
      this.chat.briefing$.subscribe((event) => {
        this.toast.add({
          severity: 'info',
          summary: 'Morning briefing',
          detail: event?.text,
          sticky: true,
        });
        this.voice.speak(event?.text ?? '');
      }),
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private scrollToBottom(): void {
    if (this.scrollPane?.nativeElement) {
      const el = this.scrollPane.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  send(): void {
    const text = this.input.trim();
    if (!text || this.busy) {
      return;
    }
    this.voice.stopSpeaking();
    this.voice.stopListening();
    this.voice.speakStreamReset();
    this.messages.push({ role: 'user', content: text, createdAt: new Date().toISOString() });
    this.messages.push({ role: 'assistant', content: '', streaming: true, tools: [] });
    this.busy = true;
    this.input = '';
    this.scrollToBottom();
    this.cdr.markForCheck();
    this.chat.sendMessage(CONVERSATION_ID, text);
  }

  toggleMic(): void {
    this.voice.toggleListening();
  }

  toggleVoice(): void {
    this.voice.setEnabled(!this.voice.enabled);
  }

  toggleHandsFree(): void {
    this.voice.setHandsFree(!this.voice.handsFree);
    if (this.voice.handsFree && !this.busy) {
      this.voice.startListening();
    }
  }

  respond(request: ConfirmationRequest, approved: boolean): void {
    this.chat.respondToConfirmation(request.id, approved);
    this.confirmations = this.confirmations.filter((c) => c.id !== request.id);
  }

  respondPermission(request: PermissionRequest, approved: boolean): void {
    this.chat.respondToPermission(request.id, approved);
    this.permissionRequests = this.permissionRequests.filter((p) => p.id !== request.id);
  }

  argsPreview(args: Record<string, unknown> | undefined): string {
    return args ? JSON.stringify(args) : '';
  }

  toolSeverity(tool: ToolActivity): 'info' | 'success' | 'danger' {
    if (tool.running) {
      return 'info';
    }
    return tool.success ? 'success' : 'danger';
  }

  private currentAssistantMessage(): ChatMessage {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'assistant' && last.streaming) {
      return last;
    }
    const created: ChatMessage = { role: 'assistant', content: '', streaming: true, tools: [] };
    this.messages.push(created);
    return created;
  }

  private loadHistory(): void {
    this.api.conversationMessages(CONVERSATION_ID).subscribe({
      next: (stored) => {
        this.messages = stored
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            createdAt: m.createdAt,
          }));
        this.scrollToBottom();
        this.cdr.markForCheck();
        if (this.messages.length) {
          this.maybeRecap();
        } else {
          this.maybeWelcome();
        }
      },
      error: () => {
        this.toast.add({
          severity: 'warn',
          summary: 'Backend offline',
          detail: 'Could not load conversation history.',
        });
        this.maybeWelcome();
      },
    });
  }

  private maybeRecap(): void {
    if (this.recapStarted || !this.messages.length || sessionStorage.getItem(RECAP_SESSION_KEY)) {
      return;
    }
    this.recapStarted = true;
    const localRecap = this.buildLocalRecap();
    if (localRecap) {
      this.sessionRecap = localRecap;
      this.cdr.markForCheck();
      if (this.voice.enabled && this.voice.ttsSupported) {
        void this.voice.speakAsJarvis(`Welcome back, sir. ${localRecap}`);
      }
    }

    this.recapLoading = true;
    this.api.conversationRecap(CONVERSATION_ID).subscribe({
      next: (res) => {
        const recap = res?.recap?.trim();
        if (recap && recap !== localRecap) {
          this.sessionRecap = recap;
          this.cdr.markForCheck();
        }
        sessionStorage.setItem(RECAP_SESSION_KEY, '1');
      },
      error: () => {
        sessionStorage.setItem(RECAP_SESSION_KEY, '1');
      },
      complete: () => {
        this.recapLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private buildLocalRecap(): string | null {
    const last3 = this.messages.slice(-3);
    if (!last3.length) {
      return null;
    }
    const parts = last3.map((m) => {
      const label = m.role === 'user' ? 'You' : 'I';
      const when = m.createdAt ? this.formatMessageDate(m.createdAt) : '';
      const text = m.content.length > 100 ? `${m.content.slice(0, 100).trim()}…` : m.content.trim();
      return when ? `${label} on ${when}: ${text}` : `${label}: ${text}`;
    });
    return `Here's a quick recap. ${parts.join(' ')}`;
  }

  private maybeWelcome(): void {
    if (this.welcomeStarted || this.messages.length) {
      return;
    }
    this.welcomeStarted = true;
    this.welcomeActive = true;
    this.cdr.markForCheck();

    if (!this.voice.enabled || !this.voice.ttsSupported) {
      this.runVisualBootOnly();
      return;
    }

    void this.voice.speakJarvisWelcome((step) => {
      this.bootStep = step;
      this.cdr.markForCheck();
    }).then(() => {
      this.welcomeComplete = true;
      this.cdr.markForCheck();
      if (this.voice.handsFree && this.sttSupported && !this.busy) {
        setTimeout(() => this.voice.resumeIdleVoice(), 150);
      }
    });
  }

  private runVisualBootOnly(): void {
    const steps = [0, 1, 2, 3, 4];
    let i = 0;
    const tick = () => {
      if (i >= steps.length) {
        this.welcomeComplete = true;
        this.cdr.markForCheck();
        return;
      }
      this.bootStep = steps[i];
      this.cdr.markForCheck();
      i += 1;
      setTimeout(tick, 500);
    };
    setTimeout(tick, 150);
  }

  formatMessageDate(iso?: string): string {
    if (!iso) {
      return '';
    }
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
