/**
 * Chat Service
 * Handles AI-powered conversations about podcast content
 * Allows users to ask questions about the transcript and summary
 */

const OpenAI = require('openai');
const { detectLanguage } = require('../utils');

class ChatService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            timeout: 60000,
        });

        this.model = process.env.OPENAI_MODEL || 'qwen-plus';
        this.maxTokens = 2000;
        this.maxContextChars = 8000; // Max characters for transcript context
    }

    /**
     * Process a chat message about the podcast content
     * @param {string} message - User's question
     * @param {string} transcript - Full optimized transcript
     * @param {string} summary - Generated summary/notes
     * @param {Array} history - Chat history [{role, content}]
     * @returns {Object} - { reply, relevantSegments }
     */
    async chat(message, transcript, summary, history = []) {
        // Detect language from the summary or transcript
        const language = detectLanguage(summary || transcript);

        // Retrieve relevant segments from the transcript
        const relevantSegments = this.retrieveRelevantSegments(message, transcript);

        // Build the system prompt with context
        const systemPrompt = this.buildSystemPrompt(transcript, summary, relevantSegments, language);

        // Build conversation history
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-10), // Keep last 10 messages to avoid context overflow
            { role: 'user', content: message }
        ];

        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: messages,
                max_tokens: this.maxTokens,
                temperature: 0.7
            });

            const reply = response.choices[0].message.content.trim();

            return {
                reply,
                relevantSegments: relevantSegments.map(seg => ({
                    text: seg.text,
                    score: seg.score
                }))
            };

        } catch (error) {
            console.error('Chat error:', error);
            throw new Error(`Chat failed: ${error.message}`);
        }
    }

    /**
     * Build the system prompt with relevant context
     */
    buildSystemPrompt(transcript, summary, relevantSegments, language) {
        const languageInstruction = language === 'zh'
            ? '请用中文回答用户的问题。'
            : language === 'ja'
            ? '日本語で回答してください。'
            : language === 'ko'
            ? '한국어로 답변해 주세요.'
            : 'Respond in the same language as the user\'s question.';

        // Build relevant transcript context
        let transcriptContext = '';
        if (relevantSegments.length > 0) {
            transcriptContext = relevantSegments
                .map(seg => seg.text)
                .join('\n\n---\n\n');
        } else {
            // If no relevant segments found, use a portion of the transcript
            transcriptContext = this.truncateText(transcript, this.maxContextChars);
        }

        return `你是一个播客内容助手。用户正在阅读一个播客的笔记摘要，可能会向你提问。

${languageInstruction}

你的任务是：
1. 当用户询问某个观点在原文中是怎么说的 → 从转录文本中找到相关段落并用 > 引用格式引用
2. 当用户需要某个话题的更多细节 → 从转录文本中提取更多相关信息
3. 当用户想要澄清某个概念 → 基于上下文进行解释
4. 当用户询问笔记中没有的内容 → 诚实告知转录中没有相关内容

重要规则：
- 始终基于提供的转录内容回答，不要编造不存在的内容
- 引用原文时使用 > 引用格式（Markdown blockquote）
- 如果转录中没有相关内容，诚实说明"在转录中没有找到关于这个问题的相关内容"
- 保持友好、专业的语气
- 回答要简洁明了，但要提供足够的信息

以下是与用户问题最相关的转录段落（按相关性排序）：
"""
${transcriptContext}
"""

以下是播客的笔记摘要：
"""
${this.truncateText(summary, 3000)}
"""

注意：以上是截取的相关部分，不是完整转录。如果用户问的内容不在这些段落中，请告知用户。`;
    }

    /**
     * Retrieve relevant segments from transcript based on user query
     * Uses keyword matching and scoring algorithm
     * @param {string} query - User's question
     * @param {string} transcript - Full transcript text
     * @param {number} maxChars - Maximum total characters to return
     * @returns {Array} - Array of { text, score } objects
     */
    retrieveRelevantSegments(query, transcript, maxChars = 6000) {
        if (!transcript || !query) {
            return [];
        }

        // Split transcript into paragraphs
        const paragraphs = this.splitIntoParagraphs(transcript);

        // Extract keywords from query (remove stop words)
        const keywords = this.extractKeywords(query);

        if (keywords.length === 0) {
            // If no keywords, return first portion of transcript
            return [{
                text: this.truncateText(transcript, maxChars),
                score: 0
            }];
        }

        // Pre-compile regexes for performance (avoid creating in loop)
        const regexCache = new Map();

        // Score each paragraph based on keyword matches
        const scoredParagraphs = paragraphs.map((para, index) => ({
            text: para,
            index: index,
            score: this.calculateRelevanceScore(para, keywords, regexCache)
        }));

        // Sort by score (highest first)
        scoredParagraphs.sort((a, b) => b.score - a.score);

        // Select top paragraphs within character limit
        const selectedParagraphs = [];
        let totalChars = 0;

        for (const para of scoredParagraphs) {
            if (para.score === 0) continue; // Skip paragraphs with no matches

            if (totalChars + para.text.length > maxChars) {
                break;
            }

            selectedParagraphs.push(para);
            totalChars += para.text.length;

            // Limit to top 5 most relevant paragraphs
            if (selectedParagraphs.length >= 5) {
                break;
            }
        }

        // If no relevant paragraphs found, return top portion of transcript
        if (selectedParagraphs.length === 0) {
            return [{
                text: this.truncateText(transcript, maxChars),
                score: 0
            }];
        }

        // Sort by original order to maintain context flow
        selectedParagraphs.sort((a, b) => a.index - b.index);

        // Add context: include one paragraph before and after if available
        const contextParagraphs = [];
        const includedIndices = new Set();

        for (const para of selectedParagraphs) {
            // Add previous paragraph for context
            if (para.index > 0 && !includedIndices.has(para.index - 1)) {
                const prevPara = paragraphs[para.index - 1];
                if (totalChars + prevPara.length <= maxChars + 1000) {
                    contextParagraphs.push({
                        text: prevPara,
                        index: para.index - 1,
                        score: 0,
                        isContext: true
                    });
                    includedIndices.add(para.index - 1);
                    totalChars += prevPara.length;
                }
            }

            if (!includedIndices.has(para.index)) {
                contextParagraphs.push(para);
                includedIndices.add(para.index);
            }

            // Add next paragraph for context
            if (para.index < paragraphs.length - 1 && !includedIndices.has(para.index + 1)) {
                const nextPara = paragraphs[para.index + 1];
                if (totalChars + nextPara.length <= maxChars + 1000) {
                    contextParagraphs.push({
                        text: nextPara,
                        index: para.index + 1,
                        score: 0,
                        isContext: true
                    });
                    includedIndices.add(para.index + 1);
                    totalChars += nextPara.length;
                }
            }
        }

        // Sort by original order
        contextParagraphs.sort((a, b) => a.index - b.index);

        return contextParagraphs;
    }

    /**
     * Split transcript into paragraphs
     * Uses double newlines or sentence boundaries
     */
    splitIntoParagraphs(text) {
        // First try splitting by double newlines
        let paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

        // If that results in very few paragraphs, split by single newlines
        if (paragraphs.length < 5) {
            paragraphs = text.split(/\n/).filter(p => p.trim().length > 0);
        }

        // If still too few, split by sentence endings (for Chinese and English)
        if (paragraphs.length < 5) {
            // Split by Chinese or English sentence endings
            paragraphs = text.split(/(?<=[。！？.!?])\s*/).filter(p => p.trim().length > 0);

            // Group into chunks of 2-3 sentences
            const grouped = [];
            for (let i = 0; i < paragraphs.length; i += 3) {
                grouped.push(paragraphs.slice(i, i + 3).join(' '));
            }
            paragraphs = grouped;
        }

        // Ensure paragraphs aren't too long
        const finalParagraphs = [];
        for (const para of paragraphs) {
            if (para.length > 500) {
                // Split long paragraphs
                const chunks = this.chunkText(para, 400);
                finalParagraphs.push(...chunks);
            } else {
                finalParagraphs.push(para.trim());
            }
        }

        return finalParagraphs.filter(p => p.length > 20); // Filter out very short segments
    }

    /**
     * Extract keywords from query
     * Removes common stop words in Chinese and English
     */
    extractKeywords(query) {
        // Security: Prevent ReDoS by limiting input length
        const MAX_QUERY_LENGTH = 1000;
        if (!query || typeof query !== 'string') {
            return [];
        }

        const sanitizedQuery = query.substring(0, MAX_QUERY_LENGTH);

        // Common stop words
        const stopWords = new Set([
            // Chinese
            '的', '了', '在', '是', '我', '你', '他', '她', '它', '这', '那',
            '和', '与', '或', '但', '如果', '因为', '所以', '虽然', '但是',
            '什么', '怎么', '哪个', '哪些', '为什么', '如何', '请', '请问',
            '能', '可以', '会', '想', '要', '应该', '需要', '一个', '这个', '那个',
            '关于', '对于', '有', '没有', '不', '也', '都', '还', '就', '只',
            '吗', '呢', '吧', '啊', '呀', '哦', '嗯',
            // English
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
            'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who',
            'whom', 'where', 'when', 'why', 'how', 'if', 'then', 'else', 'and', 'or',
            'but', 'because', 'so', 'although', 'while', 'for', 'with', 'about',
            'to', 'from', 'in', 'on', 'at', 'by', 'of', 'as', 'not', 'no', 'yes',
            'please', 'tell', 'me', 'explain', 'describe', 'say', 'said', 'talk', 'talked'
        ]);

        // Tokenize the query with timeout protection
        try {
            const tokens = sanitizedQuery
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Keep letters and numbers only
                .split(/\s+/)
                .filter(token => token.length >= 2 && token.length <= 50 && !stopWords.has(token))
                .slice(0, 20); // Limit to 20 keywords max

            return [...new Set(tokens)]; // Remove duplicates
        } catch (error) {
            console.error('Error extracting keywords:', error);
            return [];
        }
    }

    /**
     * Calculate relevance score for a paragraph based on keyword matches
     * @param {string} paragraph - Text to score
     * @param {string[]} keywords - Keywords to match
     * @param {Map<string, RegExp>} regexCache - Optional cache for compiled regexes
     */
    calculateRelevanceScore(paragraph, keywords, regexCache = null) {
        const lowerPara = paragraph.toLowerCase();
        let score = 0;

        for (const keyword of keywords) {
            // Use cached regex or create new one
            let regex;
            if (regexCache && regexCache.has(keyword)) {
                regex = regexCache.get(keyword);
            } else {
                regex = new RegExp(this.escapeRegex(keyword), 'gi');
                if (regexCache) {
                    regexCache.set(keyword, regex);
                }
            }

            // Count occurrences
            const matches = lowerPara.match(regex);

            if (matches) {
                // Base score for each match
                score += matches.length * 2;

                // Bonus for exact phrase match
                if (lowerPara.includes(keyword)) {
                    score += 3;
                }
            }
        }

        // Normalize by paragraph length to avoid bias towards longer paragraphs
        if (paragraph.length > 0) {
            score = score / Math.log(paragraph.length + 10);
        }

        return score;
    }

    /**
     * Escape special regex characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Chunk text into smaller pieces
     */
    chunkText(text, maxLength) {
        const chunks = [];
        let remaining = text;

        while (remaining.length > maxLength) {
            // Find a good break point
            let breakPoint = remaining.lastIndexOf('。', maxLength);
            if (breakPoint === -1) breakPoint = remaining.lastIndexOf('.', maxLength);
            if (breakPoint === -1) breakPoint = remaining.lastIndexOf(' ', maxLength);
            if (breakPoint === -1) breakPoint = maxLength;

            chunks.push(remaining.substring(0, breakPoint + 1).trim());
            remaining = remaining.substring(breakPoint + 1).trim();
        }

        if (remaining.length > 0) {
            chunks.push(remaining);
        }

        return chunks;
    }

    /**
     * Truncate text to specified length
     */
    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) {
            return text || '';
        }

        // Try to break at a sentence boundary
        const truncated = text.substring(0, maxLength);
        const lastPeriod = Math.max(
            truncated.lastIndexOf('。'),
            truncated.lastIndexOf('.'),
            truncated.lastIndexOf('！'),
            truncated.lastIndexOf('!'),
            truncated.lastIndexOf('？'),
            truncated.lastIndexOf('?')
        );

        if (lastPeriod > maxLength * 0.8) {
            return truncated.substring(0, lastPeriod + 1) + '\n...(内容已截取)';
        }

        return truncated + '...(内容已截取)';
    }
}

module.exports = new ChatService();
