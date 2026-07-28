import type { TaskType } from '../llm/task-router.service';

export type LessonStatus = 'active' | 'needs_review' | 'archived';

export interface LessonDraft {
  taskType: string;
  triggerContext: string;
  lessonText: string;
  confidenceScore: number;
  sourceInteractionId?: string;
  status?: LessonStatus;
}

export interface ExtractionResult {
  lesson_text: string;
  confidence_score: number;
  task_type_hint?: string;
}

export interface ContradictionResult {
  contradicts: boolean;
  reason?: string;
}

export interface RelevantLesson {
  id: string;
  lessonText: string;
  taskType: string;
  reinforcementCount: number;
  confidenceScore: number;
}

export interface MemoryLessonContext {
  texts: string[];
  ids: string[];
}

export interface CreateDirectLessonInput {
  lessonText: string;
  triggerContext: string;
  taskType?: TaskType | string;
  sourceInteractionId?: string;
}

export const LESSON_TASK_TYPES = [
  'quick_qa',
  'coding',
  'reasoning',
  'creative',
  'tool_heavy',
  'personal',
  'general',
] as const;
