# Getting Started with Podcast AI

Welcome to Podcast AI! This guide will help you get up and running in minutes.

## Prerequisites Check

Before starting, ensure you have:

- [ ] Node.js 18+ installed (`node -v`)
- [ ] Python 3.8+ installed (`python3 --version`)
- [ ] OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

## Quick Start (5 minutes)

### Step 1: Install Dependencies

```bash
# Navigate to project directory
cd podcast-to-text

# Run the quick setup script
./quick-start.sh
```

This will:
- Check prerequisites
- Install Node.js dependencies
- Install Python packages (faster-whisper)
- Create `.env` file from template

### Step 2: Configure Environment

Edit the `.env` file:

```bash
# Open in your favorite editor
nano .env
# or
vim .env
# or just use your IDE
```

Add your OpenAI API key:

```env
OPENAI_API_KEY=sk-your-actual-api-key-here
```

Optional settings:

```env
# Use a smaller/faster model
WHISPER_MODEL=base

# Use GPU if available (requires CUDA)
WHISPER_DEVICE=cuda
```

### Step 3: Start the Server

```bash
npm start
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║                    Podcast AI Server                       ║
║                                                            ║
║   🎧 智能播客转录与笔记提取服务                               ║
║                                                            ║
║   📍 Server: http://localhost:3000                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

### Step 4: Open in Browser

Navigate to: **http://localhost:3000**

## First Transcription

1. **Find a podcast URL**:
   - Try a Xiaoyuzhou link: `https://www.xiaoyuzhoufm.com/episode/...`
   - Or an RSS feed: `https://feeds.simplecast.com/...`
   - Or upload an audio file directly

2. **Paste the URL** in the input field

3. **Select options**:
   - Summary language (e.g., Chinese, English)
   - Detail level (Brief, Standard, Detailed)

4. **Click "Analyze Link"**

5. **Wait for processing**:
   - Link analysis: ~5-10 seconds
   - Audio download: Depends on file size
   - Transcription: ~1-2x audio duration
   - Summary: ~10-30 seconds

6. **View and download results**

## Example URLs to Try

### Xiaoyuzhou (小宇宙)
```
https://www.xiaoyuzhoufm.com/episode/1234567890abcdef
```

### RSS Feeds
```
https://feeds.simplecast.com/54nAGcIl
https://rss.art19.com/the-daily
```

### Direct Audio
```
https://example.com/podcast/episode.mp3
```

## Understanding the Output

### Summary Tab
- **Overview**: Brief description of the podcast
- **Key Topics**: Main subjects covered
- **Detailed Notes**: Organized content sections
- **Key Insights**: Important takeaways
- **Notable Quotes**: Memorable statements

### Transcript Tab
- Full word-for-word transcription
- Timestamps (if enabled)
- Speaker identification (when possible)

## Troubleshooting

### "faster-whisper not installed"

```bash
pip3 install faster-whisper
```

### "OpenAI API key not found"

1. Check `.env` file exists
2. Verify `OPENAI_API_KEY` is set correctly
3. Restart the server

### "Cannot extract audio URL"

- Check if the URL is publicly accessible
- Try the RSS feed URL instead
- Download the audio and upload directly

### Transcription is slow

- Use a smaller model: `WHISPER_MODEL=tiny`
- Enable GPU: `WHISPER_DEVICE=cuda` (if available)
- Process shorter podcasts first

## Next Steps

- Read [README.md](README.md) for detailed documentation
- Check [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) for supported platforms
- See [DEPLOY.md](DEPLOY.md) for production deployment

## Getting Help

If you encounter issues:

1. Check the server logs for error messages
2. Verify all prerequisites are installed
3. Try with a different podcast URL
4. Open an issue on GitHub

## Tips for Best Results

1. **Use clear audio**: Better audio quality = better transcription
2. **Shorter podcasts**: Start with 10-30 minute episodes
3. **Correct language**: Select the correct summary language
4. **Stable internet**: Required for downloading and API calls

Happy transcribing! 🎧
