export const PERFORMANCE_MODE_KEY = 'jarvis.performanceMode';

export function isPerformanceMode(): boolean {
  return localStorage.getItem(PERFORMANCE_MODE_KEY) !== 'false';
}

export function setPerformanceMode(on: boolean): void {
  localStorage.setItem(PERFORMANCE_MODE_KEY, String(on));
  applyPerformanceModeClass(on);
}

export function applyPerformanceModeClass(on?: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  const enabled = on ?? isPerformanceMode();
  document.body.classList.toggle('performance-mode', enabled);
}
