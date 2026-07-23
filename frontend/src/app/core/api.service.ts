import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuditEntry,
  EpisodicEvent,
  MemoryFact,
  PermissionGrant,
  Reminder,
  SkillInfo,
  StoredMessage,
  SystemStatus,
  TtsStatus,
  BrainGraph,
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

  brainGraph(): Observable<BrainGraph> {
    return this.http.get<BrainGraph>(`${this.base}/brain/graph`);
  }

  reminders(): Observable<Reminder[]> {
    return this.http.get<Reminder[]>(`${this.base}/reminders`);
  }

  killSwitch(): Observable<{ aborted: number }> {
    return this.http.post<{ aborted: number }>(`${this.base}/kill-switch`, {});
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
