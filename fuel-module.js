// ============================================
// МОДУЛЬ УЧЁТА ТОПЛИВА (fuel-module.js) v7.0
// ============================================
// Экономная версия (без onSnapshot и без лишних get).
// Чтение из Firebase происходит только 1 раз при запуске.
// ============================================
(function () {
    'use strict';

    const FUEL_STORAGE_KEY = 'driverFuelLogs';

    let fuelLogs = [];
    let editingFuelId = null;
    let fuelChartInstance = null;

    // ============================================
    // УТИЛИТЫ
    // ============================================
    function toast(msg) {
        if (typeof window.showToast === 'function') {
            try { window.showToast(msg); return; } catch (e) {}
        }
        console.log('🔔', msg);
    }

    function fmtMoney(n) {
        if (typeof window.formatMoney === 'function') return window.formatMoney(n);
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(Number(n) || 0);
    }

    function parseDate(s) {
        if (typeof window.parseLocalDate === 'function') return window.parseLocalDate(s);
        if (!s) return null;
        const p = String(s).split('-');
        return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : new Date(s);
    }

    function getVId() {
        return typeof window.getCurrentVehicleId === 'function'
            ? window.getCurrentVehicleId()
            : 'default';
    }

    function getAllVehicles() {
        return typeof window.getVehicles === 'function' ? window.getVehicles() : [];
    }

    function isFirebaseReady() {
    return typeof window.db !== 'undefined' && window.db &&
        typeof window.currentUser !== 'undefined' && window.currentUser &&
        typeof window.currentUser.uid === 'string' && window.currentUser.uid.length > 0;
}

    function persistLocal() {
        try {
            localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
        } catch (e) {
            console.warn('⚠️ Не удалось сохранить топливо локально:', e.message);
        }
    }

    // ============================================
    // 1. КАЛЬКУЛЯТОР ВЫРАЖЕНИЙ
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
    // 2. КАЛЬКУЛЯТОР В ПОЛЕ СУММЫ
    // ============================================
    function setupAmountCalculator() {
        const amountInput = document.getElementById('fuel-amount');
        if (!amountInput) return;

        amountInput.addEventListener('input', function () {
            const hasOps = /[\+\-\*\/]/.test(this.value);
            if (hasOps) {
                this.style.borderColor = '#007AFF';
                this.style.backgroundColor = 'rgba(0, 122, 255, 0.05)';
                const result = evaluateMathExpression(this.value);
                if (result !== null) this.title = '= ' + result.toFixed(2);
            } else {
                this.style.borderColor = '';
                this.style.backgroundColor = '';
                this.title = '';
            }
            updateFuelFormCalculations();
        });

        amountInput.addEventListener('blur', function () {
            const result = evaluateMathExpression(this.value);
            if (result !== null) {
                this.value = result.toFixed(2);
                updateFuelFormCalculations();
            }
        });
    }

    // ============================================
    // 3. РАСЧЁТ РАСХОДА
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
    // 4. ЗАГРУЗКА (БЕЗ onSnapshot)
    // ============================================
let isFuelLoaded = false; // ⭐ ДОБАВИТЬ В САМОЕ НАЧАЛО IIFE

async function loadFuelLogs(force = false) { // ⭐ добавили force
    try {
        const saved = localStorage.getItem(FUEL_STORAGE_KEY);
        if (saved) {
            try { fuelLogs = JSON.parse(saved); } catch (e) { fuelLogs = []; }
        }
        
        // ⭐ ЗАЩИТА: если уже загружали из Firebase и это не принудительно — пропускаем
        if (isFuelLoaded && !force) {
            console.log('ℹ️ Топливо уже в памяти, пропускаем Firebase');
            renderFuelLogs();
            updateFuelStats();
            updateFuelChart();
            return;
        }
        
        if (isFirebaseReady()) {
            console.log('☁️ Загрузка топлива из Firebase (1 раз)...');
            try {
                const snap = await window.db.collection('users')
                    .doc(window.currentUser.uid)
                    .collection('fuelLogs')
                    .get();
                
                if (!snap.empty) {
                    const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    loaded.sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
                    fuelLogs = loaded;
                    persistLocal();
                    console.log('✅ Топливо загружено из Firebase:', fuelLogs.length);
                }
                isFuelLoaded = true; // ⭐ ставим флаг после загрузки
            } catch (err) {
                console.error('❌ Firebase load fuelLogs:', err);
            }
        }
        
        renderFuelLogs();
        updateFuelStats();
        updateFuelChart();
        
        if (typeof window.records !== 'undefined' && Array.isArray(window.records) && window.records.length > 0) {
            await syncFuelToRecords();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки топлива:', error);
    }
}

    // ============================================
    // 5. СОХРАНЕНИЕ В FIREBASE
    // ============================================
    async function saveFuelLogToFirebase(log) {
        if (!isFirebaseReady()) return false;
        try {
            const payload = { ...log };
            delete payload.id;
            await window.db.collection('users').doc(window.currentUser.uid)
                .collection('fuelLogs').doc(log.id).set(payload);
            if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
            return true;
        } catch (error) {
            console.error('❌ Ошибка сохранения в Firebase:', error);
            return false;
        }
    }

    // ============================================
    // 6. СЕЛЕКТ АВТО
    // ============================================
    function populateVehicleSelect() {
        const select = document.getElementById('fuel-vehicle-select');
        if (!select) return;

        select.innerHTML = '';
        const list = getAllVehicles();
        if (list && list.length > 0) {
            list.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.name || `${v.brand || ''} ${v.model || ''}`.trim() || 'Автомобиль';
                select.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = 'default';
            opt.textContent = 'Автомобиль по умолчанию';
            select.appendChild(opt);
        }

        select.value = getVId();
    }

    // ============================================
    // 7. САБМИТ ФОРМЫ
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

        const evaluated = evaluateMathExpression(amountRaw);
        const amount = evaluated !== null ? evaluated : parseFloat(amountRaw);

        if (!date || isNaN(mileage) || isNaN(liters) || isNaN(amount) || amount <= 0) {
            toast('❌ Заполните все обязательные поля корректно');
            return;
        }

        try {
            const isEditing = !!editingFuelId;

            if (isEditing) {
                const idx = fuelLogs.findIndex(l => l.id === editingFuelId);
                if (idx !== -1) {
                    fuelLogs[idx] = {
                        ...fuelLogs[idx],
                        date, mileage, liters, amount, comment, vehicleId,
                        updatedAt: new Date().toISOString()
                    };
                    if (isFirebaseReady()) {
                        const payload = { ...fuelLogs[idx] };
                        delete payload.id;
                        await window.db.collection('users').doc(window.currentUser.uid)
                            .collection('fuelLogs').doc(editingFuelId).set(payload);
                    }
                }
            } else {
                const newLog = {
                    id: Date.now().toString(),
                    vehicleId, date, mileage, liters, amount, comment,
                    createdAt: new Date().toISOString()
                };
                fuelLogs.push(newLog);
                if (isFirebaseReady()) await saveFuelLogToFirebase(newLog);
            }

            persistLocal();

            // Пересчёт/рендер
            calculateFuelConsumption(fuelLogs);
            renderFuelLogs();
            updateFuelStats();
            updateFuelChart();

            await syncFuelToRecords();

            toast(isEditing ? '✅ Заправка обновлена!' : '✅ Заправка добавлена!');
            clearFuelForm();
            closeFuelModal();
        } catch (error) {
            console.error('❌ Ошибка в handleFuelSubmit:', error);
            toast('❌ Ошибка сохранения: ' + error.message);
        }
    }

    // ============================================
    // 8. РЕДАКТИРОВАНИЕ / УДАЛЕНИЕ
    // ============================================
    function editFuelLog(id) {
        const log = fuelLogs.find(l => l.id === id);
        if (!log) return;

        editingFuelId = id;

        const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val != null ? val : ''; };
        set('fuel-date', log.date);
        set('fuel-mileage', log.mileage);
        set('fuel-liters', log.liters);
        set('fuel-amount', log.amount);
        set('fuel-comment', log.comment || '');
        set('fuel-vehicle-select', log.vehicleId || 'default');

        const submitText = document.getElementById('fuel-submit-text');
        if (submitText) submitText.textContent = 'Обновить заправку';

        openFuelModal();
        toast('✏️ Редактирование заправки');
    }

    async function deleteFuelLog(id) {
        if (!confirm('Удалить эту заправку?')) return;

        if (isFirebaseReady()) {
            try {
                await window.db.collection('users').doc(window.currentUser.uid)
                    .collection('fuelLogs').doc(id).delete();
                if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
                console.log('✅ Заправка удалена из Firebase');
            } catch (error) {
                console.error('❌ Ошибка удаления из Firebase:', error);
            }
        }

        fuelLogs = fuelLogs.filter(l => l.id !== id);
        persistLocal();

        renderFuelLogs();
        updateFuelStats();
        updateFuelChart();
        await syncFuelToRecords();

        toast('🗑️ Заправка удалена');
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
    // 10. АВТОРАСЧЁТ
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
            const vId = getVId();
            const logsFor = fuelLogs.filter(l => (l.vehicleId || 'default') === vId);
            const lastLog = [...logsFor].sort((a, b) => (b.mileage || 0) - (a.mileage || 0))[0];
            if (lastLog) {
                const diff = mileage - lastLog.mileage;
                consEl.value = diff > 0 ? ((liters / diff) * 100).toFixed(1) : '';
            }
        } else if (consEl) {
            consEl.value = '';
        }
    }

    // ============================================
    // 11. РЕНДЕР / СТАТИСТИКА / ГРАФИК
    // ============================================
    function renderFuelLogs() {
        const container = document.getElementById('fuel-logs-list');
        if (!container) return;

        const vId = getVId();
        let filtered = fuelLogs.filter(log => (log.vehicleId || 'default') === vId);

        const periodEl = document.getElementById('fuel-filter-period');
        const period = periodEl ? periodEl.value : 'all';

        if (period !== 'all') {
            const now = new Date();
            const cutoff = new Date();
            if (period === 'month') cutoff.setMonth(now.getMonth() - 1);
            else if (period === '3months') cutoff.setMonth(now.getMonth() - 3);
            else if (period === 'year') cutoff.setFullYear(now.getFullYear() - 1);
            filtered = filtered.filter(l => {
                const d = parseDate(l.date);
                return d && d >= cutoff;
            });
        }

        filtered.sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));

        const calc = calculateFuelConsumption(filtered);

        if (calc.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ios-text-tertiary,#86868b);">
                <ion-icon name="fuel-outline" style="font-size:48px;display:block;margin:0 auto 12px;"></ion-icon>
                Нет заправок за выбранный период
            </div>`;
            return;
        }

        container.innerHTML = calc.map(log => {
            const d = parseDate(log.date);
            const dateStr = d ? d.toLocaleDateString('ru-RU') : log.date;
            let consumptionClass = '', consumptionText = '—';
            if (log.consumption !== null) {
                consumptionText = log.consumption.toFixed(1) + ' л/100км';
                if (log.consumption < 8) consumptionClass = 'good';
                else if (log.consumption > 12) consumptionClass = 'bad';
            }
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
                        <div class="fuel-log-meta-item"><ion-icon name="speedometer-outline"></ion-icon><span>${(log.mileage || 0).toLocaleString('ru-RU')} км</span></div>
                        <div class="fuel-log-meta-item"><ion-icon name="water-outline"></ion-icon><span>${(log.liters || 0).toFixed(2)} л</span></div>
                        <div class="fuel-log-meta-item"><ion-icon name="pricetag-outline"></ion-icon><span>${(log.pricePerLiter || 0).toFixed(2)} ₽/л</span></div>
                    </div>
                    <div class="fuel-log-footer">
                        <div class="fuel-log-consumption ${consumptionClass}">${consumptionText}</div>
                        <div class="fuel-log-amount">${fmtMoney(log.amount)}</div>
                    </div>
                    <div class="fuel-log-actions">
                        <button class="fuel-log-edit" onclick="editFuelLog('${log.id}')" title="Редактировать"><ion-icon name="create-outline"></ion-icon></button>
                        <button class="fuel-log-delete" onclick="deleteFuelLog('${log.id}')" title="Удалить"><ion-icon name="trash-outline"></ion-icon></button>
                    </div>
                </div>`;
        }).join('');
    }

    function updateFuelStats() {
        const vId = getVId();
        const logsFor = fuelLogs.filter(log => (log.vehicleId || 'default') === vId);
        const logs = calculateFuelConsumption(logsFor);
        const withCons = logs.filter(l => l.consumption !== null);

        const totalLiters = logs.reduce((s, l) => s + (l.liters || 0), 0);
        const totalSpent = logs.reduce((s, l) => s + (l.amount || 0), 0);
        const maxM = logs.length ? Math.max(...logs.map(l => l.mileage || 0)) : 0;
        const minM = logs.length ? Math.min(...logs.map(l => l.mileage || 0)) : 0;
        const avgCons = withCons.length ? withCons.reduce((s, l) => s + l.consumption, 0) / withCons.length : 0;
        const avgCost = (maxM - minM) > 0 ? totalSpent / (maxM - minM) : 0;

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('fuel-avg-consumption', avgCons > 0 ? avgCons.toFixed(1) + ' л/100км' : '0 л/100км');
        set('fuel-cost-per-km', avgCost > 0 ? avgCost.toFixed(2) + ' ₽/км' : '0 ₽/км');
        set('fuel-total-liters', totalLiters.toFixed(1) + ' л');
        set('fuel-total-mileage', (maxM - minM).toFixed(0) + ' км');
        set('fuel-total-spent', fmtMoney(totalSpent));
        set('fuel-total-logs', logs.length);
    }

    function updateFuelChart() {
        const canvas = document.getElementById('fuel-consumption-chart');
        const emptyMsg = document.getElementById('fuel-chart-empty');
        if (!canvas) return;

        const vId = getVId();
        const logsFor = fuelLogs.filter(log => (log.vehicleId || 'default') === vId);
        const logs = calculateFuelConsumption(logsFor)
            .filter(l => l.consumption !== null)
            .sort((a, b) => (parseDate(a.date) || 0) - (parseDate(b.date) || 0));

        if (logs.length < 2) {
            canvas.style.display = 'none';
            if (emptyMsg) emptyMsg.style.display = 'block';
            if (fuelChartInstance) { fuelChartInstance.destroy(); fuelChartInstance = null; }
            return;
        }

        canvas.style.display = 'block';
        if (emptyMsg) emptyMsg.style.display = 'none';

        const labels = logs.map(l => {
            const d = parseDate(l.date);
            return d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : l.date;
        });
        const data = logs.map(l => l.consumption);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;

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

    // ============================================
    // 12. МОДАЛКА
    // ============================================
    function openFuelModal() {
    const overlay = document.getElementById('fuel-modal-overlay');
    if (!overlay) return;

    // ✅ 1. Чистим шапку от возможных дубликатов иконок (защита от старого HTML)
    const header = overlay.querySelector('.fuel-modal-header');
    if ( header ) {
        // Удаляем все "голые" иконки, которые не обёрнуты в плашку
        const directIcons = header.querySelectorAll(':scope > ion-icon');
        directIcons.forEach(icon => icon.remove());
        
        // Гарантируем наличие оранжевой плашки в заголовке (если её вдруг нет)
        if (!header.querySelector('.fuel-icon-badge')) {
            const titleEl = header.querySelector('h3') || header;
            const badge = document.createElement('span');
            badge.className = 'fuel-icon-badge fuel-icon-orange';
            badge.innerHTML = '<ion-icon name="flame-outline"></ion-icon>';
            titleEl.insertBefore(badge, titleEl.firstChild);
        }
    }

    // ✅ 2. Оборачиваем иконки в label в цветные плашки (только если ещё не обёрнуты)
    const labels = overlay.querySelectorAll('.fuel-modal-body .form-group label');
    labels.forEach(label => {
        if (label.dataset.badged === '1') return; // Уже обработано
        
        const icon = label.querySelector(':scope > ion-icon');
        if (!icon) return;

        const name = icon.getAttribute('name') || '';
        const text = (label.textContent || '').trim().toLowerCase();
        
        let colorClass = 'fuel-icon-blue';
        let iconName = name;

        if (text.includes('автомобиль') || name.includes('car')) {
            colorClass = 'fuel-icon-blue'; iconName = 'car-outline';
        } else if (text.includes('дата')) {
            colorClass = 'fuel-icon-blue'; iconName = 'calendar-outline';
        } else if (text.includes('пробег')) {
            colorClass = 'fuel-icon-orange'; iconName = 'speedometer-outline';
        } else if (text.includes('литр') && !text.includes('цена')) {
            colorClass = 'fuel-icon-cyan'; iconName = 'water-outline';
        } else if (text.includes('сумма') || text.includes('руб')) {
            colorClass = 'fuel-icon-green'; iconName = 'cash-outline';
        } else if (text.includes('цена за литр')) {
            colorClass = 'fuel-icon-purple'; iconName = 'pricetag-outline';
        } else if (text.includes('комментарий') || text.includes('примечание')) {
            colorClass = 'fuel-icon-teal'; iconName = 'chatbubble-outline';
        }

        const badge = document.createElement('span');
        badge.className = 'fuel-icon-badge ' + colorClass;
        badge.innerHTML = '<ion-icon name="' + iconName + '"></ion-icon>';
        
        icon.replaceWith(badge);
        label.dataset.badged = '1';
    });

    // ✅ 3. Открываем модалку
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    populateVehicleSelect();
    
    setTimeout(() => {
        const dateEl = document.getElementById('fuel-date');
        if (dateEl && !dateEl.value) {
            dateEl.valueAsDate = new Date();
        }
    }, 100);
}

    function closeFuelModal() {
        const overlay = document.getElementById('fuel-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('visible');
        document.body.style.overflow = '';
        setTimeout(() => clearFuelForm(), 300);
    }

    document.addEventListener('click', function (e) {
        const overlay = document.getElementById('fuel-modal-overlay');
        if (overlay && e.target === overlay) closeFuelModal();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const overlay = document.getElementById('fuel-modal-overlay');
        if (overlay && overlay.classList.contains('visible')) closeFuelModal();
    });

    // ============================================
    // 13. СИНК С records (БЕЗ ЗАПРОСОВ В FIREBASE)
    // ============================================
    async function syncFuelToRecords() {
        const records = (typeof window.records !== 'undefined' && Array.isArray(window.records))
            ? window.records
            : null;
        if (!records) return 0;

        // ⭐ ГЛАВНЫЙ ФИКС: используем массив из памяти, а не делаем db.get()
        if (fuelLogs.length === 0) return 0;

        // Группируем по дате
        const fuelByDate = {};
        fuelLogs.forEach(log => {
            if (!log.date) return;
            if (!fuelByDate[log.date]) fuelByDate[log.date] = { totalAmount: 0, totalLiters: 0, count: 0, details: [] };
            fuelByDate[log.date].totalAmount += log.amount || 0;
            fuelByDate[log.date].totalLiters += log.liters || 0;
            fuelByDate[log.date].count += 1;
            const vId = log.vehicleId || 'default';
            const vObj = getAllVehicles().find(v => v.id === vId) || { name: 'Автомобиль', plate: '' };
            fuelByDate[log.date].details.push({
                amount: log.amount,
                liters: log.liters,
                mileage: log.mileage,
                comment: log.comment || '',
                vehicleId: vId,
                vehicleName: vObj.name,
                plate: vObj.plate
            });
        });

        let updated = 0;
        records.forEach(record => {
            if (!record.date) return;
            const data = fuelByDate[record.date];
            const oldCost = record.fuelCost || 0;
            const isLinked = record.fuelDetails || (record.fuelLogCount > 0);

            if (data) {
                if (data.totalAmount !== oldCost || !record.fuelDetails) {
                    record.fuelCost = data.totalAmount;
                    record.fuelDetails = data.details;
                    record.fuelLiters = data.totalLiters;
                    record.fuelLogCount = data.count;
                    record.totalExpenses = typeof window.calcExpenses === 'function'
                        ? window.calcExpenses(record)
                        : (record.fuelCost || 0) + (record.repairCost || 0) + (record.tax || 0);
                    const inc = typeof window.calcIncome === 'function'
                        ? window.calcIncome(record)
                        : (record.totalIncome || 0);
                    record.netProfit = inc - record.totalExpenses;
                    updated++;
                }
            } else if (isLinked) {
                record.fuelCost = 0;
                record.fuelDetails = [];
                record.fuelLiters = 0;
                record.fuelLogCount = 0;
                record.totalExpenses = typeof window.calcExpenses === 'function'
                    ? window.calcExpenses(record)
                    : (record.repairCost || 0) + (record.tax || 0);
                const inc = typeof window.calcIncome === 'function'
                    ? window.calcIncome(record)
                    : (record.totalIncome || 0);
                record.netProfit = inc - record.totalExpenses;
                updated++;
            }
        });

        if (updated > 0) {
            if (typeof window.saveData === 'function') window.saveData();
            if (typeof window.renderTable === 'function') window.renderTable();
            if (typeof window.updateAnalytics === 'function') window.updateAnalytics();
        }
        return updated;
    }

    // ============================================
    // 14. РЕАКЦИЯ НА СМЕНУ АВТО
    // ============================================
    window.addEventListener('vehicleChanged', function (e) {
        console.log('🚗 fuel-module: смена авто →', e.detail ? e.detail.vehicleId : '?');
        populateVehicleSelect();
        renderFuelLogs();
        updateFuelStats();
        updateFuelChart();
    });

    // ============================================
    // 15. ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function init() {
        const form = document.getElementById('fuel-form');
        if (form) form.addEventListener('submit', handleFuelSubmit);

        setupAmountCalculator();

        ['fuel-liters', 'fuel-mileage', 'fuel-amount'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', updateFuelFormCalculations);
            el.addEventListener('change', updateFuelFormCalculations);
        });

        const dateEl = document.getElementById('fuel-date');
        if (dateEl) dateEl.valueAsDate = new Date();

        populateVehicleSelect();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // ============================================
    // ТУЛТИП ТОПЛИВА
    // ============================================
    (function() {
        function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
        
        function buildFuelTooltipHTML(anchor) {
            let details = [];
            try {
                const raw = anchor.getAttribute('data-fuel-details') || '[]';
                details = JSON.parse(raw.replace(/&apos;/g, "'"));
            } catch (e) { details = []; }
            
            const liters = num(anchor.getAttribute('data-fuel-liters'));
            const count = num(anchor.getAttribute('data-fuel-count')) || details.length;
            const total = num(anchor.getAttribute('data-fuel-total'));
            
            const itemsHTML = details.map(d => {
                let name = d.vehicleName || d.vehicle || d.name;
                if (!name && d.vehicleId && typeof window.getVehicleNameById === 'function') {
                    name = window.getVehicleNameById(d.vehicleId);
                }
                if (!name) name = 'Заправка';
                const plate = d.plate ? ` (${d.plate})` : '';
                const lit = num(d.liters !== undefined ? d.liters : d.l);
                const mile = num(d.mileage !== undefined ? d.mileage : (d.odometer !== undefined ? d.odometer : d.km));
                const amount = num(d.amount !== undefined ? d.amount : (d.cost !== undefined ? d.cost : (d.sum !== undefined ? d.sum : d.price)));
                const comment = d.comment || d.note || '';
                return `
                    <div class="fuel-tooltip-detail-item">
                        <div class="detail-info">
                            <div style="font-weight:600;color:var(--ios-accent);">${name}${plate}</div>
                            ${(lit || mile) ? `<div class="detail-liters">⛽ ${lit ? lit.toFixed(2) + ' л' : ''}${lit && mile ? ' · ' : ''}${mile ? mile.toLocaleString('ru-RU') + ' км' : ''}</div>` : ''}
                            ${comment ? `<div class="detail-comment">${comment}</div>` : ''}
                        </div>
                        <div class="detail-amount">${fmtMoney(amount)}</div>
                    </div>`;
            }).join('');
            
            return `
                <div class="fuel-tooltip-header">
                    <ion-icon name="fuel-outline"></ion-icon>
                    <h4>Подробности заправок</h4>
                </div>
                <div class="fuel-tooltip-summary">
                    <div class="fuel-tooltip-summary-item"><div class="label">Заправок</div><div class="value">${count}</div></div>
                    <div class="fuel-tooltip-summary-item"><div class="label">Литров</div><div class="value">${liters ? liters.toFixed(1) : '—'}</div></div>
                    <div class="fuel-tooltip-summary-item"><div class="label">Сумма</div><div class="value">${fmtMoney(total)}</div></div>
                </div>
                <div class="fuel-tooltip-details">${itemsHTML || '<div style="padding:10px;text-align:center;color:var(--ios-text-tertiary);font-size:13px;">Нет деталей</div>'}</div>
                <div class="fuel-tooltip-hint">Тапните вне окна, чтобы закрыть</div>`;
        }
        
        function openFuelTooltip(anchor) {
            if (typeof window.__tooltipShow !== 'function') return;
            window.__tooltipShow(buildFuelTooltipHTML(anchor), anchor, 'fuel-tooltip');
        }
        
        document.addEventListener('click', function(e) {
            const anchor = e.target.closest('td.fuel-cell-with-details, .rcd-fuel');
            if (!anchor) return;
            e.preventDefault();
            e.stopPropagation();
            if (document.getElementById('card-tooltip')) {
                if (typeof window.__tooltipClose === 'function') window.__tooltipClose();
                return;
            }
            openFuelTooltip(anchor);
        });
        
        window.openFuelTooltip = openFuelTooltip;
    })();

    // ============================================
    // 16. ЭКСПОРТ
    // ============================================
    Object.defineProperty(window, 'fuelLogs', {
        get: function () { return fuelLogs; },
        configurable: true
    });

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

    console.log('✅ fuel-module.js v7.0 (Firebase-экономный) загружен');
})();