# The City Around You

Karachi civic intelligence hackathon MVP. A citizen reports a neighbourhood
problem **by text, photo, voice or video**; AI identifies the issue, decides
which municipal authority owns it, sets a priority, and the complaint is stored
in a SQLite database with its evidence attached.

---

## How to run

```bash
cd CWA
npm install
npm run dev
```

Then open **http://localhost:5000** — you will land on the sign-in page.

That's it — there is no build step and no database to provision. The SQLite file
is created on first run at `data/civic.db`, and demo complaints are seeded into
it so the dashboards aren't empty.

### Configure the AI engine

Settings live in `.env` (gitignored, created for you):

```ini
GEMINI_API_KEY=your-key-here
CIVIC_AI_PROVIDER=gemini
```

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY` | Optional, to run Claude instead |
| `CIVIC_AI_PROVIDER` | `gemini` \| `claude` \| `auto` \| `off` (default `auto`) |
| `GEMINI_MODEL` | Override the model (default `gemini-3.5-flash`) |
| `PORT` | HTTP port (default `5000`) |
| `DATA_DIR` | Where `civic.db` lives (default `./data`) |

On start the server prints which engine is active:

```
Civic AI: Gemini (gemini-3.5-flash) — channels: text, image, audio, video
```

With no key at all it prints `offline keyword triage` and still runs, so the app
never hard-fails during a demo.

### Reset the demo data

```bash
rm -rf data && npm run dev
```

---

## Pages and routing

The signed-out and signed-in halves of the app are **separate documents**, so
signing in is a real browser navigation, not a DOM swap:

| URL | Serves |
| --- | --- |
| `/login` | The sign-in / sign-up page (`login.html` + `login.js`) |
| `/` | Overview — the dashboard app (`index.html` + `app.js`) |
| `/report` `/reports` `/nearby` | Citizen views |
| `/cases` `/critical` `/clusters` | Authority views |
| `/people` `/rules` `/audit` | Admin views |
| `/case/CY-2401` | One case |

The server decides which document to serve based on the session cookie:

- Hitting any app URL signed out redirects to `/login?next=<where you were going>`,
  and you land back there after signing in.
- Hitting `/login` while signed in redirects to `/`.
- Signing out is a navigation to `/login`, so no signed-in state survives in memory.

Inside the app, every view has its own URL via the History API, so **refresh
stays put, the back button works, and case links are shareable**. The login page
does not load the dashboard bundle at all.

---

## Accounts

Everything behind the sign-in screen is scoped to the account you are signed in
as. There are three kinds:

| Account type | Can | Sees |
| --- | --- | --- |
| **Citizen** | File reports, confirm or dispute the resolution of their own | Their own reports, plus area activity |
| **Authority staff** | Accept cases, change status, mark resolved | **Only cases routed to their own organisation** |
| **Admin** | Oversee the platform | Everything, plus the audit history |

Citizens and authority staff self-register from the **Create account** tab.
Authority staff must pick which of the four organisations they work for — that
choice is what scopes their queue. Admin accounts are provisioned, never
self-registered (the API rejects `role: "admin"` on signup).

### Demo accounts

Seeded into an empty database. Password for all of them: `demo1234`

| Email | Account |
| --- | --- |
| `citizen@demo.pk` | Ayesha Khan — citizen |
| `kwsc@demo.pk` | Farhan Ali — KW&SC operations lead |
| `kwsc.field@demo.pk` | Shahid Iqbal — KW&SC field engineer (assigned to a seeded case) |
| `sswmb@demo.pk` | Imran Sheikh — SSWMB zonal supervisor |
| `kmc@demo.pk` | Rabia Qureshi — KMC roads engineer |
| `kelectric@demo.pk` | Hassan Mehmood — K-Electric field supervisor |
| `admin@demo.pk` | Nadia Hussain — platform administrator |

The sign-in screen has one-click buttons for each of these.

### How the scoping is enforced

Server-side, not by hiding buttons:

- `/api/dashboard` builds an authority account's list from `authority_id`, so a
  case belonging to another organisation is never sent to the browser.
- `GET`/`PATCH /api/complaints/:id` returns `403` if the case belongs to another
  authority, so a guessed case ID gets nothing.
- Only the citizen who filed a report can confirm or dispute its resolution.
- Citizens receive an empty audit log; only admins get the real one.

Passwords are hashed with scrypt (salted, per user) via `node:crypto`. Sessions
are opaque random tokens stored server-side and sent as an `httpOnly` cookie, so
page scripts can never read them and a session can be revoked.

### Managing accounts

Stored passwords are one-way hashes — `scrypt$<salt>$<hash>` — so there is no way
to read a password back out of the database, for you or for anyone who steals it.
If someone is locked out, set a new password rather than recovering the old one:

```bash
node scripts/users.js list
node scripts/users.js set-password <email> <new-password>
node scripts/users.js promote <email> authority kwsc
```

`set-password` also signs out that account's existing sessions, since a session
token stays valid after a password change otherwise.

---

## Assignment, contact and updates

A routed case is not much use if the citizen can't find out who is handling it,
so once an authority assigns a named officer:

- **The citizen sees a contact card** on their case — the officer's name, job
  title, organisation, and tap-to-call phone / email. They can chase up a visit
  directly instead of guessing.
- **The authority sees the citizen's number**, so a crew can call ahead.
- **Both sides share an update thread** on the case. Staff post what happens next
  ("crew scheduled tomorrow 9–12"), the citizen replies with detail or a chase-up.
  Enter sends; Shift+Enter adds a line.
- **Assigned staff get their own queue** — an *Assigned to me* view with a badge,
  separate from the whole organisation's caseload, including a count of cases
  where the citizen wrote last and is waiting on a reply.

Assigning also writes a timeline entry and posts an automatic note to the thread,
so the citizen is told who took the case without anyone having to remember.

### Who can see contact details

Contact details are the point of the feature, but they are **not public**:

| Viewer | Officer's phone/email | Citizen's phone | Update thread |
| --- | --- | --- | --- |
| The citizen who filed the case | ✅ | — | ✅ read + write |
| Staff of the handling authority | ✅ | ✅ | ✅ read + write |
| Admin | ✅ | ✅ | ✅ |
| Any other citizen | ❌ name and role only | ❌ | ❌ |

Enforced server-side in `forViewer()`: the redaction happens before the JSON is
sent, so a case someone isn't party to never carries a phone number in the
payload at all, and posting to a thread they aren't party to returns `403`.
A case can only be assigned to someone who actually works for the authority
handling it.

Phone numbers are optional at signup — the signup form explains what the number
will be used for, differently for citizens and staff.

---

## The four input channels

| Channel | What the citizen does | How the issue is identified |
| --- | --- | --- |
| **Text** | Types in English, Urdu or Roman Urdu | Sent as text |
| **Photo** | Takes or uploads a photo, optional caption | Sent as an image — the model reads the photo itself |
| **Voice** | Records a voice note in the browser | **Gemini:** the audio itself is sent and transcribed by the model. **Claude:** the browser transcribes with the Web Speech API first |
| **Video** | Records or uploads a short clip | Sent as video — the model watches it, including anything spoken. **Gemini only** |

The UI adapts to the active engine: the Video tab only appears when the engine
supports video, and the voice transcript box is marked optional when the engine
can listen to audio directly.

### Engine capabilities

| | Text | Photo | Voice | Video |
| --- | --- | --- | --- | --- |
| **Gemini** | ✅ | ✅ | ✅ native audio | ✅ |
| **Claude** | ✅ | ✅ | via browser transcript | ❌ |
| **Offline rules** | ✅ | stored, not analysed | via browser transcript | ❌ |

Media under 15 MB is sent inline; anything larger goes through the Gemini Files
API (upload → poll until `ACTIVE` → reference by URI), which matters because a
phone video easily exceeds the ~20 MB inline request cap.

---

## Guarding against invented evidence

This was the one genuinely dangerous failure found in testing, and it is worth
knowing about because it is not obvious.

**Given a silent or meaningless recording, the model does not report silence — it
invents a plausible complaint and transcribes words nobody said.** In testing, a
pure 440 Hz tone produced a fabricated Urdu complaint about uncollected garbage,
presented at 90% confidence. A fabricated transcript attached to a real case file
and forwarded to a government authority is a serious harm.

Three layers now prevent it:

1. **Capture-time gate (browser).** While recording, an `AnalyserNode` watches
   the live waveform. If the peak never rises above the silence floor, the
   recording is discarded and the citizen is told to check their microphone.
   A live level meter makes this visible as they speak.
2. **Server-side gate.** Uploaded WAV audio is scanned for a silent waveform and
   rejected with `400` before it ever reaches the model. (Only uncompressed WAV
   can be checked without a codec; compressed formats rely on layer 1.)
3. **Prompt and schema.** An `evidenceQuality` field (`No evidence` / `Unusable`
   / `Unclear` / `Clear`) gives the model a legitimate way to say "this told me
   nothing" instead of confabulating to fill a required field. The prompt makes
   the no-invented-transcripts rule outrank every other instruction, and forces
   confidence ≤ 20 and priority `Low` whenever evidence is unusable.

Verified behaviour after the fix:

| Input | Result |
| --- | --- |
| 440 Hz tone, no speech | `Unusable`, empty transcript, 10% confidence, `Other` |
| Pure silence | Rejected `400` before reaching the model |
| Abstract video animation | `Unusable`, 15% confidence, authenticity flagged |
| Genuine Roman Urdu report | `Sewage overflow` → KW&SC, `High`, 90% confidence |

The same honesty rules stop the model inventing locations, durations or
distances the citizen never gave — missing facts become `recommendedQuestions`
back to the citizen instead.

---

## Routing

The model picks one of four authorities, constrained by a JSON schema enum so it
can never invent one:

| Authority | Owns |
| --- | --- |
| KW&SC | Water, sewerage, drains, manholes |
| SSWMB | Garbage, dumping, construction waste |
| KMC | Roads, potholes, footpaths, road flooding |
| K-Electric | Streetlights, exposed wiring, power faults |

Priority follows documented rules (danger to life → Critical; a school, hospital,
market or transit hub nearby raises it one level).

---

## Database

SQLite via `node:sqlite` (built into Node 22.5+, so there is no native build
step). File at `data/civic.db`, gitignored.

| Table | Holds |
| --- | --- |
| `users` | Accounts: email, scrypt password hash, role, and the authority a staff member belongs to |
| `sessions` | Server-side session tokens, so sign-out actually revokes access |
| `case_messages` | The update thread between the citizen and the handling authority |
| `complaints` | One row per report, owned by `user_id`: channel, description/transcript, location, category, priority, authority, confidence, authenticity, and the full triage JSON |
| `attachments` | Photo, audio and video bytes as BLOBs, served from `/api/attachments/:id` |
| `timeline` | Per-case history, from submission to citizen confirmation |
| `audit` | Platform-level decision record |
| `authorities` | Configurable routing targets |

---

## API

Every endpoint except `/api/config` requires a session.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create a citizen or authority-staff account and sign in |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Revoke the session |
| `GET` | `/api/auth/me` | Current account, or `null` |
| `GET` | `/api/config` | Active engine, capabilities, limits, areas, authorities (public — signup needs the authority list) |
| `GET` | `/api/dashboard` | Complaints, authorities, audit and metrics |
| `POST` | `/api/triage` | Classify an intake **without** saving, so the citizen reviews first |
| `POST` | `/api/complaints` | Classify (or accept a reviewed analysis) and persist with attachments |
| `GET` | `/api/complaints/:id` | One complaint with attachments and timeline |
| `PATCH` | `/api/complaints/:id` | Authority status change, or citizen confirm/dispute |
| `POST` | `/api/complaints/:id/assign` | Assign a named officer (handling authority only) |
| `POST` | `/api/complaints/:id/messages` | Post an update to the case thread |
| `GET` | `/api/staff` | Colleagues available for assignment |
| `GET` | `/api/attachments/:id` | Serve a stored photo, voice note or video |

Media travels base64-encoded inside the JSON body: photos up to 8 MB, voice notes
up to 12 MB, video up to 40 MB.

---

## Project layout

```
server.js            HTTP server, auth routes, intake validation, persistence
ai.js                Shared prompt + schema, provider dispatch, offline fallback
providers/gemini.js  Gemini: text, image, audio, video (+ Files API for large media)
providers/claude.js  Claude: text, image
auth.js              Password hashing (scrypt), session cookies, signup validation
db.js                SQLite schema and queries
seed.js              Demo accounts + complaints, inserted once into an empty database
public/index.html    Dashboard app shell
public/app.js        Dashboard app + client-side routing
public/login.html    Sign-in / sign-up page (its own document)
public/login.js      Auth page logic
scripts/users.js     Account admin CLI (list, set-password, promote)
```

---

## Demo roles

Sign in with the demo accounts above:

- **Citizen** (`citizen@demo.pk`) — submit through all four channels, watch the triage, then confirm or dispute a resolution.
- **Authority** (`kwsc@demo.pk`, `sswmb@demo.pk`, `kmc@demo.pk`, `kelectric@demo.pk`) — each sees only its own queue. Sign in as two of them side by side to see the scoping.
- **Admin** (`admin@demo.pk`) — cross-authority metrics, intake-channel mix, routing rules, audit history.

## Scope notes

Authority handoff is simulated — no government system is contacted. The map is a
static demo graphic. Everything else (intake, AI triage, routing, storage,
retrieval, case lifecycle) is real.
