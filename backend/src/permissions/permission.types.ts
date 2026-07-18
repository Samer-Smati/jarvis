export type PermissionScope = 'browser' | 'pc_apps' | 'phone' | 'web_tab';

export interface PermissionGrant {
  scope: PermissionScope;
  granted: boolean;
  platform: 'desktop' | 'web';
  label: string;
  description: string;
  updatedAt?: string;
}

export interface PermissionRequest {
  id: string;
  conversationId: string;
  scope: PermissionScope;
  title: string;
  message: string;
}

export const PERMISSION_META: Record<
  PermissionScope,
  { label: string; description: string; desktopOnly: boolean }
> = {
  browser: {
    label: 'Browser control',
    description: 'Open links, focus tabs, and automate the default browser on this PC.',
    desktopOnly: true,
  },
  pc_apps: {
    label: 'PC applications',
    description: 'Launch and focus desktop applications on this PC (not available on web).',
    desktopOnly: true,
  },
  phone: {
    label: 'Phone / mobile devices',
    description: 'Control paired phones via the JARVIS mobile companion (requires pairing).',
    desktopOnly: false,
  },
  web_tab: {
    label: 'This browser tab only',
    description:
      'Limited automation inside the current JARVIS tab when using the web/PWA client. Cannot control other apps or the OS.',
    desktopOnly: false,
  },
};

export function scopeForDeviceTarget(target: string): PermissionScope | null {
  switch (target) {
    case 'browser':
      return 'browser';
    case 'pc_app':
      return 'pc_apps';
    case 'phone':
      return 'phone';
    case 'web_tab':
      return 'web_tab';
    default:
      return null;
  }
}
