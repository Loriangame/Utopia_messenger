// ======== ЗВУКИ ЗВОНКА И PUSH ========
// Добавьте этот код в конец вашего index.html, перед </script>

// Загрузка звука звонка
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let ringtoneBuffer = null;
let ringtoneSource = null;
let isRingtonePlaying = false;

async function loadRingtone() {
    try {
        const response = await fetch('/zvonok.mp3');
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            ringtoneBuffer = await audioContext.decodeAudioData(arrayBuffer);
            console.log('✅ Звук звонка загружен');
        } else {
            createFallbackRingtone();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки звука звонка:', error);
        createFallbackRingtone();
    }
}

function createFallbackRingtone() {
    try {
        const sampleRate = audioContext.sampleRate;
        const duration = 0.5;
        const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            const t = i / sampleRate;
            data[i] = Math.sin(2 * Math.PI * 440 * t) * 0.5;
        }
        ringtoneBuffer = buffer;
        console.log('✅ Создан синтетический звук звонка');
    } catch (e) {
        console.error('❌ Ошибка создания звука:', e);
    }
}

function playRingtone() {
    if (!ringtoneBuffer) {
        loadRingtone().then(() => {
            if (ringtoneBuffer) playRingtone();
        });
        return;
    }
    
    if (isRingtonePlaying) {
        stopRingtone();
    }
    
    try {
        ringtoneSource = audioContext.createBufferSource();
        ringtoneSource.buffer = ringtoneBuffer;
        ringtoneSource.connect(audioContext.destination);
        ringtoneSource.loop = true;
        ringtoneSource.start(0);
        isRingtonePlaying = true;
        console.log('🔔 Звонок играет');
    } catch (error) {
        console.error('❌ Ошибка воспроизведения звонка:', error);
    }
}

function stopRingtone() {
    if (ringtoneSource) {
        try {
            ringtoneSource.stop();
            ringtoneSource.disconnect();
        } catch (e) {}
        ringtoneSource = null;
    }
    isRingtonePlaying = false;
    console.log('🔕 Звонок остановлен');
}

function playRingtoneInBackground() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'play_sound'
        });
    }
}

// ======== PUSH-УВЕДОМЛЕНИЯ ========
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('❌ Уведомления не поддерживаются');
        return false;
    }
    
    if (Notification.permission === 'granted') {
        return true;
    }
    
    if (Notification.permission === 'denied') {
        console.log('❌ Уведомления запрещены');
        return false;
    }
    
    const permission = await Notification.requestPermission();
    return permission === 'granted';
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('❌ Push не поддерживается');
        return;
    }
    
    try {
        const response = await fetch('/api/vapid-public-key');
        const data = await response.json();
        
        if (!data.publicKey) {
            console.log('❌ VAPID ключ не получен');
            return;
        }
        
        const permission = await requestNotificationPermission();
        if (!permission) return;
        
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(data.publicKey)
        });
        
        console.log('✅ Подписка на push:', subscription);
        
        const subResponse = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });
        
        if (subResponse.ok) {
            console.log('✅ Подписка сохранена на сервере');
        }
        
        return subscription;
    } catch (error) {
        console.error('❌ Ошибка подписки на push:', error);
    }
}

function sendPushNotification(from, roomId, isVideo) {
    if (!('serviceWorker' in navigator)) return;
    
    navigator.serviceWorker.ready.then(registration => {
        registration.showNotification('📞 Входящий звонок', {
            body: `${getUserName(from)} ${isVideo ? '🎥' : '📞'} звонит вам!`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            vibrate: [200, 100, 200, 100, 200],
            sound: '/zvonok-push.mp3',
            actions: [
                { action: 'answer', title: '📞 Ответить' },
                { action: 'reject', title: '❌ Отклонить' }
            ],
            data: {
                from: from,
                roomId: roomId,
                isVideo: isVideo || false
            },
            tag: `call-${roomId}`,
            renotify: true
        });
    });
}

// ======== ПЕРЕОПРЕДЕЛЕНИЕ ФУНКЦИЙ ЗВОНКОВ ========

// Сохраняем оригинальные функции
const _originalShowCallModal = window.showCallModal || function() {};
const _originalEndCall = window.endCall || function() {};

// Переопределяем showCallModal
window.showCallModal = function(data) {
    const userName = getUserName(data.from);
    const isVideo = data.isVideo || false;
    
    state.pendingCallData = data;
    
    // Воспроизводим звук звонка
    playRingtone();
    
    // Отправляем push-уведомление если страница скрыта
    if (document.hidden) {
        sendPushNotification(data.from, data.roomId, isVideo);
        playRingtoneInBackground();
    }
    
    openModal('📞 Входящий звонок', `
        <div style="text-align:center;padding:20px 0;">
            <div style="font-size:64px;margin-bottom:10px;animation:ring 1s ease-in-out infinite;">${isVideo ? '🎥' : '📞'}</div>
            <h3 style="color:#64b5f6;font-size:20px;">${userName}</h3>
            <p style="color:#8e9fb1;font-size:14px;margin-top:4px;">${isVideo ? 'Видеозвонок' : 'Аудиозвонок'}</p>
            <div class="call-modal-buttons">
                <button id="callAcceptBtn" class="accept-call" title="Принять">✅</button>
                <button id="callRejectBtn" class="reject-call" title="Отклонить">❌</button>
            </div>
            <p style="color:#8e9fb1;font-size:11px;margin-top:12px;">Нажмите ✅ чтобы ответить</p>
        </div>
    `);
    
    document.getElementById('callAcceptBtn').addEventListener('click', () => {
        stopRingtone();
        closeModal();
        if (state.pendingCallData) {
            const d = state.pendingCallData;
            answerCall(d.offer, d.from, d.isVideo || false);
            state.pendingCallData = null;
        }
    });
    
    document.getElementById('callRejectBtn').addEventListener('click', () => {
        stopRingtone();
        closeModal();
        if (state.pendingCallData) {
            const d = state.pendingCallData;
            if (wsConnected && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'call_end',
                    targetUserId: d.from,
                    roomId: d.roomId
                }));
            }
            state.pendingCallData = null;
            document.getElementById('callContainer').style.display = 'none';
        }
    });
    
    setTimeout(() => {
        if (state.pendingCallData) {
            stopRingtone();
            closeModal();
            const d = state.pendingCallData;
            if (wsConnected && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'call_end',
                    targetUserId: d.from,
                    roomId: d.roomId
                }));
            }
            state.pendingCallData = null;
            document.getElementById('callContainer').style.display = 'none';
        }
    }, 30000);
};

// Переопределяем endCall
window.endCall = function() {
    stopRingtone();
    if (typeof _originalEndCall === 'function') {
        _originalEndCall();
    }
};

// ======== ОБРАБОТКА СООБЩЕНИЙ ОТ SERVICE WORKER ========
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(event) {
        const data = event.data;
        
        if (data.type === 'call_accept') {
            console.log('📞 Звонок принят из уведомления');
            if (state.pendingCallData && state.pendingCallData.roomId === data.roomId) {
                const d = state.pendingCallData;
                answerCall(d.offer, d.from, d.isVideo || false);
                state.pendingCallData = null;
                stopRingtone();
            }
        } else if (data.type === 'call_reject') {
            console.log('📞 Звонок отклонён из уведомления');
            if (state.pendingCallData && state.pendingCallData.roomId === data.roomId) {
                const d = state.pendingCallData;
                if (wsConnected && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'call_end',
                        targetUserId: d.from,
                        roomId: d.roomId
                    }));
                }
                state.pendingCallData = null;
                document.getElementById('callContainer').style.display = 'none';
                stopRingtone();
            }
        }
    });
}

// ======== ИНИЦИАЛИЗАЦИЯ ========
// Загружаем звук при старте
loadRingtone();

// Запрашиваем разрешение на уведомления
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        requestNotificationPermission();
        if ('serviceWorker' in navigator) {
            subscribeToPush();
        }
    }, 5000);
});

// Обработка видимости страницы
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log('📱 Приложение в фоне');
    } else {
        if (isRingtonePlaying && !state.pendingCallData) {
            stopRingtone();
        }
    }
});
