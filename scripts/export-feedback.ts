#!/usr/bin/env npx ts-node
/**
 * Export feedback interactions to JSONL for LoRA training.
 * Usage: npx ts-node scripts/export-feedback.ts --min-rating 4
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const minRatingIdx = args.indexOf('--min-rating');
const minRating = minRatingIdx >= 0 ? parseInt(args[minRatingIdx + 1] ?? '4', 10) : 4;
const apiBase = process.env.JARVIS_API_URL ?? 'http://localhost:3000';

async function main(): Promise<void> {
  const res = await fetch(`${apiBase}/api/feedback/export?minRating=${minRating}`);
  if (!res.ok) {
    throw new Error(`Export failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{
    prompt: string;
    response: string;
    correction?: string;
    rating?: number;
  }>;

  const lines = rows.map((row) => {
    const assistant = row.correction?.trim() || row.response;
    return JSON.stringify({
      messages: [
        { role: 'user', content: row.prompt },
        { role: 'assistant', content: assistant },
      ],
      rating: row.rating,
    });
  });

  const outPath = join(process.cwd(), 'data', 'feedback-export.jsonl');
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Exported ${lines.length} rows to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
