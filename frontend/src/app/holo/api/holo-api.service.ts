import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  treeToGroups,
  workspaceToGroups,
  type FolderDto,
  type WorkspaceGroupDto,
} from '../objects/holo-object.adapter';
import type { SceneGroup } from '../scene/scene-engine';

/** Which JARVIS entities to pull into the deck. Mirrors the backend's HoloSource. */
export type HoloSource = 'brain' | 'projects' | 'tasks' | 'memories' | 'events' | 'calendar' | 'all';

/**
 * The deck's only server contact: the workspace it renders, and the gesture
 * report it posts back. Both endpoints live in the existing holo controller —
 * no new backend was invented for the deck, and no JARVIS data is duplicated.
 */
@Injectable({ providedIn: 'root' })
export class HoloApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl ? `${environment.apiUrl}/api/holo` : '/api/holo';

  /**
   * Entities for one source, already adapted to scene groups. An empty deck is a
   * better failure than a broken one: the camera and tracking still work with no
   * vault behind them.
   */
  workspace(source: HoloSource = 'brain'): Observable<SceneGroup[]> {
    return this.http.get<WorkspaceGroupDto[]>(`${this.base}/workspace`, { params: { source } }).pipe(
      map(workspaceToGroups),
      // Older backends only have /tree; fall back rather than showing nothing.
      catchError(() => this.tree()),
    );
  }

  tree(): Observable<SceneGroup[]> {
    return this.http.get<FolderDto[]>(`${this.base}/tree`).pipe(
      map(treeToGroups),
      catchError(() => of([])),
    );
  }

  /**
   * Fire-and-forget interaction report. The backend debounces these into the
   * episodic log, so a dropped one costs nothing and must never surface as an
   * error over the scene.
   */
  report(event: string, card?: string): void {
    this.http
      .post(`${this.base}/state`, { event, card })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }
}
