// ============================================
// МОДУЛЬ УЧЕТА ТОПЛИВА (fuel-module.js) v2.0
// ============================================
// 
// ⚠️ ЗАВИСИМОСТИ (должны быть определены в основном script.js или vehicle-module.js):
// - currentUser, db (объекты Firebase)
// - records (массив основных записей)
// - getCurrentVehicleId() (из vehicle-module.js)
// - parseLocalDate(), formatMoney(), calcIncome(), calcExpenses()
// - saveData(), renderTable(), updateAnalytics(), showToast()
// ============================================

// Локальное состояние модуля (ХРАНИТ ДАННЫЕ ВСЕХ АВТОМОБИЛЕЙ для корректного бэкапа)
let fuelLogs = [];
let editingFuelId = null;
let fuelChartInstance = null;
const FUEL_STORAGE_KEY = 'driverFuelLogs';

// ============================================
// КАЛЬКУЛЯТОР ДЛЯ ПОЛЯ СУММЫ (МАТЕМАТИЧЕСКИЕ ВЫРАЖЕНИЯ)
// ============================================
function evaluateMathExpression(expression) {
    if (!expression || typeof expression !== 'string') return null;
    
    const original = expression.trim();
    if (!original) return null;
    
    expression = original.replace(/,/g, '.').replace(/\s+/g, '');
    if (!/[\+\-\*\/]/.test(expression)) return null;
    if (!/^[\d\.\+\*\/\(\)\-]+$/.test(expression)) return null;
    
    try {
        const result = Function('"use strict"; return (' + expression + ')')();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            return result;
        }
    } catch (e) {
        console.warn('❌ Ошибка вычисления выражения:', e);
    }
    return null;
}

// ============================================
// НАСТРОЙКА КАЛЬКУЛЯТОРА ДЛЯ ПОЛЯ СУММЫ
// ============================================
function setupAmountCalculator() {
    const amountInput = document.getElementById('fuel-amount');
    if (!amountInput) return;
    
    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.id = 'fuel-amount';
    newInput.className = amountInput.className;
    newInput.placeholder = 'Например: 45.5*2 или 1500+300';
    newInput.title = 'Поддерживается калькулятор: 45.5*2, 1500+300, (100+50)*2';
    newInput.value = amountInput.value;
    newInput.autocomplete = 'off';
    
    amountInput.parentNode.replaceChild(newInput, amountInput);
    
    newInput.addEventListener('blur', function() {
        const result = evaluateMathExpression(this.value);
        if (result !== null) {
            this.value = result.toFixed(2);
            if (typeof updateFuelFormCalculations === 'function') updateFuelFormCalculations();
        }
        this.style.borderColor = '';
        this.style.backgroundColor = '';
        const hint = document.getElementById('calc-hint');
        if (hint) hint.remove();
    });
    
    newInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const result = evaluateMathExpression(this.value);
            if (result !== null) {
                this.value = result.toFixed(2);
                if (typeof updateFuelFormCalculations === 'function') updateFuelFormCalculations();
            }
            this.style.borderColor = '';
            this.style.backgroundColor = '';
            const hint = document.getElementById('calc-hint');
            if (hint) hint.remove();
        }
    });
    
    newInput.addEventListener('input', function() {
        const hasOperators = /[\+\-\*\/]/.test(this.value);
        if (hasOperators) {
            this.style.borderColor = '#007AFF';
            this.style.backgroundColor = 'rgba(0, 122, 255, 0.05)';
            const result = evaluateMathExpression(this.value);
            let hint = document.getElementById('calc-hint');
            if (!hint && result !== null) {
                hint = document.createElement('div');
                hint.id = 'calc-hint';
                hint.style.cssText = `position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #007AFF; font-size: 12px; font-weight: bold; pointer-events: none; background: rgba(0, 122, 255, 0.1); padding: 2px 8px; border-radius: 4px;`;
                this.parentNode.style.position = 'relative';
                this.parentNode.appendChild(hint);
            }
            if (hint) {
                hint.textContent = result !== null ? '= ' + result.toFixed(2) : '';
                hint.style.display = result !== null ? 'block' : 'none';
            }
        } else {
            this.style.borderColor = '';
            this.style.backgroundColor = '';
            const hint = document.getElementById('calc-hint');
            if (hint) {
                if (this.value.trim() === '') hint.remove();
                else hint.style.display = 'none';
            }
        }
        if (typeof updateFuelFormCalculations === 'function') updateFuelFormCalculations();
    });
}

// ============================================
// 1. РАСЧЕТ РАСХОДА
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
// 2. ЗАГРУЗКА ДАННЫХ (✅ ИСПРАВЛЕНО: загружаем ВСЕ заправки всех авто)
// ============================================
async function loadFuelLogs() {
    try {
        const saved = localStorage.getItem(FUEL_STORAGE_KEY);
        if (saved) fuelLogs = JSON.parse(saved);
        
        if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
            // ✅ УБРАН фильтр .where('vehicleId', '==', vId), чтобы получить ВСЕ заправки для бэкапа
            const snapshot = await db.collection('users')
                .doc(currentUser.uid)
                .collection('fuelLogs')
                .get();
            
            if (!snapshot.empty) {
                let loadedLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                loadedLogs.sort((a, b) => {
                    const dateA = parseLocalDate(a.date) || 0;
                    const dateB = parseLocalDate(b.date) || 0;
                    return dateB - dateA;
                });
                fuelLogs = loadedLogs;
                localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
                console.log('✅ Топливо загружено из Firebase (ВСЕ авто):', fuelLogs.length, 'заправок');
            } else {
                fuelLogs = [];
                localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
            }
        }
        
        // ✅ Функции отображения сами отфильтруют данные по текущему авто
        if (typeof renderFuelLogs === 'function') renderFuelLogs();
        if (typeof updateFuelStats === 'function') updateFuelStats();
        if (typeof updateFuelChart === 'function') updateFuelChart();
        
        if (typeof syncFuelToRecords === 'function') {
            await syncFuelToRecords();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки топлива:', error);
    }
}

// ============================================
// 3. СОХРАНЕНИЕ В FIREBASE
// ============================================
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

// ============================================
// 4. ОБРАБОТЧИК ФОРМЫ (ДОБАВЛЕНИЕ И РЕДАКТИРОВАНИЕ)
// ============================================
async function handleFuelSubmit(e) {
    e.preventDefault();
    
    const date = document.getElementById('fuel-date').value;
    const mileage = parseFloat(document.getElementById('fuel-mileage').value);
    const liters = parseFloat(document.getElementById('fuel-liters').value);
    
    const amountRaw = document.getElementById('fuel-amount').value;
    const evaluatedAmount = evaluateMathExpression(amountRaw);
    const amount = evaluatedAmount !== null ? evaluatedAmount : parseFloat(amountRaw);
    
    const comment = document.getElementById('fuel-comment').value || '';
    const vehicleId = document.getElementById('fuel-vehicle-select')?.value || 'default';
    
    if (!date || !mileage || !liters || !amount) {
        alert('❌ Заполните все обязательные поля');
        return;
    }
    
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
                try {
                    const logToSave = { ...fuelLogs[index] };
                    delete logToSave.id;
                    await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(editingFuelId).set(logToSave);
                } catch (error) {
                    console.error('Ошибка обновления в Firebase:', error);
                }
            }
        }
    } else {
        const newLog = {
            id: Date.now().toString(),
            vehicleId, date, mileage, liters, amount, comment,
            createdAt: new Date().toISOString()
        };
        fuelLogs.push(newLog);
        await saveFuelLogToFirebase(newLog);
    }
    
    localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
    calculateFuelConsumption(fuelLogs);
    renderFuelLogs();
    updateFuelStats();
    updateFuelChart();
    clearFuelForm();
    if (typeof syncFuelToRecords === 'function') await syncFuelToRecords();
    
    if (typeof showToast === 'function') {
        showToast(isEditing ? '✅ Заправка обновлена!' : '✅ Заправка добавлена!');
    }
}

// ============================================
// 5. РЕДАКТИРОВАНИЕ
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

// ============================================
// 6. УДАЛЕНИЕ
// ============================================
async function deleteFuelLog(id) {
    if (!confirm('Удалить эту заправку?')) return;
    
    fuelLogs = fuelLogs.filter(l => l.id !== id);
    localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
    
    if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
        await db.collection('users').doc(currentUser.uid).collection('fuelLogs').doc(id).delete().catch(console.error);
    }
    
    renderFuelLogs();
    updateFuelStats();
    updateFuelChart();
    if (typeof syncFuelToRecords === 'function') await syncFuelToRecords();
    if (typeof showToast === 'function') showToast('🗑️ Заправка удалена');
}

// ============================================
// 7. ОЧИСТКА ФОРМЫ
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
    
    const hint = document.getElementById('calc-hint');
    if (hint) hint.remove();
    
    const amountEl = document.getElementById('fuel-amount');
    if (amountEl) {
        amountEl.style.borderColor = '';
        amountEl.style.backgroundColor = '';
    }
    
    editingFuelId = null;
    const submitBtn = document.querySelector('#fuel-form button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить заправку';
        submitBtn.classList.remove('btn-primary');
        submitBtn.classList.add('btn-success');
    }
}

// ============================================
// 8. АВТОРАСЧЕТ В ФОРМЕ
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
        // Для прогноза расхода ищем последнюю заправку ТОГО ЖЕ автомобиля
        const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
        const logsForCurrent = fuelLogs.filter(l => (l.vehicleId || 'default') === currentVId);
        const lastLog = [...logsForCurrent].sort((a, b) => (b.mileage || 0) - (a.mileage || 0)[0]);
        
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
// 9. РЕНДЕР СПИСКА (✅ ИСПРАВЛЕНО: фильтруем по текущему авто)
// ============================================
function renderFuelLogs() {
    const container = document.getElementById('fuel-logs-list');
    if (!container) return;
    
    const currentVId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
    
    // 1. Сначала фильтруем по автомобилю
    let filtered = fuelLogs.filter(log => (log.vehicleId || 'default') === currentVId);
    
    // 2. Затем фильтруем по период
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
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--ios-text-tertiary, #86868b);"><ion-icon name="fuel-outline" style="font-size: 48px; display: block; margin: 0 auto 12px;"></ion-icon>Нет заправок за выбранный период для этого авто</div>`;
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

// ============================================
// 10. СТАТИСТИКА (✅ ИСПРАВЛЕНО: считаем только для текущего авто)
// ============================================
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
    setEl('fuel-avg-consumption', avgCons > 0 ? avgCons.toFixed(1) + ' л/100км' : '0 л/100км');
    setEl('fuel-cost-per-km', avgCost > 0 ? avgCost.toFixed(2) + ' ₽/км' : '0 ₽/км');
    setEl('fuel-total-liters', totalLiters.toFixed(1) + ' л');
    setEl('fuel-total-mileage', (maxM - minM).toFixed(0) + ' км');
    
    const fmtMoney = typeof formatMoney === 'function' ? formatMoney : (n) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n);
    setEl('fuel-total-spent', fmtMoney(totalSpent));
    setEl('fuel-total-logs', logs.length);
}

// ============================================
// 11. ГРАФИК (✅ ИСПРАВЛЕНО: строим только для текущего авто)
// ============================================
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
// 12. ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const fuelForm = document.getElementById('fuel-form');
    if (fuelForm) {
        const newForm = fuelForm.cloneNode(true);
        fuelForm.parentNode.replaceChild(newForm, fuelForm);
        newForm.addEventListener('submit', handleFuelSubmit);
    }
    
    setupAmountCalculator();
    
    const setupInputHandlers = () => {
        ['fuel-liters', 'fuel-mileage'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const newEl = el.cloneNode(true);
                el.parentNode.replaceChild(newEl, el);
                newEl.addEventListener('input', updateFuelFormCalculations);
                newEl.addEventListener('change', updateFuelFormCalculations);
            }
        });
    };
    
    setTimeout(setupInputHandlers, 50);
    
    const dateInput = document.getElementById('fuel-date');
    if (dateInput) dateInput.valueAsDate = new Date();
});

// ============================================
// 13. СИНХРОНИЗАЦИЯ ТОПЛИВА С ИСТОРИЕЙ (ВСЕ АВТО)
// ============================================
async function syncFuelToRecords() {
    let allFuelLogs = [];
    
    if (currentUser && typeof db !== 'undefined') {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('fuelLogs').get();
            if (!snapshot.empty) {
                allFuelLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки всех заправок для синхронизации:', error);
        }
    } else {
        const saved = localStorage.getItem(FUEL_STORAGE_KEY);
        if (saved) allFuelLogs = JSON.parse(saved);
    }
    
    if (allFuelLogs.length === 0) return 0;
    
    const fuelByDate = {};
    allFuelLogs.forEach(log => {
        if (!log.date) return;
        if (!fuelByDate[log.date]) {
            fuelByDate[log.date] = { totalAmount: 0, totalLiters: 0, count: 0, details: [] };
        }
        fuelByDate[log.date].totalAmount += log.amount || 0;
        fuelByDate[log.date].totalLiters += log.liters || 0;
        fuelByDate[log.date].count += 1;
        fuelByDate[log.date].details.push({
            amount: log.amount, liters: log.liters, mileage: log.mileage,
            comment: log.comment || '', vehicleId: log.vehicleId || 'default'
        });
    });
    
    let updatedCount = 0;
    let changedDates = [];
    
    records.forEach(record => {
        if (!record.date) return;
        const fuelData = fuelByDate[record.date];
        const oldFuelCost = record.fuelCost || 0;
        const isLinkedToFuelModule = record.fuelDetails || (record.fuelLogCount > 0);
        
        if (fuelData) {
            const newFuelCost = fuelData.totalAmount;
            const needsUpdate = newFuelCost !== oldFuelCost || !record.fuelDetails || record.fuelDetails.length === 0;
            if (needsUpdate) {
                record.fuelCost = newFuelCost;
                record.fuelDetails = fuelData.details;
                record.fuelLiters = fuelData.totalLiters;
                record.fuelLogCount = fuelData.count;
                record.totalExpenses = calcExpenses(record);
                record.netProfit = calcIncome(record) - record.totalExpenses;
                updatedCount++;
                changedDates.push(record.date);
            }
        } else if (isLinkedToFuelModule) {
            if (oldFuelCost > 0 || record.fuelDetails) {
                record.fuelCost = 0;
                record.fuelDetails = [];
                record.fuelLiters = 0;
                record.fuelLogCount = 0;
                record.totalExpenses = calcExpenses(record);
                record.netProfit = calcIncome(record) - record.totalExpenses;
                updatedCount++;
                changedDates.push(record.date);
            }
        }
    });
    
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
            } catch (error) {
                console.error('❌ Ошибка синхронизации истории с Firebase:', error);
            }
        }
        if (typeof renderTable === 'function') renderTable();
        if (typeof updateAnalytics === 'function') updateAnalytics();
    }
    return updatedCount;
}

// ============================================
// 14. TOOLTIP ДЛЯ ДЕТАЛЕЙ ЗАПРАВОК
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
            <div class="fuel-tooltip-summary-item"><div class="label">Заправок</div><div class="value">${count}</div></div>
            <div class="fuel-tooltip-summary-item"><div class="label">Литров</div><div class="value">${parseFloat(liters).toFixed(1)}</div></div>
            <div class="fuel-tooltip-summary-item"><div class="label">Сумма</div><div class="value">${cell.textContent.trim()}</div></div>
        </div>
        <div class="fuel-tooltip-details">
    `;
    
    fuelDetails.forEach((detail) => {
        const vehicleName = typeof window.getVehicleNameById === 'function' ?
            window.getVehicleNameById(detail.vehicleId) : 'Неизвестный автомобиль';
        html += `
            <div class="fuel-tooltip-detail-item">
                <div class="detail-info">
                    <div style="font-weight: 600; color: var(--ios-accent); font-size: 12px; margin-bottom: 4px;">${vehicleName}</div>
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
    const tooltipWidth = 350;
    const tooltipHeight = tooltip.offsetHeight || 250;
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

// ============================================
// ЭКСПОРТ ФУНКЦИЙ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
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

console.log('✅ Модуль топлива (fuel-module.js v2.0) успешно загружен');