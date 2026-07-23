import { get, put } from '@vercel/blob';
import { BrainVault } from './brain.types';

const BLOB_PATH = 'jarvis/brain/vault.json';

export class BrainBlobStore {
  enabled(): boolean {
    return !!process.env.BLOB_READ_WRITE_TOKEN;
  }

  async load(): Promise<BrainVault | null> {
    if (!this.enabled()) {
      return null;
    }
    try {
      const result = await get(BLOB_PATH, { access: 'public' });
      if (!result?.stream) {
        return null;
      }
      const text = await new Response(result.stream).text();
      const data = JSON.parse(text) as BrainVault;
      return data?.version === 1 ? data : null;
    } catch {
      return null;
    }
  }

  async save(vault: BrainVault): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    await put(BLOB_PATH, JSON.stringify(vault), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  }
}
