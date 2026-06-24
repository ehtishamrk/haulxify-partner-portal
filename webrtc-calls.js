// ─── WebRTC Audio Calls ────────────────────────────────────────────────────────
// Signaling: Supabase Broadcast (already used for typing indicators)
// STUN:      Google public servers (free forever)
// No third-party SDK. No minute limits. No cost.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
'use strict';

const ICE = { iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
]};

// ── State ─────────────────────────────────────────────────────────────────────
let _peer       = null;   // RTCPeerConnection
let _localSt    = null;   // local MediaStream (mic)
let _callCh     = null;   // Supabase channel: offer/answer/ICE/hangup
let _notifyCh   = null;   // Supabase channel: incoming ring notifications
let _callConvId = null;
let _callState  = 'idle'; // 'idle' | 'calling' | 'incoming' | 'active'
let _timer      = null;
let _secs       = 0;
let _muted      = false;
let _peerName   = '';
let _peerAvatar = null;
let _pendingOffer = null; // SDP offer from caller, held until callee accepts

// ── Helpers ───────────────────────────────────────────────────────────────────
const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _ini = n => { const p=(n||'').trim().split(' '); return (p.length>=2?p[0][0]+p[p.length-1][0]:(p[0]||'?').slice(0,2)).toUpperCase(); };
const _toast = (m,t) => typeof showToast==='function' ? showToast(m,t) : console.log('[rtc]',m);

// ── Inject styles once ─────────────────────────────────────────────────────────
function _ensureStyle() {
    if (document.getElementById('rtc-style')) return;
    const s = document.createElement('style');
    s.id = 'rtc-style';
    s.textContent = `
        @keyframes rtcPulse{0%,100%{box-shadow:0 0 0 0 rgba(232,119,34,.45);}50%{box-shadow:0 0 0 16px rgba(232,119,34,0);}}
        #rtc-overlay{position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,.62);
            display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px);}
        .rtc-modal{background:var(--c-surface,#fff);border:1px solid var(--c-border,#dde3ec);
            border-radius:24px;padding:40px 32px;text-align:center;width:300px;
            box-shadow:0 20px 60px rgba(0,0,0,.3);}
        .rtc-av{width:88px;height:88px;border-radius:50%;
            background:var(--c-accent-g,rgba(232,119,34,.1));
            border:3px solid var(--c-accent,#e87722);
            display:flex;align-items:center;justify-content:center;
            font-size:28px;font-weight:700;color:var(--c-accent,#e87722);
            margin:0 auto 16px;overflow:hidden;animation:rtcPulse 2s infinite;}
        .rtc-av img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
        .rtc-name{font-size:18px;font-weight:600;color:var(--c-text,#0d1929);margin-bottom:4px;}
        .rtc-sub{font-size:13px;color:var(--c-text-3,#8fa3be);margin-bottom:28px;min-height:18px;}
        .rtc-timer{font-size:22px;font-weight:600;color:var(--c-text,#0d1929);
            margin-bottom:28px;font-variant-numeric:tabular-nums;display:none;}
        .rtc-btns{display:flex;justify-content:center;gap:20px;}
        .rtc-btn{width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;
            display:flex;align-items:center;justify-content:center;transition:transform .15s;}
        .rtc-btn:hover{transform:scale(1.08);}
        .rtc-btn-end{background:#ef4444;color:#fff;box-shadow:0 4px 14px rgba(239,68,68,.3);}
        .rtc-btn-accept{background:#22c55e;color:#fff;box-shadow:0 4px 14px rgba(34,197,94,.3);}
        .rtc-btn-mute{background:var(--c-raised,#f0f2f5);color:var(--c-text,#0d1929);border:1px solid var(--c-border,#dde3ec);}
        .rtc-btn-mute.muted{background:var(--c-accent,#e87722);color:#fff;border-color:var(--c-accent,#e87722);}
        .rtc-lbl{font-size:10px;color:var(--c-text-3,#8fa3be);margin-top:6px;}`;
    document.head.appendChild(s);
}

// ── Render modal ───────────────────────────────────────────────────────────────
function _showUI(state) {
    _ensureStyle();
    document.getElementById('rtc-overlay')?.remove();

    const incoming = state === 'incoming';
    const active   = state === 'active';

    const ov = document.createElement('div');
    ov.id = 'rtc-overlay';
    ov.innerHTML = `
        <div class="rtc-modal">
            <div class="rtc-av">
                ${_peerAvatar ? `<img src="${_esc(_peerAvatar)}">` : _ini(_peerName)}
            </div>
            <div class="rtc-name">${_esc(_peerName)}</div>
            <div class="rtc-sub" id="rtc-sub">
                ${incoming ? 'Incoming call…' : active ? '' : 'Calling…'}
            </div>
            <div class="rtc-timer" id="rtc-timer" ${active ? 'style="display:block"' : ''}>0:00</div>

            ${incoming ? `
            <div class="rtc-btns">
                <div style="text-align:center">
                    <button class="rtc-btn rtc-btn-end" onclick="rtcDeclineCall()">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.69 12"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                    </button>
                    <div class="rtc-lbl">Decline</div>
                </div>
                <div style="text-align:center">
                    <button class="rtc-btn rtc-btn-accept" onclick="rtcAnswerCall()">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9A16 16 0 0 0 15 16.09l1.15-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                    </button>
                    <div class="rtc-lbl">Answer</div>
                </div>
            </div>` : `
            <div class="rtc-btns">
                <div style="text-align:center">
                    <button class="rtc-btn rtc-btn-mute" id="rtc-mute-btn" onclick="rtcToggleMute()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" y1="19" x2="12" y2="23"/>
                            <line x1="8" y1="23" x2="16" y2="23"/>
                        </svg>
                    </button>
                    <div class="rtc-lbl" id="rtc-mute-lbl">Mute</div>
                </div>
                <div style="text-align:center">
                    <button class="rtc-btn rtc-btn-end" onclick="rtcHangup()">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.69 12"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                    </button>
                    <div class="rtc-lbl">End</div>
                </div>
            </div>`}
        </div>`;
    document.body.appendChild(ov);
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function _startTimer() {
    _secs = 0;
    _timer = setInterval(() => {
        _secs++;
        const el = document.getElementById('rtc-timer');
        if (el) {
            const m = Math.floor(_secs / 60), s = _secs % 60;
            el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

// ── Full cleanup ───────────────────────────────────────────────────────────────
function _cleanup() {
    clearInterval(_timer); _timer = null; _secs = 0; _muted = false;
    if (_localSt)  { _localSt.getTracks().forEach(t => t.stop()); _localSt = null; }
    if (_peer)     { _peer.close(); _peer = null; }
    if (_callCh)   { sb.removeChannel(_callCh); _callCh = null; }
    _callState    = 'idle';
    _callConvId   = null;
    _pendingOffer = null;
    document.getElementById('rtc-overlay')?.remove();
    document.getElementById('rtc-remote-audio')?.remove();
}

// ── Create RTCPeerConnection ────────────────────────────────────────────────────
function _makePeer() {
    const pc = new RTCPeerConnection(ICE);

    // Send ICE candidates to the other side via Supabase Broadcast
    pc.onicecandidate = e => {
        if (e.candidate && _callCh) {
            _callCh.send({ type: 'broadcast', event: 'rtc-ice', payload: {
                from: currentUser.id, c: e.candidate.toJSON()
            }});
        }
    };

    // Play remote audio when it arrives
    pc.ontrack = e => {
        let audio = document.getElementById('rtc-remote-audio');
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = 'rtc-remote-audio';
            audio.autoplay = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = e.streams[0];
    };

    // Auto-cleanup on disconnect
    pc.onconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
            _cleanup();
            _toast('Call ended', 'info');
        }
    };

    return pc;
}

// ── Subscribe to THIS call's signaling channel ─────────────────────────────────
// (offer/answer/ICE/hangup for the active conversation)
function _subCallChannel(convId) {
    if (_callCh) sb.removeChannel(_callCh);
    _callCh = sb.channel('rtc-call:' + convId, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'rtc-answer' }, async ({ payload }) => {
            if (!_peer || _callState !== 'calling') return;
            await _peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
            _callState = 'active';
            const sub = document.getElementById('rtc-sub');
            const tmr = document.getElementById('rtc-timer');
            if (sub) sub.textContent = '';
            if (tmr) tmr.style.display = 'block';
            _startTimer();
        })
        .on('broadcast', { event: 'rtc-ice' }, async ({ payload }) => {
            if (!_peer || payload.from === currentUser.id) return;
            try { await _peer.addIceCandidate(payload.c); } catch (_) {}
        })
        .on('broadcast', { event: 'rtc-hangup' }, ({ payload }) => {
            if (payload.from === currentUser.id) return;
            _cleanup();
            _toast('Call ended', 'info');
        })
        .on('broadcast', { event: 'rtc-decline' }, ({ payload }) => {
            if (payload.from === currentUser.id) return;
            _cleanup();
            _toast('Call declined', 'info');
        })
        .subscribe();
}

// ── Subscribe to THIS USER's personal ring notification channel ────────────────
// Runs on every page so you get incoming calls wherever you are in the portal
function _startNotifyListener() {
    if (_notifyCh) sb.removeChannel(_notifyCh);
    _notifyCh = sb.channel('rtc-notify:' + currentUser.id, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'rtc-ring' }, ({ payload }) => {
            if (_callState !== 'idle') {
                // Auto-decline if already in a call
                sb.channel('rtc-call:' + payload.convId).send({
                    type: 'broadcast', event: 'rtc-decline',
                    payload: { from: currentUser.id }
                });
                return;
            }
            _callState    = 'incoming';
            _callConvId   = payload.convId;
            _peerName     = payload.callerName  || 'Unknown';
            _peerAvatar   = payload.callerAvatar || null;
            _pendingOffer = payload.sdp;
            _subCallChannel(payload.convId); // listen for hangup/ICE on this conv
            _showUI('incoming');
        })
        .subscribe();
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Called by: chat.html call button, popup call button
window.initiateCall = async function (convId) {
    const cid = convId || activeConvId;
    if (!cid || !currentUser || !sb) return;
    if (_callState !== 'idle') { _toast('Already in a call.', 'error'); return; }

    // Get all participants except self
    const { data: parts, error } = await sb
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', cid)
        .neq('user_id', currentUser.id)
        .limit(10);

    if (error || !parts?.length) { _toast('Could not find call recipient.', 'error'); return; }
    if (parts.length > 1) { _toast('Group calls coming soon — use DMs for now.', 'info'); return; }

    const calleeId = parts[0].user_id;

    // Resolve callee name — check in-memory allProfiles first, then DB
    let callee = (window.allProfiles || []).find(p => p.id === calleeId);
    if (!callee) {
        const { data } = await sb.from('profiles').select('full_name,avatar_url').eq('id', calleeId).single();
        callee = data;
    }
    _peerName   = callee?.full_name   || 'Unknown';
    _peerAvatar = callee?.avatar_url  || null;
    _callState  = 'calling';
    _callConvId = cid;

    _subCallChannel(cid); // subscribe BEFORE sending offer so we catch the answer
    _showUI('calling');

    try {
        _localSt = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        _peer    = _makePeer();
        _localSt.getTracks().forEach(t => _peer.addTrack(t, _localSt));

        const offer = await _peer.createOffer();
        await _peer.setLocalDescription(offer);

        // Wait for full ICE gathering (max 4s) so the SDP includes all candidates.
        // This means the callee gets a complete SDP in one shot — no trickle needed.
        await new Promise(resolve => {
            if (_peer.iceGatheringState === 'complete') { resolve(); return; }
            _peer.onicegatheringstatechange = () => {
                if (_peer?.iceGatheringState === 'complete') resolve();
            };
            setTimeout(resolve, 4000); // fallback timeout
        });

        // Ring the callee via their personal notification channel
        const myName   = currentProfile?.full_name || currentUser.user_metadata?.full_name || 'Unknown';
        const myAvatar = currentProfile?.avatar_url || null;

        sb.channel('rtc-notify:' + calleeId).send({
            type: 'broadcast', event: 'rtc-ring', payload: {
                convId:       cid,
                callerName:   myName,
                callerAvatar: myAvatar,
                sdp:          _peer.localDescription.sdp
            }
        });

        const sub = document.getElementById('rtc-sub');
        if (sub) sub.textContent = 'Ringing…';

    } catch (err) {
        _cleanup();
        const msg = err.name === 'NotAllowedError'
            ? 'Microphone access denied. Please allow it in your browser and try again.'
            : 'Could not start call: ' + err.message;
        _toast(msg, 'error');
    }
};

window.rtcAnswerCall = async function () {
    if (_callState !== 'incoming' || !_pendingOffer) return;
    _callState = 'active';
    _showUI('active');
    try {
        _localSt = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        _peer    = _makePeer();
        _localSt.getTracks().forEach(t => _peer.addTrack(t, _localSt));

        await _peer.setRemoteDescription({ type: 'offer', sdp: _pendingOffer });
        const answer = await _peer.createAnswer();
        await _peer.setLocalDescription(answer);

        _callCh.send({ type: 'broadcast', event: 'rtc-answer', payload: {
            from: currentUser.id, sdp: answer.sdp
        }});

        const tmr = document.getElementById('rtc-timer');
        if (tmr) tmr.style.display = 'block';
        _startTimer();

    } catch (err) {
        _cleanup();
        _toast('Could not answer call: ' + err.message, 'error');
    }
};

window.rtcDeclineCall = function () {
    if (_callCh) _callCh.send({ type: 'broadcast', event: 'rtc-decline', payload: { from: currentUser.id } });
    _cleanup();
};

window.rtcHangup = function () {
    if (_callCh) _callCh.send({ type: 'broadcast', event: 'rtc-hangup', payload: { from: currentUser.id } });
    _cleanup();
};

window.rtcToggleMute = function () {
    _muted = !_muted;
    if (_localSt) _localSt.getAudioTracks().forEach(t => { t.enabled = !_muted; });
    const btn = document.getElementById('rtc-mute-btn');
    const lbl = document.getElementById('rtc-mute-lbl');
    if (btn) btn.classList.toggle('muted', _muted);
    if (lbl) lbl.textContent = _muted ? 'Unmute' : 'Mute';
};

// Keep old chat.html stub names working (they'll now call the real thing)
window.answerCall     = window.rtcAnswerCall;
window.toggleMute     = window.rtcToggleMute;
window.closeCallModal = window.rtcHangup;

// ── Boot: wait for Supabase auth, then start listening for incoming calls ──────
window._rtcLoaded = true;
    function _boot() {
    if (currentUser && sb) {
        _startNotifyListener();
        return;
    }
    setTimeout(_boot, 300);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
else _boot();

})();
