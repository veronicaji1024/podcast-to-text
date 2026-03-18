/**
 * Error Handler Utility
 * Parses errors and provides user-friendly messages with suggestions
 */

// Error type definitions with user-friendly messages
const ERROR_PATTERNS = [
    {
        pattern: /api.*key.*invalid|authentication|unauthorized|401/i,
        type: 'AUTH_ERROR',
        message: 'API 密钥无效或已过期',
        suggestion: '请检查 .env 文件中的 API 密钥配置是否正确'
    },
    {
        pattern: /rate.*limit|too many requests|429/i,
        type: 'RATE_LIMIT',
        message: '请求过于频繁',
        suggestion: '请稍等几分钟后再试'
    },
    {
        pattern: /timeout|timed out|超时/i,
        type: 'TIMEOUT',
        message: '请求超时',
        suggestion: '服务器响应较慢，请稍后重试或使用更短的音频'
    },
    {
        pattern: /network|connect|econnrefused|enotfound|dns/i,
        type: 'NETWORK_ERROR',
        message: '网络连接失败',
        suggestion: '请检查网络连接，或检查 API 服务是否可用'
    },
    {
        pattern: /quota|insufficient|balance|余额/i,
        type: 'QUOTA_ERROR',
        message: 'API 配额不足',
        suggestion: '请检查 API 账户余额或升级套餐'
    },
    {
        pattern: /file.*size|too large|超过限制/i,
        type: 'FILE_SIZE',
        message: '文件过大',
        suggestion: '请上传不超过 500MB 的音频文件'
    },
    {
        pattern: /unsupported.*format|不支持.*格式|invalid.*audio/i,
        type: 'FORMAT_ERROR',
        message: '不支持的文件格式',
        suggestion: '请上传 MP3、WAV、M4A、AAC、OGG 或 FLAC 格式的音频'
    },
    {
        pattern: /transcription.*fail|转录失败|whisper/i,
        type: 'TRANSCRIPTION_ERROR',
        message: '语音转录失败',
        suggestion: '请确保音频清晰，或尝试使用其他音频文件'
    },
    {
        pattern: /download.*fail|下载失败|无法获取/i,
        type: 'DOWNLOAD_ERROR',
        message: '音频下载失败',
        suggestion: '请检查链接是否有效，或尝试直接上传音频文件'
    },
    {
        pattern: /invalid.*url|无效.*链接/i,
        type: 'URL_ERROR',
        message: '无效的链接',
        suggestion: '请提供有效的播客链接或直接音频 URL'
    },
    {
        pattern: /server.*busy|系统繁忙/i,
        type: 'BUSY_ERROR',
        message: '系统繁忙',
        suggestion: '服务器负载较高，请稍后再试'
    },
    {
        pattern: /token.*invalid|访问令牌|forbidden|403/i,
        type: 'TOKEN_ERROR',
        message: '访问令牌无效',
        suggestion: '请刷新页面后重新开始任务'
    }
];

/**
 * Parse an error and return user-friendly information
 * @param {Error|string} error - The error to parse
 * @returns {Object} Parsed error info with type, message, and suggestion
 */
function parseError(error) {
    const errorMessage = typeof error === 'string' ? error : (error.message || String(error));

    // Find matching pattern
    for (const { pattern, type, message, suggestion } of ERROR_PATTERNS) {
        if (pattern.test(errorMessage)) {
            return {
                type,
                message,
                suggestion,
                originalMessage: errorMessage
            };
        }
    }

    // Default error info
    return {
        type: 'UNKNOWN_ERROR',
        message: '处理过程中出现错误',
        suggestion: '请稍后重试，如果问题持续请联系支持',
        originalMessage: errorMessage
    };
}

/**
 * Format error for API response
 * @param {Error|string} error - The error to format
 * @param {boolean} includeDetails - Whether to include technical details
 * @returns {Object} Formatted error response
 */
function formatErrorResponse(error, includeDetails = false) {
    const parsed = parseError(error);

    const response = {
        error: parsed.message,
        suggestion: parsed.suggestion,
        type: parsed.type
    };

    if (includeDetails && process.env.NODE_ENV !== 'production') {
        response.details = parsed.originalMessage;
    }

    return response;
}

/**
 * Create an error with additional context
 * @param {string} message - The error message
 * @param {string} type - Error type code
 * @param {Object} context - Additional context
 * @returns {Error}
 */
function createError(message, type = 'UNKNOWN_ERROR', context = {}) {
    const error = new Error(message);
    error.type = type;
    error.context = context;
    return error;
}

/**
 * Express error handling middleware
 */
function errorMiddleware(err, req, res, next) {
    console.error('Error:', err);

    const parsed = parseError(err);
    const statusCode = getStatusCode(parsed.type);

    res.status(statusCode).json(formatErrorResponse(err, true));
}

/**
 * Get HTTP status code for error type
 * @param {string} type - Error type
 * @returns {number} HTTP status code
 */
function getStatusCode(type) {
    const statusCodes = {
        'AUTH_ERROR': 401,
        'TOKEN_ERROR': 403,
        'RATE_LIMIT': 429,
        'FILE_SIZE': 413,
        'FORMAT_ERROR': 415,
        'URL_ERROR': 400,
        'NETWORK_ERROR': 503,
        'TIMEOUT': 504,
        'QUOTA_ERROR': 402,
        'BUSY_ERROR': 503,
        'UNKNOWN_ERROR': 500
    };

    return statusCodes[type] || 500;
}

module.exports = {
    parseError,
    formatErrorResponse,
    createError,
    errorMiddleware,
    getStatusCode,
    ERROR_PATTERNS
};
