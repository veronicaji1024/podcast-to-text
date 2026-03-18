/**
 * Utility functions for the Podcast AI server
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execPromise = promisify(exec);

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

/**
 * Clean up file if it exists
 */
async function cleanupFile(filePath) {
    try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log(`Cleaned up file: ${filePath}`);
    } catch {
        // File doesn't exist, ignore
    }
}

/**
 * Clean up directory and all its contents
 */
async function cleanupDir(dirPath) {
    try {
        await fs.access(dirPath);
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = await fs.stat(filePath);
            
            if (stat.isDirectory()) {
                await cleanupDir(filePath);
            } else {
                await fs.unlink(filePath);
            }
        }
        
        await fs.rmdir(dirPath);
        console.log(`Cleaned up directory: ${dirPath}`);
    } catch (error) {
        console.error(`Error cleaning up directory ${dirPath}:`, error.message);
    }
}

/**
 * Format duration in seconds to human readable string
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse duration string to seconds
 */
function parseDuration(durationStr) {
    if (!durationStr) return 0;
    
    // Handle ISO 8601 duration format (PT1H30M15S)
    const isoMatch = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (isoMatch) {
        const hours = parseInt(isoMatch[1] || 0);
        const minutes = parseInt(isoMatch[2] || 0);
        const seconds = parseInt(isoMatch[3] || 0);
        return hours * 3600 + minutes * 60 + seconds;
    }
    
    // Handle HH:MM:SS format
    const timeMatch = durationStr.match(/(\d+):(\d+):(\d+)/);
    if (timeMatch) {
        return parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
    }
    
    // Handle MM:SS format
    const shortMatch = durationStr.match(/(\d+):(\d+)/);
    if (shortMatch) {
        return parseInt(shortMatch[1]) * 60 + parseInt(shortMatch[2]);
    }
    
    // Handle plain seconds
    const seconds = parseInt(durationStr);
    if (!isNaN(seconds)) {
        return seconds;
    }
    
    return 0;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.log(`Retry ${i + 1}/${maxRetries} failed: ${error.message}`);
            
            if (i < maxRetries - 1) {
                await sleep(delay * Math.pow(2, i));
            }
        }
    }
    
    throw lastError;
}

/**
 * Download file with progress tracking
 * Supports large files up to 500MB with 30-minute timeout
 */
async function downloadFile(url, outputPath, onProgress) {
    const axios = require('axios');
    const writer = require('fs').createWriteStream(outputPath);

    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 1800000, // 30 minutes for large podcast files (was 60 seconds)
        maxContentLength: 500 * 1024 * 1024, // 500MB max
        maxBodyLength: 500 * 1024 * 1024,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const totalLength = parseInt(response.headers['content-length'] || 0);
    let downloadedLength = 0;

    response.data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        if (totalLength > 0 && onProgress) {
            const progress = (downloadedLength / totalLength) * 100;
            onProgress(progress);
        }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

/**
 * Get file size in human readable format
 */
function formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Sanitize filename for safe file system usage
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

/**
 * Detect language from text sample
 */
function detectLanguage(text) {
    // Simple language detection based on character ranges
    const sample = text.substring(0, 1000);

    // Check for Chinese characters
    if (/[\u4e00-\u9fa5]/.test(sample)) {
        return 'zh';
    }

    // Check for Japanese characters
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) {
        return 'ja';
    }

    // Check for Korean characters
    if (/[\uac00-\ud7af]/.test(sample)) {
        return 'ko';
    }

    // Default to English
    return 'en';
}

/**
 * Determine output language based on source language
 * Rule: Chinese source -> Chinese output, all other languages -> English output
 * @param {string} sourceLanguage - Detected source language code
 * @returns {string} - Output language code ('zh' or 'en')
 */
function determineOutputLanguage(sourceLanguage) {
    if (!sourceLanguage) return 'en';

    const lang = sourceLanguage.toLowerCase();

    // Chinese source -> Chinese output
    if (lang === 'zh' || lang === 'chinese' || lang.startsWith('zh-') || lang === 'cmn') {
        return 'zh';
    }

    // All other languages -> English output
    return 'en';
}

/**
 * Chunk text into smaller pieces
 */
function chunkText(text, maxChunkSize = 4000) {
    const chunks = [];
    const sentences = text.split(/(?<=[.!?。！？])\s+/);
    
    let currentChunk = '';
    
    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
        } else {
            currentChunk += ' ' + sentence;
        }
    }
    
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

module.exports = {
    execPromise,
    ensureDir,
    cleanupFile,
    cleanupDir,
    formatDuration,
    parseDuration,
    sleep,
    retry,
    downloadFile,
    formatFileSize,
    sanitizeFilename,
    detectLanguage,
    determineOutputLanguage,
    chunkText
};
