// ============================================
// МОДУЛЬ КАЛЕНДАРЯ СМЕН (ВЕРСИЯ 6.0 - АБСОЛЮТНАЯ СИНХРОНИЗАЦИЯ)
// ============================================

const SHIFTS_STORAGE_KEY = 'driverShifts';
const SHIFTS_COLLECTION = 'shifts';
const SCHEDULE_SETTINGS_KEY = 'scheduleSettings';

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

// ===== 4. НАСТРОЙКИ ГРАФИКА =====
async function loadScheduleSettings() {
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
            await db.collection('users').doc(auth.currentUser.uid).collection('settings').doc(SCHEDULE_SETTINGS_KEY).set(scheduleSettings, { merge: true });
        } catch (error) { console.error(error); }
    }
}

// ===== 5. ИНИЦИАЛИЗАЦИЯ И СИНХРОНИЗАЦИЯ =====
async function loadShifts() {
    try {
        await loadScheduleSettings();
        const saved = localStorage.getItem(SHIFTS_STORAGE_KEY);
        if (saved) shifts = JSON.parse(saved);
        
        if (!shifts || shifts.length === 0) await generateShiftsBySettings(); 
        else updateShiftDataFromHistory();
        
        await renderCalendar();
        
        if (typeof auth !== 'undefined' && typeof db !== 'undefined') {
            if (!auth.currentUser) {
                await new Promise((resolve) => {
                    const unsub = auth.onAuthStateChanged((user) => { unsub(); resolve(user); });
                });
            }
            if (auth.currentUser) {
                if (firebaseUnsubscribe) firebaseUnsubscribe();
                firebaseUnsubscribe = db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).orderBy('date', 'asc').onSnapshot((snapshot) => {
                    const firebaseShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    if (firebaseShifts.length > 0) {
                        mergeFirebaseWithHistory(firebaseShifts);
                        isFirebaseSync = true;
                        saveShiftsLocal();
                        renderCalendar();
                        safeUpdateTotals();
                    }
                }, (error) => console.error(error));
                
                listenToRecordsChanges();
                await loadShiftsFromFirebase();
            }
        }
    } catch (error) { console.error(error); }
}

async function loadShiftsFromFirebase() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    try {
        const snapshot = await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).orderBy('date', 'asc').get();
        if (!snapshot.empty) {
            mergeFirebaseWithHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            isFirebaseSync = true;
            saveShiftsLocal();
        }
    } catch (error) { console.error(error); }
}

function mergeFirebaseWithHistory(firebaseShifts) {
    const groupedRecords = getGroupedHistoryRecords();
    const mergedShifts = firebaseShifts.map(shift => {
        const metrics = getDailyMetrics(shift.date, groupedRecords);
        const updatedShift = { ...shift };
        if (metrics.income > 0) updatedShift.income = metrics.income;
        if (metrics.orders > 0) updatedShift.orders = metrics.orders;
        if (metrics.hours > 0) updatedShift.hours = metrics.hours;
        if (metrics.expenses > 0) updatedShift.expenses = metrics.expenses;
        if (metrics.bonuses > 0) updatedShift.bonuses = metrics.bonuses;
        return updatedShift;
    });
    shifts = mergedShifts;
    window.shifts = shifts;
}

// ⚠️ ВАЖНО: Эта функция нейтрализована, чтобы не перезаписывать window.records неполным кэшем.
// Реальное безопасное объединение локальных и облачных данных теперь полностью 
// управляется блоком "COURIER APP · ЕДИНЫЙ ИСТОЧНИК РАСХОДОВ" в самом низу этого файла.
function listenToRecordsChanges() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    if (recordsUnsubscribe) {
        try { recordsUnsubscribe(); } catch(e) {}
        recordsUnsubscribe = null;
    }
    // Слушатель будет переназначен блоком ExpenseSync ниже
}

// ===== 6. СОХРАНЕНИЕ =====
function saveShiftsLocal() {
    localStorage.setItem(SHIFTS_STORAGE_KEY, JSON.stringify(shifts));
    window.shifts = shifts;
}

async function saveShiftToFirebase(shift) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return false;
    if (!shift || !shift.id) return false;
    try {
        const shiftToSave = { ...shift };
        delete shiftToSave.id;
        await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id).set(shiftToSave, { merge: true });
        return true;
    } catch (error) { return false; }
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
    } catch (error) { return false; }
}

// ===== 7. ОБНОВЛЕНИЕ ДАННЫХ ИЗ ИСТОРИИ =====
function updateShiftDataFromHistory() {
    const recordsArray = getHistoryRecords();
    if (recordsArray.length === 0) return;
    
    const grouped = getGroupedHistoryRecords();
    let updatedCount = 0;
    
    for (let i = 0; i < shifts.length; i++) {
        const shift = shifts[i];
        const targetDate = normalizeDate(shift.date);
        const dayRecords = grouped[targetDate];
        
        // Если записей нет — не трогаем
        if (!dayRecords || dayRecords.length === 0) continue;
        
        const metrics = getDailyMetrics(targetDate, grouped);
        
        // Жестко синхронизируем расходы, если есть записи
        if (Number(shift.expenses) !== Number(metrics.expenses)) {
            shift.expenses = metrics.expenses;
            shift.manualOverride = false;
            updatedCount++;
        }
    }
    
    if (updatedCount > 0) {
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
    if (toRemove.length === 0) { safeShowToast('ℹ️ Нет смен для удаления'); return; }
    
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            const batch = db.batch();
            for (const shift of toRemove) batch.delete(db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id));
            await batch.commit();
        } catch (error) { console.error(error); }
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
                for (const shift of toRemove) batch.delete(db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id));
                await batch.commit();
            } catch (error) { console.error(error); }
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
        if (isPast) finalIsWorking = metrics.orders > 0 || metrics.expenses > 0;
        
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
    
    // Смены всегда есть локально — это уже успех.
    saveShiftsLocal();
    window.shifts = shifts;
    const fbAvailable = (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined');
    if (!fbAvailable) {
        // Облако ещё не готово (идёт загрузка) — НЕ показываем ошибку.
        // heal()/следующая синхронизация допишет смены в облако сами.
        return;
    }
    const saved = await saveShiftsBatchToFirebase(newMonthShifts);
    if (saved) safeShowToast('✅ График создан');
    else safeShowToast('⚠️ График сохранён локально, облако догонит');
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
    for (let i = 1; i <= scheduleSettings.workDays; i++) html += `<div style="padding: 10px 14px; background: var(--ios-bg-primary); border-radius: 10px; border: 1px solid var(--ios-border);"><span style="font-size: 14px; font-weight: 600; color: var(--ios-text-primary);">${i}. Рабочий день</span></div>`;
    for (let i = 1; i <= scheduleSettings.restDays; i++) html += `<div style="padding: 10px 14px; background: var(--ios-bg-secondary); border-radius: 10px; border: 1px solid var(--ios-border); opacity: 0.6;"><span style="font-size: 14px; font-weight: 600; color: var(--ios-text-secondary);">${i}. Выходной</span></div>`;
    container.innerHTML = html;
}

async function saveScheduleSettingsFromModal() {
    const nameInput = document.getElementById('schedule-name');
    const dateInput = document.getElementById('schedule-first-date');
    if (!nameInput || !dateInput) return;
    const name = nameInput.value.trim() || 'График 1';
    const formattedDate = dateInput.value.split('-').reverse().join('.');
    await saveScheduleSettings({ name: name, firstWorkDate: formattedDate, colors: scheduleSettings.colors });
    await generateShiftsBySettings();
    const overlay = document.querySelector('.shift-modal-overlay');
    if (overlay) overlay.remove();
    await renderCalendar();
    safeShowToast(`✅ Настройки сохранены`);
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
    if (dateStr < today && !shiftData.manualOverride) isWorking = metrics.orders > 0 || metrics.expenses > 0;
    
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
    
    const income = (shift && shift.manualOverride) ? (Number(shift.income) || 0) : metrics.income;
    const orders = (shift && shift.manualOverride) ? (Number(shift.orders) || 0) : metrics.orders;
    const hours = (shift && shift.manualOverride) ? (Number(shift.hours) || 0) : metrics.hours;
    const expenses = (shift && shift.manualOverride) ? (Number(shift.expenses) || 0) : metrics.expenses;
    const bonuses = (shift && shift.manualOverride) ? (Number(shift.bonuses) || 0) : metrics.bonuses;
    
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
        safeUpdateTotals();
    }
}

// ===== 12. РЕНДЕР КАЛЕНДАРЯ =====
async function renderCalendar() {
    const container = document.getElementById('shift-calendar');
    if (!container) return;

    // ============================================================
    // ⭐ ЕДИНЫЙ ИСТОЧНИК ДАННЫХ — window.records
    // Карточка «Расходы», ячейки дней и модалка считают отсюда,
    // одной и той же формулой: fuelCost + repairCost + tax
    // ============================================================
    let allRecords = (typeof getHistoryRecords === 'function') ? (getHistoryRecords() || []) : [];
    if (!Array.isArray(allRecords)) allRecords = [];
    if (allRecords.length === 0 && Array.isArray(window.records)) {
        allRecords = window.records;
    }

    // Нормализация даты (с запасным вариантом, если normalizeDate недоступна)
    const normDate = (d) => {
        if (!d) return '';
        if (typeof normalizeDate === 'function') {
            try {
                const n = normalizeDate(d);
                if (n) return String(n).trim();
            } catch (e) { /* используем fallback ниже */ }
        }
        return String(d).trim();
    };

    // Единые формулы расчёта — ТЕ ЖЕ, что в showExpensesDetailsModal()
    const recIncome   = r => (Number(r.payPickup)||0) + (Number(r.payDelivery)||0) + (Number(r.payDistance)||0) + (Number(r.payWeight)||0) + (Number(r.loadPay)||0) + (Number(r.bonusPay)||0) + (Number(r.rating)||0) + (Number(r.tips)||0);
    const recExpenses = r => (Number(r.fuelCost)||0) + (Number(r.repairCost)||0) + (Number(r.tax)||0);
    const recOrders   = r => Number(r.ordersDelivery)||0;
    const recBonuses  = r => Number(r.bonusPay)||0;
    const recHours    = r => Number(r.hours)||0;

    // Группировка свежих записей по дням
    const groupedFresh = {};
    allRecords.forEach(r => {
        const d = normDate(r.date);
        if (!d) return;
        if (!groupedFresh[d]) groupedFresh[d] = [];
        groupedFresh[d].push(r);
    });

    // Метрики конкретного дня — из той же группировки, теми же формулами
    const getDayMetrics = (dateStr) => {
        const recs = groupedFresh[dateStr] || [];
        const m = { income: 0, expenses: 0, orders: 0, bonuses: 0, hours: 0 };
        recs.forEach(r => {
            m.income   += recIncome(r);
            m.expenses += recExpenses(r);
            m.orders   += recOrders(r);
            m.bonuses  += recBonuses(r);
            m.hours    += recHours(r);
        });
        return m;
    };

    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
    const hasShiftsInMonth = shifts.some(s => String(s.date).startsWith(datePrefix));

    if (!hasShiftsInMonth) {
        await generateShiftsBySettings();
        return;
    }

    // ============================================================
    // ⭐ ЖЁСТКАЯ СИНХРОНИЗАЦИЯ shift.expenses ИЗ window.records
    // ============================================================
    shifts.forEach(shift => {
        const d = normDate(shift.date);
        const dayRecs = groupedFresh[d];
        if (dayRecs && dayRecs.length > 0) {
            let exp = 0;
            dayRecs.forEach(r => { exp += recExpenses(r); });
            if (Number(shift.expenses) !== Number(exp)) {
                shift.expenses = exp;
                shift.manualOverride = false; // данные пришли из истории
            }
        }
    });

    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const today = getLocalDateString();
    const dayTypeIcons = { work: 'briefcase-outline', sick: 'medical-outline', vacation: 'airplane-outline', dayoff: 'remove-circle-outline', repair: 'construct-outline' };

    // ============================================================
    // ⭐⭐⭐ ИТОГИ МЕСЯЦА — НАПРЯМУЮ ИЗ window.records (как в модалке) ⭐⭐⭐
    // ============================================================
    let totalIncome = 0, totalBonuses = 0, totalExpenses = 0, totalOrders = 0, totalHours = 0;

    allRecords.forEach(r => {
        const d = normDate(r.date);
        if (!d || !d.startsWith(datePrefix)) return; // только этот месяц

        totalIncome   += recIncome(r);
        totalExpenses += recExpenses(r);
        totalOrders   += recOrders(r);
        totalBonuses  += recBonuses(r);
        totalHours    += recHours(r);
    });
    totalHours = Math.round(totalHours * 10) / 10; // защита от 10.300000000000001 при сложении дробей

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
        const metrics = getDayMetrics(dateStr); // ⭐ из window.records, не из getDailyMetrics
        const income = metrics.income;
        const orders = metrics.orders;
        const bonuses = metrics.bonuses;
        const expenses = metrics.expenses;
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const isFuture = dateStr > today;

        let isWorking = false;
        let dayType = 'dayoff';

        if (shift) {
            isWorking = shift.isWorking;
            dayType = shift.dayType || (isWorking ? 'work' : 'dayoff');
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

        // ============================================================
        // ⭐⭐⭐ СОДЕРЖИМОЕ ЯЧЕЙКИ — ОДНА ЦИФРА ИТОГА + ЗАКАЗЫ ⭐⭐⭐
        // Итог = доход минус расход (бонусы уже включены в доход).
        // Показывается при ЛЮБОМ типе дня. Отдельные строки дохода
        // и расхода убраны, чтобы всё влезало в ячейку.
        // ============================================================
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

    // Сохраняем обновленные смены после рендера, чтобы при перезагрузке было актуально
    localStorage.setItem('driverShifts', JSON.stringify(shifts));
    window.shifts = shifts;
}

// ===== 12.5. ДЕТАЛИЗАЦИЯ РАСХОДОВ =====
function showExpensesDetailsModal() {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
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

let _syncDebounceTimer = null;
window.forceSyncHistoryToCalendar = function() {
    if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(() => {
        if (typeof shifts !== 'undefined' && shifts.length === 0) {
            if (typeof generateShiftsBySettings === 'function') { generateShiftsBySettings(); return; }
        }
        console.log('🔄 forceSyncHistoryToCalendar выполняется...');
        updateShiftDataFromHistory();
        if (typeof renderCalendar === 'function') renderCalendar();
        safeUpdateTotals();
        _syncDebounceTimer = null;
    }, 150);
};

/* ============================================================
   ЕДИНАЯ СИНХРОНИЗАЦИЯ РАСХОДОВ (конец shift-module.js)
   Модалка дня, карточка месяца и смены считают из одних записей.
   Блок идемпотентен — повторная вставка не ломает ничего.
   ============================================================ */
(function () {
    'use strict';

    const num = (v) => {
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        if (v == null) return 0;
        const n = Number(String(v).replace(/\s+/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    };

    const normDate = (d) => {
        if (!d) return '';
        if (typeof d === 'object' && typeof d.toDate === 'function') d = d.toDate();
        if (d instanceof Date) {
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
        const s = String(d).trim();
        let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
        m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
        if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
        return s;
    };

    // Источник как у модалки «Расходы за месяц»
    const getRecords = () => {
        let r = (typeof getHistoryRecords === 'function') ? (getHistoryRecords() || []) : [];
        if (!Array.isArray(r) || r.length === 0) r = Array.isArray(window.records) ? window.records : [];
        return r;
    };

    const recIncome   = r => num(r.payPickup) + num(r.payDelivery) + num(r.payDistance) + num(r.payWeight) + num(r.loadPay) + num(r.bonusPay) + num(r.rating) + num(r.tips);
    const recExpenses = r => num(r.fuelCost) + num(r.repairCost) + num(r.tax);

    const dayMetrics = (dateStr) => {
        const d = normDate(dateStr);
        const m = { income: 0, expenses: 0, orders: 0, bonuses: 0, hours: 0 };
        getRecords().forEach(r => {
            if (normDate(r.date) !== d) return;
            m.income += recIncome(r);
            m.expenses += recExpenses(r);
            m.orders += num(r.ordersDelivery);
            m.bonuses += num(r.bonusPay);
            m.hours += num(r.hours);
        });
        return m;
    };

    const monthTotals = (year, month) => {
        const prefix = year + '-' + String(month + 1).padStart(2, '0');
        const t = { income: 0, expenses: 0, orders: 0, bonuses: 0, hours: 0 };
        getRecords().forEach(r => {
            if (!normDate(r.date).startsWith(prefix)) return;
            t.income += recIncome(r);
            t.expenses += recExpenses(r);
            t.orders += num(r.ordersDelivery);
            t.bonuses += num(r.bonusPay);
            t.hours += num(r.hours);
        });
        return t;
    };

    window.ShiftSync = { num, normDate, getRecords, dayMetrics, monthTotals };

    const setText = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };

    // --- Карточка итогов месяца: всегда из записей ---
    const patchCard = () => {
        const card = document.querySelector('.month-summary-card');
        if (!card) return;
        const y  = (typeof currentYear  !== 'undefined') ? currentYear  : new Date().getFullYear();
        const mo = (typeof currentMonth !== 'undefined') ? currentMonth : new Date().getMonth();
        const t = monthTotals(y, mo);
        const fmt = (typeof formatMoney === 'function') ? formatMoney : (x => String(x));
        setText(card.querySelector('.grid-item[onclick*="showExpensesDetailsModal"] .grid-value'), '-' + fmt(t.expenses));
        const hero = card.querySelector('.hero-value');
        if (hero) {
            const net = t.income - t.expenses;
            setText(hero, fmt(net));
            hero.classList.toggle('positive', net >= 0);
            hero.classList.toggle('negative', net < 0);
        }
    };

    // --- Та самая ячейка: поле «Расходы» в модалке дня ---
    const patchShiftInput = (dateStr) => {
        const inp = document.getElementById('shift-expenses-input');
        if (inp && dateStr) inp.value = dayMetrics(dateStr).expenses;
    };

    if (typeof window.editShift === 'function' && !window.editShift.__syncWrapped) {
        const origEdit = window.editShift;
        window.editShift = function (dateStr) {
            window.__shiftSyncLastDate = dateStr;
            const res = origEdit.apply(this, arguments);
            patchShiftInput(dateStr);
            setTimeout(() => patchShiftInput(dateStr), 0);
            return res;
        };
        window.editShift.__syncWrapped = true;
    }

    if (typeof window.renderCalendar === 'function' && !window.renderCalendar.__syncWrapped) {
        const origRender = window.renderCalendar;
        window.renderCalendar = async function () {
            const res = await origRender.apply(this, arguments);
            patchCard();
            return res;
        };
        window.renderCalendar.__syncWrapped = true;
    }

    // --- Если карточку/модалку рисует другой код — ловим вставку и правим ---
    const startObserver = () => {
        if (window.__shiftSyncObserver) return;
        window.__shiftSyncObserver = new MutationObserver((muts) => {
            patchCard();
            for (const mu of muts) {
                for (const n of mu.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    const hasInput = n.id === 'shift-expenses-input' || (n.querySelector && n.querySelector('#shift-expenses-input'));
                    if (hasInput && window.__shiftSyncLastDate) patchShiftInput(window.__shiftSyncLastDate);
                }
            }
        });
        window.__shiftSyncObserver.observe(document.body, { childList: true, subtree: true });
    };

    // --- Синхронизация shift.expenses из записей ---
    const syncShifts = () => {
        if (typeof shifts === 'undefined' || !Array.isArray(shifts)) return;
        let changed = false;
        shifts.forEach(s => {
            const exp = dayMetrics(s.date).expenses;
            if (Number(s.expenses) !== exp) { s.expenses = exp; s.manualOverride = false; changed = true; }
        });
        if (changed) {
            try { localStorage.setItem('driverShifts', JSON.stringify(shifts)); } catch (e) {}
            window.shifts = shifts;
        }
    };

    const init = () => { syncShifts(); patchCard(); startObserver(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

/* ============================================================================
   COURIER APP · ЕДИНЫЙ ИСТОЧНИК РАСХОДОВ · вставить в КОНЕЦ shift-module.js
   ============================================================================ */
(function () {
    'use strict';
    if (window.__expenseSyncV2) { console.warn('[ExpenseSync] уже установлен'); return; }
    window.__expenseSyncV2 = true;

    var LS_RECORDS = 'driverRecords';
    var LS_TOMB = 'expenseSync_tombstones';
    var LS_SHIFT = 'driverShifts';
    var MAX_TOMB = 600;

    /* ------------------------------- утилиты ------------------------------ */
    function num(v) {
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        if (v == null) return 0;
        var n = Number(String(v).replace(/\s+/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    function normDate(d) {
        if (!d) return '';
        if (typeof d === 'object' && typeof d.toDate === 'function') d = d.toDate();
        if (d instanceof Date) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var s = String(d).trim(), m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
        m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
        if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
        return s;
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsJSON(k, fallback) { var raw = lsGet(k); if (!raw) return fallback; try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; } }
    function stamp(r) { var t = r && (r.updatedAt || r.modifiedAt || r._updatedAt || r.createdAt); if (!t) return 0; if (typeof t === 'object' && typeof t.toMillis === 'function') return t.toMillis(); var n = Date.parse(t); return isFinite(n) ? n : (num(t) || 0); }
    function keyOf(r) {
        if (!r) return '';
        if (r.id != null && r.id !== '') return 'id:' + r.id;
        return 'sig:' + normDate(r.date) + '|' + num(r.fuelCost) + '|' + num(r.repairCost) + '|' + num(r.tax) + '|' + num(r.payDelivery) + '|' + num(r.ordersDelivery) + '|' + num(r.hours);
    }
    function expensesOf(r) { return num(r.fuelCost) + num(r.repairCost) + num(r.tax); }
    function fbReady() { return typeof db !== 'undefined' && db && typeof auth !== 'undefined' && auth && auth.currentUser; }
    function fbCol() { return db.collection('users').doc(auth.currentUser.uid).collection('records'); }

    /* ------------------------------ состояние ----------------------------- */
    var st = {
        union: [], byKey: {}, cloudReady: false, cloudIds: {}, prevCloudIds: null,
        tomb: {}, healing: false, renderTimer: 0, attached: false, bootAt: Date.now(), lastReason: 'boot'
    };
    (lsJSON(LS_TOMB, []) || []).forEach(function (id) { st.tomb[id] = 1; });

    function saveTomb() {
        var ids = Object.keys(st.tomb);
        if (ids.length > MAX_TOMB) { ids = ids.slice(ids.length - MAX_TOMB); st.tomb = {}; ids.forEach(function (i) { st.tomb[i] = 1; }); }
        lsSet(LS_TOMB, JSON.stringify(ids));
    }

    /* ------------------------------- источники ---------------------------- */
    var rawHistoryFn = (typeof window.getHistoryRecords === 'function') ? window.getHistoryRecords : null;
    function localRaw() {
        var arr = null;
        if (rawHistoryFn) { try { arr = rawHistoryFn(); } catch (e) { arr = null; } }
        if (!Array.isArray(arr) || !arr.length) arr = lsJSON(LS_RECORDS, []);
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
    }
    function cloudRaw() { return Array.isArray(window.records) ? window.records.filter(Boolean) : []; }

    /* ------------------------------ объединение --------------------------- */
    function rebuild(reason) {
        st.lastReason = reason || 'manual';
        var local = localRaw(), cloudArr = cloudRaw();
        var map = {}, order = [];

        function put(r, origin) {
            var k = keyOf(r); if (!k) return;
            if (st.tomb[k] || (r.id != null && st.tomb['id:' + r.id])) return;
            if (!map[k]) { map[k] = r; order.push(k); return; }
            var cur = map[k];
            var a = stamp(r), b = stamp(cur);
            if (a > b) map[k] = r;
            else if (a === b && origin === 'cloud' && st.cloudReady) map[k] = r;
        }
        local.forEach(function (r) { put(r, 'local'); });
        cloudArr.forEach(function (r) { put(r, 'cloud'); });
        // ⭐ sideRecords УБРАНА: боковые журналы (driverFuelLogs/repair_records)
        // не подмешиваются в расходы календаря — это давало дубли заправок.
        // Расходы = только records (локальные + облако).

        st.union = order.map(function (k) { return map[k]; });
        st.byKey = map;

        var raw = lsJSON(LS_RECORDS, []);
        var rawKeys = (Array.isArray(raw) ? raw : []).map(keyOf).sort().join('~');
        var unionKeys = st.union.map(keyOf).sort().join('~');
        if (rawKeys !== unionKeys) lsSet(LS_RECORDS, JSON.stringify(st.union));

        if (typeof shifts !== 'undefined' && Array.isArray(shifts) && shifts.length > 0) {
            var sh = shifts;
            var changed = false;
            sh.forEach(function (s) {
                var d = normDate(s.date), s_exp = 0;
                for (var i = 0; i < st.union.length; i++) if (normDate(st.union[i].date) === d) s_exp += expensesOf(st.union[i]);
                s_exp = Math.round(s_exp * 100) / 100;
                if (num(s.expenses) !== s_exp) { s.expenses = s_exp; s.manualOverride = false; changed = true; }
            });
            if (changed) { lsSet(LS_SHIFT, JSON.stringify(sh)); window.shifts = sh; }
        }

        scheduleRender();
        heal();
        badge();
        return st.union;
    }

    /* --------------------------- смены и рендер --------------------------- */
    function dayExpenses(dateStr) {
        var d = normDate(dateStr), s = 0;
        for (var i = 0; i < st.union.length; i++) if (normDate(st.union[i].date) === d) s += expensesOf(st.union[i]);
        return Math.round(s * 100) / 100;
    }
    function scheduleRender() {
        if (st.renderTimer) clearTimeout(st.renderTimer);
        st.renderTimer = setTimeout(function () {
            st.renderTimer = 0;
            try { if (typeof window.updateShiftDataFromHistory === 'function') window.updateShiftDataFromHistory(); } catch (e) {}
            try { if (typeof window.renderCalendar === 'function') window.renderCalendar(); } catch (e) {}
            try { if (typeof window.safeUpdateTotals === 'function') window.safeUpdateTotals(); } catch (e) {}
        }, 150);
    }

    /* ---------------------- единый источник для приложения ---------------- */
    window.getHistoryRecords = function () { return st.union.length ? st.union.slice() : localRaw(); };
    if (typeof window.getGroupedHistoryRecords === 'function') {
        window.getGroupedHistoryRecords = function () {
            var g = {};
            window.getHistoryRecords().forEach(function (r) { var d = normDate(r.date); if (!d) return; (g[d] = g[d] || []).push(r); });
            return g;
        };
    }

    /* ------------------------- слушатель Firestore ------------------------ */
    function attachListener() {
        if (!fbReady()) return false;
        try { if (typeof recordsUnsubscribe === 'function') { recordsUnsubscribe(); recordsUnsubscribe = null; } } catch (e) {}
        var unsub;
        try {
            unsub = fbCol().onSnapshot(function (snap) {
                var fromCache = !!(snap.metadata && snap.metadata.fromCache);
                var arr = snap.docs.map(function (d) { var o = d.data() || {}; o.id = d.id; return o; });

                if (fromCache && st.union.length && st.cloudReady) return;

                if (!fromCache) {
                    var ids = {};
                    arr.forEach(function (r) { ids['id:' + r.id] = 1; });
                    if (st.prevCloudIds && (arr.length > 0 || Object.keys(st.prevCloudIds).length <= 5)) {
                        var killed = 0;
                        Object.keys(st.prevCloudIds).forEach(function (k) { if (!ids[k] && !st.tomb[k]) { st.tomb[k] = 1; killed++; } });
                        if (killed) saveTomb();
                    }
                    st.prevCloudIds = ids;
                    st.cloudIds = ids;
                    st.cloudReady = true;
                }
                window.records = arr;
                rebuild(fromCache ? 'cache' : 'server');
            }, function (err) {
                console.warn('[ExpenseSync] onSnapshot:', (err && err.code) || err);
                st.cloudReady = true; badge();
            });
        } catch (e) { console.warn('[ExpenseSync] не удалось подключить слушатель:', e); return false; }
        try { recordsUnsubscribe = unsub; } catch (e) { window.__expenseUnsub = unsub; }
        st.attached = true;
        return true;
    }
    window.listenToRecordsChanges = attachListener;

    /* ------------------ долечивание: локальное → облако ------------------- */
    function heal() {
        if (!st.cloudReady || !fbReady() || st.healing) return;
        var missing = st.union.filter(function (r) {
            if (r.__fromSide) return false;
            var k = keyOf(r);
            if (st.tomb[k]) return false;
            if (r.id == null || r.id === '') return false;
            return !st.cloudIds['id:' + r.id];
        }).slice(0, 25);
        if (!missing.length) return;
        st.healing = true;
        var col = fbCol(), i = 0;
        (function next() {
            if (i >= missing.length) { st.healing = false; badge(); return; }
            var r = missing[i++];
            var data = {}; Object.keys(r).forEach(function (k) { if (k !== 'id') data[k] = r[k]; });
            col.doc(String(r.id)).set(data, { merge: true }).then(next).catch(function (e) {
                console.warn('[ExpenseSync] запись не отправлена в облако:', r.id, (e && e.code) || '');
                st.healing = false; badge();
            });
        })();
    }

    /* ------------------------------- индикатор ---------------------------- */
    // Пилюля на экране убрана по запросу. Статус: ExpenseSync.status() в консоли.
    function badge() { /* no-op: визуальный индикатор отключён */ }

    /* -------------------------------- запуск ------------------------------ */
    function boot(reason) {
        rebuild(reason);
        if (!st.attached && attachListener()) return;
        if (!st.attached && typeof auth !== 'undefined' && auth && typeof auth.onAuthStateChanged === 'function' && !st.authHooked) {
            st.authHooked = true;
            try {
                auth.onAuthStateChanged(function (u) { if (u && !st.attached) { attachListener(); rebuild('auth'); } });
            } catch (e) {}
        }
    }
    
    // ⭐ Разовая чистка: удаляем side-копии, созданные прошлой версией
    (function purgeSide() {
        try {
            var raw = lsJSON(LS_RECORDS, []);
            if (Array.isArray(raw)) {
                var clean = raw.filter(function (r) { return r && !r.__fromSide && String(r.id || '').indexOf('side_') !== 0; });
                if (clean.length !== raw.length) lsSet(LS_RECORDS, JSON.stringify(clean));
            }
        } catch (e) {}
    })();
    
    boot('boot');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot('dom'); });
    window.addEventListener('focus', function () { rebuild('focus'); });
    window.addEventListener('online', function () { st.cloudReady = false; attachListener(); rebuild('online'); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) rebuild('visible'); });
    setTimeout(function () { if (!st.cloudReady) { st.cloudReady = true; badge(); scheduleRender(); } }, 6000);

    window.ExpenseSync = {
        rebuild: function () { return rebuild('api'); },
        status: function () {
            return {
                записей: st.union.length,
                локально: localRaw().length,
                облако: cloudRaw().length,
                готовоОблако: st.cloudReady,
                слушатель: st.attached,
                надгробия: Object.keys(st.tomb).length,
                расходВсего: Math.round(st.union.reduce(function (a, r) { return a + expensesOf(r); }, 0) * 100) / 100,
                причина: st.lastReason
            };
        },
        dayExpenses: dayExpenses,
        records: function () { return st.union.slice(); },
        resetTombstones: function () { st.tomb = {}; saveTomb(); rebuild('reset-tomb'); return 'надгробия очищены'; }
    };

    console.log('%c[ExpenseSync] установлен: локальная история и облако объединяются, первый рендер уже полный. Диагностика: ExpenseSync.status()', 'color:#35e07f;font-weight:bold');
})();

window.addEventListener('beforeunload', () => {
    if (firebaseUnsubscribe) firebaseUnsubscribe();
    if (recordsUnsubscribe) recordsUnsubscribe();
});

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

console.log('✅ Модуль календаря смен v6.0 (Абсолютная синхронизация) загружен');