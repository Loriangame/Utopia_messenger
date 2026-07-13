// service-worker.js
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

// Установка
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Активация
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Обработка fetch
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});

// ======== ПУШ-УВЕДОМЛЕНИЯ ========
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    // Воспроизводим звук через Web Audio API
    const playSound = async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            const response = await cache.match('/zvonok-push.mp3');
            if (response) {
                const audioData = await response.arrayBuffer();
                const audioContext = new (self.AudioContext || self.webkitAudioContext)();
                const source = audioContext.createBufferSource();
                
                audioContext.decodeAudioData(audioData, function(buffer) {
                    source.buffer = buffer;
                    source.connect(audioContext.destination);
                    source.start(0);
                });
            }
        } catch(e) {
            console.error('Ошибка воспроизведения звука:', e);
        }
    };
    
    event.waitUntil(
        Promise.all([
            playSound(),
            self.registration.showNotification('📞 Входящий звонок', {
                body: data.body || 'Вам звонят!',
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                vibrate: [200, 100, 200],
                sound: '/zvonok-push.mp3',
                actions: [
                    { action: 'answer', title: '📞 Ответить' },
                    { action: 'reject', title: '❌ Отклонить' }
                ],
                data: {
                    from: data.from,
                    roomId: data.roomId,
                    isVideo: data.isVideo || false
                }
            })
        ])
    );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    const data = event.notification.data;
    
    if (event.action === 'answer') {
        // Открываем приложение и принимаем звонок
        event.waitUntil(
            clients.openWindow('/').then(() => {
                // Отправляем сообщение в основное приложение
                const message = {
                    type: 'call_accept',
                    from: data.from,
                    roomId: data.roomId,
                    isVideo: data.isVideo || false
                };
                
                // Отправляем всем клиентам
                clients.matchAll().then(clientList => {
                    clientList.forEach(client => {
                        client.postMessage(message);
                    });
                });
            })
        );
    } else if (event.action === 'reject') {
        // Отклоняем звонок
        event.waitUntil(
            clients.matchAll().then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({
                        type: 'call_reject',
                        from: data.from,
                        roomId: data.roomId
                    });
                });
            })
        );
    } else {
        // Просто открываем приложение
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Обработка сообщений от клиента
self.addEventListener('message', function(event) {
    const data = event.data;
    
    if (data.type === 'play_sound') {
        // Воспроизводим звук из Service Worker
        const playSoundFromSW = async () => {
            try {
                const cache = await caches.open(CACHE_NAME);
                const response = await cache.match('/zvonok.mp3');
                if (response) {
                    const audioData = await response.arrayBuffer();
                    const audioContext = new (self.AudioContext || self.webkitAudioContext)();
                    const source = audioContext.createBufferSource();
                    
                    audioContext.decodeAudioData(audioData, function(buffer) {
                        source.buffer = buffer;
                        source.connect(audioContext.destination);
                        source.start(0);
                        // Повторяем звук
                        source.onended = function() {
                            // Звук закончился
                        };
                    });
                }
            } catch(e) {
                console.error('Ошибка воспроизведения звука из SW:', e);
            }
        };
        
        event.waitUntil(playSoundFromSW());
    }
});
