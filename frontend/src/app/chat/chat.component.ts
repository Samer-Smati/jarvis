import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MessageService } from 'primeng/api';
import { Observable, Subscription } from 'rxjs';
import { pairwise } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { ChatService } from '../core/chat.service';
import { ConversationHistoryService } from '../core/conversation-history.service';
import { ConversationSessionService } from '../core/conversation-session.service';
import {
  createChatRequestId,
  findAssistantIndex,
  findUserIndex,
  OutboundChatRequest,
} from '../core/chat-request.util';
import { ChatMessage, ChatImageAttachment, ChatImagePayload, ConfirmationRequest, PermissionRequest, ProgressStep, ToolActivity, ActiveTurnStatus } from '../core/models';
import { TurnStatusService } from '../core/turn-status.service';
import { BrainGraphService, isBrainGraphRequest, isBrainMutationToolOutput } from '../brain/brain-graph.service';
import { VoiceService } from '../core/voice.service';
import { compressImageForChat } from '../core/image-compress.util';

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
  @ViewChild('bottomAnchor') bottomAnchor?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  messages: ChatMessage[] = [];
  pendingImages: ChatImageAttachment[] = [];
  composerDragOver = false;
  private pendingImageFiles = new Map<string, File>();
  confirmations: ConfirmationRequest[] = [];
  permissionRequests: PermissionRequest[] = [];
  input = '';
  busy = false;
  queuedCount = 0;
  conversationId = '';
  turnStatus: ActiveTurnStatus | null = null;
  connectionMessage = '';

  private activeRequestId: string | null = null;
  private outboundQueue: OutboundChatRequest[] = [];
  private lastRetryOutbound: OutboundChatRequest | null = null;
  private sendLock = false;
  private retryInFlight = false;
  private lastSendFingerprint = '';
  private lastSendAt = 0;

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
  brainOpsPaused = false;
  brainOpsReason?: string;

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
    private conversationSession: ConversationSessionService,
    private toast: MessageService,
    private voice: VoiceService,
    private brainGraph: BrainGraphService,
    private turnStatusService: TurnStatusService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {
    this.listening$ = voice.listening$;
    this.speaking$ = voice.speaking$;
    this.transcribing$ = voice.transcribing$;
    this.voiceEnabled$ = voice.enabled$;
    this.handsFree$ = voice.handsFree$;
    this.sttSupported = voice.sttSupported;
    this.conversationId = this.conversationSession.resolveActiveConversationId();
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
    this.loadBrainOpsStatus();
    this.loadHistory();

    this.subscriptions.add(
      this.turnStatusService.status$.subscribe((status) => {
        this.turnStatus = status;
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.turnStatusService.timeout$.subscribe((event) => {
        if (!event?.requestId) {
          return;
        }
        this.handleStreamFailure(
          event.requestId,
          event.message,
          true,
        );
      }),
    );

    this.subscriptions.add(
      this.chat.connection$.subscribe((status) => {
        this.connectionMessage = status.connected ? '' : (status.message ?? '');
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.superseded$.subscribe((event) => {
        if (!event.requestId) {
          return;
        }
        this.handleSuperseded(event.requestId, event.reason);
      }),
    );

    this.subscriptions.add(
      this.chat.token$.subscribe((event) => {
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        this.zone.run(() => {
          const current = this.assistantForRequest(event.requestId);
          if (!current) {
            return;
          }
          current.content += event.token;
          current.statusHint = 'Writing response…';
          if (event.requestId) {
            this.turnStatusService.updateMessage(event.requestId, 'Writing response…', 'writing');
          }
          this.voice.speakStreamAppend(event.token);
          this.scrollToBottom();
          this.cdr.markForCheck();
        });
      }),
    );

    this.subscriptions.add(
      this.chat.thinking$.subscribe((event) => {
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        this.zone.run(() => {
          const current = this.assistantForRequest(event.requestId);
          if (!current) {
            return;
          }
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
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        const current = this.assistantForRequest(event.requestId);
        if (!current) {
          return;
        }
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
        if (event.requestId) {
          this.turnStatusService.updateFromStatus(
            event.requestId,
            event.conversationId ?? this.conversationId,
            event,
          );
        }
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.started$.subscribe((event) => {
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        const current = this.assistantForRequest(event.requestId);
        if (!current) {
          return;
        }
        current.statusHint = 'Connected, sir…';
        if (event.requestId) {
          this.turnStatusService.updateMessage(event.requestId, 'Connected, sir…', 'accepted');
        }
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.heartbeat$.subscribe((event) => {
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        const current = this.assistantForRequest(event.requestId);
        if (!current) {
          return;
        }
        if (!current.content?.trim() && current.streaming) {
          current.statusHint = current.tools?.some((t) => t.running)
            ? 'Running a check, sir…'
            : 'Still working, sir…';
          if (event.requestId) {
            this.turnStatusService.markSlow(event.requestId);
          }
          this.cdr.markForCheck();
        }
      }),
    );

    this.subscriptions.add(
      this.chat.toolStart$.subscribe((event) => {
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        const current = this.assistantForRequest(event.requestId);
        if (!current) {
          return;
        }
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
        if (event.requestId) {
          this.turnStatusService.updateFromStatus(event.requestId, event.conversationId ?? this.conversationId, {
            stage: 'tool',
            message: label,
            toolName: event.toolName,
          });
        }
        this.scrollToBottom();
        this.cdr.markForCheck();
      }),
    );

    this.subscriptions.add(
      this.chat.toolEnd$.subscribe((event) => {
        if (!this.acceptStreamEvent(event.requestId)) {
          return;
        }
        const current = this.assistantForRequest(event.requestId);
        if (!current) {
          return;
        }
        const tool = current.tools?.find(
          (t) => t.running && t.toolName === event.toolName,
        ) ?? current.tools?.find((t) => t.running);
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
        if (event.toolName === 'brain' || isBrainMutationToolOutput(event.output ?? '')) {
          this.brainGraph.requestRefresh();
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
        if (event.superseded) {
          if (event.requestId) {
            this.handleSuperseded(event.requestId);
          }
          return;
        }
        if (!event.requestId) {
          return;
        }
        const current = this.assistantForRequest(event.requestId, true);
        if (!current) {
          return;
        }
        current.content = event.finalText || current.content;
        current.streaming = false;
        current.statusHint = undefined;
        current.interactionId = event.interactionId;
        current.tools = this.compactToolBadges(current.tools);
        this.turnStatusService.completeTurn(event.requestId);
        this.completeActiveRequest(event.requestId);
        if (event.finalText?.includes('BRAIN_GRAPH:') || /\bOpening your brain graph\b/i.test(event.finalText ?? '')) {
          this.brainGraph.open();
        }
        if (/\b(Vault now has \d+ notes|Graph now has \d+ notes|Brain cleaned up|Brain vault is tidy)\b/i.test(event.finalText ?? '')) {
          this.brainGraph.requestRefresh();
        }
        if (!current.content?.trim()) {
          this.messages.splice(findAssistantIndex(this.messages, event.requestId), 1);
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
        if (!event.requestId) {
          return;
        }
        this.handleStreamFailure(event.requestId, event.message || 'Something went wrong, sir.', event.retryable ?? true);
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
    const run = (): void => {
      const anchor = this.bottomAnchor?.nativeElement;
      if (anchor) {
        anchor.scrollIntoView({ block: 'end', behavior: 'auto' });
        return;
      }
      const el = this.scrollPane?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    };
    // OnPush: wait until Angular paints new bubbles, then pin to latest message.
    this.zone.runOutsideAngular(() => {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          run();
          requestAnimationFrame(run);
        });
      });
    });
  }

  send(): void {
    const text = this.input.trim();
    if (!text && !this.pendingImages.length) {
      return;
    }
    if (this.sendLock) {
      return;
    }
    const fingerprint = text.toLowerCase();
    const now = Date.now();
    if (
      fingerprint &&
      fingerprint === this.lastSendFingerprint &&
      now - this.lastSendAt < 90_000 &&
      (this.busy || this.turnStatus?.retryable || !!this.activeRequestId)
    ) {
      this.toast.add({
        severity: 'warn',
        summary: 'JARVIS',
        detail: 'That message is already in progress, sir — wait for the current reply or use Retry.',
      });
      return;
    }
    this.sendLock = true;
    this.lastSendFingerprint = fingerprint;
    this.lastSendAt = now;
    if (isBrainGraphRequest(text)) {
      this.brainGraph.open();
    }
    this.voice.stopSpeaking();
    this.voice.stopListening();
    this.voice.speakStreamReset();
    const images = [...this.pendingImages];
    const requestId = createChatRequestId();
    this.messages.push({
      role: 'user',
      content: text,
      requestId,
      pending: this.busy,
      createdAt: new Date().toISOString(),
      images: images.length ? images : undefined,
    });
    this.input = '';
    this.pendingImages = [];
    this.pendingImageFiles.clear();
    this.persistConversation();
    this.cdr.markForCheck();
    this.scrollToBottom();
    void this.prepareOutbound(requestId, text, images).finally(() => {
      this.sendLock = false;
      this.cdr.markForCheck();
    });
  }

  private async prepareOutbound(
    requestId: string,
    text: string,
    images: ChatImageAttachment[],
  ): Promise<void> {
    const history = this.buildHistoryBeforeRequest(requestId);
    const payloads: ChatImagePayload[] = [];
    for (const image of images.slice(0, MAX_IMAGES)) {
      const payload = await this.imageAttachmentToPayload(image);
      if (payload) {
        payloads.push(payload);
      }
    }
    const outbound: OutboundChatRequest = {
      requestId,
      text,
      history,
      images: payloads,
    };
    if (this.busy) {
      this.outboundQueue.push(outbound);
      this.queuedCount = this.outboundQueue.length;
      this.cdr.markForCheck();
      return;
    }
    this.dispatchOutbound(outbound);
  }

  private dispatchOutbound(outbound: OutboundChatRequest): void {
    const userIdx = findUserIndex(this.messages, outbound.requestId);
    if (userIdx >= 0) {
      this.messages[userIdx].pending = false;
    }
    this.lastRetryOutbound = outbound;
    this.messages.push({
      role: 'assistant',
      content: '',
      streaming: true,
      requestId: outbound.requestId,
      tools: [],
      createdAt: new Date().toISOString(),
    });
    this.activeRequestId = outbound.requestId;
    this.busy = true;
    this.queuedCount = this.outboundQueue.length;
    this.persistConversation();
    this.cdr.markForCheck();
    this.scrollToBottom();
    this.chat.sendMessage(
      this.conversationId,
      outbound.requestId,
      outbound.text,
      outbound.history,
      outbound.images.length ? outbound.images : undefined,
    );
  }

  private flushOutboundQueue(): void {
    if (this.busy || !this.outboundQueue.length) {
      this.queuedCount = this.outboundQueue.length;
      return;
    }
    const next = this.outboundQueue.shift();
    if (!next) {
      return;
    }
    this.queuedCount = this.outboundQueue.length;
    this.dispatchOutbound(next);
  }

  retryLastRequest(): void {
    const prior = this.lastRetryOutbound;
    if (!prior || this.busy || this.retryInFlight) {
      return;
    }
    this.retryInFlight = true;
    this.turnStatusService.completeTurn(prior.requestId);
    const idx = findAssistantIndex(this.messages, prior.requestId);
    if (idx >= 0) {
      this.messages.splice(idx, 1);
    }
    const userIdx = findUserIndex(this.messages, prior.requestId);
    if (userIdx >= 0) {
      this.messages.splice(userIdx, 1);
    }
    const requestId = createChatRequestId();
    this.messages.push({
      role: 'user',
      content: prior.text,
      requestId,
      createdAt: new Date().toISOString(),
      images: prior.images?.length
        ? prior.images.map((img, i) => ({
            url: '',
            name: `retry-${i}`,
            mimeType: img.mimeType,
          }))
        : undefined,
    });
    this.lastSendFingerprint = prior.text.toLowerCase();
    this.lastSendAt = Date.now();
    this.persistConversation();
    this.cdr.markForCheck();
    void this.prepareOutbound(requestId, prior.text, []).finally(() => {
      this.retryInFlight = false;
      this.cdr.markForCheck();
    });
  }

  private handleStreamFailure(requestId: string, message: string, retryable: boolean): void {
    const current = this.assistantForRequest(requestId, true);
    if (current) {
      current.content = message;
      current.streaming = false;
      current.statusHint = undefined;
    }
    this.turnStatusService.failTurn(
      requestId,
      this.conversationId,
      message,
      retryable,
    );
    this.completeActiveRequest(requestId);
    this.persistConversation();
    this.scrollToBottom();
    this.cdr.markForCheck();
    this.toast.add({ severity: 'error', summary: 'JARVIS', detail: message });
  }

  private handleSuperseded(requestId: string, reason = 'Superseded by a newer message.'): void {
    const current = this.assistantForRequest(requestId, true);
    if (current?.streaming) {
      current.content = reason;
      current.streaming = false;
      current.statusHint = undefined;
    } else if (current && !current.content?.trim()) {
      const idx = findAssistantIndex(this.messages, requestId);
      if (idx >= 0) {
        this.messages.splice(idx, 1);
      }
    }
    this.turnStatusService.completeTurn(requestId);
    if (this.activeRequestId === requestId) {
      this.completeActiveRequest(requestId);
    }
    this.persistConversation();
    this.cdr.markForCheck();
  }

  private completeActiveRequest(requestId: string): void {
    const userIdx = findUserIndex(this.messages, requestId);
    if (userIdx >= 0) {
      this.messages[userIdx].pending = false;
    }
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
    }
    this.busy = false;
    this.flushOutboundQueue();
  }

  private buildHistoryBeforeRequest(requestId: string): Array<{ role: string; content: string; createdAt?: string }> {
    const userIdx = findUserIndex(this.messages, requestId);
    const prior =
      userIdx > 0
        ? this.messages.slice(0, userIdx)
        : this.messages.filter((m) => m.requestId !== requestId);
    return this.historyStore.toPersisted(
      prior.filter((m) => !m.streaming && !m.pending && (m.content?.trim() || m.images?.length)),
    );
  }

  private acceptStreamEvent(requestId?: string): boolean {
    if (!requestId) {
      return false;
    }
    return findAssistantIndex(this.messages, requestId) >= 0;
  }

  private assistantForRequest(requestId?: string, includeCompleted = false): ChatMessage | undefined {
    if (!requestId) {
      return undefined;
    }
    const idx = findAssistantIndex(this.messages, requestId);
    if (idx < 0) {
      return undefined;
    }
    const message = this.messages[idx];
    if (!includeCompleted && !message.streaming) {
      return undefined;
    }
    return message;
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

  pinLastFact(message: ChatMessage): void {
    const text = message.content?.trim();
    if (!text) {
      return;
    }
    this.api.createFact(text.slice(0, 500), 'fact').subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Memory', detail: 'Fact pinned, sir.' });
      },
      error: () => {
        this.toast.add({ severity: 'warn', summary: 'Memory', detail: 'Could not pin fact.' });
      },
    });
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

  private loadBrainOpsStatus(): void {
    this.api.brainOpsStatus().subscribe({
      next: (status) => {
        this.brainOpsPaused = status?.paused !== false;
        this.brainOpsReason = status?.reason;
        this.cdr.markForCheck();
      },
      error: () => undefined,
    });
  }

  private loadHistory(): void {
    this.conversationId = this.conversationSession.resolveActiveConversationId();
    const local = this.historyStore.load(this.conversationId);
    this.api.conversationMessages(this.conversationId).subscribe({
      next: (stored) => {
        const merged = this.historyStore.mergeApiAndLocal(stored, local);
        this.messages = merged.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
        this.historyStore.save(this.conversationId, merged);
        if (stored.length === 0 && local.length > 0) {
          this.api.syncConversation(this.conversationId, local).subscribe({
            error: () => undefined,
          });
        }
        this.cdr.markForCheck();
        this.scrollToBottom();
        // History can paint late (recap panel + long list) — pin again after layout.
        setTimeout(() => this.scrollToBottom(), 50);
        setTimeout(() => this.scrollToBottom(), 250);
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
          this.cdr.markForCheck();
          this.scrollToBottom();
          setTimeout(() => this.scrollToBottom(), 50);
          setTimeout(() => this.scrollToBottom(), 250);
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
    this.historyStore.save(this.conversationId, persisted);
  }

  private syncToBackend(): void {
    const persisted = this.historyStore.load(this.conversationId);
    if (!persisted.length) {
      return;
    }
    this.api.syncConversation(this.conversationId, persisted).subscribe({
      error: () => undefined,
    });
  }

  private maybeRecap(): void {
    const recapKey = this.conversationSession.recapSessionKey(this.conversationId);
    if (this.recapStarted || !this.messages.length || sessionStorage.getItem(recapKey)) {
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
    this.api.conversationRecap(this.conversationId).subscribe({
      next: (res) => {
        const recap = res?.recap?.trim();
        if (recap && recap !== localRecap) {
          this.sessionRecap = recap;
          this.cdr.markForCheck();
        }
        sessionStorage.setItem(recapKey, '1');
      },
      error: () => {
        sessionStorage.setItem(recapKey, '1');
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
