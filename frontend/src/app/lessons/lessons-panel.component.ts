import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Lesson, LessonSourceInteraction } from '../core/models';

@Component({
  selector: 'app-lessons-panel',
  templateUrl: './lessons-panel.component.html',
  styles: [
    `
      .lessons-page {
        max-width: 960px;
        margin: 0 auto;
        padding: 1rem;
      }
      .task-group {
        margin-bottom: 1.25rem;
      }
      .lesson-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.5rem;
        padding: 0.65rem;
        border: 1px solid rgba(0, 255, 170, 0.15);
        margin-bottom: 0.5rem;
      }
      .lesson-row.needs-review {
        border-color: rgba(255, 193, 7, 0.45);
      }
      .meta {
        font-size: 0.75rem;
        opacity: 0.75;
        margin-top: 0.35rem;
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        align-items: flex-end;
      }
      .edit-area {
        width: 100%;
        margin-top: 0.35rem;
      }
      .source-modal pre {
        white-space: pre-wrap;
        font-size: 0.75rem;
        max-height: 240px;
        overflow: auto;
      }
    `,
  ],
  standalone: false,
})
export class LessonsPanelComponent implements OnInit {
  grouped: Record<string, Lesson[]> = {};
  taskTypes: string[] = [];
  loading = true;
  sourceOpen = false;
  source: LessonSourceInteraction | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.api.lessons().subscribe({
      next: (res) => {
        this.grouped = res.grouped ?? {};
        this.taskTypes = Object.keys(this.grouped).sort();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  saveEdit(lesson: Lesson, text: string): void {
    if (!text?.trim()) {
      return;
    }
    this.api.updateLesson(lesson.id, text.trim()).subscribe({
      next: (updated) => {
        if (updated) {
          lesson.lessonText = updated.lessonText;
        }
      },
    });
  }

  togglePin(lesson: Lesson): void {
    this.api.pinLesson(lesson.id, !lesson.pinned).subscribe({
      next: (updated) => {
        if (updated) {
          lesson.pinned = updated.pinned;
        }
      },
    });
  }

  approve(lesson: Lesson): void {
    this.api.approveLesson(lesson.id).subscribe({
      next: () => this.reload(),
    });
  }

  reject(lesson: Lesson): void {
    this.api.rejectLesson(lesson.id).subscribe({
      next: () => this.reload(),
    });
  }

  archive(lesson: Lesson): void {
    this.api.deleteLesson(lesson.id).subscribe({
      next: () => this.reload(),
    });
  }

  openSource(lesson: Lesson): void {
    this.api.lessonDetail(lesson.id).subscribe({
      next: (res) => {
        this.source = res.source;
        this.sourceOpen = true;
      },
    });
  }

  closeSource(): void {
    this.sourceOpen = false;
    this.source = null;
  }

  formatDate(value?: string): string {
    if (!value) {
      return 'never';
    }
    return new Date(value).toLocaleDateString();
  }
}
