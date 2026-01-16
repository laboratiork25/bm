import { smsg } from './lib/simple.js'
import { format } from 'util'
import { fileURLToPath } from 'url'
import path, { join } from 'path'
import { unwatchFile, watchFile } from 'fs'
import chalk from 'chalk'
import NodeCache from 'node-cache'
import fetch from 'node-fetch'

if (!global.groupCache) {
    global.groupCache = new NodeCache({ stdTTL: 300, useClones: false })
}
if (!global.jidCache) {
    global.jidCache = new NodeCache({ stdTTL: 600, useClones: false })
}
if (!global.nameCache) {
    global.nameCache = new NodeCache({ stdTTL: 600, useClones: false })
}

if (!global.bestemmieSpam) {
    global.bestemmieSpam = {}
}

export const fetchMetadata = async (conn, chatId) => await conn.groupMetadata(chatId)

const fetchGroupMetadataWithRetry = async (conn, chatId, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await conn.groupMetadata(chatId);
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

if (!global.cacheListenersSet) {
    const conn = global.conn
    if (conn) {
        conn.ev.on('groups.update', async (updates) => {
            for (const update of updates) {
                if (!update?.id) continue;
                try {
                    const metadata = await fetchGroupMetadataWithRetry(conn, update.id)
                    if (metadata) {
                        global.groupCache.set(update.id, metadata)
                    }
                } catch (e) {}
            }
        })
        global.cacheListenersSet = true
    }
}

const isNumber = x => typeof x === 'number' && !isNaN(x)
const delay = ms => isNumber(ms) && new Promise(resolve => setTimeout(resolve, ms))

export async function participantsUpdate({ id, participants, action }) {
    if (!global.db?.data?.chats?.[id]) return
    if (global.db.data.chats[id]?.rileva === false) return
    
    try {
        let metadata = global.groupCache.get(id) || await fetchMetadata(this, id)
        if (!metadata) return
        global.groupCache.set(id, metadata)
        
        for (const user of participants) {
            const normalizedUser = this.decodeJid(user)
            let userName = global.nameCache.get(normalizedUser);
            if (!userName) {
                userName = (await this.getName(normalizedUser)) || normalizedUser.split('@')[0] || 'Sconosciuto'
                global.nameCache.set(normalizedUser, userName);
            }
        }
    } catch (e) {
        console.error(`Errore participantsUpdate:`, e)
    }
}

const bestemmieRegex = /(?:porco\s*dio|dio\s*porco|dio\s*bastardo|bastardo\s*dio|dio\s*cane|cane\s*dio|dio\s*boia|boia\s*dio|porco\s*d+io|porca\s*madonna|madonna\s*porca|madonna\s*troia|troia\s*madonna|madonna\s*puttana|puttana\s*madonna|madonna\s*maiala|maiala\s*madonna|madonna\s*vacca|vacca\s*madonna|madonna\s*inculata|dio\s*cristo|cristo\s*dio|gesu\s*cristo|cristo\s*gesu|jesu\s*cristo|cristo\s*jesu|dio\s*maiale|maiale\s*dio|dio\s*merda|merda\s*dio|cristo\s*madonna|madonna\s*impanata|jesu\s*impanato|gesu\s*impanato|jesu\s*porco|gesu\s*porco|dio\s*frocio|frocio\s*dio|dio\s*gay|gay\s*dio|dio\s*infuocato|dio\s*crocifissato|crocifisso\s*dio|maremma\s*maiala|maiala\s*maremma|padre\s*pio|pio\s*padre|madonna\s*serpente|serpente\s*madonna|dio\s*capra|capra\s*dio|dio\s*schifoso|schifoso\s*dio|santiddio|dio\s*ladro|ladro\s*dio|dio\s*assassino|assassino\s*dio|madonna\s*baldracca|baldracca\s*madonna|madonna\s*cagna|cagna\s*madonna|dio\s*zio|zio\s*dio|diomerda|diocristo|diocane|dioporco|madonnacane|cristoddio|gesumaria|madonnamaiala|porcoddue|diosanto|santoddio|madonnadio|diobono|madonna\s*bona|sangue\s*di\s*dio|sangue\s*della\s*madonna|corpo\s*di\s*dio|ostia|porco\s*giuda|giuda\s*porco|madonna\s*santa)/i

const frasiIroniche = [
    "Ok boomer della bestemmia, calmati 🤡",
    "Mamma mia fra, ti serve un terapeuta molla quella tastiera 🧠❌",
    "Vedo gente che ha bisogno di una camomilla 🍵😌",
    "Minchia fra, sei tipo una slot machine di bestemmie 🎰💸",
    "Io boh, qualcuno lo fermi pls 🛑😭",
    "Sto tipo chiamando il prete per un esorcismo 📿👹",
    "E niente, oggi hai scelto la violenza verbale 💣🗣️",
    "Bravo campione, così ti qualifichi per l'inferno speedrun any% 🏃‍♂️🔥",
    "Aspetta che chiamo tua madre, cosi ti sistema muahahha 📱👩",
    "Sei tipo il mio ex: tossico e senza filtri 🚫☠️",
    "Vibe check fallito malissimo bro 📉😬",
    "Angry issues? Sì, next question 💀🎤",
    "Dio can- ah no aspetta, quello l'hai già detto tu 🐕💀",
    "È giornata storta oggi eh? Si vede 📅😤",
    "Tossico più di un lobby di LoL fra 🎮🤢",
    "No brain, only rage 🧠❌ 😡✅",
    "La tua tastiera sta chiedendo asilo politico fra 🗣️⌨️💔",
    "Il tuo autocontrollo è latitante più di mio padre 👨🚬🏃",
    "La tua bocca è tipo una porta senza serratura: sempre aperta 🚪🔓",
    "Calmo fra, non è una gara... o forse sì e stai vincendo 🏆😬",
    "Ma chi ti ha fatto arrabbiare così? Raccontaci fra 🎤😔",
    "Ogni volta che parli, un angelo fa le valigie 👼🧳✈️",
    "Wow, un'altra? Ma tu non ti stanchi mai? 🥱💤",
    "Ma tipo, tutto bene a casa? 🏠❓ Amico se vuoi parlare sonoo sempre online..",
]


function getFraseIronica() {
    return frasiIroniche[Math.floor(Math.random() * frasiIroniche.length)]
}

async function checkBestemmie(conn, m, user, chat, normalizedSender) {
    if (!m.isGroup) return
    if (!chat.bestemmiometro) return
    if (!m.text) return

    if (bestemmieRegex.test(m.text)) {
        const now = Date.now()
        
        if (!global.bestemmieSpam[normalizedSender]) {
            global.bestemmieSpam[normalizedSender] = {
                count: 0,
                timestamps: [],
                blockedUntil: 0
            }
        }

        const userSpam = global.bestemmieSpam[normalizedSender]

        if (now < userSpam.blockedUntil) {
            const remainingTime = Math.ceil((userSpam.blockedUntil - now) / 1000)
            if (userSpam.count === 0) {
                await conn.sendMessage(m.chat, {
                    text: `⏸️ @${normalizedSender.split('@')[0]} sei in timeout per spam di bestemmie!\n\n⏱️ Riprova tra *${remainingTime}* secondi`,
                    mentions: [normalizedSender]
                }, { quoted: m }).catch(e => console.error('Errore invio timeout:', e))
                userSpam.count = 1
            }
            return
        }

        userSpam.timestamps = userSpam.timestamps.filter(t => now - t < 10000)
        userSpam.timestamps.push(now)

        if (userSpam.timestamps.length > 3) {
            userSpam.blockedUntil = now + (3 * 60 * 1000)
            userSpam.count = 0
            
            await conn.sendMessage(m.chat, {
                text: `🚫 @${normalizedSender.split('@')[0]} SPAM RILEVATO!\n\n❌ Hai bestemmiato troppe volte in poco tempo!\n⏱️ Conteggio bloccato per *3 minuti*\n\n🧘 Vai a farti una camomilla!`,
                mentions: [normalizedSender]
            }, { quoted: m }).catch(e => console.error('Errore invio spam:', e))
            return
        }

        user.bestemmie = (user.bestemmie || 0) + 1
        
        if (!chat.users) chat.users = {}
        if (!chat.users[normalizedSender]) chat.users[normalizedSender] = { messages: 0, bestemmie: 0 }
        chat.users[normalizedSender].bestemmie = (chat.users[normalizedSender].bestemmie || 0) + 1
        
        if (!global.db.data.bestemmie[m.chat]) global.db.data.bestemmie[m.chat] = {}
        global.db.data.bestemmie[m.chat][normalizedSender] = {
            count: user.bestemmie,
            lastTime: Date.now()
        }

        const mention = `@${normalizedSender.split('@')[0]} ha tirato *${user.bestemmie}* ${user.bestemmie === 1 ? 'bestemmia' : 'bestemmie'}!\n\n${getFraseIronica()}`
        
        let jpegThumbnail
        try {
            jpegThumbnail = await (await fetch('https://telegra.ph/file/ba01cc1e5bd64ca9d65ef.jpg')).buffer()
        } catch (e) {
            jpegThumbnail = null
        }

        const quoted = {
            key: {
                participants: '0@s.whatsapp.net',
                fromMe: false,
                id: 'Halo'
            },
            message: {
                locationMessage: {
                    name: '𝐁𝐞𝐬𝐭𝐞𝐦𝐦𝐢𝐨𝐦𝐞𝐭𝐫𝐨',
                    jpegThumbnail: jpegThumbnail,
                    vcard: 'BEGIN:VCARD\x0aVERSION:3.0\x0aN:;Bestemmiometro;;;\x0aFN:Bestemmiometro\x0aORG:Bestemmiometro\x0aTITLE:\x0aitem1.TEL;waid=393476686131:+39\x20347\x20668\x206131\x0aitem1.X-ABLabel:Bestemmiometro\x0aX-WA-BIZ-DESCRIPTION:Bot Bestemmiometro\x0aX-WA-BIZ-NAME:Bestemmiometro\x0aEND:VCARD'
                }
            },
            participant: '0@s.whatsapp.net'
        }

        await conn.sendMessage(m.chat, {
            text: mention,
            mentions: [normalizedSender]
        }, { quoted }).catch(e => console.error('Errore invio notifica bestemmie:', e))
    }
}

export async function handler(chatUpdate) {
    this.msgqueque = this.msgqueque || []
    this.uptime = this.uptime || Date.now()
    if (!chatUpdate) return
    
    this.pushMessage(chatUpdate.messages).catch(console.error)
    let m = chatUpdate.messages[chatUpdate.messages.length - 1]
    if (!m) return

    if (m.message?.protocolMessage?.type === 'MESSAGE_EDIT') {
        const key = m.message.protocolMessage.key;
        const editedMessage = m.message.protocolMessage.editedMessage;
        m.key = key;
        m.message = editedMessage;
        m.text = editedMessage.conversation || editedMessage.extendedTextMessage?.text || '';
        m.mtype = Object.keys(editedMessage)[0];
    }

    m = smsg(this, m, global.store)
    if (!m?.key || !m.chat || !m.sender) return
    if (m.fromMe) return
    if (m.key.participant?.includes(':') && m.key.participant.split(':')[1]?.includes('@')) return

    if (m.key) {
        m.key.remoteJid = this.decodeJid(m.key.remoteJid)
        if (m.key.participant) m.key.participant = this.decodeJid(m.key.participant)
    }
    if (!m.key.remoteJid) return

    if (!this.originalGroupParticipantsUpdate) {
        this.originalGroupParticipantsUpdate = this.groupParticipantsUpdate
        this.groupParticipantsUpdate = async function(chatId, users, action) {
            try {
                let metadata = global.groupCache.get(chatId)
                if (!metadata) {
                    metadata = await fetchMetadata(this, chatId)
                    if (metadata) global.groupCache.set(chatId, metadata)
                }
                if (!metadata) {
                    return this.originalGroupParticipantsUpdate.call(this, chatId, users, action)
                }

                const correctedUsers = users.map(userJid => {
                    const decoded = this.decodeJid(userJid)
                    const phone = decoded.split('@')[0].replace(/:\d+$/, '')
                    const participant = metadata.participants.find(p => {
                        const pId = this.decodeJid(p.id)
                        const pPhone = pId.split('@')[0].replace(/:\d+$/, '')
                        return pPhone === phone
                    })
                    return participant ? participant.id : userJid
                })

                return this.originalGroupParticipantsUpdate.call(this, chatId, correctedUsers, action)
            } catch (e) {
                console.error('Errore safeGroupParticipantsUpdate:', e)
                throw e
            }
        }
    }

    let user = null
    let chat = null
    let usedPrefix = null
    let normalizedSender = null
    let normalizedBot = null

    try {
        if (!global.db.data) await global.loadDatabase()
        
        if (!global.db.data.users) global.db.data.users = {}
        if (!global.db.data.chats) global.db.data.chats = {}
        if (!global.db.data.bestemmie) global.db.data.bestemmie = {}
        if (!global.db.data.stats) global.db.data.stats = {}
        if (!global.db.data.settings) global.db.data.settings = {}
        
        m.exp = 0
        m.isCommand = false

        normalizedSender = this.decodeJid(m.sender)
        normalizedBot = this.decodeJid(this.user.jid)
        if (!normalizedSender) return;

        user = global.db.data.users[normalizedSender]
        if (!user) {
            user = global.db.data.users[normalizedSender] = {
                bestemmie: 0,
                name: m.pushName || '?',
                banned: false,
                firstTime: Date.now(),
                messages: 0
            }
        }

        chat = global.db.data.chats[m.chat]
        if (!chat) {
            chat = global.db.data.chats[m.chat] = {
                isBanned: false,
                bestemmiometro: m.isGroup ? true : false,
                bestemmie: 0,
                users: {}
            }
        }

        if (!global.db.data.bestemmie[m.chat]) {
            global.db.data.bestemmie[m.chat] = {}
        }

        let settings = global.db.data.settings[this.user.jid]
        if (!settings) {
            settings = global.db.data.settings[this.user.jid] = {
                autoread: false
            }
        }

        await checkBestemmie(this, m, user, chat, normalizedSender)

        if (m.mtype === 'pollUpdateMessage') return
        if (m.mtype === 'reactionMessage') return

        let groupMetadata = m.isGroup ? global.groupCache.get(m.chat) : null
        let participants = null
        let normalizedParticipants = null
        let isBotAdmin = false
        let isAdmin = false
        let isOwner = global.owner?.some(([num]) => num + '@s.whatsapp.net' === normalizedSender) || false

        if (m.isGroup) {
            if (!groupMetadata) {
                groupMetadata = await fetchGroupMetadataWithRetry(this, m.chat)
                if (groupMetadata) {
                    global.groupCache.set(m.chat, groupMetadata)
                }
            }
            if (groupMetadata) {
                participants = groupMetadata.participants
                normalizedParticipants = participants.map(u => {
                    const normalizedId = this.decodeJid(u.id)
                    return { ...u, id: normalizedId, jid: u.jid || normalizedId }
                })

                const normalizedOwner = groupMetadata.owner ? this.decodeJid(groupMetadata.owner) : null
                isAdmin = participants.some(u => {
                    const participantIds = [
                        this.decodeJid(u.id),
                        u.jid ? this.decodeJid(u.jid) : null,
                        u.lid ? this.decodeJid(u.lid) : null
                    ].filter(Boolean)
                    const isMatch = participantIds.includes(normalizedSender)
                    return isMatch && (u.admin === 'admin' || u.admin === 'superadmin')
                })

                isBotAdmin = participants.some(u => {
                    const participantIds = [
                        this.decodeJid(u.id),
                        u.jid ? this.decodeJid(u.jid) : null,
                        u.lid ? this.decodeJid(u.lid) : null
                    ].filter(Boolean)
                    const isMatch = participantIds.includes(normalizedBot)
                    return isMatch && (u.admin === 'admin' || u.admin === 'superadmin')
                }) || (normalizedBot === normalizedOwner)
            }
        }

        if (m.text && /^[.!#]bestemmiometro$/i.test(m.text.trim())) {
            if (!m.isGroup) {
                await this.reply(m.chat, '❌ Questo comando funziona solo nei gruppi', m)
                return
            }

            if (!chat.bestemmiometro) {
                await this.reply(m.chat, '❌ Bestemmiometro non attivo in questo gruppo', m)
                return
            }

            const chatUsers = chat.users || {}
            const bestemmie = Object.entries(chatUsers)
                .filter(([_, data]) => data.bestemmie > 0)
                .sort(([_, a], [__, b]) => b.bestemmie - a.bestemmie)
                .slice(0, 10)

            if (bestemmie.length === 0) {
                await this.reply(m.chat, '✅ Nessuna bestemmia rilevata in questo gruppo (ancora)', m)
                return
            }

            let text = '*🔥 CLASSIFICA BESTEMMIE 🔥*\n\n'
            let medals = ['🥇', '🥈', '🥉']
            
            for (let i = 0; i < bestemmie.length; i++) {
                const [jid, data] = bestemmie[i]
                const name = await this.getName(jid)
                const medal = medals[i] || `${i + 1}.`
                text += `${medal} @${jid.split('@')[0]} - ${data.bestemmie} bestemmie\n`
            }

            await this.sendMessage(m.chat, {
                text: text,
                mentions: bestemmie.map(([jid]) => jid)
            }, { quoted: m })
            return
        }

        if (m.text && /^[.!#](attiva|disattiva)\s*bestemmiometro$/i.test(m.text.trim())) {
            if (!m.isGroup) {
                await this.reply(m.chat, '❌ Questo comando funziona solo nei gruppi', m)
                return
            }

            if (!isAdmin && !isOwner) {
                await this.reply(m.chat, '🛠️ Solo gli admin possono usare questo comando', m)
                return
            }

            const match = m.text.trim().match(/^[.!#](attiva|disattiva)\s*bestemmiometro$/i)
            const isEnable = match && /attiva/i.test(match[1])
            
            chat.bestemmiometro = isEnable
            
            const statusIcon = chat.bestemmiometro ? '🟢' : '🔴'
            const statusMsg = `${statusIcon} *Bestemmiometro* ${isEnable ? 'attivato' : 'disattivato'}`
            
            await this.reply(m.chat, statusMsg, m)
            return
        }

        if (m.text && /^[.!#]reset(\s+(all|@.+))?$/i.test(m.text.trim())) {
            if (!m.isGroup) {
                await this.reply(m.chat, '❌ Questo comando funziona solo nei gruppi', m)
                return
            }

            if (!isOwner) {
                await this.reply(m.chat, '🛡️ Solo il creatore può usare questo comando', m)
                return
            }

            const args = m.text.trim().split(/\s+/)
            
            if (args[1] === 'all') {
                if (chat.users) {
                    Object.keys(chat.users).forEach(jid => {
                        if (chat.users[jid].bestemmie) {
                            chat.users[jid].bestemmie = 0
                        }
                    })
                }
                Object.keys(global.db.data.users).forEach(jid => {
                    if (global.db.data.users[jid].bestemmie) {
                        global.db.data.users[jid].bestemmie = 0
                    }
                })
                if (global.db.data.bestemmie[m.chat]) {
                    delete global.db.data.bestemmie[m.chat]
                }
                await this.reply(m.chat, '✅ Statistiche gruppo resettate', m)
            } else if (m.mentionedJid && m.mentionedJid[0]) {
                const target = m.mentionedJid[0]
                if (chat.users && chat.users[target]) {
                    chat.users[target].bestemmie = 0
                }
                if (global.db.data.users[target]) {
                    global.db.data.users[target].bestemmie = 0
                }
                if (global.db.data.bestemmie[m.chat] && global.db.data.bestemmie[m.chat][target]) {
                    delete global.db.data.bestemmie[m.chat][target]
                }
                await this.reply(m.chat, `✅ Statistiche di @${target.split('@')[0]} resettate`, m)
            } else {
                await this.reply(m.chat, 'Usa:\n• .reset all (resetta tutto)\n• .reset @user (resetta utente)', m)
            }
            return
        }

        const ___dirname = join(path.dirname(fileURLToPath(import.meta.url)), './plugins/index')
        for (let name in global.plugins) {
            let plugin = global.plugins[name]
            if (!plugin) continue

            const __filename = join(___dirname, name)
            if (typeof plugin.all === 'function') {
                try {
                    await plugin.all.call(this, m, {
                        chatUpdate,
                        __dirname: ___dirname,
                        __filename
                    })
                } catch (e) {
                    console.error('Errore plugin.all:', e)
                }
            }

            const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
            let _prefix = plugin.customPrefix || global.prefix || '.'
            let match = (_prefix instanceof RegExp ? [[_prefix.exec(m.text), _prefix]] :
                Array.isArray(_prefix) ? _prefix.map(p => {
                    let regex = p instanceof RegExp ? p : new RegExp(str2Regex(p));
                    return [regex.exec(m.text), p];
                }) :
                typeof _prefix === 'string' ? [[new RegExp(str2Regex(_prefix)).exec(m.text), _prefix]] :
                [[[], new RegExp]]).find(p => p[1])

            if (typeof plugin.before === 'function') {
                if (await plugin.before.call(this, m, {
                    match,
                    conn: this,
                    participants: normalizedParticipants,
                    groupMetadata,
                    user: { admin: isAdmin ? 'admin' : null },
                    bot: { admin: isBotAdmin ? 'admin' : null },
                    isOwner,
                    isAdmin,
                    isBotAdmin,
                    chatUpdate,
                    __dirname: ___dirname,
                    __filename
                })) continue
            }

            if (typeof plugin !== 'function') continue
            if (!match || !match[0]) continue

            usedPrefix = (match[0] || '')[0]
            if (usedPrefix) {
                let noPrefix = m.text.replace(usedPrefix, '')
                let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
                args = args || []
                let _args = noPrefix.trim().split` `.slice(1)
                let text = _args.join` `
                command = (command || '').toLowerCase()
                let fail = plugin.fail || global.dfail
                let isAccept = plugin.command instanceof RegExp ? plugin.command.test(command) :
                    Array.isArray(plugin.command) ? plugin.command.some(cmd => cmd instanceof RegExp ? cmd.test(command) : cmd === command) :
                    typeof plugin.command === 'string' ? plugin.command === command : false

                if (!isAccept) continue

                if (m.isGroup && (plugin.admin || plugin.botAdmin)) {
                    const freshMetadata = global.groupCache.get(m.chat) || await fetchGroupMetadataWithRetry(this, m.chat)
                    if (freshMetadata) {
                        global.groupCache.set(m.chat, freshMetadata)
                        groupMetadata = freshMetadata
                        participants = groupMetadata.participants
                        normalizedParticipants = participants.map(u => {
                            const normalizedId = this.decodeJid(u.id)
                            return { ...u, id: normalizedId, jid: u.jid || normalizedId }
                        })

                        const normalizedOwner = groupMetadata.owner ? this.decodeJid(groupMetadata.owner) : null
                        isAdmin = participants.some(u => {
                            const participantIds = [
                                this.decodeJid(u.id),
                                u.jid ? this.decodeJid(u.jid) : null,
                                u.lid ? this.decodeJid(u.lid) : null
                            ].filter(Boolean)
                            const isMatch = participantIds.includes(normalizedSender)
                            return isMatch && (u.admin === 'admin' || u.admin === 'superadmin')
                        })

                        isBotAdmin = participants.some(u => {
                            const participantIds = [
                                this.decodeJid(u.id),
                                u.jid ? this.decodeJid(u.jid) : null,
                                u.lid ? this.decodeJid(u.lid) : null
                            ].filter(Boolean)
                            const isMatch = participantIds.includes(normalizedBot)
                            return isMatch && (u.admin === 'admin' || u.admin === 'superadmin')
                        }) || (normalizedBot === normalizedOwner)
                    }
                }

                if (plugin.disabled && !isOwner) {
                    fail('disabled', m, this)
                    continue
                }

                m.plugin = name
                if (chat.isBanned && !isOwner) return
                if (user.banned && !isOwner) {
                    await this.sendMessage(m.chat, {
                        text: `🚫 Sei bannato.\n${user.bannedReason ? `Motivo: ${user.bannedReason}` : ''}`
                    }, { quoted: m })
                    return
                }

                if (plugin.owner && !isOwner) {
                    fail('owner', m, this)
                    continue
                }
                if (plugin.group && !m.isGroup) {
                    fail('group', m, this)
                    continue
                }
                if (plugin.botAdmin && !isBotAdmin) {
                    fail('botAdmin', m, this)
                    continue
                }
                if (plugin.admin && !isAdmin) {
                    fail('admin', m, this)
                    continue
                }
                if (plugin.private && m.isGroup) {
                    fail('private', m, this)
                    continue
                }

                m.isCommand = true
                let xp = 'exp' in plugin ? parseInt(plugin.exp) : 0
                m.exp += xp

                let extra = {
                    match,
                    usedPrefix,
                    noPrefix,
                    _args,
                    args,
                    command,
                    text,
                    conn: this,
                    participants: normalizedParticipants,
                    groupMetadata,
                    user: { admin: isAdmin ? 'admin' : null },
                    bot: { admin: isBotAdmin ? 'admin' : null },
                    isOwner,
                    isAdmin,
                    isBotAdmin,
                    chatUpdate,
                    __dirname: ___dirname,
                    __filename
                }

                try {
                    await plugin.call(this, m, extra)
                } catch (e) {
                    m.error = e
                    console.error(`Errore plugin ${name}:`, e)
                    if (e.message.includes('rate-overlimit')) {
                        await delay(2000)
                    }
                    let text = format(e)
                    await this.reply(m.chat, text, m)
                } finally {
                    if (typeof plugin.after === 'function') {
                        try {
                            await plugin.after.call(this, m, extra)
                        } catch (e) {
                            console.error('Errore plugin.after:', e)
                        }
                    }
                }
                break
            }
        }
    } catch (e) {
        console.error(`Errore handler:`, e)
    } finally {
        if (m && user) {
            user.exp += m.exp || 0
            if (!user.messages) user.messages = 0;
            user.messages++;
            
            if (m.isGroup && chat) {
                if (!chat.users) chat.users = {};
                const senderId = normalizedSender;
                if (!chat.users[senderId]) {
                    chat.users[senderId] = { messages: 0, bestemmie: 0 };
                }
                chat.users[senderId].messages++;
            }

            if (m.plugin) {
                if (!global.db.data.stats) global.db.data.stats = {}
                let stats = global.db.data.stats
                let stat = stats[m.plugin]
                if (!stat) {
                    stat = stats[m.plugin] = {
                        total: 0,
                        success: 0,
                        last: 0,
                        lastSuccess: 0
                    }
                }
                const now = +new Date
                stat.total += 1
                stat.last = now
                if (!m.error) {
                    stat.success += 1
                    stat.lastSuccess = now
                }
            }
        }

        try {
            if (!global.opts['noprint'] && m) await (await import(`./lib/print.js`)).default(m, this)
        } catch (e) {}

        let settingsREAD = global.db.data.settings?.[this.user.jid] || {}
        if ((global.opts['autoread'] || settingsREAD.autoread) && m) {
            await this.readMessages([m.key]).catch(() => {})
        }
    }
}

global.dfail = async (type, m, conn) => {
    const msg = {
        owner: '🛡️ Solo il creatore può usare questo comando',
        group: '👥 Questo comando va usato solo nei gruppi',
        private: '📩 Questo comando va usato solo in privato',
        admin: '🛠️ Solo gli admin possono usare questo comando',
        botAdmin: '🤖 Devo essere admin per eseguire questo comando',
        disabled: '🚫 Questo comando è disabilitato'
    }[type]
    if (msg) {
        conn.reply(m.chat, msg, m)
    }
}

let file = global.__filename(import.meta.url, true)
watchFile(file, async () => { 
    unwatchFile(file)     
    console.log(chalk.magenta("handler.js aggiornato"))
})
