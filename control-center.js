// ============================================
// CONTROL PANEL MODULE (fully rewritten)
// Firebase-экономная версия
// + Мгновенный индикатор синхронизации
// + Полная синхронизация при включении автосинка
// + Синхронизация lastSyncAt между устройствами
// + Приятные многослойные звуки уведомлений
// + Слайдеры громкости и яркости (iOS-style)
// + Объединенная плашка статуса (Firebase + Время)
// + Надежная проверка статуса сети (online/offline)
// + Открытие настроек приложения через модалку
// ============================================
(function () {
    'use strict';

    // ---------- КОНСТАНТЫ / ДЕФОЛТЫ ----------
    const DEFAULT_SETTINGS = {
        enabled: true,
        systemNotifications: false,
        to: {
            enabled: true,
            warnBeforeKm: 500,
            services: {
                oil:     { enabled: true, intervalKm: 10000, months: 12 },
                trans:   { enabled: true, intervalKm: 60000, months: 48 },
                air:     { enabled: true, intervalKm: 15000, months: 12 },
                cabin:   { enabled: true, intervalKm: 15000, months: 12 },
                plugs:   { enabled: true, intervalKm: 30000, months: 24 },
                brakefl: { enabled: true, intervalKm: 40000, months: 24 },
                coolant: { enabled: true, intervalKm: 60000, months: 36 },
                belt:    { enabled: true, intervalKm: 80000, months: 60 },
                battery: { enabled: true, intervalKm: 60000, months: 48 }
            }
        },
        shift: { enabled: true, remindAtHour: 20, anchor: '', workDays: 3, offDays: 3 },
        fuel:  { enabled: true, risePercent: 15 },
        goals: { enabled: true }
    };

    // Кэш remote-загрузки: не чаще 1 раза в 10 минут
    const REMOTE_FETCH_TTL_MS = 10 * 60 * 1000;
    // Throttle сохранения
    const SAVE_THROTTLE_MS = 3000;
    // Отложенный повтор
    const SAVE_DEFER_MS = 2000;

    // Ключи localStorage для индикатора синхронизации
    const SYNC_FETCH_KEY = 'driverRemindersLastFetch';
    const SYNC_WRITE_KEY = 'driverRemindersLastWrite';
    // Синхронизируемое между устройствами время последней синхронизации аккаунта
    const SYNC_ACCOUNT_KEY = 'driverRemindersLastSyncAccount';
    // Слайдеры
    const BRIGHTNESS_KEY = 'driverBrightness';
    const VOLUME_KEY = 'driverVolume';

    // ---------- СОСТОЯНИЕ ----------
    let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    let dismissed = {};
    let notified = {};
    let hidden = {};
    let activeReminders = [];
    let isDataLoaded = false;

    let remindersUnsubscribe = null;
    let saveTimeout = null;
    let lastSaveTime = 0;
    let lastSavedSnapshot = '';
    let pendingSave = false;
    let audioContext = null;
    let reverbNode = null;
    let initialized = false;

    let uiBrightness = parseInt(localStorage.getItem(BRIGHTNESS_KEY) || '100', 10);
    let notifVolume   = parseInt(localStorage.getItem(VOLUME_KEY)      || '100', 10);
    if (!isFinite(uiBrightness)) uiBrightness = 100;
    if (!isFinite(notifVolume))  notifVolume  = 100;
    uiBrightness = Math.min(100, Math.max(20, uiBrightness));
    notifVolume  = Math.min(100, Math.max(0,  notifVolume));

    let lastNotifVolume = notifVolume > 0 ? notifVolume : 100;

    const notifSettings = {
        sound: localStorage.getItem('notifSound') !== 'false',
        enabled: localStorage.getItem('notifEnabled') !== 'false',
        autoSync: localStorage.getItem('notifAutoSync') !== 'false'
    };

    // ---------- УТИЛИТЫ ----------
    function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
    function localISO(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }
    function parseISO(s) {
        if (!s) return null;
        const p = String(s).split('-');
        if (p.length < 3) return null;
        const d = new Date(+p[0], +p[1] - 1, +p[2]);
        return isNaN(d.getTime()) ? null : d;
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function todayISO() { return localISO(new Date()); }

    function getAllVehicles() {
        try {
            const s = localStorage.getItem('driverVehicles');
            const vehicles = s ? JSON.parse(s) : [];
            return Array.isArray(vehicles) && vehicles.length > 0
                ? vehicles
                : [{ id: 'default', name: 'Основной автомобиль', plate: '' }];
        } catch (e) { return [{ id: 'default', name: 'Основной автомобиль', plate: '' }]; }
    }
    function isAuthenticated() { return document.body.classList.contains('authenticated'); }
    function getRecords() {
        if (typeof records !== 'undefined' && Array.isArray(records)) return records;
        try { const s = localStorage.getItem('driverRecords'); return s ? JSON.parse(s) : []; }
        catch (e) { return []; }
    }
    function getAllFuelLogs() {
        try {
            const s = localStorage.getItem('driverFuelLogs');
            return s ? JSON.parse(s) : (Array.isArray(window.fuelLogs) ? window.fuelLogs : []);
        } catch (e) { return []; }
    }
    function getAllRepairs() {
        try {
            const s = localStorage.getItem('repair_records');
            return s ? JSON.parse(s) : (Array.isArray(window.repairRecords) ? window.repairRecords : []);
        } catch (e) { return []; }
    }

    // ---------- ИНДИКАТОР СИНХРОНИЗАЦИИ ----------
    function getLastSyncTs() {
        const acc = parseInt(localStorage.getItem(SYNC_ACCOUNT_KEY) || '0', 10) || 0;
        if (acc) return acc;
        const f = parseInt(localStorage.getItem(SYNC_FETCH_KEY) || '0', 10) || 0;
        const w = parseInt(localStorage.getItem(SYNC_WRITE_KEY) || '0', 10) || 0;
        return Math.max(f, w);
    }

    function markSynced(accountTs) {
    const now = Date.now();
    try { localStorage.setItem(SYNC_WRITE_KEY, String(now)); } catch (e) {}
    
    // ⭐ Всегда обновляем время аккаунта на текущее, если не передано большее
    const finalTs = (accountTs && accountTs > now) ? accountTs : now;
    try { localStorage.setItem(SYNC_ACCOUNT_KEY, String(finalTs)); } catch (e) {}
    
    pendingSave = false;
    renderUnifiedStatus();
}

    function markDirty() {
        pendingSave = true;
        renderUnifiedStatus();
    }

    function formatAgo(ts) {
        if (!ts) return null;
        const diff = Date.now() - ts;
        if (diff < 60 * 1000) return 'Синхронизировано только что';
        const min = Math.floor(diff / 60000);
        if (min < 60) return 'Синхронизировано ' + min + ' мин назад';
        const hrs = Math.floor(min / 60);
        if (hrs < 24) return 'Синхронизировано ' + hrs + ' ч назад';
        const days = Math.floor(hrs / 24);
        return 'Синхронизировано ' + days + ' дн назад';
    }

    // ---------- ОБЪЕДИНЕННЫЙ СТАТУС ----------
    function renderUnifiedStatus() {
        const wrap = document.getElementById('cc-unified-status');
        const title = document.getElementById('cc-status-title');
        const time = document.getElementById('cc-status-time');
        
        if (!wrap || !title || !time) return;

        wrap.classList.remove('online', 'offline', 'error', 'syncing');
        
        // 1. Если идет синхронизация прямо сейчас
        if (pendingSave) {
            wrap.classList.add('syncing');
            title.textContent = 'Синхронизация...';
            time.textContent = '';
            return;
        }

        // 2. Если нет авторизации
        if (!isAuthenticated()) {
            wrap.classList.add('error');
            title.textContent = 'Локальный режим';
            time.textContent = '';
            return;
        }

        // 3. Если нет интернета
        if (!navigator.onLine || (typeof connectionMode !== 'undefined' && connectionMode === 'offline')) {
            wrap.classList.add('offline');
            title.textContent = 'Офлайн';
            const ts = getLastSyncTs();
            time.textContent = ts ? formatAgo(ts).replace('Синхронизировано ', '') : 'нет данных';
            return;
        }

        // 4. Если ошибка Firebase
        if (typeof connectionMode !== 'undefined' && connectionMode === 'local') {
            wrap.classList.add('offline');
            title.textContent = 'Локальный режим';
            const ts = getLastSyncTs();
            time.textContent = ts ? formatAgo(ts).replace('Синхронизировано ', '') : 'нет данных';
            return;
        }

        // 5. Все хорошо (Firebase подключен)
        wrap.classList.add('online');
        title.textContent = 'Firebase (Подключено)';
        
        const ts = getLastSyncTs();
        if (ts) {
            time.textContent = formatAgo(ts).replace('Синхронизировано ', '');
        } else {
            time.textContent = 'ожидание';
        }
    }

    function showConnectionDetails() {
        let message = '';

        if (!isAuthenticated()) {
            message = '🔒 Не авторизован\n\n' +
                'Войдите в аккаунт для синхронизации данных.\n' +
                'Данные хранятся локально до входа.';
        } else if (!navigator.onLine) {
            message = '📴 Нет интернет-соединения\n\n' +
                '• Проверьте подключение к Wi-Fi или мобильной сети\n' +
                '• Данные сохраняются локально и будут отправлены позже';
        } else if (typeof connectionMode !== 'undefined' && connectionMode === 'firebase') {
            message = '✅ Подключено к Firebase\n\n' +
                '• Данные синхронизируются с облаком\n' +
                '• Доступны с любого устройства\n' +
                '• Пользователь: ' + (typeof currentUser !== 'undefined' && currentUser ? currentUser.email : 'Неизвестно');
        } else if (typeof connectionMode !== 'undefined' && connectionMode === 'local') {
            message = '⚠️ Работа в локальном режиме\n\n' +
                '• Данные сохраняются только в браузере\n' +
                '• Не синхронизируются с облаком\n' +
                '• Доступны только на этом устройстве\n\n' +
                (typeof firebaseErrorReason !== 'undefined' && firebaseErrorReason ? 'Причина: ' + firebaseErrorReason : 'Проверьте подключение к интернету');
        } else {
            message = '⏳ Проверка подключения к Firebase...\n\n' +
                'Пожалуйста, подождите...';
        }

        if (typeof window.showIOSAlert === 'function') {
            window.showIOSAlert(message);
        } else {
            window.alert(message);
        }
    }

    async function checkFirebaseConnection() {
        if (!navigator.onLine) {
            if (typeof connectionMode !== 'undefined') connectionMode = 'offline';
            if (typeof firebaseErrorReason !== 'undefined') firebaseErrorReason = 'Нет интернет-соединения';
            renderUnifiedStatus();
            return;
        }

        try {
            if (typeof firebase === 'undefined') {
                if (typeof connectionMode !== 'undefined') connectionMode = 'local';
                if (typeof firebaseErrorReason !== 'undefined') firebaseErrorReason = 'Firebase SDK не загружен';
                renderUnifiedStatus();
                return;
            }

            if (typeof currentUser === 'undefined' || !currentUser) {
                if (typeof connectionMode !== 'undefined') connectionMode = 'local';
                if (typeof firebaseErrorReason !== 'undefined') firebaseErrorReason = 'Войдите в аккаунт для синхронизации';
                renderUnifiedStatus();
                return;
            }

            await db.collection('users')
                .doc(currentUser.uid)
                .get({ source: 'server' });

            if (typeof connectionMode !== 'undefined') connectionMode = 'firebase';
            if (typeof firebaseErrorReason !== 'undefined') firebaseErrorReason = '';
            renderUnifiedStatus();
            console.log('✅ Firebase доступен (сеть проверена)');

        } catch (error) {
            if (typeof connectionMode !== 'undefined') connectionMode = 'local';

            if (typeof firebaseErrorReason !== 'undefined') {
                if (error.code === 'permission-denied') {
                    firebaseErrorReason = 'Ошибка доступа (проверьте правила Firestore)';
                } else if (error.code === 'unavailable' || !navigator.onLine) {
                    firebaseErrorReason = 'Сервер Firebase недоступен (нет интернета)';
                    if (typeof connectionMode !== 'undefined') connectionMode = 'offline';
                } else {
                    firebaseErrorReason = error.message;
                }
            }

            renderUnifiedStatus();
            console.warn('⚠️ Firebase недоступен:', error.message);
        }
    }

    // ---------- ЯРКОСТЬ И ГРОМКОСТЬ ----------
    function applyBrightness() {
        const pct = uiBrightness;
        const opacity = ((100 - pct) / 100) * 0.75;

        let dimmer = document.getElementById('cc-dim-overlay');
        if (!dimmer) {
            dimmer = document.createElement('div');
            dimmer.id = 'cc-dim-overlay';
            dimmer.className = 'cc-dim-overlay';
            document.body.appendChild(dimmer);
        }

        dimmer.style.opacity = opacity.toFixed(2);
    }

    function updateSliderFill(el) {
        if (!el) return;

        const min = parseFloat(el.min) || 0;
        const max = parseFloat(el.max) || 100;
        const val = parseFloat(el.value) || 0;
        const pct = (val - min) / (max - min);

        const row = el.closest('.cc-slider-row');
        if (!row) return;

        const fill = row.querySelector('.cc-slider-fill');
        if (fill) fill.style.width = (pct * 100) + '%';

        const icon = row.querySelector('.cc-icon-brightness, .cc-icon-volume');
        if (icon) {
            if (val <= min) icon.classList.add('cc-icon-muted');
            else icon.classList.remove('cc-icon-muted');
        }
    }

    function updateVolumeSlider() {
        const el = document.getElementById('cc-volume');
        const val = document.getElementById('cc-volume-value');
        if (el) { el.value = String(notifVolume); updateSliderFill(el); }
        if (val) val.textContent = notifVolume + '%';
    }

    function updateBrightnessSlider() {
        const el = document.getElementById('cc-brightness');
        const val = document.getElementById('cc-brightness-value');
        if (el) { el.value = String(uiBrightness); updateSliderFill(el); }
        if (val) val.textContent = uiBrightness + '%';
    }

    // ---------- ЛОКАЛЬНОЕ ХРАНЕНИЕ ----------
    function loadFromLocal() {
        try {
            settings = JSON.parse(localStorage.getItem('driverRemindersSettings') || 'null') || clone(DEFAULT_SETTINGS);
        } catch (e) {
            settings = clone(DEFAULT_SETTINGS);
        }
        settings.to = settings.to || {};
        settings.to.services = { ...DEFAULT_SETTINGS.to.services, ...(settings.to.services || {}) };
        settings.to = { ...DEFAULT_SETTINGS.to, ...settings.to };
        settings.shift = { ...DEFAULT_SETTINGS.shift, ...(settings.shift || {}) };
        settings.fuel  = { ...DEFAULT_SETTINGS.fuel,  ...(settings.fuel  || {}) };
        settings.goals = { ...DEFAULT_SETTINGS.goals, ...(settings.goals || {}) };

        try { dismissed = JSON.parse(localStorage.getItem('driverRemindersDismissed') || '{}') || {}; } catch (e) { dismissed = {}; }
        try { notified = JSON.parse(localStorage.getItem('driverRemindersNotified') || '{}') || {}; } catch (e) { notified = {}; }
        try { hidden = JSON.parse(localStorage.getItem('driverRemindersHidden') || '{}') || {}; } catch (e) { hidden = {}; }
    }

    function persistLocal() {
        try { localStorage.setItem('driverRemindersSettings',  JSON.stringify(settings));  } catch (e) {}
        try { localStorage.setItem('driverRemindersDismissed', JSON.stringify(dismissed)); } catch (e) {}
        try { localStorage.setItem('driverRemindersNotified',  JSON.stringify(notified));  } catch (e) {}
        try { localStorage.setItem('driverRemindersHidden',    JSON.stringify(hidden));    } catch (e) {}
    }

    function persistNotifiedOnly() {
        try { localStorage.setItem('driverRemindersNotified', JSON.stringify(notified)); } catch (e) {}
    }

    // ---------- FIREBASE ----------
    function getRemindersDocRef() {
        if (typeof currentUser === 'undefined' || !currentUser) return null;
        if (typeof db === 'undefined' || !db) return null;
        try {
            return db.collection('users').doc(currentUser.uid)
                .collection('reminders').doc('config');
        } catch (e) { return null; }
    }

    function snapshotKey() {
        return JSON.stringify({ settings, dismissed, hidden });
    }

    async function saveRemindersData(force) {
        const now = Date.now();
        if (!force && now - lastSaveTime < SAVE_THROTTLE_MS) {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => saveRemindersData(), SAVE_DEFER_MS);
            return;
        }
        lastSaveTime = now;
        if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }

        persistLocal();

        const snap = snapshotKey();
        if (snap === lastSavedSnapshot) {
            pendingSave = false;
            renderUnifiedStatus();
            return;
        }

        const docRef = getRemindersDocRef();
        if (!docRef) {
            lastSavedSnapshot = snap;
            pendingSave = false;
            renderUnifiedStatus();
            return;
        }

        lastSavedSnapshot = snap;
        renderUnifiedStatus();
        try {
    const accountTs = Date.now();
    // ⭐ Пишем текущее время в localStorage перед отправкой в Firebase
    try { localStorage.setItem(SYNC_ACCOUNT_KEY, String(accountTs)); } catch (e) {}
    
    await docRef.set({
        settings, dismissed, hidden, lastSyncAt: accountTs
    }, { merge: true });
    markSynced(accountTs);
} catch (e) {
            console.error('❌ Ошибка сохранения в Firestore:', e);
            lastSavedSnapshot = '';
            pendingSave = true;
            renderUnifiedStatus();
        }
    }

    async function syncAllNow() {
        markDirty();
        try {
            await saveRemindersData(true);
            if (typeof window.syncToFirebase === 'function') {
                const res = window.syncToFirebase();
                if (res && typeof res.then === 'function') await res;
            }
            if (!pendingSave) renderUnifiedStatus();
        } catch (e) {
            console.error('❌ Ошибка полной синхронизации:', e);
            pendingSave = true;
            renderUnifiedStatus();
        }
    }

    function attachSnapshot() {
        if (remindersUnsubscribe) return;
        const docRef = getRemindersDocRef();
        if (!docRef) return;

        try {
            remindersUnsubscribe = docRef.onSnapshot((doc) => {
                if (typeof currentUser === 'undefined' || !currentUser) return;
                if (doc.exists) {
                    const data = doc.data() || {};
                    const sChanged = JSON.stringify(settings)  !== JSON.stringify(data.settings);
                    const dChanged = JSON.stringify(dismissed) !== JSON.stringify(data.dismissed);
                    const hChanged = JSON.stringify(hidden)    !== JSON.stringify(data.hidden);
                    if (sChanged || dChanged || hChanged) {
                        settings  = mergeSettings(data.settings);
                        dismissed = data.dismissed || {};
                        hidden    = data.hidden    || {};
                        lastSavedSnapshot = snapshotKey();
                        pendingSave = false;
                        persistLocal();
                    }
                    if (data.lastSyncAt) {
    // ⭐ Не перезаписываем время, если локальное время свежее, чем из Firebase
    const currentLocal = parseInt(localStorage.getItem(SYNC_ACCOUNT_KEY) || '0', 10);
    if (data.lastSyncAt > currentLocal) {
        try { localStorage.setItem(SYNC_ACCOUNT_KEY, String(data.lastSyncAt)); } catch (e) {}
    }
}
                    renderUnifiedStatus();
                    if (sChanged || dChanged || hChanged) refresh();
                }
            }, (error) => {
                console.warn('⚠️ Ошибка слушателя:', error);
                detachSnapshot();
            });
        } catch (e) {
            console.warn('⚠️ Не удалось создать слушатель:', e);
        }
    }

    function detachSnapshot() {
        if (typeof remindersUnsubscribe === 'function') {
            try { remindersUnsubscribe(); } catch (e) {}
        }
        remindersUnsubscribe = null;
    }

    async function loadRemindersData() {
        loadFromLocal();
        isDataLoaded = true;

        let attempts = 0;
        while (!isAuthenticated() && attempts < 50) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }

        if (!isAuthenticated()) {
            console.warn('⚠️ Не авторизован — работаем только с локальными данными');
            refresh();
            renderUnifiedStatus();
            return;
        }

        const docRef = getRemindersDocRef();
        if (!docRef) {
            refresh();
            renderUnifiedStatus();
            return;
        }

        const lastFetch = parseInt(localStorage.getItem(SYNC_FETCH_KEY) || '0', 10);
        const isFresh = (Date.now() - lastFetch) < REMOTE_FETCH_TTL_MS;

        if (!isFresh) {
            try {
                const doc = await docRef.get();
                try { localStorage.setItem(SYNC_FETCH_KEY, String(Date.now())); } catch (e) {}
                if (doc.exists) {
                    const data = doc.data() || {};
                    settings  = mergeSettings(data.settings);
                    dismissed = data.dismissed || {};
                    hidden    = data.hidden    || {};
                    lastSavedSnapshot = snapshotKey();
                    persistLocal();
                    if (data.lastSyncAt) {
                        try { localStorage.setItem(SYNC_ACCOUNT_KEY, String(data.lastSyncAt)); } catch (e) {}
                    }
                    markSynced(data.lastSyncAt || Date.now());
                } else {
                    const accountTs = Date.now();
                    await docRef.set({
                        settings, dismissed, hidden, lastSyncAt: accountTs
                    }, { merge: true });
                    lastSavedSnapshot = snapshotKey();
                    markSynced(accountTs);
                }
            } catch (e) {
                console.warn('⚠️ Ошибка загрузки из Firebase:', e);
                renderUnifiedStatus();
            }
        } else {
            lastSavedSnapshot = snapshotKey();
            try { localStorage.setItem(SYNC_WRITE_KEY, String(Date.now())); } catch (e) {}
        }

        attachSnapshot();

        refresh();
        renderUnifiedStatus();
    }

    function mergeSettings(src) {
        const base = clone(DEFAULT_SETTINGS);
        if (!src || typeof src !== 'object') return base;
        return {
            ...base, ...src,
            to: { ...base.to, ...(src.to || {}), services: { ...base.to.services, ...((src.to && src.to.services) || {}) } },
            shift: { ...base.shift, ...(src.shift || {}) },
            fuel:  { ...base.fuel,  ...(src.fuel  || {}) },
            goals: { ...base.goals, ...(src.goals || {}) }
        };
    }

    // ---------- СЕРВИСНЫЕ ФУНКЦИИ ----------
    function hasService(r, key) { return Array.isArray(r.serviceItems) && r.serviceItems.indexOf(key) !== -1; }
    function hasAnyService(r) { return Array.isArray(r.serviceItems) && r.serviceItems.length > 0; }
    function repairText(r) {
        const parts = (r.parts || []).map(p => p.name || '').join(' ');
        const works = (r.works || []).map(w => w.name || '').join(' ');
        return ((r.description || '') + ' ' + (r.comment || '') + ' ' + parts + ' ' + works).toLowerCase();
    }

    const SERVICE_REGISTRY = [
        { id: 'oil',     title: 'Замена масла и фильтра', intervalKm: 10000, months: 12,
          match: r => r.category === 'oil' || hasService(r, 'oil') || hasService(r, 'oilFilter') || (!hasAnyService(r) && /масло|\boil\b/.test(repairText(r))) },
        { id: 'air',     title: 'Воздушный фильтр',       intervalKm: 15000, months: 12,
          match: r => hasService(r, 'airFilter') || (!hasAnyService(r) && /воздушн/.test(repairText(r))) },
        { id: 'cabin',   title: 'Салонный фильтр',        intervalKm: 15000, months: 12,
          match: r => hasService(r, 'cabinFilter') || (!hasAnyService(r) && /салонн/.test(repairText(r))) },
        { id: 'plugs',   title: 'Свечи зажигания',        intervalKm: 30000, months: 24,
          match: r => hasService(r, 'sparkPlugs') || (!hasAnyService(r) && /свеч/.test(repairText(r))) },
        { id: 'brakefl', title: 'Тормозная жидкость',     intervalKm: 40000, months: 24,
          match: r => hasService(r, 'brakeFluid') || (!hasAnyService(r) && /тормозн.{0,20}жидк/.test(repairText(r))) },
        { id: 'coolant', title: 'Охлаждающая жидкость',   intervalKm: 60000, months: 36,
          match: r => r.category === 'cooling' || hasService(r, 'coolant') || (!hasAnyService(r) && /антифриз|охлажда|coolant/.test(repairText(r))) },
        { id: 'trans',   title: 'Масло в МКПП',           intervalKm: 60000, months: 48,
          match: r => r.category === 'transmission' || hasService(r, 'transmissionFluid') || (!hasAnyService(r) && /трансмисс|мкпп|кпп|коробк|механич/.test(repairText(r))) },
        { id: 'belt',    title: 'Ремень ГРМ',             intervalKm: 80000, months: 60,
          match: r => /грм|ремень|timing/.test(repairText(r)) },
        { id: 'battery', title: 'Аккумулятор',            intervalKm: 60000, months: 48,
          match: r => hasService(r, 'battery') || (!hasAnyService(r) && /аккумулятор/.test(repairText(r))) }
    ];

    // ---------- ГЕНЕРАЦИЯ НАПОМИНАНИЙ ----------
    function buildServiceReminders() {
        if (!settings.to || !settings.to.enabled) return [];
        const allRepairs = getAllRepairs();
        const allLogs = getAllFuelLogs();
        const vehicles = getAllVehicles();
        const now = new Date();
        const out = [];

        vehicles.forEach(vehicle => {
            const vId = vehicle.id || 'default';
            const vName = vehicle.name || 'Автомобиль';
            const vPlate = vehicle.plate || '';

            const vRepairs = allRepairs.filter(r => (r.vehicleId || 'default') === vId);
            let maxMileage = 0;
            vRepairs.forEach(r => {
                const m = num(r.mileage !== undefined ? r.mileage : r.odometer);
                if (m > maxMileage) maxMileage = m;
            });
            allLogs.filter(l => (l.vehicleId || 'default') === vId).forEach(l => {
                const m = num(l.mileage !== undefined ? l.mileage : l.odometer);
                if (m > maxMileage) maxMileage = m;
            });

            if (!maxMileage) return;

            SERVICE_REGISTRY.forEach(svc => {
                const svcSettings = (settings.to.services && settings.to.services[svc.id]) ||
                    { enabled: true, intervalKm: svc.intervalKm, months: svc.months };
                if (!svcSettings.enabled) return;

                let lastMileage = 0, lastDate = '';
                vRepairs.forEach(r => {
                    if (!svc.match(r)) return;
                    const m = num(r.mileage);
                    if (m > lastMileage) lastMileage = m;
                    if (r.date && r.date > lastDate) lastDate = r.date;
                });

                const vPrefix = vName + (vPlate ? ' (' + vPlate + ')' : '') + ': ';

                if (!lastMileage && !lastDate) {
                    if (svc.id === 'oil' && maxMileage >= svcSettings.intervalKm) {
                        out.push({
                            id: 'svc:oil:none:' + vId,
                            type: 'to', icon: 'construct-outline', priority: 2,
                            vehicleId: vId, vehicleName: vName, vehiclePlate: vPlate,
                            title: 'Техобслуживание',
                            text: vPrefix + 'Пробег ' + maxMileage.toLocaleString('ru-RU') + ' км — нет записи о замене масла.'
                        });
                    }
                    return;
                }

                const reasons = [];
                if (maxMileage && lastMileage) {
                    const left = (lastMileage + svcSettings.intervalKm) - maxMileage;
                    if (left <= 0) reasons.push('просрочено на ' + Math.abs(left).toLocaleString('ru-RU') + ' км');
                    else if (left <= settings.to.warnBeforeKm) reasons.push('осталось ~' + left.toLocaleString('ru-RU') + ' км');
                }
                if (lastDate && svcSettings.months) {
                    const d = parseISO(lastDate);
                    if (d) {
                        const monthsPassed = (now - d) / (1000 * 60 * 60 * 24 * 30.44);
                        if (monthsPassed >= svcSettings.months) reasons.push('по сроку: ' + Math.floor(monthsPassed) + ' мес.');
                    }
                }

                if (reasons.length) {
                    out.push({
                        id: 'svc:' + svc.id + ':' + vId + ':' + lastMileage + ':' + lastDate,
                        type: 'to', icon: 'construct-outline',
                        vehicleId: vId, vehicleName: vName, vehiclePlate: vPlate,
                        title: svc.title,
                        priority: reasons[0].indexOf('просрочено') !== -1 ? 1 : 2,
                        text: vPrefix + svc.title + ': ' + reasons.join(', ') +
                            (lastMileage ? ' (последняя на ' + lastMileage.toLocaleString('ru-RU') + ' км)' : '')
                    });
                }
            });
        });
        return out;
    }

    function isWorkDay(date) {
        const s = settings.shift;
        const anchor = parseISO(s.anchor);
        if (!anchor) return null;
        const cycle = num(s.workDays) + num(s.offDays);
        if (cycle <= 0) return null;
        const diff = Math.floor((date - anchor) / 86400000);
        const pos = ((diff % cycle) + cycle) % cycle;
        return pos < num(s.workDays);
    }

    function buildShiftReminder() {
        if (!settings.shift.enabled || !settings.shift.anchor) return null;
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (now.getHours() >= num(settings.shift.remindAtHour) && isWorkDay(tomorrow)) {
            return {
                id: 'shift:' + localISO(tomorrow),
                type: 'shift', icon: 'calendar-outline', priority: 3,
                vehicleId: null,
                title: 'Завтра рабочая смена',
                text: 'Завтра (' + localISO(tomorrow) + ') рабочий день по графику ' + settings.shift.workDays + '/' + settings.shift.offDays + '.'
            };
        }
        if (isWorkDay(now) && now.getHours() < 12) {
            return {
                id: 'shift-today:' + localISO(now),
                type: 'shift', icon: 'calendar-outline', priority: 3,
                vehicleId: null,
                title: 'Сегодня рабочая смена',
                text: 'По графику ' + settings.shift.workDays + '/' + settings.shift.offDays + ' сегодня рабочий день.'
            };
        }
        return null;
    }

    function buildFuelReminder() {
        if (!settings.fuel.enabled) return [];
        const allLogs = getAllFuelLogs();
        const vehicles = getAllVehicles();
        const out = [];

        vehicles.forEach(vehicle => {
            const vId = vehicle.id || 'default';
            const vName = vehicle.name || 'Автомобиль';
            const vPlate = vehicle.plate || '';

            const logs = allLogs
                .filter(l => (l.vehicleId || 'default') === vId)
                .filter(l => num(l.liters) > 0 && num(l.mileage !== undefined ? l.mileage : l.odometer) > 0)
                .sort((a, b) => num(a.mileage !== undefined ? a.mileage : a.odometer) - num(b.mileage !== undefined ? b.mileage : b.odometer));

            if (logs.length < 6) return;

            const cons = [];
            for (let i = 1; i < logs.length; i++) {
                const dm = num(logs[i].mileage !== undefined ? logs[i].mileage : logs[i].odometer) - num(logs[i - 1].mileage !== undefined ? logs[i - 1].mileage : logs[i - 1].odometer);
                if (dm > 0) cons.push(num(logs[i].liters) / dm * 100);
            }
            if (cons.length < 6) return;

            const last3 = cons.slice(-3).reduce((s, v) => s + v, 0) / 3;
            const prev3 = cons.slice(-6, -3).reduce((s, v) => s + v, 0) / 3;
            if (!prev3) return;

            const rise = (last3 - prev3) / prev3 * 100;
            if (rise >= num(settings.fuel.risePercent)) {
                const vPrefix = vName + (vPlate ? ' (' + vPlate + ')' : '') + ': ';
                out.push({
                    id: 'fuel:' + vId + ':' + localISO(new Date()).slice(0, 7),
                    type: 'fuel', icon: 'fuel-outline', priority: 2,
                    vehicleId: vId, vehicleName: vName, vehiclePlate: vPlate,
                    title: 'Вырос расход топлива',
                    text: vPrefix + 'Средний расход вырос на ' + rise.toFixed(0) + '% (' + prev3.toFixed(1) + ' → ' + last3.toFixed(1) + ' л/100км).'
                });
            }
        });
        return out;
    }

    function buildGoalReminder() {
        if (!settings.goals.enabled) return null;
        let goals = null;
        try { goals = JSON.parse(localStorage.getItem('driverGoals') || 'null'); } catch (e) {}
        if (!goals) return null;

        const now = new Date();
        const monthRecs = getRecords().filter(r => {
            const d = parseISO(r.date);
            return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const income = monthRecs.reduce((s, r) => s + (r.totalIncome || 0), 0);
        const orders = monthRecs.reduce((s, r) => s + (r.ordersDelivery || 0), 0);
        const key = localISO(now).slice(0, 7);

        if (goals.income > 0 && income >= goals.income) {
            return {
                id: 'goal-income:' + key, type: 'goal', icon: 'trophy-outline', priority: 3,
                vehicleId: null,
                title: 'Цель по доходу достигнута! 🎉',
                text: 'Заработано ' + Math.round(income).toLocaleString('ru-RU') + ' ₽ при цели ' + goals.income.toLocaleString('ru-RU') + ' ₽.'
            };
        }
        if (goals.orders > 0 && orders >= goals.orders) {
            return {
                id: 'goal-orders:' + key, type: 'goal', icon: 'cube-outline', priority: 3,
                vehicleId: null,
                title: 'Цель по заказам достигнута! 🎉',
                text: 'Выполнено ' + orders + ' заказов при цели ' + goals.orders + '.'
            };
        }
        return null;
    }

    // ---------- ФИЛЬТРАЦИЯ ----------
    function isSuppressed(r) {
        if (dismissed[r.id]) return true;
        if (hidden[r.id] === todayISO()) return true;
        return false;
    }

    function collectReminders() {
        if (!settings.enabled || !isAuthenticated() || !isDataLoaded) return [];
        const list = [];
        buildServiceReminders().forEach(r => list.push(r));
        const shift = buildShiftReminder();
        if (shift) list.push(shift);
        buildFuelReminder().forEach(r => list.push(r));
        const goal = buildGoalReminder();
        if (goal) list.push(goal);
        return list.filter(r => !isSuppressed(r));
    }

    // ---------- ЗВУК ----------
    function initAudio() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                reverbNode = _createReverb(audioContext, 0.6, 1.4);
                if (reverbNode) reverbNode.connect(audioContext.destination);
            } catch (e) { console.warn('⚠️ Audio API недоступен'); }
        }
        if (audioContext && audioContext.state === 'suspended') {
            try { audioContext.resume(); } catch (e) {}
        }
    }

    function _createReverb(ctx, decay, duration) {
        try {
            const rate = ctx.sampleRate;
            const length = Math.max(1, Math.floor(rate * duration));
            const impulse = ctx.createBuffer(2, length, rate);
            for (let ch = 0; ch < 2; ch++) {
                const data = impulse.getChannelData(ch);
                for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 3);
            }
            const conv = ctx.createConvolver();
            conv.buffer = impulse;
            return conv;
        } catch (e) { return null; }
    }

    function _voice(freq, startAt, duration, peak, type, detune) {
        if (!audioContext) return;
        const ctx = audioContext;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, startAt);
        if (detune) osc.detune.setValueAtTime(detune, startAt);

        const attack = Math.min(0.02, duration * 0.15);
        const release = duration * 0.7;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + release);

        osc.connect(gain);
        gain.connect(ctx.destination);
        if (reverbNode) {
            const wet = ctx.createGain();
            wet.gain.value = 0.25;
            gain.connect(wet);
            wet.connect(reverbNode);
        }
        osc.start(startAt);
        osc.stop(startAt + duration + 0.05);
    }

    function _chord(freqs, startAt, step, duration, peak, type, detune) {
        freqs.forEach((f, i) => _voice(f, startAt + i * step, duration, peak, type, detune || 0));
    }

    const SOUND_PROFILES = {
        success:  { notes: [523.25, 659.25, 783.99],           step: 0.08, dur: 0.35, peak: 0.20, type: 'triangle' },
        info:     { notes: [587.33],                            step: 0.00, dur: 0.30, peak: 0.16, type: 'sine' },
        warning:  { notes: [466.16, 415.30],                    step: 0.12, dur: 0.30, peak: 0.18, type: 'triangle' },
        error:    { notes: [392.00, 311.13],                    step: 0.14, dur: 0.28, peak: 0.18, type: 'sine' },
        shift:    { notes: [440.00, 587.33],                    step: 0.16, dur: 0.40, peak: 0.17, type: 'sine' },
        goal:     { notes: [523.25, 659.25, 783.99, 1046.5],    step: 0.09, dur: 0.45, peak: 0.18, type: 'triangle' },
        fuel:     { notes: [493.88, 392.00],                    step: 0.13, dur: 0.32, peak: 0.17, type: 'sine' },
        to:       { notes: [392.00, 523.25],                    step: 0.12, dur: 0.35, peak: 0.18, type: 'triangle' }
    };

    function playSound(type) {
        if (!notifSettings.sound || notifVolume <= 0) return;
        initAudio();
        if (!audioContext) return;

        const vol = notifVolume / 100;

        try {
            const profile = SOUND_PROFILES[type] || SOUND_PROFILES.info;
            const now = audioContext.currentTime + 0.01;
            const peak = profile.peak * vol;
            _chord(profile.notes, now, profile.step, profile.dur, peak, profile.type);

            if (type === 'success' || type === 'goal' || type === 'shift') {
                _voice(profile.notes[0] / 2, now, profile.dur + 0.1, 0.07 * vol, 'sine');
            }
            if (type === 'goal') {
                _voice(profile.notes[profile.notes.length - 1] * 2, now + 0.25, 0.35, 0.05 * vol, 'sine');
            }
        } catch (e) { /* ignore */ }
    }

    // ---------- УВЕДОМЛЕНИЯ В ПАНЕЛИ ----------
    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function showNotification(type, title, body, reminderId) {
        const list = document.getElementById('cc-notification-list');
        if (!list) return;
        if (!notifSettings.enabled && type !== 'force') return;

        const noNotifs = list.querySelector('.cc-no-notifs');
        if (noNotifs) noNotifs.style.display = 'none';

        const notif = document.createElement('div');
        notif.className = 'cc-notification-item ' + type;
        if (reminderId) notif.dataset.reminderId = reminderId;

        const icons = {
            success: 'checkmark-circle-outline', warning: 'warning-outline', error: 'close-circle-outline',
            info: 'information-circle-outline', force: 'information-circle-outline',
            shift: 'calendar-outline', goal: 'trophy-outline', fuel: 'fuel-outline', to: 'construct-outline'
        };
        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        notif.innerHTML =
            '<div class="cc-notif-icon-wrap"><ion-icon name="' + (icons[type] || 'information-circle-outline') + '"></ion-icon></div>' +
            '<div class="cc-notif-content">' +
                '<div class="cc-notif-title">' + escapeHTML(title) + '</div>' +
                '<div class="cc-notif-body">' + escapeHTML(body) + '</div>' +
                '<div class="cc-notif-time">' + timeStr + '</div>' +
            '</div>' +
            '<button class="cc-notif-close" aria-label="Закрыть"><ion-icon name="close-outline"></ion-icon></button>';

        list.prepend(notif);
        playSound(type);

        const closeBtn = notif.querySelector('.cc-notif-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rid = notif.dataset.reminderId;
                if (rid) {
                    hidden[rid] = todayISO();
                    persistLocal();
                    markDirty();
                    saveRemindersData();
                }
                removeNotification(notif);
            });
        }
    }

    function removeNotification(notif) {
        if (!notif || !notif.parentNode) return;
        notif.style.opacity = '0';
        notif.style.transform = 'translateX(20px)';
        notif.style.transition = 'all .3s';
        setTimeout(() => {
            if (notif.parentNode) notif.parentNode.removeChild(notif);
            const list = document.getElementById('cc-notification-list');
            if (list) {
                const items = list.querySelectorAll('.cc-notification-item');
                if (items.length === 0) {
                    const noNotifs = list.querySelector('.cc-no-notifs');
                    if (noNotifs) noNotifs.style.display = 'block';
                }
            }
        }, 300);
    }

    function renderEmptyState(list) {
        list.innerHTML =
            '<div class="cc-no-notifs">' +
                '<ion-icon name="checkmark-circle-outline" style="font-size:28px;margin-bottom:8px;display:block;color:#34C759;"></ion-icon>' +
                'Нет новых уведомлений' +
            '</div>';
    }

    // ---------- ПАНЕЛЬ ----------
    function openControlPanel() {
        const cp = document.getElementById('control-center');
        const overlay = document.getElementById('cc-overlay');
        if (!cp) { console.warn('❌ #control-center не найден'); return; }
        cp.classList.add('open');
        if (overlay) overlay.classList.add('visible');
        updateCPInfo();
        updateCPTiles();
        updateVolumeSlider();
        updateBrightnessSlider();
        renderUnifiedStatus();
        showAllActiveReminders();
    }

    function closeControlPanel() {
        const cp = document.getElementById('control-center');
        const overlay = document.getElementById('cc-overlay');
        if (cp) cp.classList.remove('open');
        if (overlay) overlay.classList.remove('visible');
    }

    function updateCPInfo() {
        const now = new Date();
        const dateEl = document.getElementById('cc-date');
        const timeEl = document.getElementById('cc-time');
        if (dateEl) dateEl.textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        if (timeEl) timeEl.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function updateCPTiles() {
        const themeTile = document.getElementById('cc-theme-toggle');
        const soundTile = document.getElementById('cc-sound-toggle');
        const syncTile = document.getElementById('cc-sync-toggle');
        const notifTile = document.getElementById('cc-notif-toggle');

        if (themeTile) {
            const isDark = document.body.classList.contains('dark-theme');
            themeTile.classList.toggle('cc-tile-active', isDark);
            const iconEl = themeTile.querySelector('ion-icon');
            const textEl = themeTile.querySelector('span');
            if (iconEl) iconEl.setAttribute('name', isDark ? 'sunny-outline' : 'moon-outline');
            if (textEl) textEl.textContent = isDark ? 'Светлая тема' : 'Тёмная тема';
        }
        if (soundTile) soundTile.classList.toggle('cc-tile-active', notifSettings.sound && notifVolume > 0);
        if (syncTile) syncTile.classList.toggle('cc-tile-active', notifSettings.autoSync);
        if (notifTile) notifTile.classList.toggle('cc-tile-active', notifSettings.enabled);
    }

    function toggleCPTheme() {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        try { localStorage.setItem('driverTheme', isDark ? 'dark' : 'light'); } catch (e) {}
        updateCPTiles();

        const themeTile = document.getElementById('cc-theme-toggle');
        if (themeTile) {
            const iconEl = themeTile.querySelector('ion-icon');
            const textEl = themeTile.querySelector('span');
            if (iconEl) iconEl.setAttribute('name', isDark ? 'sunny-outline' : 'moon-outline');
            if (textEl) textEl.textContent = isDark ? 'Светлая тема' : 'Тёмная тема';
        }
        showNotification('info', 'Тема изменена', isDark ? 'Тёмная тема активна' : 'Светлая тема активна');
    }

    function toggleCPSound() {
        notifSettings.sound = !notifSettings.sound;
        try { localStorage.setItem('notifSound', notifSettings.sound ? 'true' : 'false'); } catch (e) {}

        if (!notifSettings.sound) {
            if (notifVolume > 0) lastNotifVolume = notifVolume;
            notifVolume = 0;
        } else {
            notifVolume = lastNotifVolume || 100;
            showNotification('info', 'Звук включён', 'Уведомления будут со звуком');
        }

        try { localStorage.setItem(VOLUME_KEY, String(notifVolume)); } catch (e) {}
        updateCPTiles();
        updateVolumeSlider();
    }

    async function toggleCPSync() {
        notifSettings.autoSync = !notifSettings.autoSync;
        try { localStorage.setItem('notifAutoSync', notifSettings.autoSync ? 'true' : 'false'); } catch (e) {}
        updateCPTiles();

        if (!notifSettings.autoSync) {
            renderUnifiedStatus();
            showNotification('info', 'Автосинхронизация выключена', 'Данные сохраняются только локально');
            return;
        }
        showNotification('info', 'Автосинхронизация', 'Синхронизируем все данные…');
        await syncAllNow();
    }

    function toggleCPNotif() {
        notifSettings.enabled = !notifSettings.enabled;
        try { localStorage.setItem('notifEnabled', notifSettings.enabled ? 'true' : 'false'); } catch (e) {}
        updateCPTiles();
        if (notifSettings.enabled) showNotification('success', 'Уведомления включены', 'Теперь они остаются в панели');
    }

    function showAllActiveReminders() {
        const list = document.getElementById('cc-notification-list');
        if (!list) return;

        activeReminders = collectReminders();

        if (activeReminders.length === 0) {
            renderEmptyState(list);
            return;
        }

        list.innerHTML = '';
        activeReminders.slice().sort((a, b) => a.priority - b.priority).forEach(r => {
            const type = r.type === 'goal'  ? 'success'
                       : r.type === 'fuel'  ? 'warning'
                       : r.type === 'shift' ? 'shift'
                       : r.type === 'to'    ? 'to'
                       : 'info';
            showNotification(type, r.title, r.text, r.id);
        });
    }

    // ---------- НАСТРОЙКИ НАПОМИНАНИЙ ----------
    function switchRow(path, label, checked) {
        return '<label class="cp-row"><span>' + label + '</span>' +
            '<span class="cp-switch"><input type="checkbox" data-path="' + path + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="cp-switch-track"><span class="cp-switch-thumb"></span></span></span></label>';
    }
    function numRow(path, label, value, min) {
        return '<label class="cp-row"><span>' + label + '</span>' +
            '<input type="number" data-path="' + path + '" value="' + value + '" min="' + (min || 0) + '" step="1"></label>';
    }
    function dateRow(path, label, value) {
        return '<label class="cp-row"><span>' + label + '</span>' +
            '<input type="date" data-path="' + path + '" value="' + (value || '') + '"></label>';
    }
    function setByPath(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object' || Array.isArray(cur[parts[i]])) {
                cur[parts[i]] = {};
            }
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function openNotifSettings() {
        if (document.getElementById('cc-settings-overlay')) return;
        const s = settings;

        const getSvc = (id, defKm, defMonths) => {
            const svc = (s.to.services && s.to.services[id]) || {};
            return {
                enabled: svc.enabled !== undefined ? svc.enabled : true,
                intervalKm: svc.intervalKm !== undefined ? svc.intervalKm : defKm,
                months: svc.months !== undefined ? svc.months : defMonths
            };
        };

        const buildSvcRow = (id, name, def) => (
            '<div class="cp-svc-item">' +
                switchRow('to.services.' + id + '.enabled', name, def.enabled) +
                (def.enabled ?
                    '<div class="cp-svc-grid">' +
                        numRow('to.services.' + id + '.intervalKm', 'Интервал (км)', def.intervalKm, 1000) +
                        numRow('to.services.' + id + '.months', 'Интервал (мес.)', def.months, 1) +
                    '</div>'
                : '') +
            '</div>'
        );

        const overlay = document.createElement('div');
        overlay.id = 'cc-settings-overlay';
        overlay.className = 'cp-settings-overlay';
        overlay.innerHTML =
            '<div class="cp-settings-modal">' +
                '<div class="cp-settings-header">' +
                    '<ion-icon name="settings-outline"></ion-icon>' +
                    '<h3>Настройки напоминаний</h3>' +
                '</div>' +
                '<div class="cp-settings-body">' +
                    switchRow('enabled', 'Все напоминания', s.enabled) +
                    switchRow('systemNotifications', 'Системные уведомления', s.systemNotifications) +

                    '<div class="cp-section">Техобслуживание (ТО)</div>' +
                    switchRow('to.enabled', 'Включить напоминания о ТО', s.to.enabled) +
                    (s.to.enabled ? numRow('to.warnBeforeKm', 'Предупреждать за (км)', s.to.warnBeforeKm, 0) : '') +
                    (s.to.enabled ?
                        '<div class="cp-svc-list">' +
                            buildSvcRow('oil',     '🛢️ Замена масла и фильтра',     getSvc('oil', 10000, 12)) +
                            buildSvcRow('trans',   '⚙️ Масло в МКПП / АКПП',       getSvc('trans', 60000, 48)) +
                            buildSvcRow('air',     '💨 Воздушный фильтр',          getSvc('air', 15000, 12)) +
                            buildSvcRow('cabin',   '🌬️ Салонный фильтр',           getSvc('cabin', 15000, 12)) +
                            buildSvcRow('plugs',   '⚡ Свечи зажигания',           getSvc('plugs', 30000, 24)) +
                            buildSvcRow('brakefl', '💧 Тормозная жидкость',        getSvc('brakefl', 40000, 24)) +
                            buildSvcRow('coolant', '❄️ Охлаждающая жидкость',      getSvc('coolant', 60000, 36)) +
                            buildSvcRow('belt',    '🔗 Ремень / Цепь ГРМ',         getSvc('belt', 80000, 60)) +
                            buildSvcRow('battery', '🔋 Аккумулятор',               getSvc('battery', 60000, 48)) +
                        '</div>'
                    : '') +

                    '<div class="cp-section">Смены</div>' +
                    switchRow('shift.enabled', 'Напоминать о сменах', s.shift.enabled) +
                    (s.shift.enabled ?
                        dateRow('shift.anchor', 'Начало цикла (1-й раб. день)', s.shift.anchor) +
                        numRow('shift.workDays', 'Рабочих дней', s.shift.workDays, 1) +
                        numRow('shift.offDays', 'Выходных дней', s.shift.offDays, 1) +
                        numRow('shift.remindAtHour', 'Напоминать с часа (0-23)', s.shift.remindAtHour, 0)
                    : '') +

                    '<div class="cp-section">Топливо</div>' +
                    switchRow('fuel.enabled', 'Контроль роста расхода', s.fuel.enabled) +
                    (s.fuel.enabled ? numRow('fuel.risePercent', 'Порог роста (%)', s.fuel.risePercent, 1) : '') +

                    '<div class="cp-section">Цели</div>' +
                    switchRow('goals.enabled', 'Достижение целей', s.goals.enabled) +
                '</div>' +
                '<div class="cp-settings-footer">' +
                    '<button class="cp-btn" id="cc-settings-cancel" type="button">Отмена</button>' +
                    '<button class="cp-btn primary" id="cc-settings-save" type="button">' +
                        '<ion-icon name="checkmark-outline"></ion-icon> Сохранить' +
                    '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const close = () => {
            overlay.classList.remove('visible');
            setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
        };
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const cancelBtn = overlay.querySelector('#cc-settings-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', close);

        const saveBtn = overlay.querySelector('#cc-settings-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                overlay.querySelectorAll('[data-path]').forEach(inp => {
                    const path = inp.dataset.path;
                    if (inp.type === 'checkbox') setByPath(settings, path, inp.checked);
                    else if (inp.type === 'number') setByPath(settings, path, num(inp.value));
                    else setByPath(settings, path, inp.value);
                });
                markDirty();
                await saveRemindersData();
                close();
                refresh();
                showNotification('success', 'Настройки сохранены', 'Изменения применены');
            });
        }
    }

    // ---------- СВАЙП ----------
    function initSwipe() {
        const panel = document.getElementById('control-center');
        const overlay = document.getElementById('cc-overlay');
        if (!panel) { console.warn('❌ #control-center не найден'); return; }

        const isOpen = () => panel.classList.contains('open');
        const THRESHOLD = 80;

        function isSliderTarget(target) {
            if (!target) return false;
            let el = target;
            while (el && el !== panel) {
                if (el.classList && el.classList.contains('cc-slider')) return true;
                if (el.tagName === 'INPUT' && el.type === 'range') return true;
                el = el.parentElement;
            }
            return false;
        }

        let startX = 0, startY = 0, opening = false;
        let activeTouchOnSlider = false;

        document.addEventListener('touchstart', (e) => {
            activeTouchOnSlider = isSliderTarget(e.target);
            if (activeTouchOnSlider) { opening = false; return; }
            if (isOpen()) { opening = false; return; }
            if (!e.touches || e.touches.length === 0) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            opening = startX < 60;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (activeTouchOnSlider) return;
            if (!opening || isOpen()) return;
            if (!e.touches || e.touches.length === 0) return;
            const diffX = e.touches[0].clientX - startX;
            const diffY = Math.abs(e.touches[0].clientY - startY);
            if (diffX > THRESHOLD && diffX > diffY * 1.5) {
                openControlPanel();
                opening = false;
            }
        }, { passive: true });

        document.addEventListener('touchend', () => { opening = false; activeTouchOnSlider = false; });

        let closeStartX = 0, closing = false;
        let closeActiveTouchOnSlider = false;

        panel.addEventListener('touchstart', (e) => {
            closeActiveTouchOnSlider = isSliderTarget(e.target);
            if (closeActiveTouchOnSlider) { closing = false; return; }
            if (!e.touches || e.touches.length === 0) return;
            closeStartX = e.touches[0].clientX;
            closing = true;
        }, { passive: true });

        panel.addEventListener('touchmove', (e) => {
            if (closeActiveTouchOnSlider) return;
            if (!closing || !isOpen()) return;
            if (!e.touches || e.touches.length === 0) return;
            const diffX = closeStartX - e.touches[0].clientX;
            if (diffX > THRESHOLD) { closeControlPanel(); closing = false; }
        }, { passive: true });

        panel.addEventListener('touchend', () => { closing = false; closeActiveTouchOnSlider = false; });

        if (overlay) overlay.addEventListener('click', closeControlPanel);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) closeControlPanel();
        });
    }

    // ---------- СЛАЙДЕРЫ ----------
    function initSliders() {
        const volEl = document.getElementById('cc-volume');
        const brEl  = document.getElementById('cc-brightness');

        if (volEl) {
            updateSliderFill(volEl);
            updateVolumeSlider();
            volEl.addEventListener('input', () => {
                notifVolume = Math.min(100, Math.max(0, parseInt(volEl.value, 10) || 0));

                if (notifVolume > 0) {
                    lastNotifVolume = notifVolume;
                    if (!notifSettings.sound) {
                        notifSettings.sound = true;
                        try { localStorage.setItem('notifSound', 'true'); } catch (e) {}
                    }
                } else {
                    notifSettings.sound = false;
                    try { localStorage.setItem('notifSound', 'false'); } catch (e) {}
                }

                updateSliderFill(volEl);
                updateCPTiles();
                const val = document.getElementById('cc-volume-value');
                if (val) val.textContent = notifVolume + '%';
            });
            volEl.addEventListener('change', () => {
                try { localStorage.setItem(VOLUME_KEY, String(notifVolume)); } catch (e) {}
                updateCPTiles();
                if (notifVolume > 0) playSound('info');
            });
        }

        if (brEl) {
            updateSliderFill(brEl);
            updateBrightnessSlider();
            brEl.addEventListener('input', () => {
                uiBrightness = Math.min(100, Math.max(20, parseInt(brEl.value, 10) || 100));
                updateSliderFill(brEl);
                const val = document.getElementById('cc-brightness-value');
                if (val) val.textContent = uiBrightness + '%';
                applyBrightness();
            });
            brEl.addEventListener('change', () => {
                try { localStorage.setItem(BRIGHTNESS_KEY, String(uiBrightness)); } catch (e) {}
            });
        }

        applyBrightness();
    }

    // ---------- ОБНОВЛЕНИЕ ----------
    function refresh() {
        if (!isDataLoaded) return;
        activeReminders = collectReminders();

        const today = todayISO();
        let notifiedChanged = false;

        Object.keys(notified).forEach(id => {
            if (notified[id] !== today) { delete notified[id]; notifiedChanged = true; }
        });

        activeReminders.forEach(r => {
            if (notified[r.id] !== today) {
                notified[r.id] = today;
                notifiedChanged = true;
                const type = r.type === 'goal'  ? 'success'
                           : r.type === 'fuel'  ? 'warning'
                           : r.type === 'shift' ? 'shift'
                           : r.type === 'to'    ? 'to'
                           : 'info';
                showNotification(type, r.title, r.text, r.id);
            }
        });

        if (notifiedChanged) persistNotifiedOnly();

        const cp = document.getElementById('control-center');
        if (cp && cp.classList.contains('open')) showAllActiveReminders();
    }

    // ---------- ИНИЦИАЛИЗАЦИЯ ----------
    function bindHandlers() {
        const map = [
            ['cc-theme-toggle', toggleCPTheme],
            ['cc-sound-toggle', toggleCPSound],
            ['cc-sync-toggle',  toggleCPSync],
            ['cc-notif-toggle', toggleCPNotif]
        ];
        map.forEach(([id, fn]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
            else console.warn('⚠️ Не найден элемент #' + id);
        });

        const settingsBtn = document.getElementById('cc-notif-settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openNotifSettings();
            });
        }

        const backupBtn = document.getElementById('cc-backup-btn');
        if (backupBtn) {
            backupBtn.addEventListener('click', () => {
                if (typeof window.exportFullBackup === 'function') window.exportFullBackup();
                closeControlPanel();
            });
        }

        const appSettingsBtn = document.getElementById('cc-settings-btn');
        if (appSettingsBtn) {
            appSettingsBtn.addEventListener('click', () => {
                if (typeof window.openAppSettings === 'function') {
                    window.openAppSettings();
                } else if (typeof window.switchTab === 'function') {
                    window.switchTab('settings');
                }
                closeControlPanel();
            });
        }

        const resetBtn = document.getElementById('cc-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Сбросить все данные?')) {
                    if (typeof window.resetAllAppData === 'function') window.resetAllAppData();
                    closeControlPanel();
                }
            });
        }

        const clearAllBtn = document.getElementById('cc-clear-all-notifs');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                const list = document.getElementById('cc-notification-list');
                if (!list) return;

                const today = todayISO();
                activeReminders.forEach(r => { hidden[r.id] = today; });
                persistLocal();
                markDirty();
                saveRemindersData();

                const items = list.querySelectorAll('.cc-notification-item');
                items.forEach((item, idx) => {
                    setTimeout(() => removeNotification(item), idx * 50);
                });

                setTimeout(() => {
                    if (list.querySelectorAll('.cc-notification-item').length === 0) {
                        renderEmptyState(list);
                    }
                }, items.length * 50 + 400);
            });
        }
    }

    async function init() {
        if (initialized) return;
        initialized = true;

        bindHandlers();
        initSwipe();
        initSliders();
        updateCPTiles();
        updateCPInfo();
        setInterval(updateCPInfo, 30 * 1000);

        await loadRemindersData();

        setInterval(refresh, 30 * 60 * 1000);

        setInterval(() => {
            if (!pendingSave) renderUnifiedStatus();
            if (typeof connectionMode !== 'undefined' && connectionMode !== 'firebase') {
                checkFirebaseConnection();
            }
        }, 60 * 1000);

        window.addEventListener('online', () => {
            console.log('🌐 Интернет появился');
            renderUnifiedStatus();
            checkFirebaseConnection();
        });

        window.addEventListener('offline', () => {
            console.log('📴 Интернет пропал');
            if (typeof connectionMode !== 'undefined') connectionMode = 'offline';
            if (typeof firebaseErrorReason !== 'undefined') firebaseErrorReason = 'Нет интернет-соединения';
            renderUnifiedStatus();
        });

        renderUnifiedStatus();

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                detachSnapshot();
            } else if (isDataLoaded) {
                attachSnapshot();
                refresh();
                renderUnifiedStatus();
            }
        });

        // Обработчик клика по объединенной плашке (клонируем, чтобы убить старые onclick)
        const unifiedStatus = document.getElementById('cc-unified-status');
        if (unifiedStatus) {
            const newUnifiedStatus = unifiedStatus.cloneNode(true);
            unifiedStatus.parentNode.replaceChild(newUnifiedStatus, unifiedStatus);

            newUnifiedStatus.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                showConnectionDetails();
            });
        }

        console.log('✅ Control Panel модуль загружен (Firebase-экономный режим)');
    }

    // ---------- ЭКСПОРТ ----------
    window.showNotification = showNotification;
    window.openControlPanel = openControlPanel;
    window.closeControlPanel = closeControlPanel;
    window.remindersRefresh = refresh;
    window.openNotifSettings = openNotifSettings;
    window.remindersRenderUnifiedStatus = renderUnifiedStatus;
    window.remindersSyncAllNow = syncAllNow;
    window.remindersMarkAsSynced = function() {
    markSynced(Date.now());
};
    window.renderUnifiedStatus = renderUnifiedStatus;
    window.showConnectionDetails = showConnectionDetails;
    window.checkFirebaseConnection = checkFirebaseConnection;
    window.remindersSetVolume = function (v) {
        notifVolume = Math.min(100, Math.max(0, parseInt(v, 10) || 0));
        try { localStorage.setItem(VOLUME_KEY, String(notifVolume)); } catch (e) {}
        updateVolumeSlider();
        updateCPTiles();
    };
    window.remindersSetBrightness = function (v) {
        uiBrightness = Math.min(100, Math.max(20, parseInt(v, 10) || 100));
        try { localStorage.setItem(BRIGHTNESS_KEY, String(uiBrightness)); } catch (e) {}
        updateBrightnessSlider();
        applyBrightness();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

