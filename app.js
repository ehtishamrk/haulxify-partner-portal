// app.js — Shared utilities for Haulxify Partner Portal

// ─── Supabase Client ─────────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser    = null;
let currentProfile = null;

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

// Populate navbar avatar + dynamic role pill
// helper — populates any avatar element with photo or initials
function setAvatar(el, fullName, avatarUrl) {
    if (!el) return;
    if (avatarUrl) {
        el.innerHTML = `<img src="${avatarUrl}" alt="${fullName}">`;
    } else if (fullName) {
        const parts = fullName.trim().split(' ');
        const initials = parts.length >= 2
            ? parts[0][0] + parts[parts.length - 1][0]
            : parts[0].slice(0, 2);
        el.textContent = initials.toUpperCase();
    }
}

// populate nav avatar + dropdown header
setAvatar(document.getElementById('nav-avatar'), profile.full_name, profile.avatar_url);
setAvatar(document.getElementById('dropdown-avatar'), profile.full_name, profile.avatar_url);

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

function redirectToLogin() {
    const path = window.location.pathname;
    if (!path.endsWith('index.html') && path !== '/') {
        window.location.href = 'index.html';
    }
}

function redirectByRole(role) {
    window.location.href = role === 'super_admin' ? 'admin.html' : 'leads.html';
}

async function logout() {
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
        agent:profiles!leads_created_by_fkey(id, full_name, email)
    `).order('created_at', { ascending: false });

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

async function deleteLead(id) {
    const { error } = await sb.from('leads').delete().eq('id', id);
    if (error) throw error;
}

// ─── USERS API ────────────────────────────────────────────────────────────────

async function fetchProfiles() {
    const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function updateProfile(id, updates) {
    const { error } = await sb.from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

async function createPortalUser(email, password, fullName, role) {
    // signUp with metadata so the trigger sets correct role
    const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: fullName, role } }
    });
    if (error) throw error;

    // Ensure profile upsert (trigger may lag)
    if (data.user) {
        await sb.from('profiles').upsert({
            id: data.user.id, email, full_name: fullName, role, is_active: true
        }, { onConflict: 'id' });
    }
    return data;
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
