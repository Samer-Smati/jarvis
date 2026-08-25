export type MemoryType = 'fact' | 'preference' | 'project';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface MemoryContextBlock {
  facts: string[];
  preferences: string[];
  projects: string[];
  conversationHits: string[];
  lessons: string[];
  lessonIds: string[];
}

export interface RememberTypedInput {
  text: string;
  memoryType: MemoryType;
  source?: string;
  confidence?: number;
  key?: string;
  pinned?: boolean;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  tags?: string[];
}
