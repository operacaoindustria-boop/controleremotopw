const express = require('express');
const cors = require('cors');
const { AndroidRemote, RemoteKeyCode, RemoteDirection } = require('androidtv-remote');
const os = require('os');
const path = require('path');

const app = express();
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
        return callback(new Error(`Interface não autorizada para acessar o controle: ${origin}`));
    }
}));
app.use(express.json());

const TV_IP = process.env.TV_IP;
const PORT = 3000;
let remote = null;
let remoteReady = false;
let pairingRequired = false;
let connectionError = null;

async function initRemote() {
    if (!TV_IP) {
        throw new Error("Configure a variável de ambiente TV_IP com o endereço da TV antes de iniciar o servidor.");
    }

    console.log(`\n🔄 A ligar à TV no IP: ${TV_IP}...`);
    
    let options = { name: 'Controle-Web' };
    remote = new AndroidRemote(TV_IP, options);
    
    remote.on('secret', () => {
         pairingRequired = true;
         connectionError = null;
         console.log("\n⚠️ PIN exibido na TV. Digite-o na página aberta pelo celular.");
    });

    remote.on('ready', () => {
         remoteReady = true;
         pairingRequired = false;
         connectionError = null;
         console.log("\n✅ SUCESSO! A TV está emparelhada e pronta para receber comandos!");
    });

    remote.on('unpaired', () => {
         remoteReady = false;
         connectionError = "A TV encerrou o emparelhamento. Reinicie o servidor para emparelhar novamente.";
         console.error("❌ A TV encerrou o emparelhamento. Emparelhe novamente para enviar comandos.");
    });

    remote.on('error', (erro) => {
         remoteReady = false;
         connectionError = erro.message;
         console.error("❌ Erro na conexão com a TV:", erro.message);
    });

    try {
        await remote.start();
    } catch (error) {
        console.error("❌ Erro ao tentar ligar:", error.message);
    }
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
    res.json({ remoteReady, pairingRequired, error: connectionError });
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
        pairingRequired = false;

        if (!accepted) {
            connectionError = "Código incorreto. Confira o PIN na TV e tente novamente.";
            setTimeout(() => {
                if (!remoteReady) {
                    initRemote();
                }
            }, 1000);
            return res.status(400).json({ error: connectionError });
        }

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
        return res.status(502).json({ error: "Falha ao enviar o comando para a TV." });
    }
});

initRemote();

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