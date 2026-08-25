import type { TaskType } from '../llm/task-router.service';

export interface BootstrapLessonDef {
  key: string;
  taskType: TaskType | 'general';
  lessonText: string;
}

export const BOOTSTRAP_LESSONS: BootstrapLessonDef[] = [
  {
    key: 'code-inspect-before-describe',
    taskType: 'tool_heavy',
    lessonText:
      'Before describing or quoting repo code, call self_improve inspect on cited paths this turn. Never invent file contents — if inspect fails, say inspect failed.',
  },
  {
    key: 'vercel-scheduler-disabled',
    taskType: 'coding',
    lessonText:
      'On Vercel/serverless, app.module sets scheduleModules=[] — no Nest @Cron on production. Desktop uses scheduler.service.ts; Vercel daily jobs need Vercel Cron + an API route.',
  },
  {
    key: 'new-skill-wiring',
    taskType: 'coding',
    lessonText:
      'New skills: register in backend/src/skills/skills.module.ts; entities under backend/src/skills/entities/. Never invent skill.yaml or backend/src/shared/ paths.',
  },
  {
    key: 'pr-merge-user-only',
    taskType: 'tool_heavy',
    lessonText:
      'Never merge a pull request unless the user explicitly says merge. A PR branch may get a preview deploy — production only updates when the user merges to main.',
  },
  {
    key: 'no-stub-skills',
    taskType: 'coding',
    lessonText:
      'Backend skills: persist with Postgres TypeORM entities, alert via send_email — not localStorage, empty TODO portfolios, or console.log notification stubs.',
  },
];
