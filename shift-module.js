// ============================================
// МОДУЛЬ КАЛЕНДАРЯ СМЕН (ВЕРСИЯ 7.0)
// АБСОЛЮТНАЯ СИНХРОНИЗАЦИЯ + РЕЕСТР ОЧИЩЕННЫХ МЕСЯЦЕВ + ЗАЩИТА РУЧНЫХ НАСТРОЕК
// ============================================

const SHIFTS_STORAGE_KEY = 'driverShifts';
const SHIFTS_COLLECTION = 'shifts';
const SCHEDULE_SETTINGS_KEY = 'scheduleSettings';
const CLEARED_MONTHS_KEY = 'clearedShiftMonths';
const SUMMARY_STATE_KEY = 'shiftMonthSummaryState';

// ===== ЦВЕТА ДЛЯ ТИПОВ ДНЕЙ =====
const DEFAULT_COLORS = {
    work: '#5AC8FA',
    sick: '#8E8E93',
    vacation: '#34C759',
    dayoff: '#FFFFFF',
    repair: '#FF9500'
};

const ALLOWED_DAY_TYPES = ['work', 'sick', 'vacation', 'dayoff', 'repair'];

// ===== 1. СОСТОЯНИЕ МОДУЛЯ =====
let shifts = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let isFirebaseSync = false;
let firebaseUnsubscribe = null;
let recordsUnsubscribe = null;
let isRendering = false;
let scheduleSettings = {
    name: 'График 1',
    workDays: 3,
    restDays: 3,
    firstWorkDate: '08.08.2025',
    colors: { ...DEFAULT_COLORS }
};

// ===== УТИЛИТЫ БЕЗОПАСНОСТИ =====
function safeShowToast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
    else console.log('🔔 Toast:', message);
}

function safeUpdateTotals() {
    if (typeof window.updateTotals === 'function') window.updateTotals();
}

// ===== 2. КОНСТАНТЫ И УТИЛИТЫ =====
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 22;

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeDate(dateInput) {
    if (!dateInput) return '';
    if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) return dateInput;
    if (typeof dateInput === 'string' && dateInput.includes('.')) {
        const parts = dateInput.split('.');
        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    if (dateInput && typeof dateInput.toDate === 'function') return getLocalDateString(dateInput.toDate());
    if (dateInput instanceof Date) return getLocalDateString(dateInput);
    return String(dateInput);
}

function formatMoney(amount) {
    if (typeof window.formatMoney === 'function') return window.formatMoney(amount);
    const num = Number(amount) || 0;
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(num);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseDate(dateStr) {
    const parts = dateStr.split('.');
    if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
    return new Date(dateStr);
}

function getDaysWord(count) {
    const lastTwo = count % 100;
    const lastOne = count % 10;
    if (lastTwo >= 11 && lastTwo <= 19) return 'дней';
    if (lastOne === 1) return 'день';
    if (lastOne >= 2 && lastOne <= 4) return 'дня';
    return 'дней';
}

function getMonthPrefix(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// ===== 3. РЕЕСТР ОЧИЩЕННЫХ МЕСЯЦЕВ =====
function getClearedMonths() {
    try {
        const raw = localStorage.getItem(CLEARED_MONTHS_KEY);
        return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
        return new Set();
    }
}

function saveClearedMonths(set) {
    try {
        localStorage.setItem(CLEARED_MONTHS_KEY, JSON.stringify([...set]));
    } catch (e) {
        console.warn('Не удалось сохранить реестр очищенных месяцев', e);
    }
}

function markMonthCleared(prefix) {
    const s = getClearedMonths();
    s.add(prefix);
    saveClearedMonths(s);
}

function unmarkMonthCleared(prefix) {
    const s = getClearedMonths();
    s.delete(prefix);
    saveClearedMonths(s);
}

function isMonthCleared(prefix) {
    return getClearedMonths().has(prefix);
}

// ===== 4. РАБОТА С ИСТОРИЕЙ =====
function getHistoryRecords() {
    const r = (typeof window.records !== 'undefined') ? window.records
        : (typeof records !== 'undefined' ? records : []);
    return Array.isArray(r) ? r : [];
}

function getGroupedHistoryRecords() {
    const grouped = {};
    getHistoryRecords().forEach(record => {
        const date = normalizeDate(record.date);
        if (!date) return;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(record);
    });
    return grouped;
}

function getDailyMetrics(dateStr, groupedRecords) {
    const targetDate = normalizeDate(dateStr);
    const dayRecords = (groupedRecords || getGroupedHistoryRecords())[targetDate] || [];
    if (dayRecords.length === 0) {
        return { income: 0, orders: 0, hours: 0, expenses: 0, bonuses: 0 };
    }

    let income = 0, orders = 0, hours = 0, expenses = 0, bonuses = 0;

    dayRecords.forEach(r => {
        income += (Number(r.payPickup) || 0) + (Number(r.payDelivery) || 0) +
            (Number(r.payDistance) || 0) + (Number(r.payWeight) || 0) +
            (Number(r.loadPay) || 0) + (Number(r.bonusPay) || 0) +
            (Number(r.rating) || 0) + (Number(r.tips) || 0);
        orders += (Number(r.ordersDelivery) || 0);
        hours += (Number(r.hours) || 0);
        expenses += (Number(r.fuelCost) || 0) + (Number(r.repairCost) || 0) + (Number(r.tax) || 0);
        bonuses += Number(r.bonusPay) || 0;
    });

    return { income, orders, hours, expenses, bonuses };
}

// ===== 5. НАСТРОЙКИ ГРАФИКА =====
async function loadScheduleSettings() {
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            const doc = await db.collection('users').doc(auth.currentUser.uid)
                .collection('settings').doc(SCHEDULE_SETTINGS_KEY).get();
            if (doc.exists) {
                const data = doc.data();
                const cleanedColors = {};
                ALLOWED_DAY_TYPES.forEach(type => {
                    cleanedColors[type] = (data.colors && data.colors[type]) ? data.colors[type] : DEFAULT_COLORS[type];
                });
                scheduleSettings = {
                    name: data.name || 'График 1',
                    workDays: data.workDays || 3,
                    restDays: data.restDays || 3,
                    firstWorkDate: data.firstWorkDate || '08.08.2025',
                    colors: cleanedColors
                };
                localStorage.setItem(SCHEDULE_SETTINGS_KEY, JSON.stringify(scheduleSettings));
                return scheduleSettings;
            }
        } catch (error) { console.warn('⚠️ Ошибка Firebase:', error); }
    }

    const saved = localStorage.getItem(SCHEDULE_SETTINGS_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            const cleanedColors = {};
            ALLOWED_DAY_TYPES.forEach(type => {
                cleanedColors[type] = (parsed.colors && parsed.colors[type]) ? parsed.colors[type] : DEFAULT_COLORS[type];
            });
            scheduleSettings = {
                name: parsed.name || 'График 1',
                workDays: parsed.workDays || 3,
                restDays: parsed.restDays || 3,
                firstWorkDate: parsed.firstWorkDate || '08.08.2025',
                colors: cleanedColors
            };
            return scheduleSettings;
        } catch (e) { console.error(e); }
    }
    return scheduleSettings;
}

async function saveScheduleSettings(settings) {
    scheduleSettings = {
        name: settings.name || scheduleSettings.name,
        workDays: settings.workDays || scheduleSettings.workDays,
        restDays: settings.restDays || scheduleSettings.restDays,
        firstWorkDate: settings.firstWorkDate || scheduleSettings.firstWorkDate,
        colors: settings.colors || scheduleSettings.colors
    };
    localStorage.setItem(SCHEDULE_SETTINGS_KEY, JSON.stringify(scheduleSettings));
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            await db.collection('users').doc(auth.currentUser.uid)
                .collection('settings').doc(SCHEDULE_SETTINGS_KEY)
                .set(scheduleSettings, { merge: true });
        } catch (error) { console.error(error); }
    }
}

// ===== 6. СОХРАНЕНИЕ / ЗАГРУЗКА СМЕН =====
function saveShiftsLocal() {
    try {
        localStorage.setItem(SHIFTS_STORAGE_KEY, JSON.stringify(shifts));
        window.shifts = shifts;
    } catch (e) {
        console.error('Не удалось сохранить смены локально', e);
    }
}

async function saveShiftToFirebase(shift) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return false;
    if (!shift || !shift.id) return false;
    try {
        const shiftToSave = { ...shift };
        delete shiftToSave.id;
        await db.collection('users').doc(auth.currentUser.uid)
            .collection(SHIFTS_COLLECTION).doc(shift.id)
            .set(shiftToSave, { merge: true });
        return true;
    } catch (error) {
        console.warn('Ошибка сохранения смены:', error);
        return false;
    }
}

async function saveShiftsBatchToFirebase(shiftsArray) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return false;
    if (!shiftsArray || shiftsArray.length === 0) return true;
    try {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < shiftsArray.length; i += CHUNK_SIZE) {
            const batch = db.batch();
            for (const shift of shiftsArray.slice(i, i + CHUNK_SIZE)) {
                if (!shift.id) continue;
                const shiftToSave = { ...shift };
                delete shiftToSave.id;
                const ref = db.collection('users').doc(auth.currentUser.uid)
                    .collection(SHIFTS_COLLECTION).doc(shift.id);
                batch.set(ref, shiftToSave, { merge: true });
            }
            await batch.commit();
        }
        return true;
    } catch (error) {
        console.error('Ошибка пакетного сохранения в Firebase:', error);
        return false;
    }
}

async function deleteShiftsFromFirebase(shiftIds) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return false;
    if (!shiftIds || shiftIds.length === 0) return true;
    try {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < shiftIds.length; i += CHUNK_SIZE) {
            const batch = db.batch();
            for (const id of shiftIds.slice(i, i + CHUNK_SIZE)) {
                if (!id) continue;
                batch.delete(db.collection('users').doc(auth.currentUser.uid)
                    .collection(SHIFTS_COLLECTION).doc(id));
            }
            await batch.commit();
        }
        return true;
    } catch (error) {
        console.error('Ошибка удаления из Firebase:', error);
        return false;
    }
}

// ===== 7. СИНХРОНИЗАЦИЯ С FIREBASE =====
async function loadShifts() {
    try {
        await loadScheduleSettings();
        const saved = localStorage.getItem(SHIFTS_STORAGE_KEY);
        if (saved) {
            try { shifts = JSON.parse(saved) || []; }
            catch (e) { shifts = []; }
        }

        updateShiftDataFromHistory();
        await renderCalendar();

        if (typeof auth !== 'undefined' && typeof db !== 'undefined') {
            if (!auth.currentUser) {
                await new Promise((resolve) => {
                    const unsub = auth.onAuthStateChanged((user) => { unsub(); resolve(user); });
                });
            }
            if (auth.currentUser) {
                if (firebaseUnsubscribe) {
                    try { firebaseUnsubscribe(); } catch (e) { }
                    firebaseUnsubscribe = null;
                }
                firebaseUnsubscribe = db.collection('users').doc(auth.currentUser.uid)
                    .collection(SHIFTS_COLLECTION).orderBy('date', 'asc')
                    .onSnapshot((snapshot) => {
                        const firebaseShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        mergeFirebaseWithLocal(firebaseShifts);
                        isFirebaseSync = true;
                        saveShiftsLocal();
                        renderCalendar();
                        safeUpdateTotals();
                    }, (error) => console.error('Ошибка подписки на смены:', error));

                await loadShiftsFromFirebase();
            }
        }
    } catch (error) {
        console.error('Ошибка loadShifts:', error);
    }
}

async function loadShiftsFromFirebase() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    try {
        const snapshot = await db.collection('users').doc(auth.currentUser.uid)
            .collection(SHIFTS_COLLECTION).orderBy('date', 'asc').get();
        if (!snapshot.empty) {
            mergeFirebaseWithLocal(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            isFirebaseSync = true;
            saveShiftsLocal();
        }
    } catch (error) { console.error('Ошибка loadShiftsFromFirebase:', error); }
}

/**
 * Мерж облачных смен с локальными.
 * Приоритет:
 *   1. manualOverride у локальной → локальная полностью побеждает
 *   2. Иначе берём облачную, но подтягиваем актуальные метрики из истории
 *   3. Локальные смены, отсутствующие в облаке, сохраняем (защита от потерь)
 *   4. Очищенные месяцы — облачные смены в них НЕ добавляем
 */
function mergeFirebaseWithLocal(firebaseShifts) {
    const grouped = getGroupedHistoryRecords();
    const clearedMonths = getClearedMonths();
    const localById = new Map(shifts.map(s => [s.id, s]));
    const result = [];

    // 1. Обрабатываем облачные смены
    firebaseShifts.forEach(fbShift => {
        const prefix = String(fbShift.date).slice(0, 7);

        // Месяц очищен — не добавляем облачную смену
        if (clearedMonths.has(prefix)) return;

        const localShift = localById.get(fbShift.id);

        // Ручная локальная настройка — она главнее
        if (localShift && localShift.manualOverride) {
            const metrics = getDailyMetrics(fbShift.date, grouped);
            const updated = { ...localShift };
            if (metrics.income > 0) updated.income = metrics.income;
            if (metrics.orders > 0) updated.orders = metrics.orders;
            if (metrics.hours > 0) updated.hours = metrics.hours;
            if (metrics.expenses > 0) updated.expenses = metrics.expenses;
            if (metrics.bonuses > 0) updated.bonuses = metrics.bonuses;
            result.push(updated);
            localById.delete(fbShift.id);
            return;
        }

        const metrics = getDailyMetrics(fbShift.date, grouped);
        const updated = { ...fbShift };
        if (metrics.income > 0) updated.income = metrics.income;
        if (metrics.orders > 0) updated.orders = metrics.orders;
        if (metrics.hours > 0) updated.hours = metrics.hours;
        if (metrics.expenses > 0) updated.expenses = metrics.expenses;
        if (metrics.bonuses > 0) updated.bonuses = metrics.bonuses;
        result.push(updated);
        localById.delete(fbShift.id);
    });

    // 2. Локальные смены, которых нет в облаке — сохраняем (кроме очищенных месяцев)
    localById.forEach(localShift => {
        const prefix = String(localShift.date).slice(0, 7);
        if (clearedMonths.has(prefix)) return;
        result.push(localShift);
    });

    shifts = result;
    window.shifts = shifts;
}

function listenToRecordsChanges() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    if (recordsUnsubscribe) {
        try { recordsUnsubscribe(); } catch (e) { }
        recordsUnsubscribe = null;
    }
}

// ===== 8. ОБНОВЛЕНИЕ ДАННЫХ ИЗ ИСТОРИИ =====
function updateShiftDataFromHistory() {
    const grouped = getGroupedHistoryRecords();
    const hasRecords = Object.keys(grouped).length > 0;
    if (!hasRecords) return;

    let changed = false;
    for (const shift of shifts) {
        const targetDate = normalizeDate(shift.date);
        const dayRecords = grouped[targetDate];
        if (!dayRecords || dayRecords.length === 0) continue;

        const metrics = getDailyMetrics(targetDate, grouped);
        if (Number(shift.expenses) !== Number(metrics.expenses)) {
            shift.expenses = metrics.expenses;
            changed = true;
        }
    }

    if (changed) saveShiftsLocal();
}

// ===== 9. ЛОГИКА ГРАФИКА =====
function isWorkingDayBySchedule(dateStr) {
    const firstWorkDate = parseDate(scheduleSettings.firstWorkDate);
    const currentDate = new Date(dateStr + 'T00:00:00');
    const diffTime = currentDate.getTime() - firstWorkDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return false;
    const cycleLength = scheduleSettings.workDays + scheduleSettings.restDays;
    if (cycleLength <= 0) return false;
    const dayInCycle = diffDays % cycleLength;
    return dayInCycle < scheduleSettings.workDays;
}

// ===== 10. ОЧИСТКА МЕСЯЦА =====
async function clearMonthShifts() {
    const datePrefix = getMonthPrefix(currentYear, currentMonth);
    const monthStr = String(currentMonth + 1).padStart(2, '0');

    if (!confirm(`🗑️ Удалить все смены за ${monthStr}.${currentYear}?\n\nМесяц будет помечен как очищенный — автогенерация по графику больше не будет его заполнять.`)) return;

    const toRemove = shifts.filter(s => String(s.date).trim().startsWith(datePrefix));
    const ids = toRemove.map(s => s.id).filter(Boolean);

    if (toRemove.length === 0) {
        // Даже если смен нет — помечаем месяц, чтобы избежать автогенерации
        markMonthCleared(datePrefix);
        safeShowToast(`ℹ️ Месяц ${monthStr}.${currentYear} помечен как очищенный`);
        await renderCalendar();
        return;
    }

    // 1. Удаляем из Firebase
    if (ids.length > 0) {
        await deleteShiftsFromFirebase(ids);
    }

    // 2. Удаляем из локального массива
    shifts = shifts.filter(s => !String(s.date).trim().startsWith(datePrefix));

    // 3. Помечаем месяц как очищенный
    markMonthCleared(datePrefix);

    // 4. Сохраняем и перерисовываем
    saveShiftsLocal();
    await renderCalendar();
    safeShowToast(`✅ Удалено ${toRemove.length} смен за ${monthStr}.${currentYear}`);
}

// ===== 11. ГЕНЕРАЦИЯ ГРАФИКА =====
/**
 * Генерирует смены на текущий месяц по графику.
 * ⚠️ НЕ вызывает renderCalendar сам — вызывающий код должен его вызвать.
 * ⚠️ НЕ перезаписывает смены с manualOverride.
 * ⚠️ Убирает из реестра "очищенных" текущий месяц (т.к. генерируем заново).
 */
async function generateShiftsBySettings() {
    const datePrefix = getMonthPrefix(currentYear, currentMonth);
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = getLocalDateString();

    // Собираем существующие смены этого месяца
    const existingShiftsMap = new Map();
    shifts.filter(s => String(s.date).startsWith(datePrefix)).forEach(s => {
        existingShiftsMap.set(s.date, s);
    });

    // Удаляем из Firebase только те смены, что НЕ имеют manualOverride
    const toDeleteIds = [];
    existingShiftsMap.forEach((s) => {
        if (!s.manualOverride && s.id) toDeleteIds.push(s.id);
    });

    if (toDeleteIds.length > 0) {
        await deleteShiftsFromFirebase(toDeleteIds);
    }

    // Оставляем в локальном массиве только ручные смены этого месяца
    const manualShiftsThisMonth = new Map();
    shifts = shifts.filter(s => {
        if (!String(s.date).startsWith(datePrefix)) return true;
        if (s.manualOverride) {
            manualShiftsThisMonth.set(s.date, s);
            return true;
        }
        return false;
    });

    const grouped = getGroupedHistoryRecords();
    const newMonthShifts = [];

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${datePrefix}-${String(day).padStart(2, '0')}`;

        // Ручная смена — оставляем как есть (уже в shifts)
        if (manualShiftsThisMonth.has(dateStr)) continue;

        const existing = existingShiftsMap.get(dateStr);
        const scheduleIsWorking = isWorkingDayBySchedule(dateStr);
        const metrics = getDailyMetrics(dateStr, grouped);
        const isPast = dateStr < today;

        let finalIsWorking;
        if (isPast) {
            finalIsWorking = metrics.orders > 0 || metrics.expenses > 0;
        } else {
            finalIsWorking = scheduleIsWorking;
        }

        newMonthShifts.push({
            id: existing ? existing.id : 'shift_' + dateStr,
            date: dateStr,
            isWorking: finalIsWorking,
            startTime: finalIsWorking ? `${WORK_START_HOUR}:00` : null,
            endTime: finalIsWorking ? `${WORK_END_HOUR}:00` : null,
            income: metrics.income,
            orders: metrics.orders,
            hours: finalIsWorking ? (WORK_END_HOUR - WORK_START_HOUR) : 0,
            expenses: metrics.expenses,
            bonuses: metrics.bonuses,
            notes: existing ? existing.notes : '',
            dayType: finalIsWorking ? 'work' : 'dayoff',
            manualOverride: false,
            updatedAt: new Date().toISOString()
        });
    }

    shifts.push(...newMonthShifts);

    // Генерация = снимаем пометку "очищен"
    unmarkMonthCleared(datePrefix);

    saveShiftsLocal();

    const fbAvailable = (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined');
    if (!fbAvailable) {
        safeShowToast('✅ График обновлён (локально)');
        return;
    }

    const saved = await saveShiftsBatchToFirebase(newMonthShifts);
    if (saved) safeShowToast('✅ График создан и синхронизирован');
    else safeShowToast('⚠️ График сохранён локально, облако догонит');
}

// ===== 12. МОДАЛЬНОЕ ОКНО НАСТРОЕК ГРАФИКА =====
function showScheduleSettingsModal() {
    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
    overlay.innerHTML = `
        <div class="shift-modal" style="max-width: 400px; max-height: 90vh; overflow-y: auto;">
            <div class="shift-modal-header">
                <ion-icon name="settings-outline"></ion-icon>
                <h3>Настройка графика</h3>
                <button class="shift-modal-close" onclick="this.closest('.shift-modal-overlay').remove()"><ion-icon name="close-outline"></ion-icon></button>
            </div>
            <div class="shift-modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 6px;">Название</label>
                    <input type="text" id="schedule-name" value="${scheduleSettings.name}" style="width: 100%; padding: 10px; border: 1px solid var(--ios-border); border-radius: 10px; font-size: 15px; background: var(--ios-bg-input); color: var(--ios-text-primary);" placeholder="График 1">
                </div>
                <div style="margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: var(--ios-text-primary); margin-bottom: 12px;">Выберите график</h4>
                    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px;">
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${[1,2,3,4,5,6,7].map(n => `<button class="schedule-day-btn ${n === scheduleSettings.workDays ? 'selected' : ''}" data-type="work" data-value="${n}" style="width: 32px; height: 32px; border-radius: 8px; border: 2px solid ${n === scheduleSettings.workDays ? 'var(--ios-accent)' : 'var(--ios-border)'}; background: ${n === scheduleSettings.workDays ? 'var(--ios-accent)' : 'var(--ios-bg-secondary)'}; color: ${n === scheduleSettings.workDays ? 'white' : 'var(--ios-text-primary)'}; font-size: 13px; font-weight: 600; cursor: pointer; flex-shrink: 0;">${n}</button>`).join('')}
                        </div>
                        <span style="color: var(--ios-text-secondary); font-size: 13px; white-space: nowrap;">через</span>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${[1,2,3,4,5,6,7].map(n => `<button class="schedule-day-btn ${n === scheduleSettings.restDays ? 'selected' : ''}" data-type="rest" data-value="${n}" style="width: 32px; height: 32px; border-radius: 8px; border: 2px solid ${n === scheduleSettings.restDays ? 'var(--ios-accent)' : 'var(--ios-border)'}; background: ${n === scheduleSettings.restDays ? 'var(--ios-accent)' : 'var(--ios-bg-secondary)'}; color: ${n === scheduleSettings.restDays ? 'white' : 'var(--ios-text-primary)'}; font-size: 13px; font-weight: 600; cursor: pointer; flex-shrink: 0;">${n}</button>`).join('')}
                        </div>
                    </div>
                </div>
                <div style="margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: var(--ios-text-primary); margin-bottom: 12px;">Настройте дни</h4>
                    <div id="schedule-days-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
                <div style="margin-bottom: 24px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 6px;">Дата первого рабочего дня</label>
                    <input type="date" id="schedule-first-date" value="${scheduleSettings.firstWorkDate.split('.').reverse().join('-')}" style="width: 100%; padding: 10px; border: 1px solid var(--ios-border); border-radius: 10px; font-size: 15px; background: var(--ios-bg-input); color: var(--ios-text-primary);">
                </div>
            </div>
            <div class="shift-modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.shift-modal-overlay').remove()"><ion-icon name="close-outline"></ion-icon> Отмена</button>
                <button class="btn btn-primary" onclick="saveScheduleSettingsFromModal()"><ion-icon name="checkmark-outline"></ion-icon> Сохранить</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        initScheduleDayButtons();
        updateScheduleDaysList();
    });
}

function initScheduleDayButtons() {
    document.querySelectorAll('.schedule-day-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const type = this.dataset.type;
            const value = parseInt(this.dataset.value);
            if (type === 'work') scheduleSettings.workDays = value;
            else scheduleSettings.restDays = value;
            document.querySelectorAll(`.schedule-day-btn[data-type="${type}"]`).forEach(b => {
                b.style.border = '2px solid var(--ios-border)';
                b.style.background = 'var(--ios-bg-secondary)';
                b.style.color = 'var(--ios-text-primary)';
            });
            this.style.border = '2px solid var(--ios-accent)';
            this.style.background = 'var(--ios-accent)';
            this.style.color = 'white';
            updateScheduleDaysList();
        });
    });
}

function updateScheduleDaysList() {
    const container = document.getElementById('schedule-days-list');
    if (!container) return;
    let html = '';
    for (let i = 1; i <= scheduleSettings.workDays; i++) {
        html += `<div style="padding: 10px 14px; background: var(--ios-bg-primary); border-radius: 10px; border: 1px solid var(--ios-border);"><span style="font-size: 14px; font-weight: 600; color: var(--ios-text-primary);">${i}. Рабочий день</span></div>`;
    }
    for (let i = 1; i <= scheduleSettings.restDays; i++) {
        html += `<div style="padding: 10px 14px; background: var(--ios-bg-secondary); border-radius: 10px; border: 1px solid var(--ios-border); opacity: 0.6;"><span style="font-size: 14px; font-weight: 600; color: var(--ios-text-secondary);">${i}. Выходной</span></div>`;
    }
    container.innerHTML = html;
}

async function saveScheduleSettingsFromModal() {
    const nameInput = document.getElementById('schedule-name');
    const dateInput = document.getElementById('schedule-first-date');
    if (!nameInput || !dateInput) return;
    const name = nameInput.value.trim() || 'График 1';
    const formattedDate = dateInput.value.split('-').reverse().join('.');
    await saveScheduleSettings({ name, firstWorkDate: formattedDate, colors: scheduleSettings.colors });
    await generateShiftsBySettings();
    const overlay = document.querySelector('.shift-modal-overlay');
    if (overlay) overlay.remove();
    await renderCalendar();
    safeShowToast(`✅ Настройки сохранены`);
}

// ===== 13. ПЕРЕКЛЮЧЕНИЕ СМЕНЫ =====
async function toggleShift(dateStr) {
    const existing = shifts.find(s => s.date === dateStr);
    if (existing) {
        existing.isWorking = !existing.isWorking;
        existing.startTime = existing.isWorking ? `${WORK_START_HOUR}:00` : null;
        existing.endTime = existing.isWorking ? `${WORK_END_HOUR}:00` : null;
        existing.hours = existing.isWorking ? (WORK_END_HOUR - WORK_START_HOUR) : 0;
        existing.manualOverride = true;
        existing.updatedAt = new Date().toISOString();
        saveShiftsLocal();
        await saveShiftToFirebase(existing);
    } else {
        await saveShift({ date: dateStr, isWorking: true, notes: '', manualOverride: true });
    }
    await renderCalendar();
}

async function saveShift(shiftData) {
    const dateStr = shiftData.date;
    const idx = shifts.findIndex(s => s.date === dateStr);
    const grouped = getGroupedHistoryRecords();
    const metrics = getDailyMetrics(dateStr, grouped);
    const isWorking = shiftData.isWorking;

    const newShift = {
        id: idx !== -1 ? shifts[idx].id : 'shift_' + dateStr,
        date: dateStr,
        isWorking: isWorking,
        startTime: isWorking ? `${WORK_START_HOUR}:00` : null,
        endTime: isWorking ? `${WORK_END_HOUR}:00` : null,
        income: metrics.income,
        orders: metrics.orders,
        hours: isWorking ? (WORK_END_HOUR - WORK_START_HOUR) : 0,
        expenses: metrics.expenses,
        bonuses: metrics.bonuses,
        notes: shiftData.notes || '',
        dayType: isWorking ? 'work' : 'dayoff',
        manualOverride: shiftData.manualOverride !== false,
        updatedAt: new Date().toISOString()
    };

    if (idx !== -1) shifts[idx] = { ...shifts[idx], ...newShift };
    else shifts.push(newShift);

    saveShiftsLocal();
    await saveShiftToFirebase(newShift);
    await renderCalendar();
}

// ===== 14. РЕДАКТИРОВАНИЕ СМЕНЫ =====
function editShift(dateStr) {
    selectedDate = dateStr;
    showShiftModal(dateStr);
}

function showShiftModal(dateStr) {
    const shift = shifts.find(s => s.date === dateStr);
    const notes = (shift && shift.notes) ? shift.notes : '';
    const dayType = shift ? (shift.dayType || (shift.isWorking ? 'work' : 'dayoff')) : 'dayoff';

    const grouped = getGroupedHistoryRecords();
    const metrics = getDailyMetrics(dateStr, grouped);

    const isManual = shift && shift.manualOverride;
    const income = isManual ? (Number(shift.income) || 0) : metrics.income;
    const orders = isManual ? (Number(shift.orders) || 0) : metrics.orders;
    const hours = isManual ? (Number(shift.hours) || 0) : metrics.hours;
    const expenses = isManual ? (Number(shift.expenses) || 0) : metrics.expenses;
    const bonuses = isManual ? (Number(shift.bonuses) || 0) : metrics.bonuses;

    const netIncome = income + bonuses - expenses;

    const dayTypeIcons = { work: 'briefcase-outline', sick: 'medical-outline', vacation: 'airplane-outline', dayoff: 'remove-circle-outline', repair: 'construct-outline' };
    const dayTypeNames = { work: 'Рабочий день', sick: 'Больничный', vacation: 'Отпуск', dayoff: 'Выходной', repair: 'Ремонт' };

    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
    overlay.dataset.selectedDayType = dayType;
    overlay.innerHTML = `
        <div class="shift-modal">
            <div class="shift-modal-header">
                <ion-icon name="calendar-outline"></ion-icon>
                <h3>${formatDate(dateStr)}</h3>
                <button class="shift-modal-close" onclick="this.closest('.shift-modal-overlay').remove()"><ion-icon name="close-outline"></ion-icon></button>
            </div>
            <div class="shift-modal-body">
                <div class="shift-modal-stats">
                    <div class="stat-item"><span class="label"><ion-icon name="cash-outline"></ion-icon> Доход</span><span class="value income">${formatMoney(income)}</span></div>
                    <div class="stat-item"><span class="label"><ion-icon name="cube-outline"></ion-icon> Заказы</span><span class="value">${orders}</span></div>
                    <div class="stat-item"><span class="label"><ion-icon name="time-outline"></ion-icon> Часы</span><span class="value">${hours}</span></div>
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 8px;">Тип дня</label>
                    <div id="day-type-selector" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(65px, 1fr)); gap: 6px;">
                        ${Object.entries(dayTypeIcons).map(([type, icon]) => `
                            <button class="day-type-btn ${type === dayType ? 'active' : ''}" data-type="${type}" style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; border: 2px solid ${type === dayType ? 'var(--ios-accent)' : 'var(--ios-border)'}; background: ${type === dayType ? 'var(--ios-accent)' : 'var(--ios-bg-secondary)'}; color: ${type === dayType ? 'white' : 'var(--ios-text-primary)'}; cursor: pointer;">
                                <ion-icon name="${icon}"></ion-icon>
                                <span>${dayTypeNames[type]}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                    <div class="shift-modal-expenses">
                        <label style="font-size: 11px; color: var(--ios-text-secondary);"><ion-icon name="wallet-outline"></ion-icon> Расходы</label>
                        <input type="number" id="shift-expenses-input" value="${expenses}" style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--ios-border); font-size: 13px; background: var(--ios-bg-input); color: var(--ios-text-primary);" placeholder="0">
                    </div>
                    <div class="shift-modal-bonuses">
                        <label style="font-size: 11px; color: var(--ios-text-secondary);"><ion-icon name="gift-outline"></ion-icon> Бонусы</label>
                        <input type="number" id="shift-bonuses-input" value="${bonuses}" style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--ios-border); font-size: 13px; background: var(--ios-bg-input); color: var(--ios-text-primary);" placeholder="0">
                    </div>
                </div>
                <div style="padding: 10px; background: ${netIncome >= 0 ? 'rgba(48, 209, 88, 0.1)' : 'rgba(255, 69, 58, 0.1)'}; border-radius: 8px; margin-bottom: 12px; border: 1px solid ${netIncome >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)'};">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 12px; font-weight: 600; color: var(--ios-text-secondary);"><ion-icon name="cash-outline"></ion-icon> Чистый доход</span>
                        <span style="font-size: 16px; font-weight: 700; color: ${netIncome >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)'};">${formatMoney(netIncome)}</span>
                    </div>
                </div>
                <div class="shift-modal-notes">
                    <label><ion-icon name="document-text-outline"></ion-icon> Заметки</label>
                    <textarea id="shift-notes-input" rows="2" placeholder="Заметки о смене...">${notes}</textarea>
                </div>
            </div>
            <div class="shift-modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.shift-modal-overlay').remove()"><ion-icon name="close-outline"></ion-icon> Закрыть</button>
                <button class="btn btn-primary" onclick="saveShiftDetails('${dateStr}')"><ion-icon name="checkmark-outline"></ion-icon> Сохранить</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    overlay.querySelectorAll('.day-type-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const selectedType = this.dataset.type;
            overlay.querySelectorAll('.day-type-btn').forEach(b => {
                b.style.border = '2px solid var(--ios-border)';
                b.style.background = 'var(--ios-bg-secondary)';
                b.style.color = 'var(--ios-text-primary)';
            });
            this.style.border = '2px solid var(--ios-accent)';
            this.style.background = 'var(--ios-accent)';
            this.style.color = 'white';
            overlay.dataset.selectedDayType = selectedType;
        });
    });
}

async function saveShiftDetails(dateStr) {
    const notesInput = document.getElementById('shift-notes-input');
    const expensesInput = document.getElementById('shift-expenses-input');
    const bonusesInput = document.getElementById('shift-bonuses-input');
    if (!notesInput) return;

    const overlay = document.querySelector('.shift-modal-overlay');
    if (!overlay) return;
    const selectedDayType = overlay.dataset.selectedDayType || 'dayoff';

    let shift = shifts.find(s => s.date === dateStr);
    if (!shift) {
        shift = {
            id: 'shift_' + dateStr,
            date: dateStr,
            isWorking: false,
            startTime: null,
            endTime: null,
            income: 0,
            orders: 0,
            hours: 0,
            expenses: 0,
            bonuses: 0,
            notes: '',
            dayType: 'dayoff',
            manualOverride: false,
            updatedAt: new Date().toISOString()
        };
        shifts.push(shift);
    }

    shift.notes = notesInput.value;
    shift.expenses = expensesInput ? Number(expensesInput.value) || 0 : 0;
    shift.bonuses = bonusesInput ? Number(bonusesInput.value) || 0 : 0;
    shift.dayType = selectedDayType;
    shift.isWorking = (selectedDayType === 'work');
    shift.manualOverride = true;
    shift.updatedAt = new Date().toISOString();

    if (selectedDayType === 'work') {
        shift.startTime = `${WORK_START_HOUR}:00`;
        shift.endTime = `${WORK_END_HOUR}:00`;
        shift.hours = WORK_END_HOUR - WORK_START_HOUR;
    } else {
        shift.startTime = null;
        shift.endTime = null;
        shift.hours = 0;
    }

    saveShiftsLocal();
    await saveShiftToFirebase(shift);
    safeShowToast('✅ Данные смены сохранены');
    overlay.remove();
    await renderCalendar();
    safeUpdateTotals();
}

// ===== 15. РЕНДЕР КАЛЕНДАРЯ =====
async function renderCalendar() {
    if (isRendering) return;
    isRendering = true;
    try {
        const container = document.getElementById('shift-calendar');
        if (!container) return;

        // ⭐ НЕ генерируем автоматически! Только отображаем то, что есть.

        const allRecords = getHistoryRecords();
        const normDate = normalizeDate;

        const recIncome = r => (Number(r.payPickup) || 0) + (Number(r.payDelivery) || 0) + (Number(r.payDistance) || 0) + (Number(r.payWeight) || 0) + (Number(r.loadPay) || 0) + (Number(r.bonusPay) || 0) + (Number(r.rating) || 0) + (Number(r.tips) || 0);
        const recExpenses = r => (Number(r.fuelCost) || 0) + (Number(r.repairCost) || 0) + (Number(r.tax) || 0);
        const recOrders = r => Number(r.ordersDelivery) || 0;
        const recBonuses = r => Number(r.bonusPay) || 0;
        const recHours = r => Number(r.hours) || 0;

        const groupedFresh = {};
        allRecords.forEach(r => {
            const d = normDate(r.date);
            if (!d) return;
            if (!groupedFresh[d]) groupedFresh[d] = [];
            groupedFresh[d].push(r);
        });

        const getDayMetrics = (dateStr) => {
            const recs = groupedFresh[dateStr] || [];
            const m = { income: 0, expenses: 0, orders: 0, bonuses: 0, hours: 0 };
            recs.forEach(r => {
                m.income += recIncome(r);
                m.expenses += recExpenses(r);
                m.orders += recOrders(r);
                m.bonuses += recBonuses(r);
                m.hours += recHours(r);
            });
            return m;
        };

        const datePrefix = getMonthPrefix(currentYear, currentMonth);

        // Обновляем expenses у смен из истории (но не трогаем ручные настройки)
        shifts.forEach(shift => {
            if (!String(shift.date).startsWith(datePrefix)) return;
            const d = normDate(shift.date);
            const dayRecs = groupedFresh[d];
            if (dayRecs && dayRecs.length > 0) {
                let exp = 0;
                dayRecs.forEach(r => { exp += recExpenses(r); });
                if (Number(shift.expenses) !== Number(exp)) {
                    shift.expenses = exp;
                }
            }
        });

        const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        const today = getLocalDateString();
        const dayTypeIcons = { work: 'briefcase-outline', sick: 'medical-outline', vacation: 'airplane-outline', dayoff: 'remove-circle-outline', repair: 'construct-outline' };

        let totalIncome = 0, totalBonuses = 0, totalExpenses = 0, totalOrders = 0, totalHours = 0;

        allRecords.forEach(r => {
            const d = normDate(r.date);
            if (!d || !d.startsWith(datePrefix)) return;
            totalIncome += recIncome(r);
            totalExpenses += recExpenses(r);
            totalOrders += recOrders(r);
            totalBonuses += recBonuses(r);
            totalHours += recHours(r);
        });
        totalHours = Math.round(totalHours * 10) / 10;

        const workingDays = shifts.filter(s => String(s.date).startsWith(datePrefix) && s.isWorking).length;
        const netIncome = totalIncome - totalExpenses;
        const avgIncome = workingDays > 0 ? totalIncome / workingDays : 0;
        const avgHourlyRate = totalHours > 0 ? netIncome / totalHours : 0;

        let html = `
            <div class="shift-calendar-header">
                <button class="shift-nav-btn" onclick="changeMonth(-1)"><ion-icon name="chevron-back-outline"></ion-icon></button>
                <div style="text-align: center;">
                    <h2>${monthNames[currentMonth]} ${currentYear}</h2>
                    <div style="font-size: 11px; color: var(--ios-text-secondary); margin-top: 2px;">${scheduleSettings.name} · ${scheduleSettings.workDays}/${scheduleSettings.restDays}</div>
                </div>
                <button class="shift-nav-btn" onclick="changeMonth(1)"><ion-icon name="chevron-forward-outline"></ion-icon></button>
            </div>
            <div class="shift-calendar-actions">
                <button class="btn btn-small btn-primary" onclick="showScheduleSettingsModal()"><ion-icon name="settings-outline"></ion-icon> Настроить график</button>
                <button class="btn btn-small btn-secondary" onclick="applyScheduleToMonth()"><ion-icon name="refresh-outline"></ion-icon> Применить</button>
                <button class="btn btn-small btn-danger" onclick="clearMonthShifts()"><ion-icon name="trash-outline"></ion-icon> Очистить</button>
            </div>
            <div class="shift-weekdays">
                ${dayNames.map(day => `<div class="shift-weekday">${day}</div>`).join('')}
            </div>
            <div class="shift-days-grid">
        `;

        const firstDay = new Date(currentYear, currentMonth, 1);
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const startOffset = (firstDay.getDay() + 6) % 7;
        for (let i = 0; i < startOffset; i++) html += `<div class="shift-day empty"></div>`;

        const monthCleared = isMonthCleared(datePrefix);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${datePrefix}-${String(day).padStart(2, '0')}`;
            const shift = shifts.find(s => s.date === dateStr);
            const metrics = getDayMetrics(dateStr);
            const income = metrics.income;
            const orders = metrics.orders;
            const expenses = metrics.expenses;
            const isPast = dateStr < today;
            const isToday = dateStr === today;
            const isFuture = dateStr > today;

            let isWorking = false;
            let dayType = 'dayoff';

            if (shift) {
                isWorking = shift.isWorking;
                dayType = shift.dayType || (isWorking ? 'work' : 'dayoff');
            } else if (monthCleared) {
                // Месяц очищен — не показываем "виртуальные" смены по графику
                isWorking = false;
                dayType = 'dayoff';
            } else if (isPast) {
                isWorking = orders > 0 || expenses > 0;
                dayType = isWorking ? 'work' : 'dayoff';
            } else {
                isWorking = isWorkingDayBySchedule(dateStr);
                dayType = isWorking ? 'work' : 'dayoff';
            }

            const dayColor = scheduleSettings.colors[dayType] || DEFAULT_COLORS[dayType];
            let dayClass = 'shift-day';
            if (isToday) dayClass += ' today';
            if (isWorking) dayClass += ' working';
            else if (!isWorking && !isFuture) dayClass += ' day-off';
            else if (!isWorking && isFuture) dayClass += ' future-day-off';

            const net = income - expenses;
            const fmtShort = (v) => {
                const a = Math.abs(v);
                return a >= 1000 ? (a / 1000).toFixed(1) + 'k' : Math.round(a).toString();
            };
            let statusIconHtml = '';

            if (net !== 0) {
                const sign = net > 0 ? '+' : '-';
                const cls = net > 0 ? 'shift-day-net positive' : 'shift-day-net negative';
                statusIconHtml += `<div class="${cls}" data-net="${sign}${fmtShort(net)}"><ion-icon name="cash-outline"></ion-icon>${sign}${fmtShort(net)}</div>`;
            }
            if (orders > 0) {
                statusIconHtml += `<div class="shift-day-orders" data-orders="${orders}"><ion-icon name="cube-outline"></ion-icon>${orders}</div>`;
            }
            if (!statusIconHtml) {
                statusIconHtml = `<div class="shift-day-status"><ion-icon name="${dayTypeIcons[dayType] || (isWorking ? 'briefcase-outline' : 'remove-circle-outline')}"></ion-icon></div>`;
            }
            html += `<div class="${dayClass}" onclick="editShift('${dateStr}')" style="border-color: ${dayColor}40; background: ${dayColor}20;"><div class="shift-day-number">${day}</div><div class="shift-day-body">${statusIconHtml}</div></div>`;
        }
        html += `</div>`;

        const dayTypeCounts = { work: 0, sick: 0, vacation: 0, dayoff: 0, repair: 0 };
        shifts.forEach(s => {
            if (String(s.date).startsWith(datePrefix) && s.dayType) {
                if (dayTypeCounts[s.dayType] !== undefined) dayTypeCounts[s.dayType]++;
                else dayTypeCounts.dayoff++;
            }
        });

        const dayTypeConfig = {
            work: { icon: 'briefcase-outline', color: '#5AC8FA', label: 'Рабочие' },
            sick: { icon: 'medical-outline', color: '#8E8E93', label: 'Больничные' },
            vacation: { icon: 'airplane-outline', color: '#34C759', label: 'Отпуск' },
            dayoff: { icon: 'remove-circle-outline', color: '#8E8E93', label: 'Выходные' },
            repair: { icon: 'construct-outline', color: '#FF9500', label: 'Ремонт' }
        };

        injectStyles();

        const netIncomeClass = netIncome >= 0 ? 'positive' : 'negative';
        html += `
        <div class="month-summary-wrapper">
            <div class="month-summary-toggle" onclick="toggleMonthSummary(this)">
                <span class="shift-icon-badge shift-icon-sm shift-icon-blue"><ion-icon name="stats-chart-outline"></ion-icon></span>
                <h4>Итоги месяца</h4>
                <ion-icon name="chevron-down-outline" class="toggle-chevron"></ion-icon>
            </div>
            <div class="month-summary-content">
                <div class="month-summary-card">
                    <div class="summary-hero">
                        <span class="hero-label">ЧИСТЫЙ ДОХОД ЗА МЕСЯЦ</span>
                        <span class="hero-value ${netIncomeClass}">${formatMoney(netIncome)}</span>
                    </div>
                    <div class="summary-grid">
                        <div class="grid-item">
                            <span class="grid-label"><ion-icon name="cash-outline"></ion-icon> Доход</span>
                            <span class="grid-value">${formatMoney(totalIncome)}</span>
                        </div>
                        <div class="grid-item" onclick="showExpensesDetailsModal()" style="cursor: pointer; transition: transform 0.15s;" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'" onmouseleave="this.style.transform='scale(1)'">
                            <span class="grid-label"><ion-icon name="wallet-outline"></ion-icon> Расходы</span>
                            <span class="grid-value text-danger">-${formatMoney(totalExpenses)}</span>
                        </div>
                        <div class="grid-item">
                            <span class="grid-label"><ion-icon name="gift-outline"></ion-icon> Бонусы</span>
                            <span class="grid-value text-accent">+${formatMoney(totalBonuses)}</span>
                        </div>
                        <div class="grid-item">
                            <span class="grid-label"><ion-icon name="cube-outline"></ion-icon> Заказы</span>
                            <span class="grid-value">${totalOrders}</span>
                        </div>
                        <div class="grid-item">
                            <span class="grid-label"><ion-icon name="time-outline"></ion-icon> Часы</span>
                            <span class="grid-value">${totalHours} ч</span>
                        </div>
                        <div class="grid-item">
                            <span class="grid-label"><ion-icon name="calendar-outline"></ion-icon> Смены</span>
                            <span class="grid-value">${workingDays} / ${daysInMonth}</span>
                        </div>
                    </div>
                    <div class="day-types-section">
                        <h4 class="day-types-title"><ion-icon name="stats-chart-outline"></ion-icon> Дни по типам</h4>
                        <div class="day-types-grid">
                            ${Object.entries(dayTypeConfig).map(([type, config]) => {
                                const count = dayTypeCounts[type] || 0;
                                if (count === 0) return '';
                                return `<div class="day-type-stat"><div class="day-type-icon" style="background: ${config.color}20; border: 1px solid ${config.color}40;"><ion-icon name="${config.icon}" style="color: ${config.color};"></ion-icon></div><div class="day-type-info"><span class="day-type-label">${config.label}</span><span class="day-type-count">${count} ${getDaysWord(count)}</span></div></div>`;
                            }).join('')}
                        </div>
                    </div>
                    <div class="summary-footer">
                        <div class="footer-item"><span class="footer-label">За смену</span><span class="footer-value">${formatMoney(avgIncome)}</span></div>
                        <div class="footer-item"><span class="footer-label">В час</span><span class="footer-value">${formatMoney(avgHourlyRate)}</span></div>
                    </div>
                </div>
            </div>
        </div>
        `;

        container.innerHTML = html;
        restoreMonthSummaryState();

        // Сохраняем обновлённые expenses
        saveShiftsLocal();
    } finally {
        isRendering = false;
    }
}

// ===== 16. ВСПОМОГАТЕЛЬНОЕ: применение графика явно =====
async function applyScheduleToMonth() {
    await generateShiftsBySettings();
    await renderCalendar();
    safeUpdateTotals();
}

// ===== 17. ВСПОМОГАТЕЛЬНОЕ: инъекция стилей =====
function injectStyles() {
    if (!document.getElementById('shift-summary-styles')) {
        const style = document.createElement('style');
        style.id = 'shift-summary-styles';
        style.textContent = `
            .month-summary-card { background: var(--ios-bg-secondary, #f2f2f7); border-radius: 16px; padding: 16px; margin-top: 16px; border: 1px solid var(--ios-border, rgba(0,0,0,0.08)); }
            .summary-hero { text-align: center; padding: 16px 0; border-bottom: 1px solid var(--ios-border, rgba(0,0,0,0.08)); margin-bottom: 16px; }
            .hero-label { display: block; font-size: 12px; font-weight: 600; color: var(--ios-text-secondary, #8e8e93); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
            .hero-value { display: block; font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.5px; line-height: 1.2; }
            .hero-value.positive { color: var(--ios-success, #34c759); }
            .hero-value.negative { color: var(--ios-danger, #ff3b30); }
            .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
            .grid-item { background: var(--ios-bg-primary, #ffffff); padding: 12px; border-radius: 12px; display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--ios-border, rgba(0,0,0,0.06)); min-width: 0; }
            .grid-label { font-size: 12px; color: var(--ios-text-secondary, #8e8e93); display: flex; align-items: center; gap: 6px; font-weight: 500; }
            .grid-label ion-icon { font-size: 16px; opacity: 0.9; flex-shrink: 0; }
            .grid-value { font-size: 17px; font-weight: 700; color: var(--ios-text-primary, #000000); font-variant-numeric: tabular-nums; line-height: 1.3; word-break: break-word; }
            .text-danger { color: var(--ios-danger, #ff3b30); }
            .text-accent { color: var(--ios-accent, #007aff); }
            .day-types-section { background: var(--ios-bg-primary, #ffffff); border-radius: 12px; padding: 12px; margin-bottom: 16px; border: 1px solid var(--ios-border, rgba(0,0,0,0.06)); }
            .day-types-title { font-size: 13px; font-weight: 700; color: var(--ios-text-secondary, #8e8e93); margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.6px; display: flex; align-items: center; gap: 6px; }
            .day-types-title ion-icon { font-size: 16px; flex-shrink: 0; }
            .day-types-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .day-type-stat { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--ios-bg-secondary, #f2f2f7); border-radius: 10px; transition: transform 0.15s ease; min-width: 0; }
            .day-type-stat:active { transform: scale(0.96); }
            .day-type-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
            .day-type-icon ion-icon { font-size: 20px; }
            .day-type-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
            .day-type-label { font-size: 11px; color: var(--ios-text-secondary, #8e8e93); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .day-type-count { font-size: 15px; font-weight: 700; color: var(--ios-text-primary, #000000); font-variant-numeric: tabular-nums; line-height: 1.2; }
            .summary-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .footer-item { background: var(--ios-bg-primary, #ffffff); padding: 12px; border-radius: 12px; text-align: center; border: 1px solid var(--ios-border, rgba(0,0,0,0.06)); min-width: 0; }
            .footer-label { display: block; font-size: 11px; color: var(--ios-text-secondary, #8e8e93); margin-bottom: 4px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.4px; }
            .footer-value { display: block; font-size: 16px; font-weight: 700; color: var(--ios-text-primary, #000000); font-variant-numeric: tabular-nums; }
            @media (max-width: 375px) {
                .month-summary-card { padding: 12px; }
                .hero-value { font-size: 28px; }
            }
        `;
        document.head.appendChild(style);
    }

    if (!document.getElementById('shift-day-money-styles')) {
        const styleMoney = document.createElement('style');
        styleMoney.id = 'shift-day-money-styles';
        styleMoney.textContent = `
            .shift-day { position: relative; }
            .shift-day-number { position: absolute; top: 3px; left: 6px; z-index: 2; font-size: 11px; }
            .shift-day-body {
                position: absolute; left: 3px; right: 3px; top: 18px; bottom: 3px;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                gap: 1px; min-height: 0; overflow: hidden;
            }
            .shift-day-net, .shift-day-orders, .shift-day-status {
                display: flex; align-items: center; justify-content: center; gap: 2px;
                font-size: 9px; font-weight: 800; line-height: 1.1;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                max-width: 100%; font-variant-numeric: tabular-nums;
            }
            .shift-day-net.positive { color: var(--ios-success, #34c759); }
            .shift-day-net.negative { color: var(--ios-danger, #ff3b30); }
            .shift-day-orders { color: var(--ios-text-secondary, #8e8e93); font-weight: 700; }
            .shift-day-status { color: var(--ios-text-tertiary, #8e8e93); }
            .shift-day-net ion-icon, .shift-day-orders ion-icon, .shift-day-status ion-icon {
                font-size: 10px; flex-shrink: 0;
            }
            @media (max-width: 375px) {
                .shift-day-net, .shift-day-orders { font-size: 8px; }
                .shift-day-net ion-icon, .shift-day-orders ion-icon, .shift-day-status ion-icon { font-size: 9px; }
                .shift-day-number { font-size: 10px; }
            }
        `;
        document.head.appendChild(styleMoney);
    }

    if (!document.getElementById('expenses-details-styles')) {
        const style = document.createElement('style');
        style.id = 'expenses-details-styles';
        style.textContent = `
            .expense-category { background: var(--ios-bg-primary, #ffffff); border-radius: 12px; margin-bottom: 12px; border: 1px solid var(--ios-border, rgba(0,0,0,0.06)); overflow: hidden; }
            .expense-category-header { padding: 14px 16px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; gap: 12px; }
            .expense-category-header:hover { background: var(--ios-bg-secondary, #f2f2f7); }
            .expense-category-content { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; background: var(--ios-bg-secondary, #f2f2f7); }
            .expense-category-content.expanded { max-height: 2000px; }
            .expense-item { padding: 14px 16px; border-top: 1px solid var(--ios-border, rgba(0,0,0,0.06)); }
            .expense-item:first-child { border-top: none; }
            .repair-part { display: flex; justify-content: space-between; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid var(--ios-border, rgba(0,0,0,0.04)); }
            .repair-part:last-child { border-bottom: none; }
            .repair-part-name { font-size: 13px; font-weight: 500; color: var(--ios-text-primary); flex: 1; }
            .repair-part-cost { font-size: 13px; font-weight: 700; color: var(--ios-danger, #ff3b30); white-space: nowrap; margin-left: 10px; }
            .repair-labor { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; }
            .repair-labor-label { font-size: 12px; font-weight: 600; color: var(--ios-text-secondary); }
            .repair-labor-cost { font-size: 14px; font-weight: 700; color: var(--ios-danger, #ff3b30); }
            .expense-date { font-size: 13px; font-weight: 700; color: var(--ios-text-primary); margin-bottom: 6px; }
            .expense-description { font-size: 12px; color: var(--ios-text-secondary); margin-bottom: 8px; line-height: 1.4; }
        `;
        document.head.appendChild(style);
    }
}

// ===== 18. ДЕТАЛИЗАЦИЯ РАСХОДОВ =====
function showExpensesDetailsModal() {
    const datePrefix = getMonthPrefix(currentYear, currentMonth);
    const recordsArray = getHistoryRecords();
    const monthRecords = recordsArray.filter(r => normalizeDate(r.date).startsWith(datePrefix));

    if (monthRecords.length === 0) {
        safeShowToast('ℹ️ Нет записей за этот месяц');
        return;
    }

    const expenses = { fuel: [], repair: [], tax: [] };
    let totalFuel = 0, totalRepair = 0, totalTax = 0;

    monthRecords.forEach(record => {
        const date = formatDate(normalizeDate(record.date));
        const fuelCost = Number(record.fuelCost) || 0;
        if (fuelCost > 0) {
            expenses.fuel.push({ date, amount: fuelCost, description: record.fuelDescription || record.notes || 'Заправка' });
            totalFuel += fuelCost;
        }
        const repairCost = Number(record.repairCost) || 0;
        if (repairCost > 0) {
            let allParts = [], allWorks = [], descriptions = [];
            if (Array.isArray(record.repairDetails)) {
                record.repairDetails.forEach(detail => {
                    if (detail.description) descriptions.push(detail.description);
                    if (Array.isArray(detail.parts)) allParts = allParts.concat(detail.parts);
                    if (Array.isArray(detail.works)) allWorks = allWorks.concat(detail.works);
                });
            }
            if (allParts.length === 0 && Array.isArray(record.repairParts)) allParts = record.repairParts;
            if (allWorks.length === 0 && Number(record.repairLabor) > 0) allWorks.push({ name: 'Работы', cost: Number(record.repairLabor) });
            const mainDesc = [...new Set(descriptions)].join('; ') || record.repairDescription || 'Ремонт';
            expenses.repair.push({ date, amount: repairCost, description: mainDesc, parts: allParts, works: allWorks });
            totalRepair += repairCost;
        }
        const tax = Number(record.tax) || 0;
        if (tax > 0) {
            expenses.tax.push({ date, amount: tax, description: record.taxDescription || 'Налог' });
            totalTax += tax;
        }
    });

    const totalExpenses = totalFuel + totalRepair + totalTax;

    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
    overlay.innerHTML = `
        <div class="shift-modal" style="max-width: 450px; max-height: 85vh; display: flex; flex-direction: column;">
            <div class="shift-modal-header">
                <ion-icon name="wallet-outline"></ion-icon>
                <h3>Расходы за месяц</h3>
                <button class="shift-modal-close" onclick="this.closest('.shift-modal-overlay').remove()"><ion-icon name="close-outline"></ion-icon></button>
            </div>
            <div class="shift-modal-body" style="flex: 1; overflow-y: auto; padding: 16px;">
                <div style="background: rgba(255, 69, 58, 0.1); padding: 16px; border-radius: 12px; margin-bottom: 20px; border: 1.5px solid var(--ios-danger, #ff3b30);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: 600; color: var(--ios-text-secondary);">Общие расходы</span>
                        <span style="font-size: 24px; font-weight: 700; color: var(--ios-danger, #ff3b30);">${formatMoney(totalExpenses)}</span>
                    </div>
                </div>
                ${buildExpenseCategory('fuel', 'Бензин', 'fuel-outline', '#FF9500', expenses.fuel, totalFuel)}
                ${buildRepairCategory('repair', 'Ремонт', 'construct-outline', '#8E8E93', expenses.repair, totalRepair)}
                ${buildExpenseCategory('tax', 'Налоги', 'document-text-outline', '#FF3B30', expenses.tax, totalTax)}
                ${totalExpenses === 0 ? '<div style="text-align: center; color: var(--ios-text-tertiary); padding: 30px; font-size: 15px;">Нет расходов за этот месяц</div>' : ''}
            </div>
            <div class="shift-modal-footer">
                <button class="btn btn-primary" onclick="this.closest('.shift-modal-overlay').remove()"><ion-icon name="checkmark-outline"></ion-icon> Закрыть</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function buildExpenseCategory(id, title, icon, color, items, total) {
    if (items.length === 0 || total === 0) return '';
    const count = items.length;
    return `
        <div class="expense-category">
            <div class="expense-category-header" onclick="toggleExpenseCategory('${id}')">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: ${color}20; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <ion-icon name="${icon}" style="font-size: 22px; color: ${color};"></ion-icon>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 15px; font-weight: 700; color: var(--ios-text-primary);">${title}</div>
                    <div style="font-size: 12px; color: var(--ios-text-tertiary);">${count} ${getDaysWord(count)}</div>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: var(--ios-danger, #ff3b30);">${formatMoney(total)}</div>
                <ion-icon name="chevron-down-outline" id="${id}-chevron" style="font-size: 20px; color: var(--ios-text-tertiary); transition: transform 0.3s; flex-shrink: 0;"></ion-icon>
            </div>
            <div class="expense-category-content" id="${id}-content">
                ${items.map(item => `
                    <div class="expense-item">
                        <div class="expense-date">${item.date}</div>
                        ${item.description ? `<div class="expense-description">${item.description}</div>` : ''}
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-size: 12px; color: var(--ios-text-tertiary);">Сумма</div>
                            <div style="font-size: 16px; font-weight: 700; color: var(--ios-danger, #ff3b30);">${formatMoney(item.amount)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function buildRepairCategory(id, title, icon, color, items, total) {
    if (items.length === 0 || total === 0) return '';
    const count = items.length;
    return `
        <div class="expense-category">
            <div class="expense-category-header" onclick="toggleExpenseCategory('${id}')">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: ${color}20; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <ion-icon name="${icon}" style="font-size: 22px; color: ${color};"></ion-icon>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 15px; font-weight: 700; color: var(--ios-text-primary);">${title}</div>
                    <div style="font-size: 12px; color: var(--ios-text-tertiary);">${count} ${getDaysWord(count)}</div>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: var(--ios-danger, #ff3b30);">${formatMoney(total)}</div>
                <ion-icon name="chevron-down-outline" id="${id}-chevron" style="font-size: 20px; color: var(--ios-text-tertiary); transition: transform 0.3s; flex-shrink: 0;"></ion-icon>
            </div>
            <div class="expense-category-content" id="${id}-content">
                ${items.map(item => `
                    <div class="expense-item">
                        <div class="expense-date">${item.date}</div>
                        ${item.description ? `<div class="expense-description">${item.description}</div>` : ''}
                        <div style="margin-top: 10px;">
                            ${item.parts && item.parts.length > 0 ? `
                                <div style="margin-bottom: 8px;">
                                    <div style="font-size: 11px; font-weight: 600; color: var(--ios-text-tertiary); margin-bottom: 4px; text-transform: uppercase;">🔧 Запчасти</div>
                                    ${item.parts.map(part => `
                                        <div class="repair-part">
                                            <span class="repair-part-name">${typeof part === 'string' ? part : (part.name || 'Деталь')}</span>
                                            <span class="repair-part-cost">${formatMoney(typeof part === 'string' ? 0 : (part.cost || 0))}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                            ${item.works && item.works.length > 0 ? `
                                <div style="margin-bottom: 8px;">
                                    <div style="font-size: 11px; font-weight: 600; color: var(--ios-text-tertiary); margin-bottom: 4px; text-transform: uppercase;">💼 Работы</div>
                                    ${item.works.map(work => `
                                        <div class="repair-part">
                                            <span class="repair-part-name">${typeof work === 'string' ? work : (work.name || 'Работа')}</span>
                                            <span class="repair-part-cost">${formatMoney(typeof work === 'string' ? 0 : (work.cost || 0))}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                            ${(!item.parts || item.parts.length === 0) && (!item.works || item.works.length === 0) ? `
                                <div class="repair-labor">
                                    <span class="repair-labor-label">Ремонт</span>
                                    <span class="repair-labor-cost">${formatMoney(item.amount)}</span>
                                </div>
                            ` : ''}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 2px solid var(--ios-border, rgba(0,0,0,0.08));">
                            <div style="font-size: 13px; font-weight: 600; color: var(--ios-text-secondary);">Итого</div>
                            <div style="font-size: 18px; font-weight: 700; color: var(--ios-danger, #ff3b30);">${formatMoney(item.amount)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function toggleExpenseCategory(category) {
    const content = document.getElementById(`${category}-content`);
    const chevron = document.getElementById(`${category}-chevron`);
    if (content && chevron) {
        content.classList.toggle('expanded');
        chevron.style.transform = content.classList.contains('expanded') ? 'rotate(180deg)' : 'rotate(0deg)';
    }
}

// ===== 19. СВОРАЧИВАНИЕ ИТОГОВ =====
function toggleMonthSummary(toggleEl) {
    const wrapper = toggleEl.closest('.month-summary-wrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('collapsed');
    try {
        const state = JSON.parse(localStorage.getItem(SUMMARY_STATE_KEY) || '{}');
        state.collapsed = wrapper.classList.contains('collapsed');
        localStorage.setItem(SUMMARY_STATE_KEY, JSON.stringify(state));
    } catch (e) { }
}

function restoreMonthSummaryState() {
    try {
        const state = JSON.parse(localStorage.getItem(SUMMARY_STATE_KEY) || '{}');
        if (state.collapsed) {
            const wrapper = document.querySelector('.month-summary-wrapper');
            if (wrapper) wrapper.classList.add('collapsed');
        }
    } catch (e) { }
}

// ===== 20. ПЕРЕКЛЮЧЕНИЕ МЕСЯЦА =====
async function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    else if (currentMonth < 0) { currentMonth = 11; currentYear--; }

    // НЕ автогенерируем! Пользователь сам нажмёт "Применить" если нужно.
    updateShiftDataFromHistory();
    await renderCalendar();
}

// ===== 21. ИНИЦИАЛИЗАЦИЯ =====
function openShiftCalendar() {
    if (typeof window.switchTab === 'function') window.switchTab('shifts');
    setTimeout(() => renderCalendar(), 100);
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => loadShifts(), 300);
});

const origSwitchTab = window.switchTab || function () { };
window.switchTab = function (tabName) {
    if (typeof origSwitchTab === 'function') origSwitchTab(tabName);
    if (tabName === 'shifts') {
        setTimeout(() => {
            if (typeof renderCalendar === 'function') renderCalendar();
        }, 100);
    }
};

let _syncDebounceTimer = null;
window.forceSyncHistoryToCalendar = function () {
    if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(() => {
        updateShiftDataFromHistory();
        if (typeof renderCalendar === 'function') renderCalendar();
        safeUpdateTotals();
        _syncDebounceTimer = null;
    }, 150);
};

// ============================================
// ПАТЧ: оборачиваем ВСЕ иконки календаря в плашки
// ============================================
function wrapShiftIcons() {
    const ICON_COLOR = {
        'cash-outline': 'shift-icon-green',
        'wallet-outline': 'shift-icon-red',
        'gift-outline': 'shift-icon-orange',
        'cube-outline': 'shift-icon-blue',
        'time-outline': 'shift-icon-teal',
        'calendar-outline': 'shift-icon-purple',
        'settings-outline': 'shift-icon-blue',
        'refresh-outline': 'shift-icon-green',
        'trash-outline': 'shift-icon-red',
        'stats-chart-outline': 'shift-icon-blue',
        'briefcase-outline': 'shift-icon-cyan',
        'medical-outline': 'shift-icon-gray',
        'airplane-outline': 'shift-icon-green',
        'remove-circle-outline': 'shift-icon-gray',
        'construct-outline': 'shift-icon-orange',
        'document-text-outline': 'shift-icon-blue',
        'flag-outline': 'shift-icon-orange',
        'chevron-back-outline': 'shift-icon-blue',
        'chevron-forward-outline': 'shift-icon-blue',
        'chevron-down-outline': 'shift-icon-blue',
        'close-outline': 'shift-icon-red',
        'checkmark-outline': 'shift-icon-green',
        'fuel-outline': 'shift-icon-orange'
    };
    
    function wrap(icon, sizeClass) {
        if (!icon) return;
        // Уже обёрнута?
        if (icon.parentElement && icon.parentElement.classList.contains('shift-icon-badge')) return;
        const name = icon.getAttribute('name') || '';
        const colorClass = ICON_COLOR[name] || 'shift-icon-blue';
        const badge = document.createElement('span');
        badge.className = `shift-icon-badge ${sizeClass} ${colorClass}`;
        icon.parentNode.insertBefore(badge, icon);
        badge.appendChild(icon);
    }
    
    // 1. Иконка в заголовке "Календарь смен"
    document.querySelectorAll('#tab-shifts .card > h2 > ion-icon').forEach(icon => wrap(icon, 'shift-icon-lg'));
    
    // 2. Иконки в кнопках действий календаря
    document.querySelectorAll('.shift-calendar-actions .btn > ion-icon').forEach(icon => wrap(icon, 'shift-icon-sm'));
    

    
    // 4. Иконки в "Итогах месяца" (сетка метрик)
    document.querySelectorAll('.month-summary-card .grid-label > ion-icon').forEach(icon => wrap(icon, 'shift-icon-sm'));
    
    // 5. Иконка в заголовке "Дни по типам"
    document.querySelectorAll('.day-types-title > ion-icon').forEach(icon => wrap(icon, 'shift-icon-sm'));
    
    // 6. Тоггл-иконка "Итоги месяца" (стрелка вниз) — уже обёрнута вручную в шаблоне,
    //    но на всякий случай проверим иконку stats-chart в toggle:
    document.querySelectorAll('.month-summary-toggle > ion-icon').forEach(icon => {
        if (icon.classList.contains('toggle-chevron')) return; // стрелку не трогаем
        wrap(icon, 'shift-icon-sm');
    });
    
    // 7. Иконки в модалке смены (stats)
    document.querySelectorAll('.shift-modal-stats .label > ion-icon').forEach(icon => wrap(icon, 'shift-icon-sm'));
    
    // 8. Иконки в шапках модалок
    document.querySelectorAll('.shift-modal-header > ion-icon').forEach(icon => wrap(icon, 'shift-icon-lg'));
    
    // 9. Иконки в футерах модалок
    document.querySelectorAll('.shift-modal-footer .btn > ion-icon').forEach(icon => {
        const name = icon.getAttribute('name') || '';
        let size = 'shift-icon-sm';
        let color = ICON_COLOR[name] || 'shift-icon-blue';
        if (name.includes('checkmark')) color = 'shift-icon-green';
        if (name.includes('close')) color = 'shift-icon-red';
        if (icon.parentElement && icon.parentElement.classList.contains('shift-icon-badge')) return;
        const badge = document.createElement('span');
        badge.className = `shift-icon-badge ${size} ${color}`;
        icon.parentNode.insertBefore(badge, icon);
        badge.appendChild(icon);
    });
    
    // 10. Иконки внутри модалки выбора типа дня (day-type-btn) — НЕ оборачиваем,
    //     там уже стилизованные кнопки с цветом при активном состоянии.
    //     Пропускаем намеренно.
    
    // 11. Иконки в модалке расходов (buildExpenseCategory/buildRepairCategory)
    document.querySelectorAll('.expense-category-header > div > ion-icon').forEach(icon => wrap(icon, 'shift-icon-md'));
    
    // 12. Иконки в полях ввода расходов/бонусов внутри модалки смены
    document.querySelectorAll('.shift-modal-expenses > label > ion-icon, .shift-modal-bonuses > label > ion-icon, .shift-modal-notes > label > ion-icon').forEach(icon => wrap(icon, 'shift-icon-sm'));
    
    // 13. Иконка в блоке "Чистый доход" в модалке
    document.querySelectorAll('.shift-modal-body > div > div > span > ion-icon').forEach(icon => {
        if (icon.closest('.shift-icon-badge')) return;
        const name = icon.getAttribute('name') || '';
        if (name === 'cash-outline') wrap(icon, 'shift-icon-sm');
    });
}

// ⭐ Надёжный вызов: ловим ЛЮБУЮ перерисовку календаря через MutationObserver
(function initShiftIconPatcher() {
    let debounceTimer = null;
    
    function debouncedWrap() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try { wrapShiftIcons(); } catch (e) { console.warn('wrapShiftIcons error:', e); }
            debounceTimer = null;
        }, 30);
    }
    
    function attach() {
        const cal = document.getElementById('shift-calendar');
        if (!cal) { setTimeout(attach, 300); return; }
        if (cal.__iconPatched) return;
        cal.__iconPatched = true;
        
        wrapShiftIcons(); // Первичный прогон
        
        // Реагируем на любую перерисовку календаря
        new MutationObserver(() => debouncedWrap())
            .observe(cal, { childList: true, subtree: true });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
    
    // Модалки живут в document.body — ловим их отдельно
    if (document.body) {
        new MutationObserver((muts) => {
            // реагируем только на добавление элементов (модалки открываются)
            for (const mu of muts) {
                if (mu.addedNodes && mu.addedNodes.length > 0) {
                    debouncedWrap();
                    return;
                }
            }
        }).observe(document.body, { childList: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            new MutationObserver((muts) => {
                for (const mu of muts) {
                    if (mu.addedNodes && mu.addedNodes.length > 0) {
                        debouncedWrap();
                        return;
                    }
                }
            }).observe(document.body, { childList: true });
        });
    }
})();

// Также вызываем при смене таба
const _origSwitchTabForIcons = window.switchTab;
if (typeof _origSwitchTabForIcons === 'function') {
    window.switchTab = function(tabName) {
        const res = _origSwitchTabForIcons.apply(this, arguments);
        if (tabName === 'shifts') {
            setTimeout(() => {
                try { wrapShiftIcons(); } catch (e) {}
            }, 200);
        }
        return res;
    };
}

// ===== 22. ЭКСПОРТ =====
window.shifts = shifts;
window.loadShifts = loadShifts;
window.renderCalendar = renderCalendar;
window.changeMonth = changeMonth;
window.toggleShift = toggleShift;
window.editShift = editShift;
window.saveShiftDetails = saveShiftDetails;
window.showScheduleSettingsModal = showScheduleSettingsModal;
window.generateShiftsBySettings = generateShiftsBySettings;
window.applyScheduleToMonth = applyScheduleToMonth;
window.clearMonthShifts = clearMonthShifts;
window.openShiftCalendar = openShiftCalendar;
window.formatMoney = formatMoney;
window.scheduleSettings = scheduleSettings;
window.showExpensesDetailsModal = showExpensesDetailsModal;
window.toggleExpenseCategory = toggleExpenseCategory;
window.isMonthCleared = isMonthCleared;
window.getClearedMonths = getClearedMonths;
window.markMonthCleared = markMonthCleared;
window.unmarkMonthCleared = unmarkMonthCleared;

console.log('✅ Модуль календаря смен v7.0 (Реестр очищенных месяцев + защита ручных настроек) загружен');
console.log('ℹ️ Очищенные месяцы:', [...getClearedMonths()]);
console.log('ℹ️ Для сброса реестра: localStorage.removeItem("clearedShiftMonths") и перезагрузите страницу');