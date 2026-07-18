export type ClientPlatform = 'desktop' | 'web';

export function clientPlatform(): ClientPlatform {
  const ua = navigator.userAgent ?? '';
  return ua.includes('Electron') ? 'desktop' : 'web';
}

export function isDesktopClient(): boolean {
  return clientPlatform() === 'desktop';
}
