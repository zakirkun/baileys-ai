import makeWASocket, {  makeInMemoryStore, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, delay } from '@adiwajshing/baileys'
import { Boom } from'@hapi/boom'
import pino from 'pino'

const sessions = new Map()

const startSocks = async(id) => {
    const logger = pino({
        level: 'warn'
    })

    const store = makeInMemoryStore({
        logger: logger
    })

    const file_store = `./sessions/store_${id}.json`
    const path = `./sessions/sessions-${id}`

    setInterval(() => {
        store?.writeToFile(file_store)
    }, 1_000)

    const { state, saveCreds } = await useMultiFileAuthState(path)
    const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    const socks = makeWASocket.default({
        version,
        logger,
        printQRInTerminal: true,
		auth: state,
        browser: ['BOT', 'Safari', '1.0.0'],
    })

    store?.bind(socks.ev)

    socks.ev.on('call', item => console.log('recv call event', item))
    socks.ev.on('chats.set', item => console.log(`recv ${item.chats.length} chats (is latest: ${item.isLatest})`))
	socks.ev.on('messages.set', item => console.log(`recv ${item.messages.length} messages (is latest: ${item.isLatest})`))
	socks.ev.on('contacts.set', item => console.log(`recv ${item.contacts.length} contacts`))

    const sendTyping = async (jid) => {
        await socks.presenceSubscribe(jid)
		await delay(500)

		await socks.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await socks.sendPresenceUpdate('paused', jid)
    }

    socks.ev.on('messages.upsert', async m => {
		console.log(JSON.stringify(m, undefined, 2))

		const msg = m.messages[0]
		if(!msg.key.fromMe && m.type === 'notify') {
			console.log('replying to', m.messages[0].key.remoteJid)
			await socks.sendReadReceipt(msg.key.remoteJid, msg.key.participant, [msg.key.id])
			await sendTyping(msg.key.remoteJid)
		}
	})

    socks.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect } = update
		if(connection === 'close') {
			// reconnect if not logged out
			if(new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
				startSocks()
			} else {
				console.log('Connection closed. You are logged out.')
                sessions.delete(id)
			}
		}

        if(connection == 'open') {
            sessions.set(id, {...socks, state})
        }

        if(update.qr){
            console.log("New Qr!")
        }

		console.log('connection update', update)
	})

    // listen for when the auth credentials is updated
    socks.ev.on('creds.update', saveCreds)

    return socks
}

export {
    startSocks,
    sessions
}