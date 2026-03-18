# Platform Support Guide

This document details the supported podcast platforms and URL formats.

## Supported Platforms

### 1. Apple Podcasts 🍎

**Supported URL Formats:**
- `https://podcasts.apple.com/us/podcast/.../id123456789`
- `https://podcasts.apple.com/podcast/episode/...`
- `https://itunes.apple.com/us/podcast/...`

**How it works:**
- Extracts episode metadata from page HTML
- Attempts to find RSS feed link
- Falls back to page scraping if RSS unavailable

**Limitations:**
- Some episodes may require Apple ID (not supported)
- Regional restrictions may apply

---

### 2. Xiaoyuzhou (小宇宙) 🇨🇳

**Supported URL Formats:**
- `https://www.xiaoyuzhoufm.com/episode/[episode-id]`
- `https://xyzfm.link/s/[share-id]`

**How it works:**
- Extracts episode data from page
- Attempts API call to get audio URL
- Falls back to HTML parsing

**Limitations:**
- Some episodes may be region-restricted
- API rate limits may apply

---

### 3. RSS Feeds 📡

**Supported URL Formats:**
- `https://example.com/feed.xml`
- `https://example.com/podcast.rss`
- `https://feeds.example.com/podcast`
- `https://anchor.fm/s/.../podcast/rss`

**Supported Formats:**
- RSS 2.0 (standard)
- Atom feeds
- iTunes podcast tags

**How it works:**
- Parses RSS/Atom XML
- Extracts podcast metadata
- Gets latest episode audio URL

**Limitations:**
- Must be publicly accessible
- Some feeds may require authentication (not supported)

---

### 4. Direct Audio URLs 🔊

**Supported Formats:**
- MP3 (`.mp3`)
- M4A/AAC (`.m4a`, `.aac`)
- WAV (`.wav`)
- OGG (`.ogg`)
- FLAC (`.flac`)

**How it works:**
- Direct download of audio file
- No metadata extraction

---

### 5. Generic Websites 🌐

**How it works:**
- Attempts to find audio elements in page
- Looks for RSS feed links
- Searches for audio file links

**Success rate varies** depending on website structure.

---

## URL Examples

### Valid URLs

```
# Apple Podcasts
https://podcasts.apple.com/us/podcast/the-daily/id1200361736
https://podcasts.apple.com/podcast/episode/title/id123456

# Xiaoyuzhou
https://www.xiaoyuzhoufm.com/episode/1234567890abcdef
https://xyzfm.link/s/abc123

# RSS Feeds
https://feeds.megaphone.fm/replyall
https://rss.art19.com/the-daily
https://feeds.simplecast.com/54nAGcIl

# Direct Audio
https://example.com/podcast/episode1.mp3
https://cdn.example.com/audio/file.m4a
```

---

## Troubleshooting

### "Cannot extract audio URL"

1. Check if the URL is publicly accessible
2. Try finding the RSS feed URL instead
3. For platforms requiring login, download audio manually and upload

### "Platform not supported"

1. Try the RSS feed URL if available
2. Download the audio file and upload directly
3. Submit a feature request for platform support

### Regional Restrictions

Some platforms block access from certain regions:
- Use a VPN if necessary
- Download audio manually and upload

---

## Adding New Platform Support

To add support for a new platform:

1. Add platform detection in `podcastService.js`
2. Implement extraction method
3. Test with various URL formats
4. Update this documentation

Example:

```javascript
detectPlatform(url) {
    // Add your platform check
    if (url.includes('your-platform.com')) {
        return 'yourplatform';
    }
    // ... existing checks
}

async extractYourPlatform(url) {
    // Implementation
}
```

---

## Platform Request

To request support for a new platform, please provide:
- Platform name and URL
- Example podcast/episode URLs
- Any available API documentation

Submit requests via GitHub Issues.
