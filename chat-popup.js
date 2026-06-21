// ─── CHAT POPUP WIDGET ───────────────────────────────────────────────────────
// Injected on all pages via nav.html. Provides the Facebook-style chat bubble.

(function() {

// Local escHtml fallback in case app.js isn't loaded yet
function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Use app.js escHtml if available, otherwise use local
function escHtml(s) { return (typeof window.escHtml === 'function' ? window.escHtml : _esc)(s); }

let _popupConvId     = null;
let _popupChannel    = null;
let _popupConvs      = [];
let _popupProfiles   = [];
let _popupUnread     = {};
let _popupOpen       = false;
let _popupView       = 'list'; // 'list' | 'chat'
let _popupPending    = [];

// ── Inject HTML ──────────────────────────────────────────────────────────
function injectPopup() {
    // Styles are now centralized in chat-styles.css; do not inject CSS here.

    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="chat-popup-btn" onclick="toggleChatPopup()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span id="chat-popup-unread"></span>
    </div>
    <div id="chat-popup-panel">
        <div class="popup-header">
            <span class="popup-header-title" id="popup-title">Messages</span>
            <button class="popup-header-btn" id="popup-call-btn" onclick="popupInitiateCall()" style="display:none;" title="Audio call">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 [...]/></svg>
            </button>
            <a href="chat.html" class="popup-header-btn" title="Open full chat" style="text-decoration:none;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </a>
            <button class="popup-header-btn" id="popup-back-btn" onclick="popupShowList()" style="display:none;" title="Back">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="popup-header-btn" onclick="toggleChatPopup()" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <div class="popup-body" id="popup-body">
            <div style="padding:30px;text-align:center;color:var(--c-text-3);font-size:13px;">Loading…</div>
        </div>
    </div>
    <input type="file" id="popup-file-input" style="display:none" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple onchange="popupOnFileSelect(this.files)">`;
    document.body.appendChild(wrap);
}

// ── Toggle ───────────────────────────────────────────────────────────
window.toggleChatPopup = function() {
    _popupOpen = !_popupOpen;
    const panel = document.getElementById('chat-popup-panel');
    if (_popupOpen) {
        panel.classList.add('open');
        if (!_popupConvs.length) initPopupData();
        else popupShowList();
    } else {
        panel.classList.remove('open');
    }
};

/* Rest of chat-popup.js remains unchanged (behavioral JS preserved). */

// ── Boot after auth is ready ──────────────────────────────────────────────────
function waitForAuth() {
    if (currentUser && sb) {
        subscribeAllMessages();
        return;
    }
    setTimeout(waitForAuth, 300);
}

// ── Init: wait until DOM is ready, then inject popup and wait for auth ────────
function bootPopup() {
    // Don't show the popup widget when already on the full chat page
    if (window.location.pathname.endsWith('chat.html') || window.location.pathname === '/chat') return;
    // Avoid double-init if script somehow loaded twice
    if (window._chatPopupBooted) return;
    window._chatPopupBooted = true;
    injectPopup();
    waitForAuth();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPopup);
} else {
    bootPopup();
}

})();
