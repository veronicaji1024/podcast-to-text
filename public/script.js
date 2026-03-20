// Podcast AI — Frontend (rewritten for persistent library + two-tab layout)

const API_BASE_URL = window.location.origin;

// ── State ──────────────────────────────────────────────────────
let currentJobId       = null;
let currentAccessToken = null;
let currentLibraryId   = null;
let currentDetailData  = null;
let pollInterval       = null;
let pollRetryCount     = 0;
const MAX_POLL_RETRIES = 5;
const POLL_TIMEOUT     = 10000; // ms

let chatHistory   = [];
let isChatLoading = false;

// Research tab state
let researchSelectedIds = new Set(); // multi-select
let researchAllItems    = [];        // full library snapshot
let researchChatHistory = [];
let isResearchLoading   = false;

// Library detail state
let libDetailId       = null;
let libDetailData     = null;
let libChatHistory    = [];
let isLibChatLoading  = false;

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initEventListeners);

function initEventListeners() {
    // Paste
    document.getElementById('pasteBtn').addEventListener('click', async () => {
        try {
            document.getElementById('podcastUrl').value = await navigator.clipboard.readText();
        } catch {
            showNotification('无法访问剪贴板，请手动粘贴', 'error');
        }
    });

    // Analyze / Upload
    document.getElementById('analyzeBtn').addEventListener('click', handleAnalyze);
    document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('audioFile').click());
    document.getElementById('audioFile').addEventListener('change', handleFileUpload);
    document.getElementById('podcastUrl').addEventListener('keypress', e => { if (e.key === 'Enter') handleAnalyze(); });

    // Retry button
    document.getElementById('retryBtn').addEventListener('click', () => {
        document.getElementById('errorSection').style.display = 'none';
        document.getElementById('progressSection').style.display = 'none';
    });

    // Main nav tabs
    document.getElementById('navDiscover').addEventListener('click', () => switchMainTab('discover'));
    document.getElementById('navUpload').addEventListener('click', () => switchMainTab('upload'));
    document.getElementById('navLibrary').addEventListener('click', () => switchMainTab('library'));
    document.getElementById('navResearch').addEventListener('click', () => switchMainTab('research'));

    // CTA button on Discover tab
    document.getElementById('ctaUploadBtn').addEventListener('click', () => switchMainTab('upload'));

    // "处理新播客" button — hide result, show form
    document.getElementById('backToFormBtn').addEventListener('click', showUploadForm);

    // Result: inner tabs
    document.getElementById('detailTabNotes').addEventListener('click', () => switchDetailTab('notes'));
    document.getElementById('detailTabTranscript').addEventListener('click', () => switchDetailTab('transcript'));

    // Result: copy / download
    document.getElementById('copyNotesBtn').addEventListener('click', () =>
        copyToClipboard(document.getElementById('detailNotesText').innerText));
    document.getElementById('copyTranscriptBtn').addEventListener('click', () =>
        copyToClipboard(document.getElementById('detailTranscriptText').innerText));
    document.getElementById('downloadNotesBtn').addEventListener('click', downloadNotes);
    document.getElementById('downloadTranscriptBtn').addEventListener('click', downloadTranscript);

    // Chat
    document.getElementById('chatSendBtn').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
    document.getElementById('clearChatBtn').addEventListener('click', clearChat);

    // Library detail view
    document.getElementById('libBackBtn').addEventListener('click', backToLibraryList);
    document.getElementById('libDetailTabNotes').addEventListener('click', () => switchLibDetailTab('notes'));
    document.getElementById('libDetailTabTranscript').addEventListener('click', () => switchLibDetailTab('transcript'));
    document.getElementById('libCategorySelect').addEventListener('change', saveLibCategory);
    document.getElementById('libChatSendBtn').addEventListener('click', sendLibChatMessage);
    document.getElementById('libChatInput').addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLibChatMessage(); }
    });
    document.getElementById('libClearChatBtn').addEventListener('click', () => {
        libChatHistory = [];
        const cm = document.getElementById('libChatMessages');
        cm.innerHTML = `<div data-welcome style="text-align:center;padding:32px 12px;opacity:0.40;"><i class="fas fa-robot" style="font-size:26px;display:block;margin-bottom:10px;color:#c4a6ff;"></i><p style="font-size:13px;">你可以问我关于这个播客的任何问题</p></div>`;
    });

    // Research tab
    document.getElementById('researchSelectAll').addEventListener('click',  () => researchSetAll(true));
    document.getElementById('researchSelectNone').addEventListener('click', () => researchSetAll(false));
    document.getElementById('researchChatSendBtn').addEventListener('click', sendResearchChatMessage);
    document.getElementById('researchChatInput').addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendResearchChatMessage(); }
    });
}

// ══ MAIN TAB SWITCHING ═════════════════════════════════════════
function switchMainTab(tab) {
    const isDiscover = tab === 'discover';
    const isUpload   = tab === 'upload';
    const isLibrary  = tab === 'library';
    const isResearch = tab === 'research';

    document.getElementById('tabDiscover').style.display  = isDiscover ? '' : 'none';
    document.getElementById('tabUpload').style.display    = isUpload   ? '' : 'none';
    document.getElementById('tabLibrary').style.display   = isLibrary  ? '' : 'none';
    document.getElementById('tabResearch').style.display  = isResearch ? '' : 'none';

    document.getElementById('navDiscover').classList.toggle('active', isDiscover);
    document.getElementById('navUpload').classList.toggle('active',   isUpload);
    document.getElementById('navLibrary').classList.toggle('active',  isLibrary);
    document.getElementById('navResearch').classList.toggle('active', isResearch);

    if (isLibrary)  loadLibrary();
    if (isResearch) loadResearchEpisodes();
}

// ══ LIBRARY — LIST VIEW ════════════════════════════════════════
let _libraryItems      = [];
let _activeLibCategory = 'All';

async function loadLibrary() {
    const grid    = document.getElementById('libraryGrid');
    const sidebar = document.getElementById('libSidebar');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 0;opacity:0.42;"><i class="fas fa-spinner fa-spin" style="font-size:22px;color:#c4a6ff;"></i></div>';
    if (sidebar) sidebar.innerHTML = '';

    try {
        const res  = await fetch(`${API_BASE_URL}/api/library`);
        const data = await res.json();
        _libraryItems = data.items || [];
        const categories = data.categories || [];

        if (_libraryItems.length === 0) {
            grid.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:64px 0;opacity:0.36;">
                    <i class="fa-solid fa-layer-group" style="font-size:38px;display:block;margin-bottom:16px;color:#c4a6ff;"></i>
                    <p style="font-size:16px;font-weight:600;">Library is empty</p>
                    <p style="font-size:13px;margin-top:6px;">Process a podcast to get started.</p>
                </div>`;
            return;
        }

        // Render sidebar
        if (sidebar && categories.length > 0) {
            _activeLibCategory = 'All';
            renderLibrarySidebar(categories);
        }

        renderLibraryGrid();

    } catch {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 0;opacity:0.45;">Failed to load library.</div>';
    }
}

function renderLibrarySidebar(categories) {
    const sidebar = document.getElementById('libSidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';
    categories.forEach(({ category, count }) => {
        const btn = document.createElement('button');
        const isActive = category === _activeLibCategory;
        btn.style.cssText = `display:flex;justify-content:space-between;align-items:center;width:100%;padding:7px 10px;border-radius:10px;border:1px solid ${isActive ? 'rgba(196,166,255,0.55)' : 'transparent'};background:${isActive ? 'rgba(196,166,255,0.18)' : 'transparent'};cursor:pointer;font-family:'Jost',sans-serif;font-size:12px;color:rgba(26,18,40,${isActive ? '0.85' : '0.55'});font-weight:${isActive ? '600' : '400'};text-align:left;gap:6px;`;
        btn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(category)}</span><span style="flex-shrink:0;font-size:11px;opacity:0.55;">${count}</span>`;
        btn.addEventListener('click', () => {
            _activeLibCategory = category;
            // Re-fetch to get fresh counts, or just re-render with current data
            renderLibrarySidebar(categories);
            renderLibraryGrid();
        });
        sidebar.appendChild(btn);
    });
}

function renderLibraryGrid() {
    const grid = document.getElementById('libraryGrid');
    grid.innerHTML = '';

    const filtered = _activeLibCategory === 'All'
        ? _libraryItems
        : _libraryItems.filter(item => (item.category || '其他') === _activeLibCategory);

    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 0;opacity:0.36;font-size:13px;">No episodes in this category.</div>`;
        return;
    }

    filtered.forEach(item => grid.appendChild(createLibraryCard(item)));
}

function createLibraryCard(item) {
    const div  = document.createElement('div');
    div.className = 'lib-card gl rx au';
    div.style.cursor = 'pointer';

    const date = item.created_at
        ? new Date(item.created_at * 1000).toLocaleDateString('zh-CN', { year:'numeric', month:'short', day:'numeric' })
        : '';

    const coverHtml = item.cover_url
        ? `<img src="${escapeHtml(item.cover_url)}" style="width:52px;height:52px;border-radius:12px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
        : `<div style="width:52px;height:52px;border-radius:12px;background:rgba(196,166,255,0.22);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-podcast" style="color:#c4a6ff;font-size:18px;"></i></div>`;

    const categoryBadge = item.category
        ? `<span style="font-size:10px;background:rgba(196,166,255,0.22);color:rgba(26,18,40,0.60);border-radius:6px;padding:2px 7px;">${escapeHtml(item.category)}</span>`
        : '';

    div.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start;">
            ${coverHtml}
            <div style="flex:1;min-width:0;">
                <p style="font-size:15px;font-weight:700;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHtml(item.title || '未知播客')}</p>
                ${item.author ? `<p style="font-size:12px;opacity:0.46;margin-top:3px;">${escapeHtml(item.author)}</p>` : ''}
            </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
            <span style="font-size:11px;opacity:0.36;">${date}</span>
            <div style="display:flex;gap:6px;align-items:center;">
                ${categoryBadge}
                ${item.duration ? `<span class="badge"><i class="fas fa-clock"></i>${formatDuration(item.duration)}</span>` : ''}
            </div>
        </div>`;

    // Click card → open detail
    div.addEventListener('click', () => openLibraryDetail(item.id));

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'bg';
    delBtn.style.cssText = 'width:100%;justify-content:center;margin-top:8px;font-size:12px;color:rgba(170,50,50,0.80);border-color:rgba(170,50,50,0.22);';
    delBtn.innerHTML = '<i class="fa-regular fa-trash-can" style="font-size:11px;"></i>Delete';
    delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('删除这集播客记录？')) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/library/${item.id}`, { method: 'DELETE' });
            if (!r.ok) throw new Error();
            div.style.cssText += ';opacity:0;transform:scale(0.92);transition:all 0.2s;';
            setTimeout(() => div.remove(), 200);
        } catch {
            showNotification('删除失败', 'error');
        }
    });
    div.appendChild(delBtn);

    return div;
}

// ══ LIBRARY DETAIL VIEW ════════════════════════════════════════
async function openLibraryDetail(id) {
    document.getElementById('libListView').style.display   = 'none';
    document.getElementById('libDetailView').style.display = '';

    // Reset state
    libDetailId      = id;
    libDetailData    = null;
    libChatHistory   = [];

    // Reset UI
    document.getElementById('libDetailTitle').textContent  = 'Loading...';
    document.getElementById('libDetailAuthor').textContent = '';
    document.getElementById('libDetailNotesText').innerHTML = '<div style="padding:32px;text-align:center;opacity:0.38;"><i class="fas fa-spinner fa-spin fa-lg" style="color:#c4a6ff;"></i></div>';
    document.getElementById('libDetailTranscriptText').textContent = '';
    document.getElementById('libCategorySaved').style.display = 'none';
    const cm = document.getElementById('libChatMessages');
    cm.innerHTML = `<div data-welcome style="text-align:center;padding:32px 12px;opacity:0.40;"><i class="fas fa-robot" style="font-size:26px;display:block;margin-bottom:10px;color:#c4a6ff;"></i><p style="font-size:13px;">你可以问我关于这个播客的任何问题</p></div>`;
    switchLibDetailTab('notes');

    try {
        const res = await fetch(`${API_BASE_URL}/api/library/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        libDetailData = data;

        document.getElementById('libDetailTitle').textContent  = data.title  || '未知播客';
        document.getElementById('libDetailAuthor').textContent = data.author || '';

        const cover = document.getElementById('libDetailCover');
        if (data.cover_url) { cover.src = data.cover_url; cover.style.display = ''; }
        else { cover.style.display = 'none'; }

        document.getElementById('libDetailNotesText').innerHTML       = formatMarkdown(data.summary    || '');
        document.getElementById('libDetailTranscriptText').textContent = data.transcript || '';

        // Set category picker
        const sel = document.getElementById('libCategorySelect');
        sel.value = data.category || '';

    } catch {
        showNotification('加载失败', 'error');
        backToLibraryList();
    }
}

function backToLibraryList() {
    document.getElementById('libDetailView').style.display = 'none';
    document.getElementById('libListView').style.display   = '';
    // Refresh list so category badge updates
    loadLibrary();
}

function switchLibDetailTab(tab) {
    const isNotes = tab === 'notes';
    document.getElementById('libDetailNotesContent').style.display      = isNotes ? '' : 'none';
    document.getElementById('libDetailTranscriptContent').style.display = isNotes ? 'none' : '';
    document.getElementById('libDetailTabNotes').classList.toggle('active', isNotes);
    document.getElementById('libDetailTabTranscript').classList.toggle('active', !isNotes);
}

async function saveLibCategory() {
    if (!libDetailId) return;
    const sel      = document.getElementById('libCategorySelect');
    const category = sel.value || null;
    const savedEl  = document.getElementById('libCategorySaved');

    try {
        const res = await fetch(`${API_BASE_URL}/api/library/${libDetailId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category })
        });
        if (!res.ok) throw new Error();
        savedEl.style.display = '';
        setTimeout(() => { savedEl.style.display = 'none'; }, 2000);
    } catch {
        showNotification('保存分类失败', 'error');
    }
}

async function sendLibChatMessage() {
    if (isLibChatLoading || !libDetailId) return;
    const input   = document.getElementById('libChatInput');
    const message = input.value.trim();
    if (!message) return;

    addLibChatMessage('user', message);
    input.value = '';
    isLibChatLoading = true;
    setLibChatLoading(true);

    try {
        const res  = await fetch(`${API_BASE_URL}/api/chat/${libDetailId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history: libChatHistory.slice(-10) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '聊天请求失败');
        addLibChatMessage('assistant', data.reply);
        libChatHistory.push(
            { role: 'user',      content: message    },
            { role: 'assistant', content: data.reply }
        );
    } catch (err) {
        addLibChatMessage('assistant', `抱歉，发生了错误：${err.message}`);
    } finally {
        isLibChatLoading = false;
        setLibChatLoading(false);
    }
}

function addLibChatMessage(role, content) {
    const cm = document.getElementById('libChatMessages');
    if (!cm) return;
    const welcome = cm.querySelector('[data-welcome]');
    if (welcome) welcome.remove();
    const d = document.createElement('div');
    d.className = role === 'user' ? 'cmu' : 'cma';
    if (role === 'assistant') {
        const inner = document.createElement('div');
        inner.className = 'md';
        inner.innerHTML = formatMarkdown(content);
        d.appendChild(inner);
    } else {
        d.textContent = content;
    }
    cm.appendChild(d);
    cm.scrollTop = cm.scrollHeight;
}

function setLibChatLoading(loading) {
    const status = document.getElementById('libChatStatus');
    const btn    = document.getElementById('libChatSendBtn');
    const input  = document.getElementById('libChatInput');
    if (status) status.style.display = loading ? '' : 'none';
    if (btn)    { btn.disabled = loading; btn.style.opacity = loading ? '0.5' : ''; }
    if (input)    input.disabled = loading;
}

// ══ RESEARCH TAB ═══════════════════════════════════════════════
async function loadResearchEpisodes() {
    const list = document.getElementById('researchEpisodeList');
    list.innerHTML = '<div style="text-align:center;padding:24px;opacity:0.38;font-size:13px;"><i class="fas fa-spinner fa-spin" style="color:#c4a6ff;"></i></div>';

    try {
        const res  = await fetch(`${API_BASE_URL}/api/library`);
        const data = await res.json();
        researchAllItems = data.items || [];

        if (researchAllItems.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:20px;font-size:13px;opacity:0.40;">Library 暂无播客</div>';
            return;
        }

        renderResearchList();
    } catch {
        list.innerHTML = '<div style="text-align:center;padding:20px;font-size:13px;opacity:0.40;">加载失败</div>';
    }
}

function renderResearchList() {
    const list = document.getElementById('researchEpisodeList');
    list.innerHTML = '';

    researchAllItems.forEach(item => {
        const row = document.createElement('label');
        const checked = researchSelectedIds.has(item.id);
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 14px;cursor:pointer;transition:background 0.15s;';
        row.addEventListener('mouseenter', () => row.style.background = 'rgba(196,166,255,0.10)');
        row.addEventListener('mouseleave', () => row.style.background = '');

        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.checked = checked;
        cb.style.cssText = 'width:14px;height:14px;accent-color:#c4a6ff;flex-shrink:0;cursor:pointer;';
        cb.addEventListener('change', () => {
            if (cb.checked) researchSelectedIds.add(item.id);
            else            researchSelectedIds.delete(item.id);
            updateResearchUI();
        });

        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'flex:1;font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:rgba(26,18,40,0.78);';
        titleSpan.textContent = item.title || item.id;

        const catSpan = document.createElement('span');
        catSpan.style.cssText = 'font-size:10px;background:rgba(196,166,255,0.20);color:rgba(26,18,40,0.50);border-radius:6px;padding:2px 6px;flex-shrink:0;';
        catSpan.textContent = item.category || '';

        row.appendChild(cb);
        row.appendChild(titleSpan);
        if (item.category) row.appendChild(catSpan);
        list.appendChild(row);
    });

    updateResearchUI();
}

function researchSetAll(selected) {
    researchSelectedIds.clear();
    if (selected) researchAllItems.forEach(item => researchSelectedIds.add(item.id));
    renderResearchList();
}

function updateResearchUI() {
    const count = researchSelectedIds.size;
    const countEl = document.getElementById('researchSelectedCount');
    countEl.textContent = count > 0 ? `已选 ${count} 集` : '未选择';

    const input = document.getElementById('researchChatInput');
    const btn   = document.getElementById('researchChatSendBtn');
    const enabled = count > 0;
    input.disabled    = !enabled;
    btn.disabled      = !enabled;
    btn.style.opacity = enabled ? '' : '0.4';
}

async function sendResearchChatMessage() {
    if (isResearchLoading || researchSelectedIds.size === 0) return;
    const input   = document.getElementById('researchChatInput');
    const message = input.value.trim();
    if (!message) return;

    addResearchChatMessage('user', message);
    input.value = '';
    isResearchLoading = true;
    setResearchChatLoading(true);

    try {
        const res  = await fetch(`${API_BASE_URL}/api/chat/multi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ids: [...researchSelectedIds],
                message,
                history: researchChatHistory.slice(-10)
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '聊天请求失败');

        addResearchChatMessage('assistant', data.reply);
        researchChatHistory.push(
            { role: 'user',      content: message    },
            { role: 'assistant', content: data.reply }
        );
    } catch (err) {
        addResearchChatMessage('assistant', `抱歉，发生了错误：${err.message}`);
    } finally {
        isResearchLoading = false;
        setResearchChatLoading(false);
    }
}

function addResearchChatMessage(role, content) {
    const cm = document.getElementById('researchChatMessages');
    if (!cm) return;
    const welcome = cm.querySelector('[data-welcome]');
    if (welcome) welcome.remove();

    const d = document.createElement('div');
    d.className = role === 'user' ? 'cmu' : 'cma';
    if (role === 'assistant') {
        const inner = document.createElement('div');
        inner.className = 'md';
        inner.innerHTML = formatMarkdown(content);
        d.appendChild(inner);
    } else {
        d.textContent = content;
    }
    cm.appendChild(d);
    cm.scrollTop = cm.scrollHeight;
}

function setResearchChatLoading(loading) {
    const status = document.getElementById('researchChatStatus');
    const btn    = document.getElementById('researchChatSendBtn');
    const input  = document.getElementById('researchChatInput');
    if (status) status.style.display = loading ? '' : 'none';
    if (btn)   { btn.disabled = loading; btn.style.opacity = loading ? '0.5' : ''; }
    if (input)   input.disabled = loading;
}

// Show upload form, hide result section
function showUploadForm() {
    document.getElementById('uploadResultSection').style.display = 'none';
    document.getElementById('uploadFormSection').style.display = '';
    currentLibraryId  = null;
    currentDetailData = null;
    resetChat();
}

// ══ RESULT — DETAIL VIEW (in Upload tab) ═══════════════════════
async function openDetail(id) {

    // Loading state
    document.getElementById('detailTitle').textContent = 'Loading...';
    document.getElementById('detailAuthor').textContent = '';
    document.getElementById('detailNotesText').innerHTML = '<div style="padding:32px;text-align:center;opacity:0.38;"><i class="fas fa-spinner fa-spin fa-lg" style="color:#c4a6ff;"></i></div>';
    document.getElementById('detailTranscriptText').textContent = '';

    try {
        const res = await fetch(`${API_BASE_URL}/api/library/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();

        currentLibraryId  = id;
        currentDetailData = data;

        // Meta
        document.getElementById('detailTitle').textContent  = data.title  || '未知播客';
        document.getElementById('detailAuthor').textContent = data.author || '';

        const coverEl = document.getElementById('detailCover');
        if (data.cover_url) {
            coverEl.src = data.cover_url;
            coverEl.style.display = '';
        } else {
            coverEl.style.display = 'none';
        }

        // Content
        document.getElementById('detailNotesText').innerHTML     = formatMarkdown(data.summary    || '');
        document.getElementById('detailTranscriptText').textContent = data.transcript || '';

        switchDetailTab('notes');
        resetChat();

    } catch {
        showNotification('加载失败', 'error');
        showUploadForm();
    }
}

function switchDetailTab(tab) {
    const isNotes = tab === 'notes';
    document.getElementById('detailNotesContent').style.display      = isNotes ? '' : 'none';
    document.getElementById('detailTranscriptContent').style.display = isNotes ? 'none' : '';
    document.getElementById('detailTabNotes').classList.toggle('active', isNotes);
    document.getElementById('detailTabTranscript').classList.toggle('active', !isNotes);
}

// ══ DOWNLOADS ══════════════════════════════════════════════════
function downloadNotes() {
    if (!currentDetailData) return;
    const title = currentDetailData.title || '播客笔记';
    blobDownload(currentDetailData.summary || '', `${title}_笔记.md`, 'text/markdown');
}

function downloadTranscript() {
    if (!currentDetailData) return;
    const title = currentDetailData.title || '播客转录';
    blobDownload(currentDetailData.transcript || '', `${title}_转录.txt`, 'text/plain');
}

function blobDownload(content, filename, type) {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ══ PROCESSING — URL / FILE UPLOAD ════════════════════════════
async function handleAnalyze() {
    const url = document.getElementById('podcastUrl').value.trim();
    if (!url) { showNotification('请输入播客链接', 'error'); return; }
    if (!isValidUrl(url)) { showNotification('请输入有效的 URL', 'error'); return; }

    startProcessing();

    try {
        const res  = await fetch(`${API_BASE_URL}/api/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                language:    document.getElementById('summaryLanguage').value,
                detailLevel: document.getElementById('detailLevel').value
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '处理请求失败');

        currentJobId       = data.jobId;
        currentAccessToken = data.accessToken;
        startPolling(data.jobId);

    } catch (err) {
        showUploadError(err.message);
    }
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const allowedExts = ['.mp3','.wav','.m4a','.aac','.ogg','.flac','.mp4'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && !allowedExts.includes(ext)) {
        showNotification('请选择音频文件', 'error');
        return;
    }
    if (file.size > 500 * 1024 * 1024) {
        showNotification('文件大小超过 500MB 限制', 'error');
        return;
    }

    startProcessing();

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language',    document.getElementById('summaryLanguage').value);
    formData.append('detailLevel', document.getElementById('detailLevel').value);

    try {
        const res  = await fetch(`${API_BASE_URL}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '上传文件失败');

        currentJobId       = data.jobId;
        currentAccessToken = data.accessToken;
        startPolling(data.jobId);

    } catch (err) {
        showUploadError(err.message);
    }

    document.getElementById('audioFile').value = '';
}

function startProcessing() {
    document.getElementById('progressSection').style.display = '';
    document.getElementById('errorSection').style.display    = 'none';
    updateProgress(0, 'Getting ready...');
    resetSteps();
    document.getElementById('progressSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function startPolling(jobId) {
    if (pollInterval) clearInterval(pollInterval);
    pollRetryCount = 0;

    pollInterval = setInterval(async () => {
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), POLL_TIMEOUT);

            const res  = await fetch(`${API_BASE_URL}/api/status/${jobId}`, { signal: controller.signal });
            clearTimeout(tid);
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || '获取状态失败');

            pollRetryCount = 0;
            if (data.accessToken) currentAccessToken = data.accessToken;

            updateJobStatus(data);

            if (data.status === 'completed') {
                clearInterval(pollInterval);
                document.getElementById('progressSection').style.display = 'none';
                showNotification('处理完成！', 'success');
                // Show result (notes + chat) within Upload tab
                document.getElementById('uploadFormSection').style.display = 'none';
                document.getElementById('uploadResultSection').style.display = '';
                openDetail(currentJobId);
                document.getElementById('uploadResultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

            } else if (data.status === 'error' || data.status === 'failed') {
                clearInterval(pollInterval);
                showUploadError(data.error || '处理失败');
            }

        } catch (err) {
            if (++pollRetryCount >= MAX_POLL_RETRIES) {
                clearInterval(pollInterval);
                showUploadError('网络连接不稳定，请检查网络后重试');
            }
        }
    }, 2000);
}

function updateJobStatus({ step, progress, message }) {
    updateProgress(progress, message);
    if (step) {
        const stepMap = { analyzing:1, downloading:2, transcribing:3, optimizing:4, summarizing:5 };
        const n = stepMap[step];
        if (n) {
            for (let i = 1; i < n; i++) updateStep(i, 'completed');
            updateStep(n, 'active');
        }
    }
}

function updateProgress(percent, text) {
    document.getElementById('progressBar').style.width       = `${percent}%`;
    document.getElementById('progressPercent').textContent   = `${Math.round(percent)}%`;
    document.getElementById('progressText').textContent      = text || '';
}

function resetSteps() {
    for (let i = 1; i <= 5; i++) {
        const s  = document.getElementById('step' + i);
        if (!s) continue;
        s.className = 'srow';
        const ic = s.querySelector('.step-icon');
        ic.className = 'step-icon fas fa-circle'; ic.style.color = ''; ic.style.opacity = '0.28';
    }
}

function updateStep(n, status) {
    const s  = document.getElementById('step' + n);
    if (!s) return;
    const ic = s.querySelector('.step-icon');
    s.className = 'srow';
    if (status === 'active') {
        s.classList.add('step-active');
        ic.className = 'step-icon fas fa-spinner fa-spin'; ic.style.color = '#c4a6ff'; ic.style.opacity = '1';
    } else if (status === 'completed') {
        s.classList.add('step-completed');
        ic.className = 'step-icon fas fa-check'; ic.style.color = '#6ab86a'; ic.style.opacity = '1';
    } else if (status === 'error') {
        s.classList.add('step-error');
        ic.className = 'step-icon fas fa-times'; ic.style.color = '#cc4040'; ic.style.opacity = '1';
    }
}

function showUploadError(msg) {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('errorSection').style.display    = '';
    document.getElementById('errorMessage').textContent      = msg || '处理失败';
    showNotification(msg, 'error');
}

// ══ CHAT ═══════════════════════════════════════════════════════
async function sendChatMessage() {
    if (isChatLoading) return;
    const input   = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    if (!currentLibraryId) {
        showNotification('请先选择一集播客', 'error');
        return;
    }

    addChatMessage('user', message);
    input.value = '';
    isChatLoading = true;
    setChatLoading(true);

    try {
        const tokenParam = currentAccessToken ? `?token=${currentAccessToken}` : '';
        const res  = await fetch(`${API_BASE_URL}/api/chat/${currentLibraryId}${tokenParam}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history: chatHistory.slice(-10) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '聊天请求失败');

        addChatMessage('assistant', data.reply);
        chatHistory.push(
            { role: 'user',      content: message    },
            { role: 'assistant', content: data.reply }
        );

    } catch (err) {
        addChatMessage('assistant', `抱歉，发生了错误：${err.message}`);
    } finally {
        isChatLoading = false;
        setChatLoading(false);
    }
}

function addChatMessage(role, content) {
    const cm = document.getElementById('chatMessages');
    if (!cm) return;
    const welcome = cm.querySelector('[data-welcome]');
    if (welcome) welcome.remove();

    const d = document.createElement('div');
    d.className = role === 'user' ? 'cmu' : 'cma';
    if (role === 'assistant') {
        const inner = document.createElement('div');
        inner.className = 'md';
        inner.innerHTML = formatMarkdown(content);
        d.appendChild(inner);
    } else {
        d.textContent = content;
    }
    cm.appendChild(d);
    cm.scrollTop = cm.scrollHeight;
}

function setChatLoading(loading) {
    const status = document.getElementById('chatStatus');
    const btn    = document.getElementById('chatSendBtn');
    const input  = document.getElementById('chatInput');
    if (status) status.style.display = loading ? '' : 'none';
    if (btn)   { btn.disabled = loading; btn.style.opacity = loading ? '0.5' : ''; }
    if (input)   input.disabled = loading;
}

function resetChat() {
    chatHistory = [];
    const cm = document.getElementById('chatMessages');
    if (cm) {
        cm.innerHTML = `
            <div data-welcome style="text-align:center;padding:32px 12px;opacity:0.40;">
                <i class="fas fa-robot" style="font-size:26px;display:block;margin-bottom:10px;color:#c4a6ff;"></i>
                <p style="font-size:13px;">你可以问我关于这个播客的任何问题</p>
                <p style="font-size:11px;margin-top:5px;opacity:0.7;">"某个观点原文是怎么说的？"</p>
            </div>`;
    }
    const input = document.getElementById('chatInput');
    if (input) { input.value = ''; input.disabled = false; }
    const btn = document.getElementById('chatSendBtn');
    if (btn)  { btn.disabled = false; btn.style.opacity = ''; }
    setChatLoading(false);
}

function clearChat() {
    chatHistory = [];
    const cm = document.getElementById('chatMessages');
    if (cm) {
        cm.innerHTML = `
            <div data-welcome style="text-align:center;padding:32px 12px;opacity:0.40;">
                <i class="fas fa-robot" style="font-size:26px;display:block;margin-bottom:10px;color:#c4a6ff;"></i>
                <p style="font-size:13px;">你可以问我关于这个播客的任何问题</p>
                <p style="font-size:11px;margin-top:5px;opacity:0.7;">"某个观点原文是怎么说的？"</p>
            </div>`;
    }
}

// ══ UTILITIES ══════════════════════════════════════════════════
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(()  => showNotification('已复制到剪贴板', 'success'))
        .catch(()  => showNotification('复制失败', 'error'));
}

function isValidUrl(s) {
    try { new URL(s); return true; } catch { return false; }
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

function formatMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
        return DOMPurify.sanitize(marked.parse(text), {
            ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','ul','ol','li','blockquote','code','pre','a','hr'],
            ALLOWED_ATTR: ['href','target','rel'],
            ALLOW_DATA_ATTR: false
        });
    }
    // Minimal fallback (already HTML-safe via escapeHtml usage upstream)
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function showNotification(msg, type = 'info') {
    const cols = { success:'rgba(72,155,72,0.92)', error:'rgba(195,55,55,0.90)', info:'rgba(18,14,38,0.90)' };
    const ics  = { success:'fa-check', error:'fa-exclamation-circle', info:'fa-info-circle' };
    const el   = document.createElement('div');
    el.style.cssText = `position:fixed;top:20px;right:20px;background:${cols[type]||cols.info};color:#fff;padding:11px 18px;border-radius:14px;font-size:13px;font-family:'Jost',sans-serif;font-weight:500;display:flex;align-items:center;gap:8px;z-index:9999;backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.22);box-shadow:0 8px 32px rgba(0,0,0,0.16);`;
    const i = document.createElement('i'); i.className = `fas ${ics[type]||ics.info}`;
    const t = document.createElement('span'); t.textContent = msg;
    el.appendChild(i); el.appendChild(t);
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; el.style.transition = 'all 0.28s';
        setTimeout(() => el.parentNode && document.body.removeChild(el), 300);
    }, 3000);
}
