const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    console.log('⚠️ nodemailer не установлен');
    nodemailer = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

const DATA_FILE = path.join(__dirname, 'data.json');

// ===== ПОЧТА =====
const emailUser = process.env.EMAIL_USER || '';
const emailPass = process.env.EMAIL_PASS || '';

let transporter = null;
let emailConfigured = false;

if (nodemailer && emailUser && emailPass && emailPass.length > 3) {
    try {
        transporter = nodemailer.createTransport({
            service: 'yandex',
            auth: { user: emailUser, pass: emailPass }
        });
        transporter.verify(function(error, success) {
            if (error) {
                console.log('⚠️ Ошибка проверки почты:', error.message);
                emailConfigured = false;
            } else {
                console.log(`✅ Почта настроена для: ${emailUser}`);
                emailConfigured = true;
            }
        });
    } catch (e) {
        console.log('⚠️ Ошибка настройки почты:', e.message);
        emailConfigured = false;
    }
}

if (!emailConfigured) {
    console.log('📧 Почта НЕ настроена');
    console.log('📧 КОДЫ БУДУТ ПОКАЗЫВАТЬСЯ В ИНТЕРФЕЙСЕ');
}

// ===== ДАННЫЕ =====
const verificationCodes = {};
const resetCodes = {};

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('⚠️ Ошибка загрузки, создаём новые данные');
    }
    return { users: [], chats: [] };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ===== ОТПРАВКА ПИСЬМА =====
async function sendEmail(to, subject, html, text) {
    if (!emailConfigured || !transporter) {
        const codeMatch = html ? html.match(/(\d{6})/) : null;
        const code = codeMatch ? codeMatch[1] : (text ? text.match(/\b(\d{6})\b/) : null);
        console.log(`📧 [ЛОГ] Код для ${to}: ${code || 'не найден'}`);
        return false;
    }
    try {
        const result = await transporter.sendMail({
            from: emailUser,
            to: to,
            subject: subject,
            html: html,
            text: text
        });
        console.log('✅ Письмо отправлено:', result.messageId);
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки письма:', error.message);
        return false;
    }
}

// ===== API =====

app.post('/api/send-code', async (req, res) => {
    console.log('📨 Запрос на отправку кода:', req.body);
    const { name, email, phone, password } = req.body;
    
    if (!name || !password) {
        return res.status(400).json({ error: 'Заполните имя и пароль' });
    }
    
    const data = loadData();
    
    if (data.users.find(u => u.name === name)) {
        return res.status(400).json({ error: 'Имя уже занято' });
    }
    if (email && data.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Почта уже используется' });
    }
    if (phone && data.users.find(u => u.phone === phone)) {
        return res.status(400).json({ error: 'Телефон уже используется' });
    }
    if (!email && !phone) {
        return res.status(400).json({ error: 'Укажите почту или телефон' });
    }
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const contact = email || phone;
    
    verificationCodes[contact] = {
        code: code,
        expires: Date.now() + 5 * 60 * 1000,
        userData: { name, email, phone, password }
    };
    
    console.log(`📧 КОД ДЛЯ ${contact}: ${code}`);
    
    let emailSent = false;
    if (email && emailConfigured) {
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #17212b; border-radius: 12px; color: #e1e9f0;">
                <h2 style="color: #64b5f6; text-align: center;">Utopia</h2>
                <p style="text-align: center; font-size: 16px;">Ваш код подтверждения:</p>
                <div style="text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 10px; background: #0e1621; padding: 15px; border-radius: 10px; border: 2px dashed #64b5f6; color: #64b5f6; margin: 15px 0;">
                    ${code}
                </div>
                <p style="text-align: center; color: #8e9fb1; font-size: 12px;">Код действителен 5 минут</p>
            </div>
        `;
        const text = `Ваш код подтверждения для Utopia: ${code}\n\nКод действителен 5 минут`;
        emailSent = await sendEmail(email, 'Код подтверждения для Utopia', html, text);
    }
    
    const response = {
        success: true,
        message: '✅ Код создан!',
        contact: contact,
        emailConfigured: emailConfigured,
        code: code
    };
    
    if (emailSent) {
        response.message = '✅ Код отправлен на почту! Проверьте папку "Спам"';
    } else if (email && !emailConfigured) {
        response.message = '✅ Код создан! (почта не настроена, код показан ниже)';
    }
    
    res.json(response);
});

app.post('/api/verify-code', (req, res) => {
    const { contact, code } = req.body;
    console.log('🔍 Проверка кода:', { contact, code });
    
    if (!contact || !code) {
        return res.status(400).json({ error: 'Введите код' });
    }
    
    const record = verificationCodes[contact];
    if (!record) {
        return res.status(400).json({ error: 'Код не найден. Запросите новый.' });
    }
    if (Date.now() > record.expires) {
        delete verificationCodes[contact];
        return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
    }
    if (record.code !== code) {
        return res.status(400).json({ error: 'Неверный код' });
    }
    
    const data = loadData();
    const { name, email, phone, password } = record.userData;
    
    if (data.users.find(u => u.name === name)) {
        delete verificationCodes[contact];
        return res.status(400).json({ error: 'Имя уже занято' });
    }
    
    const user = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name,
        email: email || null,
        phone: phone || null,
        password: password,
        created: Date.now(),
        avatar: null
    };
    
    data.users.push(user);
    saveData(data);
    delete verificationCodes[contact];
    
    console.log(`✅ Пользователь зарегистрирован: ${name}`);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
});

app.post('/api/register', (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !password) {
        return res.status(400).json({ error: 'Заполните имя и пароль' });
    }
    const data = loadData();
    if (data.users.find(u => u.name === name)) {
        return res.status(400).json({ error: 'Имя уже занято' });
    }
    if (email && data.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Почта уже используется' });
    }
    if (phone && data.users.find(u => u.phone === phone)) {
        return res.status(400).json({ error: 'Телефон уже используется' });
    }
    const user = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name,
        email: email || null,
        phone: phone || null,
        password: password,
        created: Date.now(),
        avatar: null
    };
    data.users.push(user);
    saveData(data);
    console.log(`✅ Пользователь зарегистрирован: ${name}`);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
});

app.post('/api/reset-password', async (req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: 'Введите имя и почту' });
    }
    const data = loadData();
    const user = data.users.find(u => u.name === name && u.email === email);
    if (!user) {
        return res.status(400).json({ error: 'Пользователь не найден' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes[email] = {
        code: code,
        expires: Date.now() + 5 * 60 * 1000,
        userId: user.id,
        name: user.name
    };
    console.log(`🔑 Код восстановления для ${email}: ${code}`);
    let emailSent = false;
    if (emailConfigured) {
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #17212b; border-radius: 12px; color: #e1e9f0;">
                <h2 style="color: #64b5f6; text-align: center;">Utopia</h2>
                <p style="text-align: center; font-size: 16px;">Код для восстановления пароля:</p>
                <div style="text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 10px; background: #0e1621; padding: 15px; border-radius: 10px; border: 2px dashed #64b5f6; color: #64b5f6; margin: 15px 0;">
                    ${code}
                </div>
                <p style="text-align: center; color: #8e9fb1; font-size: 12px;">Код действителен 5 минут</p>
            </div>
        `;
        const text = `Код для восстановления пароля Utopia: ${code}\n\nКод действителен 5 минут`;
        emailSent = await sendEmail(email, 'Восстановление пароля Utopia', html, text);
    }
    res.json({ 
        success: true, 
        message: emailSent ? 'Код отправлен на почту' : 'Код создан (письмо не отправлено)',
        code: code
    });
});

app.post('/api/reset-password-verify', (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    const record = resetCodes[email];
    if (!record) {
        return res.status(400).json({ error: 'Код не найден' });
    }
    if (Date.now() > record.expires) {
        delete resetCodes[email];
        return res.status(400).json({ error: 'Код истёк' });
    }
    if (record.code !== code) {
        return res.status(400).json({ error: 'Неверный код' });
    }
    const data = loadData();
    const user = data.users.find(u => u.id === record.userId);
    if (!user) {
        return res.status(400).json({ error: 'Пользователь не найден' });
    }
    user.password = newPassword;
    saveData(data);
    delete resetCodes[email];
    console.log(`✅ Пароль изменён для ${user.name}`);
    res.json({ success: true, message: 'Пароль успешно изменён' });
});

app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    const data = loadData();
    const user = data.users.find(u => u.name === name && u.password === password);
    if (!user) {
        return res.status(400).json({ error: 'Неверное имя или пароль' });
    }
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, avatar: user.avatar } });
});

app.get('/api/users', (req, res) => {
    const data = loadData();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(data.users.map(u => ({ id: u.id, name: u.name, avatar: u.avatar, phone: u.phone })));
});

app.get('/api/chats/:userId', (req, res) => {
    const data = loadData();
    const userId = req.params.userId;
    const userChats = data.chats.filter(c => c.participants && c.participants.includes(userId));
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(userChats);
});

app.get('/api/messages/:chatId', (req, res) => {
    const data = loadData();
    const chat = data.chats.find(c => c.id === req.params.chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(chat.messages || []);
});

app.post('/api/chats', (req, res) => {
    const { name, type, participants, creator, isPrivate, description, avatar } = req.body;
    const data = loadData();
    const chat = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name || 'Чат',
        type: type || 'chat',
        participants: participants || [],
        isPrivate: isPrivate || false,
        created: Date.now(),
        creator: creator || participants?.[0] || 'system',
        description: description || '',
        avatar: avatar || null,
        messages: [],
        pinnedMessages: [],
        inviteCode: null
    };
    data.chats.push(chat);
    saveData(data);
    res.json(chat);
});

app.put('/api/chats/:chatId', (req, res) => {
    const { chatId } = req.params;
    const { name, description, avatar, inviteCode, participants } = req.body;
    const data = loadData();
    const chat = data.chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    if (name) chat.name = name;
    if (description !== undefined) chat.description = description;
    if (avatar !== undefined) chat.avatar = avatar;
    if (inviteCode !== undefined) chat.inviteCode = inviteCode;
    if (participants !== undefined) chat.participants = participants;
    saveData(data);
    res.json(chat);
});

app.post('/api/join-chat', (req, res) => {
    const { inviteCode, userId } = req.body;
    if (!inviteCode || !userId) {
        return res.status(400).json({ error: 'Не указан код или пользователь' });
    }
    const data = loadData();
    const chat = data.chats.find(c => c.inviteCode === inviteCode);
    if (!chat) {
        return res.status(404).json({ error: 'Неверный код приглашения' });
    }
    if (!chat.participants) chat.participants = [];
    if (chat.participants.includes(userId)) {
        return res.status(400).json({ error: 'Вы уже в этом чате' });
    }
    chat.participants.push(userId);
    saveData(data);
    console.log(`✅ Пользователь ${userId} присоединился к чату ${chat.id}`);
    res.json({ success: true, chat: chat });
});

app.post('/api/user/avatar', (req, res) => {
    const { userId, avatar } = req.body;
    const data = loadData();
    const user = data.users.find(u => u.id === userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    user.avatar = avatar;
    saveData(data);
    res.json({ success: true });
});

app.delete('/api/chats/:chatId', (req, res) => {
    const { chatId } = req.params;
    const data = loadData();
    data.chats = data.chats.filter(c => c.id !== chatId);
    saveData(data);
    res.json({ success: true });
});

// ===== WebSocket =====
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📧 Почта: ${emailConfigured ? '✅ настроена' : '❌ не настроена'}`);
    console.log(`🔗 WebSocket доступен по адресу: ws://localhost:${PORT}/ws`);
});

const wss = new WebSocket.Server({ 
    server,
    path: '/ws'
});

const clients = new Map();
const groupCalls = new Map(); // roomId -> { participants: [], offer: null }

wss.on('connection', (ws, req) => {
    let userId = null;
    console.log('🔗 Новое WebSocket подключение');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 WebSocket получено:', data.type);
            
            switch (data.type) {
                case 'auth':
                    userId = data.userId;
                    clients.set(userId, ws);
                    console.log(`✅ Пользователь ${userId} авторизован в WebSocket`);
                    ws.send(JSON.stringify({ type: 'auth_success', userId }));
                    break;
                    
                case 'call_offer':
                    console.log(`📞 Звонок от ${userId} к ${data.targetUserId}, видео: ${data.isVideo}`);
                    
                    // Сохраняем информацию о групповом звонке
                    if (data.roomId) {
                        if (!groupCalls.has(data.roomId)) {
                            groupCalls.set(data.roomId, {
                                participants: [userId, data.targetUserId, ...(data.participants || [])],
                                offer: data.offer,
                                isVideo: data.isVideo
                            });
                        } else {
                            const call = groupCalls.get(data.roomId);
                            if (!call.participants.includes(userId)) {
                                call.participants.push(userId);
                            }
                        }
                    }
                    
                    // Отправляем оффер целевым пользователям
                    const targetWs = clients.get(data.targetUserId);
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify({
                            type: 'call_offer',
                            from: userId,
                            offer: data.offer,
                            isVideo: data.isVideo || false,
                            roomId: data.roomId || null,
                            participants: data.participants || []
                        }));
                        console.log(`📞 Оффер отправлен ${data.targetUserId}`);
                    } else {
                        console.log(`❌ Пользователь ${data.targetUserId} не в сети`);
                        ws.send(JSON.stringify({
                            type: 'call_error',
                            message: 'Пользователь не в сети'
                        }));
                    }
                    
                    // Отправляем уведомление всем участникам группы
                    if (data.participants && data.participants.length > 0) {
                        data.participants.forEach(pid => {
                            if (pid !== data.targetUserId && pid !== userId) {
                                const pWs = clients.get(pid);
                                if (pWs && pWs.readyState === WebSocket.OPEN) {
                                    pWs.send(JSON.stringify({
                                        type: 'call_offer',
                                        from: userId,
                                        offer: data.offer,
                                        isVideo: data.isVideo || false,
                                        roomId: data.roomId || null,
                                        participants: [userId, data.targetUserId]
                                    }));
                                    console.log(`📞 Оффер отправлен участнику ${pid}`);
                                }
                            }
                        });
                    }
                    break;
                    
                case 'call_answer':
                    console.log(`📞 Ответ на звонок от ${userId} к ${data.targetUserId}`);
                    const answerTarget = clients.get(data.targetUserId);
                    if (answerTarget && answerTarget.readyState === WebSocket.OPEN) {
                        answerTarget.send(JSON.stringify({
                            type: 'call_answer',
                            from: userId,
                            answer: data.answer,
                            roomId: data.roomId || null
                        }));
                        console.log(`📞 Ответ отправлен ${data.targetUserId}`);
                    }
                    break;
                    
                case 'ice_candidate':
                    console.log(`🧊 ICE кандидат от ${userId} к ${data.targetUserId}`);
                    const iceTarget = clients.get(data.targetUserId);
                    if (iceTarget && iceTarget.readyState === WebSocket.OPEN) {
                        iceTarget.send(JSON.stringify({
                            type: 'ice_candidate',
                            from: userId,
                            candidate: data.candidate,
                            roomId: data.roomId || null
                        }));
                    }
                    // Отправляем ICE кандидаты всем участникам группы
                    if (data.roomId && groupCalls.has(data.roomId)) {
                        const call = groupCalls.get(data.roomId);
                        call.participants.forEach(pid => {
                            if (pid !== userId) {
                                const pWs = clients.get(pid);
                                if (pWs && pWs.readyState === WebSocket.OPEN) {
                                    pWs.send(JSON.stringify({
                                        type: 'ice_candidate',
                                        from: userId,
                                        candidate: data.candidate,
                                        roomId: data.roomId || null
                                    }));
                                }
                            }
                        });
                    }
                    break;
                    
                case 'call_end':
                    console.log(`📞 Звонок завершён от ${userId} к ${data.targetUserId}`);
                    const endTarget = clients.get(data.targetUserId);
                    if (endTarget && endTarget.readyState === WebSocket.OPEN) {
                        endTarget.send(JSON.stringify({
                            type: 'call_end',
                            from: userId,
                            roomId: data.roomId || null
                        }));
                    }
                    // Удаляем групповой звонок
                    if (data.roomId && groupCalls.has(data.roomId)) {
                        const call = groupCalls.get(data.roomId);
                        call.participants.forEach(pid => {
                            if (pid !== userId && pid !== data.targetUserId) {
                                const pWs = clients.get(pid);
                                if (pWs && pWs.readyState === WebSocket.OPEN) {
                                    pWs.send(JSON.stringify({
                                        type: 'call_end',
                                        from: userId,
                                        roomId: data.roomId || null
                                    }));
                                }
                            }
                        });
                        groupCalls.delete(data.roomId);
                    }
                    break;
                    
                case 'new_message':
                    const fileData = loadData();
                    const chat = fileData.chats.find(c => c.id === data.chatId);
                    if (chat) {
                        const msg = {
                            id: data.msgId || Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
                            sender: data.sender,
                            text: data.text || '',
                            video: data.video || null,
                            file: data.file || null,
                            audio: data.audio || null,
                            isCircle: data.isCircle || false,
                            isSticker: data.isSticker || false,
                            stickerData: data.stickerData || null,
                            isSystem: data.isSystem || false,
                            isBot: data.isBot || false,
                            replyTo: data.replyTo || null,
                            time: Date.now()
                        };
                        
                        const exists = chat.messages.some(m => m.id === msg.id);
                        if (!exists) {
                            chat.messages.push(msg);
                            saveData(fileData);
                        }
                        
                        chat.participants.forEach(pid => {
                            if (pid === data.sender) return;
                            const c = clients.get(pid);
                            if (c && c.readyState === WebSocket.OPEN) {
                                c.send(JSON.stringify({
                                    type: 'new_message',
                                    chatId: data.chatId,
                                    message: msg
                                }));
                            }
                        });
                    }
                    break;
                    
                case 'typing':
                    const typingChat = loadData().chats.find(c => c.id === data.chatId);
                    if (typingChat) {
                        typingChat.participants.forEach(pid => {
                            if (pid !== userId) {
                                const c = clients.get(pid);
                                if (c && c.readyState === WebSocket.OPEN) {
                                    c.send(JSON.stringify({
                                        type: 'typing',
                                        chatId: data.chatId,
                                        userId: userId,
                                        isTyping: data.isTyping
                                    }));
                                }
                            }
                        });
                    }
                    break;
                    
                case 'update_chat':
                    const updateData = loadData();
                    const updateChat = updateData.chats.find(c => c.id === data.chatId);
                    if (updateChat) {
                        if (data.name) updateChat.name = data.name;
                        if (data.description !== undefined) updateChat.description = data.description;
                        if (data.avatar !== undefined) updateChat.avatar = data.avatar;
                        if (data.participants !== undefined) updateChat.participants = data.participants;
                        saveData(updateData);
                        updateChat.participants.forEach(pid => {
                            const c = clients.get(pid);
                            if (c && c.readyState === WebSocket.OPEN) {
                                c.send(JSON.stringify({
                                    type: 'chat_updated',
                                    chatId: data.chatId,
                                    chat: updateChat
                                }));
                            }
                        });
                    }
                    break;
            }
        } catch (e) {
            console.error('WebSocket ошибка:', e);
        }
    });

    ws.on('close', () => {
        console.log(`🔌 WebSocket отключен (${userId || 'неизвестный'})`);
        if (userId) clients.delete(userId);
    });

    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
});
// Добавьте в server.js после остальных API

// Подписка на push-уведомления
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    console.log('📱 Новая подписка на push:', subscription);
    
    // Сохраняем подписку (в реальном проекте сохраняйте в БД)
    // Здесь можно сохранить в файл или базу данных
    
    res.json({ success: true });
});

// Отправка push-уведомления (вызывается при звонке)
app.post('/api/send-push', async (req, res) => {
    const { userId, title, body, from, roomId, isVideo } = req.body;
    
    // Здесь нужно отправить push-уведомление через web-push
    // Это упрощённая версия
    
    res.json({ success: true });
});
