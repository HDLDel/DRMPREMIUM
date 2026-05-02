/**
 * Lógica do Frontend para o Dashboard IPTV
 */

async function updateStats() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        document.getElementById('cpu-usage').innerText = `${data.cpu}%`;
        document.getElementById('ram-usage').innerText = `${data.ram}%`;
        document.getElementById('disk-usage').innerText = `${data.disco}%`;
        document.getElementById('net-usage').innerText = `${data.rede} Mbps`;
        document.getElementById('active-streams').innerText = data.activeStreams;
        loadAndRenderChannels(); // Also refresh channels to show status changes
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

// Function to load and render channels
async function loadAndRenderChannels() {
    try {
        const res = await fetch('/api/channels');
        const channels = await res.json();
        const tableBody = document.getElementById('channels-table');
        tableBody.innerHTML = ''; // Clear existing rows

        if (channels.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum canal configurado. Crie um novo!</td></tr>';
            return;
        }

        channels.forEach(channel => {
            const row = tableBody.insertRow();
            row.insertCell().innerText = channel.id;
            row.insertCell().innerText = channel.name;
            
            const statusCell = row.insertCell();
            statusCell.innerHTML = `<span style="color: ${channel.status === 'online' ? '#00ff99' : '#ff4444'}">${channel.status.toUpperCase()}</span>`;
            
            row.insertCell().innerText = channel.status === 'online' ? formatUptime(channel.uptime) : '-';
            const actionsCell = row.insertCell();
            const streamUrl = `/canais/${channel.id}/index.m3u8`;

            if (channel.status === 'offline') {
                actionsCell.innerHTML = `
                    <button onclick="start(${channel.id})" title="Iniciar">▶ Iniciar</button>
                    <button class="btn-delete" onclick="deleteChannel(${channel.id}, '${channel.status}')" title="Excluir">✖ Excluir</button>
                `;
            } else {
                actionsCell.innerHTML = `
                    <button class="stop" onclick="stop(${channel.id})" title="Parar">⏹ Parar</button>
                    <button class="btn-watch" onclick="window.open('${streamUrl}', '_blank')" title="Assistir">▶ Assistir</button>
                    <button class="btn-delete" onclick="deleteChannel(${channel.id}, '${channel.status}')" title="Excluir">✖ Excluir</button>
                `;
            }
        });
    } catch (err) {
        console.error('Erro ao carregar canais:', err);
    }
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

    if (!channelName || !sourceFolderName) {
        alert('Por favor, preencha todos os campos e selecione uma pasta de origem.');
        return;
    }

    try {
        const res = await fetch('/api/createchannel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelName, sourceFolderName })
        });
        const result = await res.json();
        if (result.status === 'success') {
            alert(`Canal "${result.channel.name}" criado com sucesso!`);
            hideCreateChannelModal();
            loadAndRenderChannels(); // Refresh channel list
        } else {
            alert(`Erro ao criar canal: ${result.message}`);
        }
    } catch (err) {
        alert('Falha ao conectar com o servidor para criar canal.');
        console.error('Erro ao criar canal:', err);
    }
}

// Atualização automática dos gráficos de hardware
setInterval(updateStats, 3000);
updateStats();
loadAndRenderChannels(); // Load channels on initial page load