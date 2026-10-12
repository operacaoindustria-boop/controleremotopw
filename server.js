const express = require('express');
const cors = require('cors');
const { AndroidRemote, RemoteKeyCode, RemoteDirection } = require('androidtv-remote');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(os.homedir(), '.tcl-remote');
const SAVED_DEVICE_FILE = path.join(DATA_DIR, 'selected-device.json');
const configuredOrigins = new Set(
    (process.env.REMOTE_UI_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

app.use(cors({
    origin(origin, callback) {
        const isLocalDevelopmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
        if (!origin || isLocalDevelopmentOrigin || configuredOrigins.has(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    }
}));
app.use(express.json());

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function getCertificateFile(host) {
    const hostId = crypto.createHash('sha256').update(host).digest('hex').slice(0, 16);
    return path.join(DATA_DIR, `certificate-${hostId}.json`);
}

function loadCertificate(host) {
    const savedCertificate = readJsonFile(getCertificateFile(host));
    if (!savedCertificate) {
        return null;
    }
    if (typeof savedCertificate.key !== 'string' || typeof savedCertificate.cert !== 'string') {
        throw new Error(`O certificado salvo para a TV ${host} está inválido.`);
    }
    return savedCertificate;
}

function saveJsonFile(filePath, value) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
}

function saveCertificate(host, certificate) {
    if (!certificate || typeof certificate.key !== 'string' || typeof certificate.cert !== 'string') {
        throw new Error('A biblioteca não retornou um certificado válido para persistência.');
    }
    saveJsonFile(getCertificateFile(host), certificate);
}

const savedDevice = readJsonFile(SAVED_DEVICE_FILE);
const configuredTvIp = process.env.TV_IP || null;
let tvIp = configuredTvIp || savedDevice?.ip || null;
if (tvIp && net.isIP(tvIp) !== 4) {
    throw new Error('O endereço IPv4 da TV salvo ou configurado é inválido.');
}

let remote = null;
let remoteReady = false;
let pairingRequired = false;
let connectionError = null;
let connectionStatus = tvIp ? 'connecting' : 'selecting';
let reconnectAttempt = 0;
let reconnectTimer = null;
let remoteGeneration = 0;
let reconnectInProgress = false;
let lastScanDevices = new Map();
let scanInProgress = null;
const watchedRemoteSockets = new WeakSet();

function stopCurrentRemote() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    remoteGeneration += 1;
    reconnectInProgress = false;

    const previousRemote = remote;
    remote = null;
    previousRemote?.removeAllListeners();
    if (previousRemote?.pairingManager?.client) {
        previousRemote.pairingManager.client.removeAllListeners('close');
        previousRemote.pairingManager.client.destroy();
    }
    if (previousRemote?.remoteManager?.client) {
        previousRemote.remoteManager.client.removeAllListeners('close');
        previousRemote.remoteManager.stop();
    }
}

function scheduleReconnect(reason) {
    if (!tvIp || !remote || pairingRequired || reconnectTimer || reconnectInProgress) {
        return;
    }

    remoteReady = false;
    connectionStatus = 'reconnecting';
    connectionError = reason || null;
    reconnectAttempt += 1;

    const delay = Math.min(1000 * (2 ** Math.min(reconnectAttempt - 1, 5)), 30000);
    console.warn(`🔄 Reconexão com a TV em ${Math.ceil(delay / 1000)}s (tentativa ${reconnectAttempt}).`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        const generation = remoteGeneration;
        const activeRemote = remote;
        if (!activeRemote || generation !== remoteGeneration || pairingRequired) {
            return;
        }

        reconnectInProgress = true;
        try {
            await activeRemote.start();
        } catch (error) {
            connectionError = error.message;
            console.error('❌ Tentativa de reconexão falhou:', error.message);
        } finally {
            watchRemoteSocket(activeRemote, generation);
            reconnectInProgress = false;
        }

        if (generation === remoteGeneration && !remoteReady && !pairingRequired) {
            scheduleReconnect(connectionError);
        }
    }, delay);
}

function watchRemoteSocket(activeRemote, generation) {
    const socket = activeRemote.remoteManager?.client;
    if (!socket || watchedRemoteSockets.has(socket)) {
        return;
    }
    watchedRemoteSockets.add(socket);

    socket.on('error', (error) => {
        if (generation === remoteGeneration && activeRemote.remoteManager?.client === socket) {
            connectionError = error.message;
        }
    });
    socket.on('close', () => {
        if (generation !== remoteGeneration || activeRemote.remoteManager?.client !== socket) {
            return;
        }
        remoteReady = false;
        if (!pairingRequired) {
            scheduleReconnect(connectionError || 'Conexão perdida. Tentando reconectar automaticamente...');
        }
    });
}

async function initRemote(host, { forgetCertificate = false } = {}) {
    stopCurrentRemote();
    tvIp = host;
    remoteReady = false;
    pairingRequired = false;
    connectionError = null;
    reconnectAttempt = 0;
    connectionStatus = 'connecting';
    let activeRemote;
    let generation;
    try {
        saveJsonFile(SAVED_DEVICE_FILE, { ip: host });
        const certificate = forgetCertificate ? null : loadCertificate(host);
        activeRemote = new AndroidRemote(host, {
            name: 'Controle-Web',
            ...(certificate ? { cert: certificate } : {})
        });
        generation = remoteGeneration;
        remote = activeRemote;
    } catch (error) {
        connectionStatus = 'error';
        connectionError = error.message;
        console.error(`❌ Não foi possível preparar a conexão com ${host}:`, error);
        return;
    }

    console.log(`\n🔄 Conectando à TV em ${host}...`);

    activeRemote.on('secret', () => {
        if (generation !== remoteGeneration) {
            return;
        }
        pairingRequired = true;
        remoteReady = false;
        connectionStatus = 'pairing';
        connectionError = null;
        console.log('⚠️ A TV solicitou o PIN. Digite-o na interface do controle.');
    });

    activeRemote.on('ready', () => {
        if (generation !== remoteGeneration) {
            return;
        }
        watchRemoteSocket(activeRemote, generation);
        let persistenceError = null;
        try {
            saveCertificate(host, activeRemote.getCertificate());
        } catch (error) {
            persistenceError = `Conectado, mas não foi possível salvar a identidade de pareamento: ${error.message}`;
            console.error(`❌ ${persistenceError}`);
        }
        remoteReady = true;
        pairingRequired = false;
        connectionStatus = 'connected';
        connectionError = persistenceError;
        reconnectAttempt = 0;
        reconnectInProgress = false;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        console.log(`✅ TV em ${host} conectada e pronta.`);
    });

    activeRemote.on('unpaired', () => {
        if (generation !== remoteGeneration) {
            return;
        }
        console.warn('⚠️ A conexão com a TV caiu; vou tentar reconectar usando o pareamento salvo.');
        scheduleReconnect('Reconectando automaticamente à TV...');
    });

    activeRemote.on('error', (error) => {
        if (generation !== remoteGeneration) {
            return;
        }
        const message = error?.message
            || (error?.error ? String(error.error) : 'A TV reportou um erro de conexão.');
        console.error('❌ Erro reportado pela TV:', message);
        connectionError = message;
    });

    reconnectInProgress = true;
    try {
        await activeRemote.start();
    } catch (error) {
        if (generation === remoteGeneration) {
            connectionError = error.message;
        }
    } finally {
        watchRemoteSocket(activeRemote, generation);
        reconnectInProgress = false;
    }
    if (generation === remoteGeneration && !remoteReady && !pairingRequired) {
        scheduleReconnect(connectionError);
    }
}

function ipToInteger(ip) {
    return ip.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function integerToIp(value) {
    return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function getLocalSubnetHosts() {
    const hosts = new Set();
    const interfaces = Object.values(os.networkInterfaces()).flat();

    for (const networkInterface of interfaces) {
        if (!networkInterface || networkInterface.internal || !['IPv4', 4].includes(networkInterface.family) || !networkInterface.netmask) {
            continue;
        }

        const address = ipToInteger(networkInterface.address);
        const mask = ipToInteger(networkInterface.netmask);
        const network = (address & mask) >>> 0;
        const broadcast = (network | (~mask >>> 0)) >>> 0;
        const hostCount = broadcast - network - 1;

        if (hostCount < 1 || hostCount > 1022) {
            continue;
        }

        for (let candidate = network + 1; candidate < broadcast; candidate += 1) {
            const ip = integerToIp(candidate);
            if (ip !== networkInterface.address) {
                hosts.add(ip);
            }
        }
    }

    return [...hosts];
}

function probePort(host, port, timeoutMs = 350) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        let settled = false;
        const finish = (isOpen) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(isOpen);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

async function scanForAndroidTvs() {
    const hosts = getLocalSubnetHosts();
    if (hosts.length === 0) {
        throw new Error('Não encontrei uma rede local IPv4 para procurar TVs.');
    }

    const devices = [];
    let nextHost = 0;
    async function scanWorker() {
        while (nextHost < hosts.length) {
            const host = hosts[nextHost];
            nextHost += 1;
            const [pairingPortOpen, remotePortOpen] = await Promise.all([
                probePort(host, 6467),
                probePort(host, 6466)
            ]);
            if (pairingPortOpen || remotePortOpen) {
                devices.push({
                    ip: host,
                    name: `Android TV (${host})`,
                    pairingPortOpen,
                    remotePortOpen
                });
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(hosts.length, 64) }, () => scanWorker()));
    return devices.sort((first, second) => first.ip.localeCompare(second.ip, undefined, { numeric: true }));
}

const keyMap = {
    'Power': RemoteKeyCode.KEYCODE_POWER,
    'Mute': RemoteKeyCode.KEYCODE_VOLUME_MUTE,
    'Up': RemoteKeyCode.KEYCODE_DPAD_UP,
    'Down': RemoteKeyCode.KEYCODE_DPAD_DOWN,
    'Left': RemoteKeyCode.KEYCODE_DPAD_LEFT,
    'Right': RemoteKeyCode.KEYCODE_DPAD_RIGHT,
    'OK/Enter': RemoteKeyCode.KEYCODE_DPAD_CENTER,
    'Home': RemoteKeyCode.KEYCODE_HOME,
    'Back': RemoteKeyCode.KEYCODE_BACK,
    'Menu': RemoteKeyCode.KEYCODE_MENU,
    'Volume Up': RemoteKeyCode.KEYCODE_VOLUME_UP,
    'Volume Down': RemoteKeyCode.KEYCODE_VOLUME_DOWN,
    'Settings': RemoteKeyCode.KEYCODE_SETTINGS,
    'TV/Input': RemoteKeyCode.KEYCODE_TV_INPUT,
    'Source': RemoteKeyCode.KEYCODE_TV_INPUT,
    'Watchlist': RemoteKeyCode.KEYCODE_BOOKMARK,
    'Google Assistant': RemoteKeyCode.KEYCODE_VOICE_ASSIST,
    'Channel Up': RemoteKeyCode.KEYCODE_CHANNEL_UP,
    'Channel Down': RemoteKeyCode.KEYCODE_CHANNEL_DOWN,
    'Layers/Info': RemoteKeyCode.KEYCODE_INFO,
    'Subtitles/Keyboard': RemoteKeyCode.KEYCODE_CAPTIONS,
    'Apps/Dashboard': RemoteKeyCode.KEYCODE_APP_SWITCH
};

const appLinkMap = {
    'Netflix': 'https://www.netflix.com/browse',
    'Prime Video': 'https://www.primevideo.com/',
    'Globoplay': 'https://globoplay.globo.com/',
    'Disney+': 'https://www.disneyplus.com/',
    'YouTube': 'https://www.youtube.com/tv',
    'TCL Channel': 'https://tclchannel.com/'
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', (req, res) => {
    res.json({
        remoteReady,
        pairingRequired,
        tvIp,
        connectionStatus,
        reconnectAttempt,
        error: connectionError
    });
});

app.post('/api/devices/scan', async (req, res) => {
    try {
        if (!scanInProgress) {
            scanInProgress = scanForAndroidTvs().finally(() => {
                scanInProgress = null;
            });
        }
        const devices = await scanInProgress;
        lastScanDevices = new Map(devices.map((device) => [device.ip, device]));
        return res.json({ devices });
    } catch (error) {
        console.error('❌ Erro ao procurar TVs na rede:', error);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/devices/select', (req, res) => {
    const { ip } = req.body || {};
    if (typeof ip !== 'string' || net.isIP(ip) !== 4 || !lastScanDevices.has(ip)) {
        return res.status(400).json({ error: 'Escolha uma TV encontrada na busca da rede.' });
    }

    initRemote(ip);
    return res.status(202).json({ success: true, message: 'Conectando à TV selecionada.' });
});

app.post('/api/reconnect', (req, res) => {
    if (!tvIp) {
        return res.status(409).json({ error: 'Procure e selecione uma TV antes de reconectar.' });
    }
    if (remoteReady) {
        return res.status(409).json({ error: 'A TV já está conectada.' });
    }
    if (pairingRequired) {
        return res.status(409).json({ error: 'A TV está aguardando o código de pareamento.' });
    }

    if (!remote) {
        initRemote(tvIp);
    } else {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempt = 0;
        reconnectInProgress = false;
        scheduleReconnect('Reconexão solicitada.');
    }
    return res.json({ success: true, message: 'Reconexão iniciada.' });
});

app.post('/api/pairing/reset', (req, res) => {
    if (!tvIp) {
        return res.status(409).json({ error: 'Nenhuma TV está selecionada.' });
    }

    try {
        fs.rmSync(getCertificateFile(tvIp), { force: true });
        initRemote(tvIp, { forgetCertificate: true });
        return res.json({ success: true, message: 'Iniciando um novo pareamento com a TV.' });
    } catch (error) {
        console.error('❌ Erro ao iniciar novo pareamento:', error);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/pair-code', (req, res) => {
    const { pin } = req.body || {};

    if (typeof pin !== 'string' || !/^[0-9a-f]{6}$/i.test(pin)) {
        return res.status(400).json({ error: "Digite o código de 6 caracteres exibido na TV." });
    }

    if (!pairingRequired || !remote) {
        return res.status(409).json({ error: "A TV ainda não está solicitando um código." });
    }

    try {
        const accepted = remote.sendCode(pin.toUpperCase());

        if (!accepted) {
            connectionError = "Código incorreto. Confira o PIN na TV e tente novamente.";
            setTimeout(() => {
                if (!remoteReady) {
                    initRemote(tvIp);
                }
            }, 1000);
            return res.status(400).json({ error: connectionError });
        }

        pairingRequired = false;
        connectionStatus = 'connecting';
        connectionError = null;
        console.log("🔐 PIN recebido pela interface do celular.");
        return res.json({ success: true, message: "PIN enviado. Aguardando a conexão com a TV." });
    } catch (error) {
        connectionError = error.message;
        console.error("❌ Erro ao validar o PIN da TV:", error);
        return res.status(502).json({ error: "Não foi possível validar o PIN da TV." });
    }
});

app.post('/send-command', (req, res) => {
    const { keycode } = req.body || {};
    console.log(`👉 Botão premido na página Web: ${keycode}`);

    if (typeof keycode !== 'string' || !keycode.trim()) {
        return res.status(400).json({ error: "Comando inválido ou ausente." });
    }

    if (!remoteReady || !remote) {
        return res.status(503).json({ error: "A TV ainda não está conectada e pronta." });
    }

    const isKeyCommand = Object.prototype.hasOwnProperty.call(keyMap, keycode);
    const isAppLinkCommand = Object.prototype.hasOwnProperty.call(appLinkMap, keycode);

    if (!isKeyCommand && !isAppLinkCommand) {
        return res.status(400).json({ error: `Botão não mapeado: ${keycode}` });
    }

    try {
        if (isAppLinkCommand) {
            remote.sendAppLink(appLinkMap[keycode]);
        } else {
            remote.sendKey(keyMap[keycode], RemoteDirection.SHORT);
        }
        return res.json({ success: true, message: `Enviado: ${keycode}` });
    } catch (error) {
        console.error(`❌ Erro ao enviar "${keycode}" para a TV:`, error);
        remoteReady = false;
        scheduleReconnect(error.message);
        return res.status(502).json({ error: "Falha ao enviar o comando para a TV." });
    }
});

console.log('Iniciando backend do controle remoto...');
if (tvIp) {
    initRemote(tvIp);
} else {
    console.log('📺 Nenhuma TV selecionada. Use a interface para procurar dispositivos na rede.');
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor a correr na porta ${PORT}`);
    const networkInterfaces = Object.values(os.networkInterfaces()).flat();
    const localAddresses = networkInterfaces
        .filter((networkInterface) => networkInterface && networkInterface.family === 'IPv4' && !networkInterface.internal)
        .map((networkInterface) => networkInterface.address);

    if (localAddresses.length > 0) {
        console.log("📱 No celular, conectado à mesma rede Wi-Fi, abra:");
        localAddresses.forEach((address) => console.log(`   http://${address}:${PORT}`));
    } else {
        console.log("⚠️ Não foi possível detectar o IP local. Confira as configurações de rede do PC.");
    }
});