export type TurnStage =
  | 'queued'
  | 'accepted'
  | 'routing'
  | 'thinking'
  | 'tool'
  | 'writing'
  | 'waiting_user'
  | 'done'
  | 'error'
  | 'timeout';

export interface TurnStatusEvent {
  stage: TurnStage | string;
  message: string;
  percent?: number;
  detail?: string;
  toolName?: string;
  elapsedMs?: number;
  slow?: boolean;
  retryable?: boolean;
}

export interface ActiveTurnStatus {
  requestId: string;
  conversationId: string;
  stage: TurnStage | string;
  message: string;
  slow: boolean;
  retryable: boolean;
  isTerminal: boolean;
  startedAt: number;
  lastEventAt: number;
}

export interface ToolActivity {
  toolName: string;
  label?: string;
  args?: Record<string, unknown>;
  output?: string;
  success?: boolean;
  running: boolean;
}

export interface ProgressStep extends TurnStatusEvent {
  stage: string;
  at: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  requestId?: string;
  pending?: boolean;
  createdAt?: string;
  streaming?: boolean;
  statusHint?: string;
  thinking?: string;
  thinkingExpanded?: boolean;
  progress?: ProgressStep[];
  progressPercent?: number;
  tools?: ToolActivity[];
  images?: ChatImageAttachment[];
  interactionId?: string;
  feedback?: 'up' | 'down' | null;
  showCorrection?: boolean;
  correctionText?: string;
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
  memoryType?: 'fact' | 'preference' | 'project';
  pinned?: boolean;
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
  source?: 'vault' | 'pg' | 'seed';
  pageCount?: number;
  edgeCount?: number;
}

export interface BrainOpsStatus {
  paused: boolean;
  reason?: string;
  since?: string;
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

export type LessonStatus = 'active' | 'needs_review' | 'archived';

export interface Lesson {
  id: string;
  taskType: string;
  triggerContext: string;
  lessonText: string;
  confidenceScore: number;
  reinforcementCount: number;
  retrievalCount: number;
  sourceInteractionId?: string;
  status: LessonStatus;
  pinned: boolean;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonSourceInteraction {
  id: string;
  prompt: string;
  response: string;
  correction?: string;
  createdAt?: string;
  conversationId?: string;
  rating?: number;
  taskRoute?: string;
}

