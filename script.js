/**
 * Lógica do Frontend para o Dashboard IPTV
 */

let allChannels = []; // Armazenar todos os canais para busca

async function updateStats() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        document.getElementById('io-usage').innerText = `${data.io}%`;
        document.getElementById('cpu-usage').innerText = `${data.cpu}%`;
        document.getElementById('ram-usage').innerText = `${data.ram}%`;
        document.getElementById('disk-usage').innerText = `${data.disco}%`;
        document.getElementById('net-usage').innerText = `${data.rede} Mbps`;
        document.getElementById('active-streams').innerText = data.activeStreams;

        // Renderizar discos/SSDs
        if (data.disks && data.disks.length > 0) {
            const container = document.getElementById('disks-container');
            if (container) {
                container.innerHTML = '';
                data.disks.forEach(disk => {
                    const pctVal = parseInt(disk.usePercent) || 0;
                    
                    // Cor da barra de progresso baseado no uso
                    let barColor = 'var(--accent)'; // Verde
                    if (pctVal > 90) {
                        barColor = '#ff4444'; // Vermelho
                    } else if (pctVal > 75) {
                        barColor = '#f59e0b'; // Laranja
                    }
                    
                    container.innerHTML += `
                        <div class="disk-card" style="background: #0a0e14; border: 1px solid #30363d; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-weight: bold; color: var(--text); font-size: 1.05rem;">Montagem: ${disk.mounted}</span>
                                <span style="color: #8b949e; font-size: 0.85rem; font-family: monospace;">${disk.filesystem}</span>
                            </div>
                            <div style="background: #1f242c; height: 10px; border-radius: 5px; overflow: hidden; width: 100%;">
                                <div style="background: ${barColor}; width: ${pctVal}%; height: 100%; border-radius: 5px; transition: width 0.5s ease;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                                <span>Disponível: <strong style="color: #00ff99;">${disk.avail}</strong></span>
                                <span style="color: #8b949e;">${pctVal}% usado de ${disk.size}</span>
                            </div>
                        </div>
                    `;
                });
            }
        }
    } catch (err) {
        console.error('Erro ao buscar telemetria:', err);
    }
}

async function logout() {
    try {
        const res = await fetch('/api/logout', {
            method: 'POST'
        });
        if (res.ok) {
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error('Erro ao fazer logout:', err);
    }
}

async function start(id) { 
    try {
        const res = await fetch('/api/start', {
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
        loadAndRenderChannels(document.getElementById('search-input').value);
    } catch (err) {
        alert('Falha ao conectar com o servidor.');
    }
}

async function stop(id) {
    try {
        await fetch('/api/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        updateStats(); // This will also call loadAndRenderChannels
        loadAndRenderChannels(document.getElementById('search-input').value);
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
    loadAndRenderChannels(document.getElementById('search-input').value);
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
        const res = await fetch('/api/channels');
        let channels = await res.json();

        allChannels = channels; // Armazenar todos os canais

        // Aplicar filtro de busca
        if (filter) {
            channels = channels.filter(channel =>
                channel.name.toLowerCase().includes(filter.toLowerCase()) ||
                channel.id.toString().includes(filter)
            );
        }

        // Aplicar filtro por tipo de conteúdo (+18 / Livre)
        const filterSelect = document.getElementById('filter-select');
        const filterType = filterSelect ? filterSelect.value : 'all';
        if (filterType === '18') {
            channels = channels.filter(channel => channel.is18);
        } else if (filterType === 'family') {
            channels = channels.filter(channel => !channel.is18);
        }

        // Lógica de ordenação
        channels.sort((a, b) => {
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

        const tableBody = document.getElementById('channels-table');
        tableBody.innerHTML = ''; // Clear existing rows

        if (channels.length === 0) {
            const message = filter ? 'Nenhum canal encontrado para a busca.' : 'Nenhum canal configurado. Crie um novo!';
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">${message}</td></tr>`;
            return;
        }

        channels.forEach(channel => {
            const row = tableBody.insertRow();
            row.insertCell().innerText = channel.id;
            
            const nameCell = row.insertCell();
            let nameHTML = channel.name;
            if (channel.is18) {
                nameHTML += ` <span style="background:#ff4444; color:white; font-size:0.75em; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:bold; cursor:pointer;" onclick="toggle18(${channel.id})" title="Clique para desmarcar +18">18+ 🔞</span>`;
            } else {
                nameHTML += ` <span style="border:1px solid #6e7681; color:#8b949e; font-size:0.75em; padding:2px 6px; border-radius:4px; margin-left:8px; cursor:pointer;" onclick="toggle18(${channel.id})" title="Clique para marcar como +18">+18?</span>`;
            }
            nameCell.innerHTML = nameHTML;
            
            const statusCell = row.insertCell();
            let statusColor = '#ff4444'; // padrão offline
            if (channel.status === 'online') {
                statusColor = '#00ff99';
            } else if (channel.status === 'vod') {
                statusColor = '#60a5fa';
            }
            statusCell.innerHTML = `<span style="color: ${statusColor}">${channel.status.toUpperCase()}</span>`;
            
            row.insertCell().innerText = channel.status === 'online' ? formatUptime(channel.uptime) : '-';
            const actionsCell = row.insertCell();
            const streamUrl = `/canais/${channel.id}/index.m3u8`;

            if (channel.status === 'offline') {
                actionsCell.innerHTML = `
                    <button onclick="start(${channel.id})" title="Iniciar">▶ Iniciar</button>
                    <button class="btn-edit" onclick="showEditChannelModal(${channel.id})" style="background:#d97706; color:white;" title="Editar">✏️ Editar</button>
                    <button class="btn-logs" onclick="viewLogs(${channel.id}, '${channel.name}')" title="Logs">📝 Logs</button>
                    <button class="btn-delete" onclick="deleteChannel(${channel.id}, '${channel.status}')" title="Excluir">✖ Excluir</button>
                `;
            } else if (channel.status === 'vod') {
                actionsCell.innerHTML = `
                    <button onclick="toggleVod(${channel.id})" style="background:#8b5cf6; color:white;" title="Alternar para Live">🔄 Live</button>
                    <button class="btn-watch" onclick="window.open('${streamUrl}', '_blank')" title="Assistir">▶ Assistir</button>
                    <button class="btn-edit" onclick="showEditChannelModal(${channel.id})" style="background:#d97706; color:white;" title="Editar">✏️ Editar</button>
                    <button class="btn-logs" onclick="viewLogs(${channel.id}, '${channel.name}')" title="Logs">📝 Logs</button>
                    <button class="btn-delete" onclick="deleteChannel(${channel.id}, '${channel.status}')" title="Excluir">✖ Excluir</button>
                `;
            } else { // online
                actionsCell.innerHTML = `
                    <button class="stop" onclick="stop(${channel.id})" title="Parar">⏹ Parar</button>
                    <button onclick="toggleVod(${channel.id})" style="background:#8b5cf6; color:white;" title="Alternar para VOD">🔄 VOD</button>
                    <button class="btn-watch" onclick="window.open('${streamUrl}', '_blank')" title="Assistir">▶ Assistir</button>
                    <button class="btn-edit" onclick="showEditChannelModal(${channel.id})" style="background:#d97706; color:white;" title="Editar">✏️ Editar</button>
                    <button class="btn-logs" onclick="viewLogs(${channel.id}, '${channel.name}')" title="Logs">📝 Logs</button>
                    <button class="btn-delete" onclick="deleteChannel(${channel.id}, '${channel.status}')" title="Excluir">✖ Excluir</button>
                `;
            }
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
        const res = await fetch('/api/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        if (!res.ok) {
            const errorData = await res.json();
            alert(`Erro: ${errorData.message}`);
            return;
        }

        updateStats(); // Isso forçará a atualização da lista de canais
        loadAndRenderChannels(document.getElementById('search-input').value);
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
    
    if (channel.status === 'online') {
        alert('Por favor, PARE o canal antes de tentar editá-lo.');
        return;
    }

    editingChannelId = id;
    document.getElementById('modal-title').innerText = `Editar Canal: ${channel.name}`;
    document.getElementById('modal-submit-btn').innerText = 'Salvar Alterações';
    
    document.getElementById('new-channel-name').value = channel.name;
    document.getElementById('use-transcode').checked = !!channel.useTranscode;
    document.getElementById('new-channel-is18').checked = !!channel.is18;
    
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
    document.getElementById('new-channel-name').value = ''; // Clear input
    document.getElementById('new-channel-is18').checked = false; // Reset checkbox
    document.getElementById('use-transcode').checked = false; // Reset checkbox
    editingChannelId = null;
    
    // Reset manual input states
    isManualSource = false;
    document.getElementById('video-source-select').style.display = 'block';
    document.getElementById('video-source-input').style.display = 'none';
    document.getElementById('video-source-input').value = '';
    document.getElementById('toggle-source-type').innerText = 'Usar caminho absoluto manual';
}

async function loadVideoSourceOptions(selectedValue = "") {
    const select = document.getElementById('video-source-select');
    const input = document.getElementById('video-source-input');
    const toggleLink = document.getElementById('toggle-source-type');
    try {
        const res = await fetch('/api/videosources');
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
    const selectVal = document.getElementById('video-source-select').value;
    const inputVal = document.getElementById('video-source-input').value;
    const sourceFolderName = isManualSource ? inputVal.trim() : selectVal;
    const useTranscode = document.getElementById('use-transcode').checked;
    const is18 = document.getElementById('new-channel-is18').checked;

    if (!channelName || !sourceFolderName) {
        alert('Por favor, preencha todos os campos e selecione ou digite uma pasta de origem.');
        return;
    }

    const payload = { channelName, sourceFolderName, useTranscode, is18 };
    let endpoint = '/api/createchannel';

    if (editingChannelId !== null) {
        payload.id = editingChannelId;
        endpoint = '/api/updatechannel';
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.status === 'success') {
            alert(editingChannelId !== null ? `Canal atualizado com sucesso!` : `Canal "${result.channel.name}" criado com sucesso!`);
            hideCreateChannelModal();
            loadAndRenderChannels(document.getElementById('search-input').value); // Refresh channel list
        } else {
            alert(`Erro: ${result.message}`);
        }
    } catch (err) {
        alert('Falha ao conectar com o servidor.');
        console.error('Erro ao salvar canal:', err);
    }
}

// Função para busca
function handleSearch() {
    const filter = document.getElementById('search-input').value;
    loadAndRenderChannels(filter);
}

// Função para scroll to top
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Event listeners
document.getElementById('search-input').addEventListener('input', handleSearch);

window.addEventListener('scroll', () => {
    const scrollToTopBtn = document.getElementById('scroll-to-top');
    if (window.scrollY > 100) {
        scrollToTopBtn.style.display = 'block';
    } else {
        scrollToTopBtn.style.display = 'none';
    }
});

// Alternar abas
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick*="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
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
    try {
        const res = await fetch('/api/login-attempts');
        const attempts = await res.json();
        if (!attempts.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;">Nenhuma tentativa registrada ainda.</td></tr>';
            return;
        }
        tbody.innerHTML = attempts.map(a => `
            <tr style="${a.success ? '' : 'background:rgba(255,68,68,0.08)'}">
                <td><code>${a.ip}</code></td>
                <td>${a.user}</td>
                <td>${new Date(a.timestamp).toLocaleString('pt-BR')}</td>
                <td>${a.success ? '<span style="color:#00ff99;font-weight:bold;">✅ Sucesso</span>' : '<span style="color:#ff4444;font-weight:bold;">❌ Falha</span>'}</td>
                <td style="font-size:0.8em;color:#8b949e;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${a.userAgent}">${a.userAgent || '-'}</td>
                <td>
                    <button onclick="blockIP('${a.ip}')" style="background:#ef4444;color:white;padding:4px 8px;font-size:0.8em;">🚫 Bloquear</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ff4444;">Erro ao carregar tentativas.</td></tr>';
    }
}

async function loadBlockedIPs() {
    const tbody = document.getElementById('blocked-ips-table');
    const count = document.getElementById('blocked-count');
    try {
        const res = await fetch('/api/blocked-ips');
        const ips = await res.json();
        count.textContent = ips.length;
        if (!ips.length) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#8b949e;">Nenhum IP bloqueado.</td></tr>';
            return;
        }
        tbody.innerHTML = ips.map(ip => `
            <tr>
                <td><code>${ip}</code></td>
                <td>
                    <button onclick="unblockIP('${ip}')" style="background:#10b981;color:white;padding:4px 8px;font-size:0.8em;">🔓 Desbloquear</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#ff4444;">Erro ao carregar IPs bloqueados.</td></tr>';
    }
}

async function loadTopAttackers() {
    const tbody = document.getElementById('top-attackers-table');
    try {
        const res = await fetch('/api/top-attackers');
        const attackers = await res.json();
        if (!attackers.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;">Nenhum dado ainda.</td></tr>';
            return;
        }
        tbody.innerHTML = attackers.map(a => `
            <tr style="${a.fails >= a.total * 0.5 && a.total >= 3 ? 'background:rgba(255,68,68,0.12);' : ''}">
                <td><code>${a.ip}</code></td>
                <td style="font-weight:bold;">${a.total}</td>
                <td style="color:${a.fails > 0 ? '#ff4444' : '#8b949e'};font-weight:bold;">${a.fails}</td>
                <td style="color:#00ff99;">${a.successes}</td>
                <td style="font-size:0.85em;">${new Date(a.lastAttempt).toLocaleString('pt-BR')}</td>
                <td>
                    <button onclick="blockIP('${a.ip}')" style="background:#ef4444;color:white;padding:4px 8px;font-size:0.8em;">🚫 Bloquear</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ff4444;">Erro ao carregar.</td></tr>';
    }
}

async function loadNginxAccess() {
    const tbody = document.getElementById('nginx-access-table');
    try {
        const [accessRes, statsRes] = await Promise.all([
            fetch('/api/nginx-access'),
            fetch('/api/nginx-access/stats')
        ]);
        const accessData = await accessRes.json();
        const statsData = await statsRes.json();

        document.getElementById('access-unique-ips').textContent = statsData.totalIPs;
        document.getElementById('access-total-requests').textContent = statsData.totalRequests;

        if (!accessData.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8b949e;">Nenhum acesso registrado nos últimos 60 minutos.</td></tr>';
            return;
        }

        tbody.innerHTML = accessData.slice(0, 100).map(entry => {
            const channelsStr = entry.channels.slice(0, 5).map(ch =>
                `<span style="display:inline-block;background:#1f242c;padding:2px 6px;border-radius:4px;margin:2px;font-size:0.8em;">#${ch.id} (${ch.hits})</span>`
            ).join('');
            const more = entry.channels.length > 5 ? ` <span style="color:#8b949e;font-size:0.8em;">+${entry.channels.length - 5}</span>` : '';
            return `<tr>
                <td><code>${entry.ip}</code></td>
                <td>${channelsStr}${more}</td>
                <td style="font-weight:bold;">${entry.totalHits}</td>
                <td style="font-size:0.85em;">${new Date(entry.lastSeen).toLocaleString('pt-BR')}</td>
                <td><button onclick="blockIP('${entry.ip}')" style="background:#ef4444;color:white;padding:4px 8px;font-size:0.8em;">🚫 Bloquear</button></td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#ff4444;">Erro ao carregar dados de acesso.</td></tr>';
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
        const res = await fetch('/api/block-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        if (res.ok) {
            loadLoginAttempts();
            loadBlockedIPs();
            loadTopAttackers();
        } else {
            alert('Erro ao bloquear IP');
        }
    } catch (e) {
        alert('Erro ao bloquear IP');
    }
}

async function unblockIP(ip) {
    if (!confirm(`Desbloquear o IP ${ip}?`)) return;
    try {
        const res = await fetch('/api/unblock-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        if (res.ok) {
            loadBlockedIPs();
            loadLoginAttempts();
            loadTopAttackers();
        } else {
            alert('Erro ao desbloquear IP');
        }
    } catch (e) {
        alert('Erro ao desbloquear IP');
    }
}

// Atualização automática dos gráficos de hardware
setInterval(updateStats, 5000);
setInterval(() => loadAndRenderChannels(document.getElementById('search-input').value), 10000);
updateStats();
loadAndRenderChannels(); // Load channels on initial page load

// Alternar status +18 de forma dinâmica por clique
async function toggle18(id) {
    try {
        const res = await fetch('/api/toggle18', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (res.ok) {
            loadAndRenderChannels(document.getElementById('search-input').value);
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
        const res = await fetch('/api/startall', {
            method: 'POST'
        });
        if (res.ok) {
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input').value);
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
        const res = await fetch('/api/stopall', {
            method: 'POST'
        });
        if (res.ok) {
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input').value);
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
        const res = await fetch('/api/toggle-vod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        const data = await res.json();
        if (res.ok && data.status === 'success') {
            alert(`Canal ${id} alternado para modo ${data.mode.toUpperCase()} com sucesso!`);
            updateStats();
            loadAndRenderChannels(document.getElementById('search-input').value);
        } else {
            alert(`Erro: ${data.message || 'Falha ao alternar modo VOD'}`);
        }
    } catch (err) {
        console.error('Erro ao alternar VOD:', err);
        alert('Erro ao tentar alternar o modo VOD.');
    }
}