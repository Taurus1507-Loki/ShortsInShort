# ShortsInShort — Production-Ready AI Video Creation SaaS

> **Your Script. Your AI Editor. Your Video. Done.**  
> Create professional Instagram Reels, YouTube Shorts, and viral TikToks in minutes with automated AI video editing.

---

## 🚀 Overview

**ShortsInShort** is a scalable, enterprise-grade AI-powered video creation and automated post-production platform designed to produce viral Instagram Reels, YouTube Shorts, TikTok videos (`9:16`), and YouTube widescreen content (`16:9`). The platform transforms raw talking-head footage, simple text scripts, or authorized digital avatar assets into professionally edited videos with Submagic-grade animated captions, automatic silence removal, B-roll overlays, dynamic zooms, and intelligent audio ducking.

---

## 🎬 Three Core Video Creation Modules

### 1. Module A: AI Video Editor (`/dashboard` & `/projects/:id/editor`)
- **Raw Footage Ingestion**: Upload MP4/MOV talking-head recordings up to 250MB.
- **Silence Detection & Removal**: Inverts audio silence intervals using FFmpeg filtergraphs (`silencedetect=noise=-30dB:d=0.4`).
- **Karaoke Neon Subtitles**: Word-level synchronized timestamps generated as styled ASS subtitles (`\k` timing) with dynamic keyword highlighting.
- **Multi-Track Timeline**: Complete interactive visual tracks for Video Scene Cuts, Captions, B-roll Overlays, and Audio.
- **Interactive Deletion Shortcuts**: Click any timeline block (scene, caption, B-roll, or audio) and press `[Delete]` or `[Backspace]` to instantly remove or mute it.

### 2. Module B: AI Avatar Video Studio (`/avatars`)
- **Ethical Biometric Likeness Consent**: Explicit user declaration and immutable audit logging (IP address and timestamp) preventing unauthorized impersonation.
- **Digital Twin Management**: Manage authorized avatars with status tracking (`active`, `pending_verification`, `revoked`).
- **Multi-Provider AI Synthesis**: Integrations for HeyGen and D-ID avatars with realistic lip synchronization across 28+ languages.

### 3. Module C: Automated Faceless Video Creator (`/faceless`)
- **Viral Niche Templates**: Pre-configured scene pacing and B-roll categories for *Stoic Wisdom*, *Tech Explainer*, *Wealth & Psychology*, *Unsolved Mysteries*, and *Startup & Entrepreneurship*.
- **AI Scene-to-Script Planner**: Segments topic concepts into hooks, content chunks, visual descriptions, and B-roll tag queries.
- **AI Voiceover**: ElevenLabs and OpenAI TTS voice actors with intelligent auto-ducking (-18dB under speech).

---

## 🛠️ Architecture & Tech Stack

### Frontend Layer
- **Framework**: React 18 with TypeScript & Vite
- **Styling**: Tailwind CSS & Modern Dark Glassmorphism Design
- **Icons**: Lucide Icons
- **Routing**: React Router DOM v6
- **State & Auth**: Context API with JWT persistence & automatic session refresh
- **Video Studio**: Remotion Player canvas composition with real-time frame seeking and multi-track timeline

### Backend Services Layer
- **Runtime**: Node.js & TypeScript (ESM)
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose (Multi-tenant scoped schemas & compound indexes)
- **Validation**: Zod schema validation
- **Security**: Argon2/bcrypt password hashing, HTTP-only SameSite cookies, Helmet, CORS, Rate Limiting
- **Auditing**: Credit transaction ledger & Biometric Avatar Consent tracking

### Storage & Queue Infrastructure
- **Storage**: Multi-provider storage engine supporting AWS S3, Cloudflare R2, and local disk with presigned upload URLs.
- **Queue & Dead-Letter Refunds**: Asynchronous job tracker for background transcode workers with automatic credit refunds on render or API failure.

---

## ⌨️ Multi-Track Timeline Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `[Delete]` / `[Backspace]` | Deletes the currently selected Scene cut, Caption word, B-roll overlay, or Audio track |
| `[Escape]` | Deselects the active track element and returns focus to playback |
| `[Space]` | Toggles video playback (Play / Pause) |
| `[Enter]` / `[Space]` | Selects the currently focused timeline track item |
| `[Arrow Left / Right]` | Frame scrub / seek 1 second backward or forward |
| `[M]` | Toggles audio mute |

---

## 📦 Project Structure

```
ShortsInShort/
├── client/                     # Frontend Single Page Application (Vite + React + TS)
│   ├── src/
│   │   ├── components/         # Navbar, Footer, Sidebar, AppLayout
│   │   ├── context/            # AuthContext & Session management
│   │   ├── remotion/           # Remotion video player composition
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── EditorStudioPage.tsx # Multi-track video studio & [Delete] shortcuts
│   │   │   ├── AvatarStudioPage.tsx # AI Avatar Studio & Likeness Consent
│   │   │   ├── FacelessCreatorPage.tsx # Faceless Video Creator Wizard
│   │   │   ├── MediaLibraryPage.tsx # Asset storage & cloud media hub
│   │   │   ├── HelpSupportPage.tsx  # Shortcuts cheatsheet & help center
│   │   │   ├── AdminDashboardPage.tsx # Admin & revenue analytics
│   │   │   ├── BrandKitPage.tsx
│   │   │   ├── TemplatesPage.tsx
│   │   │   ├── BillingPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── services/           # API client with JWT interceptor
│   │   ├── types/              # TypeScript models (User, Project, Avatar, Scene, Word)
│   │   └── App.tsx             # Application routing
│   ├── Dockerfile              # Multi-stage Nginx production container
│   ├── nginx.conf              # Reverse proxy & SPA routing config
│   └── package.json
│
├── server/                     # Backend API & Services (Node.js + Express + TS)
│   ├── src/
│   │   ├── config/             # DB connection, Environment validation, Template seeds
│   │   ├── controllers/        # Auth, User, Project, Credit, Video, Avatar, Faceless, Admin
│   │   ├── middleware/         # Auth JWT, RBAC roles, Tenant Isolation, Error Handler
│   │   ├── models/             # User, Project, Subscription, CreditTransaction, AvatarConsent
│   │   ├── routes/             # Express API routes
│   │   ├── services/
│   │   │   ├── video/
│   │   │   │   ├── ffmpegService.ts        # FFmpeg transcode & ASS subtitle engine
│   │   │   │   └── videoPipelineService.ts # Orchestrator with auto-refund on failed render
│   │   │   ├── ai/
│   │   │   │   ├── aiService.ts            # Provider-agnostic AI orchestrator
│   │   │   │   ├── avatarProviders.ts      # HeyGen & D-ID adapters
│   │   │   │   ├── transcriptionProviders.ts # Whisper & Deepgram adapters
│   │   │   │   └── ttsProviders.ts          # ElevenLabs & OpenAI TTS adapters
│   │   │   ├── avatarService.ts            # Likeness consent & synthesis service
│   │   │   ├── facelessVideoService.ts     # Topic-to-scenes generator
│   │   │   ├── storage/storageService.ts   # S3 / Cloudflare R2 / Local storage
│   │   │   └── queue/queueService.ts       # Asynchronous background job queue
│   │   └── __tests__/          # Vitest integration test suites (12 tests passing)
│   ├── Dockerfile              # Multi-stage container with FFmpeg & fonts pre-installed
│   └── package.json
│
├── docker-compose.yml          # 1-Command Production Deployment (Mongo, Redis, Server, Client)
└── package.json                # Monorepo task runner
```

---

## 🐳 Quickstart with Docker Compose

To run the entire platform with MongoDB, Redis, the Node.js API with FFmpeg, and the Nginx React frontend in a single command:

```bash
docker compose up --build
```

- **Frontend**: `http://localhost`
- **Backend API**: `http://localhost:5000/api`
- **Health Check**: `http://localhost:5000/api/health`

---

## 💻 Local Development Setup

### 1. Install Dependencies
```bash
npm run install:all
```

### 2. Configure Environment
Create `.env` in `server/`:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/shortsinshort
JWT_ACCESS_SECRET=your_jwt_access_secret_key_12345
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_67890
CLIENT_URL=http://localhost:5173
STORAGE_PROVIDER=local
```

### 3. Start Development Servers
```bash
# Terminal 1: Backend
npm run server:dev

# Terminal 2: Frontend
npm run client:dev
```

### 4. Run Automated Tests
```bash
npm test
```
All 12 unit and integration tests across 3 test suites pass.
