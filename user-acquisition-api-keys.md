# Quillium — Platforms & API Keys for Writer Acquisition

Status as of May 29, 2026. Already set up: **X/Twitter** (xurl CLI, OAuth 1.0).

---

## 1. Reddit (not worth it — deprecated)

**Why we're skipping:** Reddit's old "create a script app" flow no longer works. After the 2023 API changes, you now have to:

1. Register as a developer at https://developers.reddit.com/
2. Submit a formal request for API access (selecting "I'm a Developer" → "I want to register to use the Reddit API")
3. Wait for Reddit to review and approve your use case
4. Only then can you create apps

This is a multi-step review process, not a 5-minute form. Combined with the self-promo risk on r/writing, it's not worth the friction. Skip Reddit.

---

## 2. YouTube Data API (free tier, medium ROI)

**Why:** Find comments under writing tool review videos ("I wish there was a tool that...").

| Item | Value |
|---|---|
| **API cost** | Free tier: **10,000 quota units/day**. One search ≈ 100 units. One comment fetch ≈ 1 unit. You'd use < 1,000/day. |
| **CLI?** | No official CLI. Use **google-api-python-client** (`pip install google-api-python-client`). |
| **Setup time** | ~10 minutes |

### Setup steps

1. Go to https://console.cloud.google.com/
2. Create a new project (or reuse one) — name it `quillium-acquisition`
3. Enable the **YouTube Data API v3**
4. Go to **Credentials → Create Credentials → API Key**
5. Copy the key

**You'll give me:** The API key.

**Caveat:** YouTube automation is trickier. The flow is:
1. Search for videos ("Scrivener review", "best writing software 2025", "how to organize drafts")
2. Fetch comments under each video
3. Filter for "I wish..." / "does anything..." / complaining about versioning

Doable but more complex than Reddit. Your call if it's worth the setup.

---

## 3. Bluesky (needs an account)

**Why:** Growing writer community, no cold-reply block.

| Item | Value |
|---|---|
| **API cost** | Free (AT Protocol is open) |
| **CLI?** | **Yes** — `bsky` (npm: `@atproto/api`) or `atpr` (Rust). There's also `bluesky-cli` (Python) and `gassco` (Go). |
| **Setup time** | ~5 min **but requires an account** |

**You said you don't have an account, so skip unless you want to make one.** If you do:
1. Create an account at bsky.app
2. App password: Settings → Moderation → App Passwords → "Add App Password"
3. You'd give me: handle + app password

---

## 4. Everything else (no API → manual only)

| Platform | Approach |
|---|---|
| **Substack Notes** | Manual Google search: `site:substack.com/inbox/post "writing" "tool"` |
| **NaNoWriMo forums** | Manual search: `site:nanowrimo.org "draft management" OR "keep versions"` |
| **Absolute Write** | Manual search: `site:absolutewrite.com "writing software" OR "Scrivener"` |
| **Scribophile** | Create a free account, browse their forums manually |
| **YouTube comments** | If you don't set up the API, search YouTube manually for writing tool reviews and read comments |

---

## Summary: what to actually set up

| Priority | Platform | Effort | Signal |
|---|---|---|---|
| ~~**1**~~ | ~~Reddit~~ | ~~Blocked by new approval process~~ | ~~Skip~~ |
| **2** | YouTube (if worth it) | 10 min | Medium |
| **3** | Bluesky (needs account) | 5 min + signup | High |

**My recommendation (updated):** Skip Reddit. The approval process is too much overhead for just searching posts. YouTube is doable but complex. Realistically, the highest-effort-to-highest-signal platforms are:
1. **X/Twitter** — already set up ✅
2. **Bluesky** — if you make an account (easy, no approval)
3. **Substack Notes + writer forums** — manual search only, but no setup required

Or we focus on the channels you already have: your blog, X scheduling, and building more content.
