export interface ToolActivity {
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  success?: boolean;
  running: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  streaming?: boolean;
  tools?: ToolActivity[];
}

export interface ConfirmationRequest {
  id: string;
  conversationId: string;
  skillName: string;
  description: string;
  arguments: Record<string, unknown>;
}

export interface PermissionRequest {
  id: string;
  conversationId: string;
  scope: string;
  title: string;
  message: string;
}

export interface PermissionGrant {
  scope: string;
  granted: boolean;
  platform: 'desktop' | 'web';
  label: string;
  description: string;
  updatedAt?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  enabled: boolean;
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  fired: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  trigger: string;
  detail: string;
  outcome: string;
  createdAt: string;
}

export interface EpisodicEvent {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
}

export interface MemoryFact {
  id: string;
  text: string;
  createdAt: string;
}

export interface SystemStatus {
  provider: string;
  llmReady?: boolean;
  llmModel?: string;
  llmError?: string;
  activeRuns: number;
  pendingConfirmations: ConfirmationRequest[];
}

export interface TtsStatus {
  ready: boolean;
  engine: 'piper' | 'none';
  model?: string;
  error?: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}
