/**
 * AI Service (Qwen/通义千问)
 * Handles transcript optimization and summarization using Qwen API
 */

const OpenAI = require('openai');
const { chunkText, detectLanguage } = require('../utils');

class OpenAIService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            timeout: 90000, // 90 second timeout at client level
            // Optional: Add proxy if needed
            // httpAgent: process.env.HTTP_PROXY ? new HttpsProxyAgent(process.env.HTTP_PROXY) : undefined,
        });

        this.model = process.env.OPENAI_MODEL || 'qwen-plus';
        this.maxTokens = 4000;
        this.chunkSize = 3000; // Characters per chunk for processing
        this.apiTimeout = 90000; // 90 seconds timeout for API calls
    }

    /**
     * Wrap a promise with a timeout
     * @param {Promise} promise
     * @param {number} timeoutMs
     * @param {string} operation
     * @returns {Promise}
     */
    async callWithTimeout(promise, timeoutMs = this.apiTimeout, operation = 'API call') {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`${operation} 超时 (${timeoutMs / 1000}秒)`));
            }, timeoutMs);
        });

        try {
            const result = await Promise.race([promise, timeoutPromise]);
            clearTimeout(timeoutId);
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * Optimize transcript for better readability
     * Fixes ASR errors, improves punctuation, enhances flow
     * @param {string} transcript - The transcript to optimize
     * @param {Function} onProgress - Progress callback
     * @param {string} sourceLanguage - The source language code (e.g., 'zh', 'en')
     */
    async optimizeTranscript(transcript, onProgress, sourceLanguage = null) {
        // Detect language if not provided
        const language = sourceLanguage || detectLanguage(transcript);
        console.log(`Starting transcript optimization... (language: ${language})`);

        // If transcript is short, process in one go
        if (transcript.length < this.chunkSize * 1.5) {
            return this.optimizeChunk(transcript, language);
        }

        // Split into chunks and process
        const chunks = chunkText(transcript, this.chunkSize);
        const optimizedChunks = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log(`Optimizing chunk ${i + 1}/${chunks.length}...`);

            const optimized = await this.optimizeChunk(chunks[i], language);
            optimizedChunks.push(optimized);

            if (onProgress) {
                onProgress((i + 1) / chunks.length * 100);
            }

            // Small delay to avoid rate limits
            if (i < chunks.length - 1) {
                await this.sleep(500);
            }
        }

        return optimizedChunks.join('\n\n');
    }

    /**
     * Optimize a single chunk of transcript
     * @param {string} chunk - The chunk to optimize
     * @param {string} language - The language code
     */
    async optimizeChunk(chunk, language = 'en') {
        // Language-specific instructions
        const languageInstruction = language === 'zh'
            ? '重要：输出必须是中文。保持原始的中文内容，不要翻译成英文。'
            : language === 'ja'
            ? '重要：出力は日本語である必要があります。元の日本語コンテンツを保持してください。'
            : language === 'ko'
            ? '중요: 출력은 한국어여야 합니다. 원래 한국어 콘텐츠를 유지하세요.'
            : 'Output must be in the same language as the input transcript.';

        const prompt = `You are a professional podcast transcript editor. Your task is to improve the readability and accuracy of this speech-to-text transcript.

CRITICAL: ${languageInstruction}

Instructions:
1. Fix obvious ASR (Automatic Speech Recognition) errors and typos
2. Add proper punctuation (periods, commas, question marks, etc.)
3. Break long run-on sentences into shorter, readable ones
4. Remove filler words when they don't add meaning
5. Identify and format speaker changes if apparent
6. Keep the original meaning and content intact
7. Maintain the conversational tone of the podcast
8. Do NOT summarize or condense - keep all the content
9. Do NOT translate - keep the same language as the original

Transcript to optimize:
"""
${chunk}
"""

Provide the optimized transcript only, without any additional commentary. Remember: output in the SAME language as the input.`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a professional podcast transcript editor specializing in improving ASR output while maintaining the original content, meaning, and LANGUAGE. Never translate the content - always output in the same language as the input.`
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: this.maxTokens,
                    temperature: 0.3
                }),
                this.apiTimeout,
                '文本优化'
            );

            return response.choices[0].message.content.trim();

        } catch (error) {
            console.error('Optimization error:', error);
            // Return original chunk if optimization fails
            return chunk;
        }
    }

    /**
     * Generate structured summary from transcript
     * @param {string} transcript - The transcript text to summarize
     * @param {string} outputLanguage - The language for output ('zh', 'en', or 'auto' for auto-detect)
     * @param {string} detailLevel - Level of detail ('brief', 'standard', 'detailed')
     * @param {Function} onProgress - Progress callback
     * @param {string} sourceLanguage - Optional pre-detected source language (from ASR)
     */
    async summarize(transcript, outputLanguage = 'auto', detailLevel = 'standard', onProgress, sourceLanguage = null) {
        console.log(`Starting summarization (output language: ${outputLanguage}, detail: ${detailLevel})...`);

        // Use pre-detected source language or detect from transcript
        const detectedSourceLang = sourceLanguage || detectLanguage(transcript);
        console.log(`Source language: ${detectedSourceLang}`);

        // Determine the actual output language
        // If outputLanguage is 'auto', use the detected source language
        // Otherwise, use the specified outputLanguage
        const finalOutputLanguage = outputLanguage === 'auto' ? detectedSourceLang : outputLanguage;
        console.log(`Final output language: ${finalOutputLanguage}`);

        // Determine summary length based on detail level
        const lengthGuide = {
            'brief': 'concise (about 10-15% of original length)',
            'standard': 'moderate (about 20-25% of original length)',
            'detailed': 'comprehensive (about 30-40% of original length)'
        };

        // If transcript is very long, we need to process in chunks and then summarize the summaries
        let summary;
        if (transcript.length > this.chunkSize * 3) {
            summary = await this.summarizeLongTranscript(transcript, finalOutputLanguage, detailLevel, lengthGuide[detailLevel], onProgress);
        } else {
            summary = await this.summarizeChunk(transcript, finalOutputLanguage, detailLevel, lengthGuide[detailLevel]);
            if (onProgress) onProgress(100);
        }

        return summary;
    }

    /**
     * Summarize a long transcript by chunking
     */
    async summarizeLongTranscript(transcript, sourceLanguage, detailLevel, lengthGuide, onProgress) {
        console.log('Processing long transcript in chunks...');
        
        const chunks = chunkText(transcript, this.chunkSize);
        const chunkSummaries = [];
        
        // Summarize each chunk
        for (let i = 0; i < chunks.length; i++) {
            console.log(`Summarizing chunk ${i + 1}/${chunks.length}...`);
            
            const chunkSummary = await this.summarizeChunk(
                chunks[i], 
                sourceLanguage, 
                'brief', // Use brief for chunk summaries
                'very concise (3-5 key points)'
            );
            
            chunkSummaries.push(chunkSummary);
            
            if (onProgress) {
                onProgress((i + 1) / chunks.length * 50); // First 50% for chunk summaries
            }
            
            if (i < chunks.length - 1) {
                await this.sleep(500);
            }
        }

        // Combine chunk summaries into final summary
        console.log('Creating final summary from chunk summaries...');
        const combinedSummaries = chunkSummaries.join('\n\n---\n\n');
        
        const finalSummary = await this.createFinalSummary(combinedSummaries, sourceLanguage, detailLevel, lengthGuide);
        
        if (onProgress) onProgress(100);
        
        return finalSummary;
    }

    /**
     * Summarize a single chunk
     */
    async summarizeChunk(chunk, language, detailLevel, lengthGuide) {
        const languageNames = {
            'zh': 'Chinese',
            'en': 'English',
            'ja': 'Japanese',
            'ko': 'Korean',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian'
        };

        const langName = languageNames[language] || 'the same language as the transcript';

        const prompt = `You are an expert podcast note-taker. Extract and organize the core information from this transcript section.

Requirements:
1. Output in ${langName}
2. Length: ${lengthGuide}
3. Extract the following (DO NOT use fixed section headers):
   - Main topics discussed and key arguments
   - Important viewpoints, data, examples (preserve specific details)
   - Noteworthy direct quotes (mark with quotation marks)
   - Technical concepts or background context mentioned

4. Organize information using flowing paragraphs and lists
5. Maintain the original meaning and context
6. Use clear, professional language

IMPORTANT: Do NOT use headers like "Key Topics Covered", "Main Points & Insights", "Notable Quotes", or "Key Takeaways". Just present the extracted information naturally.

Transcript:
"""
${chunk}
"""

Provide the extracted information:`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an expert at creating structured, detailed notes from podcast transcripts. You excel at extracting key insights and organizing information clearly.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: this.maxTokens,
                    temperature: 0.4
                }),
                this.apiTimeout,
                '内容总结'
            );

            return response.choices[0].message.content.trim();

        } catch (error) {
            console.error('Summarization error:', error);
            throw new Error(`总结失败: ${error.message}`);
        }
    }

    /**
     * Create final summary from chunk summaries
     */
    async createFinalSummary(combinedSummaries, language, detailLevel, lengthGuide) {
        const languageNames = {
            'zh': 'Chinese',
            'en': 'English',
            'ja': 'Japanese',
            'ko': 'Korean',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian'
        };

        const langName = languageNames[language] || 'the same language';

        const prompt = `You are an expert podcast note-taker. Synthesize the following section summaries into comprehensive, well-structured final notes.

Requirements:
1. Output in ${langName}
2. Length: Generate detailed, thorough notes - be comprehensive rather than brief
3. Create a unified narrative that flows well
4. Remove redundancies while keeping all unique insights
5. Use plain, accessible language:
   - Avoid jargon stacking; explain technical terms when they first appear
   - Do not overuse analogies
6. Structure with:

   # Podcast Summary

   ## Content Map
   (Create an ASCII tree diagram showing the podcast structure. Use this format:
   \`\`\`
   📻 [Podcast Main Topic]
   ├── 🎯 Topic 1: [Name]
   │   ├── Key point 1.1
   │   └── Key point 1.2
   ├── 🎯 Topic 2: [Name]
   │   ├── Key point 2.1
   │   ├── Key point 2.2
   │   └── Key point 2.3
   └── 🎯 Topic 3: [Name]
       └── Key point 3.1
   \`\`\`
   Adjust the number of topics and points based on actual content.)

   ## Overview
   (Brief 2-3 sentence overview of the entire podcast)

   ## Technical Context
   (Provide relevant technical background based on the podcast content:
   - What stage of technology development was being discussed
   - What models, frameworks, or techniques were emerging at that time
   - Overall industry trends relevant to the discussion
   Note: Only include information that can be extracted or reasonably inferred from the podcast content. If the podcast was released at a specific time, you may reference the state of technology at that point. Do NOT fabricate information - if context is unclear, explicitly state that.)

   ## Detailed Notes
   (Expand on each topic from the Content Map in depth:
   - For each major topic, provide thorough coverage with supporting details
   - Include relevant examples, explanations, and nuances discussed
   - Organize logically following the Content Map structure
   - Add background context where helpful for understanding)

   ## Key Insights
   (Combine key takeaways with notable quotes. Format each insight as:
   1. **[Insight Title]**: [Explanation of the insight]
      > "[Direct quote from the podcast if available]"

   2. **[Insight Title]**: [Explanation of the insight]
      > "[Direct quote from the podcast if available]"

   Include 5-10 key insights depending on podcast content.)

   ## Action Items / Further Reading
   (If applicable - include actionable recommendations or resources mentioned)

CRITICAL - Section headers to AVOID (these are from an old format and must NOT appear):
- Do NOT output "Key Topics Covered" or "关键主题覆盖" as a section
- Do NOT output "Notable Quotes" or "值得注意的引用" as a standalone section
- Do NOT output "Main Points & Insights" or "主要观点与见解" as a section
- Do NOT output "Key Takeaways" or "关键要点" as a section
- All quotes must be integrated into the "Key Insights" section, not listed separately
- Only use the exact section headers specified above (Content Map, Overview, Technical Context, Detailed Notes, Key Insights, Action Items / Further Reading)

Section Summaries:
"""
${combinedSummaries}
"""

Provide the final structured summary:`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an expert at synthesizing information and creating comprehensive, well-structured podcast notes. Write in plain, accessible language - explain technical terms when needed. Generate thorough, detailed notes rather than brief summaries. When discussing technology topics, provide relevant context about the state of the field, but never fabricate information you are not certain about.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: this.maxTokens,
                    temperature: 0.4
                }),
                this.apiTimeout,
                '生成最终总结'
            );

            return response.choices[0].message.content.trim();

        } catch (error) {
            console.error('Final summary error:', error);
            // Return combined summaries if final synthesis fails
            return combinedSummaries;
        }
    }

    /**
     * Translate text to target language
     */
    async translate(text, targetLanguage) {
        const languageNames = {
            'zh': 'Chinese (中文)',
            'en': 'English',
            'ja': 'Japanese (日本語)',
            'ko': 'Korean (한국어)',
            'es': 'Spanish (Español)',
            'fr': 'French (Français)',
            'de': 'German (Deutsch)',
            'it': 'Italian (Italiano)',
            'pt': 'Portuguese (Português)',
            'ru': 'Russian (Русский)'
        };

        const targetLangName = languageNames[targetLanguage] || targetLanguage;

        console.log(`Translating to ${targetLangName}...`);

        const prompt = `Translate the following podcast summary to ${targetLangName}. 

Requirements:
1. Maintain the original structure and formatting
2. Preserve all key information and nuances
3. Use natural, professional language in the target language
4. Keep Markdown formatting intact

Text to translate:
"""
${text}
"""

Provide the translation only:`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a professional translator specializing in podcast and content translation. You maintain the original tone, structure, and meaning while producing natural translations.`
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: this.maxTokens,
                    temperature: 0.3
                }),
                this.apiTimeout,
                '内容翻译'
            );

            return response.choices[0].message.content.trim();

        } catch (error) {
            console.error('Translation error:', error);
            // Return original text if translation fails
            return text;
        }
    }

    /**
     * Extract key topics from transcript
     */
    async extractTopics(transcript) {
        const prompt = `Extract the main topics discussed in this podcast transcript. Return as a JSON array of topic strings (max 10 topics).

Transcript:
"""
${transcript.substring(0, 3000)}
"""

Return only the JSON array, like: ["Topic 1", "Topic 2", "Topic 3"]`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: 500,
                    temperature: 0.3
                }),
                this.apiTimeout,
                '主题提取'
            );

            const content = response.choices[0].message.content.trim();
            // Extract JSON from response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return [];

        } catch (error) {
            console.error('Topic extraction error:', error);
            return [];
        }
    }

    /**
     * Summarize raw ASR transcript directly — replaces optimizeTranscript + summarize in one call.
     * The prompt handles ASR cleanup internally, eliminating the separate optimization step.
     */
    async summarizeRaw(transcript, outputLanguage = 'auto', detailLevel = 'standard', onProgress, sourceLanguage = null) {
        console.log(`Starting combined transcribe+summarize (output: ${outputLanguage}, detail: ${detailLevel})...`);

        const detectedSourceLang = sourceLanguage || detectLanguage(transcript);
        const finalOutputLanguage = outputLanguage === 'auto' ? detectedSourceLang : outputLanguage;

        const lengthGuide = {
            'brief': 'concise (about 10-15% of original length)',
            'standard': 'moderate (about 20-25% of original length)',
            'detailed': 'comprehensive (about 30-40% of original length)'
        };

        let summary;
        if (transcript.length > this.chunkSize * 3) {
            summary = await this._summarizeRawLong(transcript, finalOutputLanguage, detailLevel, lengthGuide[detailLevel], onProgress);
        } else {
            summary = await this._summarizeRawChunk(transcript, finalOutputLanguage, detailLevel, lengthGuide[detailLevel]);
            if (onProgress) onProgress(100);
        }

        return summary;
    }

    // 最终笔记的结构化 prompt 模板
    _noteTemplate(language) {
        const isZh = language === 'zh';
        if (isZh) {
            return `你是一个播客笔记整理专家。请根据以下结构，将这篇播客逐字稿整理成结构化笔记。输入是 Whisper ASR 的原始转录，可能含有轻微错误，请在整理时自动修正。

## 输出结构

### 1. 元信息
- 标题：
- 嘉宾：
- 日期：
- 时长：
- 时代背景：这期播客发布时，AI/技术行业正在发生什么？用 2-3 句话概括当时的发展节点。

### 2. 话题拆解
按讨论顺序整理，使用清晰的层级结构：
- 大标题（主要话题）
  - 中标题（子话题）
    - 要点（具体观点）

### 3. 金句摘录
提取 5-10 句最有启发、最值得记住的原话，保留原文表述。

### 4. 行动项
基于播客内容，提炼出听众可以实际去做的事情。

## 要求
- 话题拆解要完整覆盖播客内容，不要遗漏重要观点
- 用自己的话概括，但金句部分保留原文
- 层级清晰，便于快速浏览
- 语言简洁，去掉口语化的冗余表达`;
        }

        return `You are an expert podcast note-taker. Organize the following raw ASR transcript into structured notes using the template below. Silently fix minor transcription errors as you read.

## Output Structure

### 1. Meta Info
- Title:
- Guest(s):
- Date:
- Duration:
- Context: What was happening in AI/tech when this episode aired? Summarize in 2-3 sentences.

### 2. Topic Breakdown
Organized in discussion order, using clear hierarchy:
- Main Topic
  - Sub-topic
    - Key point / specific insight

### 3. Notable Quotes
Extract 5-10 of the most insightful, memorable quotes. Preserve the speaker's exact words.

### 4. Action Items
Based on the content, what can listeners actually do? List concrete, actionable steps.

## Requirements
- Cover all major topics — don't skip important points
- Paraphrase for the breakdown, but keep quotes verbatim
- Clear hierarchy for easy skimming
- Concise language, strip out filler and repetition`;
    }

    async _summarizeRawChunk(chunk, language, detailLevel, lengthGuide) {
        // 中间分块处理（长音频）：简短提取要点即可，不套用完整模板
        if (detailLevel === 'brief' && lengthGuide.includes('3-5')) {
            const prompt = `You are an expert podcast note-taker. The input is raw ASR output — silently fix minor errors as you read.
Extract the 3-5 most important points from this transcript section. Be concise.

Transcript section:
"""
${chunk}
"""

Key points:`;
            try {
                const response = await this.callWithTimeout(
                    this.openai.chat.completions.create({
                        model: this.model,
                        messages: [
                            { role: 'system', content: 'Extract key points from raw ASR transcript sections concisely.' },
                            { role: 'user', content: prompt }
                        ],
                        max_tokens: 800,
                        temperature: 0.3
                    }),
                    this.apiTimeout,
                    '要点提取'
                );
                return response.choices[0].message.content.trim();
            } catch (error) {
                console.error('Chunk extract error:', error);
                return chunk;
            }
        }

        // 短音频直接套用完整笔记模板
        const template = this._noteTemplate(language);
        const prompt = `${template}

---

Raw transcript:
"""
${chunk}
"""`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'You are an expert podcast note-taker. Follow the exact output template provided.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: this.maxTokens,
                    temperature: 0.4
                }),
                this.apiTimeout,
                '笔记提取'
            );
            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('Summarize raw chunk error:', error);
            throw new Error(`笔记提取失败: ${error.message}`);
        }
    }

    async _summarizeRawLong(transcript, language, detailLevel, lengthGuide, onProgress) {
        const chunks = chunkText(transcript, this.chunkSize);
        const chunkExtracts = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
            const extract = await this._summarizeRawChunk(chunks[i], language, 'brief', 'very concise (3-5 key points)');
            chunkExtracts.push(extract);
            if (onProgress) onProgress((i + 1) / chunks.length * 60);
            if (i < chunks.length - 1) await this.sleep(500);
        }

        // 合并所有分块要点，套用完整模板输出最终笔记
        const combined = chunkExtracts.join('\n\n---\n\n');
        const template = this._noteTemplate(language);
        const finalPrompt = `${template}

---

The following are extracted key points from each section of the podcast transcript (in order):
"""
${combined}
"""

Now produce the complete structured notes:`;

        try {
            const response = await this.callWithTimeout(
                this.openai.chat.completions.create({
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'You are an expert podcast note-taker. Synthesize section extracts into complete structured notes following the exact template provided.' },
                        { role: 'user', content: finalPrompt }
                    ],
                    max_tokens: this.maxTokens,
                    temperature: 0.4
                }),
                this.apiTimeout,
                '生成最终笔记'
            );
            if (onProgress) onProgress(100);
            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('Final notes error:', error);
            return combined;
        }
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new OpenAIService();
