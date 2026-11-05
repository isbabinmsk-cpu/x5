// ============================================
// МОДУЛЬ УЧЕТА ТОПЛИВА (fuel-module.js) v6.0
// ============================================
// Чистая версия. Вся логика открытия модалки из FAB-меню 
// делегирована функции selectFabAction в script.js.
// ============================================

let fuelLogs = [];
let editingFuelId = null;
let fuelChartInstance = null;
const FUEL_STORAGE_KEY = 'driverFuelLogs';

// ============================================
// 1. КАЛЬКУЛЯТОР МАТЕМАТИЧЕСКИХ ВЫРАЖЕНИЙ
// ============================================
function evaluateMathExpression(expression) {
    if (!expression || typeof expression !== 'string') return null;
    const original = expression.trim();
    if (!original) return null;
    
    const cleanExpr = original.replace(/,/g, '.').replace(/\s+/g, '');
    if (!/[\+\-\*\/]/.test(cleanExpr)) return null;
    if (!/^[\d\.\+\*\/\(\)\-]+$/.test(cleanExpr)) return null;
    
    try {
        const result = Function('"use strict"; return (' + cleanExpr + ')')();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            return result;
        }
    } catch (e) {
        console.warn('❌ Ошибка вычисления выражения:', e);
    }
    return null;
}

// ============================================
// 2. НАСТРОЙКА КАЛЬКУЛЯТОРА В ПОЛЕ СУММЫ
// ============================================
function setupAmountCalculator() {
    const amountInput = document.getElementById('fuel-amount');
    if (!amountInput) return;
    
    amountInput.addEventListener('input', function() {
        const hasOperators = /[\+\-\*\/]/.test(this.value);
        if (hasOperators) {
            this.style.borderColor = '#007AFF';
            this.style.backgroundColor = 'rgba(0, 122, 255, 0.05)';
            const result = evaluateMathExpression(this.value);
            if (result !== null) {
                this.title = '= ' + result.toFixed(2);
            }
        } else {
            this.style.borderColor = '';
            this.style.backgroundColor = '';
            this.title = '';
        }
        if (typeof updateFuelFormCalculations === 'function') updateFuelFormCalculations();
    });
    
    amountInput.addEventListener('blur', function() {
        const result = evaluateMathExpression(this.value);
        if (result !== null) {
            this.value = result.toFixed(2);
            if (typeof updateFuelFormCalculations === 'function') updateFuelFormCalculations();
        }
    });
}

// ============================================
// 3. РАСЧЕТ РАСХОДА
// ============================================
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

// ============================================
// 4. ЗАГРУЗКА ДАННЫХ
// ============================================
async function loadFuelLogs() {
    try {
        const saved = localStorage.getItem(FUEL_STORAGE_KEY);
        if (saved) fuelLogs = JSON.parse(saved);
        
        if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
            const snapshot = await db.collection('users')
                .doc(currentUser.uid)
                .collection('fuelLogs')
                .get();
            
            if (!snapshot.empty) {
                let loadedLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                loadedLogs.sort((a, b) => {
                    const dateA = typeof parseLocalDate === 'function' ? (parseLocalDate(a.date) || 0) : 0;
                    const dateB = typeof parseLocalDate === 'function' ? (parseLocalDate(b.date) || 0) : 0;
                    return dateB - dateA;
                });
                fuelLogs = loadedLogs;
                localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
                console.log('✅ Топливо загружено из Firebase:', fuelLogs.length, 'заправок');
            }
        }
        
        if (typeof renderFuelLogs === 'function') renderFuelLogs();
        if (typeof updateFuelStats === 'function') updateFuelStats();
        if (typeof updateFuelChart === 'function') updateFuelChart();
        if (typeof syncFuelToRecords === 'function') await syncFuelToRecords();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки топлива:', error);
    }
}

// ============================================
// 5. СОХРАНЕНИЕ В FIREBASE
// ============================================
async function saveFuelLogToFirebase(log) {
    if (typeof currentUser === 'undefined' || !currentUser || typeof db === 'undefined') return false;
    try {
        const logToSave = { ...log };
        delete logToSave.id;
        await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(log.id).set(logToSave);
        console.log('✅ Сохранено в Firebase:', log.id);
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения в Firebase:', error);
        return false;
    }
}

// ============================================
// 6. ЗАПОЛНЕНИЕ СЕЛЕКТА АВТОМОБИЛЕЙ
// ============================================
function populateVehicleSelect() {
    const select = document.getElementById('fuel-vehicle-select');
    if (!select) return;
    
    select.innerHTML = '';
    if (typeof vehicles !== 'undefined' && Array.isArray(vehicles)) {
        vehicles.forEach(v => {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = v.name || `${v.brand} ${v.model}`;
            select.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.value = 'default';
        option.textContent = 'Автомобиль по умолчанию';
        select.appendChild(option);
    }
    
    const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
    select.value = currentVId;
}

// ============================================
// 7. ОБРАБОТЧИК ФОРМЫ
// ============================================
async function handleFuelSubmit(e) {
    if (e) e.preventDefault();
    
    const date = document.getElementById('fuel-date')?.value;
    const mileage = parseFloat(document.getElementById('fuel-mileage')?.value);
    const liters = parseFloat(document.getElementById('fuel-liters')?.value);
    const amountRaw = document.getElementById('fuel-amount')?.value;
    const comment = document.getElementById('fuel-comment')?.value || '';
    const vehicleSelect = document.getElementById('fuel-vehicle-select');
    const vehicleId = vehicleSelect ? vehicleSelect.value : 'default';
    
    const evaluatedAmount = evaluateMathExpression(amountRaw);
    const amount = evaluatedAmount !== null ? evaluatedAmount : parseFloat(amountRaw);
    
    if (!date || isNaN(mileage) || isNaN(liters) || isNaN(amount) || amount <= 0) {
        const msg = '❌ Заполните все обязательные поля корректно';
        if (typeof showToast === 'function') showToast(msg);
        else alert(msg);
        return;
    }
    
    try {
        const isEditing = !!editingFuelId;
        
        if (isEditing) {
            const index = fuelLogs.findIndex(l => l.id === editingFuelId);
            if (index !== -1) {
                fuelLogs[index] = {
                    ...fuelLogs[index],
                    date, mileage, liters, amount, comment, vehicleId,
                    updatedAt: new Date().toISOString()
                };
                if (currentUser && typeof db !== 'undefined') {
                    const logToSave = { ...fuelLogs[index] };
                    delete logToSave.id;
                    await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(editingFuelId).set(logToSave);
                }
            }
        } else {
            const newLog = {
                id: Date.now().toString(),
                vehicleId, date, mileage, liters, amount, comment,
                createdAt: new Date().toISOString()
            };
            fuelLogs.push(newLog);
            if (currentUser && typeof db !== 'undefined') {
                await saveFuelLogToFirebase(newLog);
            }
        }
        
        localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
        
        calculateFuelConsumption(fuelLogs);
        if (typeof renderFuelLogs === 'function') renderFuelLogs();
        if (typeof updateFuelStats === 'function') updateFuelStats();
        if (typeof updateFuelChart === 'function') updateFuelChart();
        if (typeof syncFuelToRecords === 'function') await syncFuelToRecords();
        
        const successMsg = isEditing ? '✅ Заправка обновлена!' : '✅ Заправка добавлена!';
        if (typeof showToast === 'function') showToast(successMsg);
        
        clearFuelForm();
        closeFuelModal();
        
    } catch (error) {
        console.error('❌ Ошибка в handleFuelSubmit:', error);
        const errMsg = '❌ Ошибка сохранения: ' + error.message;
        if (typeof showToast === 'function') showToast(errMsg);
        else alert(errMsg);
    }
}

// ============================================
// 8. РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ
// ============================================
function editFuelLog(id) {
    const log = fuelLogs.find(l => l.id === id);
    if (!log) return;

    editingFuelId = id;
    
    const dateEl = document.getElementById('fuel-date');
    const mileageEl = document.getElementById('fuel-mileage');
    const litersEl = document.getElementById('fuel-liters');
    const amountEl = document.getElementById('fuel-amount');
    const commentEl = document.getElementById('fuel-comment');
    const vehicleSelect = document.getElementById('fuel-vehicle-select');

    if (dateEl) dateEl.value = log.date;
    if (mileageEl) mileageEl.value = log.mileage;
    if (litersEl) litersEl.value = log.liters;
    if (amountEl) amountEl.value = log.amount;
    if (commentEl) commentEl.value = log.comment || '';
    if (vehicleSelect) vehicleSelect.value = log.vehicleId || 'default';

    const submitText = document.getElementById('fuel-submit-text');
    if (submitText) submitText.textContent = 'Обновить заправку';
    
    openFuelModal();
    if (typeof showToast === 'function') showToast('✏️ Редактирование заправки');
}

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
    if (typeof syncFuelToRecords === 'function') await syncFuelToRecords();
    if (typeof showToast === 'function') showToast('🗑️ Заправка удалена');
}

// ============================================
// 9. ОЧИСТКА ФОРМЫ
// ============================================
function clearFuelForm() {
    const form = document.getElementById('fuel-form');
    if (form) form.reset();
    
    const dateEl = document.getElementById('fuel-date');
    if (dateEl) dateEl.valueAsDate = new Date();
    
    const priceEl = document.getElementById('fuel-price');
    if (priceEl) priceEl.value = '';
    
    const consEl = document.getElementById('fuel-consumption');
    if (consEl) consEl.value = '';
    
    const amountEl = document.getElementById('fuel-amount');
    if (amountEl) {
        amountEl.style.borderColor = '';
        amountEl.style.backgroundColor = '';
        amountEl.title = '';
    }
    
    editingFuelId = null;
    const submitText = document.getElementById('fuel-submit-text');
    if (submitText) submitText.textContent = 'Сохранить заправку';
    
    populateVehicleSelect();
}

// ============================================
// 10. АВТОРАСЧЕТ В ФОРМЕ
// ============================================
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
        const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
        const logsForCurrent = fuelLogs.filter(l => (l.vehicleId || 'default') === currentVId);
        const lastLog = [...logsForCurrent].sort((a, b) => (b.mileage || 0) - (a.mileage || 0))[0];
        
        if (lastLog) {
            const diff = mileage - lastLog.mileage;
            if (diff > 0) {
                consEl.value = ((liters / diff) * 100).toFixed(1);
            } else {
                consEl.value = '';
            }
        }
    } else if (consEl) {
        consEl.value = '';
    }
}

// ============================================
// 11. РЕНДЕР СПИСКА, СТАТИСТИКА И ГРАФИК
// ============================================
function renderFuelLogs() {
    const container = document.getElementById('fuel-logs-list');
    if (!container) return;
    
    const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
    let filtered = fuelLogs.filter(log => (log.vehicleId || 'default') === currentVId);
    
    const periodEl = document.getElementById('fuel-filter-period');
    const period = periodEl ? periodEl.value : 'all';
    
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

function updateFuelStats() {
    const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
    const logsForCurrent = fuelLogs.filter(log => (log.vehicleId || 'default') === currentVId);
    const logs = calculateFuelConsumption(logsForCurrent);
    const withCons = logs.filter(l => l.consumption !== null);
    
    const totalLiters = logs.reduce((sum, l) => sum + (l.liters || 0), 0);
    const totalSpent = logs.reduce((sum, l) => sum + (l.amount || 0), 0);
    const maxM = logs.length > 0 ? Math.max(...logs.map(l => l.mileage || 0)) : 0;
    const minM = logs.length > 0 ? Math.min(...logs.map(l => l.mileage || 0)) : 0;
    const avgCons = withCons.length > 0 ? withCons.reduce((sum, l) => sum + l.consumption, 0) / withCons.length : 0;
    const avgCost = (maxM - minM) > 0 ? totalSpent / (maxM - minM) : 0;

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const fmtMoney = typeof formatMoney === 'function' ? formatMoney : (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
    
    setEl('fuel-avg-consumption', avgCons > 0 ? avgCons.toFixed(1) + ' л/100км' : '0 л/100км');
    setEl('fuel-cost-per-km', avgCost > 0 ? avgCost.toFixed(2) + ' ₽/км' : '0 ₽/км');
    setEl('fuel-total-liters', totalLiters.toFixed(1) + ' л');
    setEl('fuel-total-mileage', (maxM - minM).toFixed(0) + ' км');
    setEl('fuel-total-spent', fmtMoney(totalSpent));
    setEl('fuel-total-logs', logs.length);
}

function updateFuelChart() {
    const canvas = document.getElementById('fuel-consumption-chart');
    const emptyMsg = document.getElementById('fuel-chart-empty');
    if (!canvas) return;
    
    const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
    const logsForCurrent = fuelLogs.filter(log => (log.vehicleId || 'default') === currentVId);
    const logs = calculateFuelConsumption(logsForCurrent).filter(l => l.consumption !== null).sort((a, b) => {
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
                { label: 'Расход л/100км', data, borderColor: '#FF9500', backgroundColor: 'rgba(255,149,0,0.1)', borderWidth: 3, fill: true, tension: .4, pointRadius: 5 },
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

// ============================================
// 12. УПРАВЛЕНИЕ МОДАЛЬНЫМ ОКНОМ
// ============================================
function openFuelModal() {
    const overlay = document.getElementById('fuel-modal-overlay');
    if (!overlay) return;
    
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    populateVehicleSelect();
    
    setTimeout(() => {
        const dateInput = document.getElementById('fuel-date');
        if (dateInput && !dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
    }, 100);
}

function closeFuelModal() {
    const overlay = document.getElementById('fuel-modal-overlay');
    if (!overlay) return;
    
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
    
    setTimeout(() => {
        clearFuelForm();
    }, 300);
}

document.addEventListener('click', function(e) {
    const overlay = document.getElementById('fuel-modal-overlay');
    if (overlay && e.target === overlay) closeFuelModal();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('fuel-modal-overlay');
        if (overlay && overlay.classList.contains('visible')) closeFuelModal();
    }
});

// ============================================
// 13. СИНХРОНИЗАЦИЯ С ОСНОВНЫМИ ЗАПИСЯМИ
// ============================================
async function syncFuelToRecords() {
    let allFuelLogs = [];
    if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('fuelLogs').get();
            if (!snapshot.empty) allFuelLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) { console.error('❌ Ошибка синхронизации:', error); }
    } else {
        const saved = localStorage.getItem(FUEL_STORAGE_KEY);
        if (saved) allFuelLogs = JSON.parse(saved);
    }
    
    if (allFuelLogs.length === 0 || typeof records === 'undefined') return 0;
    
    const fuelByDate = {};
    allFuelLogs.forEach(log => {
        if (!log.date) return;
        if (!fuelByDate[log.date]) fuelByDate[log.date] = { totalAmount: 0, totalLiters: 0, count: 0, details: [] };
        fuelByDate[log.date].totalAmount += log.amount || 0;
        fuelByDate[log.date].totalLiters += log.liters || 0;
        fuelByDate[log.date].count += 1;
        fuelByDate[log.date].details.push({ amount: log.amount, liters: log.liters, mileage: log.mileage, comment: log.comment || '', vehicleId: log.vehicleId || 'default' });
    });
    
    let updatedCount = 0;
    records.forEach(record => {
        if (!record.date) return;
        const fuelData = fuelByDate[record.date];
        const oldFuelCost = record.fuelCost || 0;
        const isLinked = record.fuelDetails || (record.fuelLogCount > 0);
        
        if (fuelData) {
            if (fuelData.totalAmount !== oldFuelCost || !record.fuelDetails) {
                record.fuelCost = fuelData.totalAmount;
                record.fuelDetails = fuelData.details;
                record.fuelLiters = fuelData.totalLiters;
                record.fuelLogCount = fuelData.count;
                record.totalExpenses = typeof calcExpenses === 'function' ? calcExpenses(record) : 0;
                record.netProfit = (typeof calcIncome === 'function' ? calcIncome(record) : 0) - record.totalExpenses;
                updatedCount++;
            }
        } else if (isLinked) {
            record.fuelCost = 0; record.fuelDetails = []; record.fuelLiters = 0; record.fuelLogCount = 0;
            record.totalExpenses = typeof calcExpenses === 'function' ? calcExpenses(record) : 0;
            record.netProfit = (typeof calcIncome === 'function' ? calcIncome(record) : 0) - record.totalExpenses;
            updatedCount++;
        }
    });
    
    if (updatedCount > 0 && typeof saveData === 'function') {
        saveData();
        if (typeof renderTable === 'function') renderTable();
        if (typeof updateAnalytics === 'function') updateAnalytics();
    }
    return updatedCount;
}

// ============================================
// 14. ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const fuelForm = document.getElementById('fuel-form');
    if (fuelForm) {
        fuelForm.addEventListener('submit', handleFuelSubmit);
        console.log('✅ Обработчик submit формы топлива привязан');
    }
    
    setupAmountCalculator();
    
    ['fuel-liters', 'fuel-mileage', 'fuel-amount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateFuelFormCalculations);
            el.addEventListener('change', updateFuelFormCalculations);
        }
    });
    
    const dateInput = document.getElementById('fuel-date');
    if (dateInput) dateInput.valueAsDate = new Date();
    
    populateVehicleSelect();
});

// ============================================
// 15. ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================
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
window.evaluateMathExpression = evaluateMathExpression;
window.openFuelModal = openFuelModal;
window.closeFuelModal = closeFuelModal;
window.populateVehicleSelect = populateVehicleSelect;

console.log('✅ Модуль топлива (fuel-module.js v6.0) успешно загружен');