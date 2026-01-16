process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1';
import './config.js';
import { createRequire } from 'module';
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';
import fs, { readdirSync, statSync, unlinkSync, existsSync, mkdirSync, rmSync, watch } from 'fs';
import yargs from 'yargs';
import { spawn } from 'child_process';
import lodash from 'lodash';
import chalk from 'chalk';
import { tmpdir } from 'os';
import { format } from 'util';
import pino from 'pino';
import { makeWASocket, protoType, serialize } from './lib/simple.js';
import { Low, JSONFile } from 'lowdb';
import NodeCache from 'node-cache';

const DisconnectReason = {
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    loggedOut: 401,
    badSession: 500,
    restartRequired: 515,
    multideviceMismatch: 411,
    forbidden: 403,
    unavailableService: 503
};

const { useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, makeInMemoryStore } = await import('@realvare/based');
const { chain } = lodash;

protoType();
serialize();

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
    return rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString();
};

global.__dirname = function dirname(pathURL) {
    return path.dirname(global.__filename(pathURL, true));
};

global.__require = function require(dir = import.meta.url) {
    return createRequire(dir);
};

global.timestamp = { start: new Date };
const __dirname = global.__dirname(import.meta.url);
global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || '*/!#$%+£¢€¥^°=¶∆×÷π√✓©®&.\\-.@').replace(/[|\\{}()[\]^$+*.\-\^]/g, '\\$&') + ']');

global.db = new Low(new JSONFile('bestemmiometro.json'));
global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
    if (global.db.READ) {
        return new Promise((resolve) => setInterval(async function () {
            if (!global.db.READ) {
                clearInterval(this);
                resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
            }
        }, 1 * 1000));
    }
    if (global.db.data !== null) return;
    global.db.READ = true;
    await global.db.read().catch(console.error);
    global.db.READ = null;
    global.db.data = {
        users: {},
        chats: {},
        bestemmie: {},
        stats: {},
        ...(global.db.data || {}),
    };
    global.db.chain = chain(global.db.data);
};
loadDatabase();

global.authFile = 'bestemmiometro-session';

const { state, saveCreds } = await useMultiFileAuthState(global.authFile);
const msgRetryCounterCache = new NodeCache();
const groupMetadataCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
global.groupCache = groupMetadataCache;

const logger = pino({ level: 'silent' });

global.jidCache = new NodeCache({ stdTTL: 600, useClones: false });
global.store = makeInMemoryStore({ logger });

const connectionOptions = {
    logger: logger,
    browser: Browsers.windows('Chrome'),
    auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    decodeJid: (jid) => {
        if (!jid) return jid;
        const cached = global.jidCache.get(jid);
        if (cached) return cached;
        let decoded = jid;
        if (/:\d+@/gi.test(jid)) {
            decoded = jidNormalizedUser(jid);
        }
        if (typeof decoded === 'object' && decoded.user && decoded.server) {
            decoded = `${decoded.user}@${decoded.server}`;
        }
        if (typeof decoded === 'string' && decoded.endsWith('@lid')) {
            decoded = decoded.replace('@lid', '@s.whatsapp.net');
        }
        global.jidCache.set(jid, decoded);
        return decoded;
    },
    printQRInTerminal: true,
    cachedGroupMetadata: async (jid) => {
        const cached = global.groupCache.get(jid);
        if (cached) return cached;
        try {
            const metadata = await global.conn.groupMetadata(global.conn.decodeJid(jid));
            global.groupCache.set(jid, metadata);
            return metadata;
        } catch (err) {
            return {};
        }
    },
    getMessage: async (key) => {
        try {
            const jid = global.conn.decodeJid(key.remoteJid);
            const msg = await global.store.loadMessage(jid, key.id);
            return msg?.message || undefined;
        } catch (error) {
            return undefined;
        }
    },
    msgRetryCounterCache,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
};

global.conn = makeWASocket(connectionOptions);
global.store.bind(global.conn.ev);

conn.isInit = false;

if (opts['server']) {
    const PORT = process.env.PORT || 3000;
    (await import('./server.js')).default(global.conn, PORT);
}

if (!opts['test']) {
    if (global.db) setInterval(async () => {
        if (global.db.data) await global.db.write();
        if (opts['autocleartmp']) {
            const tmp = [tmpdir(), 'tmp'];
            tmp.forEach(filename => spawn('find', [filename, '-amin', '2', '-type', 'f', '-delete']));
        }
    }, 30 * 1000);
}

async function connectionUpdate(update) {
    const { connection, lastDisconnect, isNewLogin } = update;
    global.stopped = connection;
    if (isNewLogin) conn.isInit = true;
    const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
    
    if (code && code !== DisconnectReason.loggedOut && connection === 'close') {
        await global.reloadHandler(true).catch(console.error);
    }
    
    if (global.db.data == null) loadDatabase();
    
    if (connection === 'open') {
        console.log(chalk.bold.magenta('✅ Bestemmiometro connesso'));
    }
    
    if (connection === 'close') {
        if (code === DisconnectReason.badSession) {
            console.log(chalk.bold.red(`⚠️ Sessione non valida, elimina ${global.authFile}`));
            await global.reloadHandler(true).catch(console.error);
        } else if (code === DisconnectReason.connectionLost) {
            console.log(chalk.bold.blue('🔄 Connessione persa, riconnessione...'));
            await global.reloadHandler(true).catch(console.error);
        } else if (code === DisconnectReason.loggedOut) {
            console.log(chalk.bold.red('⚠️ Disconnesso, elimina la cartella di sessione'));
            if (fs.existsSync(global.authFile)) {
                fs.rmSync(global.authFile, { recursive: true, force: true });
            }
            process.exit(1);
        } else if (code === DisconnectReason.restartRequired) {
            console.log(chalk.bold.magenta('🔄 Riavvio richiesto'));
            await global.reloadHandler(true).catch(console.error);
        } else if (code === DisconnectReason.timedOut) {
            console.log(chalk.bold.yellow('⌛ Timeout, riconnessione...'));
            await global.reloadHandler(true).catch(console.error);
        }
    }
}

process.on('uncaughtException', console.error);

conn.ev.on('connection.update', connectionUpdate);
conn.ev.on('creds.update', saveCreds);

let isInit = true;
let handler = await import('./handler.js');

global.reloadHandler = async function (restatConn) {
    try {
        const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error);
        if (Object.keys(Handler || {}).length) handler = Handler;
    } catch (e) {
        console.error(e);
    }
    if (restatConn) {
        try {
            global.conn.ws.close();
        } catch { }
        conn.ev.removeAllListeners();
        global.conn = makeWASocket(connectionOptions);
        global.store.bind(global.conn.ev);
        isInit = true;
    }
    if (!isInit) {
        conn.ev.off('messages.upsert', conn.handler);
        conn.ev.off('connection.update', conn.connectionUpdate);
        conn.ev.off('creds.update', conn.credsUpdate);
    }
    conn.handler = handler.handler.bind(global.conn);
    conn.connectionUpdate = connectionUpdate.bind(global.conn);
    conn.credsUpdate = saveCreds;
    conn.ev.on('messages.upsert', conn.handler);
    conn.ev.on('connection.update', conn.connectionUpdate);
    conn.ev.on('creds.update', conn.credsUpdate);
    isInit = false;
    return true;
};

const pluginFolder = global.__dirname(join(__dirname, './plugins/index'));
const pluginFilter = (filename) => /\.js$/.test(filename);
global.plugins = {};

async function filesInit() {
    for (const filename of readdirSync(pluginFolder).filter(pluginFilter)) {
        try {
            const file = global.__filename(join(pluginFolder, filename));
            const module = await import(file);
            global.plugins[filename] = module.default || module;
        } catch (e) {
            conn.logger.error(e);
            delete global.plugins[filename];
        }
    }
}

filesInit().then((_) => Object.keys(global.plugins)).catch(console.error);

global.reload = async (_ev, filename) => {
    if (pluginFilter(filename)) {
        const dir = global.__filename(join(pluginFolder, filename), true);
        if (filename in global.plugins) {
            if (existsSync(dir)) conn.logger.info(chalk.green(`✅ '${filename}' aggiornato`));
            else {
                conn.logger.warn(`🗑️ '${filename}' eliminato`);
                return delete global.plugins[filename];
            }
        } else conn.logger.info(`🆕 Nuovo plugin: '${filename}'`);
        
        try {
            const module = (await import(`${global.__filename(dir)}?update=${Date.now()}`));
            global.plugins[filename] = module.default || module;
        } catch (e) {
            conn.logger.error(`⚠️ Errore plugin '${filename}': ${format(e)}`);
        } finally {
            global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)));
        }
    }
};

Object.freeze(global.reload);
const pluginWatcher = watch(pluginFolder, global.reload);
await global.reloadHandler();

async function _quickTest() {
    const test = await Promise.all([
        spawn('ffmpeg'),
        spawn('ffprobe'),
        spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-filter_complex', 'color', '-frames:v', '1', '-f', 'webp', '-']),
        spawn('convert'),
        spawn('magick'),
        spawn('gm'),
        spawn('find', ['--version']),
    ].map((p) => {
        return Promise.race([
            new Promise((resolve) => {
                p.on('close', (code) => {
                    resolve(code !== 127);
                });
            }),
            new Promise((resolve) => {
                p.on('error', (_) => resolve(false));
            })
        ]);
    }));
    const [ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find] = test;
    const s = global.support = { ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find };
    Object.freeze(global.support);
}

function clearDirectory(dirPath) {
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        return;
    }
    const filenames = readdirSync(dirPath);
    filenames.forEach(file => {
        const filePath = join(dirPath, file);
        try {
            const stats = statSync(filePath);
            if (stats.isFile()) {
                unlinkSync(filePath);
            } else if (stats.isDirectory()) {
                rmSync(filePath, { recursive: true, force: true });
            }
        } catch (e) {}
    });
}

function purgeSession(sessionDir) {
    try {
        if (!existsSync(sessionDir)) return;
        const files = readdirSync(sessionDir);
        let deletedCount = 0;
        files.forEach(file => {
            const filePath = path.join(sessionDir, file);
            if (file === 'creds.json') return;
            try {
                const stats = statSync(filePath);
                if (stats.isDirectory()) {
                    rmSync(filePath, { recursive: true, force: true });
                } else {
                    unlinkSync(filePath);
                }
                deletedCount++;
            } catch (err) {}
        });
        if (deletedCount > 0) {
            console.log(chalk.bold.magenta(`♻️ ${deletedCount} file di sessione eliminati`));
        }
    } catch (dirErr) {}
}

setInterval(async () => {
    if (global.stopped === 'close' || !conn || !conn.user) return;
    clearDirectory(join(__dirname, 'tmp'));
    clearDirectory(join(__dirname, 'temp'));
}, 1000 * 60 * 60);

setInterval(async () => {
    if (global.stopped === 'close' || !conn || !conn.user) return;
    purgeSession(`./${global.authFile}`);
}, 1000 * 60 * 60 * 2);

_quickTest().catch(console.error);

let filePath = fileURLToPath(import.meta.url);
const mainWatcher = watch(filePath, async () => {
    console.log(chalk.magenta("File aggiornato, riavvio..."));
    await global.reloadHandler(true).catch(console.error);
});
