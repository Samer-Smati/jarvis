import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { applyPerformanceModeClass } from './core/performance.util';
import { VoiceService } from './core/voice.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  speaking$: Observable<boolean>;
  listening$: Observable<boolean>;
  now = new Date();
  private clockTimer?: ReturnType<typeof setInterval>;

  constructor(
    voice: VoiceService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {
    this.speaking$ = voice.speaking$;
    this.listening$ = voice.listening$;
    this.zone.runOutsideAngular(() => {
      this.clockTimer = setInterval(() => {
        this.now = new Date();
        this.zone.run(() => this.cdr.markForCheck());
      }, 1000);
    });
  }

  ngOnInit(): void {
    applyPerformanceModeClass();
  }

  ngOnDestroy(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
    }
  }
}
