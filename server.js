const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

const DATA_FILE = path.join(__dirname, 'data.json');

// ===== ЗАГРУЗКА/СОХРАНЕНИЕ =====
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

// ===== API =====

// РЕГИСТРАЦИЯ
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    const data = loadData();
    if (data.users.find(u => u.name === name)) {
        return res.status(400).json({ error: 'Имя уже занято' });
    }
    if (data.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Почта уже используется' });
    }
    const user = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name,
        email: email,
        password: password,
        created: Date.now(),
        avatar: null
    };
    data.users.push(user);
    saveData(data);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

// ВХОД
app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    const data = loadData();
    const user = data.users.find(u => u.name === name && u.password === password);
    if (!user) {
        return res.status(400).json({ error: 'Неверное имя или пароль' });
    }
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
});

// ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
app.get('/api/users', (req, res) => {
    const data = loadData();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(data.users.map(u => ({ 
        id: u.id, 
        name: u.name, 
        avatar: u.avatar 
    })));
});

// ПОЛУЧИТЬ ЧАТЫ ПОЛЬЗОВАТЕЛЯ
app.get('/api/chats/:userId', (req, res) => {
    const data = loadData();
    const userId = req.params.userId;
    const userChats = data.chats.filter(c => c.participants && c.participants.includes(userId));
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(userChats);
});

// ПОЛУЧИТЬ СООБЩЕНИЯ ЧАТА
app.get('/api/messages/:chatId', (req, res) => {
    const data = loadData();
    const chat = data.chats.find(c => c.id === req.params.chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(chat.messages || []);
});

// СОЗДАТЬ ЧАТ
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
        pinnedMessages: []
    };
    data.chats.push(chat);
    saveData(data);
    res.json(chat);
});

// ОБНОВИТЬ ЧАТ (АВАТАР, НАЗВАНИЕ, ОПИСАНИЕ)
app.put('/api/chats/:chatId', (req, res) => {
    const { chatId } = req.params;
    const { name, description, avatar } = req.body;
    const data = loadData();
    const chat = data.chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    if (name) chat.name = name;
    if (description !== undefined) chat.description = description;
    if (avatar !== undefined) chat.avatar = avatar;
    saveData(data);
    res.json(chat);
});

// ОБНОВИТЬ АВАТАР ПОЛЬЗОВАТЕЛЯ
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

// УДАЛИТЬ ЧАТ
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
    console.log(`📁 Данные сохраняются в ${DATA_FILE}`);
});

const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on('connection', (ws, req) => {
    console.log('🔗 Новое WebSocket подключение');
    let userId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 WebSocket:', data.type);

            switch (data.type) {
                case 'auth':
                    userId = data.userId;
                    clients.set(userId, ws);
                    console.log(`✅ Пользователь ${userId} авторизован`);
                    ws.send(JSON.stringify({ type: 'auth_success', userId }));
                    break;

                case 'new_message':
                    const fileData = loadData();
                    const chat = fileData.chats.find(c => c.id === data.chatId);
                    if (chat) {
                        const msg = {
                            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
                            sender: data.sender,
                            text: data.text || '',
                            video: data.video || null,
                            file: data.file || null,
                            audio: data.audio || null,
                            isCircle: data.isCircle || false,
                            isSystem: data.isSystem || false,
                            isBot: data.isBot || false,
                            time: Date.now()
                        };
                        chat.messages.push(msg);
                        saveData(fileData);
                        
                        chat.participants.forEach(participantId => {
                            const clientWs = clients.get(participantId);
                            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
                                    type: 'new_message',
                                    chatId: data.chatId,
                                    message: msg
                                }));
                            }
                        });
                    }
                    break;

                case 'typing':
                    const typingData = loadData();
                    const typingChat = typingData.chats.find(c => c.id === data.chatId);
                    if (typingChat) {
                        typingChat.participants.forEach(participantId => {
                            const clientWs = clients.get(participantId);
                            if (clientWs && clientWs.readyState === WebSocket.OPEN && participantId !== userId) {
                                clientWs.send(JSON.stringify({
                                    type: 'typing',
                                    chatId: data.chatId,
                                    userId: userId,
                                    isTyping: data.isTyping
                                }));
                            }
                        });
                    }
                    break;

                case 'delete_message':
                    const deleteData = loadData();
                    const deleteChat = deleteData.chats.find(c => c.id === data.chatId);
                    if (deleteChat) {
                        deleteChat.messages = deleteChat.messages.filter(m => m.id !== data.msgId);
                        if (deleteChat.pinnedMessages) {
                            deleteChat.pinnedMessages = deleteChat.pinnedMessages.filter(id => id !== data.msgId);
                        }
                        saveData(deleteData);
                        deleteChat.participants.forEach(participantId => {
                            const clientWs = clients.get(participantId);
                            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
                                    type: 'message_deleted',
                                    chatId: data.chatId,
                                    msgId: data.msgId
                                }));
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
                        saveData(updateData);
                        updateChat.participants.forEach(participantId => {
                            const clientWs = clients.get(participantId);
                            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
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
