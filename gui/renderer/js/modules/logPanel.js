// js/modules/logPanel.js — Render, filter, dan update log lines di console panel

import { LOG_ICONS, EMOJI_MAP }       from './constants.js';
import { getState, setState, resetLogStats } from './state.js';
import { escHtml, classifyLine }      from './utils.js';

// ─── Enrich: ganti emoji dengan inline SVG icon ───────────────────────────────
function enrichLogMessage(message) {
    let escaped = escHtml(message);
    const keys  = Object.keys(EMOJI_MAP).sort((a, b) => b.length - a.length);
    const regex = new RegExp(keys.join('|'), 'g');
    return escaped.replace(regex, match => EMOJI_MAP[match] || match);
}

// ─── Update stats bar UI ──────────────────────────────────────────────────────
export function updateLogStatsUI() {
    const stats = getState('logStats');
    const el = id => document.getElementById(id);
    if (el('log-stat-info'))    el('log-stat-info').textContent    = stats.info;
    if (el('log-stat-success')) el('log-stat-success').textContent = stats.success;
    if (el('log-stat-warn'))    el('log-stat-warn').textContent    = stats.warn;
    if (el('log-stat-error'))   el('log-stat-error').textContent   = stats.error;
}

// ─── Apply filters & search ke semua log-line ─────────────────────────────────
export function applyLogFiltersAndSearch() {
    const logLines   = getState('logLines');
    const filter     = getState('currentLogFilter');
    const query      = getState('logSearchQuery');
    const domLines   = document.querySelectorAll('.log-line');

    let visibleCount = 0;
    domLines.forEach((el, i) => {
        const item = logLines[i];
        if (!item) return;
        const categoryMatch = filter === 'all' || item.type === filter ||
            (filter === 'ERROR' && item.type === 'STDERR');
        const queryMatch    = !query || item.line.toLowerCase().includes(query.toLowerCase());
        const visible       = categoryMatch && queryMatch;
        el.classList.toggle('hidden', !visible);
        
        if (visible) {
            visibleCount++;
            const msgEl = el.querySelector('.log-msg');
            if (msgEl) {
                if (query) {
                    try {
                        const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                        const safeRegex = new RegExp(`(${escapedQuery})(?![^<>]*>)`, 'gi');
                        let html = enrichLogMessage(item.message);
                        html = html.replace(safeRegex, '<mark class="log-search-match">$1</mark>');
                        msgEl.innerHTML = html;
                    } catch (e) {
                        msgEl.innerHTML = enrichLogMessage(item.message);
                    }
                } else {
                    msgEl.innerHTML = enrichLogMessage(item.message);
                }
            }
        }
    });

    const logEmpty = document.getElementById('log-empty');
    const logEmptyTitle = document.getElementById('log-empty-title');
    const logEmptySub = document.getElementById('log-empty-sub');
    
    if (logEmpty) {
        if (visibleCount === 0) {
            logEmpty.classList.remove('hidden');
            if (logLines.length === 0) {
                if (logEmptyTitle) logEmptyTitle.textContent = 'Console logs are empty';
                if (logEmptySub) logEmptySub.textContent = 'Start the bot to see execution outputs here.';
            } else {
                if (logEmptyTitle) logEmptyTitle.textContent = 'No matching logs found';
                if (logEmptySub) logEmptySub.textContent = `No logs match your current search "${query}" or filter.`;
            }
        } else {
            logEmpty.classList.add('hidden');
        }
    }
}

// ─── Append sebuah log line ke UI ────────────────────────────────────────────
export function renderLogLine(line, typeHint) {
    const type = typeHint || classifyLine(line);
    const match = line.match(/^\[([\d-:\s]+)\]\s*(\S+)?\s*(.*)$/);
    const message = match ? match[3] : line;

    const logLines = getState('logLines');
    logLines.push({ line, type, message });
    setState('logLines', logLines);
    setState('logLineCount', getState('logLineCount') + 1);

    // Update counter badge
    const llc = document.getElementById('log-line-count');
    if (llc) {
        const last = llc.childNodes[llc.childNodes.length - 1];
        if (last) last.textContent = ` ${getState('logLineCount')} lines`;
    }

    // Buat elemen log
    const el = document.createElement('div');
    el.className = `log-line ${type}`;

    if (match) {
        const timestamp = match[1];
        const timePart  = timestamp.includes(' ') ? timestamp.split(' ')[1] : timestamp;

        const timeSpan = document.createElement('span');
        timeSpan.className   = 'log-time';
        timeSpan.textContent = timePart;

        const iconSpan = document.createElement('span');
        iconSpan.className   = 'log-icon-wrap';
        iconSpan.innerHTML   = LOG_ICONS[type] || '';

        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-msg';
        msgSpan.innerHTML = enrichLogMessage(message);

        el.append(timeSpan, iconSpan, msgSpan);
    } else {
        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-msg';
        msgSpan.innerHTML = enrichLogMessage(line);
        el.appendChild(msgSpan);
    }

    // Update stats counters
    const stats = getState('logStats');
    if      (type === 'SUCCESS')              stats.success++;
    else if (type === 'WARN')                 stats.warn++;
    else if (type === 'ERROR' || type === 'STDERR') stats.error++;
    else                                       stats.info++;
    setState('logStats', stats);
    updateLogStatsUI();

    // Real-time filter & highlight for single line
    const filter = getState('currentLogFilter');
    const query  = getState('logSearchQuery');
    const catMatch   = filter === 'all' || type === filter || (filter === 'ERROR' && type === 'STDERR');
    const queryMatch = !query || line.toLowerCase().includes(query.toLowerCase());
    const visible    = catMatch && queryMatch;
    el.classList.toggle('hidden', !visible);

    if (visible) {
        const logEmpty = document.getElementById('log-empty');
        if (logEmpty) logEmpty.classList.add('hidden');

        if (query) {
            const msgEl = el.querySelector('.log-msg');
            if (msgEl) {
                try {
                    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    const safeRegex = new RegExp(`(${escapedQuery})(?![^<>]*>)`, 'gi');
                    let html = enrichLogMessage(message);
                    html = html.replace(safeRegex, '<mark class="log-search-match">$1</mark>');
                    msgEl.innerHTML = html;
                } catch (e) {
                    // fallback
                }
            }
        }
    }

    document.getElementById('log-lines').appendChild(el);

    if (getState('autoScroll')) {
        const panel = document.getElementById('log-panel');
        panel.scrollTop = panel.scrollHeight;
    }
}

// ─── Clear semua log ─────────────────────────────────────────────────────────
export function clearLog() {
    document.getElementById('log-lines').innerHTML = '';
    setState('logLines',     []);
    setState('logLineCount', 0);
    resetLogStats();
    updateLogStatsUI();
    const llc = document.getElementById('log-line-count');
    if (llc) {
        const last = llc.childNodes[llc.childNodes.length - 1];
        if (last) last.textContent = ' 0 lines';
    }
    const logEmpty = document.getElementById('log-empty');
    if (logEmpty) {
        logEmpty.classList.remove('hidden');
        const logEmptyTitle = document.getElementById('log-empty-title');
        const logEmptySub = document.getElementById('log-empty-sub');
        if (logEmptyTitle) logEmptyTitle.textContent = 'Console logs are empty';
        if (logEmptySub) logEmptySub.textContent = 'Start the bot to see execution outputs here.';
    }
}
