/* ============================
   MindOS Landing Page — main.js
   ============================ */

/* --- State & Init --- */
const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
const systemLang = (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
const state = { theme: localStorage.getItem('mindos-theme') || systemTheme, lang: localStorage.getItem('mindos-lang') || systemLang, loopStarted: false };
const applyTheme = (t) => { document.body.classList.toggle('light', t === 'light'); localStorage.setItem('mindos-theme', t); };
const applyLang = (l) => { document.documentElement.lang = l; localStorage.setItem('mindos-lang', l); };
applyTheme(state.theme); applyLang(state.lang);
// Remove early-light AFTER body.light is applied — FOUC prevention cleanup
if (document.documentElement.classList.contains('early-light')) {
    requestAnimationFrame(() => { requestAnimationFrame(() => { document.documentElement.classList.remove('early-light'); }); });
}

/* --- Compare Tabs --- */
document.querySelectorAll('.compare-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.compare-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.compare-stage').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        const stage = document.querySelector(`.compare-stage[data-stage="${tab.dataset.scene}"]`);
        if (stage) stage.classList.add('active');
    });
});

/* --- Theme & Lang Toggle --- */
document.getElementById('theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(state.theme); });
document.getElementById('lang-toggle').addEventListener('click', () => { state.lang = state.lang === 'zh' ? 'en' : 'zh'; applyLang(state.lang); });

/* --- Quickstart: Install Method Tabs --- */
window.switchQsTab = function(tabId) {
    document.querySelectorAll('.qs-tab').forEach(t => t.classList.remove('qs-tab--active'));
    document.querySelectorAll('.qs-tab-content').forEach(c => c.classList.remove('qs-tab-content--active'));
    document.querySelector(`.qs-tab[data-tab="${tabId}"]`)?.classList.add('qs-tab--active');
    document.getElementById(`qs-${tabId}`)?.classList.add('qs-tab-content--active');
};

/* --- Platform Detection & Highlight --- */
function detectPlatformAndHighlight() {
    const ua = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();
    
    // Detect OS
    let os = '';
    if (ua.indexOf('win') !== -1 || platform.indexOf('win') !== -1) {
        os = 'windows';
    } else if (ua.indexOf('mac') !== -1 || platform.indexOf('mac') !== -1) {
        os = 'macos';
    } else if (ua.indexOf('linux') !== -1 || platform.indexOf('linux') !== -1) {
        os = 'linux';
    }
    
    // Handle architecture detection
    if (os === 'macos') {
        detectMacArch().then(isARM => {
            const targetCardId = isARM ? 'macos-silicon-card' : 'macos-intel-card';
            highlightCard(targetCardId);
        });
    } else if (os === 'windows') {
        highlightCard('windows-card');
    } else if (os === 'linux') {
        highlightCard('linux-card');
    }
}

// Helper: Async Apple Silicon detection
function detectMacArch() {
    return new Promise((resolve) => {
        // Method 1: Try high entropy values API (Chrome/Edge)
        if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
            navigator.userAgentData.getHighEntropyValues(['architecture']).then(data => {
                resolve(data.architecture === 'arm' || data.architecture === 'arm64');
            }).catch(() => {
                resolve(fallbackMacArchDetect());
            });
        } else {
            resolve(fallbackMacArchDetect());
        }
    });
}

// Fallback: Use less reliable methods
function fallbackMacArchDetect() {
    const ua = navigator.userAgent.toLowerCase();
    // Check for explicit ARM markers
    if (ua.indexOf('arm') !== -1 || ua.indexOf('aarch64') !== -1) return true;
    // Apple Silicon Macs typically don't have Intel/x64 in UA for recent browsers
    if (ua.indexOf('intel') !== -1 || ua.indexOf('x86_64') !== -1) return false;
    // Default: prefer ARM (Apple Silicon) as it's more common now
    return true;
}

function highlightCard(cardId) {
    if (!cardId) return;
    const card = document.getElementById(cardId);
    if (card) {
        card.classList.add('active');
    }
}

// Run platform detection on page load
detectPlatformAndHighlight();

/* --- Quickstart: Agent Copy Button --- */
const agentCopyBtn = document.getElementById('copy-agent-btn');
const agentCopyBtnLabel = '<span data-zh>复制</span><span data-en>Copy</span>';
agentCopyBtn?.addEventListener('click', (e) => {
    const zhText = '帮我从 https://github.com/GeminiLight/MindOS 安装 MindOS，包含 MCP 和 Skills，使用中文模板。';
    const enText = 'Help me install MindOS from https://github.com/GeminiLight/MindOS with MCP and Skills. Use English template.';
    navigator.clipboard.writeText(state.lang === 'zh' ? zhText : enText);
    e.currentTarget.textContent = state.lang === 'zh' ? '已复制' : 'Copied!';
    setTimeout(() => {
        e.currentTarget.innerHTML = agentCopyBtnLabel;
    }, 2000);
});

/* --- Quickstart: CLI Copy Button --- */
const cliCopyBtn = document.getElementById('copy-cli-btn');
const cliCopyBtnLabel = '<span data-zh>复制</span><span data-en>Copy</span>';
cliCopyBtn?.addEventListener('click', (e) => {
    const text = document.getElementById('cli-install-text')?.textContent.trim() || '';
    navigator.clipboard.writeText(text);
    e.currentTarget.textContent = state.lang === 'zh' ? '已复制' : 'Copied!';
    setTimeout(() => {
        e.currentTarget.innerHTML = cliCopyBtnLabel;
    }, 2000);
});

/* --- Try-it Card Copy Buttons --- */
document.querySelectorAll('.qs-try-card').forEach(card => {
    const copyBtn = card.querySelector('.qs-try-copy');
    if (!copyBtn) return;
    const handler = (e) => {
        e.stopPropagation();
        const text = state.lang === 'zh' ? card.dataset.copyZh : card.dataset.copyEn;
        navigator.clipboard.writeText(text);
        copyBtn.textContent = state.lang === 'zh' ? '已复制' : 'Copied!';
        setTimeout(() => { copyBtn.innerHTML = '<span data-zh>复制</span><span data-en>Copy</span>'; }, 2000);
    };
    copyBtn.addEventListener('click', handler);
    card.addEventListener('click', handler);
});

/* ============================
   Shared Mind Loop Animation
   ============================ */
const runMindLoop = async () => {
    if(state.loopStarted) return; state.loopStarted = true;
    const files = ['mf-1','mf-2','mf-3','mf-4','mf-5'];
    const agents = ['as-1','as-2','as-3','as-4','as-5'];
    const statusEls = agents.map(id => document.getElementById(id + '-status'));
    const barEls = agents.map(id => document.getElementById(id + '-bar'));
    const bridgeCenter = document.querySelector('.bridge-center');
    const protocolDot = document.querySelector('.bridge-protocol-dot');
    const bridgeStatusZh = document.getElementById('bridge-status');
    const bridgeStatusEn = document.getElementById('bridge-status-en');

    const wait = ms => new Promise(r => setTimeout(r, ms));

    // Utility: reset all states
    const resetAll = () => {
        files.forEach(id => {
            const el = document.getElementById(id);
            el.classList.remove('mind-file--syncing', 'mind-file--editing');
        });
        agents.forEach((id, i) => {
            const el = document.getElementById(id);
            el.classList.remove('agent-slot--active', 'agent-slot--done');
            statusEls[i].classList.remove('agent-slot-status--running', 'agent-slot-status--done');
            if (barEls[i]) { barEls[i].style.transition = 'none'; barEls[i].style.width = '0'; }
        });
        bridgeCenter.classList.remove('bridge-active');
        protocolDot.classList.remove('bridge-protocol-dot--active');
    };

    // Utility: run a sync round
    const runRound = async (editFileIdx, syncFileIndices, agentConfigs) => {
        // Step 1: Human edits a file (blink effect)
        const editEl = document.getElementById(files[editFileIdx]);
        editEl.classList.add('mind-file--editing');
        if (bridgeStatusZh) bridgeStatusZh.textContent = '检测到变更...';
        if (bridgeStatusEn) bridgeStatusEn.textContent = 'Change detected...';
        await wait(800);
        editEl.classList.remove('mind-file--editing');

        // Step 2: Sync files light up
        for (const idx of syncFileIndices) {
            await wait(200);
            document.getElementById(files[idx]).classList.add('mind-file--syncing');
        }

        // Step 3: Bridge activates
        await wait(350);
        bridgeCenter.classList.add('bridge-active');
        protocolDot.classList.add('bridge-protocol-dot--active');
        if (bridgeStatusZh) bridgeStatusZh.textContent = '同步中...';
        if (bridgeStatusEn) bridgeStatusEn.textContent = 'Syncing...';

        // Step 4: Agents execute in parallel
        await wait(250);
        const completions = [];
        agentConfigs.forEach(({ idx, duration, stagger }) => {
            const p = new Promise(resolve => {
                setTimeout(() => {
                    const el = document.getElementById(agents[idx]);
                    el.classList.remove('agent-slot--done');
                    statusEls[idx].classList.remove('agent-slot-status--done');
                    el.classList.add('agent-slot--active');
                    statusEls[idx].classList.add('agent-slot-status--running');
                    const bar = barEls[idx];
                    if (bar) {
                        bar.style.transition = 'none'; bar.style.width = '0';
                        requestAnimationFrame(() => {
                            bar.style.transition = 'width ' + duration + 'ms cubic-bezier(0.4, 0, 0.2, 1)';
                            requestAnimationFrame(() => { bar.style.width = '100%'; });
                        });
                    }
                    setTimeout(() => {
                        statusEls[idx].classList.remove('agent-slot-status--running');
                        statusEls[idx].classList.add('agent-slot-status--done');
                        el.classList.add('agent-slot--done');
                        resolve();
                    }, duration);
                }, stagger);
            });
            completions.push(p);
        });

        await Promise.all(completions);
        await wait(200);
        if (bridgeStatusZh) bridgeStatusZh.textContent = '心智已同步';
        if (bridgeStatusEn) bridgeStatusEn.textContent = 'Mind synced';
    };

    // === ROUND 1: Initial full sync — user has SOP, all agents launch ===
    for (let i = 0; i < files.length; i++) {
        await wait(300);
        document.getElementById(files[i]).classList.add('mind-file--syncing');
    }
    await wait(350);
    bridgeCenter.classList.add('bridge-active');
    protocolDot.classList.add('bridge-protocol-dot--active');
    if (bridgeStatusZh) bridgeStatusZh.textContent = '同步中...';
    if (bridgeStatusEn) bridgeStatusEn.textContent = 'Syncing...';
    await wait(250);

    // All 5 agents start in parallel
    const r1Durations = [2600, 2000, 3200, 2400, 1600];
    const r1Stagger = [0, 100, 50, 150, 80];
    const r1Completions = [];
    agents.forEach((id, i) => {
        const p = new Promise(resolve => {
            setTimeout(() => {
                const el = document.getElementById(id);
                el.classList.add('agent-slot--active');
                statusEls[i].classList.add('agent-slot-status--running');
                const bar = barEls[i];
                if (bar) {
                    bar.style.transition = 'width ' + r1Durations[i] + 'ms cubic-bezier(0.4, 0, 0.2, 1)';
                    requestAnimationFrame(() => { bar.style.width = '100%'; });
                }
                setTimeout(() => {
                    statusEls[i].classList.remove('agent-slot-status--running');
                    statusEls[i].classList.add('agent-slot-status--done');
                    el.classList.add('agent-slot--done');
                    resolve();
                }, r1Durations[i]);
            }, r1Stagger[i]);
        });
        r1Completions.push(p);
    });
    await Promise.all(r1Completions);
    await wait(200);
    if (bridgeStatusZh) bridgeStatusZh.textContent = '心智已同步';
    if (bridgeStatusEn) bridgeStatusEn.textContent = 'Mind synced';

    // === Continuous loop starts ===
    const rounds = [
        // Round 2: User updates Profile → Cursor & Claude Code re-run
        { edit: 1, sync: [1, 3], agents: [
            { idx: 0, duration: 2200, stagger: 0 },
            { idx: 1, duration: 1800, stagger: 80 },
        ]},
        // Round 3: User adds a new Idea → Codex, Gemini, OpenClaw pick it up
        { edit: 2, sync: [2, 0, 4], agents: [
            { idx: 2, duration: 2600, stagger: 0 },
            { idx: 3, duration: 2000, stagger: 60 },
            { idx: 4, duration: 1500, stagger: 120 },
        ]},
        // Round 4: User edits Agent-Rules → all agents re-calibrate
        { edit: 3, sync: [3, 0, 1, 2, 4], agents: [
            { idx: 0, duration: 1800, stagger: 0 },
            { idx: 1, duration: 2400, stagger: 50 },
            { idx: 2, duration: 2000, stagger: 100 },
            { idx: 3, duration: 1600, stagger: 70 },
            { idx: 4, duration: 2200, stagger: 30 },
        ]},
        // Round 5: User updates Products.csv → Gemini re-researches
        { edit: 4, sync: [4, 2], agents: [
            { idx: 3, duration: 2800, stagger: 0 },
            { idx: 0, duration: 1400, stagger: 100 },
        ]},
    ];

    let roundIdx = 0;
    while (true) {
        await wait(2500);
        files.forEach(id => document.getElementById(id).classList.remove('mind-file--syncing'));
        bridgeCenter.classList.remove('bridge-active');
        protocolDot.classList.remove('bridge-protocol-dot--active');
        await wait(1500);

        const round = rounds[roundIdx % rounds.length];
        round.agents.forEach(({ idx }) => {
            const el = document.getElementById(agents[idx]);
            el.classList.remove('agent-slot--active', 'agent-slot--done');
            statusEls[idx].classList.remove('agent-slot-status--running', 'agent-slot-status--done');
            const bar = barEls[idx];
            if (bar) { bar.style.transition = 'none'; bar.style.width = '0'; }
        });

        await runRound(round.edit, round.sync, round.agents);
        roundIdx++;
    }
};

/* --- Intersection Observer --- */
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            if(entry.target.closest && entry.target.closest('#workflow')) { setTimeout(runMindLoop, 800); }
            if(entry.target.id === 'workflow') { setTimeout(runMindLoop, 800); }
        }
    });
}, { threshold: 0.2 });
document.querySelectorAll('.animate-up, .loop-section').forEach(el => observer.observe(el));

/* ============================
   Demo Flow: SVG Arrow Drawing
   ============================ */
function drawDfArrows() {
    const canvas = document.querySelector('.df-canvas');
    const svg = document.getElementById('df-arrows-svg');
    if (!canvas || !svg) return;

    const cr = canvas.getBoundingClientRect();
    function rel(el) {
        const r = el.getBoundingClientRect();
        return {
            left: r.left - cr.left, right: r.right - cr.left,
            top: r.top - cr.top, bottom: r.bottom - cr.top,
            cx: (r.left + r.right) / 2 - cr.left,
            cy: (r.top + r.bottom) / 2 - cr.top,
        };
    }

    const mobile = rel(document.querySelector('.df-mobile'));
    const desktop = rel(document.querySelector('.df-desktop'));
    const agentGroup = rel(document.querySelector('.df-agent-group'));
    const feedback = rel(document.getElementById('df-feedback'));
    const gap1 = rel(document.getElementById('df-gap1'));
    const gap2 = rel(document.getElementById('df-gap2'));

    svg.setAttribute('width', cr.width);
    svg.setAttribute('height', cr.height);
    svg.setAttribute('viewBox', `0 0 ${cr.width} ${cr.height}`);

    const cs = getComputedStyle(document.body);
    const accent = cs.getPropertyValue('--accent').trim() || '#d4954a';
    const info = '#7a9ec4';
    const isZh = document.documentElement.lang === 'zh';

    // Arrow 1: Mobile -> Desktop (Sync / 同步)
    const a1y = mobile.cy;
    const a1x1 = mobile.right + 2;
    const a1x2 = desktop.left - 2;
    const a1mx = gap1.cx;
    const a1label = isZh ? '同步' : 'Sync';

    // Arrow 2: Desktop -> Agent Group (MCP Read / MCP 读取)
    const a2y = agentGroup.cy;
    const a2x1 = desktop.right + 2;
    const a2x2 = agentGroup.left - 2;
    const a2mx = gap2.cx;
    const a2label = isZh ? 'MCP 读取' : 'MCP Read';

    // Arrow 3: Feedback loop - OpenClaw -> under -> Desktop (U-shape)
    const a3sx = feedback.cx;
    const a3sy = feedback.bottom + 2;
    const a3ex = desktop.cx;
    const a3ey = desktop.bottom + 2;
    const a3by = Math.max(feedback.bottom, desktop.bottom) + 36;
    const r = 10;
    const a3labelX = a3sx - (a3sx - a3ex) * 0.25;
    const a3label = isZh ? '经验回流' : 'Feedback';
    const a3lw = isZh ? 72 : 64;

    svg.innerHTML = `
        <defs>
            <marker id="df-ah-a" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <path d="M0,0.5 L7,3 L0,5.5" fill="none" stroke="${accent}" stroke-width="1.2"/>
            </marker>
            <marker id="df-ah-i" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <path d="M0,0.5 L7,3 L0,5.5" fill="none" stroke="${info}" stroke-width="1.2"/>
            </marker>
        </defs>

        <!-- Arrow 1: Sync -->
        <line x1="${a1x1}" y1="${a1y}" x2="${a1mx - 32}" y2="${a1y}"
              stroke="${accent}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.6"/>
        <line x1="${a1mx + 32}" y1="${a1y}" x2="${a1x2}" y2="${a1y}"
              stroke="${accent}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.6"
              marker-end="url(#df-ah-a)"/>
        <rect x="${a1mx - 28}" y="${a1y - 11}" width="56" height="20" rx="10"
              fill="var(--bg)" stroke="${accent}" stroke-width="0.7" opacity="0.85"/>
        <text x="${a1mx}" y="${a1y + 3.5}" text-anchor="middle" fill="${accent}"
              font-size="10" font-weight="500" font-family="'IBM Plex Mono',monospace">${a1label}</text>

        <!-- Arrow 2: MCP Read -->
        <line x1="${a2x1}" y1="${a2y}" x2="${a2mx - 38}" y2="${a2y}"
              stroke="${info}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.6"/>
        <line x1="${a2mx + 38}" y1="${a2y}" x2="${a2x2}" y2="${a2y}"
              stroke="${info}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.6"
              marker-end="url(#df-ah-i)"/>
        <rect x="${a2mx - 34}" y="${a2y - 11}" width="68" height="20" rx="10"
              fill="var(--bg)" stroke="${info}" stroke-width="0.7" opacity="0.85"/>
        <text x="${a2mx}" y="${a2y + 3.5}" text-anchor="middle" fill="${info}"
              font-size="10" font-weight="500" font-family="'IBM Plex Mono',monospace">${a2label}</text>

        <!-- Arrow 3: Feedback U-shape -->
        <path d="M ${a3sx} ${a3sy}
                 L ${a3sx} ${a3by - r}
                 Q ${a3sx} ${a3by} ${a3sx - r} ${a3by}
                 L ${a3labelX + a3lw/2 + 4} ${a3by}"
              fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.6"/>
        <path d="M ${a3labelX - a3lw/2 - 4} ${a3by}
                 L ${a3ex + r} ${a3by}
                 Q ${a3ex} ${a3by} ${a3ex} ${a3by - r}
                 L ${a3ex} ${a3ey}"
              fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.6"
              marker-end="url(#df-ah-a)"/>
        <rect x="${a3labelX - a3lw/2}" y="${a3by - 11}" width="${a3lw}" height="20" rx="10"
              fill="var(--bg)" stroke="${accent}" stroke-width="0.7" opacity="0.85"/>
        <text x="${a3labelX}" y="${a3by + 3.5}" text-anchor="middle" fill="${accent}"
              font-size="10" font-weight="500" font-family="'IBM Plex Mono',monospace">${a3label}</text>
    `;
}

drawDfArrows();
window.addEventListener('resize', drawDfArrows);

// Copy security command for macOS first launch
function copySecurityCommand(element) {
    const cmd = element.querySelector('.qs-security-cmd').textContent;
    navigator.clipboard.writeText(cmd).then(() => {
        element.classList.add('copied');
        setTimeout(() => element.classList.remove('copied'), 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = cmd;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            element.classList.add('copied');
            setTimeout(() => element.classList.remove('copied'), 2000);
        } catch (e) {
            console.error('Copy failed', e);
        }
        document.body.removeChild(textarea);
    });
}

/* --- Toggle macOS Security Notice --- */
function toggleMacSec(event) {
    if (event) event.stopPropagation();
    const notice = document.getElementById('macos-security');
    if (notice) {
        notice.classList.toggle('show');
    }
}

/* --- Download Geo-Routing ---
   China users → Alibaba Cloud OSS (native domain)
   Others     → Cloudflare R2    (native .r2.dev domain)
   Fallback   → GitHub Releases

   After creating your buckets, replace the two URLs below:
     DL_INTL → R2 public URL from: Dashboard → R2 → mindos-releases → Settings → Public access
     DL_CN   → OSS endpoint from: Console → Bucket → Overview → "外网访问"
*/
(function initDownloadRouting() {
    var DL_INTL = 'https://pub-a5b6991b1e3c4068b1ec9a4106f4d116.r2.dev/desktop/latest/';
    var DL_CN   = 'https://mindos-cn-releases.oss-cn-hangzhou.aliyuncs.com/desktop/latest/';
    var DL_GH   = 'https://github.com/GeminiLight/MindOS/releases/latest';

    function applyMirror(base) {
        document.querySelectorAll('[data-dl-file]').forEach(function(el) {
            el.href = base + el.getAttribute('data-dl-file');
        });
    }

    var isCN = (navigator.language || '').match(/^zh/i)
            || Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Shanghai';

    if (isCN) {
        applyMirror(DL_CN);
    } else {
        applyMirror(DL_INTL);
    }

    // Verify the chosen mirror is reachable; fall back to GitHub if not
    var testLink = document.querySelector('[data-dl-file]');
    if (testLink) {
        fetch(testLink.href, { method: 'HEAD', mode: 'no-cors' }).catch(function() {
            document.querySelectorAll('[data-dl-file]').forEach(function(el) {
                el.href = DL_GH;
            });
        });
    }
})();
