import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jarvis.assistant',
  appName: 'J.A.R.V.I.S',
  webDir: 'dist/frontend/browser',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
