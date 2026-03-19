/**
 * DashScope ASR Service
 * Handles cloud-based speech recognition using Alibaba DashScope fun-asr model
 */

const axios = require('axios');
const { sleep } = require('../utils');

class ASRService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY; // Reuse the same DashScope API key
        this.baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr';
        this.tasksUrl = 'https://dashscope.aliyuncs.com/api/v1/tasks'; // Task status endpoint
        this.model = process.env.ASR_MODEL || 'paraformer-v2';
        // Support up to 3-hour audio: ASR typically takes 10-20% of audio duration
        // 3 hours audio = ~36 minutes ASR time, set timeout to 3 hours for safety
        this.timeout = parseInt(process.env.ASR_TIMEOUT_MS) || 10800000; // 3 hours (180 minutes)
        this.pollInterval = 2500; // Poll every 2.5 seconds
    }

    /**
     * Submit a transcription task
     * @param {string} audioUrl - HTTP/HTTPS URL to the audio file
     * @param {Array<string>} languageHints - Optional language hints
     * @returns {Promise<string>} - Task ID
     */
    async submitTranscription(audioUrl, languageHints = []) {
        console.log(`Submitting ASR task for: ${audioUrl}`);

        const requestBody = {
            model: this.model,
            input: {
                file_urls: [audioUrl]
            },
            parameters: {
                // Enable timestamp and speaker diarization
                timestamp_alignment: true,
                diarization: true,
                // Language hints
                ...(languageHints.length > 0 && { language_hints: languageHints })
            }
        };

        try {
            const response = await axios.post(
                `${this.baseUrl}/transcription`,
                requestBody,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'X-DashScope-Async': 'enable' // Async mode for long audio
                    },
                    timeout: 30000 // 30 second timeout for submission
                }
            );

            if (response.data.output && response.data.output.task_id) {
                const taskId = response.data.output.task_id;
                console.log(`ASR task submitted successfully. Task ID: ${taskId}`);
                return taskId;
            }

            throw new Error('Failed to get task ID from response');
        } catch (error) {
            console.error('ASR submission error:', error.response?.data || error.message);
            throw new Error(`ASR 任务提交失败: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Poll for transcription results
     * @param {string} taskId - The task ID to poll
     * @param {number} maxWaitTime - Maximum wait time in ms
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} - Transcription result
     */
    async pollForResults(taskId, maxWaitTime = this.timeout, onProgress) {
        console.log(`Polling for ASR results. Task ID: ${taskId}`);

        const startTime = Date.now();
        let lastProgress = 0;
        let pollCount = 0;
        const maxPollAttempts = Math.ceil(maxWaitTime / this.pollInterval); // Calculate max iterations

        while (Date.now() - startTime < maxWaitTime && pollCount < maxPollAttempts) {
            pollCount++;

            try {
                // Use the tasks endpoint to check status
                const response = await axios.get(
                    `${this.tasksUrl}/${taskId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        timeout: 10000
                    }
                );

                const { output, task_status } = response.data;
                const status = task_status || output?.task_status;

                console.log(`ASR task status: ${status} (poll ${pollCount}/${maxPollAttempts})`);

                if (status === 'SUCCEEDED') {
                    console.log('ASR task completed successfully');
                    return output;
                }

                if (status === 'FAILED') {
                    const errorMsg = response.data.message || output?.message || 'ASR task failed';
                    throw new Error(errorMsg);
                }

                // PENDING or RUNNING - continue polling
                // Update progress based on elapsed time (estimate)
                const elapsed = Date.now() - startTime;
                const estimatedProgress = Math.min(90, Math.floor((elapsed / maxWaitTime) * 100));

                if (estimatedProgress > lastProgress && onProgress) {
                    lastProgress = estimatedProgress;
                    onProgress(estimatedProgress);
                }

                // Wait before next poll
                await sleep(this.pollInterval);

            } catch (error) {
                if (error.response?.status === 404) {
                    // Task not found, might still be initializing
                    console.log('Task not found yet, waiting...');
                    await sleep(this.pollInterval);
                    continue;
                }
                console.error('Poll error:', error.response?.data || error.message);
                throw error;
            }
        }

        // Check if we exceeded max attempts
        if (pollCount >= maxPollAttempts) {
            throw new Error(`ASR 任务超时：已轮询 ${pollCount} 次，请稍后重试`);
        }

        throw new Error('ASR 任务超时，请稍后重试');
    }

    /**
     * Main transcription method
     * @param {string} audioUrl - HTTP/HTTPS URL to the audio file
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} - { transcript, language, segments }
     */
    async transcribe(audioUrl, onProgress) {
        try {
            // Submit the transcription task
            if (onProgress) onProgress(5);
            const taskId = await this.submitTranscription(audioUrl);

            // Poll for results
            if (onProgress) onProgress(10);
            const result = await this.pollForResults(taskId, this.timeout, (progress) => {
                // Map progress from 10% to 95%
                if (onProgress) onProgress(10 + Math.floor(progress * 0.85));
            });

            // Parse the results
            if (onProgress) onProgress(98);
            const parsedResult = this.parseTranscriptionResult(result);

            if (onProgress) onProgress(100);
            return parsedResult;

        } catch (error) {
            console.error('ASR transcription error:', error);
            throw error;
        }
    }

    /**
     * Parse transcription result and extract language
     * @param {Object} result - Raw API result
     * @returns {Object} - { transcript, language, segments }
     */
    parseTranscriptionResult(result) {
        let fullTranscript = '';
        let detectedLanguage = 'en'; // Default to English
        const segments = [];

        // DashScope returns results in a specific structure
        if (result.results && Array.isArray(result.results)) {
            for (const fileResult of result.results) {
                if (fileResult.transcription_url) {
                    // For async mode, we need to fetch the transcription from the URL
                    // This will be handled separately
                    console.log('Transcription URL available:', fileResult.transcription_url);
                }

                if (fileResult.transcripts && Array.isArray(fileResult.transcripts)) {
                    for (const transcriptObj of fileResult.transcripts) {
                        // Extract text
                        if (transcriptObj.text) {
                            fullTranscript += transcriptObj.text + '\n';
                        }

                        // Extract language if available
                        if (transcriptObj.language) {
                            detectedLanguage = this.normalizeLanguageCode(transcriptObj.language);
                        }

                        // Extract segments with timestamps
                        if (transcriptObj.sentences && Array.isArray(transcriptObj.sentences)) {
                            for (const sentence of transcriptObj.sentences) {
                                segments.push({
                                    start: sentence.begin_time / 1000, // Convert to seconds
                                    end: sentence.end_time / 1000,
                                    text: sentence.text,
                                    speaker: sentence.speaker_id
                                });
                            }
                        }
                    }
                }

                // Alternative structure for some models
                if (fileResult.text) {
                    fullTranscript = fileResult.text;
                }

                if (fileResult.language) {
                    detectedLanguage = this.normalizeLanguageCode(fileResult.language);
                }
            }
        }

        // If we got transcription URL, return a special marker to indicate URL fetch needed
        if (!fullTranscript && result.results?.[0]?.transcription_url) {
            return {
                transcript: null,
                transcriptionUrl: result.results[0].transcription_url,
                language: detectedLanguage,
                segments
            };
        }

        // Detect language from content if not provided
        if (fullTranscript && !detectedLanguage) {
            detectedLanguage = this.detectLanguageFromText(fullTranscript);
        }

        return {
            transcript: fullTranscript.trim(),
            language: detectedLanguage,
            segments
        };
    }

    /**
     * Fetch transcription from URL (for async mode)
     * @param {string} url - Transcription URL
     * @returns {Promise<Object>} - Parsed transcription result
     */
    async fetchTranscriptionFromUrl(url) {
        try {
            // Increase timeout for large transcription files (3 minutes)
            const response = await axios.get(url, {
                timeout: 180000,
                maxContentLength: 100 * 1024 * 1024, // 100MB max
                maxBodyLength: 100 * 1024 * 1024
            });
            const data = response.data;

            let fullTranscript = '';
            let detectedLanguage = 'en';
            const segments = [];

            console.log('Transcription response type:', typeof data);
            if (typeof data === 'object') {
                console.log('Transcription response keys:', Object.keys(data));
            }

            // Parse the JSON response - handle multiple DashScope response formats
            if (typeof data === 'object') {
                // Format 1: { transcripts: [...] }
                if (data.transcripts && Array.isArray(data.transcripts)) {
                    for (const transcript of data.transcripts) {
                        if (transcript.text) {
                            fullTranscript += transcript.text + '\n';
                        }
                        // Also collect from sentences if text is not directly available
                        if (transcript.sentences && Array.isArray(transcript.sentences)) {
                            for (const sentence of transcript.sentences) {
                                if (sentence.text) {
                                    segments.push({
                                        start: (sentence.begin_time || sentence.start || 0) / 1000,
                                        end: (sentence.end_time || sentence.end || 0) / 1000,
                                        text: sentence.text,
                                        speaker: sentence.speaker_id || sentence.speaker
                                    });
                                }
                            }
                            // If no full text, build from sentences
                            if (!transcript.text && segments.length > 0) {
                                fullTranscript += segments.map(s => s.text).join('') + '\n';
                            }
                        }
                    }
                }

                // Format 2: { transcript: "..." } or { text: "..." }
                if (!fullTranscript && data.transcript) {
                    fullTranscript = data.transcript;
                }
                if (!fullTranscript && data.text) {
                    fullTranscript = data.text;
                }

                // Format 3: { result: { transcripts: [...] } }
                if (!fullTranscript && data.result) {
                    if (data.result.transcripts) {
                        for (const transcript of data.result.transcripts) {
                            if (transcript.text) {
                                fullTranscript += transcript.text + '\n';
                            }
                        }
                    } else if (data.result.text) {
                        fullTranscript = data.result.text;
                    }
                }

                // Format 4: { output: { ... } }
                if (!fullTranscript && data.output) {
                    if (data.output.text) {
                        fullTranscript = data.output.text;
                    } else if (data.output.transcripts) {
                        for (const transcript of data.output.transcripts) {
                            if (transcript.text) {
                                fullTranscript += transcript.text + '\n';
                            }
                        }
                    }
                }

                // Extract language
                if (data.language) {
                    detectedLanguage = this.normalizeLanguageCode(data.language);
                } else if (data.transcripts?.[0]?.language) {
                    detectedLanguage = this.normalizeLanguageCode(data.transcripts[0].language);
                }

            } else if (typeof data === 'string') {
                fullTranscript = data;
            }

            // Detect language from content if not provided
            if (fullTranscript) {
                detectedLanguage = this.detectLanguageFromText(fullTranscript);
            }

            console.log(`Fetched transcript length: ${fullTranscript.length} chars, segments: ${segments.length}`);

            return {
                transcript: fullTranscript.trim(),
                language: detectedLanguage,
                segments
            };
        } catch (error) {
            console.error('Error fetching transcription from URL:', error.message);
            throw new Error('Failed to fetch transcription result: ' + error.message);
        }
    }

    /**
     * Normalize language codes to our standard format
     * @param {string} langCode - Raw language code
     * @returns {string} - Normalized language code
     */
    normalizeLanguageCode(langCode) {
        if (!langCode) return 'en';

        const code = langCode.toLowerCase();

        // Chinese variants
        if (code.includes('zh') || code.includes('chinese') || code.includes('mandarin')) {
            return 'zh';
        }

        // Japanese
        if (code.includes('ja') || code.includes('japanese')) {
            return 'ja';
        }

        // Korean
        if (code.includes('ko') || code.includes('korean')) {
            return 'ko';
        }

        // English (default)
        if (code.includes('en') || code.includes('english')) {
            return 'en';
        }

        // Return the original code for other languages
        return code.substring(0, 2);
    }

    /**
     * Detect language from text content
     * @param {string} text - Text to analyze
     * @returns {string} - Detected language code
     */
    detectLanguageFromText(text) {
        const sample = text.substring(0, 1000);

        // Check for Chinese characters
        const chineseChars = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
        const totalChars = sample.replace(/\s/g, '').length;

        if (chineseChars / totalChars > 0.3) {
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

        return 'en';
    }

    /**
     * Check if a URL is accessible and valid for ASR
     * @param {string} url - URL to check
     * @returns {Promise<boolean>}
     */
    async isUrlAccessible(url) {
        try {
            const response = await axios.head(url, {
                timeout: 10000,
                maxRedirects: 5
            });
            return response.status >= 200 && response.status < 400;
        } catch (error) {
            console.error('URL accessibility check failed:', error.message);
            return false;
        }
    }
}

module.exports = new ASRService();
