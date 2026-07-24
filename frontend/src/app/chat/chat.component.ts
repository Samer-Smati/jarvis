import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MessageService } from 'primeng/api';
import { Observable, Subscription } from 'rxjs';
import { pairwise } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { ChatService } from '../core/chat.service';
import { ConversationHistoryService } from '../core/conversation-history.service';
import { ChatMessage, ChatImageAttachment, ChatImagePayload, ConfirmationRequest, PermissionRequest, ProgressStep, ToolActivity } from '../core/models';
import { BrainGraphService, isBrainGraphRequest } from '../brain/brain-graph.service';
import { VoiceService } from '../core/voice.service';
import { compressImageForChat } from '../core/image-compress.util';

const CONVERSATION_ID = 'default';
const RECAP_SESSION_KEY = 'jarvis.recapDone';
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 900_000;

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('scrollPane') scrollPane?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  messages: ChatMessage[] = [];
  pendingImages: ChatImageAttachment[] = [];
  composerDragOver = false;
  private pendingImageFiles = new Map<string, File>();
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
  showBrainGraph = false;

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
    private historyStore: ConversationHistoryService,
    private toast: MessageService,
    private voice: VoiceService,
    private brainGraph: BrainGraphService,
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
    this.subscriptions.add(
      this.brainGraph.open$.subscribe((open) => {
        this.showBrainGraph = open;
        this.cdr.markForCheck();
      }),
    );
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
          current.statusHint = undefined;
          this.voice.speakStreamAppend(event.token);
          this.scrollToBottom();
          this.cdr.markForCheck();
        });
      }),
    );

    this.subscriptions.add(
      this.chat.thinking$.subscribe((event) => {
        this.zone.run(() => {
          const current = this.currentAssistantMessage();
          current.thinking = (current.thinking ?? '') + event.token;
          if (current.thinkingExpanded === undefined) {
            current.thinkingExpanded = true;
          }
          current.statusHint = 'Thinking…';
          this.scrollToBottom();
          this.cdr.markForCheck();
        });
      }),
    );

    this.subscriptions.add(
      this.chat.progress$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        current.progress = current.progress ?? [];
        const last = current.progress[current.progress.length - 1];
        if (last && last.stage === event.stage && last.message === event.message) {
          last.detail = event.detail ?? last.detail;
          last.percent = event.percent ?? last.percent;
          last.at = Date.now();
        } else {
          current.progress.push({
            stage: event.stage,
            message: event.message,
            percent: event.percent,
            detail: event.detail,
            toolName: event.toolName,
            at: Date.now(),
          });
          if (current.progress.length > 40) {
            current.progress = current.progress.slice(-40);
          }
        }
        if (typeof event.percent === 'number') {
          current.progressPercent = event.percent;
        }
        if (event.stage === 'done' && event.percent === 100) {
          current.progressPercent = 100;
        }
        current.statusHint = event.message;
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.started$.subscribe(() => {
        const current = this.currentAssistantMessage();
        current.statusHint = 'Connected, sir…';
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.heartbeat$.subscribe(() => {
        const current = this.currentAssistantMessage();
        if (!current.content?.trim() && current.streaming && !current.statusHint) {
          current.statusHint = current.tools?.some((t) => t.running)
            ? 'Running a check, sir…'
            : 'Still working, sir…';
          this.cdr.markForCheck();
        }
      }),
    );

    this.subscriptions.add(
      this.chat.toolStart$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        current.tools = current.tools ?? [];
        const label = this.toolLabel(event.toolName, event.args);
        const key = this.toolKey(event.toolName, event.args);
        const retryIdx = current.tools.findIndex(
          (t) => this.toolKey(t.toolName, t.args) === key && !t.running,
        );
        if (retryIdx >= 0) {
          current.tools.splice(retryIdx, 1);
        }
        current.tools.push({
          toolName: event.toolName,
          label,
          args: event.args,
          running: true,
        });
        current.statusHint = label;
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.toolEnd$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        const tool = current.tools?.find((t) => t.running);
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
        if (event.output?.includes('BRAIN_GRAPH:')) {
          this.brainGraph.open();
        }
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
        current.statusHint = undefined;
        current.tools = this.compactToolBadges(current.tools);
        this.busy = false;
        if (event.finalText?.includes('BRAIN_GRAPH:') || /\bOpening your brain graph\b/i.test(event.finalText ?? '')) {
          this.brainGraph.open();
        }
        if (!current.content?.trim()) {
          this.messages.pop();
        } else {
          this.voice.speakStreamFinish(event.finalText || current.content);
        }
        this.persistConversation();
        this.syncToBackend();
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.error$.subscribe((event) => {
        const current = this.currentAssistantMessage();
        current.content = event.message || 'Something went wrong, sir.';
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
    if ((!text && !this.pendingImages.length) || this.busy) {
      return;
    }
    if (isBrainGraphRequest(text)) {
      this.brainGraph.open();
    }
    this.voice.stopSpeaking();
    this.voice.stopListening();
    this.voice.speakStreamReset();
    const images = [...this.pendingImages];
    this.messages.push({
      role: 'user',
      content: text,
      images: images.length ? images : undefined,
      createdAt: new Date().toISOString(),
    });
    this.messages.push({ role: 'assistant', content: '', streaming: true, tools: [] });
    this.persistConversation();
    this.busy = true;
    this.input = '';
    this.pendingImages = [];
    this.pendingImageFiles.clear();
    this.scrollToBottom();
    this.cdr.markForCheck();
    const history = this.historyStore.toPersisted(
      this.messages.slice(0, -2).filter((m) => !m.streaming && (m.content?.trim() || m.images?.length)),
    );
    void this.sendWithImages(text, history, images);
  }

  private async sendWithImages(
    text: string,
    history: Array<{ role: string; content: string; createdAt?: string }>,
    images: ChatImageAttachment[],
  ): Promise<void> {
    const payloads: ChatImagePayload[] = [];
    for (const image of images.slice(0, MAX_IMAGES)) {
      const payload = await this.imageAttachmentToPayload(image);
      if (payload) {
        payloads.push(payload);
      }
    }
    this.chat.sendMessage(CONVERSATION_ID, text, history, payloads.length ? payloads : undefined);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files?.length) {
      void this.addImageFiles(Array.from(files));
    }
    input.value = '';
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items?.length) {
      return;
    }
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    if (files.length) {
      event.preventDefault();
      void this.addImageFiles(files);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.composerDragOver = true;
    this.cdr.markForCheck();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.composerDragOver = false;
    this.cdr.markForCheck();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.composerDragOver = false;
    const files = event.dataTransfer?.files;
    if (files?.length) {
      void this.addImageFiles(Array.from(files).filter((f) => f.type.startsWith('image/')));
    }
    this.cdr.markForCheck();
  }

  openFilePicker(): void {
    this.fileInput?.nativeElement?.click();
  }

  removePendingImage(index: number): void {
    const removed = this.pendingImages[index];
    if (removed?.url.startsWith('blob:')) {
      this.pendingImageFiles.delete(removed.url);
      URL.revokeObjectURL(removed.url);
    }
    this.pendingImages = this.pendingImages.filter((_, i) => i !== index);
    this.cdr.markForCheck();
  }

  private async addImageFiles(files: File[]): Promise<void> {
    for (const raw of files) {
      const file = await compressImageForChat(raw);
      if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) {
        this.toast.add({
          severity: 'warn',
          summary: 'Image skipped',
          detail: file.size > MAX_IMAGE_BYTES ? 'Image too large after compression (max ~900 KB).' : 'Images only.',
        });
        continue;
      }
      if (this.pendingImages.length >= MAX_IMAGES) {
        this.toast.add({ severity: 'warn', summary: 'Limit reached', detail: `Max ${MAX_IMAGES} images per message.` });
        break;
      }
      const url = URL.createObjectURL(file);
      this.pendingImageFiles.set(url, file);
      this.pendingImages = [...this.pendingImages, { url, name: file.name, mimeType: file.type }];
    }
    this.cdr.markForCheck();
  }

  private async imageAttachmentToPayload(image: ChatImageAttachment): Promise<ChatImagePayload | null> {
    const mimeType = image.mimeType ?? 'image/png';
    try {
      const file = this.pendingImageFiles.get(image.url);
      if (file) {
        const data = await this.fileToBase64(file);
        return { mimeType: file.type || mimeType, data };
      }
      if (image.url.startsWith('data:')) {
        const match = image.url.match(/^data:([^;]+);base64,(.+)$/);
        if (match?.[1] && match[2]) {
          return { mimeType: match[1], data: match[2] };
        }
      }
      const blob = await fetch(image.url).then((r) => r.blob());
      const data = await this.fileToBase64(blob);
      return { mimeType: blob.type || mimeType, data };
    } catch {
      return null;
    }
  }

  private fileToBase64(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  openBrainGraph(): void {
    this.brainGraph.open();
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

  toolDisplayName(tool: ToolActivity): string {
    return tool.label || tool.toolName.replace(/_/g, ' ');
  }

  toggleThinking(message: ChatMessage): void {
    message.thinkingExpanded = !message.thinkingExpanded;
    this.cdr.markForCheck();
  }

  latestProgress(message: ChatMessage): ProgressStep | undefined {
    const steps = message.progress;
    return steps?.length ? steps[steps.length - 1] : undefined;
  }

  shouldShowMessage(message: ChatMessage): boolean {
    if (message.role === 'user') {
      return true;
    }
    if (message.streaming) {
      return true;
    }
    if (message.content?.trim()) {
      return true;
    }
    return !!(message.tools?.some((t) => t.running) || message.progress?.length || message.thinking);
  }

  private toolLabel(toolName: string, args?: Record<string, unknown>): string {
    if (toolName === 'self_improve') {
      const action = String(args?.['action'] ?? '');
      const path = typeof args?.['path'] === 'string' ? args['path'] : '';
      switch (action) {
        case 'status':
          return 'Checking upgrade status';
        case 'inspect':
          return path ? `Inspecting ${path}` : 'Inspecting project';
        case 'write':
          return path ? `Writing ${path}` : 'Writing changes';
        case 'run_checks':
          return 'Running build checks';
        case 'commit':
          return 'Committing changes';
        case 'pull_request':
          return 'Opening pull request';
        default:
          return 'Self-upgrade';
      }
    }
    if (toolName === 'brain') {
      const action = String(args?.['action'] ?? '');
      switch (action) {
        case 'graph':
          return 'Opening brain graph';
        case 'query':
          return 'Searching brain';
        case 'remember':
          return 'Remembering in brain';
        case 'ingest':
          return 'Ingesting source';
        case 'ingest_url':
          return 'Reading link';
        default:
          return 'Brain';
      }
    }
    return `Using ${toolName.replace(/_/g, ' ')}…`;
  }

  private toolKey(toolName: string, args?: Record<string, unknown>): string {
    if (toolName === 'self_improve') {
      const action = String(args?.['action'] ?? '');
      const path = typeof args?.['path'] === 'string' ? args['path'] : '';
      return `${toolName}:${action}:${path}`;
    }
    return toolName;
  }

  private compactToolBadges(tools?: ToolActivity[]): ToolActivity[] | undefined {
    if (!tools?.length) {
      return tools;
    }
    const latest = new Map<string, ToolActivity>();
    for (const tool of tools) {
      latest.set(this.toolKey(tool.toolName, tool.args), tool);
    }
    return [...latest.values()].filter((t) => t.success || t.running);
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
    const local = this.historyStore.load(CONVERSATION_ID);
    this.api.conversationMessages(CONVERSATION_ID).subscribe({
      next: (stored) => {
        const merged = this.historyStore.mergeApiAndLocal(stored, local);
        this.messages = merged.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
        this.historyStore.save(CONVERSATION_ID, merged);
        if (stored.length === 0 && local.length > 0) {
          this.api.syncConversation(CONVERSATION_ID, local).subscribe({
            error: () => undefined,
          });
        }
        this.scrollToBottom();
        this.cdr.markForCheck();
        if (this.messages.length) {
          this.maybeRecap();
        } else {
          this.maybeWelcome();
        }
      },
      error: () => {
        if (local.length) {
          this.messages = local.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          }));
          this.scrollToBottom();
          this.cdr.markForCheck();
          this.maybeRecap();
          return;
        }
        this.toast.add({
          severity: 'warn',
          summary: 'Backend offline',
          detail: 'Could not load conversation history.',
        });
        this.maybeWelcome();
      },
    });
  }

  private persistConversation(): void {
    const persisted = this.historyStore.toPersisted(
      this.messages.filter((m) => !m.streaming && m.content?.trim()),
    );
    this.historyStore.save(CONVERSATION_ID, persisted);
  }

  private syncToBackend(): void {
    const persisted = this.historyStore.load(CONVERSATION_ID);
    if (!persisted.length) {
      return;
    }
    this.api.syncConversation(CONVERSATION_ID, persisted).subscribe({
      error: () => undefined,
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
