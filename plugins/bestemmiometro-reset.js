let handler = async (m, { conn, args }) => {
    if (!m.isGroup) {
        await conn.reply(m.chat, '❌ Questo comando funziona solo nei gruppi', m)
        return
    }

    const chat = global.db.data.chats[m.chat]
    
    if (args[0] === 'all') {
        if (chat.users) {
            Object.keys(chat.users).forEach(jid => {
                if (chat.users[jid].bestemmie) {
                    chat.users[jid].bestemmie = 0
                }
            })
        }
        if (global.db.data.bestemmie[m.chat]) {
            delete global.db.data.bestemmie[m.chat]
        }
        await conn.reply(m.chat, '✅ Statistiche gruppo resettate', m)
    } else if (m.mentionedJid && m.mentionedJid[0]) {
        const target = m.mentionedJid[0]
        if (chat.users && chat.users[target]) {
            chat.users[target].bestemmie = 0
        }
        if (global.db.data.bestemmie[m.chat] && global.db.data.bestemmie[m.chat][target]) {
            delete global.db.data.bestemmie[m.chat][target]
        }
        await conn.reply(m.chat, `✅ Statistiche di @${target.split('@')[0]} resettate`, m)
    } else {
        await conn.reply(m.chat, 'Usa:\n• reset all (resetta tutto)\n• reset @user (resetta utente)', m)
    }
}

handler.help = ['reset <all|@user>']
handler.tags = ['owner']
handler.command = /^reset$/i
handler.group = true
handler.owner = true

export default handler
