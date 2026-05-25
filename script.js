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
            statusCell.innerHTML = `<span style="color: ${channel.status === 'online' ? '#00ff99' : '#ff4444'}">${channel.status.toUpperCase()}</span>`;
            
            row.insertCell().innerText = channel.status === 'online' ? formatUptime(channel.uptime) : '-';
            const actionsCell = row.insertCell();
            const streamUrl = `/canais/${channel.id}/index.m3u8`;

            if (channel.status === 'offline') {
                actionsCell.innerHTML = `
                    <button onclick="start(${channel.id})" title="Iniciar">▶ Iniciar</button>
                    <button class="btn-logs" onclick="viewLogs(${channel.id}, '${channel.name}')" title="Logs">📝 Logs</button>
                    <button class="btn-delete" onclick="deleteChannel(${channel.id}, '${channel.status}')" title="Excluir">✖ Excluir</button>
                `;
            } else {
                actionsCell.innerHTML = `
                    <button class="stop" onclick="stop(${channel.id})" title="Parar">⏹ Parar</button>
                    <button class="btn-watch" onclick="window.open('${streamUrl}', '_blank')" title="Assistir">▶ Assistir</button>
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
function showCreateChannelModal() {
    document.getElementById('create-channel-modal').style.display = 'flex';
    loadVideoSourceOptions();
}

function hideCreateChannelModal() {
    document.getElementById('create-channel-modal').style.display = 'none';
    document.getElementById('new-channel-name').value = ''; // Clear input
    document.getElementById('new-channel-is18').checked = false; // Reset checkbox
}

async function loadVideoSourceOptions() {
    const select = document.getElementById('video-source-select');
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
    } catch (err) {
        console.error('Erro ao carregar pastas de vídeo:', err);
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

async function createChannel() {
    const channelName = document.getElementById('new-channel-name').value;
    const sourceFolderName = document.getElementById('video-source-select').value;
    const useTranscode = document.getElementById('use-transcode').checked;
    const is18 = document.getElementById('new-channel-is18').checked;

    if (!channelName || !sourceFolderName) {
        alert('Por favor, preencha todos os campos e selecione uma pasta de origem.');
        return;
    }

    try {
        const res = await fetch('/api/createchannel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelName, sourceFolderName, useTranscode, is18 })
        });
        const result = await res.json();
        if (result.status === 'success') {
            alert(`Canal "${result.channel.name}" criado com sucesso!`);
            hideCreateChannelModal();
            loadAndRenderChannels(document.getElementById('search-input').value); // Refresh channel list
        } else {
            alert(`Erro ao criar canal: ${result.message}`);
        }
    } catch (err) {
        alert('Falha ao conectar com o servidor para criar canal.');
        console.error('Erro ao criar canal:', err);
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