/**
 * File URL Service
 * Provides public URLs for local files to be used with DashScope ASR
 *
 * DashScope ASR does not support direct file uploads, only HTTP/HTTPS URLs.
 * This service handles:
 * - Development: Uses localtunnel to expose local files
 * - Production: Uploads to Alibaba Cloud OSS
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { sleep } = require('../utils');

class FileUrlService {
    constructor() {
        this.useTunnel = process.env.USE_TUNNEL === 'true';
        this.useOSS = process.env.USE_OSS === 'true';
        this.tunnel = null;
        this.localServer = null;
        this.localServerPort = parseInt(process.env.FILE_SERVER_PORT) || 3001;
        this.tunnelUrl = null;
        this.servedFiles = new Map(); // Maps file paths to { id, timestamp }
        this.ossClient = null;
        this.ossBucket = process.env.OSS_BUCKET || '';
        this.fileTTL = 60 * 60 * 1000; // 1 hour TTL for served files
        this.cleanupInterval = null;

        // Secret for signing URLs - should be set in environment variable
        this.urlSecret = process.env.FILE_URL_SECRET || crypto.randomBytes(32).toString('hex');
        if (!process.env.FILE_URL_SECRET) {
            console.warn('WARNING: FILE_URL_SECRET not set, using random secret (will break on restart)');
        }

        // Start periodic cleanup
        this.startCleanup();
    }

    /**
     * Start periodic cleanup of expired served files
     */
    startCleanup() {
        // Clean up every 10 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredFiles();
        }, 10 * 60 * 1000);

        // Don't prevent process from exiting
        this.cleanupInterval.unref();
    }

    /**
     * Clean up expired files from servedFiles map
     */
    cleanupExpiredFiles() {
        const now = Date.now();
        let cleaned = 0;

        for (const [filePath, data] of this.servedFiles.entries()) {
            // Handle both old format (string) and new format (object with timestamp)
            const timestamp = typeof data === 'object' ? data.timestamp : 0;
            if (now - timestamp > this.fileTTL) {
                this.servedFiles.delete(filePath);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`Cleaned up ${cleaned} expired served files`);
        }
    }

    /**
     * Initialize the service
     */
    async initialize() {
        if (this.useOSS) {
            await this.initializeOSS();
        } else if (this.useTunnel) {
            await this.initializeTunnel();
        }
    }

    /**
     * Initialize localtunnel for development
     */
    async initializeTunnel() {
        try {
            // Start local file server
            await this.startLocalServer();

            // Create tunnel (localtunnel is optional dependency)
            let localtunnel;
            try {
                localtunnel = require('localtunnel');
            } catch (e) {
                throw new Error('localtunnel 未安装。请运行: npm install localtunnel');
            }

            console.log(`Creating tunnel to port ${this.localServerPort}...`);

            this.tunnel = await localtunnel({
                port: this.localServerPort,
                subdomain: `podcast-asr-${Date.now()}` // Unique subdomain
            });

            this.tunnelUrl = this.tunnel.url;
            console.log(`Tunnel established at: ${this.tunnelUrl}`);

            // Handle tunnel close
            this.tunnel.on('close', () => {
                console.log('Tunnel closed');
                this.tunnelUrl = null;
            });

            // Handle tunnel errors
            this.tunnel.on('error', async (err) => {
                console.error('Tunnel error:', err);
                // Try to reconnect
                await this.reconnectTunnel();
            });

            return this.tunnelUrl;
        } catch (error) {
            console.error('Failed to initialize tunnel:', error);
            throw new Error('无法建立文件传输通道');
        }
    }

    /**
     * Generate signed token for file access
     * @param {string} fileId - File ID
     * @param {number} expiresAt - Expiration timestamp
     * @returns {string} - HMAC signature
     */
    generateFileToken(fileId, expiresAt) {
        const data = `${fileId}:${expiresAt}`;
        return crypto.createHmac('sha256', this.urlSecret)
            .update(data)
            .digest('hex');
    }

    /**
     * Verify signed token for file access
     * @param {string} fileId - File ID
     * @param {string} token - Token to verify
     * @param {number} expiresAt - Expiration timestamp
     * @returns {boolean} - True if valid
     */
    verifyFileToken(fileId, token, expiresAt) {
        // Check expiration
        if (Date.now() > expiresAt) {
            return false;
        }

        // Verify signature
        const expectedToken = this.generateFileToken(fileId, expiresAt);
        return crypto.timingSafeEqual(
            Buffer.from(token, 'hex'),
            Buffer.from(expectedToken, 'hex')
        );
    }

    /**
     * Start local file server
     */
    async startLocalServer() {
        return new Promise((resolve, reject) => {
            const app = express();

            // Serve files from temp directory with authentication
            app.get('/file/:fileId', async (req, res) => {
                const { fileId } = req.params;
                const { token, expires } = req.query;

                // Validate authentication
                if (!token || !expires) {
                    return res.status(403).send('Authentication required');
                }

                const expiresAt = parseInt(expires);
                if (isNaN(expiresAt)) {
                    return res.status(400).send('Invalid expiration');
                }

                // Verify token
                try {
                    if (!this.verifyFileToken(fileId, token, expiresAt)) {
                        return res.status(403).send('Invalid or expired token');
                    }
                } catch (error) {
                    console.error('Token verification error:', error);
                    return res.status(403).send('Invalid token format');
                }

                // Find the file path for this ID
                let filePath = null;
                for (const [path, data] of this.servedFiles.entries()) {
                    // Support both old format (string) and new format (object)
                    const id = typeof data === 'object' ? data.id : data;
                    if (id === fileId) {
                        filePath = path;
                        break;
                    }
                }

                if (!filePath) {
                    return res.status(404).send('File not found');
                }

                try {
                    await fs.access(filePath);
                    res.sendFile(filePath);
                } catch (error) {
                    res.status(404).send('File not found');
                }
            });

            // Health check
            app.get('/health', (req, res) => {
                res.json({ status: 'ok' });
            });

            this.localServer = app.listen(this.localServerPort, () => {
                console.log(`Local file server running on port ${this.localServerPort}`);
                resolve();
            });

            this.localServer.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    // Port in use, try another
                    this.localServerPort++;
                    this.localServer = app.listen(this.localServerPort, () => {
                        console.log(`Local file server running on port ${this.localServerPort}`);
                        resolve();
                    });
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Reconnect tunnel on failure
     */
    async reconnectTunnel(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`Attempting tunnel reconnection (${i + 1}/${maxRetries})...`);
                await sleep(2000 * Math.pow(2, i)); // Exponential backoff

                const localtunnel = require('localtunnel');
                this.tunnel = await localtunnel({ port: this.localServerPort });
                this.tunnelUrl = this.tunnel.url;
                console.log(`Tunnel reconnected at: ${this.tunnelUrl}`);
                return true;
            } catch (error) {
                console.error(`Reconnection attempt ${i + 1} failed:`, error.message);
            }
        }
        return false;
    }

    /**
     * Initialize Alibaba Cloud OSS for production
     */
    async initializeOSS() {
        try {
            const OSS = require('ali-oss');

            this.ossClient = new OSS({
                region: process.env.OSS_REGION || 'oss-cn-hangzhou',
                accessKeyId: process.env.OSS_ACCESS_KEY_ID,
                accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
                bucket: process.env.OSS_BUCKET
            });

            console.log('OSS client initialized');
        } catch (error) {
            console.error('Failed to initialize OSS:', error);
            throw new Error('无法初始化 OSS 客户端');
        }
    }

    /**
     * Get public URL for a local file
     * @param {string} localFilePath - Absolute path to local file
     * @returns {Promise<string>} - Public HTTP URL
     */
    async getPublicUrl(localFilePath) {
        // Verify file exists
        try {
            await fs.access(localFilePath);
        } catch (error) {
            throw new Error(`文件不存在: ${localFilePath}`);
        }

        if (this.useOSS) {
            return this.uploadToOSS(localFilePath);
        } else if (this.useTunnel) {
            return this.serveThroughTunnel(localFilePath);
        } else {
            throw new Error('未配置文件 URL 服务。请设置 USE_TUNNEL=true 或 USE_OSS=true');
        }
    }

    /**
     * Serve file through localtunnel
     * @param {string} localFilePath - Absolute path to local file
     * @returns {Promise<string>} - Public URL through tunnel with signed token
     */
    async serveThroughTunnel(localFilePath) {
        // Initialize tunnel if not already done
        if (!this.tunnelUrl) {
            await this.initializeTunnel();
        }

        // Generate unique file ID
        const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        // Register file for serving with timestamp for cleanup
        this.servedFiles.set(localFilePath, {
            id: fileId,
            timestamp: Date.now()
        });

        // Generate signed URL with 1 hour expiration
        const expiresAt = Date.now() + this.fileTTL;
        const token = this.generateFileToken(fileId, expiresAt);

        // Build public URL with authentication
        const publicUrl = `${this.tunnelUrl}/file/${fileId}?token=${token}&expires=${expiresAt}`;
        console.log(`File served at: ${publicUrl} (expires in 1 hour)`);

        return publicUrl;
    }

    /**
     * Upload file to OSS
     * @param {string} localFilePath - Absolute path to local file
     * @returns {Promise<string>} - OSS URL
     */
    async uploadToOSS(localFilePath) {
        if (!this.ossClient) {
            await this.initializeOSS();
        }

        const fileName = `podcast-asr/${Date.now()}-${path.basename(localFilePath)}`;

        try {
            console.log(`Uploading to OSS: ${fileName}`);

            const result = await this.ossClient.put(fileName, localFilePath);

            // Generate signed URL with expiration (1 hour)
            const signedUrl = this.ossClient.signatureUrl(fileName, {
                expires: 3600 // 1 hour
            });

            console.log(`File uploaded to OSS: ${signedUrl}`);
            return signedUrl;
        } catch (error) {
            console.error('OSS upload error:', error);
            throw new Error(`文件上传失败: ${error.message}`);
        }
    }

    /**
     * Remove served file from local server
     * @param {string} localFilePath - File path to remove from serving
     */
    removeServedFile(localFilePath) {
        this.servedFiles.delete(localFilePath);
    }

    /**
     * Delete file from OSS
     * @param {string} ossUrl - OSS URL of the file
     */
    async deleteFromOSS(ossUrl) {
        if (!this.ossClient) return;

        try {
            // Extract object name from URL
            const urlObj = new URL(ossUrl);
            const objectName = urlObj.pathname.substring(1); // Remove leading slash

            await this.ossClient.delete(objectName);
            console.log(`Deleted from OSS: ${objectName}`);
        } catch (error) {
            console.error('OSS delete error:', error);
        }
    }

    /**
     * Cleanup and close services
     */
    async cleanup() {
        if (this.tunnel) {
            this.tunnel.close();
            this.tunnel = null;
        }

        if (this.localServer) {
            this.localServer.close();
            this.localServer = null;
        }

        this.servedFiles.clear();
        this.tunnelUrl = null;

        console.log('File URL service cleaned up');
    }

    /**
     * Check if service is ready
     * @returns {boolean}
     */
    isReady() {
        if (this.useOSS) {
            return !!this.ossClient;
        }
        if (this.useTunnel) {
            return !!this.tunnelUrl;
        }
        return false;
    }

    /**
     * Get service status
     * @returns {Object}
     */
    getStatus() {
        return {
            useTunnel: this.useTunnel,
            useOSS: this.useOSS,
            tunnelUrl: this.tunnelUrl,
            localServerPort: this.localServerPort,
            servedFilesCount: this.servedFiles.size,
            isReady: this.isReady()
        };
    }
}

module.exports = new FileUrlService();
