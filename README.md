# Podcast AI 🎧

An intelligent podcast transcription and note-taking agent powered by Faster-Whisper and GPT-4.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features ✨

- 🔗 **Multi-Platform Support**: Apple Podcasts, Xiaoyuzhoufm (小宇宙), RSS feeds, and direct audio URLs
- 🚀 **High Performance**: Local Faster-Whisper model for fast, accurate speech-to-text
- 🤖 **AI-Powered**: GPT-4 optimized transcription and structured note extraction
- 🌍 **Smart Translation**: Auto-translates when summary language differs from detected language
- 📱 **Responsive UI**: Modern, mobile-first design
- 📄 **Export Options**: Download transcripts and summaries in multiple formats

## Quick Start 🚀

### Prerequisites

- Node.js 18+
- Python 3.8+
- OpenAI API Key

### Installation

```bash
# Clone or download the project
cd podcast-to-text

# Run quick setup
./quick-start.sh
```

Or manually:

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies
pip3 install faster-whisper

# Setup environment
cp .env.example .env
# Edit .env and add your OpenAI API key

# Start the server
npm start
```

Open http://localhost:3000 in your browser.

## Configuration ⚙️

Edit `.env` file:

```env
# Required
OPENAI_API_KEY=your_api_key_here

# Optional
PORT=3000
WHISPER_MODEL=base  # tiny, base, small, medium, large-v1, large-v2, large-v3
WHISPER_DEVICE=cpu  # cpu or cuda
NODE_ENV=production
```

### Whisper Models

| Model  | Speed | Accuracy | VRAM Required |
|--------|-------|----------|---------------|
| tiny   | ⚡⚡⚡  | ⭐⭐     | ~1 GB         |
| base   | ⚡⚡   | ⭐⭐⭐   | ~1 GB         |
| small  | ⚡    | ⭐⭐⭐⭐ | ~2 GB         |
| medium | 🐢    | ⭐⭐⭐⭐⭐| ~5 GB         |
| large  | 🐢🐢  | ⭐⭐⭐⭐⭐| ~10 GB        |

## Usage 📖

1. **Paste a podcast link** (Apple Podcasts, Xiaoyuzhou, RSS, or audio URL)
2. **Select options** (summary language, detail level)
3. **Click "Analyze Link"** and wait for processing
4. **View results**: Switch between summary notes and full transcript
5. **Download**: Save results as Markdown or plain text

### Supported Platforms

- **Apple Podcasts**: `https://podcasts.apple.com/...`
- **Xiaoyuzhou (小宇宙)**: `https://www.xiaoyuzhoufm.com/episode/...`
- **RSS Feeds**: `https://example.com/feed.xml`
- **Direct Audio**: `https://example.com/podcast.mp3`

## API Endpoints 🔌

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/process` | POST | Process podcast URL |
| `/api/upload` | POST | Upload audio file |
| `/api/status/:jobId` | GET | Get job status |
| `/api/download/:jobId/:type` | GET | Download result |
| `/api/health` | GET | Health check |

### Example API Usage

```bash
# Process a podcast URL
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.xiaoyuzhoufm.com/episode/xxx", "language": "zh"}'

# Check status
curl http://localhost:3000/api/status/your-job-id
```

## Project Structure 📁

```
podcast-to-text/
├── public/                 # Frontend files
│   ├── index.html         # Main UI
│   └── script.js          # Client logic
├── server/                # Backend
│   ├── index.js           # Express server
│   ├── whisper_transcribe.py  # Transcription script
│   └── services/          # Business logic
│       ├── podcastService.js
│       ├── openaiService.js
│       ├── audioInfoService.js
│       └── rssParser.js
├── .env                   # Environment config
├── package.json
└── README.md
```

## Processing Pipeline 🔄

1. **Link Analysis**: Parse URL and extract podcast metadata
2. **Audio Download**: Download audio from source
3. **Transcription**: Convert speech to text using Faster-Whisper
4. **Text Optimization**: AI-enhanced transcript refinement
5. **Summarization**: Generate structured notes with GPT-4

## Troubleshooting 🔧

### Common Issues

**Whisper model download fails**
```bash
# Models are auto-downloaded on first use
# If behind firewall, manually download from:
# https://huggingface.co/Systran/faster-whisper-
```

**CUDA out of memory**
```env
# Use CPU or smaller model
WHISPER_DEVICE=cpu
WHISPER_MODEL=base
```

**OpenAI API errors**
```bash
# Check your API key in .env file
# Verify network connectivity
# Check OpenAI service status
```

### Logs

```bash
# View detailed logs
DEBUG=* npm start

# Or check server output
npm start 2>&1 | tee server.log
```

## Development 💻

```bash
# Development mode with auto-reload
npm run dev

# Install dev dependencies
npm install --save-dev nodemon
```

## Performance Tips ⚡

1. **Use smaller models** for faster processing
2. **Enable GPU** if available: `WHISPER_DEVICE=cuda`
3. **Process shorter podcasts** first to test
4. **Monitor disk space** - temp files can be large

## License 📄

MIT License - see LICENSE file for details.

## Acknowledgments 🙏

- [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) - Fast speech recognition
- [OpenAI](https://openai.com/) - GPT-4 for text optimization
- [Tailwind CSS](https://tailwindcss.com/) - UI styling

## Support 💬

For issues and feature requests, please use GitHub Issues.

---

Made with ❤️ for podcast lovers everywhere
