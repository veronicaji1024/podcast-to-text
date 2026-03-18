// Podcast AI - Frontend JavaScript

// API Base URL
const API_BASE_URL = window.location.origin;

// DOM Elements
const podcastUrl = document.getElementById('podcastUrl');
const pasteBtn = document.getElementById('pasteBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const uploadBtn = document.getElementById('uploadBtn');
const audioFile = document.getElementById('audioFile');
const summaryLanguage = document.getElementById('summaryLanguage');
const detailLevel = document.getElementById('detailLevel');

// Progress Elements
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');

// Result Elements
const resultsSection = document.getElementById('resultsSection');
const podcastInfo = document.getElementById('podcastInfo');
const podcastCover = document.getElementById('podcastCover');
const podcastTitle = document.getElementById('podcastTitle');
const podcastAuthor = document.getElementById('podcastAuthor');
const podcastDescription = document.getElementById('podcastDescription');
const podcastDuration = document.getElementById('podcastDuration');
const podcastDate = document.getElementById('podcastDate');

// Tab Elements
const tabSummary = document.getElementById('tabSummary');
const tabTranscript = document.getElementById('tabTranscript');
const summaryContent = document.getElementById('summaryContent');
const transcriptContent = document.getElementById('transcriptContent');
const summaryText = document.getElementById('summaryText');
const transcriptText = document.getElementById('transcriptText');

// Error Elements
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');

// Chat Elements
const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const chatStatus = document.getElementById('chatStatus');

// State
let currentJobId = null;
let currentAccessToken = null;
let pollInterval = null;
let currentResult = null;
let pollRetryCount = 0;
const MAX_POLL_RETRIES = 5;
const POLL_TIMEOUT = 10000; // 10 seconds

// Chat State
let chatHistory = [];
let isChatLoading = false;

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
});

function initializeEventListeners() {
    // Paste button
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            podcastUrl.value = text;
        } catch (err) {
            showNotification('无法访问剪贴板，请手动粘贴', 'error');
        }
    });

    // Analyze button
    analyzeBtn.addEventListener('click', handleAnalyze);

    // Upload button
    uploadBtn.addEventListener('click', () => {
        audioFile.click();
    });

    // File input change
    audioFile.addEventListener('change', handleFileUpload);

    // Tab switching
    tabSummary.addEventListener('click', () => switchTab('summary'));
    tabTranscript.addEventListener('click', () => switchTab('transcript'));

    // Copy buttons
    document.getElementById('copySummaryBtn').addEventListener('click', () => {
        copyToClipboard(summaryText.innerText);
    });
    document.getElementById('copyTranscriptBtn').addEventListener('click', () => {
        copyToClipboard(transcriptText.innerText);
    });

    // Download buttons
    document.getElementById('downloadSummaryBtn').addEventListener('click', downloadSummary);
    document.getElementById('downloadTranscriptBtn').addEventListener('click', downloadTranscript);

    // Retry button
    retryBtn.addEventListener('click', () => {
        errorSection.classList.add('hidden');
        resetUI();
    });

    // Enter key on input
    podcastUrl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleAnalyze();
        }
    });

    // Chat event listeners
    if (chatSendBtn) {
        chatSendBtn.addEventListener('click', sendChatMessage);
    }
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }
}

// Handle Analyze Button Click
async function handleAnalyze() {
    const url = podcastUrl.value.trim();
    
    if (!url) {
        showNotification('请输入播客链接', 'error');
        podcastUrl.focus();
        return;
    }

    if (!isValidUrl(url)) {
        showNotification('请输入有效的 URL', 'error');
        return;
    }

    startProcessing();

    try {
        const response = await fetch(`${API_BASE_URL}/api/process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                language: summaryLanguage.value,
                detailLevel: detailLevel.value
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '处理请求失败');
        }

        currentJobId = data.jobId;
        currentAccessToken = data.accessToken;
        startPolling(currentJobId);

    } catch (error) {
        showError(error.message);
    }
}

// Handle File Upload
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('audio/')) {
        showNotification('请选择音频文件', 'error');
        return;
    }

    // Check file size (500MB limit)
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
        showNotification('文件大小超过 500MB 限制', 'error');
        return;
    }

    startProcessing();

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language', summaryLanguage.value);
    formData.append('detailLevel', detailLevel.value);

    try {
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '上传文件失败');
        }

        currentJobId = data.jobId;
        currentAccessToken = data.accessToken;
        startPolling(currentJobId);

    } catch (error) {
        showError(error.message);
    }

    // Reset file input
    audioFile.value = '';
}

// Start Processing UI
function startProcessing() {
    // Hide other sections
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    
    // Show progress section
    progressSection.classList.remove('hidden');
    
    // Reset progress
    updateProgress(0, '准备开始...');
    resetSteps();
    
    // Scroll to progress
    progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Reset Steps UI
function resetSteps() {
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`step${i}`);
        step.className = 'flex items-center p-3 rounded-lg border transition-all step-pending';
        const icon = step.querySelector('.step-icon');
        icon.className = 'step-icon fas fa-circle text-notion-border text-xs';
    }
}

// Update Progress
function updateProgress(percent, text) {
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${Math.round(percent)}%`;
    progressText.textContent = text;
}

// Update Step Status
function updateStep(stepNumber, status) {
    const step = document.getElementById(`step${stepNumber}`);
    const icon = step.querySelector('.step-icon');

    if (status === 'active') {
        step.className = 'flex items-center p-3 rounded-lg border transition-all step-active';
        icon.className = 'step-icon fas fa-spinner fa-spin text-notion-accent text-xs';
    } else if (status === 'completed') {
        step.className = 'flex items-center p-3 rounded-lg border transition-all step-completed';
        icon.className = 'step-icon fas fa-check text-green-600 text-xs';
    } else if (status === 'error') {
        step.className = 'flex items-center p-3 rounded-lg border transition-all border-red-300 bg-red-50';
        icon.className = 'step-icon fas fa-times text-red-500 text-xs';
    }
}

// Start Polling Job Status
function startPolling(jobId) {
    if (pollInterval) {
        clearInterval(pollInterval);
    }

    pollRetryCount = 0;

    pollInterval = setInterval(async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT);

            const response = await fetch(`${API_BASE_URL}/api/status/${jobId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '获取状态失败');
            }

            // Reset retry count on successful response
            pollRetryCount = 0;

            // Store access token for later use (downloads)
            if (data.accessToken) {
                currentAccessToken = data.accessToken;
            }

            updateJobStatus(data);

            if (data.status === 'completed') {
                clearInterval(pollInterval);
                showResults(data.result);
            } else if (data.status === 'error') {
                clearInterval(pollInterval);
                // Pass error with suggestion if available
                showError(data.error, data.suggestion);
            }

        } catch (error) {
            pollRetryCount++;
            console.warn(`Polling attempt ${pollRetryCount} failed:`, error.message);

            if (pollRetryCount >= MAX_POLL_RETRIES) {
                clearInterval(pollInterval);
                showError('网络连接不稳定，请检查网络后重试');
            }
            // Otherwise, keep trying
        }
    }, 2000);
}

// Update Job Status UI
function updateJobStatus(data) {
    const { step, progress, message } = data;

    // Update progress
    updateProgress(progress, message);

    // Update steps
    if (step) {
        const stepMap = {
            'analyzing': 1,
            'downloading': 2,
            'transcribing': 3,
            'optimizing': 4,
            'summarizing': 5
        };

        const currentStepNum = stepMap[step];
        
        if (currentStepNum) {
            // Mark previous steps as completed
            for (let i = 1; i < currentStepNum; i++) {
                updateStep(i, 'completed');
            }
            // Mark current step as active
            updateStep(currentStepNum, 'active');
        }
    }
}

// Show Results
function showResults(result) {
    currentResult = result;

    // Hide progress
    progressSection.classList.add('hidden');

    // Show results
    resultsSection.classList.remove('hidden');

    // Expand main content area to accommodate chat panel
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        mainContent.classList.remove('max-w-4xl');
        mainContent.classList.add('max-w-6xl');
    }

    // Reset chat for new results
    resetChat();

    // Update podcast info
    if (result.metadata) {
        const { metadata } = result;
        podcastInfo.classList.remove('hidden');
        
        if (metadata.cover) {
            podcastCover.src = metadata.cover;
            podcastCover.classList.remove('hidden');
        } else {
            podcastCover.classList.add('hidden');
        }
        
        podcastTitle.textContent = metadata.title || '未知播客';
        podcastAuthor.textContent = metadata.author || '未知作者';
        podcastDescription.textContent = metadata.description || '';
        
        if (metadata.duration) {
            podcastDuration.querySelector('span').textContent = formatDuration(metadata.duration);
            podcastDuration.classList.remove('hidden');
        } else {
            podcastDuration.classList.add('hidden');
        }
        
        if (metadata.date) {
            podcastDate.querySelector('span').textContent = formatDate(metadata.date);
            podcastDate.classList.remove('hidden');
        } else {
            podcastDate.classList.add('hidden');
        }
    } else {
        podcastInfo.classList.add('hidden');
    }

    // Update content
    summaryText.innerHTML = formatMarkdown(result.summary || '');
    transcriptText.textContent = result.transcript || '';

    // Switch to summary tab
    switchTab('summary');

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    showNotification('处理完成！', 'success');
}

// Switch Tab
function switchTab(tab) {
    if (tab === 'summary') {
        tabSummary.className = 'flex-1 py-3 px-4 text-sm font-medium text-notion-text border-b-2 border-notion-text bg-notion-hover transition-all';
        tabTranscript.className = 'flex-1 py-3 px-4 text-sm font-medium text-notion-text-light hover:text-notion-text border-b-2 border-transparent transition-all';
        summaryContent.classList.remove('hidden');
        transcriptContent.classList.add('hidden');
    } else {
        tabTranscript.className = 'flex-1 py-3 px-4 text-sm font-medium text-notion-text border-b-2 border-notion-text bg-notion-hover transition-all';
        tabSummary.className = 'flex-1 py-3 px-4 text-sm font-medium text-notion-text-light hover:text-notion-text border-b-2 border-transparent transition-all';
        transcriptContent.classList.remove('hidden');
        summaryContent.classList.add('hidden');
    }
}

// Show Error with optional suggestion
function showError(message, suggestion = null) {
    progressSection.classList.add('hidden');
    errorSection.classList.remove('hidden');

    // Parse error if it's an object with suggestion
    if (typeof message === 'object' && message.error) {
        suggestion = message.suggestion || suggestion;
        message = message.error;
    }

    // Display error message
    if (suggestion) {
        errorMessage.innerHTML = '';
        const msgSpan = document.createElement('span');
        msgSpan.textContent = message;
        errorMessage.appendChild(msgSpan);

        const suggestionP = document.createElement('p');
        suggestionP.className = 'text-red-500 text-xs mt-2';
        suggestionP.textContent = suggestion;
        errorMessage.appendChild(suggestionP);
    } else {
        errorMessage.textContent = message;
    }

    showNotification(message, 'error');
}

// Reset UI
function resetUI() {
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    podcastUrl.value = '';
    currentJobId = null;
    currentAccessToken = null;
    currentResult = null;
    pollRetryCount = 0;
    if (pollInterval) {
        clearInterval(pollInterval);
    }
    // Reset chat
    resetChat();
    // Restore main content width
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        mainContent.classList.remove('max-w-6xl');
        mainContent.classList.add('max-w-4xl');
    }
}

// Copy to Clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('已复制到剪贴板', 'success');
    } catch (err) {
        showNotification('复制失败', 'error');
    }
}

// Download Summary
function downloadSummary() {
    if (!currentJobId || !currentAccessToken) {
        // Fallback to blob download if no server auth
        if (!currentResult || !currentResult.summary) return;
        const title = currentResult.metadata?.title || '播客笔记';
        const blob = new Blob([currentResult.summary], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}_笔记.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
    }

    // Download from server with token
    const downloadUrl = `${API_BASE_URL}/api/download/${currentJobId}/summary?token=${encodeURIComponent(currentAccessToken)}`;
    window.location.href = downloadUrl;
}

// Download Transcript
function downloadTranscript() {
    if (!currentJobId || !currentAccessToken) {
        // Fallback to blob download if no server auth
        if (!currentResult || !currentResult.transcript) return;
        const title = currentResult.metadata?.title || '播客转录';
        const blob = new Blob([currentResult.transcript], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}_转录.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
    }

    // Download from server with token
    const downloadUrl = `${API_BASE_URL}/api/download/${currentJobId}/transcript?token=${encodeURIComponent(currentAccessToken)}`;
    window.location.href = downloadUrl;
}

// Utility Functions
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}小时${minutes}分钟`;
    }
    return `${minutes}分钟`;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatMarkdown(text) {
    // Use marked.js for proper markdown parsing with DOMPurify for XSS protection
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        // Configure marked options
        marked.setOptions({
            breaks: true,
            gfm: true
        });

        // Parse markdown and sanitize HTML
        const rawHtml = marked.parse(text);
        return DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em',
                          'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'hr'],
            ALLOWED_ATTR: ['href', 'target', 'rel'],
            ALLOW_DATA_ATTR: false
        });
    }

    // Fallback: escape HTML and do simple formatting (safe but less featured)
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    return escaped
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/^\&gt; (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\n/g, '<br>');
}

// Notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    let bgColor, icon;

    if (type === 'success') {
        bgColor = 'bg-green-600';
        icon = 'fa-check';
    } else if (type === 'error') {
        bgColor = 'bg-red-600';
        icon = 'fa-exclamation-circle';
    } else {
        bgColor = 'bg-notion-text';
        icon = 'fa-info-circle';
    }

    notification.className = `fixed top-4 right-4 ${bgColor} text-white px-5 py-3 rounded-lg shadow-lg flex items-center space-x-2 z-50 animate-fade-in text-sm`;

    // Create elements safely to prevent XSS
    const iconEl = document.createElement('i');
    iconEl.className = `fas ${icon}`;
    const textEl = document.createElement('span');
    textEl.textContent = message; // Use textContent, not innerHTML
    notification.appendChild(iconEl);
    notification.appendChild(textEl);

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-20px)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// ==================== Chat Functions ====================

// Send chat message
async function sendChatMessage() {
    if (!chatInput || isChatLoading) return;

    const message = chatInput.value.trim();
    if (!message) return;

    if (!currentJobId || !currentAccessToken) {
        showNotification('请先处理一个播客', 'error');
        return;
    }

    // Add user message to chat
    addChatMessage('user', message);
    chatInput.value = '';

    // Show loading state
    isChatLoading = true;
    setChatLoading(true);

    try {
        const response = await fetch(
            `${API_BASE_URL}/api/chat/${currentJobId}?token=${encodeURIComponent(currentAccessToken)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    history: chatHistory.slice(-10) // Send last 10 messages for context
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '聊天请求失败');
        }

        // Add assistant response to chat
        addChatMessage('assistant', data.reply);

        // Update chat history
        chatHistory.push(
            { role: 'user', content: message },
            { role: 'assistant', content: data.reply }
        );

    } catch (error) {
        console.error('Chat error:', error);
        addChatMessage('assistant', `抱歉，发生了错误：${error.message}`);
    } finally {
        isChatLoading = false;
        setChatLoading(false);
    }
}

// Add message to chat UI
function addChatMessage(role, content) {
    if (!chatMessages) return;

    // Remove welcome message if it's the first real message
    const welcomeMsg = chatMessages.querySelector('.text-center');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message p-3 text-sm ${
        role === 'user' ? 'chat-message-user' : 'chat-message-assistant'
    }`;

    if (role === 'assistant') {
        // Format markdown for assistant messages
        const contentDiv = document.createElement('div');
        contentDiv.className = 'markdown-content';
        contentDiv.innerHTML = formatMarkdown(content);
        messageDiv.appendChild(contentDiv);
    } else {
        // Plain text for user messages
        messageDiv.textContent = content;
    }

    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Set chat loading state
function setChatLoading(loading) {
    if (chatStatus) {
        chatStatus.classList.toggle('hidden', !loading);
    }
    if (chatSendBtn) {
        chatSendBtn.disabled = loading;
        chatSendBtn.classList.toggle('opacity-50', loading);
    }
    if (chatInput) {
        chatInput.disabled = loading;
    }
}

// Clear chat history
function clearChat() {
    if (!chatMessages) return;

    chatHistory = [];

    // Clear messages
    chatMessages.innerHTML = `
        <div class="text-center text-sm text-notion-text-light py-4">
            <i class="fas fa-robot text-2xl mb-2 block text-notion-accent"></i>
            <p>你可以问我关于这个播客的任何问题</p>
            <p class="text-xs mt-1">例如："某个观点原文是怎么说的？"</p>
        </div>
    `;
}

// Reset chat when starting new job
function resetChat() {
    chatHistory = [];
    if (chatMessages) {
        chatMessages.innerHTML = `
            <div class="text-center text-sm text-notion-text-light py-4">
                <i class="fas fa-robot text-2xl mb-2 block text-notion-accent"></i>
                <p>你可以问我关于这个播客的任何问题</p>
                <p class="text-xs mt-1">例如："某个观点原文是怎么说的？"</p>
            </div>
        `;
    }
    if (chatInput) {
        chatInput.value = '';
    }
    setChatLoading(false);
}

// Add fade-in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fade-in {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    .animate-fade-in {
        animation: fade-in 0.3s ease-out;
    }
`;
document.head.appendChild(style);
