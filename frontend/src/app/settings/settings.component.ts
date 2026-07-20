import { Component, OnInit } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ApiService } from '../core/api.service';
import { SkillInfo, PermissionGrant } from '../core/models';
import { isDesktopClient } from '../core/platform.util';
import { isPerformanceMode, setPerformanceMode } from '../core/performance.util';
import { VoiceService } from '../core/voice.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  standalone: false,
})
export class SettingsComponent implements OnInit {
  readonly allProviders = [
    { label: 'Grok (xAI cloud)', value: 'xai' },
    { label: 'Groq Cloud (free online)', value: 'groq' },
    { label: 'LM Studio (local)', value: 'lmstudio' },
    { label: 'Ollama (local)', value: 'ollama' },
    { label: 'Claude API', value: 'claude' },
  ];
  readonly onlineProviders = [
    { label: 'Grok (xAI cloud)', value: 'xai' },
    { label: 'Groq Cloud (free online)', value: 'groq' },
    { label: 'Claude API', value: 'claude' },
  ];
  get providers() {
    return this.isDesktop ? this.allProviders : this.onlineProviders;
  }
  ttsEngines = [
    { label: 'Piper (local neural)', value: 'piper' },
    { label: 'Browser (OS voices)', value: 'browser' },
  ];
  sttEngines = [
    { label: 'Whisper (local, default)', value: 'whisper' },
    { label: 'Browser (fast)', value: 'browser' },
  ];
  selectedProvider = 'xai';
  skills: SkillInfo[] = [];
  voiceEnabled: boolean;
  ttsSupported: boolean;
  ttsEngine: 'piper' | 'browser';
  sttEngine: 'whisper' | 'browser';
  wakeWordEnabled: boolean;
  piperReady = false;
  piperModel?: string;
  isDesktop = isDesktopClient();
  devicePermissions: PermissionGrant[] = [];
  performanceMode = isPerformanceMode();
  diagnostics?: {
    uptimeSec: number;
    memoryMb: { rss: number; heapUsed: number };
    llmEnsureMode: string;
    deferPiper: boolean;
    whisperModel: string;
    llmReady: boolean;
  };

  constructor(
    private api: ApiService,
    private toast: MessageService,
    private voice: VoiceService,
  ) {
    this.voiceEnabled = voice.enabled;
    this.ttsSupported = voice.ttsSupported;
    this.ttsEngine = voice.ttsEngine;
    this.sttEngine = voice.sttEngine;
    this.wakeWordEnabled = voice.wakeWord;
  }

  ngOnInit(): void {
    this.api.status().subscribe({
      next: (status) => {
        const provider = status?.provider ?? 'groq';
        if (!this.isDesktop && (provider === 'lmstudio' || provider === 'ollama')) {
          this.selectedProvider = 'groq';
          this.changeProvider('groq');
        } else {
          this.selectedProvider = provider;
        }
      },
    });
    this.api.skills().subscribe({ next: (skills) => (this.skills = skills) });
    this.loadPermissions();
    this.loadDiagnostics();
    void this.voice.refreshTtsStatus().then((status) => {
      this.piperReady = !!status?.ready;
      this.piperModel = status?.model;
      if (this.ttsEngine === 'piper' && !this.piperReady) {
        this.toast.add({
          severity: 'warn',
          summary: 'Voice',
          detail: 'Piper is not ready yet — browser voice will be used until the model loads.',
        });
      }
    });
  }

  changeProvider(provider: string): void {
    this.api.setProvider(provider).subscribe({
      next: () =>
        this.toast.add({ severity: 'success', summary: 'Provider', detail: `Switched to ${provider}.` }),
      error: (err) =>
        this.toast.add({
          severity: 'error',
          summary: 'Provider',
          detail: err?.error?.message ?? 'Failed to switch provider.',
        }),
    });
  }

  toggleVoice(): void {
    this.voice.setEnabled(this.voiceEnabled);
  }

  changeTtsEngine(engine: 'piper' | 'browser'): void {
    this.voice.setTtsEngine(engine);
    this.ttsEngine = engine;
    if (engine === 'piper') {
      void this.voice.refreshTtsStatus().then((status) => {
        this.piperReady = !!status?.ready;
        this.piperModel = status?.model;
        if (!this.piperReady) {
          this.toast.add({
            severity: 'warn',
            summary: 'Voice',
            detail: 'Piper is not ready — browser voice will be used as fallback.',
          });
        }
      });
    }
  }

  changeSttEngine(engine: 'whisper' | 'browser'): void {
    this.voice.setSttEngine(engine);
    this.sttEngine = engine;
  }

  toggleWakeWord(): void {
    this.voice.setWakeWord(this.wakeWordEnabled);
  }

  testVoice(): void {
    void this.voice.speakAsJarvis('All systems operational. At your service, sir.');
  }

  toggleSkill(skill: SkillInfo): void {
    this.api.setSkillEnabled(skill.name, skill.enabled).subscribe({
      next: () =>
        this.toast.add({
          severity: 'info',
          summary: 'Skills',
          detail: `${skill.name} ${skill.enabled ? 'enabled' : 'disabled'}.`,
        }),
    });
  }

  loadPermissions(): void {
    this.api.permissions().subscribe({
      next: (grants) => (this.devicePermissions = grants ?? []),
    });
  }

  permissionDisabled(grant: PermissionGrant): boolean {
    return !this.isDesktop && grant.scope !== 'web_tab' && grant.scope !== 'phone';
  }

  togglePermission(grant: PermissionGrant): void {
    if (this.permissionDisabled(grant)) {
      grant.granted = false;
      this.toast.add({
        severity: 'warn',
        summary: 'Device permissions',
        detail: 'Browser and PC app control require the JARVIS desktop app.',
      });
      return;
    }
    this.api.setPermission(grant.scope, grant.granted).subscribe({
      next: () =>
        this.toast.add({
          severity: 'info',
          summary: 'Device permissions',
          detail: `${grant.label} ${grant.granted ? 'allowed' : 'revoked'}.`,
        }),
      error: (err) => {
        grant.granted = !grant.granted;
        this.toast.add({
          severity: 'error',
          summary: 'Device permissions',
          detail: err?.error?.message ?? 'Could not update permission.',
        });
      },
    });
  }

  togglePerformanceMode(): void {
    setPerformanceMode(this.performanceMode);
    if (this.performanceMode) {
      this.wakeWordEnabled = false;
      this.voice.setWakeWord(false);
      this.voice.setHandsFree(false);
    }
    this.toast.add({
      severity: 'info',
      summary: 'Performance mode',
      detail: this.performanceMode
        ? 'Reduced animations and idle voice disabled. Restart JARVIS desktop app to apply full boot optimizations.'
        : 'Performance mode off. Restart JARVIS desktop app to auto-load LLM/Piper at boot again.',
    });
  }

  loadDiagnostics(): void {
    this.api.diagnostics().subscribe({
      next: (data) => (this.diagnostics = data),
      error: () => undefined,
    });
  }

  killSwitch(): void {
    this.api.killSwitch().subscribe({
      next: (result) =>
        this.toast.add({
          severity: 'warn',
          summary: 'Kill switch',
          detail: `${result?.aborted ?? 0} run(s) halted.`,
        }),
    });
  }
}
