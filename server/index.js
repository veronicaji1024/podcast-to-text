/**
 * Podcast AI - Express Server
 * Main entry point for the backend API
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import services
const podcastService = require('./services/podcastService');
const openaiService = require('./services/openaiService');
const audioInfoService = require('./services/audioInfoService');
const jobManager = require('./services/jobManager');
const asrService = require('./services/asrService');
const fileUrlService = require('./services/fileUrlService');
const chatService = require('./services/chatService');

// Import utils
const { execPromise, cleanupFile, ensureDir, determineOutputLanguage } = require('./utils');

// Configuration
const PORT = process.env.PORT || 3000;

// 确保 TEMP_DIR 使用绝对路径并验证安全性
let TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname, 'temp');
if (!path.isAbsolute(TEMP_DIR)) {
    TEMP_DIR = path.resolve(__dirname, '..', TEMP_DIR);
}

// Security: Validate TEMP_DIR is within allowed boundaries to prevent path traversal
const allowedBasePath = path.resolve(__dirname, '..');
const resolvedTempDir = path.resolve(TEMP_DIR);

if (!resolvedTempDir.startsWith(allowedBasePath)) {
    console.error(`SECURITY ERROR: TEMP_DIR "${TEMP_DIR}" is outside allowed base path "${allowedBasePath}"`);
    throw new Error('Invalid TEMP_DIR configuration: path traversal detected');
}

// Normalize and use the validated path
TEMP_DIR = resolvedTempDir;
console.log(`Using TEMP_DIR: ${TEMP_DIR}`);

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024; // 500MB

// Ensure temp directory exists
ensureDir(TEMP_DIR);

// Express App
const app = express();

// Rate Limiters
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: { error: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for status endpoint (polled frequently)
    skip: (req) => req.path.startsWith('/api/status/')
});

const processLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 processing requests per hour
    message: { error: '处理请求过于频繁，每小时最多处理10个任务' },
    standardHeaders: true,
    legacyHeaders: false
});

const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 chat requests per 15 minutes
    message: { error: '聊天请求过于频繁，每15分钟最多30次对话' },
    standardHeaders: true,
    legacyHeaders: false,
    // Rate limit per job ID to prevent abuse of a single job
    keyGenerator: (req) => {
        return `${req.ip}-${req.params.jobId}`;
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));
app.use(generalLimiter); // Apply general rate limit to all routes (except /api/status)

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Job storage is now managed by jobManager service

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const jobId = uuidv4();
        const jobDir = path.join(TEMP_DIR, jobId);
        await ensureDir(jobDir);
        cb(null, jobDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp3';
        cb(null, `audio${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        // 支持更多音频格式，包括一些浏览器可能报告的非标准 MIME 类型
        const allowedMimes = [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
            'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/flac',
            'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'video/mp4',
            'application/octet-stream' // 某些浏览器可能将音频报告为此类型
        ];
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4'];

        if (file.mimetype.startsWith('audio/') ||
            allowedMimes.includes(file.mimetype) ||
            allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`不支持的文件格式: ${file.mimetype} (${ext})`));
        }
    }
});

// ==================== API Routes ====================

/**
 * Process podcast URL
 * POST /api/process
 */
app.post('/api/process', processLimiter, async (req, res) => {
    try {
        const { url, language = 'auto', detailLevel = 'standard' } = req.body;

        if (!url) {
            return res.status(400).json({ error: '请提供播客链接' });
        }

        // Create job using jobManager
        const jobDir = path.join(TEMP_DIR, uuidv4());
        await ensureDir(jobDir);

        const job = jobManager.createJob({
            url,
            language,
            detailLevel,
            dir: jobDir
        });

        // Start processing in background with error handling
        processPodcast(job).catch(async err => {
            console.error(`Podcast processing failed for job ${job.id}:`, err);

            // Cleanup resources on failure
            try {
                if (job.audioPath) {
                    await cleanupFile(job.audioPath).catch(e => console.error('Cleanup error:', e));
                }
                const transcriptPath = path.join(job.dir, 'transcript.txt');
                await cleanupFile(transcriptPath).catch(e => console.error('Cleanup error:', e));

                // Cleanup served file from tunnel/OSS
                if (job.audioPath) {
                    fileUrlService.removeServedFile(job.audioPath);
                }
            } catch (cleanupError) {
                console.error('Error during cleanup:', cleanupError);
            }

            jobManager.updateJob(job.id, {
                status: 'failed',
                error: err.message || '处理失败'
            });
        });

        res.json({ jobId: job.id, accessToken: job.accessToken, status: 'pending' });

    } catch (error) {
        console.error('Process error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Upload audio file
 * POST /api/upload
 */
app.post('/api/upload', processLimiter, upload.single('audio'), async (req, res) => {
    try {
        const { language = 'auto', detailLevel = 'standard' } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: '请上传音频文件' });
        }

        // Create job using jobManager
        const job = jobManager.createJob({
            url: null,
            audioPath: req.file.path,
            language,
            detailLevel,
            dir: path.dirname(req.file.path)
        });

        // Start processing in background with error handling
        processAudioFile(job).catch(async err => {
            console.error(`Audio processing failed for job ${job.id}:`, err);

            // Cleanup resources on failure
            try {
                if (job.audioPath) {
                    await cleanupFile(job.audioPath).catch(e => console.error('Cleanup error:', e));
                }
                const transcriptPath = path.join(job.dir, 'transcript.txt');
                await cleanupFile(transcriptPath).catch(e => console.error('Cleanup error:', e));

                // Cleanup served file from tunnel/OSS
                if (job.audioPath) {
                    fileUrlService.removeServedFile(job.audioPath);
                }
            } catch (cleanupError) {
                console.error('Error during cleanup:', cleanupError);
            }

            jobManager.updateJob(job.id, {
                status: 'failed',
                error: err.message || '处理失败'
            });
        });

        res.json({ jobId: job.id, accessToken: job.accessToken, status: 'pending' });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get job status
 * GET /api/status/:jobId
 */
app.get('/api/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobManager.getJob(jobId);

    if (!job) {
        return res.status(404).json({ error: '任务不存在或已过期' });
    }

    res.json({
        jobId: job.id,
        accessToken: job.accessToken,
        status: job.status,
        step: job.step,
        progress: job.progress,
        message: job.message,
        error: job.error,
        result: job.status === 'completed' ? job.result : null
    });
});

/**
 * Download result file
 * GET /api/download/:jobId/:type
 * Query param: token - access token for authorization
 */
app.get('/api/download/:jobId/:type', async (req, res) => {
    try {
        const { jobId, type } = req.params;
        const { token } = req.query;
        const job = jobManager.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: '任务不存在或已过期' });
        }

        // Validate access token
        if (!token || !jobManager.validateToken(jobId, token)) {
            return res.status(403).json({ error: '无效的访问令牌' });
        }

        if (job.status !== 'completed') {
            return res.status(400).json({ error: '任务尚未完成' });
        }

        let filePath;
        let filename;

        if (type === 'transcript') {
            filePath = path.join(job.dir, 'transcript.txt');
            filename = `${job.result.metadata?.title || 'transcript'}_转录.txt`;
        } else if (type === 'summary') {
            filePath = path.join(job.dir, 'summary.md');
            filename = `${job.result.metadata?.title || 'summary'}_笔记.md`;
        } else {
            return res.status(400).json({ error: '无效的文件类型' });
        }

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: '文件不存在' });
        }

        res.download(filePath, filename);

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Chat with podcast content
 * POST /api/chat/:jobId
 */
app.post('/api/chat/:jobId', chatLimiter, async (req, res) => {
    try {
        const { jobId } = req.params;
        const { message, history = [] } = req.body;
        const { token } = req.query;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: '请输入问题' });
        }

        // Input validation: limit message length to prevent abuse
        const MAX_MESSAGE_LENGTH = 2000;
        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({ error: `消息长度不能超过 ${MAX_MESSAGE_LENGTH} 字符` });
        }

        // Validate history array
        if (!Array.isArray(history) || history.length > 50) {
            return res.status(400).json({ error: '无效的对话历史' });
        }

        const job = jobManager.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: '任务不存在或已过期' });
        }

        // Validate access token
        if (!token || !jobManager.validateToken(jobId, token)) {
            return res.status(403).json({ error: '无效的访问令牌' });
        }

        if (job.status !== 'completed' || !job.result) {
            return res.status(400).json({ error: '任务尚未完成，无法进行对话' });
        }

        // Get transcript and summary from job result
        const { transcript, summary } = job.result;

        if (!transcript) {
            return res.status(400).json({ error: '无法获取转录内容' });
        }

        // Call chat service
        const response = await chatService.chat(message, transcript, summary, history);

        res.json({
            reply: response.reply,
            relevantSegments: response.relevantSegments
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: error.message || '聊天服务出错' });
    }
});

/**
 * Health check
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// ==================== Processing Functions ====================

/**
 * Process podcast from URL
 */
async function processPodcast(job) {
    try {
        // Step 1: Analyze URL and extract podcast info
        await updateJob(job, {
            status: 'processing',
            step: 'analyzing',
            progress: 5,
            message: '正在分析播客链接...'
        });

        const podcastInfo = await podcastService.extractPodcastInfo(job.url);
        
        if (!podcastInfo.audioUrl) {
            throw new Error('无法获取音频链接');
        }

        await updateJob(job, {
            progress: 15,
            message: '已获取播客信息',
            metadata: podcastInfo.metadata
        });

        // Save the original audio URL for direct ASR use (no download needed for cloud ASR)
        job.audioUrl = podcastInfo.audioUrl;

        // Step 2: Download audio (for local Whisper fallback and file serving)
        await updateJob(job, {
            step: 'downloading',
            progress: 20,
            message: '正在下载音频...'
        });

        const audioPath = path.join(job.dir, 'audio.mp3');
        await podcastService.downloadAudio(podcastInfo.audioUrl, audioPath, (progress) => {
            updateJob(job, {
                progress: 20 + Math.round(progress * 0.2), // 20% to 40%
                message: `正在下载音频... ${Math.round(progress)}%`
            });
        });

        job.audioPath = audioPath;

        // Continue with audio processing
        await processAudio(job);

    } catch (error) {
        console.error('Process podcast error:', error);
        await updateJob(job, {
            status: 'error',
            error: error.message
        });
    }
}

/**
 * Process uploaded audio file
 */
async function processAudioFile(job) {
    try {
        // Get audio info
        await updateJob(job, {
            status: 'processing',
            step: 'analyzing',
            progress: 10,
            message: '正在分析音频文件...'
        });

        const audioInfo = await audioInfoService.getAudioInfo(job.audioPath);
        
        job.metadata = {
            title: path.basename(job.audioPath, path.extname(job.audioPath)),
            duration: audioInfo.duration
        };

        await updateJob(job, {
            progress: 20,
            message: '音频分析完成',
            metadata: job.metadata
        });

        // Continue with audio processing
        await processAudio(job);

    } catch (error) {
        console.error('Process audio file error:', error);
        await updateJob(job, {
            status: 'error',
            error: error.message
        });
    }
}

/**
 * Process audio (transcribe, optimize, summarize)
 * Has a configurable timeout (default 3 hours for long podcasts)
 */
async function processAudio(job) {
    // Support up to 3-hour podcasts: download + ASR + optimize + summarize
    const PROCESS_TIMEOUT = parseInt(process.env.PROCESS_TIMEOUT_MS) || 3 * 60 * 60 * 1000; // 3 hours default

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('处理超时，任务已自动取消。请尝试使用更短的音频文件。'));
        }, PROCESS_TIMEOUT);
    });

    // Wrap the actual processing in a race with timeout
    try {
        await Promise.race([
            processAudioInternal(job),
            timeoutPromise
        ]);
    } catch (error) {
        console.error('Process audio error:', error);
        await updateJob(job, {
            status: 'error',
            error: error.message
        });
    }
}

/**
 * Internal audio processing logic
 * Supports both DashScope ASR (cloud) and local Whisper (fallback)
 */
async function processAudioInternal(job) {
    try {
        const transcriptPath = path.join(job.dir, 'transcript.txt');
        let transcript = '';
        let detectedLanguage = null;
        let usedASR = false;

        // Step 3: Transcribe audio
        await updateJob(job, {
            step: 'transcribing',
            progress: 40,
            message: '正在进行语音转录...'
        });

        // Determine audio URL for ASR
        let audioUrl = job.audioUrl || null; // From podcast URL processing

        // Try DashScope ASR first (if audio URL available or can be generated)
        try {
            // For local files, we need to generate a public URL
            if (!audioUrl && job.audioPath) {
                const useTunnel = process.env.USE_TUNNEL === 'true';
                const useOSS = process.env.USE_OSS === 'true';

                if (useTunnel || useOSS) {
                    await updateJob(job, {
                        progress: 42,
                        message: '正在准备文件上传...'
                    });

                    audioUrl = await fileUrlService.getPublicUrl(job.audioPath);
                    console.log(`Generated public URL for local file: ${audioUrl}`);
                }
            }

            // Use DashScope ASR if we have a valid URL
            if (audioUrl) {
                await updateJob(job, {
                    progress: 45,
                    message: '正在进行云端语音转录 (DashScope ASR)...'
                });

                const asrResult = await asrService.transcribe(audioUrl, (progress) => {
                    updateJob(job, {
                        progress: 45 + Math.round(progress * 0.2), // 45% to 65%
                        message: `正在云端转录音频... ${Math.round(progress)}%`
                    });
                });

                // Handle transcription URL (for async mode)
                if (asrResult.transcriptionUrl && !asrResult.transcript) {
                    console.log('Fetching transcription from URL...');
                    const fetchedResult = await asrService.fetchTranscriptionFromUrl(asrResult.transcriptionUrl);
                    transcript = fetchedResult.transcript;
                    detectedLanguage = fetchedResult.language;
                } else {
                    transcript = asrResult.transcript;
                    detectedLanguage = asrResult.language;
                }

                usedASR = true;
                console.log(`ASR completed. Detected language: ${detectedLanguage}`);
            }
        } catch (asrError) {
            console.error('DashScope ASR failed, falling back to local Whisper:', asrError.message);
            await updateJob(job, {
                progress: 45,
                message: '云端转录失败，正在使用本地 Whisper...'
            });
        }

        // Fallback to local Whisper if ASR failed or not available
        if (!transcript || transcript.trim() === '') {
            await updateJob(job, {
                step: 'transcribing',
                progress: 45,
                message: '正在进行本地语音转录 (Faster-Whisper)...'
            });

            await transcribeAudio(job.audioPath, transcriptPath, (progress) => {
                updateJob(job, {
                    progress: 45 + Math.round(progress * 0.2), // 45% to 65%
                    message: `正在本地转录音频... ${Math.round(progress)}%`
                });
            });

            // Read transcript from file
            transcript = await fs.readFile(transcriptPath, 'utf-8');

            // Detect language from transcript content if not from ASR
            if (!detectedLanguage) {
                const { detectLanguage } = require('./utils');
                detectedLanguage = detectLanguage(transcript);
            }
        } else {
            // Save ASR transcript to file
            await fs.writeFile(transcriptPath, transcript, 'utf-8');
        }

        job.transcript = transcript;
        job.detectedLanguage = detectedLanguage;
        console.log(`Transcription complete. Detected language: ${detectedLanguage}`);

        // Save raw transcript to file
        await fs.writeFile(transcriptPath, transcript, 'utf-8');

        // Step 4+5 (merged): Generate notes directly from raw transcript
        await updateJob(job, {
            step: 'summarizing',
            progress: 65,
            message: '正在生成笔记摘要...'
        });

        const outputLanguage = job.language === 'auto'
            ? determineOutputLanguage(detectedLanguage)
            : job.language;

        console.log(`Output language determined: ${outputLanguage} (source: ${detectedLanguage}, user preference: ${job.language})`);

        const summary = await openaiService.summarizeRaw(
            transcript,
            outputLanguage,
            job.detailLevel,
            (progress) => {
                updateJob(job, {
                    progress: 65 + Math.round(progress * 0.35), // 65% to 100%
                    message: '正在提取关键要点...'
                });
            },
            detectedLanguage
        );

        // Save summary
        const summaryPath = path.join(job.dir, 'summary.md');
        await fs.writeFile(summaryPath, summary, 'utf-8');

        // Complete
        await updateJob(job, {
            status: 'completed',
            progress: 100,
            message: '处理完成！',
            result: {
                metadata: job.metadata,
                transcript: transcript,
                summary: summary,
                detectedLanguage: detectedLanguage,
                outputLanguage: outputLanguage,
                usedASR: usedASR
            }
        });

        // Cleanup audio file to save space
        if (job.audioPath) {
            await cleanupFile(job.audioPath);
        }

        // Cleanup served file from tunnel/OSS
        if (job.audioPath) {
            fileUrlService.removeServedFile(job.audioPath);
        }

    } catch (error) {
        // Re-throw to be handled by the outer processAudio function
        throw error;
    }
}

/**
 * Transcribe audio using Faster-Whisper Python script
 */
async function transcribeAudio(audioPath, outputPath, onProgress) {
    return new Promise(async (resolve, reject) => {
        try {
            const whisperScript = path.join(__dirname, 'whisper_transcribe.py');

            // Check if Python script exists
            try {
                await fs.access(whisperScript);
            } catch {
                throw new Error('Whisper 转录脚本不存在');
            }

            const model = process.env.WHISPER_MODEL || 'base';
            const device = process.env.WHISPER_DEVICE || 'cpu';
            const computeType = process.env.WHISPER_COMPUTE_TYPE || 'int8';

            // Use spawn with array arguments to prevent command injection
            const { spawn } = require('child_process');
            const args = [
                whisperScript,
                audioPath,
                outputPath,
                '--model', model,
                '--device', device,
                '--compute_type', computeType
            ];

            console.log('Running whisper transcription:', 'python3', args.join(' '));

            let stdout = '';
            let stderr = '';

            const proc = spawn('python3', args, {
                timeout: 10800000 // 3 hour timeout for whisper
            });

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('error', (error) => {
                reject(new Error(`转录失败: ${error.message}`));
            });

            proc.on('close', async (code) => {
                console.log('Whisper stdout:', stdout);
                if (stderr) {
                    console.log('Whisper stderr:', stderr);
                }

                if (code !== 0) {
                    reject(new Error(`转录进程退出异常 (code: ${code})`));
                    return;
                }

                // Check if output file was created
                try {
                    await fs.access(outputPath);
                    resolve();
                } catch {
                    reject(new Error('转录失败，未生成输出文件'));
                }
            });

        } catch (error) {
            console.error('Transcription error:', error);
            reject(new Error(`转录失败: ${error.message}`));
        }
    });
}

/**
 * Update job status
 */
async function updateJob(job, updates) {
    jobManager.updateJob(job.id, updates);
    Object.assign(job, updates); // Keep local reference in sync
    console.log(`Job ${job.id}: ${job.step} - ${job.progress}% - ${job.message}`);
}

// ==================== Error Handling ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件大小超过限制 (500MB)' });
        }
        return res.status(400).json({ error: '文件上传失败' });
    }
    
    res.status(500).json({ error: err.message || '服务器内部错误' });
});

// ==================== Server Start ====================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    Podcast AI Server                       ║
║                                                            ║
║   🎧 智能播客转录与笔记提取服务                               ║
║                                                            ║
║   📍 Server: http://localhost:${PORT}                       ║
║                                                            ║
║   🔧 Environment: ${process.env.NODE_ENV || 'development'}${' '.repeat(18 - (process.env.NODE_ENV || 'development').length)}║
║   🤖 Whisper Model: ${process.env.WHISPER_MODEL || 'base'}${' '.repeat(15 - (process.env.WHISPER_MODEL || 'base').length)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
