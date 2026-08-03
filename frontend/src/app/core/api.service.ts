import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuditEntry,
  EpisodicEvent,
  Lesson,
  LessonSourceInteraction,
  MemoryFact,
  PermissionGrant,
  Reminder,
  SkillInfo,
  StoredMessage,
  SystemStatus,
  TtsStatus,
  BrainGraph,
  BrainOpsStatus,
} from './models';
import { clientPlatform } from './platform.util';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl ? `${environment.apiUrl}/api` : '/api';

  constructor(private http: HttpClient) {}

  status(): Observable<SystemStatus> {
    return this.http.get<SystemStatus>(`${this.base}/status`);
  }

  skills(): Observable<SkillInfo[]> {
    return this.http.get<SkillInfo[]>(`${this.base}/skills`);
  }

  setSkillEnabled(name: string, enabled: boolean): Observable<unknown> {
    return this.http.post(`${this.base}/skills/${name}/enabled`, { enabled });
  }

  conversationMessages(conversationId: string): Observable<StoredMessage[]> {
    return this.http.get<StoredMessage[]>(`${this.base}/conversations/${conversationId}/messages`);
  }

  syncConversation(
    conversationId: string,
    messages: Array<{ role: string; content: string; createdAt?: string }>,
  ): Observable<{ ok: boolean; count: number }> {
    return this.http.post<{ ok: boolean; count: number }>(
      `${this.base}/conversations/${conversationId}/sync`,
      { messages },
    );
  }

  conversationRecap(conversationId: string): Observable<{ recap: string | null; source?: string }> {
    return this.http.get<{ recap: string | null; source?: string }>(
      `${this.base}/conversations/${conversationId}/recap`,
    );
  }

  audit(): Observable<AuditEntry[]> {
    return this.http.get<AuditEntry[]>(`${this.base}/audit`);
  }

  events(): Observable<EpisodicEvent[]> {
    return this.http.get<EpisodicEvent[]>(`${this.base}/events`);
  }

  facts(): Observable<MemoryFact[]> {
    return this.http.get<MemoryFact[]>(`${this.base}/memory/facts`);
  }

  pinFact(id: string, pinned: boolean): Observable<MemoryFact> {
    return this.http.patch<MemoryFact>(`${this.base}/memory/facts/${id}/pin`, { pinned });
  }

  forgetFact(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/memory/facts/${id}`);
  }

  createFact(text: string, memoryType: 'fact' | 'preference' | 'project' = 'fact'): Observable<MemoryFact> {
    return this.http.post<MemoryFact>(`${this.base}/memory/facts`, { text, memoryType, source: 'chat-pin' });
  }

  rateFeedback(id: string, rating: number, correction?: string): Observable<unknown> {
    return this.http.patch(`${this.base}/feedback/${id}`, { rating, correction });
  }

  feedbackDetail(id: string): Observable<{ interaction: LessonSourceInteraction | null }> {
    return this.http.get<{ interaction: LessonSourceInteraction | null }>(`${this.base}/feedback/${id}`);
  }

  lessons(): Observable<{ lessons: Lesson[]; grouped: Record<string, Lesson[]> }> {
    return this.http.get<{ lessons: Lesson[]; grouped: Record<string, Lesson[]> }>(`${this.base}/lessons`);
  }

  lessonDetail(id: string): Observable<{ lesson: Lesson | null; source: LessonSourceInteraction | null }> {
    return this.http.get<{ lesson: Lesson | null; source: LessonSourceInteraction | null }>(
      `${this.base}/lessons/${id}`,
    );
  }

  updateLesson(id: string, lessonText: string): Observable<Lesson> {
    return this.http.patch<Lesson>(`${this.base}/lessons/${id}`, { lessonText });
  }

  pinLesson(id: string, pinned: boolean): Observable<Lesson> {
    return this.http.patch<Lesson>(`${this.base}/lessons/${id}/pin`, { pinned });
  }

  approveLesson(id: string): Observable<Lesson> {
    return this.http.post<Lesson>(`${this.base}/lessons/${id}/approve`, {});
  }

  rejectLesson(id: string): Observable<Lesson> {
    return this.http.post<Lesson>(`${this.base}/lessons/${id}/reject`, {});
  }

  deleteLesson(id: string): Observable<Lesson> {
    return this.http.delete<Lesson>(`${this.base}/lessons/${id}`);
  }

  lessonsPruneDryRun(days = 30): Observable<{ count: number; candidates: Lesson[] }> {
    return this.http.post<{ count: number; candidates: Lesson[] }>(`${this.base}/lessons/prune-dry-run`, { days });
  }

  personaCompare(): Observable<{ active: string; draft: string; changed: boolean }> {
    return this.http.get<{ active: string; draft: string; changed: boolean }>(`${this.base}/persona/compare`);
  }

  voiceConfig(): Observable<{
    wakeWordEnabled: boolean;
    wakeWordEngine: string;
    sttPrimary: string;
    ttsPrimary: string;
    cloudSttFallback: boolean;
  }> {
    return this.http.get<{
      wakeWordEnabled: boolean;
      wakeWordEngine: string;
      sttPrimary: string;
      ttsPrimary: string;
      cloudSttFallback: boolean;
    }>(`${this.base}/voice/config`);
  }

  brainGraph(): Observable<BrainGraph> {
    return this.http.get<BrainGraph>(`${this.base}/brain/graph`);
  }

  brainOpsStatus(): Observable<BrainOpsStatus> {
    return this.http.get<BrainOpsStatus>(`${this.base}/brain/ops-status`);
  }

  brainOpsPause(reason?: string): Observable<BrainOpsStatus> {
    return this.http.post<BrainOpsStatus>(`${this.base}/brain/ops-pause`, { reason });
  }

  brainOpsResume(): Observable<BrainOpsStatus> {
    return this.http.post<BrainOpsStatus>(`${this.base}/brain/ops-resume`, {});
  }

  reminders(): Observable<Reminder[]> {
    return this.http.get<Reminder[]>(`${this.base}/reminders`);
  }

  killSwitch(): Observable<{ aborted: number }> {
    return this.http.post<{ aborted: number }>(`${this.base}/kill-switch`, {});
  }

  factoryReset(confirm: string): Observable<{
    ok: true;
    confirm: string;
    brainPageCount: number;
    cleared: Record<string, number>;
    conversationBlobsDeleted: number;
  }> {
    return this.http.post<{
      ok: true;
      confirm: string;
      brainPageCount: number;
      cleared: Record<string, number>;
      conversationBlobsDeleted: number;
    }>(`${this.base}/factory-reset`, { confirm });
  }

  setProvider(provider: string): Observable<{ provider: string }> {
    return this.http.post<{ provider: string }>(`${this.base}/provider`, { provider });
  }

  transcribeAudio(wavBlob: Blob): Observable<{ text: string }> {
    const form = new FormData();
    form.append('audio', wavBlob, 'recording.wav');
    return this.http.post<{ text: string }>(`${this.base}/voice/transcribe`, form);
  }

  ttsStatus(): Observable<TtsStatus> {
    return this.http.get<TtsStatus>(`${this.base}/voice/tts-status`);
  }

  synthesizeSpeech(text: string, lang?: string): Observable<Blob> {
    return this.http.post(`${this.base}/voice/synthesize`, { text, lang }, { responseType: 'blob' });
  }

  diagnostics(): Observable<{
    uptimeSec: number;
    memoryMb: { rss: number; heapUsed: number; external: number };
    llmEnsureMode: string;
    deferPiper: boolean;
    whisperModel: string;
    llmReady: boolean;
    llmModel?: string;
    llmError?: string;
  }> {
    return this.http.get<{
      uptimeSec: number;
      memoryMb: { rss: number; heapUsed: number; external: number };
      llmEnsureMode: string;
      deferPiper: boolean;
      whisperModel: string;
      llmReady: boolean;
      llmModel?: string;
      llmError?: string;
    }>(`${this.base}/diagnostics`);
  }

  permissions(): Observable<PermissionGrant[]> {
    return this.http.get<PermissionGrant[]>(`${this.base}/permissions`, {
      params: { platform: clientPlatform() },
    });
  }

  setPermission(scope: string, granted: boolean): Observable<unknown> {
    return this.http.post(`${this.base}/permissions/${scope}`, {
      granted,
      platform: clientPlatform(),
    });
  }
}
