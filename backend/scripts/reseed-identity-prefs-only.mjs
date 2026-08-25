/**
 * Re-seed structured identity preferences after newborn wipe.
 * Run: node scripts/reseed-identity-prefs-only.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const IDENTITY = [
  { key: 'user.name', value: 'Samer Smati' },
  { key: 'user.role', value: 'full-stack developer' },
  { key: 'user.former_employer', value: 'ArabyAds' },
  { key: 'user.industry', value: 'AdTech' },
  { key: 'user.region', value: 'GCC/MENA (Dubai)' },
];

const SOURCE = 'user_stated_2026-08-03';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Drop echo-prone about-me turn chunks (facts come from prefs now).
const delTurns = await c.query(
  `DELETE FROM memory_chunks
   WHERE "sourceType" = 'turn'
     AND (
       text ILIKE '%What do you know about me%'
       OR text ILIKE '%From memory, sir: User:%'
     )
   RETURNING id, LEFT(text, 120) AS text`,
);
console.log('Deleted echo turn chunks:', delTurns.rows.length);
for (const r of delTurns.rows) console.log(' -', r.id, r.text);

console.log('\nSeeding user_preferences + preference semantic rows…');
for (const pref of IDENTITY) {
  const existing = await c.query(
    `SELECT id FROM user_preferences WHERE key = $1 AND "forgottenAt" IS NULL`,
    [pref.key],
  );
  let prefId;
  if (existing.rows[0]) {
    const updated = await c.query(
      `UPDATE user_preferences
       SET value = $1, source = $2, pinned = true, confidence = 1, "updatedAt" = NOW()
       WHERE id = $3
       RETURNING id, key, value`,
      [pref.value, SOURCE, existing.rows[0].id],
    );
    prefId = updated.rows[0].id;
  } else {
    const inserted = await c.query(
      `INSERT INTO user_preferences (id, key, value, source, confidence, pinned, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 1, true, NOW(), NOW())
       RETURNING id, key, value`,
      [pref.key, pref.value, SOURCE],
    );
    prefId = inserted.rows[0].id;
  }

  const existingSem = await c.query(
    `SELECT id FROM semantic_memories
     WHERE text = $1 AND "memoryType" = 'preference' AND "forgottenAt" IS NULL`,
    [`${pref.key}: ${pref.value}`],
  );
  let semanticId;
  if (existingSem.rows[0]) {
    semanticId = existingSem.rows[0].id;
  } else {
    const sem = await c.query(
      `INSERT INTO semantic_memories (id, text, "memoryType", source, confidence, pinned, "createdAt", "updatedAt", "lastVerified")
       VALUES (gen_random_uuid(), $1, 'preference', $2, 1, true, NOW(), NOW(), NOW())
       RETURNING id, text`,
      [`${pref.key}: ${pref.value}`, SOURCE],
    );
    semanticId = sem.rows[0].id;
  }
  console.log(JSON.stringify({ preferenceId: prefId, key: pref.key, value: pref.value, semanticId }));
}

const prefs = await c.query(
  `SELECT id, key, value, source, pinned FROM user_preferences WHERE key LIKE 'user.%' ORDER BY key`,
);
console.log('\n=== Final user.* preferences ===');
for (const r of prefs.rows) console.log(JSON.stringify(r));

await c.end();
console.log('\nDone.');
