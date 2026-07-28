// ============================================
// МОДУЛЬ УЧЕТА ТОПЛИВА (fuel-module.js)
// ============================================
// 
// ⚠️ ЗАВИСИМОСТИ (должны быть определены в основном script.js):
// - currentUser, db (объекты Firebase)
// - records (массив основных записей)
// - parseLocalDate(), formatMoney(), calcIncome(), calcExpenses()
// - saveData(), renderTable(), updateAnalytics(), showToast()
// ============================================

// Локальное состояние модуля
let fuelLogs = [];
let editingFuelId = null;
let fuelChartInstance = null;
const FUEL_STORAGE_KEY = 'driverFuelLogs';

// 1. РАСЧЕТ РАСХОДА
function calculateFuelConsumption(logs) {
    const sorted = [...logs].sort((a, b) => (a.mileage || 0) - (b.mileage || 0));
    sorted.forEach((log, index) => {
        if (index === 0) { 
            log.consumption = null; 
            log.costPerKm = null; 
        } else {
            const diff = log.mileage - sorted[index - 1].mileage;
            if (diff > 0) { 
                log.consumption = (log.liters / diff) * 100; 
                log.costPerKm = log.amount / diff; 
            } else { 
                log.consumption = null; 
                log.costPerKm = null; 
            }
        }
        log.pricePerLiter = log.liters > 0 ? log.amount / log.liters : 0;
    });
    return sorted;
}

// 2. ЗАГРУЗКА ДАННЫХ
async function loadFuelLogs() {
    try {
        const saved = localStorage.getItem(FUEL_STORAGE_KEY);
        if (saved) fuelLogs = JSON.parse(saved);
        
        if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
            const snapshot = await db.collection('users')
                .doc(currentUser.uid)
                .collection('fuelLogs')
                .orderBy('date', 'desc')
                .get();
            
            if (!snapshot.empty) {
                fuelLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
                console.log('✅ Топливо загружено из Firebase:', fuelLogs.length);
            }
        }
        
        if (typeof renderFuelLogs === 'function') renderFuelLogs();
        if (typeof updateFuelStats === 'function') updateFuelStats();
        if (typeof updateFuelChart === 'function') updateFuelChart();
        
        // Автоматическая синхронизация с историей при загрузке
        if (typeof syncFuelToRecords === 'function') {
            await syncFuelToRecords();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки топлива:', error);
    }
}

// 3. СОХРАНЕНИЕ В FIREBASE
async function saveFuelLogToFirebase(log) {
    if (typeof currentUser === 'undefined' || !currentUser || typeof db === 'undefined') return false;
    try {
        const logToSave = { ...log };
        delete logToSave.id;
        await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(log.id).set(logToSave);
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения в Firebase:', error);
        return false;
    }
}

// 4. ОБРАБОТЧИК ФОРМЫ (ДОБАВЛЕНИЕ И РЕДАКТИРОВАНИЕ)
async function handleFuelSubmit(e) {
    e.preventDefault();
    
    const date = document.getElementById('fuel-date')?.value;
    const mileage = parseFloat(document.getElementById('fuel-mileage')?.value);
    const liters = parseFloat(document.getElementById('fuel-liters')?.value);
    const amount = parseFloat(document.getElementById('fuel-amount')?.value);
    const comment = document.getElementById('fuel-comment')?.value || '';
    
    if (!date || !mileage || !liters || !amount) {
        alert('❌ Заполните все обязательные поля');
        return;
    }

    const isEditing = !!editingFuelId;
    
    if (isEditing) {
        const index = fuelLogs.findIndex(l => l.id === editingFuelId);
        if (index !== -1) {
            fuelLogs[index] = { ...fuelLogs[index], date, mileage, liters, amount, comment, updatedAt: new Date().toISOString() };
            
            if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
                try {
                    const logToSave = { ...fuelLogs[index] };
                    delete logToSave.id;
                    await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(editingFuelId).set(logToSave);
                } catch (error) {
                    console.error('❌ Ошибка обновления в Firebase:', error);
                }
            }
        }
    } else {
        const newLog = { id: Date.now().toString(), date, mileage, liters, amount, comment, createdAt: new Date().toISOString() };
        fuelLogs.push(newLog);
        await saveFuelLogToFirebase(newLog);
    }
    
    localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
    calculateFuelConsumption(fuelLogs);
    
    if (typeof renderFuelLogs === 'function') renderFuelLogs();
    if (typeof updateFuelStats === 'function') updateFuelStats();
    if (typeof updateFuelChart === 'function') updateFuelChart();
    clearFuelForm();
    
    if (typeof syncFuelToRecords === 'function') {
        await syncFuelToRecords();
    }
    
    if (typeof showToast === 'function') {
        showToast(isEditing ? '✅ Заправка обновлена и синхронизирована!' : '✅ Заправка добавлена и синхронизирована!');
    } else {
        alert(isEditing ? 'Заправка обновлена!' : 'Заправка добавлена!');
    }
}

// 5. РЕДАКТИРОВАНИЕ
function editFuelLog(id) {
    const log = fuelLogs.find(l => l.id === id);
    if (!log) return;

    editingFuelId = id;
    const dateEl = document.getElementById('fuel-date');
    const mileageEl = document.getElementById('fuel-mileage');
    const litersEl = document.getElementById('fuel-liters');
    const amountEl = document.getElementById('fuel-amount');
    const commentEl = document.getElementById('fuel-comment');

    if (dateEl) dateEl.value = log.date;
    if (mileageEl) mileageEl.value = log.mileage;
    if (litersEl) litersEl.value = log.liters;
    if (amountEl) amountEl.value = log.amount;
    if (commentEl) commentEl.value = log.comment || '';

    const submitBtn = document.querySelector('#fuel-form button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Обновить заправку';
        submitBtn.classList.remove('btn-success');
        submitBtn.classList.add('btn-primary');
    }
    
    const form = document.getElementById('fuel-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    if (typeof showToast === 'function') showToast('✏️ Редактирование заправки');
}

// 6. УДАЛЕНИЕ
async function deleteFuelLog(id) {
    if (!confirm('Удалить эту заправку?')) return;
    
    fuelLogs = fuelLogs.filter(l => l.id !== id);
    localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
    
    if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
        await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(id).delete().catch(console.error);
    }
    
    if (typeof renderFuelLogs === 'function') renderFuelLogs();
    if (typeof updateFuelStats === 'function') updateFuelStats();
    if (typeof updateFuelChart === 'function') updateFuelChart();
    
    if (typeof syncFuelToRecords === 'function') {
        await syncFuelToRecords();
    }
    
    if (typeof showToast === 'function') showToast('🗑️ Заправка удалена, история обновлена');
}

// 7. ОЧИСТКА ФОРМЫ
function clearFuelForm() {
    const form = document.getElementById('fuel-form');
    if (form) form.reset();
    
    const dateEl = document.getElementById('fuel-date');
    if (dateEl) dateEl.valueAsDate = new Date();
    
    const priceEl = document.getElementById('fuel-price');
    if (priceEl) priceEl.value = '';
    
    const consEl = document.getElementById('fuel-consumption');
    if (consEl) consEl.value = '';
    
    editingFuelId = null;
    const submitBtn = document.querySelector('#fuel-form button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить заправку';
        submitBtn.classList.remove('btn-primary');
        submitBtn.classList.add('btn-success');
    }
}

// 8. АВТОРАСЧЕТ В ФОРМЕ
function updateFuelFormCalculations() {
    const litersEl = document.getElementById('fuel-liters');
    const amountEl = document.getElementById('fuel-amount');
    const mileageEl = document.getElementById('fuel-mileage');
    const priceEl = document.getElementById('fuel-price');
    const consEl = document.getElementById('fuel-consumption');

    if (!litersEl || !amountEl || !mileageEl) return;

    const liters = parseFloat(litersEl.value) || 0;
    const amount = parseFloat(amountEl.value) || 0;
    const mileage = parseFloat(mileageEl.value) || 0;
    
    if (liters > 0 && amount > 0 && priceEl) {
        priceEl.value = (amount / liters).toFixed(2);
    } else if (priceEl) {
        priceEl.value = '';
    }
    
    if (liters > 0 && mileage > 0 && fuelLogs.length > 0 && consEl) {
        const lastLog = [...fuelLogs].sort((a, b) => (b.mileage || 0) - (a.mileage || 0))[0];
        const diff = mileage - lastLog.mileage;
        if (diff > 0) {
            consEl.value = ((liters / diff) * 100).toFixed(1);
        } else {
            consEl.value = '';
        }
    } else if (consEl) {
        consEl.value = '';
    }
}

// 9. РЕНДЕР СПИСКА
function renderFuelLogs() {
    const container = document.getElementById('fuel-logs-list');
    if (!container) return;
    
    const periodEl = document.getElementById('fuel-filter-period');
    const period = periodEl ? periodEl.value : 'all';
    let filtered = [...fuelLogs];
    
    if (period !== 'all') {
        const now = new Date();
        const cutoff = new Date();
        if (period === 'month') cutoff.setMonth(now.getMonth() - 1);
        else if (period === '3months') cutoff.setMonth(now.getMonth() - 3);
        else if (period === 'year') cutoff.setFullYear(now.getFullYear() - 1);
        
        filtered = filtered.filter(l => {
            const d = typeof parseLocalDate === 'function' ? parseLocalDate(l.date) : new Date(l.date);
            return d && d >= cutoff;
        });
    }
    
    filtered.sort((a, b) => {
        const dateA = typeof parseLocalDate === 'function' ? parseLocalDate(a.date) : new Date(a.date);
        const dateB = typeof parseLocalDate === 'function' ? parseLocalDate(b.date) : new Date(b.date);
        return (dateB || 0) - (dateA || 0);
    });
    
    const calculated = calculateFuelConsumption(filtered);
    
    if (calculated.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--ios-text-tertiary, #86868b);"><ion-icon name="fuel-outline" style="font-size: 48px; display: block; margin: 0 auto 12px;"></ion-icon>Нет заправок за выбранный период</div>`;
        return;
    }
    
    container.innerHTML = calculated.map(log => {
        const d = typeof parseLocalDate === 'function' ? parseLocalDate(log.date) : new Date(log.date);
        const dateStr = d ? d.toLocaleDateString('ru-RU') : log.date;
        let consumptionClass = '', consumptionText = '—';
        
        if (log.consumption !== null) {
            consumptionText = log.consumption.toFixed(1) + ' л/100км';
            if (log.consumption < 8) consumptionClass = 'good';
            else if (log.consumption > 12) consumptionClass = 'bad';
        }
        
        const fmtMoney = typeof formatMoney === 'function' ? formatMoney : (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
        
        return `
            <div class="fuel-log-item">
                <div class="fuel-log-header">
                    <div class="fuel-log-icon"><ion-icon name="fuel-outline"></ion-icon></div>
                    <div class="fuel-log-date-section">
                        <div class="fuel-log-title">${dateStr}</div>
                        ${log.comment ? `<div class="fuel-log-comment">${log.comment}</div>` : ''}
                    </div>
                </div>
                
                <div class="fuel-log-meta-grid">
                    <div class="fuel-log-meta-item">
                        <ion-icon name="speedometer-outline"></ion-icon>
                        <span>${log.mileage.toLocaleString('ru-RU')} км</span>
                    </div>
                    <div class="fuel-log-meta-item">
                        <ion-icon name="water-outline"></ion-icon>
                        <span>${log.liters.toFixed(2)} л</span>
                    </div>
                    <div class="fuel-log-meta-item">
                        <ion-icon name="pricetag-outline"></ion-icon>
                        <span>${log.pricePerLiter.toFixed(2)} ₽/л</span>
                    </div>
                </div>
                
                <div class="fuel-log-footer">
                    <div class="fuel-log-consumption ${consumptionClass}">${consumptionText}</div>
                    <div class="fuel-log-amount">${fmtMoney(log.amount)}</div>
                </div>
                
                <div class="fuel-log-actions">
                    <button class="fuel-log-edit" onclick="editFuelLog('${log.id}')" title="Редактировать">
                        <ion-icon name="create-outline"></ion-icon>
                    </button>
                    <button class="fuel-log-delete" onclick="deleteFuelLog('${log.id}')" title="Удалить">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 10. СТАТИСТИКА
function updateFuelStats() {
    const logs = calculateFuelConsumption(fuelLogs);
    const withCons = logs.filter(l => l.consumption !== null);
    const totalLiters = logs.reduce((sum, l) => sum + (l.liters || 0), 0);
    const totalSpent = logs.reduce((sum, l) => sum + (l.amount || 0), 0);
    const maxM = logs.length > 0 ? Math.max(...logs.map(l => l.mileage || 0)) : 0;
    const minM = logs.length > 0 ? Math.min(...logs.map(l => l.mileage || 0)) : 0;
    const avgCons = withCons.length > 0 ? withCons.reduce((sum, l) => sum + l.consumption, 0) / withCons.length : 0;
    const avgCost = (maxM - minM) > 0 ? totalSpent / (maxM - minM) : 0;

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('fuel-avg-consumption', avgCons > 0 ? avgCons.toFixed(1) + ' л/100км' : '0 л/100км');
    setEl('fuel-cost-per-km', avgCost > 0 ? avgCost.toFixed(2) + ' ₽/км' : '0 ₽/км');
    setEl('fuel-total-liters', totalLiters.toFixed(1) + ' л');
    setEl('fuel-total-mileage', (maxM - minM).toFixed(0) + ' км');
    
    const fmtMoney = typeof formatMoney === 'function' ? formatMoney : (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
    setEl('fuel-total-spent', fmtMoney(totalSpent));
    setEl('fuel-total-logs', logs.length);
}

// 11. ГРАФИК
function updateFuelChart() {
    const canvas = document.getElementById('fuel-consumption-chart');
    const emptyMsg = document.getElementById('fuel-chart-empty');
    if (!canvas) return;
    
    const logs = calculateFuelConsumption(fuelLogs).filter(l => l.consumption !== null).sort((a, b) => {
        const dateA = typeof parseLocalDate === 'function' ? parseLocalDate(a.date) : new Date(a.date);
        const dateB = typeof parseLocalDate === 'function' ? parseLocalDate(b.date) : new Date(b.date);
        return (dateA || 0) - (dateB || 0);
    });
    
    if (logs.length < 2) {
        canvas.style.display = 'none'; 
        if (emptyMsg) emptyMsg.style.display = 'block';
        if (fuelChartInstance) { fuelChartInstance.destroy(); fuelChartInstance = null; }
        return;
    }
    
    canvas.style.display = 'block'; 
    if (emptyMsg) emptyMsg.style.display = 'none';
    
    const labels = logs.map(l => { 
        const d = typeof parseLocalDate === 'function' ? parseLocalDate(l.date) : new Date(l.date); 
        return d ? d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'}) : l.date; 
    });
    const data = logs.map(l => l.consumption);
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    
    if (fuelChartInstance) fuelChartInstance.destroy();
    fuelChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line', 
        data: { 
            labels, 
            datasets: [
                { label: 'Расход л/100км', data, borderColor: '#FF9500', backgroundColor: 'rgba(255,149,0,0.1)', borderWidth: 3, fill: true, tension: 0.4, pointRadius: 5 },
                { label: 'Средний', data: Array(labels.length).fill(avg), borderColor: '#34C759', borderWidth: 2, borderDash: [5, 5], fill: false, pointRadius: 0 }
            ]
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { position: 'bottom' } }, 
            scales: { y: { beginAtZero: false } } 
        }
    });
}

// 12. ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
document.addEventListener('DOMContentLoaded', () => {
    const fuelForm = document.getElementById('fuel-form');
    if (fuelForm) fuelForm.addEventListener('submit', handleFuelSubmit);
    
    ['fuel-liters', 'fuel-amount', 'fuel-mileage'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateFuelFormCalculations);
    });
    
    const dateInput = document.getElementById('fuel-date');
    if (dateInput) dateInput.valueAsDate = new Date();
});

// Интеграция с переключением вкладок
const originalSwitchTabFuel = window.switchTab;
window.switchTab = function(tabName) {
    if (typeof originalSwitchTabFuel === 'function') originalSwitchTabFuel(tabName);
    if (tabName === 'fuel') {
        setTimeout(() => {
            if (typeof renderFuelLogs === 'function') renderFuelLogs();
            if (typeof updateFuelStats === 'function') updateFuelStats();
            if (typeof updateFuelChart === 'function') updateFuelChart();
        }, 100);
    }
};

// ============================================
// СИНХРОНИЗАЦИЯ ТОПЛИВА С ИСТОРИЕЙ
// ============================================
// ============================================
// ИСПРАВЛЕННАЯ СИНХРОНИЗАЦИЯ ТОПЛИВА С ИСТОРИЕЙ
// ============================================
async function syncFuelToRecords() {
    console.log('🔄 Запуск синхронизации топлива с историей...');
    
    if (typeof fuelLogs === 'undefined' || fuelLogs.length === 0) {
        console.log('ℹ️ Нет записей о топливе для синхронизации');
        // Даже если топлива нет, нужно проверить — возможно, были удалены все заправки,
        // и нужно обнулить связанные записи
    }
    
    // Группируем заправки по дате
    const fuelByDate = {};
    if (fuelLogs && fuelLogs.length > 0) {
        fuelLogs.forEach(log => {
            if (!log.date) return;
            if (!fuelByDate[log.date]) {
                fuelByDate[log.date] = {
                    totalAmount: 0,
                    totalLiters: 0,
                    count: 0,
                    details: []
                };
            }
            fuelByDate[log.date].totalAmount += log.amount || 0;
            fuelByDate[log.date].totalLiters += log.liters || 0;
            fuelByDate[log.date].count += 1;
            fuelByDate[log.date].details.push({
                amount: log.amount,
                liters: log.liters,
                mileage: log.mileage,
                comment: log.comment || ''
            });
        });
    }
    console.log('📊 Найдено топлива по датам:', Object.keys(fuelByDate).length, 'дат');
    
    let updatedCount = 0;
    let changedDates = [];
    
    // Обновляем записи в records
    records.forEach(record => {
        if (!record.date) return;
        
        const fuelData = fuelByDate[record.date];
        const oldFuelCost = record.fuelCost || 0;
        
        // Проверяем, связана ли запись с модулем топлива
        // (есть fuelDetails или fuelLogCount — значит, данные пришли из модуля топлива)
        const isLinkedToFuelModule = record.fuelDetails || record.fuelLogCount > 0;
        
        if (fuelData) {
            // ✅ Для этой даты есть заправки в модуле топлива
            const newFuelCost = fuelData.totalAmount;
            
            // Обновляем если:
            // 1. Сумма изменилась, ИЛИ
            // 2. Нет деталей заправок (нужно добавить для tooltip)
            const needsUpdate = newFuelCost !== oldFuelCost ||
                !record.fuelDetails ||
                record.fuelDetails.length === 0;
            
            if (needsUpdate) {
                console.log(`📝 Обновление за ${record.date}: ${oldFuelCost} ₽ → ${newFuelCost} ₽`);
                record.fuelCost = newFuelCost;
                record.fuelDetails = fuelData.details;
                record.fuelLiters = fuelData.totalLiters;
                record.fuelLogCount = fuelData.count;
                
                // Пересчитываем расходы и прибыль
                record.totalExpenses = calcExpenses(record);
                record.netProfit = calcIncome(record) - record.totalExpenses;
                
                updatedCount++;
                changedDates.push(record.date);
            }
        } else if (isLinkedToFuelModule) {
            // ⚠️ Для этой даты НЕТ заправок, НО запись была связана с модулем топлива
            // (значит, заправку удалили — нужно обнулить)
            if (oldFuelCost > 0 || record.fuelDetails) {
                console.log(`🗑️ Обнуление топлива за ${record.date}: было ${oldFuelCost} ₽ (заправка удалена)`);
                record.fuelCost = 0;
                record.fuelDetails = [];
                record.fuelLiters = 0;
                record.fuelLogCount = 0;
                
                // Пересчитываем расходы и прибыль
                record.totalExpenses = calcExpenses(record);
                record.netProfit = calcIncome(record) - record.totalExpenses;
                
                updatedCount++;
                changedDates.push(record.date);
            }
        } else {
            // ️ Для этой даты нет заправок и запись НЕ связана с модулем топлива
            // (старые ручные данные — не трогаем!)
            console.log(`⏭️ Пропуск за ${record.date}: нет заправок, запись не связана с модулем топлива`);
        }
    });
    
    console.log(`📊 Итог синхронизации: Обновлено ${updatedCount}, Пропущено ${records.length - updatedCount}`);
    
    if (updatedCount > 0) {
        saveData();
        if (currentUser && typeof db !== 'undefined') {
            try {
                const batch = db.batch();
                const recordsRef = db.collection('users').doc(currentUser.uid).collection('records');
                records.forEach(record => {
                    if (changedDates.includes(record.date)) {
                        const recordToSave = { ...record };
                        delete recordToSave.id;
                        batch.set(recordsRef.doc(record.id), recordToSave);
                    }
                });
                await batch.commit();
                console.log('✅ Записи синхронизированы с Firebase');
            } catch (error) {
                console.error('❌ Ошибка синхронизации с Firebase:', error);
            }
        }
        renderTable();
        updateAnalytics();
        showToast(`✅ Синхронизировано ${updatedCount} записей`);
    } else {
        showToast('ℹ️ Все данные актуальны');
    }
    
    return updatedCount;
}

// ============================================
// TOOLTIP ДЛЯ ДЕТАЛЕЙ ЗАПРАВОК
// ============================================
let fuelTooltipElement = null;

function createFuelTooltip() {
    if (fuelTooltipElement) return fuelTooltipElement;
    fuelTooltipElement = document.createElement('div');
    fuelTooltipElement.className = 'fuel-tooltip';
    fuelTooltipElement.id = 'fuel-tooltip';
    document.body.appendChild(fuelTooltipElement);
    return fuelTooltipElement;
}

function showFuelTooltip(event, cell) {
    const details = cell.getAttribute('data-fuel-details');
    const liters = cell.getAttribute('data-fuel-liters');
    const count = cell.getAttribute('data-fuel-count');
    
    if (!details) return;
    
    const fuelDetails = JSON.parse(details.replace(/&apos;/g, "'"));
    const tooltip = createFuelTooltip();
    const fmtMoney = typeof formatMoney === 'function' ? formatMoney : (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
    
    let html = `
        <div class="fuel-tooltip-header">
            <ion-icon name="fuel-outline"></ion-icon>
            <h4>Подробности заправок</h4>
        </div>
        <div class="fuel-tooltip-summary">
            <div class="fuel-tooltip-summary-item">
                <div class="label">Заправок</div>
                <div class="value">${count}</div>
            </div>
            <div class="fuel-tooltip-summary-item">
                <div class="label">Литров</div>
                <div class="value">${parseFloat(liters).toFixed(1)}</div>
            </div>
            <div class="fuel-tooltip-summary-item">
                <div class="label">Сумма</div>
                <div class="value">${cell.textContent.trim()}</div>
            </div>
        </div>
        <div class="fuel-tooltip-details">
    `;
    
    fuelDetails.forEach((detail) => {
        html += `
            <div class="fuel-tooltip-detail-item">
                <div class="detail-info">
                    <div class="detail-liters">⛽ ${detail.liters} л ${detail.mileage ? `· ${detail.mileage} км` : ''}</div>
                    ${detail.comment ? `<div class="detail-comment">${detail.comment}</div>` : ''}
                </div>
                <div class="detail-amount">${fmtMoney(detail.amount)}</div>
            </div>
        `;
    });
    
    html += `</div><div class="fuel-tooltip-hint">Наведите для просмотра деталей</div>`;
    tooltip.innerHTML = html;
    
    const rect = cell.getBoundingClientRect();
    const tooltipWidth = 300;
    const tooltipHeight = tooltip.offsetHeight || 200;
    
    let left = rect.right + 10;
    let top = rect.top;
    
    if (left + tooltipWidth > window.innerWidth) left = rect.left - tooltipWidth - 10;
    if (top + tooltipHeight > window.innerHeight) top = window.innerHeight - tooltipHeight - 10;
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.classList.add('visible');
}

function hideFuelTooltip() {
    if (fuelTooltipElement) fuelTooltipElement.classList.remove('visible');
}

document.addEventListener('mouseover', function(event) {
    const cell = event.target.closest('.fuel-cell-with-details');
    if (cell) showFuelTooltip(event, cell);
});

document.addEventListener('mouseout', function(event) {
    const cell = event.target.closest('.fuel-cell-with-details');
    if (cell) {
        const tooltip = document.getElementById('fuel-tooltip');
        if (tooltip && !tooltip.contains(event.relatedTarget)) hideFuelTooltip();
    }
});

document.addEventListener('click', function(event) {
    const cell = event.target.closest('.fuel-cell-with-details');
    if (cell) {
        if (fuelTooltipElement && fuelTooltipElement.classList.contains('visible')) {
            hideFuelTooltip();
        } else {
            showFuelTooltip(event, cell);
        }
    } else if (!event.target.closest('#fuel-tooltip')) {
        hideFuelTooltip();
    }
});

// Экспорт функций в глобальную область для совместимости с HTML (onclick и т.д.)
window.fuelLogs = fuelLogs;
window.loadFuelLogs = loadFuelLogs;
window.handleFuelSubmit = handleFuelSubmit;
window.editFuelLog = editFuelLog;
window.deleteFuelLog = deleteFuelLog;
window.clearFuelForm = clearFuelForm;
window.updateFuelFormCalculations = updateFuelFormCalculations;
window.renderFuelLogs = renderFuelLogs;
window.updateFuelStats = updateFuelStats;
window.updateFuelChart = updateFuelChart;
window.syncFuelToRecords = syncFuelToRecords;

console.log('✅ Модуль топлива (fuel-module.js) успешно загружен');