// ============================================
// МОДУЛЬ КАЛЕНДАРЯ СМЕН (ВЕРСИЯ 4.2 - 100% СИНХРОНИЗАЦИЯ)
// ============================================

const SHIFTS_STORAGE_KEY = 'driverShifts';
const SHIFTS_COLLECTION = 'shifts';
const SHIFT_START_DAY_PREFIX = 'shiftStartDay_';

// ===== 1. СОСТОЯНИЕ МОДУЛЯ =====
let shifts = [];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null;
let editingShiftId = null;
let isFirebaseSync = false;
let firebaseUnsubscribe = null;
let recordsUnsubscribe = null;

// ===== 1.1 ФУНКЦИИ ДЛЯ РАБОТЫ СО СТАРТОВЫМ ДНЕМ (С СИНХРОНИЗАЦИЕЙ) =====
function getStartDayKey(month, year) {
    return `${SHIFT_START_DAY_PREFIX}${year}_${String(month + 1).padStart(2, '0')}`;
}

async function loadShiftStartDay(month, year) {
    const key = getStartDayKey(month, year);
    
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            const doc = await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection('settings')
                .doc(key)
                .get();
            
            if (doc.exists) {
                const data = doc.data();
                const day = data.day || 1;
                console.log(`📅 Загружен стартовый день из Firebase для ${month + 1}.${year}: ${day}`);
                localStorage.setItem(key, String(day));
                return day;
            }
        } catch (error) {
            console.warn('⚠️ Не удалось загрузить стартовый день из Firebase:', error);
        }
    }
    
    const saved = localStorage.getItem(key);
    if (saved) {
        const day = parseInt(saved) || 1;
        console.log(`📅 Загружен стартовый день из localStorage для ${month + 1}.${year}: ${day}`);
        return day;
    }
    
    return null;
}

async function saveShiftStartDay(month, year, day) {
    const key = getStartDayKey(month, year);
    localStorage.setItem(key, String(day));
    
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection('settings')
                .doc(key)
                .set({
                    day: day,
                    month: month,
                    year: year,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            console.log(`📅 Стартовый день ${day} сохранен в Firebase для ${month + 1}.${year}`);
        } catch (error) {
            console.error('❌ Ошибка сохранения стартового дня в Firebase:', error);
        }
    }
}

async function getCurrentStartDay() {
    const saved = await loadShiftStartDay(currentMonth, currentYear);
    if (saved !== null) return saved;
    
    const today = new Date();
    const isCurrentMonth = (today.getMonth() === currentMonth && today.getFullYear() === currentYear);
    return isCurrentMonth ? today.getDate() : 1;
}

// ===== 2. КОНСТАНТЫ И УТИЛИТЫ =====
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 22;
const WORK_END_HOUR_LATE = 23;

function normalizeDate(dateInput) {
    if (!dateInput) return '';
    if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) return dateInput;
    if (typeof dateInput === 'string' && dateInput.includes('.')) {
        const parts = dateInput.split('.');
        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    if (dateInput && typeof dateInput.toDate === 'function') {
        return dateInput.toDate().toISOString().split('T')[0];
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

// ===== 3. ИНИЦИАЛИЗАЦИЯ =====
async function loadShifts() {
    console.log('📅 Загрузка календаря смен...');
    try {
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
                        renderCalendar(); // Рендер внутри onSnapshot может быть синхронным, так как данные уже в shifts
                        if (typeof updateTotals === 'function') updateTotals();
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
            console.log(`📅 Загружено и обработано ${shifts.length} смен из Firebase`);
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки из Firebase:', error);
    }
}

function mergeFirebaseWithHistory(firebaseShifts) {
    const histRecords = getHistoryRecords();
    
    firebaseShifts.forEach(shift => {
        const dateStr = shift.date;
        const incomeFromHistory = getIncomeFromHistory(dateStr);
        const ordersFromHistory = getOrdersFromHistory(dateStr);
        const hoursFromHistory = getHoursFromHistory(dateStr);
        const expensesFromHistory = getExpensesFromHistory(dateStr);
        const bonusesFromHistory = getBonusesFromHistory(dateStr);
        
        if (incomeFromHistory > 0 && (!shift.income || shift.income === 0)) shift.income = incomeFromHistory;
        if (ordersFromHistory > 0 && (!shift.orders || shift.orders === 0)) shift.orders = ordersFromHistory;
        if (hoursFromHistory > 0 && (!shift.hours || shift.hours === 0)) shift.hours = hoursFromHistory;
        if (expensesFromHistory > 0 && (!shift.expenses || shift.expenses === 0)) shift.expenses = expensesFromHistory;
        if (bonusesFromHistory > 0 && (!shift.bonuses || shift.bonuses === 0)) shift.bonuses = bonusesFromHistory;
    });
    
    shifts = firebaseShifts;
    console.log(`✅ Данные синхронизированы: ${shifts.length} смен`);
}

// ===== 4. СОХРАНЕНИЕ =====
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
        const batch = db.batch();
        for (const shift of shiftsArray) {
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
        
        console.log('📡 Отправка batch.commit() в Firestore...');
        await batch.commit();
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

// ===== 5. ФУНКЦИИ ДЛЯ РАБОТЫ С ИСТОРИЕЙ =====
function getHistoryRecords() {
    const r = (typeof window.records !== 'undefined') ? window.records : (typeof records !== 'undefined' ? records : []);
    return Array.isArray(r) ? r : [];
}

function getIncomeFromHistory(dateStr) {
    const histRecords = getHistoryRecords();
    const targetDate = normalizeDate(dateStr);
    const dayRecords = histRecords.filter(r => normalizeDate(r.date) === targetDate);
    if (dayRecords.length === 0) return 0;
    
    let totalIncome = 0;
    dayRecords.forEach(r => {
        const totalInc = Number(r.totalIncome) || Number(r.income) || 0;
        if (totalInc > 0) totalIncome += totalInc;
        else totalIncome += (Number(r.payDelivery) || 0) + (Number(r.payPickup) || 0) + (Number(r.payWeight) || 0) + (Number(r.payDistance) || 0) + (Number(r.tips) || 0) + (Number(r.bonusPay) || 0);
    });
    return totalIncome;
}

function getOrdersFromHistory(dateStr) {
    const histRecords = getHistoryRecords();
    const targetDate = normalizeDate(dateStr);
    const dayRecords = histRecords.filter(r => normalizeDate(r.date) === targetDate);
    return dayRecords.reduce((sum, r) => sum + (Number(r.ordersDelivery) || 0), 0);
}

function getHoursFromHistory(dateStr) {
    const histRecords = getHistoryRecords();
    const targetDate = normalizeDate(dateStr);
    const dayRecords = histRecords.filter(r => normalizeDate(r.date) === targetDate);
    return dayRecords.reduce((sum, r) => sum + (Number(r.hours) || Number(r.duration) || 0), 0);
}

function getExpensesFromHistory(dateStr) {
    const histRecords = getHistoryRecords();
    const targetDate = normalizeDate(dateStr);
    const dayRecords = histRecords.filter(r => normalizeDate(r.date) === targetDate);
    if (dayRecords.length === 0) return 0;
    
    let totalExpenses = 0;
    dayRecords.forEach(r => {
        if (r.totalExpenses !== undefined && r.totalExpenses !== null && r.totalExpenses > 0) totalExpenses += Number(r.totalExpenses);
        else totalExpenses += (Number(r.fuelCost) || 0) + (Number(r.repairCost) || 0) + (Number(r.tax) || 0);
    });
    return totalExpenses;
}

function getBonusesFromHistory(dateStr) {
    const histRecords = getHistoryRecords();
    const targetDate = normalizeDate(dateStr);
    const dayRecords = histRecords.filter(r => normalizeDate(r.date) === targetDate);
    if (dayRecords.length === 0) return 0;
    
    let totalBonuses = 0;
    dayRecords.forEach(r => {
        totalBonuses += Number(r.bonusPay) || 0;
        if (r.isBonus === true || r.type === 'bonus') totalBonuses += Number(r.totalIncome) || Number(r.income) || 0;
    });
    return totalBonuses;
}

function updateShiftDataFromHistory() {
    const histRecords = getHistoryRecords();
    if (histRecords.length === 0) return;

    let hasChanges = false;
    shifts.forEach(shift => {
        const targetDate = normalizeDate(shift.date);
        const dayRecords = histRecords.filter(r => normalizeDate(r.date) === targetDate);
        if (dayRecords.length === 0) return;
        
        const newIncome = getIncomeFromHistory(shift.date);
        const newOrders = getOrdersFromHistory(shift.date);
        const historyHours = getHoursFromHistory(shift.date);
        const newExpenses = getExpensesFromHistory(shift.date);
        const newBonuses = getBonusesFromHistory(shift.date);
        
        if (newIncome > 0 && shift.income !== newIncome) { shift.income = newIncome; hasChanges = true; }
        if (newOrders > 0 && shift.orders !== newOrders) { shift.orders = newOrders; hasChanges = true; }
        if (newBonuses > 0 && shift.bonuses !== newBonuses) { shift.bonuses = newBonuses; hasChanges = true; }
        if (historyHours > 0 && shift.hours !== historyHours) { shift.hours = historyHours; hasChanges = true; }
        if (newExpenses > 0 && shift.expenses !== newExpenses) { shift.expenses = newExpenses; hasChanges = true; }
    });

    if (hasChanges) {
        saveShiftsLocal();
        console.log('🔄 Обновлены данные смен из истории');
    }
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
            if (typeof updateTotals === 'function') updateTotals();
        }, (error) => console.error('❌ Ошибка слушателя истории:', error));
}

// ===== 6. ЛОГИКА ГРАФИКА =====
function isWorkingDayBySchedule(day, startDay) {
    const safeStartDay = startDay || 1;
    const offset = (day - safeStartDay + 42) % 42;
    const pattern = [1, 1, 1, 0, 0, 0];
    return pattern[offset % pattern.length] === 1;
}

// ===== 7. ОЧИСТКА ГРАФИКА =====
async function clearMonthShifts() {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const datePrefix = `${currentYear}-${monthStr}`;
    
    if (!confirm(`🗑️ Удалить все смены за ${monthStr}.${currentYear}?`)) return;
    
    const toRemove = shifts.filter(s => s.date.startsWith(datePrefix));
    if (toRemove.length === 0) {
        if (typeof showToast === 'function') showToast('ℹ️ Нет смен для удаления');
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
    
    const key = getStartDayKey(currentMonth, currentYear);
    localStorage.removeItem(key);
    
    await renderCalendar();
    if (typeof showToast === 'function') showToast(`✅ Удалено ${toRemove.length} смен`);
}

// ===== 8. ГЕНЕРАЦИЯ ГРАФИКА 3/3 =====
async function generateDefaultShifts(useLateEnd = false) {
    const endHour = useLateEnd ? WORK_END_HOUR_LATE : WORK_END_HOUR;
    console.log(`🔄 Генерация графика 3/3 (конец смены: ${endHour})...`);
    
    const startDay = await showStartDayPicker();
    if (startDay === null) {
        console.log('⚠️ Генерация отменена пользователем');
        return;
    }
    
    console.log(`✅ Выбран стартовый день: ${startDay}`);
    await saveShiftStartDay(currentMonth, currentYear, startDay);
    
    const monthStr = String(currentMonth + 1).padStart(2, '0');
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
    
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date().toISOString().split('T')[0];
    const newMonthShifts = [];
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${monthStr}-${String(day).padStart(2, '0')}`;
        const isWorking = isWorkingDayBySchedule(day, startDay); // startDay здесь гарантированно число!
        const income = getIncomeFromHistory(dateStr);
        const orders = getOrdersFromHistory(dateStr);
        const isPast = dateStr < today;
        
        let finalIsWorking = isWorking;
        if (isPast) finalIsWorking = orders > 0;
        
        newMonthShifts.push({
            id: 'shift_' + dateStr,
            date: dateStr,
            isWorking: finalIsWorking,
            startTime: finalIsWorking ? `${WORK_START_HOUR}:00` : null,
            endTime: finalIsWorking ? `${endHour}:00` : null,
            income: income,
            orders: orders,
            hours: finalIsWorking ? (endHour - WORK_START_HOUR) : 0,
            expenses: getExpensesFromHistory(dateStr),
            bonuses: getBonusesFromHistory(dateStr),
            notes: '',
            manualOverride: false,
            updatedAt: new Date().toISOString()
        });
    }
    
    console.log(`📤 Сохранение ${newMonthShifts.length} смен в Firebase...`);
    const saved = await saveShiftsBatchToFirebase(newMonthShifts);
    
    if (saved) {
        console.log('✅ График создан успешно');
        if (typeof showToast === 'function') showToast(`✅ График создан (старт с ${startDay}-го числа)`);
    } else {
        console.error('❌ Ошибка сохранения графика');
        if (typeof showToast === 'function') showToast('❌ Ошибка сохранения графика');
    }
}

// ===== 9. ДИАЛОГ ВЫБОРА СТАРТОВОГО ДНЯ =====
async function showStartDayPicker() {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const currentStartDay = await getCurrentStartDay(); // 🔥 ИСПРАВЛЕНИЕ: добавлен await
    
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'shift-modal-overlay';
        overlay.innerHTML = `
            <div class="shift-modal" style="max-width: 320px;">
                <div class="shift-modal-header">
                    <ion-icon name="calendar-number-outline"></ion-icon>
                    <h3>Начало графика 3/3</h3>
                </div>
                <div class="shift-modal-body" style="padding: 16px;">
                    <p style="font-size: 14px; color: var(--ios-text-secondary); margin-bottom: 16px; text-align: center;">
                        Выберите день начала цикла для ${currentMonth + 1}.${currentYear}<br>
                        <strong>3 рабочих → 3 выходных</strong>
                    </p>
                    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 16px;">
                        ${Array.from({length: daysInMonth}, (_, i) => i + 1).map(day => `
                            <button class="start-day-btn ${day === currentStartDay ? 'selected' : ''}" data-day="${day}"
                                style="padding: 8px 0; border: 2px solid ${day === currentStartDay ? 'var(--ios-accent)' : 'var(--ios-border)'};
                                border-radius: 8px; background: ${day === currentStartDay ? 'var(--ios-accent-light)' : 'transparent'};
                                color: var(--ios-text-primary); font-size: 14px; font-weight: ${day === currentStartDay ? '700' : '500'};
                                cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.background='var(--ios-accent-light)'"
                                onmouseout="this.style.background='${day === currentStartDay ? 'var(--ios-accent-light)' : 'transparent'}'">
                                ${day}
                            </button>
                        `).join('')}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" style="flex: 1;" onclick="this.closest('.shift-modal-overlay').remove(); window._startDayResolve(null)">Отмена</button>
                        <button class="btn btn-primary" style="flex: 1;" onclick="
                            const selected = document.querySelector('.start-day-btn.selected');
                            const day = selected ? parseInt(selected.dataset.day) : ${currentStartDay};
                            this.closest('.shift-modal-overlay').remove();
                            window._startDayResolve(day);
                        "><ion-icon name="checkmark-outline"></ion-icon> Применить</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
        window._startDayResolve = resolve;
        
        overlay.querySelectorAll('.start-day-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                overlay.querySelectorAll('.start-day-btn').forEach(b => {
                    b.classList.remove('selected');
                    b.style.background = 'transparent';
                    b.style.borderColor = 'var(--ios-border)';
                    b.style.fontWeight = '500';
                });
                this.classList.add('selected');
                this.style.background = 'var(--ios-accent-light)';
                this.style.borderColor = 'var(--ios-accent)';
                this.style.fontWeight = '700';
            });
        });
    });
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
    const orders = getOrdersFromHistory(dateStr);
    const income = getIncomeFromHistory(dateStr);
    const today = new Date().toISOString().split('T')[0];
    const isPast = dateStr < today;
    
    let isWorking = shiftData.isWorking;
    if (isPast && !shiftData.manualOverride) isWorking = orders > 0;
    
    let shift = {
        id: existingIndex !== -1 ? shifts[existingIndex].id : 'shift_' + dateStr,
        date: dateStr,
        isWorking: isWorking,
        startTime: isWorking ? `${WORK_START_HOUR}:00` : null,
        endTime: isWorking ? `${WORK_END_HOUR}:00` : null,
        income: income,
        orders: orders,
        hours: isWorking ? (WORK_END_HOUR - WORK_START_HOUR) : 0,
        expenses: getExpensesFromHistory(dateStr),
        bonuses: getBonusesFromHistory(dateStr),
        notes: shiftData.notes || '',
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
    const income = shift ? (Number(shift.income) || 0) : getIncomeFromHistory(dateStr);
    const orders = shift ? (Number(shift.orders) || 0) : getOrdersFromHistory(dateStr);
    const hours = shift ? (Number(shift.hours) || 0) : getHoursFromHistory(dateStr);
    const expenses = shift ? (Number(shift.expenses) || 0) : getExpensesFromHistory(dateStr);
    const bonuses = shift ? (Number(shift.bonuses) || 0) : getBonusesFromHistory(dateStr);
    const netIncome = income + bonuses - expenses;
    
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
                <div class="shift-modal-toggle">
                    <label class="toggle-switch">
                        <input type="checkbox" ${isWorking ? 'checked' : ''} onchange="toggleShiftFromModal('${dateStr}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label">${isWorking ? '🟢 Рабочий день' : '🔴 Выходной'}</span>
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
    
    const shift = shifts.find(s => s.date === dateStr);
    if (shift) {
        shift.notes = notesInput.value;
        shift.expenses = expensesInput ? Number(expensesInput.value) || 0 : 0;
        shift.bonuses = bonusesInput ? Number(bonusesInput.value) || 0 : 0;
        shift.manualOverride = true;
        shift.updatedAt = new Date().toISOString();
        
        saveShiftsLocal();
        await saveShiftToFirebase(shift);
        if (typeof showToast === 'function') showToast('✅ Данные смены сохранены');
        const overlay = document.querySelector('.shift-modal-overlay');
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
    const histRecords = getHistoryRecords();
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const today = new Date().toISOString().split('T')[0];
    
    const startDay = await getCurrentStartDay(); // 🔥 ИСПРАВЛЕНИЕ: добавлен await
    
    let html = `
        <div class="shift-calendar-header">
            <button class="shift-nav-btn" onclick="changeMonth(-1)"><ion-icon name="chevron-back-outline"></ion-icon></button>
            <h2>${monthNames[currentMonth]} ${currentYear}</h2>
            <button class="shift-nav-btn" onclick="changeMonth(1)"><ion-icon name="chevron-forward-outline"></ion-icon></button>
        </div>
        <div class="shift-calendar-actions">
            <button class="btn btn-small btn-secondary" onclick="generateDefaultShifts(false)"><ion-icon name="calendar-number-outline"></ion-icon> 3/3 9-22</button>
            <button class="btn btn-small btn-secondary" onclick="generateDefaultShifts(true)"><ion-icon name="time-outline"></ion-icon> 3/3 9-23</button>
            <button class="btn btn-small btn-danger" onclick="clearMonthShifts()"><ion-icon name="trash-outline"></ion-icon> Очистить</button>
            <span class="shift-start-info"><ion-icon name="play-outline"></ion-icon> Старт: ${startDay}-е число</span>
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
        
        const income = getIncomeFromHistory(dateStr);
        const orders = getOrdersFromHistory(dateStr);
        const bonuses = getBonusesFromHistory(dateStr);
        
        const isPast = dateStr < today;
        const isToday = dateStr === today;
        const isFuture = dateStr > today;
        
        let isWorking = false;
        if (shift && shift.manualOverride) {
            isWorking = shift.isWorking;
        } else if (isPast) {
            isWorking = orders > 0;
        } else {
            isWorking = isWorkingDayBySchedule(day, startDay); // startDay здесь гарантированно число!
        }
        
        let dayClass = 'shift-day';
        if (isToday) dayClass += ' today';
        if (isWorking) dayClass += ' working';
        else if (!isWorking && !isFuture) dayClass += ' day-off';
        else if (!isWorking && isFuture) dayClass += ' future-day-off';
        
        const incomeStr = income >= 1000 ? (income / 1000).toFixed(1) + 'k' : Math.round(income).toString();
        const hasOnlyBonuses = bonuses > 0 && orders === 0;
        
        html += `
            <div class="${dayClass}" onclick="editShift('${dateStr}')">
                <div class="shift-day-number">${day}</div>
                ${isWorking ? `
                    ${income > 0 ? `<div class="shift-day-income"><ion-icon name="cash-outline"></ion-icon>${incomeStr}</div>` : ''}
                    ${orders > 0 ? `<div class="shift-day-orders"><ion-icon name="cube-outline"></ion-icon>${orders}</div>` : ''}
                ` : hasOnlyBonuses ? `
                    <div class="shift-day-income" style="color: var(--ios-accent);"><ion-icon name="gift-outline"></ion-icon>${formatMoney(bonuses)}</div>
                ` : !isWorking && isFuture ? `
                    <div class="shift-day-status"><ion-icon name="calendar-outline"></ion-icon></div>
                ` : !isWorking && !isFuture ? `
                    <div class="shift-day-status"><ion-icon name="close-circle-outline"></ion-icon></div>
                ` : ''}
            </div>
        `;
    }
    html += `</div>`;
    
// ===== ИТОГИ МЕСЯЦА (КОМПАКТНЫЙ ДИЗАЙН) =====
const monthRecords = histRecords.filter(r => normalizeDate(r.date).startsWith(`${currentYear}-${monthStr}`));

const totalIncome = monthRecords.reduce((sum, r) => {
    const totalInc = Number(r.totalIncome) || Number(r.income) || 0;
    if (totalInc > 0) return sum + totalInc;
    return sum + (Number(r.payDelivery) || 0) + (Number(r.payPickup) || 0) + (Number(r.payWeight) || 0) + (Number(r.payDistance) || 0) + (Number(r.tips) || 0) + (Number(r.bonusPay) || 0);
}, 0);

const totalBonuses = monthRecords.reduce((sum, r) => sum + (Number(r.bonusPay) || 0), 0);
const totalExpenses = monthRecords.reduce((sum, r) => {
    if (r.totalExpenses !== undefined && r.totalExpenses !== null && r.totalExpenses > 0) return sum + Number(r.totalExpenses);
    return sum + (Number(r.fuelCost) || 0) + (Number(r.repairCost) || 0) + (Number(r.tax) || 0);
}, 0);

const totalOrders = monthRecords.reduce((sum, r) => sum + (Number(r.ordersDelivery) || 0), 0);
const totalHours = monthRecords.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
const workingDays = shifts.filter(s => s.date.startsWith(`${currentYear}-${monthStr}`) && s.isWorking).length;

const netIncome = totalIncome - totalExpenses;
const avgIncome = workingDays > 0 ? totalIncome / workingDays : 0;
const avgHourlyRate = totalHours > 0 ? netIncome / totalHours : 0;

// Стили для компактного отображения
if (!document.getElementById('shift-summary-styles')) {
    const style = document.createElement('style');
    style.id = 'shift-summary-styles';
    style.textContent = `
            .month-summary-card {
                background: var(--ios-bg-secondary, #f2f2f7);
                border-radius: 12px;
                padding: 12px;
                margin-top: 16px;
            }
            .summary-hero {
                text-align: center;
                padding: 12px 0;
                border-bottom: 1px solid var(--ios-border, rgba(0,0,0,0.08));
                margin-bottom: 12px;
            }
            .hero-label {
                display: block;
                font-size: 11px;
                font-weight: 600;
                color: var(--ios-text-secondary, #8e8e93);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
            }
            .hero-value {
                display: block;
                font-size: 28px;
                font-weight: 700;
                font-variant-numeric: tabular-nums;
                letter-spacing: -0.5px;
                line-height: 1;
            }
            .hero-value.positive { color: var(--ios-success, #34c759); }
            .hero-value.negative { color: var(--ios-danger, #ff3b30); }

            .summary-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
                margin-bottom: 12px;
            }
            .grid-item {
                background: var(--ios-bg-primary, #ffffff);
                padding: 10px;
                border-radius: 10px;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .grid-label {
                font-size: 11px;
                color: var(--ios-text-secondary, #8e8e93);
                display: flex;
                align-items: center;
                gap: 4px;
                font-weight: 500;
            }
            .grid-label ion-icon { font-size: 14px; opacity: 0.8; }
            .grid-value {
                font-size: 16px;
                font-weight: 600;
                color: var(--ios-text-primary, #000000);
                font-variant-numeric: tabular-nums;
                line-height: 1.2;
            }
            .text-danger { color: var(--ios-danger, #ff3b30); }
            .text-accent { color: var(--ios-accent, #007aff); }

            .summary-footer {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .footer-item {
                background: var(--ios-bg-primary, #ffffff);
                padding: 10px;
                border-radius: 10px;
                text-align: center;
            }
            .footer-label {
                font-size: 10px;
                color: var(--ios-text-secondary, #8e8e93);
                margin-bottom: 3px;
                font-weight: 500;
                line-height: 1.2;
            }
            .footer-value {
                font-size: 15px;
                font-weight: 600;
                color: var(--ios-text-primary, #000000);
                font-variant-numeric: tabular-nums;
            }
            
            /* Адаптация для очень маленьких экранов */
            @media (max-width: 360px) {
                .hero-value { font-size: 24px; }
                .grid-value { font-size: 14px; }
                .footer-value { font-size: 14px; }
                .grid-item { padding: 8px; }
            }
        `;
    document.head.appendChild(style);
}

const netIncomeClass = netIncome >= 0 ? 'positive' : 'negative';

html += `
        <div class="month-summary-card">
            <!-- Главный показатель -->
            <div class="summary-hero">
                <span class="hero-label">ЧИСТЫЙ ДОХОД ЗА МЕСЯЦ</span>
                <span class="hero-value ${netIncomeClass}">${formatMoney(netIncome)}</span>
            </div>
            
            <!-- Сетка деталей -->
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
            
            <!-- Подвал со средними значениями -->
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
        await autoGenerateShifts();
    } else {
        updateShiftDataFromHistory();
    }
    await renderCalendar();
}

// ===== 14. АВТОГЕНЕРАЦИЯ СМЕН =====
async function autoGenerateShifts(forceRegenerate = false) {
    const monthStr = String(currentMonth + 1).padStart(2, '0');
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date().toISOString().split('T')[0];
    const endHour = WORK_END_HOUR;
    
    console.log(`🔄 Автогенерация смен для ${monthStr}.${currentYear}...`);
    
    let startDay = await loadShiftStartDay(currentMonth, currentYear); // 🔥 ИСПРАВЛЕНИЕ: добавлен await
    if (startDay === null) {
        const todayDate = new Date();
        const isCurrentMonth = (todayDate.getMonth() === currentMonth && todayDate.getFullYear() === currentYear);
        startDay = isCurrentMonth ? todayDate.getDate() : 1;
        await saveShiftStartDay(currentMonth, currentYear, startDay);
    }
    
    console.log(`✅ Используем стартовый день: ${startDay}`);
    const datePrefix = `${currentYear}-${monthStr}`;
    const existingShifts = shifts.filter(s => s.date.startsWith(datePrefix));
    
    if (existingShifts.length > 0 && !forceRegenerate) {
        console.log(`📅 Смены за ${monthStr}.${currentYear} уже существуют (${existingShifts.length})`);
        return;
    }
    
    if (existingShifts.length > 0 && typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        try {
            console.log(`🗑️ Удаление ${existingShifts.length} старых смен из Firebase...`);
            const batch = db.batch();
            for (const shift of existingShifts) {
                const ref = db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(shift.id);
                batch.delete(ref);
            }
            await batch.commit();
            console.log(`✅ Старые смены удалены из Firebase`);
        } catch (error) {
            console.error('❌ Ошибка удаления старых смен:', error);
        }
    }
    
    shifts = shifts.filter(s => !s.date.startsWith(datePrefix));
    const newShifts = [];
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${monthStr}-${String(day).padStart(2, '0')}`;
        const isWorking = isWorkingDayBySchedule(day, startDay); // startDay здесь гарантированно число!
        const income = getIncomeFromHistory(dateStr);
        const orders = getOrdersFromHistory(dateStr);
        const isPast = dateStr < today;
        
        let finalIsWorking = isWorking;
        if (isPast) finalIsWorking = orders > 0;
        
        newShifts.push({
            id: 'shift_' + dateStr,
            date: dateStr,
            isWorking: finalIsWorking,
            startTime: finalIsWorking ? `${WORK_START_HOUR}:00` : null,
            endTime: finalIsWorking ? `${endHour}:00` : null,
            income: income,
            orders: orders,
            hours: finalIsWorking ? (endHour - WORK_START_HOUR) : 0,
            expenses: getExpensesFromHistory(dateStr),
            bonuses: getBonusesFromHistory(dateStr),
            notes: '',
            manualOverride: false,
            updatedAt: new Date().toISOString()
        });
    }
    
    console.log(`📤 Попытка сохранения ${newShifts.length} смен в Firebase...`);
    const success = await saveShiftsBatchToFirebase(newShifts);
    
    if (success) {
        console.log(`✅ Автогенерация завершена успешно!`);
        if (typeof showToast === 'function') showToast('✅ График создан и сохранен в облако');
    } else {
        console.error('❌ АВТОГЕНЕРАЦИЯ ПРОВАЛИЛАСЬ ПРИ СОХРАНЕНИИ');
    }
}

// ===== 15. ИНИЦИАЛИЗАЦИЯ И ЭКСПОРТ =====
function openShiftCalendar() {
    if (typeof switchTab === 'function') switchTab('shifts');
    setTimeout(() => renderCalendar(), 100);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('📅 DOM загружен, инициализация календаря v4.2...');
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

async function testFirebaseSave() {
    console.log('🧪 Запуск тестового сохранения в Firebase...');
    if (!auth || !auth.currentUser || !db) return;
    const testId = 'test_shift_' + Date.now();
    try {
        await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(testId).set({ date: '2026-08-30', testFlag: true }, { merge: true });
        console.log('🎉 УСПЕХ! Тестовый документ записан в Firebase!');
        await db.collection('users').doc(auth.currentUser.uid).collection(SHIFTS_COLLECTION).doc(testId).delete();
        console.log('🧹 Тестовый документ удален.');
        if (typeof showToast === 'function') showToast('✅ Тестовая запись в Firebase успешна!');
    } catch (error) {
        console.error('❌ ПРОВАЛ ТЕСТА:', error);
    }
}

window.forceSyncHistoryToCalendar = function() {
    updateShiftDataFromHistory();
    renderCalendar();
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof showToast === 'function') showToast('✅ Данные синхронизированы');
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
window.generateDefaultShifts = generateDefaultShifts;
window.clearMonthShifts = clearMonthShifts;
window.openShiftCalendar = openShiftCalendar;
window.formatMoney = formatMoney;
window.loadShiftsFromFirebase = loadShiftsFromFirebase;
window.checkFirebaseConnection = checkFirebaseConnection;
window.testFirebaseSave = testFirebaseSave;

console.log('✅ Модуль календаря смен v4.2 загружен и проверен');