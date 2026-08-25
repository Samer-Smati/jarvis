import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BrainGraphService {
  private readonly openSubject = new BehaviorSubject<boolean>(false);
  private readonly refreshSubject = new Subject<void>();

  readonly open$ = this.openSubject.asObservable();
  readonly refresh$ = this.refreshSubject.asObservable();

  open(): void {
    this.openSubject.next(true);
  }

  close(): void {
    this.openSubject.next(false);
  }

  requestRefresh(): void {
    this.refreshSubject.next();
  }

  get isOpen(): boolean {
    return this.openSubject.value;
  }
}

export function isBrainGraphRequest(text: string): boolean {
  const t = text.trim();
  return /\b(graph|knowledge graph|mind map|link map|connections|what(?:'s| is) linked|show.*(?:graph|links|brain)|visuali[sz]e.*(?:brain|graph)|brain map|my brain)\b/i.test(
    t,
  );
}

export function isBrainGraphToolOutput(output: string): boolean {
  return output.includes('BRAIN_GRAPH:');
}

export function isBrainMutationToolOutput(output: string): boolean {
  return (
    isBrainGraphToolOutput(output) ||
    /Brain cleanup complete|Consolidated knowledge graph|Brain cleaned up|Relational mapping complete/i.test(output)
  );
}
