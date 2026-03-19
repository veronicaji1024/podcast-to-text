# NOTEWAVE

> Turn any podcast into structured notes — instantly.

NOTEWAVE is a self-hosted web app that converts podcast episodes into clean, structured notes using cloud speech recognition and large language models. Paste a link, upload a file, and get a full transcript plus AI-generated notes in seconds.

---

## Features

- **Multi-platform ingestion** — supports Xiaoyuzhou (小宇宙), Apple Podcasts, RSS feeds, direct audio URLs, and file uploads (MP3, M4A, WAV)
- **Cloud ASR** — uses DashScope Paraformer for fast, accurate transcription; falls back to local Faster-Whisper automatically
- **Parallel processing** — audio download and ASR run concurrently so you never wait for both
- **Structured notes** — every episode produces a consistent template: metadata, topic breakdown, key quotes, and action items
- **Podcast library** — all processed episodes are saved to a local SQLite database and accessible any time
- **Chat with your podcast** — ask questions about any episode using the built-in AI chat
- **Export** — download transcripts and notes as Markdown or plain text

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML/CSS |
| Backend | Node.js + Express |
| Speech-to-text | DashScope Paraformer (cloud) / Faster-Whisper (local fallback) |
| LLM | Qwen via DashScope API |
| Database | SQLite (via better-sqlite3) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.8+ (for local Whisper fallback)
- A [DashScope API key](https://dashscope.aliyun.com/) (Alibaba Cloud)

### Installation

```bash
git clone https://github.com/veronicaji1024/podcast-to-text.git
cd podcast-to-text

npm install
pip3 install faster-whisper
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
# Required — your DashScope API key
OPENAI_API_KEY=your_dashscope_api_key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-plus

# ASR model (cloud speech recognition)
ASR_MODEL=paraformer-v2

# For local file uploads: expose files to cloud ASR
USE_TUNNEL=true   # development
USE_OSS=false     # set true + configure OSS for production
```

### Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Processing Pipeline

```
1. Parse URL / receive file upload
          ↓
2. Extract audio URL + metadata
          ↓
3. ┌─ Download audio (background) ─────────────┐
   └─ Cloud ASR transcription (immediate) ──────┘  ← parallel
          ↓
4. Generate structured notes (Qwen LLM)
          ↓
5. Save to library (SQLite)
```

If cloud ASR fails at step 3, the pipeline waits for the download to finish and retries with local Faster-Whisper.

---

## Notes Template

Each processed episode produces:

- **Metadata** — title, author, duration, date
- **Topic Breakdown** — main segments and themes
- **Key Quotes** — memorable lines with speaker context
- **Action Items** — takeaways and next steps

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/process` | POST | Submit a podcast URL for processing |
| `/api/upload` | POST | Upload a local audio file |
| `/api/status/:jobId` | GET | Poll job progress |
| `/api/library` | GET | List all saved episodes |
| `/api/library/:id` | GET | Get a single episode from library |
| `/api/chat/:jobId` | POST | Chat with a processed episode |
| `/api/download/:jobId/:type` | GET | Download transcript or notes |
| `/api/health` | GET | Health check |

---

## Project Structure

```
podcast-to-text/
├── public/
│   ├── index.html          # UI
│   ├── script.js           # Frontend logic
│   └── svgs/               # Podcast card illustrations
├── server/
│   ├── index.js            # Express server + processing pipeline
│   ├── utils.js            # Shared utilities
│   ├── whisper_transcribe.py
│   └── services/
│       ├── asrService.js       # DashScope cloud ASR
│       ├── openaiService.js    # Qwen LLM (notes + chat)
│       ├── chatService.js      # Per-episode chat
│       ├── podcastService.js   # URL parsing + audio download
│       ├── libraryService.js   # SQLite persistence
│       ├── jobManager.js       # In-memory job tracking
│       ├── fileUrlService.js   # Public URL generation for local files
│       └── audioInfoService.js
├── data/
│   └── podcasts.db         # SQLite database (auto-created)
├── .env.example
└── package.json
```

---

## Supported Platforms

| Platform | Example URL |
|----------|------------|
| Xiaoyuzhou | `https://www.xiaoyuzhoufm.com/episode/...` |
| Apple Podcasts | `https://podcasts.apple.com/...` |
| RSS feed | `https://example.com/feed.xml` |
| Direct audio | `https://example.com/episode.mp3` |
| File upload | MP3, M4A, WAV (up to 500 MB) |

---

## Local Whisper Models

Used automatically when cloud ASR is unavailable.

| Model | Speed | Accuracy | RAM |
|-------|-------|----------|-----|
| tiny | ⚡⚡⚡ | ★★ | ~1 GB |
| base | ⚡⚡ | ★★★ | ~1 GB |
| small | ⚡ | ★★★★ | ~2 GB |
| medium | 🐢 | ★★★★★ | ~5 GB |

Set `WHISPER_MODEL=base` in `.env` (default).

---

## License

MIT
