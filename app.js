// app.js — Shared utilities for Haulxify Partner Portal

// ─── Supabase Client ─────────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false   // index.html handles the email-link exchange manually
    }
});

let currentUser    = null;
let currentProfile = null;

// ─── Detect the logged-in account changing under this tab (e.g. another tab logged
// into a different account) and force a clean reload instead of silent state mismatch ───
sb.auth.onAuthStateChange((event, session) => {
    if (currentUser && session?.user?.id && session.user.id !== currentUser.id) {
        window.location.reload();
    }
});

async function loadNav() {
    const mount = document.getElementById('topnav-mount');
    if (!mount) return;
    const label = mount.dataset.navLabel || '';
    const res = await fetch('nav.html');
    mount.innerHTML = await res.text();
    const labelEl = document.getElementById('nav-page-label');
    if (labelEl) labelEl.textContent = label;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

async function checkAuth(allowedRoles = null) {
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) { redirectToLogin(); return null; }

        const { data: profile, error } = await sb
            .from('profiles').select('*')
            .eq('id', session.user.id).single();

        if (error || !profile) { redirectToLogin(); return null; }

        if (!profile.is_active) {
            showToast('Account deactivated. Contact your admin.', 'error');
            await sb.auth.signOut();
            setTimeout(redirectToLogin, 2000);
            return null;
        }

        if (allowedRoles && !allowedRoles.includes(profile.role)) {
            redirectByRole(profile.role); return null;
        }

currentUser    = session.user;
        currentProfile = profile;
updateNotifBadge();
        subscribeNotifications();
// Single-session watcher
        const storedToken = sessionStorage.getItem('ss_token');
        const expectedToken = storedToken || profile.session_token;
        if (!_sessionChannel && expectedToken) {
            _watchSession(session.user.id, expectedToken);
            _activeSessionToken = expectedToken;
        }

// Tab-close auto logout
        _startHeartbeat();
        _joinPresence();

// populate nav avatar + dropdown header
setAvatar(document.getElementById('nav-avatar'), profile.full_name, profile.avatar_url);
setAvatar(document.getElementById('dropdown-avatar'), profile.full_name, profile.avatar_url);

const navNameEl = document.getElementById('nav-name');
if (navNameEl) navNameEl.textContent = profile.full_name || '—';

const ddName  = document.getElementById('dropdown-name');
const ddEmail = document.getElementById('dropdown-email');
if (ddName)  ddName.textContent  = profile.full_name || '—';
if (ddEmail) ddEmail.textContent = profile.email     || session.user.email || '—';

// show admin link in dropdown if admin
const ddAdmin = document.getElementById('dropdown-admin-link');
if (ddAdmin && (profile.role === 'admin' || profile.role === 'super_admin')) {
    ddAdmin.style.display = 'flex';
}
const rolePillEl = document.getElementById('nav-role-pill');
if (rolePillEl) {
    const m = ROLE_META[profile.role] || { label: profile.role, color: '#6b7280' };
    rolePillEl.textContent = m.label;
    rolePillEl.style.cssText = `background:${m.color}22;color:${m.color};border:1px solid ${m.color}44;`;
}
        
        return profile;
    } catch (err) {
        console.error('Auth error:', err);
        redirectToLogin();
        return null;
    }
}

// ─── AVATAR HELPER ───────────────────────────────────────────────────────────
function setAvatar(el, fullName, avatarUrl) {
    if (!el) return;
    if (avatarUrl) {
        el.innerHTML = `<img src="${avatarUrl}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`;
    } else if (fullName) {
        const parts = fullName.trim().split(' ');
        const initials = parts.length >= 2
            ? parts[0][0] + parts[parts.length - 1][0]
            : parts[0].slice(0, 2);
        el.textContent = initials.toUpperCase();
    }
}

function redirectToLogin() {
    const path = window.location.pathname;
    if (!path.endsWith('index.html') && path !== '/') {
        window.location.href = 'index.html';
    }
}

function redirectByRole(role) {
    if (role === 'super_admin' || role === 'admin') {
        window.location.href = 'admin.html';
    } else {
        window.location.href = 'leads.html';
    }
}
// ─── SINGLE SESSION ENFORCEMENT ──────────────────────────────────────────────

let _activeSessionToken = null;
let _sessionChannel = null;

/**
 * Generates a random token to identify this browser tab's session.
 */
function generateSessionToken() {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
}

/**
 * Call this right after a successful login.
 * Writes a fresh token to the DB, then starts watching for invalidation.
 */
async function claimSession(userId) {
    const token = generateSessionToken();
    _activeSessionToken = token;

    await sb.from('profiles')
        .update({ session_token: token })
        .eq('id', userId);

    _watchSession(userId, token);
}

/**
 * Subscribes to realtime changes on this user's profile row.
 * If the session_token changes (another login), signs out this tab.
 */
function _watchSession(userId, expectedToken) {
    if (_sessionChannel) sb.removeChannel(_sessionChannel);

    _sessionChannel = sb
        .channel('session-watch:' + userId)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'profiles',
                filter: `id=eq.${userId}`
            },
            (payload) => {
                const newToken = payload.new?.session_token;
                if (newToken && newToken !== expectedToken) {
                    // Another tab/device logged in — invalidate this session
                    _handleSessionInvalidated();
                }
            }
        )
        .subscribe();
}

async function _handleSessionInvalidated() {
    if (_sessionChannel) {
        sb.removeChannel(_sessionChannel);
        _sessionChannel = null;
    }
    await sb.auth.signOut();
    showToast('You were signed in from another location. This session has ended.', 'warning');
    setTimeout(redirectToLogin, 2500);
}

async function logout() {
    _stopHeartbeat();
    if (_presenceChannel) { sb.removeChannel(_presenceChannel); _presenceChannel = null; }
    await sb.auth.signOut();
    window.location.href = 'index.html';
}

// ─── TOAST ───────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
    let box = document.getElementById('toast-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-box';
        box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:10px;';
        document.body.appendChild(box);
    }
    const colors = { success:'#10b981', error:'#ef4444', info:'#6366f1', warning:'#f59e0b' };
    const icons  = { success:'✓', error:'✕', info:'ℹ', warning:'⚠' };
    const t = document.createElement('div');
    t.style.cssText = `
        display:flex;align-items:center;gap:10px;padding:12px 18px;
        background:#1e1e32;border:1px solid ${colors[type]||colors.info}44;
        border-left:3px solid ${colors[type]||colors.info};border-radius:10px;
        color:#f4f4ff;font-size:14px;max-width:340px;
        box-shadow:0 4px 20px rgba(0,0,0,0.5);
        animation:slideIn .25s ease;opacity:1;transition:opacity .3s;
    `;
    t.innerHTML = `<span style="color:${colors[type]};font-weight:700;font-size:16px;">${icons[type]||'ℹ'}</span><span>${msg}</span>`;
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
function formatDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function timeAgo(d) {
    if (!d) return '';
    const secs = Math.floor((Date.now() - new Date(d)) / 1000);
    if (secs < 60)  return 'just now';
    if (secs < 3600) return Math.floor(secs/60) + 'm ago';
    if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
    return Math.floor(secs/86400) + 'd ago';
}

const STATUS_META = {
    'New':         { color:'#6366f1', bg:'#6366f122' },
    'Contacted':   { color:'#06b6d4', bg:'#06b6d422' },
    'Qualified':   { color:'#eab308', bg:'#eab30822' },
    'In Progress': { color:'#f97316', bg:'#f9731622' },
    'Hired':       { color:'#10b981', bg:'#10b98122' },
    'Closed':      { color:'#6b7280', bg:'#6b728022' },
    'Lost':        { color:'#ef4444', bg:'#ef444422' },
};
function statusBadge(status) {
    const m = STATUS_META[status] || { color:'#6b7280', bg:'#6b728022' };
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;
        font-size:12px;font-weight:600;background:${m.bg};color:${m.color};border:1px solid ${m.color}44;white-space:nowrap;">
        <span style="width:6px;height:6px;border-radius:50%;background:${m.color};flex-shrink:0;"></span>${status}
    </span>`;
}

const ROLE_META = {
    super_admin:    { label:'Super Admin',    color:'#f59e0b' },
    admin:          { label:'Admin',          color:'#a855f7' },
    sales_agent:    { label:'Sales Agent',    color:'#6366f1' },
    status_updater: { label:'Status Updater', color:'#06b6d4' },
};
function roleBadge(role) {
    const m = ROLE_META[role] || { label: role, color: '#6b7280' };
    return `<span class="role-pill" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}44;">${m.label}</span>`;
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── LEADS API ────────────────────────────────────────────────────────────────

async function fetchLeads(filters = {}) {
    let q = sb.from('leads').select(`
        *,
        agent:profiles!leads_created_by_fkey(id, full_name, email),
        assigned:profiles!leads_assigned_to_fkey(id, full_name)
    `).order('created_at', { ascending: false });

    // status_updaters only see leads assigned to them
    if (window._statusUpdaterFilter) {
        q = q.eq('assigned_to', window._statusUpdaterFilter);
    }

    // sales_agents only see leads they created
    if (currentProfile?.role === 'sales_agent') {
        q = q.eq('created_by', currentProfile.id);
    }

    if (filters.status && filters.status !== 'all')
        q = q.eq('status', filters.status);
    if (filters.search && filters.search.trim()) {
        const s = filters.search.trim();
        q = q.or(`owner_name.ilike.%${s}%,company_name.ilike.%${s}%,phone.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

async function fetchLead(id) {
    const { data, error } = await sb.from('leads')
        .select('*, agent:profiles!leads_created_by_fkey(id, full_name, email)')
        .eq('id', id).single();
    if (error) throw error;
    return data;
}

async function fetchActivities(leadId) {
    const { data, error } = await sb.from('lead_activities')
        .select('*, user:profiles(full_name, role)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function createLead(payload) {
    const { data, error } = await sb.from('leads')
        .insert({ ...payload, created_by: currentProfile.id, status: 'New' })
        .select().single();
    if (error) throw error;
    await sb.from('lead_activities').insert({
        lead_id: data.id, user_id: currentProfile.id,
        action_type: 'created', new_status: 'New'
    });
    // Notify all admins and super_admins
    try {
        const { data: admins } = await sb.from('profiles')
            .select('id').in('role', ['super_admin', 'admin'])
            .eq('is_active', true).neq('id', currentProfile.id);
        if (admins && admins.length) {
            await sb.from('notifications').insert(
                admins.map(a => ({
                    user_id: a.id,
                    type: 'new_lead',
                    title: '🆕 New Lead',
                    body: `${currentProfile.full_name} added "${payload.company_name || payload.owner_name}"`,
                    lead_id: data.id
                }))
            );
        }
    } catch(e) { console.warn('Notification error:', e.message); }
    return data;
}

async function updateLead(id, payload) {
    const { data, error } = await sb.from('leads')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
    if (error) throw error;
    await sb.from('lead_activities').insert({
        lead_id: id, user_id: currentProfile.id, action_type: 'edited'
    });
    return data;
}

async function statusUpdateRpc(leadId, status, comment) {
    const { data, error } = await sb.rpc('update_lead_status_only', {
        p_lead_id: leadId, p_status: status, p_comment: comment || null
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
}

async function assignLead(leadId, assigneeId) {
    const { data, error } = await sb.rpc('assign_lead_to_employee', {
        p_lead_id: leadId,
        p_assignee: assigneeId
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
}

async function deleteLead(id) {
    if (!currentProfile || currentProfile.role !== 'super_admin') {
        throw new Error('Only a Super Admin can delete leads.');
    }
    const { error } = await sb.from('leads').delete().eq('id', id);
    if (error) throw error;
}

// ─── USERS API ────────────────────────────────────────────────────────────────

async function fetchProfiles() {
    const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// Fetch employees added by a specific admin (approved ones only)
async function fetchMyEmployees(adminId) {
    const { data, error } = await sb.from('profiles')
        .select('*')
        .eq('approved_by', adminId)
        .eq('is_approved', true)
        .eq('is_active', true)
        .order('full_name');
    if (error) throw error;
    return data || [];
}

// Fetch employees pending approval (for super_admin)
async function fetchPendingEmployees() {
    const { data, error } = await sb.from('profiles')
        .select('*, approver:profiles!profiles_approved_by_fkey(full_name)')
        .eq('is_approved', false)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function approveEmployee(userId) {
    const { error } = await sb.from('profiles')
        .update({ is_approved: true, is_active: true, updated_at: new Date().toISOString() })
        .eq('id', userId);
    if (error) throw error;
    // Send setup email via Supabase invite
    const { data: { session } } = await sb.auth.getSession();
    const redirectTo = window.location.origin +
        window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ userId, sendSetupEmail: true, redirectTo })
    });
    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error(text); }
    if (!res.ok) throw new Error(result.error || `Invite failed (${res.status})`);
}

async function updateProfile(id, updates) {
    const { error } = await sb.from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

async function createPortalUser(email, fullName, role, company = 'AIMS Logistics') {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('No active session.');

    const redirectTo = window.location.origin +
        window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';

    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ email, fullName, role, company, redirectTo })
    });

    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error(text); }
    if (!res.ok) throw new Error(result.error || `Invite failed (${res.status})`);
    return result;
}

// ─── THEME SYSTEM ────────────────────────────────────────────────────────────

async function initTheme(userId) {
    const { data } = await sb.from('profiles').select('theme').eq('id', userId).single();
    const theme = data?.theme || 'light';
    applyTheme(theme);
}

const SUN_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
const MOON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const track = document.getElementById('theme-track');
    const icon  = document.getElementById('theme-icon');
    if (!track) return;
    if (theme === 'dark') {
        track.classList.add('dark');
        if (icon) icon.innerHTML = MOON_SVG;
    } else {
        track.classList.remove('dark');
        if (icon) icon.innerHTML = SUN_SVG;
    }
}

async function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next    = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        await sb.from('profiles').update({ theme: next }).eq('id', session.user.id);
    }
}
function toggleProfileDropdown(e) {
    e.stopPropagation();
    document.getElementById('profile-dropdown').classList.toggle('open');
}

// close dropdown when clicking anywhere else
document.addEventListener('click', () => {
    const dd = document.getElementById('profile-dropdown');
    if (dd) dd.classList.remove('open');
});
// ─── TAB CLOSE AUTO LOGOUT (Heartbeat) ───────────────────────────────────────

const HEARTBEAT_KEY   = 'tab_heartbeat';
const HEARTBEAT_MS    = 3000;
const HEARTBEAT_GRACE = 8000;

let _heartbeatTimer = null;

function _startHeartbeat() {
    localStorage.setItem(HEARTBEAT_KEY, Date.now().toString());

    _heartbeatTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') {
            localStorage.setItem(HEARTBEAT_KEY, Date.now().toString());
        }
    }, HEARTBEAT_MS);
}

// ── Runs immediately on every page load, BEFORE checkAuth ──
(async () => {
    const last = parseInt(localStorage.getItem(HEARTBEAT_KEY) || '0', 10);
    const now  = Date.now();

    if (last && (now - last) > HEARTBEAT_GRACE) {
        // Tab was closed without logout — kill the session now
        localStorage.removeItem(HEARTBEAT_KEY);
        await sb.auth.signOut();
        // Only redirect if we're not already on the login page
        const path = window.location.pathname;
        if (!path.endsWith('index.html') && path !== '/') {
            window.location.href = 'index.html';
        }
    }
})();

function _stopHeartbeat() {
    clearInterval(_heartbeatTimer);
    localStorage.removeItem(HEARTBEAT_KEY);
}

// ─── PORTAL PRESENCE (real-time online status) ────────────────────────────────
let _presenceChannel = null;

function _joinPresence() {
    if (!currentUser || _presenceChannel) return;
    _presenceChannel = sb.channel('portal-presence', {
        config: { presence: { key: currentUser.id } }
    });
    _presenceChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await _presenceChannel.track({ user_id: currentUser.id });
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── NOTIFICATION SYSTEM ──────────────────────────────────────────────────────
let _notifOpen = false;

window.toggleNotifPanel = function() {
    _notifOpen = !_notifOpen;
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.style.display = _notifOpen ? 'flex' : 'none';
    if (_notifOpen) loadNotifs();
};

document.addEventListener('click', function(e) {
    const panel = document.getElementById('notif-panel');
    const btn   = document.getElementById('notif-bell-btn');
    if (_notifOpen && panel && !panel.contains(e.target) && !btn?.contains(e.target)) {
        _notifOpen = false;
        panel.style.display = 'none';
    }
});

async function loadNotifs() {
    const list = document.getElementById('notif-list');
    if (!list || !currentUser) return;
    const { data } = await sb.from('notifications')
        .select('*').eq('user_id', currentUser.id)
        .order('created_at', { ascending: false }).limit(30);
    if (!data || !data.length) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--c-text-3);font-size:13px;">No notifications yet</div>';
        return;
    }
    list.innerHTML = data.map(n => `
        <div onclick="notifClick('${n.id}','${n.lead_id || ''}')"
            style="padding:10px 14px;border-bottom:1px solid var(--c-border);cursor:pointer;display:flex;gap:10px;align-items:flex-start;background:${n.is_read ? '' : 'var(--c-accent-g,rgba(99,102,241,.06))'};"
            onmouseover="this.style.background='var(--c-hover)'"
            onmouseout="this.style.background='${n.is_read ? 'transparent' : 'var(--c-accent-g,rgba(99,102,241,.06))'}'">
            <div style="font-size:18px;line-height:1.4;">${n.type === 'new_lead' ? '🆕' : '🔔'}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:${n.is_read ? '400' : '600'};color:var(--c-text);">${n.title}</div>
                <div style="font-size:11px;color:var(--c-text-3);margin-top:2px;">${n.body || ''}</div>
                <div style="font-size:10px;color:var(--c-text-3);margin-top:3px;">${new Date(n.created_at).toLocaleString()}</div>
            </div>
            ${n.is_read ? '' : '<div style="width:7px;height:7px;border-radius:50%;background:var(--c-accent);flex-shrink:0;margin-top:5px;"></div>'}
        </div>`).join('');
}

window.notifClick = async function(notifId, leadId) {
    await sb.from('notifications').update({ is_read: true }).eq('id', notifId);
    _notifOpen = false;
    const panel = document.getElementById('notif-panel');
    if (panel) panel.style.display = 'none';
    if (leadId && window.location.pathname.includes('leads')) {
        if (typeof openDrawer === 'function') openDrawer(leadId);
    } else if (leadId) {
        window.location.href = 'leads.html';
    }
    updateNotifBadge();
};

window.markAllNotifsRead = async function() {
    if (!currentUser) return;
    await sb.from('notifications').update({ is_read: true })
        .eq('user_id', currentUser.id).eq('is_read', false);
    loadNotifs();
    updateNotifBadge();
};

window.updateNotifBadge = async function() {
    if (!currentUser) return;
    const { count } = await sb.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id).eq('is_read', false);
    const badge = document.getElementById('notif-nav-badge');
    if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = count > 0 ? '' : 'none';
    }
};

window.subscribeNotifications = function() {
    if (!currentUser) return;
    sb.channel('user-notifs:' + currentUser.id)
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'notifications',
            filter: `user_id=eq.${currentUser.id}`
        }, (payload) => {
            updateNotifBadge();
            showToast(payload.new.title + (payload.new.body ? ': ' + payload.new.body : ''), 'success');
        })
        .subscribe();
};
