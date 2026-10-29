// ============================================
// МОДУЛЬ КАЛЕНДАРЯ СМЕН (ВЕРСИЯ 5.3 - С ДЕТАЛИЗАЦИЕЙ РАСХОДОВ)
// ============================================

const SHIFTS_STORAGE_KEY = 'driverShifts';
const SHIFTS_COLLECTION = 'shifts';
const SCHEDULE_SETTINGS_KEY = 'scheduleSettings';

// ===== ЦВЕТА ДЛЯ ТИПОВ ДНЕЙ (ФИНАЛЬНЫЕ) =====
const DEFAULT_COLORS = {
    work: '#5AC8FA',        // Рабочий день (голубой)
    sick: '#8E8E93',        // Больничный (серый)
    vacation: '#34C759',    // Отпуск (зеленый)
    dayoff: '#FFFFFF',      // Выходной (белый)
    repair: '#FF9500'       // Ремонт (оранжевый)
};

// Список разрешенных типов дней
const ALLOWED_DAY_TYPES = ['work', 'sick', 'vacation', 'dayoff', 'repair'];

// ===== 1. СОСТОЯНИЕ МОДУЛЯ =====
let shifts = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let isFirebaseSync = false;
let firebaseUnsubscribe = null;
let recordsUnsubscribe = null;
let scheduleSettings = {
    name: 'График 1',
    workDays: 3,
    restDays: 3,
    firstWorkDate: '08.08.2025',
    colors: { ...DEFAULT_COLORS }
};

// ===== УТИЛИТЫ БЕЗОПАСНОСТИ =====
function safeShowToast(message) {
    if (typeof window.showToast === 'function') {
        window.showToast(message);
    } else {
        console.log('🔔 Toast:', message);
    }
}

function safeUpdateTotals() {
    if (typeof window.updateTotals === 'function') {
        window.updateTotals();
    }
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
    if (dateInput && typeof dateInput.toDate === 'function') {
        return getLocalDateString(dateInput.toDate());
    }
    if (dateInput instanceof Date) {
        return getLocalDateString(dateInput);
    }
    return String(dateInput);
}

function formatMoney(amount) {
    if (typeof window.formatMoney === 'function') return window.formatMoney(amount);
    const num = Number(amount) || 0;
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k ₽';
    return Math.round(num) + ' ₽';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseDate(dateStr) {
    const parts = dateStr.split('.');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
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

// ===== 3. ОПТИМИЗАЦИЯ РАБОТЫ С ИСТОРИЕЙ =====
function getHistoryRecords() {
    const r = (typeof window.records !== 'undefined') ? window.records : (typeof records !== 'undefined' ? records : []);
    return Array.isArray(r) ? r : [];
}

function getGroupedHistoryRecords() {
    const recordsArray = getHistoryRecords();
    const grouped = {};
    recordsArray.forEach(record => {
        const date = normalizeDate(record.date);
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(record);
    });
    return grouped;
}

function getDailyMetrics(dateStr, groupedRecords) {
    const targetDate = normalizeDate(dateStr);
    const dayRecords = groupedRecords[targetDate] || [];
    if (dayRecords.length === 0) return { income: 0, orders: 0, hours: 0, expenses: 0, bonuses: 0 };

    let income = 0, orders = 0, hours = 0, expenses = 0, bonuses = 0;
    
    dayRecords.forEach(r => {
        const totalInc = Number(r.totalIncome) || Number(r.income) || 0;
        if (totalInc > 0) income += totalInc;
        else income += (Number(r.payDelivery) || 0) + (Number(r.payPickup) || 0) + (Number(r.payWeight) || 0) + (Number(r.payDistance) || 0) + (Number(r.tips) || 0) + (Number(r.bonusPay) || 0);
        
        orders += (Number(r.ordersDelivery) || 0);
        hours += (Number(r.hours) || Number(r.duration) || 0);
        
        if (r.totalExpenses !== undefined && r.totalExpenses !== null && r.totalExpenses > 0) {
            expenses += Number(r.totalExpenses);
        } else {
            expenses += (Number(r.fuelCost) || 0) + (Number(r.repairCost) || 0) + (Number(r.tax) || 0);
        }
        
        bonuses += Number(r.bonusPay) || 0;
        if (r.isBonus === true || r.type === 'bonus') {
            bonuses += Number(r.totalIncome) || Number(r.income) || 0;
        }
    });
    
    return { income, orders, hours, expenses, bonuses };
}

// ===== 4. НАСТРОЙКИ ГРАФИКА =====
async function loadScheduleSettings() {
    console.log('📅 Загрузка настроек графика...');
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            const doc = await db.collection('users').doc(auth.currentUser.uid).collection('settings').doc(SCHEDULE_SETTINGS_KEY).get();
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
        } catch (error) {
            console.warn('⚠️ Не удалось загрузить настройки графика из Firebase:', error);
        }
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
        } catch (e) {
            console.error('❌ Ошибка парсинга настроек из localStorage:', e);
        }
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
            await db.collection('users').doc(auth.currentUser.uid).collection('settings').doc(SCHEDULE_SETTINGS_KEY).set(scheduleSettings, { merge: true });
        } catch (error) {
            console.error('❌ Ошибка сохранения настроек графика в Firebase:', error);
        }
    }
}

// ===== 5. ИНИЦИАЛИЗАЦИЯ И СИНХРОНИЗАЦИЯ =====
async function loadShifts() {
    console.log('📅 Загрузка календаря смен...');
    try {
        await loadScheduleSettings();
        const saved = localStorage.getItem(SHIFTS_STORAGE_KEY);
        if (saved) {
            shifts = JSON.parse(saved);
            updateShiftDataFromHistory();
            await renderCalendar();
        }
        
        if (typeof auth !== 'undefined' && typeof db !== 'undefined') {
            if (!auth.currentUser) {
                await new Promise((resolve) => {
                    const unsubscribe = auth.onAuthStateChanged((user) => {
                        unsubscribe();
                        resolve(user);
                    });
                });
            }
            if (auth.currentUser) {
                if (firebaseUnsubscribe) {
                    firebaseUnsubscribe();
                    firebaseUnsubscribe = null;
                }
                firebaseUnsubscribe = db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).orderBy('date', 'asc').onSnapshot((snapshot) => {
                    const firebaseShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    mergeFirebaseWithHistory(firebaseShifts);
                    isFirebaseSync = true;
                    saveShiftsLocal();
                    renderCalendar();
                    safeUpdateTotals();
                }, (error) => {
                    console.error('❌ Ошибка слушателя смен:', error);
                });
                listenToRecordsChanges();
                await loadShiftsFromFirebase();
            }
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки смен:', error);
    }
}

async function loadShiftsFromFirebase() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    try {
        const snapshot = await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).orderBy('date', 'asc').get();
        if (!snapshot.empty) {
            const firebaseShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            mergeFirebaseWithHistory(firebaseShifts);
            isFirebaseSync = true;
            saveShiftsLocal();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки из Firebase:', error);
    }
}

function mergeFirebaseWithHistory(firebaseShifts) {
    const groupedRecords = getGroupedHistoryRecords();
    const mergedShifts = firebaseShifts.map(shift => {
        const metrics = getDailyMetrics(shift.date, groupedRecords);
        const updatedShift = { ...shift };
        if (metrics.income > 0 && (!updatedShift.income || updatedShift.income === 0)) updatedShift.income = metrics.income;
        if (metrics.orders > 0 && (!updatedShift.orders || updatedShift.orders === 0)) updatedShift.orders = metrics.orders;
        if (metrics.hours > 0 && (!updatedShift.hours || updatedShift.hours === 0)) updatedShift.hours = metrics.hours;
        if (metrics.expenses > 0 && (!updatedShift.expenses || updatedShift.expenses === 0)) updatedShift.expenses = metrics.expenses;
        if (metrics.bonuses > 0 && (!updatedShift.bonuses || updatedShift.bonuses === 0)) updatedShift.bonuses = metrics.bonuses;
        return updatedShift;
    });
    shifts = mergedShifts;
}

function listenToRecordsChanges() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    if (recordsUnsubscribe) {
        recordsUnsubscribe();
        recordsUnsubscribe = null;
    }
    recordsUnsubscribe = db.collection('users').doc(auth.currentUser.uid).collection('records').onSnapshot((snapshot) => {
        window.records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateShiftDataFromHistory();
        renderCalendar();
        safeUpdateTotals();
    }, (error) => console.error('❌ Ошибка слушателя истории:', error));
}

// ===== 6. СОХРАНЕНИЕ =====
function saveShiftsLocal() {
    localStorage.setItem(SHIFTS_STORAGE_KEY, JSON.stringify(shifts));
}

async function saveShiftToFirebase(shift) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return false;
    if (!shift || !shift.id) return false;
    try {
        const shiftToSave = { ...shift };
        delete shiftToSave.id;
        await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id).set(shiftToSave, { merge: true });
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения смены в Firebase:', error);
        return false;
    }
}

async function saveShiftsBatchToFirebase(shiftsArray) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return false;
    if (!shiftsArray || shiftsArray.length === 0) return true;
    try {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < shiftsArray.length; i += CHUNK_SIZE) {
            const chunk = shiftsArray.slice(i, i + CHUNK_SIZE);
            const batch = db.batch();
            for (const shift of chunk) {
                if (!shift.id) continue;
                const shiftToSave = { ...shift };
                delete shiftToSave.id;
                if (shiftToSave.startTime === undefined) shiftToSave.startTime = null;
                if (shiftToSave.endTime === undefined) shiftToSave.endTime = null;
                const ref = db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id);
                batch.set(ref, shiftToSave, { merge: true });
            }
            await batch.commit();
        }
        for (const shift of shiftsArray) {
            const idx = shifts.findIndex(s => s.id === shift.id);
            if (idx !== -1) shifts[idx] = { ...shifts[idx], ...shift };
            else shifts.push(shift);
        }
        saveShiftsLocal();
        return true;
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА пакетного сохранения:', error);
        return false;
    }
}

// ===== 7. ОБНОВЛЕНИЕ ДАННЫХ ИЗ ИСТОРИИ =====
function updateShiftDataFromHistory() {
    const groupedRecords = getGroupedHistoryRecords();
    if (Object.keys(groupedRecords).length === 0) return;
    let hasChanges = false;
    shifts.forEach(shift => {
        const targetDate = normalizeDate(shift.date);
        if (!groupedRecords[targetDate] || groupedRecords[targetDate].length === 0) return;
        const metrics = getDailyMetrics(shift.date, groupedRecords);
        if (metrics.income > 0 && shift.income !== metrics.income) { shift.income = metrics.income; hasChanges = true; }
        if (metrics.orders > 0 && shift.orders !== metrics.orders) { shift.orders = metrics.orders; hasChanges = true; }
        if (metrics.bonuses > 0 && shift.bonuses !== metrics.bonuses) { shift.bonuses = metrics.bonuses; hasChanges = true; }
        if (metrics.hours > 0 && shift.hours !== metrics.hours) { shift.hours = metrics.hours; hasChanges = true; }
        if (metrics.expenses > 0 && shift.expenses !== metrics.expenses) { shift.expenses = metrics.expenses; hasChanges = true; }
    });
    if (hasChanges) {
        saveShiftsLocal();
    }
}

// ===== 8. ЛОГИКА ГРАФИКА =====
function isWorkingDayBySchedule(dateStr) {
    const firstWorkDate = parseDate(scheduleSettings.firstWorkDate);
    const currentDate = new Date(dateStr + 'T00:00:00');
    const diffTime = currentDate.getTime() - firstWorkDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return false;
    const cycleLength = scheduleSettings.workDays + scheduleSettings.restDays;
    const dayInCycle = diffDays % cycleLength;
    return dayInCycle < scheduleSettings.workDays;
}

async function clearMonthShifts() {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
    if (!confirm(`🗑️ Удалить все смены за ${monthStr}.${currentYear}?`)) return;
    const toRemove = shifts.filter(s => s.date.startsWith(datePrefix));
    if (toRemove.length === 0) {
        safeShowToast('ℹ️ Нет смен для удаления');
        return;
    }
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            const batch = db.batch();
            for (const shift of toRemove) {
                const ref = db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id);
                batch.delete(ref);
            }
            await batch.commit();
        } catch (error) {
            console.error('❌ Ошибка удаления из Firebase:', error);
        }
    }
    shifts = shifts.filter(s => !s.date.startsWith(datePrefix));
    saveShiftsLocal();
    await renderCalendar();
    safeShowToast(`✅ Удалено ${toRemove.length} смен`);
}

async function generateShiftsBySettings() {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = getLocalDateString();
    const datePrefix = `${currentYear}-${monthStr}`;
    const toRemove = shifts.filter(s => s.date.startsWith(datePrefix));
    
    if (toRemove.length > 0) {
        if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
            try {
                const batch = db.batch();
                for (const shift of toRemove) {
                    const ref = db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id);
                    batch.delete(ref);
                }
                await batch.commit();
            } catch (error) {
                console.error('❌ Ошибка удаления старых смен:', error);
            }
        }
        shifts = shifts.filter(s => !s.date.startsWith(datePrefix));
    }
    
    const groupedRecords = getGroupedHistoryRecords();
    const newMonthShifts = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${monthStr}-${String(day).padStart(2, '0')}`;
        const isWorking = isWorkingDayBySchedule(dateStr);
        const metrics = getDailyMetrics(dateStr, groupedRecords);
        const isPast = dateStr < today;
        let finalIsWorking = isWorking;
        if (isPast) finalIsWorking = metrics.orders > 0;
        
        newMonthShifts.push({
            id: 'shift_' + dateStr,
            date: dateStr,
            isWorking: finalIsWorking,
            startTime: finalIsWorking ? `${WORK_START_HOUR}:00` : null,
            endTime: finalIsWorking ? `${WORK_END_HOUR}:00` : null,
            income: metrics.income,
            orders: metrics.orders,
            hours: finalIsWorking ? (WORK_END_HOUR - WORK_START_HOUR) : 0,
            expenses: metrics.expenses,
            bonuses: metrics.bonuses,
            notes: '',
            dayType: finalIsWorking ? 'work' : 'dayoff',
            manualOverride: false,
            updatedAt: new Date().toISOString()
        });
    }
    const saved = await saveShiftsBatchToFirebase(newMonthShifts);
    if (saved) safeShowToast(`✅ График "${scheduleSettings.name}" создан`);
    else safeShowToast('❌ Ошибка сохранения графика');
}

// ===== 9. МОДАЛЬНЫЕ ОКНА НАСТРОЕК =====
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
        btn.addEventListener('click', function() {
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
    const dateValue = dateInput.value;
    const formattedDate = dateValue.split('-').reverse().join('.');
    await saveScheduleSettings({ name: name, firstWorkDate: formattedDate, colors: scheduleSettings.colors });
    await generateShiftsBySettings();
    const overlay = document.querySelector('.shift-modal-overlay');
    if (overlay) overlay.remove();
    await renderCalendar();
    safeShowToast(`✅ Настройки графика "${name}" сохранены`);
}

// ===== 10. ПЕРЕКЛЮЧЕНИЕ И СОХРАНЕНИЕ СМЕНЫ =====
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
        await saveShift({ date: dateStr, isWorking: true, notes: '' });
    }
    await renderCalendar();
}

async function saveShift(shiftData) {
    const dateStr = shiftData.date;
    const existingIndex = shifts.findIndex(s => s.date === dateStr);
    const today = getLocalDateString();
    const groupedRecords = getGroupedHistoryRecords();
    const metrics = getDailyMetrics(dateStr, groupedRecords);
    let isWorking = shiftData.isWorking;
    if (dateStr < today && !shiftData.manualOverride) isWorking = metrics.orders > 0;
    
    let shift = {
        id: existingIndex !== -1 ? shifts[existingIndex].id : 'shift_' + dateStr,
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
        manualOverride: shiftData.manualOverride || false,
        updatedAt: new Date().toISOString()
    };
    if (existingIndex !== -1) shifts[existingIndex] = { ...shifts[existingIndex], ...shift };
    else shifts.push(shift);
    saveShiftsLocal();
    await saveShiftToFirebase(shift);
    await renderCalendar();
}

// ===== 11. РЕДАКТИРОВАНИЕ СМЕНЫ =====
function editShift(dateStr) {
    selectedDate = dateStr;
    showShiftModal(dateStr);
}

function showShiftModal(dateStr) {
    const shift = shifts.find(s => s.date === dateStr);
    const isWorking = shift ? shift.isWorking : false;
    const notes = (shift && shift.notes) ? shift.notes : '';
    const dayType = shift ? (shift.dayType || (shift.isWorking ? 'work' : 'dayoff')) : 'dayoff';
    const groupedRecords = getGroupedHistoryRecords();
    const metrics = getDailyMetrics(dateStr, groupedRecords);
    const income = shift ? (Number(shift.income) || 0) : metrics.income;
    const orders = shift ? (Number(shift.orders) || 0) : metrics.orders;
    const hours = shift ? (Number(shift.hours) || 0) : metrics.hours;
    const expenses = shift ? (Number(shift.expenses) || 0) : metrics.expenses;
    const bonuses = shift ? (Number(shift.bonuses) || 0) : metrics.bonuses;
    const netIncome = income + bonuses - expenses;
    
    const dayTypeIcons = { work: 'briefcase-outline', sick: 'medical-outline', vacation: 'airplane-outline', dayoff: 'remove-circle-outline', repair: 'construct-outline' };
    const dayTypeNames = { work: 'Рабочий день', sick: 'Больничный', vacation: 'Отпуск', dayoff: 'Выходной', repair: 'Ремонт' };
    
    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
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
    
    document.querySelectorAll('.day-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const selectedType = this.dataset.type;
            document.querySelectorAll('.day-type-btn').forEach(b => {
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
    const selectedDayType = overlay.dataset.selectedDayType || 'dayoff';
    const shift = shifts.find(s => s.date === dateStr);
    if (shift) {
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
        if (overlay) overlay.remove();
        await renderCalendar();
    }
}

// ===== 12. РЕНДЕР КАЛЕНДАРЯ =====
async function renderCalendar() {
    const container = document.getElementById('shift-calendar');
    if (!container) return;
    updateShiftDataFromHistory();
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const today = getLocalDateString();
    const groupedRecords = getGroupedHistoryRecords();
    const dayTypeIcons = { work: 'briefcase-outline', sick: 'medical-outline', vacation: 'airplane-outline', dayoff: 'remove-circle-outline', repair: 'construct-outline' };
    
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
            <button class="btn btn-small btn-secondary" onclick="generateShiftsBySettings()"><ion-icon name="refresh-outline"></ion-icon> Применить</button>
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
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${monthStr}-${String(day).padStart(2, '0')}`;
        const shift = shifts.find(s => s.date === dateStr);
        const metrics = getDailyMetrics(dateStr, groupedRecords);
        const income = metrics.income;
        const orders = metrics.orders;
        const bonuses = metrics.bonuses;
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const isFuture = dateStr > today;
        let isWorking = false;
        let dayType = 'dayoff';
        if (shift) {
            isWorking = shift.isWorking;
            dayType = shift.dayType || (isWorking ? 'work' : 'dayoff');
        } else if (isPast) {
            isWorking = orders > 0;
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
        
        const incomeStr = income >= 1000 ? (income / 1000).toFixed(1) + 'k' : Math.round(income).toString();
        const hasOnlyBonuses = bonuses > 0 && orders === 0;
        let statusIconHtml = '';
        if (isWorking) {
            if (income > 0) statusIconHtml += `<div class="shift-day-income" data-income="${incomeStr}"><ion-icon name="cash-outline"></ion-icon>${incomeStr}</div>`;
            if (orders > 0) statusIconHtml += `<div class="shift-day-orders" data-orders="${orders}"><ion-icon name="cube-outline"></ion-icon>${orders}</div>`;
            if (!statusIconHtml) statusIconHtml = `<div class="shift-day-status"><ion-icon name="${dayTypeIcons[dayType] || 'briefcase-outline'}"></ion-icon></div>`;
        } else if (hasOnlyBonuses) {
            statusIconHtml = `<div class="shift-day-income" style="color: var(--ios-accent);"><ion-icon name="gift-outline"></ion-icon>${formatMoney(bonuses)}</div>`;
        } else {
            statusIconHtml = `<div class="shift-day-status"><ion-icon name="${dayTypeIcons[dayType] || 'remove-circle-outline'}"></ion-icon></div>`;
        }
        html += `<div class="${dayClass}" onclick="editShift('${dateStr}')" style="border-color: ${dayColor}40; background: ${dayColor}20;"><div class="shift-day-number">${day}</div>${statusIconHtml}</div>`;
    }
    html += `</div>`;
    
    const datePrefix = `${currentYear}-${monthStr}`;
    let totalIncome = 0, totalBonuses = 0, totalExpenses = 0, totalOrders = 0, totalHours = 0;
    for (const [date, records] of Object.entries(groupedRecords)) {
        if (date.startsWith(datePrefix)) {
            const m = getDailyMetrics(date, groupedRecords);
            totalIncome += m.income;
            totalBonuses += m.bonuses;
            totalExpenses += m.expenses;
            totalOrders += m.orders;
            totalHours += m.hours;
        }
    }
    const workingDays = shifts.filter(s => s.date.startsWith(datePrefix) && s.isWorking).length;
    const netIncome = totalIncome - totalExpenses;
    const avgIncome = workingDays > 0 ? totalIncome / workingDays : 0;
    const avgHourlyRate = totalHours > 0 ? netIncome / totalHours : 0;
    
    const dayTypeCounts = { work: 0, sick: 0, vacation: 0, dayoff: 0, repair: 0 };
    shifts.forEach(s => {
        if (s.date.startsWith(datePrefix) && s.dayType) {
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
                .summary-hero { padding: 12px 0; margin-bottom: 12px; }
                .hero-value { font-size: 28px; }
                .summary-grid { gap: 8px; margin-bottom: 12px; }
                .grid-item { padding: 10px; }
                .grid-label { font-size: 11px; }
                .grid-label ion-icon { font-size: 14px; }
                .grid-value { font-size: 15px; }
                .day-types-section { padding: 10px; margin-bottom: 12px; }
                .day-types-title { font-size: 12px; margin-bottom: 8px; }
                .day-types-grid { gap: 6px; }
                .day-type-stat { padding: 6px 8px; gap: 8px; }
                .day-type-icon { width: 32px; height: 32px; }
                .day-type-icon ion-icon { font-size: 18px; }
                .day-type-label { font-size: 10px; }
                .day-type-count { font-size: 14px; }
                .summary-footer { gap: 8px; }
                .footer-item { padding: 10px; }
                .footer-label { font-size: 10px; }
                .footer-value { font-size: 14px; }
            }
        `;
        document.head.appendChild(style);
    }
    
    const netIncomeClass = netIncome >= 0 ? 'positive' : 'negative';
    html += `
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
    `;
    container.innerHTML = html;
}

// ===== 12.5. ДЕТАЛИЗАЦИЯ РАСХОДОВ =====
function showExpensesDetailsModal() {
    console.log('💰 Открытие детализации расходов за месяц');
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
    const recordsArray = getHistoryRecords();
    
    const monthRecords = recordsArray.filter(r => {
        const date = normalizeDate(r.date);
        return date.startsWith(datePrefix);
    });
    
    if (monthRecords.length === 0) {
        safeShowToast('ℹ️ Нет записей за этот месяц');
        return;
    }
    
    const expenses = { fuel: [], repair: [], tax: [], other: [] };
    let totalFuel = 0, totalRepair = 0, totalTax = 0, totalOther = 0;
    
    monthRecords.forEach(record => {
        const date = formatDate(normalizeDate(record.date));
        
        // Бензин
        const fuelCost = Number(record.fuelCost) || 0;
        if (fuelCost > 0) {
            expenses.fuel.push({ 
                date: date, 
                amount: fuelCost, 
                description: record.fuelDescription || record.notes || 'Заправка',
                liters: record.liters || '',
                pricePerLiter: record.pricePerLiter || ''
            });
            totalFuel += fuelCost;
        }
        
        // Ремонт с детализацией из repair-module
        const repairCost = Number(record.repairCost) || 0;
        if (repairCost > 0) {
            let allParts = [];
            let allWorks = [];
            let descriptions = [];
            
            // repairDetails - это массив, так как в один день может быть несколько ремонтов
            if (Array.isArray(record.repairDetails)) {
                record.repairDetails.forEach(detail => {
                    if (detail.description) descriptions.push(detail.description);
                    if (Array.isArray(detail.parts)) allParts = allParts.concat(detail.parts);
                    if (Array.isArray(detail.works)) allWorks = allWorks.concat(detail.works);
                });
            }
            
            // Fallback для старых записей или ручного ввода
            if (allParts.length === 0 && Array.isArray(record.repairParts)) {
                allParts = record.repairParts;
            }
            if (allWorks.length === 0) {
                const laborCost = Number(record.repairLabor) || 0;
                if (laborCost > 0) {
                    allWorks.push({ name: 'Работы', cost: laborCost });
                }
            }
            
            // Убираем дубликаты описаний
            const uniqueDescs = [...new Set(descriptions)];
            const mainDesc = uniqueDescs.length > 0 ? uniqueDescs.join('; ') : (record.repairDescription || record.repairType || 'Ремонт');

            expenses.repair.push({ 
                date: date, 
                amount: repairCost, 
                description: mainDesc,
                parts: allParts,
                works: allWorks
            });
            totalRepair += repairCost;
        }
        
        // Налоги
        const tax = Number(record.tax) || 0;
        if (tax > 0) {
            expenses.tax.push({ 
                date: date, 
                amount: tax, 
                description: record.taxDescription || record.notes || 'Налог' 
            });
            totalTax += tax;
        }
        
        // Прочие расходы
        const otherExpenses = Number(record.otherExpenses) || 0;
        if (otherExpenses > 0) {
            expenses.other.push({ 
                date: date, 
                amount: otherExpenses, 
                description: record.otherDescription || record.notes || 'Прочее' 
            });
            totalOther += otherExpenses;
        }
    });
    
    const totalExpenses = totalFuel + totalRepair + totalTax + totalOther;
    
    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
    overlay.innerHTML = `
        <div class="shift-modal" style="max-width: 450px; max-height: 85vh; display: flex; flex-direction: column;">
            <div class="shift-modal-header">
                <ion-icon name="wallet-outline"></ion-icon>
                <h3>Расходы за месяц</h3>
                <button class="shift-modal-close" onclick="this.closest('.shift-modal-overlay').remove()">
                    <ion-icon name="close-outline"></ion-icon>
                </button>
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
                ${buildExpenseCategory('other', 'Прочие расходы', 'pricetag-outline', '#007AFF', expenses.other, totalOther)}
                
                ${totalExpenses === 0 ? '<div style="text-align: center; color: var(--ios-text-tertiary); padding: 30px; font-size: 15px;">Нет расходов за этот месяц</div>' : ''}
            </div>
            <div class="shift-modal-footer">
                <button class="btn btn-primary" onclick="this.closest('.shift-modal-overlay').remove()">
                    <ion-icon name="checkmark-outline"></ion-icon> Закрыть
                </button>
            </div>
        </div>
    `;
    
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
    
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function buildExpenseCategory(id, title, icon, color, items, total) {
    if (items.length === 0 || total === 0) return '';
    const count = items.length;
    const daysWord = getDaysWord(count);
    return `
        <div class="expense-category">
            <div class="expense-category-header" onclick="toggleExpenseCategory('${id}')">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: ${color}20; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <ion-icon name="${icon}" style="font-size: 22px; color: ${color};"></ion-icon>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 15px; font-weight: 700; color: var(--ios-text-primary);">${title}</div>
                    <div style="font-size: 12px; color: var(--ios-text-tertiary);">${count} ${daysWord}</div>
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
    const daysWord = getDaysWord(count);
    
    return `
        <div class="expense-category">
            <div class="expense-category-header" onclick="toggleExpenseCategory('${id}')">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: ${color}20; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <ion-icon name="${icon}" style="font-size: 22px; color: ${color};"></ion-icon>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 15px; font-weight: 700; color: var(--ios-text-primary);">${title}</div>
                    <div style="font-size: 12px; color: var(--ios-text-tertiary);">${count} ${daysWord}</div>
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

// ===== 13. ПЕРЕКЛЮЧЕНИЕ МЕСЯЦА =====
async function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; } 
    else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
    const hasShifts = shifts.some(s => s.date.startsWith(datePrefix));
    if (!hasShifts) await generateShiftsBySettings();
    else updateShiftDataFromHistory();
    await renderCalendar();
}

// ===== 14. ИНИЦИАЛИЗАЦИЯ И ЭКСПОРТ =====
function openShiftCalendar() {
    if (typeof window.switchTab === 'function') window.switchTab('shifts');
    setTimeout(() => renderCalendar(), 100);
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => loadShifts(), 300);
});

const origSwitchTab = window.switchTab || function() {};
window.switchTab = function(tabName) {
    if (typeof origSwitchTab === 'function') origSwitchTab(tabName);
    if (tabName === 'shifts') {
        setTimeout(() => {
            if (typeof loadShifts === 'function') loadShifts();
            if (typeof renderCalendar === 'function') renderCalendar();
        }, 100);
    }
};

window.forceSyncHistoryToCalendar = function() {
    updateShiftDataFromHistory();
    renderCalendar();
    safeUpdateTotals();
    safeShowToast('✅ Данные синхронизированы');
};

window.addEventListener('beforeunload', () => {
    if (firebaseUnsubscribe) firebaseUnsubscribe();
    if (recordsUnsubscribe) recordsUnsubscribe();
});

// Экспорт в глобальную область
window.shifts = shifts;
window.loadShifts = loadShifts;
window.renderCalendar = renderCalendar;
window.changeMonth = changeMonth;
window.toggleShift = toggleShift;
window.editShift = editShift;
window.saveShiftDetails = saveShiftDetails;
window.showScheduleSettingsModal = showScheduleSettingsModal;
window.generateShiftsBySettings = generateShiftsBySettings;
window.clearMonthShifts = clearMonthShifts;
window.openShiftCalendar = openShiftCalendar;
window.formatMoney = formatMoney;
window.scheduleSettings = scheduleSettings;
window.showExpensesDetailsModal = showExpensesDetailsModal;
window.toggleExpenseCategory = toggleExpenseCategory;

console.log('✅ Модуль календаря смен v5.3 (С детализацией расходов) загружен и проверен');