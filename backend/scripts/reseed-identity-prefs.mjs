/**
 * Clean today's remember_fact junk and re-seed structured identity preferences.
 * Run: node scripts/reseed-identity-prefs.mjs
 */
import 'dotenv/config';
import pg from 'pg';
import { get, put } from '@vercel/blob';

const JUNK_SEMANTIC_IDS = [
  'f0d90287-2735-4912-abe2-6c00d45604fe',
  'fa322e78-a0d6-4fa4-98bd-c34de557249f',
  'eb2b2b62-d42a-4040-8383-0b3b06ef9f35',
  '4ae3c535-0027-467e-9a5a-dec99b8af754',
  'e637e754-16de-44c8-9898-ca4dc43e3616',
];

const JUNK_BRAIN_PATHS = [
  'facts/samer-smati-is-a-full-stack-developer-formerly-at-arabyads-adtec.md',
  'facts/the-user-s-name-is-samer-smati-and-they-are-a-full-stack-develop.md',
  'facts/the-user-has-brain-operations-paused-since-2026-08-03t08-39-33-5.md',
];

const IDENTITY = [
  { key: 'user.name', value: 'Samer Smati' },
  { key: 'user.role', value: 'full-stack developer' },
  { key: 'user.former_employer', value: 'ArabyAds' },
  { key: 'user.industry', value: 'AdTech' },
  { key: 'user.region', value: 'GCC/MENA (Dubai)' },
];

const SOURCE = 'user_stated_2026-08-03';
const BLOB_PATH = 'jarvis/brain/vault.json';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const delSem = await c.query(
  `DELETE FROM semantic_memories WHERE id = ANY($1::uuid[]) RETURNING id, LEFT(text, 80) AS text`,
  [JUNK_SEMANTIC_IDS],
);
console.log('Deleted semantic_memories:', delSem.rows.length);
for (const r of delSem.rows) console.log(' -', r.id, r.text);

const delBrain = await c.query(
  `DELETE FROM brain_pages WHERE path = ANY($1::text[]) RETURNING path`,
  [JUNK_BRAIN_PATHS],
);
console.log('Deleted brain_pages:', delBrain.rows.map((r) => r.path));

// Drop orphan wiki links to deleted facts from JARVIS entity in PG
const jarvis = await c.query(`SELECT path, content, links FROM brain_pages WHERE path = $1`, [
  'entities/jarvis.md',
]);
if (jarvis.rows[0]) {
  let content = jarvis.rows[0].content;
  for (const path of JUNK_BRAIN_PATHS) {
    const titleGuess = path.replace(/^facts\//, '').replace(/\.md$/, '');
    content = content.replace(new RegExp(`Related: \\[\\[[^\\]]*${titleGuess.slice(0, 20)}[^\\]]*\\]\\]\\n?`, 'gi'), '');
  }
  // simpler: remove Related lines that look like the junk titles
  content = content
    .split('\n')
    .filter(
      (line) =>
        !/Related: \[\[Samer Smati is a full-stack/i.test(line) &&
        !/Related: \[\[The user's name is Samer/i.test(line) &&
        !/Related: \[\[The user has brain operations paused/i.test(line),
    )
    .join('\n');
  await c.query(`UPDATE brain_pages SET content = $1, "updatedAt" = NOW() WHERE path = $2`, [
    content,
    'entities/jarvis.md',
  ]);
  console.log('Cleaned JARVIS entity related links in PG');
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (token) {
  const result = await get(BLOB_PATH, { access: 'public', useCache: false, token });
  if (result?.stream) {
    const text = await new Response(result.stream).text();
    const vault = JSON.parse(text);
    let removed = 0;
    for (const path of JUNK_BRAIN_PATHS) {
      if (vault.pages?.[path]) {
        delete vault.pages[path];
        removed += 1;
      }
    }
    if (vault.pages?.['entities/jarvis.md']) {
      const page = vault.pages['entities/jarvis.md'];
      page.content = String(page.content || '')
        .split('\n')
        .filter(
          (line) =>
            !/Related: \[\[Samer Smati is a full-stack/i.test(line) &&
            !/Related: \[\[The user's name is Samer/i.test(line) &&
            !/Related: \[\[The user has brain operations paused/i.test(line),
        )
        .join('\n');
      page.links = (page.links || []).filter(
        (l) => !JUNK_BRAIN_PATHS.includes(l) && !String(l).startsWith('facts/samer') && !String(l).startsWith('facts/the-user'),
      );
    }
    vault.updatedAt = new Date().toISOString();
    await put(BLOB_PATH, JSON.stringify(vault), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token,
    });
    console.log('Vault blob updated, removed pages:', removed);
  } else {
    console.warn('Could not load vault blob');
  }
} else {
  console.warn('BLOB_READ_WRITE_TOKEN missing — skipped vault blob cleanup');
}

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

  const sem = await c.query(
    `INSERT INTO semantic_memories (id, text, "memoryType", source, confidence, pinned, "createdAt", "updatedAt", "lastVerified")
     VALUES (gen_random_uuid(), $1, 'preference', $2, 1, true, NOW(), NOW(), NOW())
     RETURNING id, text`,
    [`${pref.key}: ${pref.value}`, SOURCE],
  );
  console.log(JSON.stringify({ preferenceId: prefId, key: pref.key, value: pref.value, semanticId: sem.rows[0].id }));
}

const prefs = await c.query(
  `SELECT id, key, value, source, pinned FROM user_preferences WHERE key LIKE 'user.%' ORDER BY key`,
);
console.log('\n=== Final user.* preferences ===');
for (const r of prefs.rows) console.log(JSON.stringify(r));

const remaining = await c.query(
  `SELECT id, LEFT(text, 100) AS text, source FROM semantic_memories WHERE "forgottenAt" IS NULL ORDER BY "createdAt"`,
);
console.log('\n=== Remaining active semantic_memories ===');
for (const r of remaining.rows) console.log(JSON.stringify(r));

await c.end();
console.log('\nDone.');
