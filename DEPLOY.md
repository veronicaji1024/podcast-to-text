# Deployment Guide

This guide covers deploying Podcast AI to various environments.

## Local Deployment

### Development Mode

```bash
# Install dependencies
npm install
pip3 install faster-whisper

# Setup environment
cp .env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

### Production Mode

```bash
# Run setup script
./quick-start.sh

# Or manually
npm install --production
pip3 install faster-whisper

# Start production server
npm start
# or
./start.sh
```

## Docker Deployment (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-slim

# Install Python and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip3 install faster-whisper

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Create temp directory
RUN mkdir -p server/temp

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server/index.js"]
```

Build and run:

```bash
# Build image
docker build -t podcast-ai .

# Run container
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=your_key \
  -v $(pwd)/server/temp:/app/server/temp \
  podcast-ai
```

## Cloud Deployment

### Railway/Render/Heroku

1. Fork/push code to GitHub
2. Connect to platform
3. Set environment variables:
   - `OPENAI_API_KEY`
   - `NODE_ENV=production`
4. Deploy

**Note**: These platforms may have limitations on:
- File upload size
- Temporary storage
- Processing time

### VPS/Dedicated Server

```bash
# SSH to server
ssh user@your-server

# Clone repository
git clone <repo-url>
cd podcast-to-text

# Install dependencies
npm install --production
pip3 install faster-whisper

# Setup environment
nano .env

# Install PM2 for process management
npm install -g pm2

# Start with PM2
pm2 start server/index.js --name podcast-ai

# Save PM2 config
pm2 save
pm2 startup
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Increase timeout for long processing
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
    proxy_read_timeout 600s;
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | OpenAI API key |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Environment mode |
| `WHISPER_MODEL` | No | base | Whisper model size |
| `WHISPER_DEVICE` | No | cpu | Device (cpu/cuda) |
| `WHISPER_COMPUTE_TYPE` | No | int8 | Compute precision |
| `TEMP_DIR` | No | ./server/temp | Temp files directory |
| `MAX_FILE_SIZE` | No | 500MB | Max upload size |

## Security Considerations

1. **API Keys**: Never commit `.env` file
2. **File Uploads**: Validate file types and sizes
3. **Rate Limiting**: Implement for production use
4. **HTTPS**: Use SSL certificate in production
5. **CORS**: Configure allowed origins

## Performance Optimization

### For High Traffic

1. Use Redis for job queue
2. Implement worker processes
3. Use CDN for static files
4. Enable gzip compression

### For Large Files

1. Increase timeout settings
2. Use chunked uploads
3. Implement progress tracking
4. Consider S3 for file storage

## Monitoring

### Logs

```bash
# View logs
pm2 logs podcast-ai

# Or with journald
journalctl -u podcast-ai -f
```

### Health Check

```bash
curl http://localhost:3000/api/health
```

## Backup

Backup these files regularly:
- `.env` - Configuration
- `server/temp/` - Processed results (if needed)

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=3001 npm start
```

### Permission Denied

```bash
# Fix permissions
chmod +x start.sh quick-start.sh

# Fix temp directory
chmod 755 server/temp
```

### Out of Memory

```bash
# Increase Node.js memory limit
node --max-old-space-size=4096 server/index.js
```

## Updates

```bash
# Pull latest code
git pull

# Update dependencies
npm update
pip3 install --upgrade faster-whisper

# Restart server
pm2 restart podcast-ai
```
