/**
 * Lógica do Frontend para o Dashboard IPTV
 */

let allChannels = []; // Armazenar todos os canais para busca

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
    if (container) container.innerHTML = '';
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

async function updateStats() {
    try {
        const container = document.getElementById('disks-container');
        if (container) showLoadingSpinner(container);
        
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

        // Renderizar discos/SSDs
        if (data.disks && data.disks.length > 0) {
            if (container) hideLoadingSpinner(container);
            if (container) {
                container.innerHTML = '';
                data.disks.forEach(disk => {
                    const pctVal = parseInt(disk.usePercent) || 0;
                    
                    // Cor da barra de progresso baseado no uso
                    let fillClass = 'fill-green';
                    if (pctVal > 90) {
                        fillClass = 'fill-red';
                    } else if (pctVal > 75) {
                        fillClass = 'fill-amber';
                    }
                    
                    container.innerHTML += `
                        <div class="disk-card">
                            <div class="disk-head">
                                <span class="disk-name">Montagem: ${escapeHtml(disk.mounted)}</span>
                                <span class="disk-fs">${escapeHtml(disk.filesystem)}</span>
                            </div>
                            <div class="disk-bar">
                                <div class="disk-bar-fill ${fillClass}" style="transform: scaleX(${(pctVal / 100).toFixed(3)});"></div>
                            </div>
                            <div class="disk-meta">
                                <span>Disponível: <strong>${escapeHtml(disk.avail)}</strong></span>
                                <span class="disk-usage">${pctVal}% usado de ${escapeHtml(disk.size)}</span>
                            </div>
                        </div>
                    `;
                });
            }
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
    const columns = ['id', 'name', 'status', 'uptime'];
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

// Function to load and render channels
async function loadAndRenderChannels(filter = '') {
    try {
        const tbl = document.getElementById('channels-table');
        if (!tbl) return;
        tbl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px"><div class="loading-spinner"></div></td></tr>';

        const res = await apiFetch('/api/channels');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const channels = await res.json();
        if (!Array.isArray(channels)) throw new Error('Resposta inválida');
        let channelList = channels;

        allChannels = channels; // Armazenar todos os canais

        // Aplicar filtro de busca
        if (filter) {
            channelList = channels.filter(channel =>
                (channel.name || '').toLowerCase().includes(filter.toLowerCase()) ||
                channel.id.toString().includes(filter)
            );
        }

        // Aplicar filtro por tipo de conteúdo (+18 / Livre)
        const filterSelect = document.getElementById('filter-select');
        const filterType = filterSelect ? filterSelect.value : 'all';
        if (filterType === '18') {
            channelList = channelList.filter(channel => channel.is18);
        } else if (filterType === 'family') {
            channelList = channelList.filter(channel => !channel.is18);
        }

        // Aplicar filtro por status (online/offline/relay/vod)
        const statusSelect = document.getElementById('status-filter');
        const statusFilter = statusSelect ? statusSelect.value : 'all';
        if (statusFilter !== 'all') {
            channelList = channelList.filter(channel => channel.status === statusFilter);
        }

        // Lógica de ordenação
        channelList.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];

            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        updateSortIcons();

        const hint = document.getElementById('channel-count-hint');
        if (hint) hint.innerText = channelList.length + ' CANAIS';

        const tbl2 = document.getElementById('channels-table');
        if (!tbl2) return;
        tbl2.innerHTML = ''; // Clear existing rows

        if (channelList.length === 0) {
            const message = filter ? 'Nenhum canal encontrado para a busca.' : 'Nenhum canal configurado. Crie um novo!';
            tbl2.innerHTML = `<tr class="empty-row"><td colspan="5">${message}</td></tr>`;
            return;
        }

        channelList.forEach(channel => {
            const row = tbl2.insertRow();
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
            let statusClass = 'status-offline';
            let statusText = 'OFFLINE';
            
            if (channel.status === 'online') {
                statusClass = 'status-live';
                statusText = '● LIVE';
            } else if (channel.status === 'vod') {
                statusClass = 'status-vod';
                statusText = 'VOD';
            } else if (channel.status === 'relay') {
                statusClass = channel.relaySubtype === 'loop' ? 'status-loop' : 'status-relay';
                statusText = channel.relaySubtype === 'loop' 
                    ? "LOOP #" + ((channel.currentUrlIndex || 0) + 1) 
                    : 'RELAY SYNC';
            }
            statusCell.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
            
            const isActive = (channel.status === 'online' || channel.status === 'relay');
            const uptimeCell = row.insertCell();
            uptimeCell.innerHTML = isActive
                ? `<span class="stat-num">${formatUptime(channel.uptime)}</span>`
                : `<span class="stat-muted">-</span>`;
            
            const actionsCell = row.insertCell();
            
            let actionBtns = '';
            
            // Botão Iniciar/Parar
            if (channel.status === 'offline') {
                actionBtns += `<button class="btn-primary btn-icon" data-action="start" data-id="${channel.id}" title="Iniciar">${svgIcon('play')}</button>`;
            } else {
                actionBtns += `<button class="btn-stop btn-icon" data-action="stop" data-id="${channel.id}" title="Parar">${svgIcon('stop')}</button>`;
            }
            
            // Botão Avançar (apenas para Relay Loop)
            if (channel.status === 'relay' && channel.relaySubtype === 'loop') {
                actionBtns += `<button class="btn-edit btn-icon" data-action="advanceRelay" data-id="${channel.id}" title="Próximo Vídeo">${svgIcon('next')}</button>`;
            }
            
            // Botão M3U (Copiar Link M3U do Canal)
            actionBtns += `<button class="btn-cyan btn-icon" data-action="copyChannelM3U" data-id="${channel.id}" title="Copiar Link M3U">${svgIcon('link')}</button>`;

            // Assistir se ativo (Abre Pop-up Modal com Player HLS)
            if (channel.status !== 'offline') {
                actionBtns += `<button class="btn-blue btn-icon" data-action="openPlayerModal" data-id="${channel.id}" data-name="${escapeHtml(channel.name)}" title="Assistir no Pop-up">${svgIcon('play')} ASSISTIR</button>`;
            }
            
            // Ações padrão
            actionBtns += " " +
                `<button class="btn-edit btn-icon" data-action="showEditChannelModal" data-id="${channel.id}" title="Editar">${svgIcon('edit')}</button> ` +
                `<button class="btn-neutral btn-icon" data-action="viewLogs" data-id="${channel.id}" data-name="${escapeHtml(channel.name)}" title="Logs">${svgIcon('logs')}</button> ` +
                `<button class="btn-stop btn-icon" data-action="deleteChannel" data-id="${channel.id}" data-status="${channel.status}" title="Excluir">${svgIcon('trash')}</button>`;
            
            actionsCell.innerHTML = `<div class="action-bar">${actionBtns}</div>`;
        });
    } catch (err) {
        console.error('Erro ao carregar canais:', err);
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
    if (status === 'online') {
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
}

function showEditChannelModal(id) {
    const channel = allChannels.find(c => c.id === id);
    if (!channel) return;
    
    if (channel.status === 'online' || channel.status === 'relay') {
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
    showLoadingSpinner(tbody);
    
    try {
        const res = await apiFetch('/api/login-attempts');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const attempts = await res.json();
        if (!attempts.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma tentativa registrada ainda.</td></tr>';
            return;
        }
        tbody.innerHTML = attempts.map(a => `
            <tr class="${a.success ? '' : 'row-fail'}">
                <td><code>${escapeHtml(a.ip)}</code></td>
                <td>${escapeHtml(a.user)}</td>
                <td>${new Date(a.timestamp).toLocaleString('pt-BR')}</td>
                <td>${a.success ? '<span class="stat-ok">OK</span>' : '<span class="stat-fail">FALHA</span>'}</td>
                     <td>
                    <button class="btn-danger btn-small" data-action="blockIP" data-ip="${escapeHtml(a.ip)}">BLOQUEAR</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Erro ao carregar tentativas.</td></tr>';
    }
}

async function loadBlockedIPs() {
    const tbody = document.getElementById('blocked-ips-table');
    const count = document.getElementById('blocked-count');
    if (!tbody) return;
    showLoadingSpinner(tbody);
    
    try {
        const res = await apiFetch('/api/blocked-ips');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const ips = await res.json();
        count.textContent = ips.length;
        if (!ips.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="2">Nenhum IP bloqueado.</td></tr>';
            return;
        }
        tbody.innerHTML = ips.map(ip => `
            <tr>
                <td><code>${escapeHtml(ip)}</code></td>
                <td>
                    <button class="btn-primary btn-small" data-action="unblockIP" data-ip="${escapeHtml(ip)}">DESBLOQUEAR</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="2">Erro ao carregar IPs bloqueados.</td></tr>';
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

// Atualização automática dos gráficos de hardware
setInterval(updateStats, 5000);
setInterval(() => {
    const input = document.getElementById('search-input');
    loadAndRenderChannels(input ? input.value : '');
}, 10000);
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
    const channel = allChannels.find(c => c.id === id);
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
    if (mode === 'relay') {
        document.getElementById('local-folder-section').style.display = 'none';
        document.getElementById('relay-section').style.display = 'block';
        document.getElementById('transcode-checkbox-container').style.display = 'none';
    } else {
        document.getElementById('local-folder-section').style.display = 'block';
        document.getElementById('relay-section').style.display = 'none';
        document.getElementById('transcode-checkbox-container').style.display = 'block';
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

function openSwitchModeModal(id) {
    const channel = allChannels.find(c => c.id === id);
    if (!channel) return;
    switchModeChannelId = id;
    document.getElementById('switch-mode-channel-name').innerText = "Canal: " + channel.name;
    
    let currentVal = 'offline';
    if (channel.status === 'vod') {
        currentVal = 'vod';
    } else if (channel.status === 'relay') {
        currentVal = channel.relaySubtype === 'sync' ? 'relay-sync' : 'relay-loop';
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

    if (window.Hls && Hls.isSupported()) {
        hlsPlayerInstance = new Hls({
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 5,
            levelLoadingTimeOut: 15000
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

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    // Action buttons
    const btnStartAll = document.getElementById('btn-start-all');
    if (btnStartAll) btnStartAll.addEventListener('click', startAll);

    const btnStopAll = document.getElementById('btn-stop-all');
    if (btnStopAll) btnStopAll.addEventListener('click', stopAll);

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
