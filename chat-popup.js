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

// ── Inject HTML ───────────────────────────────────────────────────────────────
function injectPopup() {
const style = document.createElement('style');
    style.textContent = `
    /* ── Float button ──────────────────────────────────────────────── */
    #chat-popup-btn {
        position: fixed; bottom: 24px; right: 24px; z-index: 8000;
        width: 56px; height: 56px; border-radius: 50%;
        background: var(--c-accent); color: #fff;
        border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 12px rgba(0,0,0,.3);
        transition: transform .15s, box-shadow .15s;
    }
    #chat-popup-btn:hover { transform: scale(1.06); box-shadow: 0 4px 20px rgba(0,0,0,.35); }
    #chat-popup-unread {
        position: absolute; top: -3px; right: -3px;
        background: #e3293e; color: #fff; font-size: 10px; font-weight: 700;
        border-radius: 10px; padding: 1px 5px; min-width: 16px;
        text-align: center; border: 2px solid white; display: none;
    }

    /* ── Panel ─────────────────────────────────────────────────────── */
    #chat-popup-panel {
        position: fixed; bottom: 90px; right: 24px; z-index: 8000;
        width: 328px; max-height: 520px;
        background: var(--c-surface);
        border-radius: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,.12), 0 12px 40px rgba(0,0,0,.22);
        display: flex; flex-direction: column; overflow: hidden;
        transform: scale(.9) translateY(20px);
        transform-origin: bottom right;
        opacity: 0; pointer-events: none;
        transition: transform .2s cubic-bezier(.34,1.56,.64,1), opacity .15s;
    }
    #chat-popup-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }

    /* ── Icon button (used in both headers) ────────────────────────── */
    .popup-icon-btn {
        width: 34px; height: 34px; border-radius: 50%;
        background: var(--c-raised); border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: var(--c-text-2); transition: background .12s, color .12s; flex-shrink: 0;
    }
    .popup-icon-btn:hover { background: var(--c-hover); color: var(--c-text); }

    /* ── Header — list view ─────────────────────────────────────────── */
    .popup-header-list {
        padding: 14px 14px 10px;
        display: flex; align-items: center; gap: 6px; flex-shrink: 0;
        border-bottom: 1px solid var(--c-border);
    }
    .popup-header-list-title {
        flex: 1; font-size: 20px; font-weight: 800;
        color: var(--c-text); letter-spacing: -.02em;
    }

    /* ── Header — chat view ─────────────────────────────────────────── */
    .popup-header-chat {
        padding: 8px 10px;
        display: flex; align-items: center; gap: 6px; flex-shrink: 0;
        border-bottom: 1px solid var(--c-border);
    }
    .popup-header-chat-avatar {
        width: 36px; height: 36px; border-radius: 50%;
        background: var(--c-raised); border: 1px solid var(--c-border);
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700; color: var(--c-text-2);
        flex-shrink: 0; overflow: hidden;
    }
    .popup-header-chat-avatar img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
    .popup-header-chat-info { flex: 1; min-width: 0; }
    .popup-header-chat-name {
        font-size: 14px; font-weight: 700; color: var(--c-text);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .popup-header-chat-sub { font-size: 11px; color: var(--c-text-3); margin-top: 1px; }

    /* ── Body ───────────────────────────────────────────────────────── */
    .popup-body {
        flex: 1; overflow: hidden;
        display: flex; flex-direction: column;
    }

    /* ── Conversation list ──────────────────────────────────────────── */
    .popup-list-scroll { flex: 1; overflow-y: auto; }
    .popup-search { padding: 8px 12px 4px; }
    .popup-search input {
        width: 100%; padding: 8px 14px; border-radius: 20px;
        border: none; background: var(--c-raised);
        color: var(--c-text); font-size: 13px; outline: none;
        box-sizing: border-box;
    }
    .popup-search input:focus { outline: 2px solid var(--c-accent); outline-offset: -2px; }
    .popup-conv-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 14px; cursor: pointer; transition: background .1s;
    }
    .popup-conv-item:hover { background: var(--c-hover); }
    .popup-conv-avatar {
        width: 44px; height: 44px; border-radius: 50%;
        background: var(--c-raised); border: 1px solid var(--c-border);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: 700; color: var(--c-text-2);
        flex-shrink: 0; overflow: hidden;
    }
    .popup-conv-avatar img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
    .popup-conv-info { flex: 1; min-width: 0; }
    .popup-conv-name {
        font-size: 14px; font-weight: 600; color: var(--c-text);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .popup-conv-preview {
        font-size: 12px; color: var(--c-text-3);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;
    }
    .popup-conv-preview.unread { color: var(--c-text); font-weight: 600; }
    .popup-conv-meta { display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0; }
    .popup-conv-time { font-size: 11px; color: var(--c-text-3); white-space:nowrap; }
    .popup-unread-badge {
        background: var(--c-accent); color: #fff;
        font-size: 11px; font-weight: 700; border-radius: 12px;
        padding: 2px 7px; min-width: 20px; text-align: center;
    }
    .popup-new-dm {
        padding: 10px 16px; font-size: 13px; color: var(--c-text-2);
        cursor: pointer; display: flex; align-items: center; gap: 10px;
        border-top: 1px solid var(--c-border); transition: background .1s; font-weight: 500;
    }
    .popup-new-dm:hover { background: var(--c-hover); color: var(--c-accent); }

    /* ── Messages ───────────────────────────────────────────────────── */
    .popup-messages {
        flex: 1; overflow-y: auto;
        padding: 12px 12px 6px;
        display: flex; flex-direction: column; gap: 3px;
    }
    .popup-msg-row {
        display: flex; align-items: flex-end;
        gap: 4px; position: relative;
    }
    .popup-msg-row.mine { flex-direction: row-reverse; }

    .popup-bubble {
        padding: 9px 13px; border-radius: 20px;
        font-size: 13.5px; line-height: 1.45; color: var(--c-text);
        background: var(--c-raised);
        max-width: 230px; word-break: break-word;
        display: inline-block;
    }
    .popup-msg-row.mine .popup-bubble {
        background: var(--c-accent); color: #fff;
    }
    .popup-bubble img { max-width:160px; border-radius:12px; display:block; cursor:pointer; }

    .popup-msg-deleted {
        font-size: 12px; color: var(--c-text-3); font-style: italic;
        display: flex; align-items: center; gap: 5px;
    }
    .popup-msg-row.mine .popup-msg-deleted { color: rgba(255,255,255,.65); }
    .popup-edited-tag { font-size: 10px; opacity: .6; margin-left: 3px; }

    /* Hover action button (⋮) on own messages */
    .popup-msg-actions {
        display: flex; align-items: center;
        opacity: 0; transition: opacity .12s; flex-shrink: 0;
        padding-bottom: 3px;
    }
    .popup-msg-row:hover .popup-msg-actions { opacity: 1; }
    .popup-msg-action-btn {
        background: var(--c-surface); border: 1px solid var(--c-border);
        border-radius: 50%; width: 24px; height: 24px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: var(--c-text-2);
        transition: background .1s;
        box-shadow: 0 1px 4px rgba(0,0,0,.1);
    }
    .popup-msg-action-btn:hover { background: var(--c-hover); color: var(--c-text); }

    /* Mini context menu for message actions */
    .popup-ctx-menu {
        position: fixed; z-index: 9500;
        background: var(--c-surface); border: 1px solid var(--c-border);
        border-radius: 10px; padding: 4px;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
        min-width: 155px;
    }
    .popup-ctx-item {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; font-size: 13px; color: var(--c-text);
        cursor: pointer; border-radius: 7px; transition: background .1s;
    }
    .popup-ctx-item:hover { background: var(--c-hover); }
    .popup-ctx-item.danger { color: var(--c-danger); }
    .popup-ctx-item.danger:hover { background: rgba(239,68,68,.09); }

    /* Inline edit box inside popup bubble */
    .popup-edit-textarea {
        width: 100%; min-width: 140px; max-width: 200px;
        background: rgba(127,127,127,.12); border: 1px solid var(--c-border);
        border-radius: 10px; padding: 6px 10px;
        color: inherit; font: inherit; resize: none; outline: none; font-size: 13px;
    }
    .popup-edit-actions {
        display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;
    }
    .popup-edit-actions button {
        background: none; border: none; cursor: pointer;
        font-size: 11px; font-weight: 600; color: inherit; opacity: .8; padding: 2px 4px;
    }
    .popup-edit-actions button:hover { opacity: 1; text-decoration: underline; }

    /* ── Input area ─────────────────────────────────────────────────── */
    .popup-input-area {
        border-top: 1px solid var(--c-border); padding: 8px 10px;
        flex-shrink: 0; display: flex; flex-direction: column; gap: 4px;
    }
    .popup-file-strip { display:flex; flex-wrap:wrap; gap:4px; }
    .popup-file-chip {
        background: var(--c-raised); border: 1px solid var(--c-border);
        border-radius: 12px; padding: 3px 10px; font-size: 11px;
        color: var(--c-text-2); display: flex; align-items: center; gap: 4px;
    }
    .popup-file-chip button { background:none; border:none; color:var(--c-text-3); cursor:pointer; font-size:12px; padding:0; }
    .popup-row { display:flex; align-items:flex-end; gap:4px; }
    .popup-textarea {
        flex: 1; background: var(--c-raised); border: 1px solid transparent;
        border-radius: 22px; padding: 9px 14px; font-size: 13px; color: var(--c-text);
        font-family: var(--font); resize: none; outline: none;
        line-height: 1.4; max-height: 80px; overflow-y: auto;
    }
    .popup-textarea:focus { border-color: var(--c-accent); }
    .popup-textarea::placeholder { color: var(--c-text-3); }
    .popup-attach-btn {
        background: none; border: none; border-radius: 50%; width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: var(--c-accent); transition: background .12s; flex-shrink: 0;
    }
    .popup-attach-btn:hover { background: var(--c-hover); }
    .popup-send-btn {
        background: var(--c-accent); border: none; border-radius: 50%;
        width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: #fff; flex-shrink: 0; transition: filter .12s;
    }
    .popup-send-btn:hover { filter: brightness(1.12); }
    .popup-send-btn:disabled { opacity: .45; }
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="chat-popup-btn" onclick="toggleChatPopup()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span id="chat-popup-unread"></span>
    </div>
    <div id="chat-popup-panel">
        <div id="popup-header"></div>
        <div class="popup-body" id="popup-body">
            <div style="padding:30px;text-align:center;color:var(--c-text-3);font-size:13px;">Loading…</div>
        </div>
    </div>
    <input type="file" id="popup-file-input" style="display:none" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple onchange="popupOnFileSelect(this.files)">`;
    document.body.appendChild(wrap);
}

// ── Toggle ────────────────────────────────────────────────────────────────────
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

// ── Load Data ─────────────────────────────────────────────────────────────────
async function initPopupData() {
    if (!currentUser) return;

    const [{ data: profiles }, { data: convs }] = await Promise.all([
        sb.from('profiles').select('id,full_name,role,avatar_url').eq('is_active', true),
        sb.from('conversations').select(`id,type,name,is_general,created_at,conversation_participants(user_id,last_read_at)`)
    ]);

    _popupProfiles = profiles || [];

_popupConvs = (convs || []).map(c => {
        if (c.type === 'group') return { ...c, displayName: c.name || 'General', isGroup: true };
        const otherId   = c.conversation_participants?.find(p => p.user_id !== currentUser.id)?.user_id;
        const otherUser = _popupProfiles.find(p => p.id === otherId);
        return { ...c, displayName: otherUser?.full_name || 'DM', otherUser, isGroup: false };
    }).filter(c => c.isGroup || c.otherUser).sort((a, b) => {
        if (a.isGroup && !b.isGroup) return -1;
        if (!a.isGroup && b.isGroup) return 1;
        return a.displayName.localeCompare(b.displayName);
    });

    await Promise.all(_popupConvs.map(loadPopupUnread));
    popupShowList();
    updatePopupBadge();
}

async function loadPopupUnread(conv) {
    const myPart = conv.conversation_participants?.find(p => p.user_id === currentUser.id);
    const [{ count }, { data: lastMsgs }] = await Promise.all([
        sb.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .gt('created_at', myPart?.last_read_at || '1970-01-01')
            .neq('sender_id', currentUser.id),
        sb.from('messages')
            .select('content, file_name, created_at, sender_id')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
    ]);
    conv.unread = count || 0;
    _popupUnread[conv.id] = conv.unread;
    conv.lastMessage = lastMsgs?.[0] || null;
}

// ── List view ─────────────────────────────────────────────────────────────────
window.popupShowList = function() {
    _popupView = 'list';
    _popupConvId = null;
    if (_popupChannel) { sb.removeChannel(_popupChannel); _popupChannel = null; }

    // ── List header ──
    document.getElementById('popup-header').innerHTML = `
        <div class="popup-header-list">
            <span class="popup-header-list-title">Messaging</span>
            <button class="popup-icon-btn" onclick="popupShowNewDM()" title="New message">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="popup-icon-btn" onclick="toggleChatPopup()" title="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;

    const allOtherUsers = _popupProfiles.filter(p => p.id !== currentUser.id);
    const existingDMIds = new Set(_popupConvs.filter(c => !c.isGroup).map(c => c.otherUser?.id));
    const noConvUsers   = allOtherUsers.filter(p => !existingDMIds.has(p.id));

    let html = `<div class="popup-search"><input placeholder="Search people and groups…" oninput="popupFilterList(this.value)"></div>`;
    html += _popupConvs.map(c => {
        const preview = c.lastMessage
            ? (c.lastMessage.file_name ? `📎 ${c.lastMessage.file_name}` : c.lastMessage.content || '')
            : 'No messages yet';
        const timeStr = c.lastMessage
            ? (() => { const d = new Date(c.lastMessage.created_at); const now = new Date();
                return (now - d < 86400000)
                    ? d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
                    : d.toLocaleDateString([], {month:'short', day:'numeric'}); })()
            : '';
        const hasUnread = c.unread > 0;
        return `<div class="popup-conv-item" onclick="popupOpenConv('${c.id}')">
            <div class="popup-conv-avatar" style="${c.isGroup ? 'background:var(--c-accent-g);color:var(--c-accent);' : ''}">
                ${c.isGroup
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
                    : (c.otherUser?.avatar_url ? `<img src="${c.otherUser.avatar_url}">` : popupInitials(c.displayName))
                }
            </div>
            <div class="popup-conv-info">
                <div class="popup-conv-name">${escHtml(c.displayName)}</div>
                <div class="popup-conv-preview ${hasUnread ? 'unread' : ''}">${escHtml((preview || '').slice(0, 45))}</div>
            </div>
            <div class="popup-conv-meta">
                <span class="popup-conv-time">${timeStr}</span>
                ${hasUnread ? `<span class="popup-unread-badge">${c.unread}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    if (noConvUsers.length) {
        html += `<div class="popup-new-dm" onclick="popupShowNewDM()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Start a new conversation
        </div>`;
    }

    document.getElementById('popup-body').innerHTML = `<div class="popup-list-scroll">${html || `<div style="padding:30px;text-align:center;color:var(--c-text-3);font-size:13px;">No conversations yet</div>`}</div>`;
};
// ── New DM picker ─────────────────────────────────────────────────────────────
window.popupShowNewDM = function() {
    const others = _popupProfiles.filter(p => p.id !== currentUser.id);
    const existingDMIds = new Set(_popupConvs.filter(c => !c.isGroup).map(c => c.otherUser?.id));
    const available = others.filter(p => !existingDMIds.has(p.id));

    document.getElementById('popup-header').innerHTML = `
        <div class="popup-header-chat">
            <button class="popup-icon-btn" onclick="popupShowList()" title="Back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="popup-header-chat-info" style="flex:1;">
                <div class="popup-header-chat-name">New Message</div>
            </div>
            <button class="popup-icon-btn" onclick="toggleChatPopup()" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;

    document.getElementById('popup-body').innerHTML = `<div class="popup-list-scroll">${
        available.map(p => {
            const rm = ROLE_META[p.role] || { label: p.role, color: '#6b7280' };
            return `<div class="popup-conv-item" onclick="popupCreateDM('${p.id}')">
                <div class="popup-conv-avatar">${p.avatar_url ? `<img src="${p.avatar_url}">` : popupInitials(p.full_name)}</div>
                <div class="popup-conv-info">
                    <div class="popup-conv-name">${escHtml(p.full_name)}</div>
                    <div class="popup-conv-preview" style="color:${rm.color};">${rm.label}</div>
                </div>
            </div>`;
        }).join('') || `<div style="padding:20px;text-align:center;color:var(--c-text-3);font-size:13px;">All users already have conversations</div>`
    }</div>`;
};

window.popupCreateDM = async function(otherUserId) {
    const { data: convId, error } = await sb.rpc('find_or_create_dm', { p_other_user_id: otherUserId });
    if (error || !convId) { showToast('Could not create conversation', 'error'); return; }
    await initPopupData();
    popupOpenConv(convId);
};
// ── Open conversation in popup ────────────────────────────────────────────────
window.popupOpenConv = async function(convId) {
    _popupConvId = convId;
    _popupView   = 'chat';
    _popupPending = [];

    const conv = _popupConvs.find(c => c.id === convId);

    // ── Chat header with avatar + name ──
    const avatarHTML = conv?.isGroup
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
        : (conv?.otherUser?.avatar_url ? `<img src="${escHtml(conv.otherUser.avatar_url)}">` : popupInitials(conv?.displayName || '?'));

    document.getElementById('popup-header').innerHTML = `
        <div class="popup-header-chat">
            <button class="popup-icon-btn" onclick="popupShowList()" title="Back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="popup-header-chat-avatar" style="${conv?.isGroup ? 'background:var(--c-accent-g);color:var(--c-accent);' : ''}">
                ${avatarHTML}
            </div>
            <div class="popup-header-chat-info">
                <div class="popup-header-chat-name">${escHtml(conv?.displayName || 'Chat')}</div>
                <div class="popup-header-chat-sub">${conv?.isGroup ? 'Group chat' : 'Direct message'}</div>
            </div>
            <button class="popup-icon-btn" onclick="popupInitiateCall()" title="Audio call">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9A16 16 0 0 0 15 16.09l1.15-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </button>
            <a href="chat.html" class="popup-icon-btn" title="Open full chat" style="text-decoration:none;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <button class="popup-icon-btn" onclick="toggleChatPopup()" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;

    // Mark read
    await sb.from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', convId).eq('user_id', currentUser.id);
    if (conv) conv.unread = 0;
    _popupUnread[convId] = 0;
    updatePopupBadge();

    // Render messages pane + input
    document.getElementById('popup-body').innerHTML = `
        <div id="popup-messages" class="popup-messages"></div>
        <div class="popup-input-area">
            <div class="popup-file-strip" id="popup-file-strip"></div>
            <div class="popup-row">
                <button class="popup-attach-btn" onclick="document.getElementById('popup-file-input').click()" title="Attach">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <textarea class="popup-textarea" id="popup-textarea" placeholder="Type a message…" rows="1"
                    onkeydown="popupKeydown(event)" oninput="popupAutoGrow(this)"></textarea>
                <button class="popup-send-btn" id="popup-send-btn" onclick="popupSend()">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
            </div>
        </div>`;

    // ← Now fetches deleted + edited_at
    const { data: msgs } = await sb.from('messages')
        .select('id,content,file_url,file_name,file_type,sender_id,created_at,deleted,edited_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true })
        .limit(60);

    popupRenderMessages(msgs || []);
    popupSubscribe(convId);
    document.getElementById('popup-textarea')?.focus();
};

function popupRenderMessages(msgs) {
    const wrap = document.getElementById('popup-messages');
    if (!wrap) return;
    wrap.innerHTML = msgs.map(msg => popupMsgHTML(msg)).join('');
    wrap.scrollTop = wrap.scrollHeight;
}

function popupMsgHTML(msg) {
    const isMe      = msg.sender_id === currentUser.id;
    const isDeleted = !!msg.deleted;
    const conv      = _popupConvs.find(c => c.id === _popupConvId);
    const canModify = isMe && !conv?.is_general && !isDeleted;

    let content = '';
    if (isDeleted) {
        content = `<span class="popup-msg-deleted"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Message deleted</span>`;
    } else if (msg.file_url && msg.file_type?.startsWith('image/')) {
        content = `<img src="${escHtml(msg.file_url)}" onclick="popupLightbox('${escHtml(msg.file_url)}')" style="max-width:160px;border-radius:12px;display:block;cursor:pointer;">${msg.content ? `<div style="margin-top:4px;">${escHtml(msg.content)}</div>` : ''}`;
    } else if (msg.file_url) {
        content = `<a href="${escHtml(msg.file_url)}" target="_blank" style="display:flex;align-items:center;gap:5px;color:inherit;text-decoration:none;font-size:12px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(msg.file_name || 'File')}</a>${msg.content ? `<div style="margin-top:4px;">${escHtml(msg.content)}</div>` : ''}`;
    } else {
        content = escHtml(msg.content || '');
    }
    if (msg.edited_at && !isDeleted) content += ' <span class="popup-edited-tag">(edited)</span>';

    const actionsHTML = canModify ? `
        <div class="popup-msg-actions">
            <button class="popup-msg-action-btn" onclick="popupShowMsgMenu(event,'${msg.id}')" title="More options">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
                </svg>
            </button>
        </div>` : '';

    // For .mine rows: row-reverse makes actionsHTML appear to the LEFT of the bubble
    return `<div class="popup-msg-row${isMe ? ' mine' : ''}" data-id="${msg.id}">
        ${actionsHTML}
        <div class="popup-bubble">${content}</div>
    </div>`;
}

function popupSubscribe(convId) {
    if (_popupChannel) sb.removeChannel(_popupChannel);
    _popupChannel = sb.channel('popup:' + convId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload) => {
            const wrap = document.getElementById('popup-messages');
            if (wrap) {
                wrap.insertAdjacentHTML('beforeend', popupMsgHTML(payload.new));
                wrap.scrollTop = wrap.scrollHeight;
            }
            if (payload.new.sender_id !== currentUser.id) {
                sb.from('conversation_participants')
                    .update({ last_read_at: new Date().toISOString() })
                    .eq('conversation_id', convId).eq('user_id', currentUser.id).then(() => {});
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload) => {
            const row = document.querySelector(`.popup-msg-row[data-id="${payload.new.id}"]`);
            if (!row) return;
            const bubble = row.querySelector('.popup-bubble');
            if (!bubble) return;
            if (payload.new.deleted) {
                bubble.innerHTML = '<span class="popup-msg-deleted"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Message deleted</span>';
                row.querySelector('.popup-msg-actions')?.remove();
            } else if (payload.new.edited_at) {
                bubble.innerHTML = escHtml(payload.new.content || '') + ' <span class="popup-edited-tag">(edited)</span>';
            }
        })
        .subscribe();
}

window.popupSend = async function() {
    const input   = document.getElementById('popup-textarea');
    const content = input?.value?.trim() || '';
    if (!content && !_popupPending.length) return;
    const btn = document.getElementById('popup-send-btn');
    if (btn) btn.disabled = true;
    try {
        if (_popupPending.length) {
            for (const f of _popupPending) {
                const path = `${_popupConvId}/${Date.now()}-${f.file.name}`;
                const { error } = await sb.storage.from('chat-files').upload(path, f.file);
                if (error) { showToast('Upload failed: ' + f.file.name, 'error'); continue; }
                const { data: { publicUrl } } = sb.storage.from('chat-files').getPublicUrl(path);
                await sb.from('messages').insert({
                    conversation_id: _popupConvId, sender_id: currentUser.id,
                    content: f === _popupPending[_popupPending.length - 1] ? content : '',
                    file_url: publicUrl, file_name: f.file.name, file_type: f.file.type
                });
            }
            _popupPending = [];
            const strip = document.getElementById('popup-file-strip');
            if (strip) strip.innerHTML = '';
        } else {
            const { error: insertErr } = await sb.from('messages')
    .insert({ conversation_id: _popupConvId, sender_id: currentUser.id, content });
if (insertErr) throw new Error(insertErr.message);
        }
        if (input) { input.value = ''; input.style.height = ''; }
    } catch(err) { showToast('Send failed: ' + err.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
};

window.popupKeydown = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); popupSend(); } };
window.popupAutoGrow = function(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 80) + 'px'; };

window.popupOnFileSelect = function(files) {
    Array.from(files).forEach(file => {
        if (file.size > 20 * 1024 * 1024) { showToast(`${file.name} exceeds 20MB`, 'error'); return; }
        _popupPending.push({ file });
    });
    const strip = document.getElementById('popup-file-strip');
    if (strip) strip.innerHTML = _popupPending.map((f, i) =>
        `<div class="popup-file-chip">${escHtml(f.file.name)} <button onclick="popupRemoveFile(${i})">✕</button></div>`).join('');
    document.getElementById('popup-file-input').value = '';
};
window.popupRemoveFile = function(i) { _popupPending.splice(i, 1); popupOnFileSelect([]); };
window.popupLightbox = function(url) {
    const lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;';
    lb.innerHTML = `<img src="${escHtml(url)}" style="max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain;">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
};

function updatePopupBadge() {
    const total  = Object.values(_popupUnread).reduce((a, b) => a + b, 0);
    const badge  = document.getElementById('chat-popup-unread');
    const navBadge = document.getElementById('chat-nav-badge');
    if (badge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = total ? '' : 'none'; }
    if (navBadge) { navBadge.textContent = total > 99 ? '99+' : total; navBadge.style.display = total ? '' : 'none'; }
}

function popupInitials(name) {
    if (!name) return '?';
    const p = name.trim().split(' ');
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
}

// ── Subscribe to new messages across ALL convos for unread badge ───────────────
function subscribeAllMessages() {
    // Load badge count immediately on page load without needing to open the popup
    loadInitialUnreadCount();

    sb.channel('my-inbox-participants-popup:' + currentUser.id)
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'conversation_participants',
            filter: `user_id=eq.${currentUser.id}`
        }, () => {
            _popupConvs = []; // forces a fresh reload the next time the popup is opened
            loadInitialUnreadCount();
        })
        .subscribe();

    sb.channel('all-messages-popup')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
            const msg = payload.new;
            if (msg.sender_id === currentUser.id) return;
            if (msg.conversation_id === _popupConvId && _popupOpen) return;
            _popupUnread[msg.conversation_id] = (_popupUnread[msg.conversation_id] || 0) + 1;
            const conv = _popupConvs.find(c => c.id === msg.conversation_id);
            if (conv) { conv.unread = _popupUnread[msg.conversation_id]; conv.lastMessage = msg; }
            updatePopupBadge();
        })
        .subscribe();
}

async function loadInitialUnreadCount() {
    if (!currentUser) return;
    const { data: parts } = await sb.from('conversation_participants')
        .select('conversation_id, last_read_at').eq('user_id', currentUser.id);
    if (!parts || !parts.length) return;
    let total = 0;
    for (const part of parts) {
        const { count } = await sb.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', part.conversation_id)
            .gt('created_at', part.last_read_at || '1970-01-01')
            .neq('sender_id', currentUser.id);
        if (count) { _popupUnread[part.conversation_id] = count; total += count; }
    }
    const badge = document.getElementById('chat-popup-unread');
    const navBadge = document.getElementById('chat-nav-badge');
    if (badge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = total ? '' : 'none'; }
    if (navBadge) { navBadge.textContent = total > 99 ? '99+' : total; navBadge.style.display = total ? '' : 'none'; }
}

// ── Call from popup ───────────────────────────────────────────────────────────
window.popupInitiateCall = function() {
    const conv = _popupConvs.find(c => c.id === _popupConvId);
    if (!conv) return;
    if (typeof initiateCall === 'function') { initiateCall(_popupConvId); return; }
    const initials = popupInitials(conv.displayName);
    const overlay = document.createElement('div');
    overlay.id = 'popup-call-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--c-surface);border:1px solid var(--c-border);border-radius:24px;padding:40px 32px;text-align:center;width:300px;';
    const avatarDiv = document.createElement('div');
    avatarDiv.style.cssText = 'width:80px;height:80px;border-radius:50%;background:var(--c-accent-g);border:3px solid var(--c-accent);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:var(--c-accent);margin:0 auto 14px;';
    avatarDiv.textContent = initials;
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-size:18px;font-weight:600;color:var(--c-text);margin-bottom:4px;';
    nameDiv.textContent = conv.displayName;
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'font-size:13px;color:var(--c-text-3);margin-bottom:28px;';
    statusDiv.textContent = 'Calling...';
    const endBtn = document.createElement('button');
    endBtn.style.cssText = 'width:58px;height:58px;border-radius:50%;background:#ef4444;border:none;cursor:pointer;color:#fff;font-size:22px;';
    endBtn.textContent = '✕';
    endBtn.onclick = function() { overlay.remove(); };
    box.appendChild(avatarDiv);
    box.appendChild(nameDiv);
    box.appendChild(statusDiv);
    box.appendChild(endBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
};

window.popupFilterList = function(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('.popup-conv-item').forEach(el => {
        const name = el.querySelector('.popup-conv-name')?.textContent?.toLowerCase() || '';
        el.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
};

// ── Popup message edit / delete ───────────────────────────────────────────────

window.popupShowMsgMenu = function(e, msgId) {
    e.stopPropagation();
    const existing = document.getElementById('popup-msg-menu');
    if (existing) { existing.remove(); return; } // toggle off if already open

    const menu = document.createElement('div');
    menu.id = 'popup-msg-menu';
    menu.className = 'popup-ctx-menu';
    menu.innerHTML = `
        <div class="popup-ctx-item" onclick="popupEditMsg('${msgId}');document.getElementById('popup-msg-menu')?.remove()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit message
        </div>
        <div class="popup-ctx-item danger" onclick="popupDeleteMsg('${msgId}');document.getElementById('popup-msg-menu')?.remove()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete for everyone
        </div>`;

    document.body.appendChild(menu);
    const btnRect = e.currentTarget.getBoundingClientRect();
    const mw = 160, mh = 88;
    let x = btnRect.left - mw - 6;
    let y = btnRect.top;
    if (x < 8) x = btnRect.right + 6;
    if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    setTimeout(() => document.addEventListener('click', () => document.getElementById('popup-msg-menu')?.remove(), { once: true }), 50);
};

window.popupDeleteMsg = async function(msgId) {
    const conv = _popupConvs.find(c => c.id === _popupConvId);
    if (conv?.is_general) { showToast('Messages in General cannot be deleted.', 'error'); return; }

    const { error } = await sb.from('messages')
        .update({ deleted: true, content: null, file_url: null, file_name: null, file_type: null })
        .eq('id', msgId).eq('sender_id', currentUser.id);
    if (error) { showToast('Could not delete message', 'error'); return; }

    const row = document.querySelector(`.popup-msg-row[data-id="${msgId}"]`);
    const bubble = row?.querySelector('.popup-bubble');
    if (bubble) bubble.innerHTML = '<span class="popup-msg-deleted"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Message deleted</span>';
    row?.querySelector('.popup-msg-actions')?.remove();
};

window.popupEditMsg = async function(msgId) {
    const conv = _popupConvs.find(c => c.id === _popupConvId);
    if (conv?.is_general) { showToast('Messages in General cannot be edited.', 'error'); return; }

    const { data: msg, error } = await sb.from('messages')
        .select('id,content,deleted').eq('id', msgId).single();
    if (error || !msg || msg.deleted) { showToast('Could not load message', 'error'); return; }

    const row    = document.querySelector(`.popup-msg-row[data-id="${msgId}"]`);
    const bubble = row?.querySelector('.popup-bubble');
    if (!bubble) return;

    bubble.innerHTML = `
        <textarea id="popup-edit-${msgId}" class="popup-edit-textarea" rows="2">${escHtml(msg.content || '')}</textarea>
        <div class="popup-edit-actions">
            <button onclick="popupCancelEdit('${msgId}')">Cancel</button>
            <button onclick="popupSaveEdit('${msgId}')" style="color:var(--c-accent);">Save</button>
        </div>`;

    const ta = document.getElementById(`popup-edit-${msgId}`);
    if (ta) {
        ta.focus(); ta.selectionStart = ta.value.length;
        ta.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); popupSaveEdit(msgId); }
            if (ev.key === 'Escape') { ev.preventDefault(); popupCancelEdit(msgId); }
        });
    }
};

window.popupCancelEdit = async function(msgId) {
    const { data: msg } = await sb.from('messages')
        .select('id,content,edited_at').eq('id', msgId).single();
    const row    = document.querySelector(`.popup-msg-row[data-id="${msgId}"]`);
    const bubble = row?.querySelector('.popup-bubble');
    if (bubble && msg) {
        bubble.innerHTML = escHtml(msg.content || '') + (msg.edited_at ? ' <span class="popup-edited-tag">(edited)</span>' : '');
    }
};

window.popupSaveEdit = async function(msgId) {
    const ta = document.getElementById(`popup-edit-${msgId}`);
    const newContent = ta?.value?.trim() || '';
    if (!newContent) { showToast('Message cannot be empty', 'error'); return; }

    const { data: updated, error } = await sb.from('messages')
        .update({ content: newContent, edited_at: new Date().toISOString() })
        .eq('id', msgId).eq('sender_id', currentUser.id)
        .select('id,content,edited_at').single();
    if (error) { showToast('Could not save edit', 'error'); return; }

    const row    = document.querySelector(`.popup-msg-row[data-id="${msgId}"]`);
    const bubble = row?.querySelector('.popup-bubble');
    if (bubble) bubble.innerHTML = escHtml(updated.content || '') + (updated.edited_at ? ' <span class="popup-edited-tag">(edited)</span>' : '');
};
    
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
