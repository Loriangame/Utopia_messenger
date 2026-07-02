const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Ошибка загрузки, создаём новые данные');
    }
    return { users: [], chats: [] };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// РЕГИСТРАЦИЯ
app.post('/api/register', (req, res) => {
    console.log('📝 Регистрация:', req.body);
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const data = loadData();
    
    // Проверка на существование
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
        created: Date.now()
    };
    
    data.users.push(user);
    saveData(data);
    
    console.log('✅ Пользователь создан:', name);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

// ВХОД
app.post('/api/login', (req, res) => {
    console.log('🔑 Вход:', req.body);
    const { name, password } = req.body;
    const data = loadData();
    
    const user = data.users.find(u => u.name === name && u.password === password);
    if (!user) {
        return res.status(400).json({ error: 'Неверное имя или пароль' });
    }
    
    console.log('✅ Вход выполнен:', user.name);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

// ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
app.get('/api/users', (req, res) => {
    const data = loadData();
    res.json(data.users.map(u => ({ id: u.id, name: u.name })));
});

// ПОЛУЧИТЬ ЧАТЫ ПОЛЬЗОВАТЕЛЯ
app.get('/api/chats/:userId', (req, res) => {
    const data = loadData();
    const userId = req.params.userId;
    const userChats = data.chats.filter(c => c.participants.includes(userId));
    res.json(userChats);
});

// СОЗДАТЬ ЧАТ
app.post('/api/chats', (req, res) => {
    console.log('💬 Создание чата:', req.body);
    const { name, type, participants, creator, isPrivate } = req.body;
    const data = loadData();
    
    const chat = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name,
        type: type || 'chat',
        participants: participants || [],
        isPrivate: isPrivate || false,
        created: Date.now(),
        creator: creator,
        messages: []
    };
    
    data.chats.push(chat);
    saveData(data);
    res.json(chat);
});

// ОТПРАВИТЬ СООБЩЕНИЕ
app.post('/api/messages', (req, res) => {
    console.log('📨 Сообщение:', req.body);
    const { chatId, sender, text, video, file, audio } = req.body;
    const data = loadData();
    
    const chat = data.chats.find(c => c.id === chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    
    const message = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        sender: sender,
        text: text || '',
        video: video || null,
        file: file || null,
        audio: audio || null,
        time: Date.now()
    };
    
    chat.messages.push(message);
    saveData(data);
    res.json(message);
});

// ПОЛУЧИТЬ СООБЩЕНИЯ ЧАТА
app.get('/api/messages/:chatId', (req, res) => {
    const data = loadData();
    const chat = data.chats.find(c => c.id === req.params.chatId);
    if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
    }
    res.json(chat.messages);
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 Данные сохраняются в ${DATA_FILE}`);
});