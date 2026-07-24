export interface ToolActivity {
  toolName: string;
  label?: string;
  args?: Record<string, unknown>;
  output?: string;
  success?: boolean;
  running: boolean;
}

export interface ProgressStep {
  stage: string;
  message: string;
  percent?: number;
  detail?: string;
  toolName?: string;
  at: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  streaming?: boolean;
  statusHint?: string;
  thinking?: string;
  thinkingExpanded?: boolean;
  progress?: ProgressStep[];
  progressPercent?: number;
  tools?: ToolActivity[];
  images?: ChatImageAttachment[];
}

export interface ChatImageAttachment {
  url: string;
  name?: string;
  mimeType?: string;
}

export interface ChatImagePayload {
  mimeType: string;
  data: string;
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

export type BrainCategory = 'concept' | 'entity' | 'source' | 'session' | 'fact';

export interface BrainGraphNode {
  id: string;
  label: string;
  category: BrainCategory;
  linkCount: number;
}

export interface BrainGraphEdge {
  source: string;
  target: string;
  kind: 'link' | 'wiki';
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  updatedAt: string;
}

export interface GraphLayoutNode {
  id: string;
  label: string;
  category: BrainCategory;
  linkCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

