// ============================================
// МОДУЛЬ БЭКАПА И ПОЛНОГО СБРОСА (backup-module.js v3.0)
// ============================================

const BACKUP_VERSION = '3.0';
const BACKUP_FILENAME_PREFIX = 'driver-journal-backup';

// 🔧 Все ключи localStorage (без connectionMode — это in-memory)
const BACKUP_KEYS = [
    'driverRecords',
    'driverTariffs',
    'driverFuelLogs',
    'repair_records',
    'repairRecords', // ← ДОБАВЛЕНО: для совместимости с localStorage
    'driverShifts',
    'driverVehicles',
    'currentVehicleId',
    'scheduleSettings',
    'driverGoals',
    'driverProfileAvatar',
    'driverTheme',
    'appState',
    'historyViewMode'
];

// 🔧 Коллекции Firestore внутри users/{uid}/
const FIRESTORE_COLLECTIONS = [
    'records',
    'tariffs',
    'fuelLogs',
    'repair_records', // ← ИСПРАВЛЕНО: было 'repairs'
    'vehicles',
    'shifts'
];

// 🔧 Поля документа users/{uid}, которые удаляются при сбросе
const FIRESTORE_USER_FIELDS = ['avatar', 'goals', 'scheduleSettings'];

// ============================================
// 🔧 РЕЗОЛВИНГ FIREBASE (как в entryModule.js)
// ============================================
function getFirebaseDb() {
    if (typeof window.db !== 'undefined' && window.db) return window.db;
    try { if (typeof db !== 'undefined' && db) return db; } catch (e) {}
    return null;
}
function getCurrentUser() {
    if (window.currentUser) return window.currentUser;
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (e) {}
    return null;
}
function getFirebaseFieldValueDelete() {
    if (window.firebase?.firestore?.FieldValue?.delete) return window.firebase.firestore.FieldValue.delete();
    try {
        if (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.delete) {
            return firebase.firestore.FieldValue.delete();
        }
    } catch (e) {}
    return null;
}

// 🔧 Формат денег без зависимости от глобальной formatMoney
function fmtMoney(n) {
    const v = Number(n) || 0;
    if (typeof window.formatMoney === 'function') return window.formatMoney(v);
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(v);
}

// ============================================
// 📦 СБОР ДАННЫХ ДЛЯ БЭКАПА
// ============================================

/**
 * 🔧 ГЛАВНОЕ: собирает данные и из localStorage, и из in-memory window.*,
 * и (если авторизован) — из Firestore. Это гарантирует полноту.
 */
async function collectAllDataForBackup() {
    const data = {};

    // 1. Из localStorage
    BACKUP_KEYS.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            try { data[key] = JSON.parse(value); }
            catch (e) { data[key] = value; }
        }
    });

    // 2. Из in-memory (на случай, если localStorage ещё не обновился)
    const inMemoryMap = {
    driverRecords: window.records,
    driverTariffs: window.tariffs,
    driverFuelLogs: window.fuelLogs,
    repair_records: window.repairRecords || window.repair_records, // ← ИСПРАВЛЕНО: проверяем оба варианта
    driverVehicles: window.vehicles,
    driverShifts: window.shifts,
    currentVehicleId: window.currentVehicleId,
};
    Object.entries(inMemoryMap).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
            if (Array.isArray(val) ? val.length > 0 : true) {
                if (!data[key] || (Array.isArray(val) && val.length > (data[key]?.length || 0))) {
                    data[key] = val;
                }
            }
        }
    });

    // 3. Из Firestore (если авторизован) — догружаем то, чего нет локально
    const fbDb = getFirebaseDb();
    const user = getCurrentUser();
    if (fbDb && user) {
        try {
            const userRef = fbDb.collection('users').doc(user.uid);
            const colMap = {
    records: 'driverRecords',
    tariffs: 'driverTariffs',
    fuelLogs: 'driverFuelLogs',
    repair_records: 'repair_records', // ← ИСПРАВЛЕНО: было repairs: 'repair_records'
    vehicles: 'driverVehicles',
    shifts: 'driverShifts',
};
            for (const [colName, lsKey] of Object.entries(colMap)) {
                try {
                    const snap = await userRef.collection(colName).get();
                    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    if (docs.length > 0 && (!data[lsKey] || docs.length > (data[lsKey]?.length || 0))) {
                        data[lsKey] = docs;
                        console.log(`  ☁️ ${colName}: догружено из Firestore ${docs.length}`);
                    }
                } catch (e) {
                    console.warn(`  ⚠️ ${colName}: ошибка чтения из Firestore`, e.code || e.message);
                }
            }

            // Поля пользователя
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const ud = userDoc.data();
                if (ud.avatar) data.driverProfileAvatar = ud.avatar;
                if (ud.goals) data.driverGoals = JSON.stringify(ud.goals);
                if (ud.scheduleSettings) data.scheduleSettings = JSON.stringify(ud.scheduleSettings);
            }
        } catch (e) {
            console.warn('⚠️ Firestore при сборе бэкапа:', e.code || e.message);
        }
    }

    return data;
}

/**
 * 🔧 Собирает ВСЕ ключи localStorage, похожие на данные приложения
 * (страховка от забытых ключей)
 */
function collectExtraLocalStorageKeys() {
    const known = new Set(BACKUP_KEYS);
    const extra = {};
    Object.keys(localStorage).forEach(key => {
        if (known.has(key)) return;
        if (/^(driver|repair|fuel|schedule|vehicle|shift|appState|historyViewMode|__)/i.test(key)) {
            try { extra[key] = JSON.parse(localStorage.getItem(key)); }
            catch (e) { extra[key] = localStorage.getItem(key); }
        }
    });
    return extra;
}

/**
 * 📦 Полная статистика по собранным данным
 */
function buildBackupStats(data) {
    const repairRecords = Array.isArray(data.repair_records) ? data.repair_records : [];
    const fuelLogs = Array.isArray(data.driverFuelLogs) ? data.driverFuelLogs : [];
    const vehicles = Array.isArray(data.driverVehicles) ? data.driverVehicles : [];
    const records = Array.isArray(data.driverRecords) ? data.driverRecords : [];
    const shifts = Array.isArray(data.driverShifts) ? data.driverShifts : [];
    const avatar = data.driverProfileAvatar;

    let photosCount = 0;
    let receiptsCount = 0;
    let documentsCount = 0;

    repairRecords.forEach(r => {
        const hasReceipt = r.receiptPhotoUrl && String(r.receiptPhotoUrl).length > 100;
        const hasDocument = r.documentPhotoUrl && String(r.documentPhotoUrl).length > 100;
        if (hasReceipt) { receiptsCount++; photosCount++; }
        if (hasDocument) { documentsCount++; photosCount++; }
    });

    const vehicleStats = {};
    vehicles.forEach(v => {
        vehicleStats[v.id] = {
            name: v.name || 'Неизвестно',
            plate: v.plate || '',
            fuelCount: 0, repairCount: 0,
            fuelTotal: 0, repairTotal: 0
        };
    });

    const ensure = (vId) => {
        if (!vehicleStats[vId]) {
            vehicleStats[vId] = { name: 'Неизвестное авто', plate: '', fuelCount: 0, repairCount: 0, fuelTotal: 0, repairTotal: 0 };
        }
        return vehicleStats[vId];
    };

    fuelLogs.forEach(log => {
        const v = ensure(log.vehicleId || 'default');
        v.fuelCount++;
        v.fuelTotal += Number(log.amount) || 0;
    });
    repairRecords.forEach(r => {
        const v = ensure(r.vehicleId || 'default');
        v.repairCount++;
        v.repairTotal += Number(r.total) || 0;
    });

    let totalSize = 0;
    Object.values(data).forEach(v => {
        try { totalSize += JSON.stringify(v).length; } catch (e) {}
    });

    return {
        itemsCount: Object.keys(data).length,
        totalSizeKB: (totalSize / 1024).toFixed(1),
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        recordsCount: records.length,
        fuelLogsCount: fuelLogs.length,
        repairCount: repairRecords.length,
        shiftsCount: shifts.length,
        vehiclesCount: vehicles.length,
        hasAvatar: !!(avatar && avatar.length > 100),
        photosCount, receiptsCount, documentsCount,
        vehicleStats
    };
}

// ============================================
// 📦 СОЗДАНИЕ ПОЛНОГО БЭКАПА
// ============================================
async function createFullBackupAsync() {
    console.log('📦 Создание полного бэкапа (v3.0)...');
    const data = await collectAllDataForBackup();

    // Страховка — добираем «забытые» ключи
    const extra = collectExtraLocalStorageKeys();
    Object.assign(data, extra);

    const backup = {
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: '3.0',
        data
    };

    const stats = buildBackupStats(data);
    console.log('📊 Статистика бэкапа:', stats);

    return { backup, json: JSON.stringify(backup, null, 2), stats };
}

// Синхронный алиас (для обратной совместимости — возвращает «мгновенный» бэкап из localStorage+memory)
function createFullBackup() {
    const data = {};
    BACKUP_KEYS.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            try { data[key] = JSON.parse(value); }
            catch (e) { data[key] = value; }
        }
    });
    Object.entries({
        driverRecords: window.records,
        driverTariffs: window.tariffs,
        driverFuelLogs: window.fuelLogs,
        repair_records: window.repairRecords,
        driverVehicles: window.vehicles,
        driverShifts: window.shifts,
    }).forEach(([key, val]) => {
        if (Array.isArray(val) && val.length > (data[key]?.length || 0)) data[key] = val;
    });

    const backup = {
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: '3.0',
        data
    };
    return { backup, json: JSON.stringify(backup, null, 2), stats: buildBackupStats(data) };
}

// ============================================
// 💾 ЭКСПОРТ (асинхронный — включает Firestore)
// ============================================
async function exportFullBackup() {
    try {
        // Показываем индикатор
        const overlay = showProgressOverlay('Сбор данных для бэкапа...');
        const { json, stats } = await createFullBackupAsync();
        updateProgressOverlay(overlay, 'Сохранение файла...', true);

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const date = new Date().toISOString().split('T')[0];
        const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        const filename = `${BACKUP_FILENAME_PREFIX}_${date}_${time}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        overlay.remove();

        let message = `✅ Бэкап создан!\n\n`;
        message += `📝 Записей: ${stats.recordsCount}\n`;
        message += `⛽ Заправок: ${stats.fuelLogsCount}\n`;
        message += `🔧 Ремонтов: ${stats.repairCount}\n`;
        message += `📅 Смен: ${stats.shiftsCount}\n`;
        message += `🚗 Авто: ${stats.vehiclesCount}\n`;

        if (stats.vehiclesCount > 0) {
            message += `\n📊 По автомобилям:\n`;
            Object.values(stats.vehicleStats).forEach(v => {
                message += `  • ${v.name}${v.plate ? ' (' + v.plate + ')' : ''}\n`;
                message += `    Заправок: ${v.fuelCount} (${fmtMoney(v.fuelTotal)})\n`;
                message += `    Ремонтов: ${v.repairCount} (${fmtMoney(v.repairTotal)})\n`;
            });
        }

        message += `\n📸 Фото: ${stats.photosCount} (чеков: ${stats.receiptsCount}, документов: ${stats.documentsCount})\n`;
        message += `👤 Аватар: ${stats.hasAvatar ? 'есть' : 'нет'}\n`;
        message += `📏 Размер: ${stats.totalSizeMB} МБ`;

        alert(message);
    } catch (error) {
        console.error('❌ Ошибка экспорта:', error);
        alert('❌ Ошибка создания бэкапа: ' + error.message);
    }
}

// ============================================
// 📂 ИМПОРТ
// ============================================
function importFullBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm(`⚠️ Восстановление из бэкапа!\n\nФайл: ${file.name}\nРазмер: ${(file.size / 1024 / 1024).toFixed(2)} МБ\n\nВСЕ текущие данные будут заменены!\n\nПродолжить?`)) return;

        try {
            const text = await file.text();
            const backup = JSON.parse(text);
            if (backup.version && backup.version !== BACKUP_VERSION) {
                console.warn(`⚠️ Версия бэкапа (${backup.version}) ≠ текущей (${BACKUP_VERSION})`);
            }
            await restoreFromBackup(backup);
        } catch (error) {
            console.error('❌ Ошибка чтения файла:', error);
            alert('❌ Файл повреждён или неверный формат:\n' + error.message);
        }
    };

    input.click();
}

// ============================================
// 🔄 ВОССТАНОВЛЕНИЕ (с записью в Firestore!)
// ============================================
async function restoreFromBackup(backup) {
    console.log('🔄 Восстановление из бэкапа версии', backup.version);

    const data = backup.data || backup;
    const overlay = showProgressOverlay('Восстановление данных...');

    try {
        // 1. Флаг — чтобы onSnapshot не перезаписал
        window._isResetting = true;

        // 2. Отписываемся от слушателей
        unsubscribeAllFirebaseListeners();

        // 3. Чистим localStorage
        BACKUP_KEYS.forEach(key => localStorage.removeItem(key));

        // 4. Восстанавливаем в localStorage
        let restoredCount = 0;
        Object.entries(data).forEach(([key, value]) => {
            if (BACKUP_KEYS.includes(key)) {
                try {
                    const str = typeof value === 'string' ? value : JSON.stringify(value);
                    localStorage.setItem(key, str);
                    restoredCount++;
                } catch (e) {
                    console.error(`❌ ${key}:`, e);
                }
            }
        });
        console.log(`✅ Восстановлено в localStorage: ${restoredCount}`);

        // 5. 🔧 ГЛАВНОЕ: пишем в Firestore, иначе при reload Firebase перезапишет
        const fbDb = getFirebaseDb();
        const user = getCurrentUser();
        let fbRestored = { ok: 0, fail: 0 };

        if (fbDb && user) {
            updateProgressOverlay(overlay, 'Синхронизация с Firebase...', false);
            fbRestored = await pushBackupToFirestore(fbDb, user, data);
            console.log(`✅ Восстановлено в Firestore: ${fbRestored.ok}, ошибок: ${fbRestored.fail}`);
        } else {
            console.warn('⚠️ Firebase недоступен — данные восстановлены только локально');
        }

        overlay.remove();

        let msg = `✅ Данные восстановлены!\n\n`;
        msg += `📦 Локально: ${restoredCount} элементов\n`;
        if (fbDb && user) {
            msg += `☁️ В облако: ${fbRestored.ok} (ошибок: ${fbRestored.fail})\n`;
        } else {
            msg += `☁️ Firebase: не авторизован (только локально)\n`;
        }
        msg += `\nПриложение перезагрузится.`;
        alert(msg);

        setTimeout(() => location.reload(), 1500);
    } catch (error) {
        overlay.remove();
        console.error('❌ Ошибка восстановления:', error);
        alert('❌ Ошибка восстановления: ' + error.message);
    } finally {
        setTimeout(() => { window._isResetting = false; }, 2000);
    }
}

/**
 * 🔧 Пишет все данные из бэкапа в Firestore (батчами)
 */
async function pushBackupToFirestore(fbDb, user, data) {
    const userRef = fbDb.collection('users').doc(user.uid);
    let ok = 0;
    let fail = 0;

    const colMap = {
    records: 'driverRecords',
    tariffs: 'driverTariffs',
    fuelLogs: 'driverFuelLogs',
    repair_records: 'repair_records', // ← ИСПРАВЛЕНО: было repairs: 'repair_records'
    vehicles: 'driverVehicles',
    shifts: 'driverShifts',
};

    for (const [lsKey, colName] of Object.entries(colMap)) {
        const items = data[lsKey];
        if (!Array.isArray(items) || items.length === 0) continue;

        // 🔧 Сначала чистим коллекцию (иначе останутся «старые» документы)
        try {
            const colRef = userRef.collection(colName);
            let safety = 0;
            while (safety++ < 50) {
                const snap = await colRef.limit(400).get();
                if (snap.empty) break;
                const batch = fbDb.batch();
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                if (snap.size < 400) break;
            }
        } catch (e) {
            console.warn(`⚠️ Очистка ${colName}:`, e.code || e.message);
        }

        // 🔧 Пишем батчами по 400
        for (let i = 0; i < items.length; i += 400) {
            const chunk = items.slice(i, i + 400);
            const batch = fbDb.batch();
            chunk.forEach(item => {
                const payload = { ...item };
                let docId = payload.id;
                delete payload.id;
                const docRef = docId ? userRef.collection(colName).doc(String(docId))
                                     : userRef.collection(colName).doc();
                batch.set(docRef, payload);
            });
            try {
                await batch.commit();
                ok += chunk.length;
            } catch (e) {
                fail += chunk.length;
                console.error(`❌ ${colName} батч:`, e.code || e.message);
            }
        }
    }

    // 🔧 Поля пользователя (аватар, цели, расписание)
    try {
        const update = {};
        if (data.driverProfileAvatar) update.avatar = data.driverProfileAvatar;
        if (data.driverGoals) {
            try { update.goals = typeof data.driverGoals === 'string' ? JSON.parse(data.driverGoals) : data.driverGoals; }
            catch (e) {}
        }
        if (data.scheduleSettings) {
            try { update.scheduleSettings = typeof data.scheduleSettings === 'string' ? JSON.parse(data.scheduleSettings) : data.scheduleSettings; }
            catch (e) {}
        }
        if (Object.keys(update).length > 0) {
            await userRef.set(update, { merge: true });
            ok++;
        }
    } catch (e) {
        fail++;
        console.error('❌ Поля пользователя:', e.code || e.message);
    }

    return { ok, fail };
}

// ============================================
// 🧹 ОТПИСКА ОТ FIREBASE
// ============================================
function unsubscribeAllFirebaseListeners() {
    if (Array.isArray(window._fbListeners) && window._fbListeners.length > 0) {
        const snapshot = [...window._fbListeners];
        snapshot.forEach(unsub => { try { unsub(); } catch (e) {} });
        window._fbListeners = [];
        console.log(`🔕 Отписались от ${snapshot.length} слушателей`);
    }

    ['unsubscribeRepairs', 'unsubscribeVehicles', 'unsubscribeFuel', 'unsubscribeShifts', 'unsubscribeUserDoc']
        .forEach(name => {
            if (typeof window[name] === 'function') {
                try { window[name](); } catch (e) {}
                window[name] = null;
            }
        });

    window._isLoggingOut = true;
    setTimeout(() => { window._isLoggingOut = false; }, 2500);
}

function clearInMemoryState() {
    if (typeof window.records !== 'undefined') window.records = [];
    if (typeof window.tariffs !== 'undefined') window.tariffs = [];
    if (typeof window.fuelLogs !== 'undefined') window.fuelLogs = [];
    if (typeof window.repairRecords !== 'undefined') window.repairRecords = [];
    if (typeof window.vehicles !== 'undefined') window.vehicles = [];
    if (typeof window.shifts !== 'undefined') window.shifts = [];

    try { records = []; } catch (e) {}
    try { tariffs = []; } catch (e) {}
    try { fuelLogs = []; } catch (e) {}
    try { currentVehicleId = null; } catch (e) {}
    if (typeof window.currentVehicleId !== 'undefined') window.currentVehicleId = null;
}

// ============================================
// 🔥 ОЧИСТКА FIRESTORE
// ============================================
async function clearFirebaseUserData() {
    const fbDb = getFirebaseDb();
    const user = getCurrentUser();

    if (!fbDb || !user) {
        console.log('ℹ️ Firebase недоступен — пропускаем облачную очистку');
        return { skipped: true, errors: [] };
    }

    const userRef = fbDb.collection('users').doc(user.uid);
    const errors = [];

    for (const colName of FIRESTORE_COLLECTIONS) {
        try {
            const colRef = userRef.collection(colName);
            let totalDeleted = 0;
            let safety = 0;
            while (safety++ < 50) {
                const snap = await colRef.limit(400).get();
                if (snap.empty) break;
                const batch = fbDb.batch();
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                totalDeleted += snap.size;
                if (snap.size < 400) break;
            }
            console.log(`✅ ${colName}: удалено ${totalDeleted}`);
        } catch (error) {
            console.error(`❌ ${colName}:`, error.code || error.message);
            errors.push({ col: colName, error: error.code || error.message });
        }
    }

    // Поля пользователя
    try {
        const del = getFirebaseFieldValueDelete();
        if (del) {
            const update = {};
            FIRESTORE_USER_FIELDS.forEach(f => { update[f] = del; });
            await userRef.set(update, { merge: true });
            console.log('✅ Поля пользователя очищены:', FIRESTORE_USER_FIELDS.join(', '));
        } else {
            console.warn('⚠️ FieldValue.delete() недоступен');
        }
    } catch (error) {
        console.error('❌ Поля пользователя:', error.code || error.message);
        errors.push({ col: 'users/{uid}', error: error.code || error.message });
    }

    return { skipped: false, errors };
}

// ============================================
// 🔥 ПОЛНЫЙ СБРОС
// ============================================
async function resetAllAppData() {
    if (!confirm(
        '⚠️ ПОЛНЫЙ СБРОС!\n\nБудут удалены ВСЕ данные (локальные + облачные):\n' +
        '• Записи работы\n• Тарифы\n• Топливо\n• Ремонты (фото)\n• Смены\n• Автомобили\n• Настройки, цели, аватар\n\n' +
        'Отменить нельзя!\n\nПродолжить?'
    )) return;

    if (!confirm('🔴 ТОЧНО уверены?\n\nДанные удалятся из браузера И из Firebase навсегда!')) return;

    const overlay = showProgressOverlay('Удаление данных...');
    window._isResetting = true;

    try {
        unsubscribeAllFirebaseListeners();
        clearInMemoryState();

        // localStorage
        BACKUP_KEYS.forEach(key => localStorage.removeItem(key));
        Object.keys(localStorage).forEach(key => {
            if (/^(driver|repair|schedule|appState|historyViewMode|currentVehicle|connectionMode|__)/.test(key)) {
                localStorage.removeItem(key);
            }
        });
        console.log('✅ localStorage очищен');

        // Firestore
        const fbResult = await clearFirebaseUserData();

        if (fbResult.skipped) {
            updateProgressOverlay(overlay, '⚠️ Пользователь не авторизован.\nЛокальные данные удалены.', true);
            setTimeout(() => location.reload(), 2500);
            return;
        }

        if (fbResult.errors?.length > 0) {
            const errText = fbResult.errors.map(e => `• ${e.col}: ${e.error}`).join('\n');
            updateProgressOverlay(overlay, '❌ Ошибки Firestore:\n\n' + errText, true);
            setTimeout(() => location.reload(), 5000);
            return;
        }

        updateProgressOverlay(overlay, '✅ Все данные удалены.\nПерезагрузка...', true);
        setTimeout(() => location.reload(), 1200);
    } catch (error) {
        console.error('❌ Ошибка сброса:', error);
        updateProgressOverlay(overlay, '❌ Ошибка: ' + error.message, true);
        setTimeout(() => location.reload(), 3000);
    } finally {
        setTimeout(() => { window._isResetting = false; }, 2000);
    }
}

// ============================================
// 🎨 ОВЕРЛЕЙ
// ============================================
function showProgressOverlay(message) {
    const overlay = document.createElement('div');
    overlay.id = 'reset-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 999999;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    `;
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:32px 28px;max-width:340px;width:90%;
                    text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div class="reset-spinner" style="width:48px;height:48px;margin:0 auto 16px;
                border:4px solid #e5e7eb;border-top-color:#007AFF;border-radius:50%;
                animation:reset-spin 1s linear infinite;"></div>
            <div class="reset-message" style="font-size:16px;font-weight:600;color:#1f2937;line-height:1.4;white-space:pre-line;">
                ${message}
            </div>
        </div>
        <style>@keyframes reset-spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function updateProgressOverlay(overlay, message, hideSpinner = false) {
    if (!overlay) return;
    const spinner = overlay.querySelector('.reset-spinner');
    const msg = overlay.querySelector('.reset-message');
    if (spinner && hideSpinner) spinner.style.display = 'none';
    if (msg) msg.textContent = message;
}

// ============================================
// ЭКСПОРТ
// ============================================
window.exportFullBackup = exportFullBackup;
window.importFullBackup = importFullBackup;
window.resetAllAppData = resetAllAppData;
window.createFullBackup = createFullBackup;
window.createFullBackupAsync = createFullBackupAsync;
window.restoreFromBackup = restoreFromBackup;
window.clearFirebaseUserData = clearFirebaseUserData;
window.unsubscribeAllFirebaseListeners = unsubscribeAllFirebaseListeners;

console.log('✅ Модуль бэкапа и полного сброса загружен (v3.0)');