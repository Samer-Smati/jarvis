import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BrainGraphService {
  private readonly openSubject = new BehaviorSubject<boolean>(false);
  readonly open$ = this.openSubject.asObservable();

  open(): void {
    this.openSubject.next(true);
  }

  close(): void {
    this.openSubject.next(false);
  }

  get isOpen(): boolean {
    return this.openSubject.value;
  }
}

export function isBrainGraphRequest(text: string): boolean {
  const t = text.trim();
  return /\b(graph|knowledge graph|mind map|link map|connections|what(?:'s| is) linked|show.*links|visuali[sz]e.*brain|brain map)\b/i.test(
    t,
  );
}
