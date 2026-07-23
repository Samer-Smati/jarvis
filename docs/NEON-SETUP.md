# Neon PostgreSQL + pgvector setup for JARVIS

JARVIS uses **Neon** (free) for permanent cloud memory and **pgvector** for fast semantic recall across every conversation.

## 1. Create a Neon database (free)

1. Go to [https://neon.tech](https://neon.tech) and sign up.
2. Create a project (e.g. `jarvis-brain`).
3. Open **Dashboard → Connection details**.
4. Copy the **Pooled connection** string (host contains `-pooler`). Example:

   ```
   postgresql://user:pass@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

5. pgvector is available on Neon by default — JARVIS runs `CREATE EXTENSION IF NOT EXISTS vector` on startup.

## 2. Local backend

Add to `backend/.env`:

```env
DATABASE_URL=postgresql://...your-neon-pooled-url...
GEMINI_API_KEY=your-key-from-aistudio.google.com
EMBED_PROVIDER=gemini
BLOB_READ_WRITE_TOKEN=vercel_blob_...
```

Restart the backend. On first boot JARVIS creates:

| Table | Purpose |
|-------|---------|
| `conversation_messages` | Every chat message (permanent) |
| `semantic_memories` | Explicit facts |
| `brain_pages` | Wiki pages mirrored from brain vault |
| `brain_edges` | Graph links |
| `memory_chunks` | Conversation chunks + **pgvector** embeddings |

## 3. Vercel deployment

In **Vercel → Project → Settings → Environment Variables**, add:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Neon **pooled** connection string |
| `GEMINI_API_KEY` | Yes | LLM + embeddings on cloud |
| `BLOB_READ_WRITE_TOKEN` | Yes | Brain wiki JSON vault |
| `GITHUB_TOKEN` | For self-upgrade | Repo write access |
| `GITHUB_REPO` | For self-upgrade | `Samer-Smati/jarvis` |

Redeploy after saving env vars.

## 4. Verify

1. Chat with JARVIS about any topic.
2. Ask: **"what do you know about me?"** or repeat a prior topic — semantic recall uses pgvector.
3. Say **"show me the graph"** — nodes grow as conversations are filed.
4. Call brain status — should show `PostgreSQL (Neon): N pages, M links, K vector chunks`.

## Architecture

```
Chat turn
  → learnFromTurn (wiki vault + Blob)
  → PostgreSQL brain_pages + brain_edges
  → memory_chunks + Gemini embedding (pgvector)
  → Next reply pulls similar past conversations into context
```

## Free tier limits

- **Neon**: ~0.5 GB storage — years of personal chat
- **Gemini API**: rate-limited but free for one user
- **Vercel Blob**: 1 GB on Hobby plan

Total cost for personal JARVIS: **$0**.
