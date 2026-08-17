/**
 * Lógica do Frontend para o Dashboard IPTV
 */

let allChannels = []; // Armazenar todos os canais para busca
let allChannelsCache = null;
let allChannelsCacheTime = 0;
const ALL_CHANNELS_TTL = 3000; // 3s: dados frescos sem refetch em cada clique

// Busca a lista completa de canais sob demanda (ações pontuais: editar, copiar link, alternar modo)
// Cache curto + invalidação explícita nas mutações garante status sempre atualizado
async function getAllChannels() {
    if (allChannelsCache && (Date.now() - allChannelsCacheTime) < ALL_CHANNELS_TTL) {
        return allChannelsCache;
    }
    const res = await apiFetch('/api/channels');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    allChannels = Array.isArray(list) ? list : [];
    allChannelsCache = allChannels;
    allChannelsCacheTime = Date.now();
    return allChannels;
}

// Invalida o cache após qualquer mutação (parar, iniciar, excluir, alternar modo, etc.)
function invalidateAllChannelsCache() {
    allChannelsCache = null;
    allChannelsCacheTime = 0;
}

// ─── Ícones SVG (sistema de ícones consistente do painel) ───
const ICON_PATHS = {
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    stop: '<rect x="6" y="6" width="12" height="12"/>',
    next: '<polygon points="1 4 10 12 1 20 1 4"/><polygon points="11 4 20 12 11 20 11 4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    logs: '<polyline points="8 6 13 6 13 10 8 10 8 6"/><polyline points="8 12 18 12 18 16 8 16 8 12"/><path d="M13 10h3"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};

function svgIcon(name, size = 15) {
    const path = ICON_PATHS[name] || '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// SVGs pré-gerados para os botões de ação (evita recriar strings a cada render)
const SVG_PLAY = svgIcon('play');
const SVG_STOP = svgIcon('stop');
const SVG_NEXT = svgIcon('next');
const SVG_LINK = svgIcon('link');
const SVG_EDIT = svgIcon('edit');
const SVG_LOGS = svgIcon('logs');
const SVG_TRASH = svgIcon('trash');

// Escapa HTML para evitar XSS em dados vindos do servidor
function escapeHtml(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Helpers para spinner de loading
function showLoadingSpinner(container) {
    if (!container) return;
    container.innerHTML = `<div style="text-align: center; padding: 24px;"><div class="loading-spinner"></div></div>`;
}

function hideLoadingSpinner(container) {
    if (!container) return;
    const spinner = container.querySelector('.loading-spinner');
    if (spinner) spinner.parentElement.remove();
}

// Faz fetch e redireciona para o login se a sessão expirou
async function apiFetch(url, options) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('Sessão expirada');
    }
    return res;
}

const diskCardCache = new Map();
let diskCardsInitialized = false;
let pendingDiskUpdates = null;
let diskUpdateFrame = null;

function getDiskFillClass(percent) {
    if (percent > 90) return 'fill-red';
    if (percent > 75) return 'fill-amber';
    return 'fill-green';
}

function cacheDiskCard(card) {
    const idx = Number(card.dataset.diskIdx);
    diskCardCache.set(idx, {
        fill: card.querySelector('.disk-bar-fill'),
        avail: card.querySelector('.disk-meta strong'),
        usage: card.querySelector('.disk-usage')
    });
}

function createDiskCard(disk, idx) {
    const percent = parseInt(disk.usePercent, 10) || 0;
    const card = document.createElement('div');
    card.className = 'disk-card';
    card.dataset.diskIdx = idx;

    const head = document.createElement('div');
    head.className = 'disk-head';
    const name = document.createElement('span');
    name.className = 'disk-name';
    name.textContent = `Montagem: ${disk.mounted || ''}`;
    const filesystem = document.createElement('span');
    filesystem.className = 'disk-fs';
    filesystem.textContent = disk.filesystem || '';
    head.append(name, filesystem);

    const bar = document.createElement('div');
    bar.className = 'disk-bar';
    const fill = document.createElement('div');
    fill.className = `disk-bar-fill ${getDiskFillClass(percent)}`;
    fill.style.transform = `scaleX(${(percent / 100).toFixed(3)})`;
    bar.appendChild(fill);

    const meta = document.createElement('div');
    meta.className = 'disk-meta';
    const available = document.createElement('span');
    available.append('Disponível: ');
    const availableValue = document.createElement('strong');
    availableValue.textContent = disk.avail || '';
    available.appendChild(availableValue);
    const usage = document.createElement('span');
    usage.className = 'disk-usage';
    usage.textContent = `${percent}% usado de ${disk.size || ''}`;
    meta.append(available, usage);

    card.append(head, bar, meta);
    return card;
}

function ensureDiskCards(disks) {
    const container = document.getElementById('disks-container');
    if (!container) return;

    if (!diskCardsInitialized) {
        container.replaceChildren();
        diskCardsInitialized = true;
    }

    disks.forEach((disk, idx) => {
        if (diskCardCache.has(idx)) return;
        const card = createDiskCard(disk, idx);
        container.appendChild(card);
        cacheDiskCard(card);
    });
}

function applyDiskUpdates(disks) {
    disks.forEach((disk, idx) => {
        const refs = diskCardCache.get(idx);
        if (!refs) return;

        const percent = parseInt(disk.usePercent, 10) || 0;
        const transform = `scaleX(${(percent / 100).toFixed(3)})`;
        const fillClass = `disk-bar-fill ${getDiskFillClass(percent)}`;
        const available = disk.avail || '';
        const usage = `${percent}% usado de ${disk.size || ''}`;

        if (refs.fill && refs.fill.style.transform !== transform) {
            refs.fill.style.transform = transform;
        }
        if (refs.fill && refs.fill.className !== fillClass) {
            refs.fill.className = fillClass;
        }
        if (refs.avail && refs.avail.textContent !== available) {
            refs.avail.textContent = available;
        }
        if (refs.usage && refs.usage.textContent !== usage) {
            refs.usage.textContent = usage;
        }
    });
}

function scheduleDiskUpdates(disks) {
    pendingDiskUpdates = disks;
    if (diskUpdateFrame !== null) return;

    diskUpdateFrame = requestAnimationFrame(() => {
        diskUpdateFrame = null;
        const updates = pendingDiskUpdates;
        pendingDiskUpdates = null;
        if (updates) applyDiskUpdates(updates);
    });
}

async function updateStats() {
    try {
        const res = await apiFetch('/api/status');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        
        const ioEl = document.getElementById('io-usage');
        const cpuEl = document.getElementById('cpu-usage');
        const ramEl = document.getElementById('ram-usage');
        const diskEl = document.getElementById('disk-usage');
        const netEl = document.getElementById('net-usage');
        const activeEl = document.getElementById('active-streams');
        if (ioEl) ioEl.innerText = `${data.io}%`;
        if (cpuEl) cpuEl.innerText = `${data.cpu}%`;
        if (ramEl) ramEl.innerText = `${data.ram}%`;
        if (diskEl) diskEl.innerText = `${data.disco}%`;
        if (netEl) netEl.innerText = `${data.rede} Mbps`;
        if (activeEl) activeEl.innerText = data.activeStreams;

        updateTrends([
            { id: 'io-usage', value: data.io },
            { id: 'cpu-usage', value: data.cpu },
            { id: 'ram-usage', value: data.ram },
            { id: 'disk-usage', value: data.disco },
            { id: 'net-usage', value: data.rede },
            { id: 'active-streams', value: data.activeStreams, inverse: true }
        ]);

        // Criar a estrutura apenas uma vez e atualizar os valores no próximo frame.
        if (data.disks && data.disks.length > 0) {
            ensureDiskCards(data.disks);
            scheduleDiskUpdates(data.disks);
        }
        // Cache status
        const cacheEl = document.getElementById('cache-status');
        if (data.nocache !== undefined && cacheEl) {
            cacheEl.innerText = data.nocache ? 'DESLIGADO' : 'LIGADO';
            cacheEl.classList.remove('value-good', 'value-bad');
            cacheEl.classList.add(data.nocache ? 'value-bad' : 'value-good');
            const card = document.getElementById('cache-card');
            if (card) card.title = data.nocache ? 'Clique para ativar cache (recomendado)' : 'Clique para desativar cache (libera RAM)';
        }
    } catch (err) {
        console.error('Erro ao buscar telemetria:', err);
    }
}

// Histórico de amostras para badges de tendência
const trendHistory = {};

function updateTrends(metrics) {
    metrics.forEach(m => {
        const el = document.getElementById(`trend-${m.id}`);
        if (!el) return;

        const prev = trendHistory[m.id];
        trendHistory[m.id] = m.value;

        // Primeira amostra ou valor estável: badge neutro
        if (prev === undefined || prev === m.value) {
            el.className = 'trend';
            el.innerHTML = '<span class="trend-arrow">~</span> estável';
            return;
        }

        const diff = m.value - prev;
        const pct = prev !== 0 ? Math.round((diff / prev) * 100) : 0;
        const up = diff > 0;
        const arrow = up ? '▲' : '▼';

        // Para métricas de uso: subir = pior (down), cair = melhor (up).
        // Para métricas com "inverse: true" (streams): subir = melhor (up).
        const good = m.inverse ? up : !up;

        el.className = `trend ${good ? 'up' : 'down'}`;
        el.innerHTML = `<span class="trend-arrow">${arrow}</span> ${Math.abs(pct)}%`;
    });
}

async function toggleNocache() {
    try {
        const res = await apiFetch('/api/toggle-nocache', { method: 'POST' });
        const data = await res.json();
        const el = document.getElementById('cache-status');
        if (!el) return;
        el.innerText = data.nocache ? 'DESLIGADO' : 'LIGADO';
        el.classList.remove('value-good', 'value-bad');
        el.classList.add(data.nocache ? 'value-bad' : 'value-good');
    } catch (err) {
        console.error('Erro ao alternar cache:', err);
    }
}

async function logout() {
    try {
        const res = await apiFetch('/api/logout', {
            method: 'POST'
        });
        if (res.ok) {
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error('Erro ao fazer logout:', err);
    }
}

const THEMES = ['dark', 'classic-dark', 'light', 'classic-light'];
const THEME_NAMES = {
    'dark': 'Dark Moderno (Azul)',
    'classic-dark': 'Escuro Clássico (Preto com Verde Neon)',
    'light': 'Light Moderno (Azul)',
    'classic-light': 'Claro Clássico (Esmeralda)'
};

// Restauração do tema salvo
(function applySavedTheme() {
    try {
        const saved = localStorage.getItem('drm-theme');
        if (saved && THEMES.includes(saved)) {
            document.documentElement.setAttribute('data-theme', saved);
            const themeBtn = document.querySelector('.btn-theme');
            if (themeBtn) themeBtn.setAttribute('title', `Tema: ${THEME_NAMES[saved] || saved}`);
        }
    } catch (err) {}
})();

// Alternância de tema (persistido em localStorage)
function toggleTheme() {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') || 'dark';
    const nextIdx = (THEMES.indexOf(current) + 1) % THEMES.length;
    const nextTheme = THEMES[nextIdx];
    root.setAttribute('data-theme', nextTheme);
    try {
        localStorage.setItem('drm-theme', nextTheme);
    } catch (err) {}

    const themeBtn = document.querySelector('.btn-theme');
    if (themeBtn) {
        themeBtn.setAttribute('title', `Tema: ${THEME_NAMES[nextTheme] || nextTheme}`);
    }
}

async function start(id) { 
    try {
        const res = await apiFetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const result = await res.json();
        // if (result.status === 'success') {
        //     alert(`Canal iniciado com sucesso!`); // Less intrusive UX
        // } else {
        //     alert(`Erro: ${result.message}`);
        // }
        invalidateAllChannelsCache();
        updateStats();
        loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
    } catch (err) {
        alert('Falha ao conectar com o servidor.');
    }
}

async function stop(id) {
    try {
        await apiFetch('/api/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        invalidateAllChannelsCache();
        updateStats(); // This will also call loadAndRenderChannels
        loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
    } catch (err) {
        console.error('Erro ao parar canal:', err);
    }
}

function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Variáveis de estado para ordenação
let currentSortColumn = 'id';
let currentSortDirection = 'asc';

// Variáveis de estado para paginação
let currentPage = 1;
let pageSize = 50;

function sortTable(column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'asc';
    }
        const input = document.getElementById('search-input');
        loadAndRenderChannels(input ? input.value : '');
}

function updateSortIcons() {
    const columns = ['id', 'name', 'status', 'type', 'uptime'];
    columns.forEach(col => {
        const icon = document.getElementById(`sort-icon-${col}`);
        if (!icon) return;
        if (col === currentSortColumn) {
            icon.innerText = currentSortDirection === 'asc' ? ' ▲' : ' ▼';
        } else {
            icon.innerText = '';
        }
    });
}

function isAdultChannel(channel) {
    const value = channel.is18;
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function getChannelStatus(channel) {
    return String(channel.status || channel.mode || '').toLowerCase();
}

function getChannelType(channel) {
    const status = String(channel.status || '').toLowerCase();
    if (status === 'vod') return 'vod';
    if (String(channel.mode || '').toLowerCase() === 'relay') {
        if (channel.relaySubtype === 'loop-cache') return 'relay-loop-cache';
        if (channel.relaySubtype === 'sync-cache') return 'relay-sync-cache';
        return channel.relaySubtype === 'loop' ? 'relay-loop' : 'relay-sync';
    }
    return 'live';
}

function getChannelTypeLabel(channel) {
    const labels = {
        live: 'LIVE',
        vod: 'VOD',
        'relay-sync': 'RELAY SYNC',
        'relay-loop': 'RELAY LOOP',
        'relay-sync-cache': 'SYNC CACHE',
        'relay-loop-cache': 'LOOP CACHE'
    };
    return labels[getChannelType(channel)] || 'LIVE';
}

function isChannelOnline(channel) {
    return String(channel.displayStatus || channel.status || '').toLowerCase() === 'online';
}

function getChannelPreparationMarkup(channel) {
    const prep = channel.preparation || channel.relayStartup;
    if (!prep) return '<span class="stat-muted">-</span>';

    const phase = String(prep.phase || '').toLowerCase();
    const isError = phase === 'error';
    const label = isError ? 'FALHA' : phase === 'probing' ? 'VALIDANDO' : 'BAIXANDO';
    const message = prep.message || 'Preparando canal...';
    return `<span class="channel-preparation ${isError ? 'preparation-error' : 'preparation-loading'}" title="${escapeHtml(message)}"><span class="preparation-dot"></span>${label}<small>${escapeHtml(message)}</small></span>`;
}

// Function to load and render channels
async function loadAndRenderChannels(filter = '') {
    try {
        const tbl = document.getElementById('channels-table');
        if (!tbl) return;

        const filterSelect = document.getElementById('filter-select');
        const filterType = filterSelect ? filterSelect.value : 'all';
        const statusSelect = document.getElementById('status-filter');
        const statusFilter = statusSelect ? statusSelect.value : 'all';
        const typeSelect = document.getElementById('type-filter');
        const channelTypeFilter = typeSelect ? typeSelect.value : 'all';

        // Filtro, ordenação e paginação agora no servidor (payload enxuto por página)
        const params = new URLSearchParams({
            page: currentPage,
            pageSize,
            search: filter || '',
            contentType: filterType,
            channelType: channelTypeFilter,
            status: statusFilter,
            sort: currentSortColumn,
            dir: currentSortDirection
        });

        const res = await apiFetch('/api/channels?' + params.toString());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data || !Array.isArray(data.items)) throw new Error('Resposta inválida');

        const channelList = data.items;
        const totalCount = data.total;

        updateSortIcons();

        const hint = document.getElementById('channel-count-hint');
        if (hint) hint.innerText = totalCount + ' CANAIS';

        // Garantir página dentro dos limites (refaz o fetch uma vez se o servidor clampou)
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        if (totalCount > 0 && currentPage > totalPages) {
            currentPage = totalPages;
            return loadAndRenderChannels(filter);
        }
        if (currentPage < 1) currentPage = 1;
        updatePaginationControls(totalCount, totalPages);

        const hasActiveFilter = Boolean(filter) || filterType !== 'all' || statusFilter !== 'all' || channelTypeFilter !== 'all';

        // Se vazio, mostrar mensagem
        if (channelList.length === 0) {
            const message = hasActiveFilter
                ? 'Nenhum canal corresponde aos filtros atuais.'
                : 'Nenhum canal configurado. Crie um novo!';
            tbl.innerHTML = `<tr class="empty-row"><td colspan="7">${message}</td></tr>`;
            return;
        }

        // Remover msg vazia se existe
        const emptyRow = tbl.querySelector('tr.empty-row');
        if (emptyRow) emptyRow.remove();

        // Diff/Patch: mapa de IDs existentes
        const existingRows = new Map();
        tbl.querySelectorAll('tr[data-channel-id]').forEach(row => {
            existingRows.set(row.dataset.channelId, row);
        });

        // Processar canais: atualizar ou criar
        const validIds = new Set();
        const rowsById = new Map();
        channelList.forEach(channel => {
            const channelIdStr = channel.id.toString();
            validIds.add(channelIdStr);
            
            const existingRow = existingRows.get(channelIdStr);
            if (existingRow) {
                updateChannelRowContent(existingRow, channel);
                rowsById.set(channelIdStr, existingRow);
            } else {
                const newRow = tbl.insertRow();
                newRow.dataset.channelId = channelIdStr;
                createChannelRowContent(newRow, channel);
                rowsById.set(channelIdStr, newRow);
            }
        });

        // Remover linhas de canais que não existem mais
        tbl.querySelectorAll('tr[data-channel-id]').forEach(row => {
            if (!validIds.has(row.dataset.channelId)) {
                row.remove();
            }
        });

        // Reordenar linhas para refletir a ordenação (appendChild move a linha existente)
        const reorderFragment = document.createDocumentFragment();
        channelList.forEach(channel => {
            const row = rowsById.get(channel.id.toString());
            if (row) reorderFragment.appendChild(row);
        });
        tbl.appendChild(reorderFragment);

    } catch (err) {
        console.error('Erro ao carregar canais:', err);
    }
}

function updatePaginationControls(totalCount, totalPages) {
    const info = document.getElementById('pagination-info');
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');

    if (info) {
        if (totalCount === 0) {
            info.innerText = 'Nenhum canal';
        } else {
            const start = (currentPage - 1) * pageSize + 1;
            const end = Math.min(currentPage * pageSize, totalCount);
            info.innerText = `Página ${currentPage} de ${totalPages} · ${start}–${end} de ${totalCount}`;
        }
    }
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

function createChannelRowContent(row, channel) {
    row.innerHTML = '';
    row.dataset.channelStatus = channel.displayStatus || channel.status;
    row.dataset.channelType = getChannelType(channel);
    row.dataset.channelPreparation = JSON.stringify(channel.preparation || null);
    
    const idCell = row.insertCell();
    idCell.innerHTML = `<span class="cell-id">${channel.id}</span>`;
    
    const nameCell = row.insertCell();
    let nameHTML = escapeHtml(channel.name);
    if (channel.is18) {
        nameHTML += ` <span class="badge-18" data-action="toggle18" data-id="${channel.id}" title="Clique para desmarcar +18">18+</span>`;
    } else {
        nameHTML += ` <span class="badge-18 off" data-action="toggle18" data-id="${channel.id}" title="Clique para marcar como +18">+18?</span>`;
    }
    nameCell.innerHTML = nameHTML;
    
    const statusCell = row.insertCell();
    const online = isChannelOnline(channel);
    statusCell.innerHTML = `<span class="status-badge ${online ? 'status-online' : 'status-offline'}">${online ? 'ONLINE' : 'OFFLINE'}</span>`;

    const preparationCell = row.insertCell();
    preparationCell.innerHTML = getChannelPreparationMarkup(channel);

    const type = getChannelType(channel);
    const typeCell = row.insertCell();
    typeCell.innerHTML = `<span class="type-badge type-${type}">${getChannelTypeLabel(channel)}</span>`;
    
    const uptimeCell = row.insertCell();
    uptimeCell.innerHTML = online
        ? `<span class="stat-num">${formatUptime(channel.uptime)}</span>`
        : `<span class="stat-muted">-</span>`;
    
    const actionsCell = row.insertCell();
    actionsCell.innerHTML = buildChannelActions(channel);
}

function buildChannelActions(channel) {
    let actionBtns = '';
    const online = isChannelOnline(channel);
    const preparing = Boolean(channel.preparation && channel.preparation.phase !== 'error');
    
    if (!online && !preparing) {
        actionBtns += `<button class="btn-primary btn-icon" data-action="start" data-id="${channel.id}" title="Iniciar">${SVG_PLAY}</button>`;
    } else {
        actionBtns += `<button class="btn-stop btn-icon" data-action="stop" data-id="${channel.id}" title="Parar">${SVG_STOP}</button>`;
    }
    
    if (channel.status === 'relay' && channel.relaySubtype === 'loop') {
        actionBtns += `<button class="btn-edit btn-icon" data-action="advanceRelay" data-id="${channel.id}" title="Próximo Vídeo">${SVG_NEXT}</button>`;
    }
    
    actionBtns += `<button class="btn-cyan btn-icon" data-action="copyChannelM3U" data-id="${channel.id}" title="Copiar Link M3U">${SVG_LINK}</button>`;

    if (online) {
        actionBtns += `<button class="btn-blue btn-icon" data-action="openPlayerModal" data-id="${channel.id}" data-name="${escapeHtml(channel.name)}" title="Assistir no Pop-up">${SVG_PLAY} ASSISTIR</button>`;
    }
    
    actionBtns += " " +
        `<button class="btn-edit btn-icon" data-action="showEditChannelModal" data-id="${channel.id}" title="Editar">${SVG_EDIT}</button> ` +
        `<button class="btn-neutral btn-icon" data-action="viewLogs" data-id="${channel.id}" data-name="${escapeHtml(channel.name)}" title="Logs">${SVG_LOGS}</button> ` +
        `<button class="btn-stop btn-icon" data-action="deleteChannel" data-id="${channel.id}" data-status="${online || preparing ? 'relay' : 'offline'}" title="Excluir">${SVG_TRASH}</button>`;
    
    return `<div class="action-bar">${actionBtns}</div>`;
}

function updateChannelRowContent(row, channel) {
    // Atualizar status, tipo e uptime sem reconstruir a linha inteira.
    const statusCell = row.cells[2];
    const preparationCell = row.cells[3];
    const typeCell = row.cells[4];
    const uptimeCell = row.cells[5];
    const online = isChannelOnline(channel);
    const newStatusHtml = `<span class="status-badge ${online ? 'status-online' : 'status-offline'}">${online ? 'ONLINE' : 'OFFLINE'}</span>`;
    if (statusCell.innerHTML !== newStatusHtml) {
        statusCell.innerHTML = newStatusHtml;
    }

    const newPreparationHtml = getChannelPreparationMarkup(channel);
    if (preparationCell.innerHTML !== newPreparationHtml) {
        preparationCell.innerHTML = newPreparationHtml;
    }

    const type = getChannelType(channel);
    const newTypeHtml = `<span class="type-badge type-${type}">${getChannelTypeLabel(channel)}</span>`;
    if (typeCell.innerHTML !== newTypeHtml) {
        typeCell.innerHTML = newTypeHtml;
    }

    const newUptimeHtml = online
        ? `<span class="stat-num">${formatUptime(channel.uptime)}</span>`
        : `<span class="stat-muted">-</span>`;
    if (uptimeCell.innerHTML !== newUptimeHtml) {
        uptimeCell.innerHTML = newUptimeHtml;
    }

    // Reconstruir a célula de ações (botão Iniciar/Parar, ASSISTIR, etc.)
    // quando o status mudar, para o ícone refletir o estado sem recarregar a página
    const displayStatus = channel.displayStatus || channel.status;
    const preparationKey = JSON.stringify(channel.preparation || null);
    if (row.dataset.channelStatus !== displayStatus || row.dataset.channelType !== type || row.dataset.channelPreparation !== preparationKey) {
        row.dataset.channelStatus = displayStatus;
        row.dataset.channelType = type;
        row.dataset.channelPreparation = preparationKey;
        const actionsCell = row.cells[6];
        if (actionsCell) actionsCell.innerHTML = buildChannelActions(channel);
    }
}

async function viewLogs(id, name) {
    const modal = document.getElementById('logs-modal');
    const content = document.getElementById('log-content');
    document.getElementById('log-modal-title').innerText = `Logs: ${name}`;
    
    content.innerText = 'Carregando logs...';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/api/logs?id=${id}`);
        if (res.ok) {
            content.innerText = await res.text();
            content.scrollTop = content.scrollHeight;
        } else {
            content.innerText = 'Nenhum log disponível para este canal ainda.';
        }
    } catch (err) {
        content.innerText = 'Erro ao carregar logs do servidor.';
    }
}

function hideLogsModal() {
    document.getElementById('logs-modal').style.display = 'none';
}

async function deleteChannel(id, status) {
    // Bloqueio preventivo no frontend para evitar erros de permissão (EPERM)
    if (status !== 'offline') {
        alert('Atenção: Você deve PARAR o canal antes de tentar excluí-lo.');
        return;
    }

    if (!confirm('Tem certeza que deseja excluir este canal e todos os seus arquivos temporários?')) return;
    try {
        const res = await apiFetch('/api/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            alert(`Erro: ${errorData.message || 'desconhecido'}`);
            return;
        }

        invalidateAllChannelsCache();
        updateStats(); // Isso forçará a atualização da lista de canais
        loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
    } catch (err) {
        console.error('Erro ao excluir canal:', err);
        alert('Erro ao excluir o canal.');
    }
}

// Functions for modal
// Functions for modal
let editingChannelId = null;

function showCreateChannelModal() {
    editingChannelId = null;
    document.getElementById('modal-title').innerText = 'Criar Novo Canal';
    document.getElementById('modal-submit-btn').innerText = 'Criar Canal';
    document.getElementById('create-channel-modal').style.display = 'flex';
    loadVideoSourceOptions();
    onChannelModeChange();
    loadRelayM3UFiles();
}

async function showEditChannelModal(id) {
    const all = await getAllChannels().catch(() => []);
    const channel = all.find(c => c.id === id);
    if (!channel) return;
    
    if (channel.runtimeActive === true) {
        alert('Por favor, PARE o canal antes de tentar editá-lo.');
        return;
    }

    editingChannelId = id;
    document.getElementById('modal-title').innerText = "Editar Canal: " + channel.name;
    document.getElementById('modal-submit-btn').innerText = 'Salvar Alterações';
    
    document.getElementById('new-channel-name').value = channel.name;
    document.getElementById('use-transcode').checked = !!channel.useTranscode;
    document.getElementById('new-channel-is18').checked = !!channel.is18;
    
    const mode = channel.mode || 'live';
    document.getElementById('channel-mode-select').value = mode;
    
    if (mode === 'relay') {
        document.getElementById('relay-subtype-select').value = channel.relaySubtype || 'loop';
        document.getElementById('relay-urls-input').value = (channel.relayUrls || []).join('\n');
    } else {
        document.getElementById('relay-subtype-select').value = 'loop';
        document.getElementById('relay-urls-input').value = '';
    }
    
    onChannelModeChange();
    loadRelayM3UFiles();

    // Exibe o modal
    document.getElementById('create-channel-modal').style.display = 'flex';
    
    // Carrega as opções e pré-seleciona a pasta existente
    loadVideoSourceOptions(channel.sourceFolder);
}

let isManualSource = false;

function toggleSourceInput(event) {
    if (event) event.preventDefault();
    const select = document.getElementById('video-source-select');
    const input = document.getElementById('video-source-input');
    const toggleLink = document.getElementById('toggle-source-type');
    
    isManualSource = !isManualSource;
    if (isManualSource) {
        select.style.display = 'none';
        input.style.display = 'block';
        toggleLink.innerText = 'Selecionar da pasta 24HORAS';
        input.focus();
    } else {
        select.style.display = 'block';
        input.style.display = 'none';
        toggleLink.innerText = 'Usar caminho absoluto manual';
    }
}

function hideCreateChannelModal() {
    document.getElementById('create-channel-modal').style.display = 'none';
    document.getElementById('new-channel-name').value = '';
    document.getElementById('new-channel-is18').checked = false;
    document.getElementById('use-transcode').checked = false;
    document.getElementById('channel-mode-select').value = 'live';
    document.getElementById('relay-subtype-select').value = 'loop';
    document.getElementById('relay-urls-input').value = '';
    document.getElementById('relay-m3u-select').value = '';
    editingChannelId = null;
    
    // Reset manual input states
    isManualSource = false;
    document.getElementById('video-source-select').style.display = 'block';
    document.getElementById('video-source-input').style.display = 'none';
    document.getElementById('video-source-input').value = '';
    document.getElementById('toggle-source-type').innerText = 'Usar caminho absoluto manual';
    onChannelModeChange();
}

async function loadVideoSourceOptions(selectedValue = "") {
    const select = document.getElementById('video-source-select');
    const input = document.getElementById('video-source-input');
    const toggleLink = document.getElementById('toggle-source-type');
    try {
        const res = await apiFetch('/api/videosources');
        if (!res.ok) throw new Error('Falha na resposta do servidor');
        
        const folders = await res.json();
        select.innerHTML = '<option value="">-- Selecione uma pasta --</option>'; // Default option
        
        if (folders.length === 0 || (folders.length === 1 && folders[0] === ".")) {
            select.innerHTML = '<option value=".">Raiz (24HORAS)</option>';
        }

        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder;
            option.innerText = folder === "." ? "Pasta Principal (Raiz)" : folder;
            select.appendChild(option);
        });

        // Configuração de preenchimento em caso de edição
        if (selectedValue) {
            const isAbsolute = selectedValue.startsWith('/') || /^[a-zA-Z]:\\/.test(selectedValue);
            if (isAbsolute) {
                isManualSource = true;
                select.style.display = 'none';
                input.style.display = 'block';
                input.value = selectedValue;
                toggleLink.innerText = 'Selecionar da pasta 24HORAS';
            } else {
                isManualSource = false;
                select.style.display = 'block';
                input.style.display = 'none';
                select.value = selectedValue;
                toggleLink.innerText = 'Usar caminho absoluto manual';
            }
        }
    } catch (err) {
        console.error('Erro ao carregar pastas de vídeo:', err);
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

async function createOrEditChannel() {
    const channelName = document.getElementById('new-channel-name').value;
    const mode = document.getElementById('channel-mode-select').value;
    
    let sourceFolderName = '';
    let relaySubtype = '';
    let relayUrls = [];
    
    if (mode === 'live') {
        const selectVal = document.getElementById('video-source-select').value;
        const inputVal = document.getElementById('video-source-input').value;
        sourceFolderName = isManualSource ? inputVal.trim() : selectVal;
        
        if (!channelName || !sourceFolderName) {
            alert('Por favor, preencha todos os campos e selecione ou digite uma pasta de origem.');
            return;
        }
    } else {
        relaySubtype = document.getElementById('relay-subtype-select').value;
        const urlsText = document.getElementById('relay-urls-input').value.trim();
        relayUrls = urlsText.split('\n').map(u => u.trim()).filter(u => u.length > 0);
        
        if (!channelName || relayUrls.length === 0) {
            alert('Por favor, forneça o nome do canal e pelo menos uma URL de transmissão.');
            return;
        }
    }
    
    const useTranscode = document.getElementById('use-transcode').checked;
    const is18 = document.getElementById('new-channel-is18').checked;

    const payload = { 
        channelName, 
        sourceFolderName, 
        useTranscode, 
        is18, 
        mode, 
        relaySubtype, 
        relayUrls 
    };
    let endpoint = '/api/createchannel';

    if (editingChannelId !== null) {
        payload.id = editingChannelId;
        endpoint = '/api/updatechannel';
    }

    try {
        const res = await apiFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json().catch(() => ({}));
        if (result.status === 'success') {
            alert(editingChannelId !== null ? "Canal atualizado com sucesso!" : "Canal criado com sucesso!");
            invalidateAllChannelsCache();
            hideCreateChannelModal();
            const input = document.getElementById('search-input');
            loadAndRenderChannels(input ? input.value : '');
        } else {
            alert("Erro: " + (result.message || 'desconhecido'));
        }
    } catch (err) {
        alert('Falha ao conectar com o servidor.');
        console.error('Erro ao salvar canal:', err);
    }
}

// Função para busca
function handleSearch() {
    currentPage = 1;
    const input = document.getElementById('search-input');
    loadAndRenderChannels(input ? input.value : '');
}

// Função para scroll to top
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('scroll', () => {
    const scrollToTopBtn = document.getElementById('scroll-to-top');
    if (!scrollToTopBtn) return;
    scrollToTopBtn.style.display = window.scrollY > 100 ? 'block' : 'none';
});

// Alternar abas
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`#btn-tab-${tab}`);
    const content = document.getElementById(`tab-${tab}`);
    if (btn) btn.classList.add('active');
    if (content) content.classList.add('active');
    if (tab === 'seguranca') {
        loadLoginAttempts();
        loadBlockedIPs();
        loadTopAttackers();
        loadNginxAccess();
    }
}

// Funções da aba Segurança
async function loadLoginAttempts() {
    const tbody = document.getElementById('login-attempts-table');
    if (!tbody) return;
    
    const isFirstLoad = tbody.children.length === 0 || tbody.querySelector('.loading-spinner');
    if (isFirstLoad) showLoadingSpinner(tbody);
    
    try {
        const res = await apiFetch('/api/login-attempts');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const attempts = await res.json();
        
        // Identificar tentativa por timestamp (única)
        const existingRows = new Map();
        tbody.querySelectorAll('tr[data-timestamp]').forEach(row => {
            existingRows.set(row.dataset.timestamp, row);
        });
        
        if (!attempts.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma tentativa registrada ainda.</td></tr>';
            return;
        }
        
        // Limpar spinner/mensagem vazia se existir
        const spinner = tbody.querySelector('.loading-spinner');
        if (spinner) spinner.closest('tr').remove();
        const emptyRow = tbody.querySelector('tr.empty-row');
        if (emptyRow && attempts.length > 0) emptyRow.remove();
        
        const validTimestamps = new Set();
        attempts.forEach(a => {
            const timestamp = new Date(a.timestamp).getTime().toString();
            validTimestamps.add(timestamp);
            
            const existingRow = existingRows.get(timestamp);
            if (existingRow) {
                // Atualizar só se mudou (comparar atributos data, não outerHTML)
                const newClass = a.success ? '' : 'row-fail';
                if (existingRow.className !== newClass) {
                    existingRow.className = newClass;
                }
                const statusCell = existingRow.cells[3];
                if (statusCell) {
                    const newStatusHtml = a.success ? '<span class="stat-ok">OK</span>' : '<span class="stat-fail">FALHA</span>';
                    if (statusCell.innerHTML !== newStatusHtml) {
                        statusCell.innerHTML = newStatusHtml;
                    }
                }
            } else {
                const newRowHtml = `
                    <tr data-timestamp="${timestamp}" class="${a.success ? '' : 'row-fail'}">
                        <td><code>${escapeHtml(a.ip)}</code></td>
                        <td>${escapeHtml(a.user)}</td>
                        <td>${new Date(a.timestamp).toLocaleString('pt-BR')}</td>
                        <td>${a.success ? '<span class="stat-ok">OK</span>' : '<span class="stat-fail">FALHA</span>'}</td>
                        <td>
                            <button class="btn-danger btn-small" data-action="blockIP" data-ip="${escapeHtml(a.ip)}">BLOQUEAR</button>
                        </td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', newRowHtml);
            }
        });
        
        // Remover linhas que não estão mais presentes
        tbody.querySelectorAll('tr[data-timestamp]').forEach(row => {
            if (!validTimestamps.has(row.dataset.timestamp)) {
                row.remove();
            }
        });
        
    } catch (e) {
        if (isFirstLoad) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Erro ao carregar tentativas.</td></tr>';
        }
    }
}

async function loadBlockedIPs() {
    const tbody = document.getElementById('blocked-ips-table');
    const count = document.getElementById('blocked-count');
    if (!tbody) return;
    
    const isFirstLoad = tbody.children.length === 0 || tbody.querySelector('.loading-spinner');
    if (isFirstLoad) showLoadingSpinner(tbody);
    
    try {
        const res = await apiFetch('/api/blocked-ips');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const ips = await res.json();
        
        if (count && count.textContent !== ips.length.toString()) {
            count.textContent = ips.length;
        }
        
        if (!ips.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="2">Nenhum IP bloqueado.</td></tr>';
            return;
        }
        
        // Limpar spinner/empty se existirem
        const spinner = tbody.querySelector('.loading-spinner');
        if (spinner) spinner.closest('tr').remove();
        const emptyRow = tbody.querySelector('tr.empty-row');
        if (emptyRow && ips.length > 0) emptyRow.remove();
        
        // Diff/Patch por IP (sem outerHTML)
        const existingRows = new Map();
        tbody.querySelectorAll('tr[data-ip]').forEach(row => {
            existingRows.set(row.dataset.ip, row);
        });
        
        const validIps = new Set();
        ips.forEach(ip => {
            validIps.add(ip);
            
            if (!existingRows.has(ip)) {
                const newRowHtml = `
                    <tr data-ip="${escapeHtml(ip)}">
                        <td><code>${escapeHtml(ip)}</code></td>
                        <td>
                            <button class="btn-primary btn-small" data-action="unblockIP" data-ip="${escapeHtml(ip)}">DESBLOQUEAR</button>
                        </td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', newRowHtml);
            }
        });
        
        // Remover IPs não mais bloqueados
        tbody.querySelectorAll('tr[data-ip]').forEach(row => {
            if (!validIps.has(row.dataset.ip)) {
                row.remove();
            }
        });
        
    } catch (e) {
        if (isFirstLoad) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="2">Erro ao carregar IPs bloqueados.</td></tr>';
        }
    }
}

async function loadTopAttackers() {
    const tbody = document.getElementById('top-attackers-table');
    if (!tbody) return;
    showLoadingSpinner(tbody);
    
    try {
        const res = await apiFetch('/api/top-attackers');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const attackers = await res.json();
        if (!attackers.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhum dado ainda.</td></tr>';
            return;
        }
        tbody.innerHTML = attackers.map(a => `
            <tr class="${a.fails >= a.total * 0.5 && a.total >= 3 ? 'row-attacker' : ''}">
                <td><code>${escapeHtml(a.ip)}</code></td>
                <td class="stat-num">${a.total}</td>
                <td class="${a.fails > 0 ? 'stat-fail' : 'stat-muted'}">${a.fails}</td>
                <td class="stat-ok">${a.successes}</td>
                <td>${new Date(a.lastAttempt).toLocaleString('pt-BR')}</td>
                <td>
                    <button class="btn-danger btn-small" data-action="blockIP" data-ip="${escapeHtml(a.ip)}">BLOQUEAR</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Erro ao carregar.</td></tr>';
    }
}

async function loadNginxAccess() {
    const tbody = document.getElementById('nginx-access-table');
    if (tbody) showLoadingSpinner(tbody);
    
    try {
        const [accessRes, statsRes] = await Promise.all([
            apiFetch('/api/nginx-access'),
            apiFetch('/api/nginx-access/stats')
        ]);
        if (!accessRes.ok || !statsRes.ok) throw new Error('HTTP');
        const accessData = await accessRes.json();
        const statsData = await statsRes.json();

        const ipsEl = document.getElementById('access-unique-ips');
        const reqEl = document.getElementById('access-total-requests');
        if (ipsEl) ipsEl.textContent = statsData.totalIPs;
        if (reqEl) reqEl.textContent = statsData.totalRequests;

        if (!accessData.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhum acesso registrado nos últimos 60 minutos.</td></tr>';
            return;
        }

        tbody.innerHTML = accessData.slice(0, 100).map(entry => {
            const channelsStr = entry.channels.slice(0, 5).map(ch =>
                `<span class="channel-chip">#<b>${ch.id}</b> (${ch.hits})</span>`
            ).join('');
            const more = entry.channels.length > 5 ? ` <span class="stat-kicker">+${entry.channels.length - 5}</span>` : '';
            return `<tr>
                <td><code>${escapeHtml(entry.ip)}</code></td>
                <td>${channelsStr}${more}</td>
                <td class="stat-num">${entry.totalHits}</td>
                <td>${new Date(entry.lastSeen).toLocaleString('pt-BR')}</td>
                <td><button class="btn-danger btn-small" data-action="blockIP" data-ip="${escapeHtml(entry.ip)}">BLOQUEAR</button></td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Erro ao carregar dados de acesso.</td></tr>';
    }
}

// Auto-refresh dos acessos a cada 15s
setInterval(async () => {
    const segurancaTab = document.getElementById('tab-seguranca');
    if (segurancaTab && segurancaTab.classList.contains('active')) {
        await loadNginxAccess();
    }
}, 15000);

async function blockIP(ip) {
    if (!confirm(`Bloquear o IP ${ip}?`)) return;
    try {
        const res = await apiFetch('/api/block-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            loadLoginAttempts();
            loadBlockedIPs();
            loadTopAttackers();
        } else {
            alert('Erro ao bloquear IP: ' + (data.message || 'desconhecido'));
        }
    } catch (e) {
        alert('Erro ao bloquear IP');
    }
}

async function unblockIP(ip) {
    if (!confirm(`Desbloquear o IP ${ip}?`)) return;
    try {
        const res = await apiFetch('/api/unblock-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            loadBlockedIPs();
            loadLoginAttempts();
            loadTopAttackers();
        } else {
            alert('Erro ao desbloquear IP: ' + (data.message || 'desconhecido'));
        }
    } catch (e) {
        alert('Erro ao desbloquear IP');
    }
}

// Atualização automática dos gráficos de hardware (10s) e canais (15s)
setInterval(updateStats, 10000);
setInterval(() => {
    const input = document.getElementById('search-input');
    loadAndRenderChannels(input ? input.value : '');
}, 15000);
updateStats();
loadAndRenderChannels(); // Load channels on initial page load

// Relógio do masthead (teletexto)
function updateHeaderClock() {
    const timeEl = document.getElementById('header-time');
    const dateEl = document.getElementById('header-date');
    const now = new Date();
    if (timeEl) {
        timeEl.innerText = now.toLocaleTimeString('pt-BR', { hour12: false });
    }
    if (dateEl) {
        dateEl.innerText = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    }
}
updateHeaderClock();
setInterval(updateHeaderClock, 1000);

// Alternar status +18 de forma dinâmica por clique
async function toggle18(id) {
    try {
        const res = await apiFetch('/api/toggle18', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (res.ok) {
            invalidateAllChannelsCache();
            loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
        }
    } catch (err) {
        console.error('Erro ao alternar status +18:', err);
    }
}

// Funções para exportar M3U
function downloadM3U() {
    window.location.href = '/playlist.m3u';
}

function copyM3ULink() {
    const link = `${window.location.protocol}//${window.location.host}/playlist.m3u`;
    navigator.clipboard.writeText(link).then(() => {
        alert('Link da Playlist M3U copiado para a área de transferência:\n' + link);
    }).catch(err => {
        alert('Erro ao copiar link automaticamente. Aqui está o link:\n' + link);
    });
}

async function startAll() {
    if (!confirm('Tem certeza que deseja INICIAR todos os canais offline?')) return;
    try {
        const res = await apiFetch('/api/startall', {
            method: 'POST'
        });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const results = Array.isArray(data.results) ? data.results : [];
            const success = results.filter(item => item.status === 'success');
            const alreadyRunning = results.filter(item => item.status === 'already-running');
            const starting = results.filter(item => item.status === 'starting');
            const failed = results.filter(item => !['success', 'already-running', 'starting'].includes(item.status));
            const lines = [
                `Iniciar Todos solicitado: ${starting.length} em preparação, ${success.length} iniciado(s), ${alreadyRunning.length} já ativo(s), ${failed.length} falha(s).`,
                ''
            ];
            success.forEach(item => lines.push(`✓ ${item.name}`));
            alreadyRunning.forEach(item => lines.push(`• ${item.name}: ${item.message || 'já ativo'}`));
            starting.forEach(item => lines.push(`↻ ${item.name}: ${item.message}`));
            failed.forEach(item => lines.push(`✗ ${item.name}: ${item.message || 'não foi iniciado'}`));
            if (results.length) alert(lines.join('\n'));
            invalidateAllChannelsCache();
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
        } else {
            alert('Erro ao iniciar todos os canais.');
        }
    } catch (err) {
        alert('Falha ao conectar com o servidor.');
    }
}

async function stopAll() {
    if (!confirm('Tem certeza que deseja PARAR todos os canais ativos?')) return;
    try {
        const res = await apiFetch('/api/stopall', {
            method: 'POST'
        });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const results = Array.isArray(data.results) ? data.results : [];
            if (results.length) {
                alert(`Parar Todos concluído: ${results.length} canal(is) parado(s).\n\n${results.map(item => `✓ ${item.name}`).join('\n')}`);
            }
            invalidateAllChannelsCache();
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
        } else {
            alert('Erro ao parar todos os canais.');
        }
    } catch (err) {
        alert('Falha ao conectar com o servidor.');
    }
}

async function toggleVod(id) {
    const all = await getAllChannels().catch(() => []);
    const channel = all.find(c => c.id === id);
    if (!channel) return;
    
    let confirmMsg = '';
    if (channel.status === 'vod') {
        confirmMsg = `Alternar canal ${id} ("${channel.name}") de volta para LIVE? O FFmpeg será reiniciado.`;
    } else {
        confirmMsg = `Alternar canal ${id} ("${channel.name}") para modo VOD?\nSe os arquivos de vídeo ainda não foram convertidos, isso iniciará a conversão (pode levar alguns minutos).`;
    }
    
    if (!confirm(confirmMsg)) return;

    try {
        const res = await apiFetch('/api/toggle-vod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === 'success') {
            alert(`Canal ${id} alternado para modo ${data.mode.toUpperCase()} com sucesso!`);
            invalidateAllChannelsCache();
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
        } else {
            alert(`Erro: ${data.message || 'Falha ao alternar modo VOD'}`);
        }
    } catch (err) {
        console.error('Erro ao alternar VOD:', err);
        alert('Erro ao tentar alternar o modo VOD.');
    }
}

// --- RELAY AND SWITCH MODE CONTROLS ---

function onChannelModeChange() {
    const mode = document.getElementById('channel-mode-select').value;
    const localSection = document.getElementById('local-folder-section');
    const relaySection = document.getElementById('relay-section');
    const transcodeContainer = document.getElementById('transcode-checkbox-container');
    
    if (mode === 'relay') {
        if (localSection) localSection.classList.add('u-hidden');
        if (relaySection) relaySection.classList.remove('u-hidden');
        if (transcodeContainer) transcodeContainer.classList.add('u-hidden');
        loadRelayM3UFiles();
    } else {
        if (localSection) localSection.classList.remove('u-hidden');
        if (relaySection) relaySection.classList.add('u-hidden');
        if (transcodeContainer) transcodeContainer.classList.remove('u-hidden');
    }
}

async function loadRelayM3UFiles() {
    const select = document.getElementById('relay-m3u-select');
    try {
        const res = await apiFetch('/api/relay-m3u-files');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const files = await res.json();
        select.innerHTML = '<option value="">-- Selecione para importar links --</option>';
        files.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.innerText = f;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Erro ao buscar m3u:', e);
    }
}

async function onM3UFileSelect() {
    const file = document.getElementById('relay-m3u-select').value;
    if (!file) return;
    try {
        const res = await apiFetch("/api/read-m3u?file=" + encodeURIComponent(file));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.urls && data.urls.length > 0) {
            const textarea = document.getElementById('relay-urls-input');
            textarea.value = data.urls.join('\n');
            alert(data.urls.length + " URLs importadas da playlist com sucesso!");
        } else {
            alert('Nenhuma URL encontrada na playlist.');
        }
    } catch (e) {
        alert('Erro ao carregar a playlist.');
    }
}

async function advanceRelay(id) {
    try {
        const res = await apiFetch('/api/relay-advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const result = await res.json().catch(() => ({}));
        if (result.status === 'success') {
            loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
        } else {
            alert('Erro ao avançar vídeo.');
        }
    } catch (e) {
        alert('Erro de conexão ao avançar.');
    }
}

let switchModeChannelId = null;

async function openSwitchModeModal(id) {
    const all = await getAllChannels().catch(() => []);
    const channel = all.find(c => c.id === id);
    if (!channel) return;
    switchModeChannelId = id;
    document.getElementById('switch-mode-channel-name').innerText = "Canal: " + channel.name;
    
    let currentVal = 'offline';
    if (channel.status === 'vod') {
        currentVal = 'vod';
    } else if (channel.status === 'relay') {
        currentVal = channel.relaySubtype === 'sync' ? 'relay-sync'
            : channel.relaySubtype === 'sync-cache' ? 'relay-sync-cache'
            : channel.relaySubtype === 'loop-cache' ? 'relay-loop-cache'
            : 'relay-loop';
    } else if (channel.status === 'online') {
        currentVal = 'live';
    }
    
    document.getElementById('fast-mode-select').value = currentVal;
    document.getElementById('switch-mode-modal').style.display = 'flex';
}

function hideSwitchModeModal() {
    document.getElementById('switch-mode-modal').style.display = 'none';
    switchModeChannelId = null;
}

async function submitSwitchMode() {
    if (switchModeChannelId === null) return;
    const newMode = document.getElementById('fast-mode-select').value;
    try {
        const res = await apiFetch('/api/switch-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: switchModeChannelId, newMode })
        });
        const result = await res.json().catch(() => ({}));
        if (result.status === 'success') {
            hideSwitchModeModal();
            invalidateAllChannelsCache();
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input') ? document.getElementById('search-input').value : '');
        } else {
            alert("Erro: " + (result.message || 'desconhecido'));
        }
    } catch (e) {
        alert('Erro ao alternar modo no servidor.');
    }
}

// ═════════════════════════════════════════════════════════════════
// PLAYER POP-UP EMBUTIDO (HLS.JS) & COPIAR LINK M3U
// ═════════════════════════════════════════════════════════════════
let hlsPlayerInstance = null;
let currentPlayingStreamUrl = '';

function copyChannelM3U(channelId) {
    const url = `${window.location.protocol}//${window.location.host}/canais/${channelId}/index.m3u8`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            alert(`Link M3U do Canal ${channelId} copiado:\n\n${url}`);
        }).catch(() => {
            prompt(`Copie o link M3U do Canal ${channelId}:`, url);
        });
    } else {
        prompt(`Copie o link M3U do Canal ${channelId}:`, url);
    }
}

let hlsJsLoadPromise = null;

// Carrega o hls.js do CDN apenas quando o player for aberto (evita bloquear o painel)
function loadHlsJs() {
    if (window.Hls) return Promise.resolve();
    if (hlsJsLoadPromise) return hlsJsLoadPromise;
    hlsJsLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
            hlsJsLoadPromise = null;
            reject(new Error('Falha ao carregar hls.js'));
        };
        document.head.appendChild(s);
    });
    return hlsJsLoadPromise;
}

function openPlayerModal(channelId, channelName) {
    const modal = document.getElementById('player-modal');
    const video = document.getElementById('hls-video-player');
    const title = document.getElementById('player-modal-title');
    const urlLabel = document.getElementById('player-stream-url');
    
    currentPlayingStreamUrl = `${window.location.protocol}//${window.location.host}/canais/${channelId}/index.m3u8`;
    
    if (title) title.innerText = channelName;
    if (urlLabel) urlLabel.innerText = currentPlayingStreamUrl;
    if (modal) modal.style.display = 'flex';

    // Limpa instância anterior do Hls se existir
    if (hlsPlayerInstance) {
        hlsPlayerInstance.destroy();
        hlsPlayerInstance = null;
    }

    const startPlayback = () => {
        if (window.Hls && Hls.isSupported()) {
            hlsPlayerInstance = new Hls({
                manifestLoadingTimeOut: 15000,
                manifestLoadingMaxRetry: 5,
                levelLoadingTimeOut: 15000,
                liveSyncDurationCount: 1,
                liveMaxLatencyDurationCount: 3,
                liveDurationInfinity: true,
                maxBufferLength: 30,
                startPosition: -1
            });
            hlsPlayerInstance.loadSource(currentPlayingStreamUrl);
            hlsPlayerInstance.attachMedia(video);
            hlsPlayerInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(e => console.log('Autoplay prevenido pelo navegador:', e));
            });
            hlsPlayerInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.warn('[PLAYER] Erro de rede no stream HLS, reconectando...');
                            hlsPlayerInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.warn('[PLAYER] Erro de mídia no stream HLS, recuperando...');
                            hlsPlayerInstance.recoverMediaError();
                            break;
                        default:
                            console.error('[PLAYER] Erro fatal no stream HLS:', data);
                            break;
                    }
                }
            });
        } else if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = currentPlayingStreamUrl;
            video.play().catch(e => console.log('Autoplay prevenido:', e));
        } else {
            alert('Seu navegador não possui suporte para reprodução de vídeo HLS.');
        }
    };

    loadHlsJs().then(startPlayback).catch(() => {
        if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = currentPlayingStreamUrl;
            video.play().catch(e => console.log('Autoplay prevenido:', e));
        } else {
            alert('Falha ao carregar o player HLS.');
        }
    });
}

function closePlayerModal() {
    const modal = document.getElementById('player-modal');
    const video = document.getElementById('hls-video-player');
    
    if (video) {
        video.pause();
        video.src = '';
    }
    if (hlsPlayerInstance) {
        hlsPlayerInstance.destroy();
        hlsPlayerInstance = null;
    }
    if (modal) {
        modal.style.display = 'none';
    }
}

function copyCurrentPlayerUrl() {
    if (currentPlayingStreamUrl) {
        copyChannelM3U(currentPlayingStreamUrl.match(/\/canais\/(\d+)\//)?.[1] || '');
    }
}

async function clearAllLogs() {
    if (!confirm('Deseja realmente limpar e resetar os logs de erros de TODOS os canais?')) return;
    try {
        const res = await apiFetch('/api/clear-logs', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === 'success') {
            alert(`Logs limpos com sucesso!\n\n${data.count} arquivo(s) de log de canais foram esvaziados e resetados.`);
        } else {
            alert('Erro ao limpar logs: ' + (data.message || 'Falha no servidor'));
        }
    } catch (e) {
        alert('Erro ao conectar com o servidor para limpar os logs.');
    }
}

// ═════════════════════════════════════════════════════════════════
// EVENT LISTENERS & INICIALIZAÇÃO DA INTERFACE (ZERO INLINE)
// ═════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Theme toggle
    const themeBtn = document.querySelector('.btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Logout button
    const logoutBtn = document.querySelector('.btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Cache card
    const cacheCard = document.getElementById('cache-card');
    if (cacheCard) cacheCard.addEventListener('click', toggleNocache);

    // Tab buttons
    const btnTabCanais = document.getElementById('btn-tab-canais');
    if (btnTabCanais) btnTabCanais.addEventListener('click', () => switchTab('canais'));

    const btnTabSeguranca = document.getElementById('btn-tab-seguranca');
    if (btnTabSeguranca) btnTabSeguranca.addEventListener('click', () => switchTab('seguranca'));

    // Filter select & Search input
    const filterSelect = document.getElementById('filter-select');
    if (filterSelect) filterSelect.addEventListener('change', handleSearch);

    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) statusFilter.addEventListener('change', handleSearch);

    const typeFilter = document.getElementById('type-filter');
    if (typeFilter) typeFilter.addEventListener('change', handleSearch);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    // Pagination controls
    const pageSizeSelect = document.getElementById('page-size-select');
    if (pageSizeSelect) pageSizeSelect.addEventListener('change', () => {
        pageSize = parseInt(pageSizeSelect.value, 10) || 50;
        currentPage = 1;
        const searchEl = document.getElementById('search-input');
        loadAndRenderChannels(searchEl ? searchEl.value : '');
    });

    const paginationPrev = document.getElementById('pagination-prev');
    if (paginationPrev) paginationPrev.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            const searchEl = document.getElementById('search-input');
            loadAndRenderChannels(searchEl ? searchEl.value : '');
        }
    });

    const paginationNext = document.getElementById('pagination-next');
    if (paginationNext) paginationNext.addEventListener('click', () => {
        currentPage++;
        const searchEl = document.getElementById('search-input');
        loadAndRenderChannels(searchEl ? searchEl.value : '');
    });

    // Action buttons: delegation keeps the controls working even if the
    // surrounding interface is refreshed or replaced by a render cycle.
    document.addEventListener('click', (event) => {
        const startButton = event.target.closest('#btn-start-all');
        if (startButton) {
            event.preventDefault();
            console.log('[UI] Iniciar Todos clicado');
            startAll();
            return;
        }

        const stopButton = event.target.closest('#btn-stop-all');
        if (stopButton) {
            event.preventDefault();
            console.log('[UI] Parar Todos clicado');
            stopAll();
        }
    });

    const btnDownloadM3U = document.getElementById('btn-download-m3u');
    if (btnDownloadM3U) btnDownloadM3U.addEventListener('click', downloadM3U);

    const btnClearLogs = document.getElementById('btn-clear-logs');
    if (btnClearLogs) btnClearLogs.addEventListener('click', clearAllLogs);

    const btnCreateChannel = document.getElementById('btn-create-channel');
    if (btnCreateChannel) btnCreateChannel.addEventListener('click', showCreateChannelModal);

    // Refresh buttons
    const btnRefreshLogins = document.getElementById('btn-refresh-logins');
    if (btnRefreshLogins) btnRefreshLogins.addEventListener('click', loadLoginAttempts);

    const btnRefreshAccess = document.getElementById('btn-refresh-access');
    if (btnRefreshAccess) btnRefreshAccess.addEventListener('click', loadNginxAccess);

    // Table Header Sorts
    document.querySelectorAll('.th-sort').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (col) sortTable(col);
        });
    });

    // Modals
    const channelModeSelect = document.getElementById('channel-mode-select');
    if (channelModeSelect) channelModeSelect.addEventListener('change', onChannelModeChange);

    const toggleSourceType = document.getElementById('toggle-source-type');
    if (toggleSourceType) toggleSourceType.addEventListener('click', (e) => toggleSourceInput(e));

    const relayM3uSelect = document.getElementById('relay-m3u-select');
    if (relayM3uSelect) relayM3uSelect.addEventListener('change', onM3UFileSelect);

    const modalSubmitBtn = document.getElementById('modal-submit-btn');
    if (modalSubmitBtn) modalSubmitBtn.addEventListener('click', createOrEditChannel);

    const btnCancelModal = document.getElementById('btn-cancel-modal');
    if (btnCancelModal) btnCancelModal.addEventListener('click', hideCreateChannelModal);

    const btnSubmitSwitchMode = document.getElementById('btn-submit-switch-mode');
    if (btnSubmitSwitchMode) btnSubmitSwitchMode.addEventListener('click', submitSwitchMode);

    const btnCancelSwitchMode = document.getElementById('btn-cancel-switch-mode');
    if (btnCancelSwitchMode) btnCancelSwitchMode.addEventListener('click', hideSwitchModeModal);

    const btnCloseLogs = document.getElementById('btn-close-logs');
    if (btnCloseLogs) btnCloseLogs.addEventListener('click', hideLogsModal);

    const btnClosePlayer = document.getElementById('btn-close-player');
    if (btnClosePlayer) btnClosePlayer.addEventListener('click', closePlayerModal);

    const btnCopyPlayerUrl = document.getElementById('btn-copy-player-url');
    if (btnCopyPlayerUrl) btnCopyPlayerUrl.addEventListener('click', copyCurrentPlayerUrl);

    const scrollToTopBtn = document.getElementById('scroll-to-top');
    if (scrollToTopBtn) scrollToTopBtn.addEventListener('click', scrollToTop);

    // Event Delegation para Canais e Segurança (Botões Dinâmicos da Tabela)
    const channelsTable = document.getElementById('channels-table');
    if (channelsTable) {
        channelsTable.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.getAttribute('data-action');
            const id = Number(target.getAttribute('data-id'));
            const name = target.getAttribute('data-name') || '';
            const status = target.getAttribute('data-status') || '';

            if (action === 'toggle18') toggle18(id);
            else if (action === 'start') start(id);
            else if (action === 'stop') stop(id);
            else if (action === 'advanceRelay') advanceRelay(id);
            else if (action === 'copyChannelM3U') copyChannelM3U(id);
            else if (action === 'openPlayerModal') openPlayerModal(id, name);
            else if (action === 'showEditChannelModal') showEditChannelModal(id);
            else if (action === 'viewLogs') viewLogs(id, name);
            else if (action === 'deleteChannel') deleteChannel(id, status);
        });
    }

    // Delegation para Security Tables (blockIP / unblockIP)
    document.querySelectorAll('#login-attempts-table, #top-attackers-table, #blocked-ips-table, #nginx-access-table').forEach(table => {
        if (table) {
            table.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                const action = target.getAttribute('data-action');
                const ip = target.getAttribute('data-ip');
                if (action === 'blockIP' && ip) blockIP(ip);
                else if (action === 'unblockIP' && ip) unblockIP(ip);
            });
        }
    });
});
