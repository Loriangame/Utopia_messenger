/*
 * Utopia Messenger - Service Worker
 * https://github.com/Loriangame/Utopia_messenger
 * Лицензия MIT
 */

const CACHE_NAME = 'utopia-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/logo.png',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.json',
    '/zvonok.mp3',
    '/zvonok-push.mp3'
];

// ======== УСТАНОВКА ========
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('📦 Кэширование файлов...');
            return cache.addAll(STATIC_ASSETS);
        }).catch(err => {
            console.warn('⚠️ Некоторые файлы не закэшированы:', err);
        })
    );
    self.skipWaiting();
});

// ======== АКТИВАЦИЯ ========
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
    console.log('✅ Service Worker активирован');
});

// ======== FETCH (Офлайн-режим) ========
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request).catch(() => {
                return new Response('Вы офлайн', { status: 503 });
            });
        })
    );
});

// ======== ОБРАБОТКА PUSH-УВЕДОМЛЕНИЙ ========
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    console.log('📨 Получено push-уведомление:', data);
    
    const isCall = data.type === 'call';
    const isMessage = data.type === 'message';
    
    let title = 'Utopia';
    let body = 'Новое уведомление';
    let icon = '/icon-192.png';
    let badge = '/icon-192.png';
    let actions = [];
    let dataPayload = {};
    let vibrate = [200, 100, 200];
    let sound = '/zvonok-push.mp3';
    let tag = 'utopia-notification';
    let renotify = false;
    
    if (isCall) {
        const from = data.from || 'неизвестный';
        const isVideo = data.isVideo || false;
        const roomId = data.roomId || 'unknown';
        
        title = `📞 Входящий звонок`;
        body = `${from} ${isVideo ? '🎥' : '📞'} звонит вам!`;
        vibrate = [200, 100, 200, 100, 200, 100, 300, 200, 300];
        tag = `call-${roomId}`;
        renotify = true;
        actions = [
            { action: 'answer', title: '📞 Ответить' },
            { action: 'reject', title: '❌ Отклонить' }
        ];
        dataPayload = {
            type: 'call',
            from: from,
            roomId: roomId,
            isVideo: isVideo
        };
        
        playSound('/zvonok-push.mp3');
        
    } else if (isMessage) {
        const from = data.from || 'неизвестный';
        const chatName = data.chatName || 'Чат';
        const messageText = data.text || 'Новое сообщение';
        const chatId = data.chatId || 'unknown';
        
        title = `💬 ${from} в ${chatName}`;
        body = messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText;
        vibrate = [100, 50, 100];
        tag = `message-${chatId}-${Date.now()}`;
        renotify = true;
        actions = [
            { action: 'open', title: '📨 Открыть чат' },
            { action: 'reply', title: '✏️ Ответить' }
        ];
        dataPayload = {
            type: 'message',
            chatId: chatId,
            from: from,
            text: messageText
        };
    }
    
    event.waitUntil(
        self.registration.showNotification(title, {
            body: body,
            icon: icon,
            badge: badge,
            vibrate: vibrate,
            sound: sound,
            actions: actions,
            data: dataPayload,
            tag: tag,
            renotify: renotify,
            requireInteraction: isCall
        })
    );
});

// ======== ОБРАБОТКА КЛИКА ПО УВЕДОМЛЕНИЮ ========
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    const data = event.notification.data;
    const action = event.action;
    
    console.log('🔔 Клик по уведомлению:', action, data);
    
    if (data.type === 'call') {
        if (action === 'answer') {
            event.waitUntil(
                clients.openWindow('/').then(() => {
                    const message = {
                        type: 'call_accept',
                        from: data.from,
                        roomId: data.roomId,
                        isVideo: data.isVideo || false
                    };
                    
                    clients.matchAll({ type: 'window' }).then(clientList => {
                        clientList.forEach(client => {
                            client.postMessage(message);
                        });
                    });
                    
                    self.registration.showNotification('📞 Соединение...', {
                        body: `Подключение к ${data.from}...`,
                        icon: '/icon-192.png',
                        badge: '/icon-192.png',
                        silent: true
                    });
                })
            );
        } else if (action === 'reject' || action === '') {
            event.waitUntil(
                clients.matchAll({ type: 'window' }).then(clientList => {
                    clientList.forEach(client => {
                        client.postMessage({
                            type: 'call_reject',
                            from: data.from,
                            roomId: data.roomId
                        });
                    });
                })
            );
        }
        return;
    }
    
    if (data.type === 'message') {
        if (action === 'open' || action === '') {
            event.waitUntil(
                clients.openWindow('/').then(() => {
                    clients.matchAll({ type: 'window' }).then(clientList => {
                        clientList.forEach(client => {
                            client.postMessage({
                                type: 'open_chat',
                                chatId: data.chatId
                            });
                        });
                    });
                })
            );
        } else if (action === 'reply') {
            event.waitUntil(
                clients.openWindow('/').then(() => {
                    clients.matchAll({ type: 'window' }).then(clientList => {
                        clientList.forEach(client => {
                            client.postMessage({
                                type: 'reply_to_chat',
                                chatId: data.chatId,
                                replyTo: data.from
                            });
                        });
                    });
                })
            );
        }
        return;
    }
    
    event.waitUntil(
        clients.openWindow('/')
    );
});

// ======== ОБРАБОТКА СООБЩЕНИЙ ОТ КЛИЕНТА ========
self.addEventListener('message', function(event) {
    const data = event.data;
    console.log('📨 Сообщение от клиента:', data);
    
    if (data.type === 'play_sound') {
        playSound('/zvonok.mp3');
    }
    
    if (data.type === 'stop_sound') {
        stopSound();
    }
});

// ======== ВОСПРОИЗВЕДЕНИЕ ЗВУКА ========
let audioContext = null;
let soundSource = null;

function playSound(url) {
    try {
        caches.open(CACHE_NAME).then(cache => {
            cache.match(url).then(response => {
                if (response) {
                    response.arrayBuffer().then(arrayBuffer => {
                        if (!audioContext) {
                            audioContext = new (self.AudioContext || self.webkitAudioContext)();
                        }
                        audioContext.decodeAudioData(arrayBuffer, function(buffer) {
                            if (soundSource) {
                                try { soundSource.stop(); } catch(e) {}
                                soundSource = null;
                            }
                            soundSource = audioContext.createBufferSource();
                            soundSource.buffer = buffer;
                            soundSource.connect(audioContext.destination);
                            soundSource.start(0);
                            console.log('🔔 Звук воспроизводится');
                        });
                    });
                }
            });
        });
    } catch(e) {
        console.error('❌ Ошибка воспроизведения звука:', e);
    }
}

function stopSound() {
    if (soundSource) {
        try {
            soundSource.stop();
            soundSource = null;
            console.log('🔕 Звук остановлен');
        } catch(e) {}
    }
}
