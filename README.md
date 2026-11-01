# ShortsInShort — Production-Ready AI Video Creation SaaS

> **Your Script. Your AI Editor. Your Video. Done.**  
> Create professional Instagram Reels, YouTube Shorts, and viral TikToks in minutes with automated AI video editing.

---

## 🚀 Overview

**ShortsInShort** is a scalable, enterprise-grade AI-powered video creation and automated post-production platform designed to produce viral Instagram Reels, YouTube Shorts, TikTok videos (9:16), and YouTube widescreen content (16:9). The platform transforms raw talking-head footage, simple text scripts, or authorized digital avatar assets into professionally edited videos with Submagic-grade animated captions, automatic silence removal, B-roll overlays, and dynamic zooms.

---

## 🛠️ Tech Stack & Architecture

### Frontend Layer
- **Framework**: React 18 with TypeScript & Vite
- **Styling**: Tailwind CSS & Modern Dark Glassmorphism Design
- **Icons**: Lucide Icons
- **Routing**: React Router DOM v6
- **State & Auth**: Context API with JWT persistence & automatic session refresh
- **Video Studio**: Interactive HTML5 player with synchronized karaoke subtitles, multi-track timeline, and live inspector tabs

### Backend Services Layer
- **Runtime**: Node.js & TypeScript (ESM modules)
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose (Multi-tenant scoped schemas & compound indexes)
- **Validation**: Zod schema validation
- **Security**: Argon2/bcrypt password hashing, HTTP-only SameSite cookies, Helmet, CORS, Rate Limiting
- **Auditing**: Credit transaction ledger & Biometric Avatar Consent tracking

### Video Processing & AI Orchestration Layer
- **Video Engine**: FFmpeg 6.1 static binary & FFprobe inspection
  - Frame-accurate trimming and silence detection via `silencedetect=noise=-30dB:d=0.4`
  - Submagic/CapCut-grade Advanced SubStation Alpha (`.ass`) animated subtitles with karaoke timing (`\k`)
  - Aspect ratio transformation (9:16 vertical 1080x1920, 16:9 widescreen 1920x1080)
  - Poster thumbnail snapshot generation
- **Speech-to-Text (STT)**: Whisper / Deepgram word-level alignment with intelligent hook & keyword extraction
- **Stock Media & B-Roll**: Pexels Video API & curated CC0 royalty-free footage library
- **Voiceover & Audio**: Sidechain compressor & auto-ducking (-18dB) during active speech

---

## 📦 Project Structure

```
ShortsInShort/
├── client/                     # Frontend Single Page Application (Vite + React + TS)
│   ├── src/
│   │   ├── components/         # Navbar, Footer, Sidebar, AppLayout
│   │   ├── context/            # AuthContext & Session management
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── EditorStudioPage.tsx # Multi-track video studio & caption editor
│   │   │   ├── BrandKitPage.tsx
│   │   │   ├── TemplatesPage.tsx
│   │   │   ├── BillingPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── services/           # API wrapper with JWT interceptor
│   │   ├── types/              # TypeScript models (User, Project, Template, Credit, Scene, Word)
│   │   ├── utils/              # ClassName merge & formatters
│   │   ├── App.tsx             # Application routing
│   │   └── main.tsx            # App entrypoint
│   ├── tailwind.config.js      # Custom theme colors and keyframe animations
│   ├── vite.config.ts          # Vite build config with backend proxy
│   └── package.json
│
├── server/                     # Backend API & Services (Node.js + Express + TS)
│   ├── src/
│   │   ├── config/             # DB connection, Environment validation, Template seeds
│   │   ├── controllers/        # Auth, User, Project, Credit, Template, Video controllers
│   │   ├── middleware/         # Auth JWT, RBAC roles, Tenant Isolation, Error Handler, Zod validation
│   │   ├── models/             # User, Project, Subscription, CreditTransaction, Template, AvatarConsent
│   │   ├── routes/             # Express API routes (auth, users, projects, credits, templates, videos)
│   │   ├── services/
│   │   │   ├── authService.ts
│   │   │   ├── projectService.ts
│   │   │   ├── creditService.ts
│   │   │   ├── video/
│   │   │   │   ├── ffmpegService.ts        # FFmpeg/FFprobe transcode & ASS subtitle engine
│   │   │   │   └── videoPipelineService.ts # Orchestrator with auto-refund on failed render
│   │   │   └── ai/
│   │   │       ├── transcriptionService.ts # Word-level speech alignment & keyword highlighter
│   │   │       └── brollService.ts         # Semantic stock B-roll search
│   │   ├── utils/              # JWT helpers, bcrypt hashing, API response envelope
│   │   ├── __tests__/          # Vitest integration test suites
│   │   ├── app.ts              # Express configuration, static upload serving & security middleware
│   │   └── server.ts           # Server bootstrap & graceful shutdown
│   ├── uploads/                # Local media directories (raw, processed, thumbnails, audio)
│   ├── package.json
│   └── tsconfig.json
│
├── architecture_blueprint.md   # Detailed production architecture & schema documentation
└── package.json                # Monorepo task runner
```

---

## 💰 Indian Rupee (INR) Pricing & Credit System

| Plan Tier | Monthly Price (INR) | Annual Price (INR) | Monthly Credits | Video Resolution | Core Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Free Starter** | ₹0 | ₹0 | 10 Credits | 720p Fast | Watermarked exports, standard caption templates |
| **Starter** | ₹499/mo | ₹4,790/yr | 20 Credits | 1080p Full HD | No watermark, silence removal, basic B-roll |
| **Creator** | ₹999/mo | ₹9,590/yr | 50 Credits | 1080p Full HD | AI Avatar access, Submagic-style captions, B-roll ducking |
| **Pro Studio** | ₹1,999/mo | ₹19,190/yr | 120 Credits | 4K Ultra-HD | Priority GPU queue, 3 brand kits, 5 team seats |
| **Agency** | ₹4,999/mo | ₹47,990/yr | 350 Credits | 4K Ultra-HD | Multiple workspaces, 15 team seats, dedicated render node |

---

## 🏃 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **MongoDB**: Local `mongod` instance or MongoDB Atlas connection string

### 2. Installation
```bash
# Install server and client dependencies
npm run install:all
```

### 3. Running Development Servers
In two separate terminals:

```bash
# Terminal 1: Run Backend API (Port 5000)
cd server
npm run dev

# Terminal 2: Run Frontend UI (Port 5173)
cd client
npm run dev
```

- **Frontend Application**: `http://localhost:5173`
- **Backend API & Health**: `http://localhost:5000/api/health`

### 4. Running Backend Integration Tests
```bash
cd server
npm test
```
*Current test suite: 9 passed (100% success).*
