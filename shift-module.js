// ============================================
// МОДУЛЬ КАЛЕНДАРЯ СМЕН (ВЕРСИЯ 5.2 - ОПТИМИЗИРОВАННАЯ И СТАБИЛЬНАЯ)
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

// 🔥 ИСПРАВЛЕНИЕ: Получение локальной даты без сдвига UTC
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

// ===== 3. ОПТИМИЗАЦИЯ РАБОТЫ С ИСТОРИЕЙ (O(1) ВМЕСТО O(N×M)) =====
function getHistoryRecords() {
    const r = (typeof window.records !== 'undefined') ? window.records : (typeof records !== 'undefined' ? records : []);
    return Array.isArray(r) ? r : [];
}

// 🔥 ГРУППИРОВКА: Создается один раз, что ускоряет рендер в десятки раз
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

// 🔥 ЕДИНЫЙ РАСЧЕТ: Заменяет 5 отдельных функций фильтрации
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
            const doc = await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection('settings')
                .doc(SCHEDULE_SETTINGS_KEY)
                .get();
            
            if (doc.exists) {
                const data = doc.data();
                // 🔥 ОЧИСТКА: Оставляем только разрешенные типы дней
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
                console.log('✅ Загружены настройки графика из Firebase:', scheduleSettings);
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
            // 🔥 ОЧИСТКА: Оставляем только разрешенные типы дней
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
            console.log('✅ Загружены настройки графика из localStorage:', scheduleSettings);
            return scheduleSettings;
        } catch (e) {
            console.error('❌ Ошибка парсинга настроек из localStorage:', e);
        }
    }
    
    console.log('⚠️ Используются настройки по умолчанию');
    return scheduleSettings;
}

async function saveScheduleSettings(settings) {
    console.log('💾 Сохранение настроек графика:', settings);
    
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
            await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection('settings')
                .doc(SCHEDULE_SETTINGS_KEY)
                .set(scheduleSettings, { merge: true });
            console.log('✅ Настройки графика сохранены в Firebase');
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
            console.log('📅 Загружено смен из localStorage:', shifts.length);
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
                console.log('☁️ Подключение real-time слушателя смен...');
                if (firebaseUnsubscribe) {
                    firebaseUnsubscribe();
                    firebaseUnsubscribe = null;
                }
                
                firebaseUnsubscribe = db.collection('users')
                    .doc(auth.currentUser.uid)
                    .collection(SHIFTS_COLLECTION)
                    .orderBy('date', 'asc')
                    .onSnapshot((snapshot) => {
                        console.log('🔄 Получены изменения смен из Firebase, документов:', snapshot.docs.length);
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
        const snapshot = await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection(SHIFTS_COLLECTION)
            .orderBy('date', 'asc')
            .get();
        
        if (!snapshot.empty) {
            const firebaseShifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            mergeFirebaseWithHistory(firebaseShifts);
            isFirebaseSync = true;
            saveShiftsLocal();
            console.log(`✅ Загружено и обработано ${shifts.length} смен из Firebase`);
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки из Firebase:', error);
    }
}

function mergeFirebaseWithHistory(firebaseShifts) {
    const groupedRecords = getGroupedHistoryRecords();
    
    // 🔥 ИММУТАБЕЛЬНОСТЬ: Создаем новые объекты вместо мутации
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
    console.log(`✅ Данные синхронизированы: ${shifts.length} смен`);
}

function listenToRecordsChanges() {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') return;
    if (recordsUnsubscribe) {
        recordsUnsubscribe();
        recordsUnsubscribe = null;
    }
    
    recordsUnsubscribe = db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('records')
        .onSnapshot((snapshot) => {
            console.log('🔄 Получены изменения записей из Firebase, документов:', snapshot.docs.length);
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
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') {
        console.warn('⚠️ Сохранение в Firebase пропущено: нет авторизации или db.');
        return false;
    }
    if (!shift || !shift.id) {
        console.error('❌ Ошибка сохранения: у объекта смены отсутствует id', shift);
        return false;
    }
    try {
        const shiftToSave = { ...shift };
        delete shiftToSave.id;
        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection(SHIFTS_COLLECTION)
            .doc(shift.id)
            .set(shiftToSave, { merge: true });
        console.log(`✅ Смена ${shift.id} сохранена в Firebase`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения смены в Firebase:', error);
        return false;
    }
}

// 🔥 ЧАНКИНГ: Защита от лимита Firestore в 500 операций на batch
async function saveShiftsBatchToFirebase(shiftsArray) {
    if (typeof auth === 'undefined' || !auth.currentUser || typeof db === 'undefined') {
        console.error('❌ ОШИБКА: Нет авторизации или db не определен');
        return false;
    }
    if (!shiftsArray || shiftsArray.length === 0) {
        console.warn('⚠️ Пустой массив для сохранения');
        return true;
    }
    
    console.log(`🔄 Начало пакетного сохранения ${shiftsArray.length} документов...`);
    try {
        const CHUNK_SIZE = 400; // Безопасный лимит для Firestore (макс 500)
        for (let i = 0; i < shiftsArray.length; i += CHUNK_SIZE) {
            const chunk = shiftsArray.slice(i, i + CHUNK_SIZE);
            const batch = db.batch();
            
            for (const shift of chunk) {
                if (!shift.id) continue;
                const shiftToSave = { ...shift };
                delete shiftToSave.id;
                if (shiftToSave.startTime === undefined) shiftToSave.startTime = null;
                if (shiftToSave.endTime === undefined) shiftToSave.endTime = null;
                
                const ref = db.collection('users')
                    .doc(auth.currentUser.uid)
                    .collection(SHIFTS_COLLECTION)
                    .doc(shift.id);
                batch.set(ref, shiftToSave, { merge: true });
            }
            
            console.log(`📡 Отправка batch.commit() (чанк ${Math.floor(i / CHUNK_SIZE) + 1})...`);
            await batch.commit();
        }
        console.log(`✅ УСПЕХ: ${shiftsArray.length} смен сохранены в Firebase!`);
        
        for (const shift of shiftsArray) {
            const idx = shifts.findIndex(s => s.id === shift.id);
            if (idx !== -1) {
                shifts[idx] = { ...shifts[idx], ...shift };
            } else {
                shifts.push(shift);
            }
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
        console.log('🔄 Обновлены данные смен из истории');
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
            console.log(`✅ Удалено ${toRemove.length} смен из Firebase`);
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
    console.log('🔄 Генерация графика по настройкам...');
    
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = getLocalDateString(); // 🔥 ИСПРАВЛЕНИЕ ЧАСОВОГО ПОЯСА
    
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
                console.log(`✅ Удалено ${toRemove.length} старых смен из Firebase`);
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
    
    console.log(`📤 Сохранение ${newMonthShifts.length} смен в Firebase...`);
    const saved = await saveShiftsBatchToFirebase(newMonthShifts);
    
    if (saved) {
        console.log('✅ График создан успешно');
        safeShowToast(`✅ График "${scheduleSettings.name}" создан`);
    } else {
        console.error('❌ Ошибка сохранения графика');
        safeShowToast('❌ Ошибка сохранения графика');
    }
}

// ===== 9. МОДАЛЬНЫЕ ОКНА =====
function showScheduleSettingsModal() {
    console.log('⚙️ Открытие окна настроек графика');
    
    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
    overlay.innerHTML = `
        <div class="shift-modal" style="max-width: 400px; max-height: 90vh; overflow-y: auto;">
            <div class="shift-modal-header">
                <ion-icon name="settings-outline"></ion-icon>
                <h3>Настройка графика</h3>
                <button class="shift-modal-close" onclick="this.closest('.shift-modal-overlay').remove()">
                    <ion-icon name="close-outline"></ion-icon>
                </button>
            </div>
            <div class="shift-modal-body">
                <div style="margin-bottom: 20px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 6px;">Название</label>
                    <input type="text" id="schedule-name" value="${scheduleSettings.name}" 
                        style="width: 100%; padding: 10px; border: 1px solid var(--ios-border); border-radius: 10px; font-size: 15px; background: var(--ios-bg-input); color: var(--ios-text-primary);"
                        placeholder="График 1">
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: var(--ios-text-primary); margin-bottom: 12px;">Выберите график</h4>
                    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px;">
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${[1,2,3,4,5,6,7].map(n => `
                                <button class="schedule-day-btn ${n === scheduleSettings.workDays ? 'selected' : ''}" 
                                    data-type="work" data-value="${n}"
                                    style="width: 32px; height: 32px; border-radius: 8px; border: 2px solid ${n === scheduleSettings.workDays ? 'var(--ios-accent)' : 'var(--ios-border)'}; 
                                    background: ${n === scheduleSettings.workDays ? 'var(--ios-accent)' : 'var(--ios-bg-secondary)'}; 
                                    color: ${n === scheduleSettings.workDays ? 'white' : 'var(--ios-text-primary)'}; 
                                    font-size: 13px; font-weight: 600; cursor: pointer; flex-shrink: 0;">
                                    ${n}
                                </button>
                            `).join('')}
                        </div>
                        <span style="color: var(--ios-text-secondary); font-size: 13px; white-space: nowrap;">через</span>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${[1,2,3,4,5,6,7].map(n => `
                                <button class="schedule-day-btn ${n === scheduleSettings.restDays ? 'selected' : ''}" 
                                    data-type="rest" data-value="${n}"
                                    style="width: 32px; height: 32px; border-radius: 8px; border: 2px solid ${n === scheduleSettings.restDays ? 'var(--ios-accent)' : 'var(--ios-border)'}; 
                                    background: ${n === scheduleSettings.restDays ? 'var(--ios-accent)' : 'var(--ios-bg-secondary)'}; 
                                    color: ${n === scheduleSettings.restDays ? 'white' : 'var(--ios-text-primary)'}; 
                                    font-size: 13px; font-weight: 600; cursor: pointer; flex-shrink: 0;">
                                    ${n}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: var(--ios-text-primary); margin-bottom: 12px;">Настройте дни</h4>
                    <div id="schedule-days-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
                
                <div style="margin-bottom: 24px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 6px;">Дата первого рабочего дня</label>
                    <input type="date" id="schedule-first-date" value="${scheduleSettings.firstWorkDate.split('.').reverse().join('-')}" 
                        style="width: 100%; padding: 10px; border: 1px solid var(--ios-border); border-radius: 10px; font-size: 15px; background: var(--ios-bg-input); color: var(--ios-text-primary);">
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: var(--ios-text-primary); margin-bottom: 12px;">Настройте цвета</h4>
                    <div id="colors-container" style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${Object.entries(scheduleSettings.colors).map(([key, color]) => `
                            <button class="color-btn" data-type="${key}" data-color="${color}"
                                style="padding: 8px 14px; border-radius: 8px; border: 2px solid ${color}; 
                                background: ${color}; color: ${key === 'dayoff' || ['#FFE066', '#FFFFFF', '#FFCC00'].includes(color) ? '#000' : '#fff'}; font-size: 13px; font-weight: 600; cursor: pointer; position: relative;">
                                ${getDayTypeName(key)}
                                <ion-icon name="color-fill-outline" style="position: absolute; top: 2px; right: 2px; font-size: 10px; opacity: 0.7;"></ion-icon>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="shift-modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.shift-modal-overlay').remove()">
                    <ion-icon name="close-outline"></ion-icon> Отмена
                </button>
                <button class="btn btn-primary" onclick="saveScheduleSettingsFromModal()">
                    <ion-icon name="checkmark-outline"></ion-icon> Сохранить
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        initScheduleDayButtons();
        updateScheduleDaysList();
        initColorButtons();
    });
}

function getDayTypeName(key) {
    const names = {
        work: 'Рабочий день',
        sick: 'Больничный',
        vacation: 'Отпуск',
        dayoff: 'Выходной',
        repair: 'Ремонт'
    };
    return names[key] || key;
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
        html += `<div style="padding: 10px 14px; background: var(--ios-bg-primary); border-radius: 10px; border: 1px solid var(--ios-border);">
                    <span style="font-size: 14px; font-weight: 600; color: var(--ios-text-primary);">${i}. Рабочий день</span>
                 </div>`;
    }
    for (let i = 1; i <= scheduleSettings.restDays; i++) {
        html += `<div style="padding: 10px 14px; background: var(--ios-bg-secondary); border-radius: 10px; border: 1px solid var(--ios-border); opacity: 0.6;">
                    <span style="font-size: 14px; font-weight: 600; color: var(--ios-text-secondary);">${i}. Выходной</span>
                 </div>`;
    }
    container.innerHTML = html;
}

function initColorButtons() {
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            showColorPickerModal(this.dataset.type, this.dataset.color);
        });
    });
}

function showColorPickerModal(type, currentColor) {
    const presetColors = [
        '#5AC8FA', '#007AFF', '#5856D6', '#FF2D55', '#FF3B30', '#FF9500',
        '#FFCC00', '#4CD964', '#34C759', '#30D158', '#00C7BE', '#64D2FF',
        '#D4A5FF', '#BF5AF2', '#FF6482', '#FFD60A', '#FFE066', '#A3B1C6',
        '#8E8E93', '#636366', '#48484A', '#1C1C1E', '#FFFFFF', '#F2F2F7'
    ];
    
    const overlay = document.createElement('div');
    overlay.className = 'shift-modal-overlay';
    overlay.innerHTML = `
        <div class="shift-modal" style="max-width: 320px;">
            <div class="shift-modal-header">
                <ion-icon name="color-palette-outline"></ion-icon>
                <h3>Выберите цвет</h3>
                <button class="shift-modal-close" onclick="this.closest('.shift-modal-overlay').remove()">
                    <ion-icon name="close-outline"></ion-icon>
                </button>
            </div>
            <div class="shift-modal-body">
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 8px;">
                        ${getDayTypeName(type)}
                    </label>
                    <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--ios-bg-tertiary); border-radius: 10px;">
                        <div id="color-preview" style="width: 40px; height: 40px; border-radius: 8px; background: ${currentColor}; border: 2px solid var(--ios-border);"></div>
                        <input type="color" id="color-picker-input" value="${currentColor}" 
                            style="flex: 1; height: 40px; border: none; border-radius: 8px; cursor: pointer; background: transparent;">
                    </div>
                </div>
                <div>
                    <label style="display: block; font-size: 12px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 8px;">Быстрый выбор</label>
                    <div id="preset-colors-grid" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;">
                        ${presetColors.map(color => `
                            <button class="preset-color-btn" data-color="${color}"
                                style="width: 100%; aspect-ratio: 1; border-radius: 6px; background: ${color}; border: 2px solid ${color === currentColor ? 'var(--ios-accent)' : 'transparent'}; cursor: pointer; transition: transform 0.2s;"
                                onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="shift-modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.shift-modal-overlay').remove()">Отмена</button>
                <button class="btn btn-primary" onclick="applyColor('${type}')">
                    <ion-icon name="checkmark-outline"></ion-icon> Применить
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        
        document.querySelectorAll('.preset-color-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const selectedColor = this.dataset.color;
                document.getElementById('color-picker-input').value = selectedColor;
                document.getElementById('color-preview').style.background = selectedColor;
                document.querySelectorAll('.preset-color-btn').forEach(b => b.style.borderColor = 'transparent');
                this.style.borderColor = 'var(--ios-accent)';
            });
        });
        
        document.getElementById('color-picker-input').addEventListener('input', function() {
            document.getElementById('color-preview').style.background = this.value;
            document.querySelectorAll('.preset-color-btn').forEach(b => b.style.borderColor = 'transparent');
        });
    });
}

// 🔥 УБРАНО: window._currentColorPicker. Теперь читаем напрямую из DOM.
function applyColor(type) {
    const input = document.getElementById('color-picker-input');
    if (!input) return;
    const newColor = input.value;
    
    scheduleSettings.colors[type] = newColor;
    
    const overlays = document.querySelectorAll('.shift-modal-overlay');
    const mainOverlay = overlays.length > 1 ? overlays[0] : null;
    const colorOverlay = overlays[overlays.length - 1];
    if (colorOverlay) colorOverlay.remove();
    
    if (mainOverlay) {
        const colorBtn = mainOverlay.querySelector(`.color-btn[data-type="${type}"]`);
        if (colorBtn) {
            colorBtn.dataset.color = newColor;
            colorBtn.style.background = newColor;
            colorBtn.style.borderColor = newColor;
            colorBtn.style.color = (type === 'dayoff' || ['#FFE066', '#FFFFFF', '#FFCC00'].includes(newColor)) ? '#000' : '#fff';
        }
    }
    console.log(`✅ Цвет применен: ${type} = ${newColor}`);
}

async function saveScheduleSettingsFromModal() {
    const nameInput = document.getElementById('schedule-name');
    const dateInput = document.getElementById('schedule-first-date');
    
    if (!nameInput || !dateInput) return;
    
    const name = nameInput.value.trim() || 'График 1';
    const dateValue = dateInput.value;
    const formattedDate = dateValue.split('-').reverse().join('.');
    
    await saveScheduleSettings({
        name: name,
        firstWorkDate: formattedDate,
        colors: scheduleSettings.colors
    });
    
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
    const today = getLocalDateString(); // 🔥 ИСПРАВЛЕНИЕ ЧАСОВОГО ПОЯСА
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
    
    // 🔥 Иконки для типов дней
    const dayTypeIcons = {
        work: 'briefcase-outline',
        sick: 'medical-outline',
        vacation: 'airplane-outline',
        dayoff: 'remove-circle-outline',
        repair: 'construct-outline'
    };
    
    const dayTypeNames = {
        work: 'Рабочий день',
        sick: 'Больничный',
        vacation: 'Отпуск',
        dayoff: 'Выходной',
        repair: 'Ремонт'
    };
    
    // 🔥 ДОБАВЛЕНЫ АДАПТИВНЫЕ СТИЛИ
    const style = document.createElement('style');
    style.textContent = `
        .day-type-btn {
            min-width: 65px;
            transition: all 0.2s;
        }
        .day-type-btn ion-icon {
            font-size: 20px;
            margin-bottom: 2px;
        }
        .day-type-btn span {
            font-size: 10px;
            font-weight: 600;
            text-align: center;
            line-height: 1.1;
            word-break: break-word;
        }
        @media (max-width: 380px) {
            .day-type-btn {
                min-width: 60px;
                padding: 6px 2px !important;
            }
            .day-type-btn ion-icon {
                font-size: 18px !important;
            }
            .day-type-btn span {
                font-size: 9px !important;
            }
        }
        @media (max-width: 350px) {
            #day-type-selector {
                gap: 4px !important;
            }
            .day-type-btn {
                min-width: 55px;
                padding: 5px 2px !important;
            }
        }
    `;
    document.head.appendChild(style);
    
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
                
                <!-- 🔥 ВЫБОР ТИПА ДНЯ - АДАПТИВНЫЙ -->
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 13px; font-weight: 600; color: var(--ios-text-secondary); margin-bottom: 8px;">Тип дня</label>
                    <div id="day-type-selector" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(65px, 1fr)); gap: 6px;">
                        ${Object.entries(dayTypeIcons).map(([type, icon]) => `
                            <button class="day-type-btn ${type === dayType ? 'active' : ''}" 
                                data-type="${type}"
                                style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border-radius: 8px; border: 2px solid ${type === dayType ? 'var(--ios-accent)' : 'var(--ios-border)'}; background: ${type === dayType ? 'var(--ios-accent)' : 'var(--ios-bg-secondary)'}; color: ${type === dayType ? 'white' : 'var(--ios-text-primary)'}; cursor: pointer;">
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
    
    // 🔥 Инициализация выбора типа дня
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
            
            // Сохраняем выбранный тип в data атрибут модалки
            overlay.dataset.selectedDayType = selectedType;
        });
    });
}

async function toggleShiftFromModal(dateStr, isWorking) {
    const shift = shifts.find(s => s.date === dateStr);
    if (shift) {
        shift.isWorking = isWorking;
        shift.manualOverride = true;
        shift.startTime = isWorking ? `${WORK_START_HOUR}:00` : null;
        shift.endTime = isWorking ? `${WORK_END_HOUR}:00` : null;
        shift.hours = isWorking ? (WORK_END_HOUR - WORK_START_HOUR) : 0;
        shift.updatedAt = new Date().toISOString();
        
        saveShiftsLocal();
        await saveShiftToFirebase(shift);
    }
    const overlay = document.querySelector('.shift-modal-overlay');
    if (overlay) overlay.remove();
    await renderCalendar();
    showShiftModal(dateStr);
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
        
        // Устанавливаем время для рабочего дня
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
    
    console.log(' Рендер календаря с настройками:', scheduleSettings);
    
    updateShiftDataFromHistory();
    
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const today = getLocalDateString();
    
    // 🔥 ОПТИМИЗАЦИЯ: Группируем записи ОДИН раз для всего рендера
    const groupedRecords = getGroupedHistoryRecords();
    
    // 🔥 СЛОВАРЬ ИКОНОК ДЛЯ ТИПОВ ДНЕЙ
    const dayTypeIcons = {
        work: 'briefcase-outline',
        sick: 'medical-outline',
        vacation: 'airplane-outline',
        dayoff: 'remove-circle-outline',
        repair: 'construct-outline'
    };
    
    let html = `
        <div class="shift-calendar-header">
            <button class="shift-nav-btn" onclick="changeMonth(-1)"><ion-icon name="chevron-back-outline"></ion-icon></button>
            <div style="text-align: center;">
                <h2>${monthNames[currentMonth]} ${currentYear}</h2>
                <div style="font-size: 11px; color: var(--ios-text-secondary); margin-top: 2px;">
                    ${scheduleSettings.name} · ${scheduleSettings.workDays}/${scheduleSettings.restDays}
                </div>
            </div>
            <button class="shift-nav-btn" onclick="changeMonth(1)"><ion-icon name="chevron-forward-outline"></ion-icon></button>
        </div>
        <div class="shift-calendar-actions">
            <button class="btn btn-small btn-primary" onclick="showScheduleSettingsModal()">
                <ion-icon name="settings-outline"></ion-icon> Настроить график
            </button>
            <button class="btn btn-small btn-secondary" onclick="generateShiftsBySettings()">
                <ion-icon name="refresh-outline"></ion-icon> Применить
            </button>
            <button class="btn btn-small btn-danger" onclick="clearMonthShifts()">
                <ion-icon name="trash-outline"></ion-icon> Очистить
            </button>
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
        
        // 🔥 O(1) ПОЛУЧЕНИЕ ДАННЫХ вместо множественных filter()
        const metrics = getDailyMetrics(dateStr, groupedRecords);
        const income = metrics.income;
        const orders = metrics.orders;
        const bonuses = metrics.bonuses;
        
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const isFuture = dateStr > today;
        
        let isWorking = false;
        let dayType = 'dayoff';
        
        // 🔥 ИСПРАВЛЕНИЕ: Теперь корректно считываем dayType из смены
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
        
        // 🔥 ФОРМИРОВАНИЕ HTML ДЛЯ СТАТУСА ДНЯ С УЧЕТОМ dayType
        let statusIconHtml = '';
        
        if (isWorking) {
            if (income > 0) statusIconHtml += `<div class="shift-day-income" data-income="${incomeStr}"><ion-icon name="cash-outline"></ion-icon>${incomeStr}</div>`;
            if (orders > 0) statusIconHtml += `<div class="shift-day-orders" data-orders="${orders}"><ion-icon name="cube-outline"></ion-icon>${orders}</div>`;
            // Если нет дохода и заказов, но день рабочий, показываем иконку типа дня
            if (!statusIconHtml) {
                statusIconHtml = `<div class="shift-day-status"><ion-icon name="${dayTypeIcons[dayType] || 'briefcase-outline'}"></ion-icon></div>`;
            }
        } else if (hasOnlyBonuses) {
            statusIconHtml = `<div class="shift-day-income" style="color: var(--ios-accent);"><ion-icon name="gift-outline"></ion-icon>${formatMoney(bonuses)}</div>`;
        } else {
            // Для нерабочих дней (прошедших и будущих) показываем иконку конкретного типа дня
            statusIconHtml = `<div class="shift-day-status"><ion-icon name="${dayTypeIcons[dayType] || 'remove-circle-outline'}"></ion-icon></div>`;
        }
        
        html += `
            <div class="${dayClass}" onclick="editShift('${dateStr}')" 
                style="border-color: ${dayColor}40; background: ${dayColor}20;">
                <div class="shift-day-number">${day}</div>
                ${statusIconHtml}
            </div>
        `;
    }
    html += `</div>`;
    
// ===== ИТОГИ МЕСЯЦА (ПРОФЕССИОНАЛЬНЫЙ ДИЗАЙН) =====
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

// 🔥 ПОДСЧЁТ ДНЕЙ ПО ТИПАМ
const dayTypeCounts = { work: 0, sick: 0, vacation: 0, dayoff: 0, repair: 0 };
shifts.forEach(s => {
    if (s.date.startsWith(datePrefix) && s.dayType) {
        if (dayTypeCounts[s.dayType] !== undefined) {
            dayTypeCounts[s.dayType]++;
        } else {
            dayTypeCounts.dayoff++;
        }
    }
});

const dayTypeConfig = {
    work:     { icon: 'briefcase-outline',   color: '#5AC8FA', label: 'Рабочие' },
    sick:     { icon: 'medical-outline',      color: '#8E8E93', label: 'Больничные' },
    vacation: { icon: 'airplane-outline',     color: '#34C759', label: 'Отпуск' },
    dayoff:   { icon: 'remove-circle-outline',color: '#8E8E93', label: 'Выходные' },
    repair:   { icon: 'construct-outline',    color: '#FF9500', label: 'Ремонт' }
};

function getDaysWord(count) {
    const lastTwo = count % 100;
    const lastOne = count % 10;
    if (lastTwo >= 11 && lastTwo <= 19) return 'дней';
    if (lastOne === 1) return 'день';
    if (lastOne >= 2 && lastOne <= 4) return 'дня';
    return 'дней';
}

if (!document.getElementById('shift-summary-styles')) {
    const style = document.createElement('style');
    style.id = 'shift-summary-styles';
    style.textContent = `
        /* 🔥 ОСНОВНЫЕ СТИЛИ - ПРОФЕССИОНАЛЬНЫЙ ДИЗАЙН */
        .month-summary-card {
            background: var(--ios-bg-secondary, #f2f2f7);
            border-radius: 16px;
            padding: 16px;
            margin-top: 16px;
            border: 1px solid var(--ios-border, rgba(0,0,0,0.08));
        }
        .summary-hero {
            text-align: center;
            padding: 16px 0;
            border-bottom: 1px solid var(--ios-border, rgba(0,0,0,0.08));
            margin-bottom: 16px;
        }
        .hero-label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--ios-text-secondary, #8e8e93);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 6px;
        }
        .hero-value {
            display: block;
            font-size: 32px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.5px;
            line-height: 1.2;
        }
        .hero-value.positive { color: var(--ios-success, #34c759); }
        .hero-value.negative { color: var(--ios-danger, #ff3b30); }
        
        /* СЕТКА ОСНОВНЫХ ПОКАЗАТЕЛЕЙ */
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 16px;
        }
        .grid-item {
            background: var(--ios-bg-primary, #ffffff);
            padding: 12px;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            border: 1px solid var(--ios-border, rgba(0,0,0,0.06));
            min-width: 0;
        }
        .grid-label {
            font-size: 12px;
            color: var(--ios-text-secondary, #8e8e93);
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 500;
        }
        .grid-label ion-icon {
            font-size: 16px;
            opacity: 0.9;
            flex-shrink: 0;
        }
        .grid-value {
            font-size: 17px;
            font-weight: 700;
            color: var(--ios-text-primary, #000000);
            font-variant-numeric: tabular-nums;
            line-height: 1.3;
            word-break: break-word;
        }
        .text-danger { color: var(--ios-danger, #ff3b30); }
        .text-accent { color: var(--ios-accent, #007aff); }
        
        /* 🔥 БЛОК "ДНИ ПО ТИПАМ" - КОМПАКТНЫЙ ДИЗАЙН */
        .day-types-section {
            background: var(--ios-bg-primary, #ffffff);
            border-radius: 12px;
            padding: 12px;
            margin-bottom: 16px;
            border: 1px solid var(--ios-border, rgba(0,0,0,0.06));
        }
        .day-types-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--ios-text-secondary, #8e8e93);
            margin: 0 0 10px 0;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .day-types-title ion-icon {
            font-size: 16px;
            flex-shrink: 0;
        }
        .day-types-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }
        .day-type-stat {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            background: var(--ios-bg-secondary, #f2f2f7);
            border-radius: 10px;
            transition: transform 0.15s ease;
            min-width: 0;
        }
        .day-type-stat:active {
            transform: scale(0.96);
        }
        .day-type-icon {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .day-type-icon ion-icon {
            font-size: 20px;
        }
        .day-type-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
        }
        .day-type-label {
            font-size: 11px;
            color: var(--ios-text-secondary, #8e8e93);
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .day-type-count {
            font-size: 15px;
            font-weight: 700;
            color: var(--ios-text-primary, #000000);
            font-variant-numeric: tabular-nums;
            line-height: 1.2;
        }
        
        /* НИЖНИЕ ПОКАЗАТЕЛИ */
        .summary-footer {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .footer-item {
            background: var(--ios-bg-primary, #ffffff);
            padding: 12px;
            border-radius: 12px;
            text-align: center;
            border: 1px solid var(--ios-border, rgba(0,0,0,0.06));
            min-width: 0;
        }
        .footer-label {
            display: block;
            font-size: 11px;
            color: var(--ios-text-secondary, #8e8e93);
            margin-bottom: 4px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        .footer-value {
            display: block;
            font-size: 16px;
            font-weight: 700;
            color: var(--ios-text-primary, #000000);
            font-variant-numeric: tabular-nums;
        }
        
        /* 🔥 АДАПТАЦИЯ ДЛЯ БОЛЬШИХ ЭКРАНОВ */
        @media (min-width: 768px) {
            .shift-day {
                min-height: 100px !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 8px !important;
            }
            .shift-day-number { font-size: 16px !important; font-weight: 700 !important; align-self: flex-start !important; }
            .shift-day-income, .shift-day-orders, .shift-day-status {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 4px !important;
                margin-top: 8px !important;
            }
            .shift-day-income ion-icon, .shift-day-orders ion-icon, .shift-day-status ion-icon {
                font-size: 40px !important;
            }
            .shift-day-income { font-size: 14px !important; font-weight: 600 !important; }
            .shift-day-orders { font-size: 13px !important; font-weight: 600 !important; }
            
            .summary-grid { gap: 12px; }
            .grid-item { padding: 14px; }
            .grid-label { font-size: 13px; }
            .grid-label ion-icon { font-size: 18px; }
            .grid-value { font-size: 18px; }
            
            .day-types-grid { gap: 10px; }
            .day-type-stat { padding: 10px 12px; }
            .day-type-icon { width: 40px; height: 40px; }
            .day-type-icon ion-icon { font-size: 22px; }
            .day-type-label { font-size: 12px; }
            .day-type-count { font-size: 16px; }
        }
        
        @media (min-width: 1024px) {
            .shift-day { min-height: 120px !important; }
            .shift-day-number { font-size: 18px !important; }
            .shift-day-income ion-icon, .shift-day-orders ion-icon, .shift-day-status ion-icon {
                font-size: 48px !important;
            }
            .shift-day-income { font-size: 16px !important; }
            .shift-day-orders { font-size: 14px !important; }
            
            .hero-value { font-size: 36px; }
            .grid-value { font-size: 19px; }
            .day-type-icon { width: 44px; height: 44px; }
            .day-type-icon ion-icon { font-size: 24px; }
            .day-type-count { font-size: 17px; }
        }
        
        @media (min-width: 1280px) {
            .shift-day { min-height: 140px !important; }
            .shift-day-income ion-icon, .shift-day-orders ion-icon, .shift-day-status ion-icon {
                font-size: 56px !important;
            }
        }
        
        /* 🔥 АДАПТАЦИЯ ДЛЯ МАЛЕНЬКИХ ЭКРАНОВ */
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
        
        @media (max-width: 340px) {
            .day-types-grid { grid-template-columns: 1fr 1fr; }
            .day-type-stat { padding: 5px 6px; }
            .day-type-icon { width: 28px; height: 28px; }
            .day-type-icon ion-icon { font-size: 16px; }
            .day-type-label { font-size: 9px; }
            .day-type-count { font-size: 13px; }
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
            <div class="grid-item">
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
            <h4 class="day-types-title">
                <ion-icon name="stats-chart-outline"></ion-icon>
                Дни по типам
            </h4>
            <div class="day-types-grid">
                ${Object.entries(dayTypeConfig).map(([type, config]) => {
                    const count = dayTypeCounts[type] || 0;
                    if (count === 0) return '';
                    return `
                        <div class="day-type-stat">
                            <div class="day-type-icon" style="background: ${config.color}20; border: 1px solid ${config.color}40;">
                                <ion-icon name="${config.icon}" style="color: ${config.color};"></ion-icon>
                            </div>
                            <div class="day-type-info">
                                <span class="day-type-label">${config.label}</span>
                                <span class="day-type-count">${count} ${getDaysWord(count)}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        
        <div class="summary-footer">
            <div class="footer-item">
                <span class="footer-label">За смену</span>
                <span class="footer-value">${formatMoney(avgIncome)}</span>
            </div>
            <div class="footer-item">
                <span class="footer-label">В час</span>
                <span class="footer-value">${formatMoney(avgHourlyRate)}</span>
            </div>
        </div>
    </div>
`;

container.innerHTML = html;
}

// ===== 13. ПЕРЕКЛЮЧЕНИЕ МЕСЯЦА =====
async function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; } 
    else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    
    console.log(`📅 Переключение на ${currentMonth + 1}/${currentYear}`);
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
    const hasShifts = shifts.some(s => s.date.startsWith(datePrefix));
    
    if (!hasShifts) {
        await generateShiftsBySettings();
    } else {
        updateShiftDataFromHistory();
    }
    await renderCalendar();
}

// ===== 14. ИНИЦИАЛИЗАЦИЯ И ЭКСПОРТ =====
function openShiftCalendar() {
    if (typeof window.switchTab === 'function') window.switchTab('shifts');
    setTimeout(() => renderCalendar(), 100);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('📅 DOM загружен, инициализация календаря v5.2...');
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

async function checkFirebaseConnection() {
    console.log('🔍 Проверка подключения к Firebase...');
    if (typeof auth === 'undefined' || typeof db === 'undefined' || !auth.currentUser) {
        console.error('❌ Firebase не инициализирован или нет пользователя');
        return false;
    }
    try {
        const snapshot = await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).limit(1).get();
        console.log('✅ Чтение из Firebase работает, документов:', snapshot.size);
        return true;
    } catch (error) {
        console.error('❌ Ошибка чтения из Firebase:', error);
        return false;
    }
}

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
window.toggleShiftFromModal = toggleShiftFromModal;
window.showScheduleSettingsModal = showScheduleSettingsModal;
window.generateShiftsBySettings = generateShiftsBySettings;
window.clearMonthShifts = clearMonthShifts;
window.openShiftCalendar = openShiftCalendar;
window.formatMoney = formatMoney;
window.checkFirebaseConnection = checkFirebaseConnection;
window.scheduleSettings = scheduleSettings;

console.log('✅ Модуль календаря смен v5.2 (Оптимизированный) загружен и проверен');