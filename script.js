let records = [];
let tariffs = [];
let incomeChart = null;
let expensesChart = null;
let comparisonChart = null;
let editingId = null;
const DEFAULT_TARIFF = { pickup: 60, delivery: 81, km: 11, weight: 2 };



// ===== ФИЛЬТРЫ =====
let activeFilters = {};
let filterState = {
    date: { type: 'month', values: [] },
    weekday: { type: 'checkbox', values: [] },
    type: { type: 'checkbox', values: [] },
    hours: { type: 'range', min: '', max: '' },
    pickup: { type: 'range', min: '', max: '' },
    delivery: { type: 'range', min: '', max: '' },
    income: { type: 'range', min: '', max: '' },
    expenses: { type: 'range', min: '', max: '' },
    profit: { type: 'range', min: '', max: '' }
};

let currentFilterColumn = null; // Текущая открытая колонка фильтра

// ===== ФУНКЦИИ ФИЛЬТРАЦИИ =====
function toggleFilter(column) {
    const filterRow = document.getElementById('filter-row');
    if (!filterRow) return;
    
    // Если панель закрыта — открываем и показываем фильтр этой колонки
    if (filterRow.style.display === 'none' || filterRow.style.display === '') {
        filterRow.style.display = 'table-row';
        currentFilterColumn = column;
        showFilterForColumn(column);
    } 
    // Если панель открыта и клик по той же колонке — закрываем
    else if (currentFilterColumn === column) {
        filterRow.style.display = 'none';
        currentFilterColumn = null;
    } 
    // Если панель открыта и клик по другой колонке — переключаем фильтр
    else {
        currentFilterColumn = column;
        showFilterForColumn(column);
    }
}

// Показывает фильтр только для указанной колонки, остальные скрывает
function showFilterForColumn(column) {
    const columns = ['date', 'weekday', 'type', 'hours', 'pickup', 'delivery', 'income', 'expenses', 'profit'];
    columns.forEach(col => {
        const cell = document.getElementById('filter-' + col);
        if (cell) {
            if (col === column) {
                cell.style.display = 'table-cell';
                renderFilter(col);
            } else {
                cell.style.display = 'none';                cell.innerHTML = '';
            }
        }
    });
}

function renderFilter(column) {
    const container = document.getElementById('filter-' + column);
    if (!container) return;
    
    container.innerHTML = '';
    // ВАЖНО: останавливаем всплытие клика, чтобы панель не закрывалась
    container.onclick = (e) => e.stopPropagation();
    
    if (column === 'date') {
        const months = getUniqueMonths();
        const select = document.createElement('select');
        select.innerHTML = '<option value="">Все месяцы</option>';
        months.forEach(m => {
            const option = document.createElement('option');
            option.value = m.value;
            option.textContent = m.label;
            if (filterState.date.values.includes(m.value)) option.selected = true;
            select.appendChild(option);
        });
        // Останавливаем всплытие
        select.onclick = (e) => e.stopPropagation();
        select.onchange = (e) => {
            if (e.target.value) {
                filterState.date.values = [e.target.value];
            } else {
                filterState.date.values = [];
            }
            renderTable();
        };
        container.appendChild(select);
    }
    else if (column === 'weekday') {
        const days = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
        // Останавливаем всплытие на контейнере
        wrapper.onclick = (e) => e.stopPropagation();
        
        days.forEach(day => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;font-size:11px;cursor:pointer;';
            // Останавливаем всплытие на каждом label
            label.onclick = (e) => e.stopPropagation();
                        const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = day;
            checkbox.checked = filterState.weekday.values.includes(day);
            // Останавливаем всплытие на чекбоксе
            checkbox.onclick = (e) => e.stopPropagation();
            checkbox.onchange = updateWeekdayFilter;
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(day.slice(0, 3)));
            wrapper.appendChild(label);
        });
        container.appendChild(wrapper);
    }
    else if (column === 'type') {
    const types = [
        { value: 'work', label: '📅 Работа' },
        { value: 'bonus', label: '🎁 Бонус' },
        { value: 'expense', label: '💸 Расход' }
    ];
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    wrapper.onclick = (e) => e.stopPropagation();
    
    types.forEach(t => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;';
        label.onclick = (e) => e.stopPropagation();
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = t.value;
        checkbox.checked = filterState.type.values.includes(t.value);
        checkbox.onclick = (e) => e.stopPropagation();
        checkbox.onchange = () => {
            if (checkbox.checked) {
                if (!filterState.type.values.includes(t.value)) {
                    filterState.type.values.push(t.value);
                }
            } else {
                filterState.type.values = filterState.type.values.filter(v => v !== t.value);
            }
            console.log('🔍 Фильтр по типу:', filterState.type.values);
            renderTable();
        };
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(t.label));
        wrapper.appendChild(label);
    });
    
    // Добавляем кнопку "Выбрать все"
    const selectAll = document.createElement('button');
    selectAll.textContent = 'Выбрать все';
    selectAll.style.cssText = 'margin-top:8px;padding:4px 8px;font-size:11px;cursor:pointer;';
    selectAll.onclick = (e) => {
        e.stopPropagation();
        filterState.type.values = ['work', 'bonus', 'expense'];
        wrapper.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        renderTable();
    };
    wrapper.appendChild(selectAll);
    
    container.appendChild(wrapper);
}
    else if (['hours','pickup','delivery','income','expenses','profit'].includes(column)) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;gap:4px;align-items:center;';
        wrapper.onclick = (e) => e.stopPropagation();
        
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.placeholder = 'От';        minInput.value = filterState[column].min;
        minInput.style.cssText = 'width:50px;font-size:11px;padding:2px;';
        minInput.onclick = (e) => e.stopPropagation();
        minInput.onchange = (e) => {
            filterState[column].min = e.target.value;
            renderTable();
        };
        
        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.placeholder = 'До';
        maxInput.value = filterState[column].max;
        maxInput.style.cssText = 'width:50px;font-size:11px;padding:2px;';
        maxInput.onclick = (e) => e.stopPropagation();
        maxInput.onchange = (e) => {
            filterState[column].max = e.target.value;
            renderTable();
        };
        
        wrapper.appendChild(minInput);
        wrapper.appendChild(document.createTextNode('-'));
        wrapper.appendChild(maxInput);
        container.appendChild(wrapper);
    }
}

// Оставь только ПЕРВУЮ версию updateWeekdayFilter (строка ~260):
function updateWeekdayFilter(e) {
    if (e) e.stopPropagation();
    const checkboxes = document.querySelectorAll('#filter-weekday input[type="checkbox"]');
    filterState.weekday.values = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    renderTable();
}

// Оставь только ПЕРВУЮ версию updateTypeFilter (строка ~266):
function updateTypeFilter(e) {
    if (e) e.stopPropagation();
    const checkboxes = document.querySelectorAll('#filter-type input[type="checkbox"]');
    filterState.type.values = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    renderTable();
}

// Оставь только ПЕРВУЮ версию getUniqueMonths (строка ~272):
function getUniqueMonths() {
    const monthsMap = new Map();
    records.forEach(r => {
        if (!r.date) return;
        const d = new Date(r.date);
        const monthKey = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        const monthLabel = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][d.getMonth()] + ' ' + d.getFullYear();
        if (!monthsMap.has(monthKey)) {
            monthsMap.set(monthKey, { value: monthKey, label: monthLabel });
        }
    });
    return Array.from(monthsMap.values()).sort((a,b) => b.value.localeCompare(a.value));
}

// Оставь только ПЕРВУЮ версию clearAllFilters (строка ~284):
function clearAllFilters() {
    filterState = {
        date: { type: 'month', values: [] },
        weekday: { type: 'checkbox', values: [] },
        type: { type: 'checkbox', values: [] },
        hours: { type: 'range', min: '', max: '' },
        pickup: { type: 'range', min: '', max: '' },
        delivery: { type: 'range', min: '', max: '' },
        income: { type: 'range', min: '', max: '' },
        expenses: { type: 'range', min: '', max: '' },
        profit: { type: 'range', min: '', max: '' }
    };
    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        filterRow.style.display = 'none';
        const cells = filterRow.querySelectorAll('td');
        cells.forEach(cell => {
            if (cell.id && cell.id.startsWith('filter-')) {
                cell.innerHTML = '';
            }
        });
    }
    currentFilterColumn = null;
    renderTable();
}

// Оставь только ПЕРВУЮ версию applyFilters (строка ~298):
function applyFilters(data) {
    return data.filter(r => {
        if (filterState.date.values.length > 0) {
            const recordMonth = r.date ? r.date.substring(0, 7) : '';
            if (!filterState.date.values.includes(recordMonth)) return false;
        }
        
        if (filterState.weekday.values.length > 0) {
            const recordWeekday = r.weekday ? 
                r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase() : '';
            if (!filterState.weekday.values.includes(recordWeekday)) return false;
        }
        
        if (filterState.type.values.length > 0) {
            if (!filterState.type.values.includes(r.recordType)) return false;
        }
        
        const ranges = [
            { field: 'hours', value: r.hours || 0 },
            { field: 'pickup', value: r.ordersPickup || 0 },
            { field: 'delivery', value: r.ordersDelivery || 0 },
            { field: 'income', value: r.totalIncome || 0 },
            { field: 'expenses', value: r.totalExpenses || 0 },
            { field: 'profit', value: r.netProfit || 0 }
        ];
        
        for (const range of ranges) {
            const filter = filterState[range.field];
            if (filter.min !== '' && range.value < parseFloat(filter.min)) return false;
            if (filter.max !== '' && range.value > parseFloat(filter.max)) return false;
        }
        
        return true;
    });
}

function clearAllFilters() {
    filterState = {
        date: { type: 'month', values: [] },
        weekday: { type: 'checkbox', values: [] },
        type: { type: 'checkbox', values: [] },
        hours: { type: 'range', min: '', max: '' },        pickup: { type: 'range', min: '', max: '' },
        delivery: { type: 'range', min: '', max: '' },
        income: { type: 'range', min: '', max: '' },
        expenses: { type: 'range', min: '', max: '' },
        profit: { type: 'range', min: '', max: '' }
    };
    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        filterRow.style.display = 'none';
        // Очищаем все ячейки фильтров
        const cells = filterRow.querySelectorAll('td');
        cells.forEach(cell => {
            if (cell.id && cell.id.startsWith('filter-')) {
                cell.innerHTML = '';
            }
        });
    }
    currentFilterColumn = null;
    renderTable();
}




// ===== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК =====
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) targetTab.classList.add('active');
    const activeBtn = document.querySelector('.nav-btn[data-tab="' + tabName + '"]');
    if (activeBtn) activeBtn.classList.add('active');
    if (tabName === 'analytics') {
        updateAnalytics();
        initComparisonSelectors();
        updateComparison();
    }
    if (tabName === 'history') renderTable();
    if (tabName === 'tariffs') renderTariffs();
}

// ===== СБРОС ДАННЫХ (только localStorage, Firebase не трогаем!) =====
async function resetAllData() {
    if (!confirm('⚠️ Вы уверены? Локальные данные будут очищены.\n\nДанные в Firebase будут сохранены.')) return;
    
    // Очищаем ТОЛЬКО localStorage
    localStorage.removeItem('driverRecords');
    localStorage.removeItem('driverTariffs');
    
    records = [];
    tariffs = [];
    
    alert('✅ Локальные данные очищены! Данные в Firebase сохранены.\nПриложение перезагрузится и загрузит данные из Firebase.');
    location.reload();
}
// ===== НОРМАЛИЗАЦИЯ ДАННЫХ =====
function normalizeRecord(r) {
    // Исправляем recordType если он некорректный
    let recordType = r.recordType;
    if (!recordType || recordType === '' || recordType === 'undefined') {
        // Если есть bonusPay или bonusPeriod - это бонус, иначе работа
        recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
    }
    
    return {
        ...r,
        date: typeof r.date === 'string' ? r.date.trim() : r.date,
        weekday: typeof r.weekday === 'string' ? 
            (r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase()) : r.weekday,
        recordType: recordType,
        totalIncome: calcIncome(r),
        totalExpenses: calcExpenses(r),
        netProfit: calcIncome(r) - calcExpenses(r)
    };
}

function normalizeTariff(t) {
    return {
        ...t,
        date: typeof t.date === 'string' ? t.date.trim() : t.date,
        pickup: t.pickup || 0,
        delivery: t.delivery || 0,
        km: t.km || 0,
        weight: t.weight || 0
    };
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    
    // Исправляем все некорректные recordType
    let fixed = false;
    records = records.map(r => {
        if (!r.recordType || r.recordType === '' || r.recordType === 'undefined') {
            fixed = true;
            r.recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
        }
        return normalizeRecord(r);
    });
    
    if (fixed) {
        console.log('✅ Исправлены некорректные recordType');
        saveData();
    }
    
    document.getElementById('date').addEventListener('change', onDateChange);
    document.getElementById('daily-form').addEventListener('submit', saveRecord);
    document.getElementById('tariff-form').addEventListener('submit', saveTariff);
    document.getElementById('date').valueAsDate = new Date();
    onDateChange();
    populateFilters();
    renderTable();
    renderTariffs();
    updateAnalytics();
    addFormValidation();
});

// ===== ВАЛИДАЦИЯ ФОРМЫ =====
function addFormValidation() {
    const numericFields = ['hours', 'orders-pickup', 'orders-delivery', 'distance', 'weight',
        'pay-pickup', 'pay-delivery', 'pay-distance', 'pay-weight',
        'load-pay', 'rating', 'tips', 'fuel-cost', 'repair-cost', 'tax'];
    numericFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', function() {
                if (this.value && parseFloat(this.value) < 0) {
                    this.value = 0;
                }            });
        }
    });
}

// ===== ЗАГРУЗКА ДАННЫХ =====
async function loadData() {
    try {
        console.log('🔄 Загрузка данных...');
        const savedRecords = localStorage.getItem('driverRecords');
        const savedTariffs = localStorage.getItem('driverTariffs');
        
        if (savedRecords && typeof db !== 'undefined') {
            const recordsSnapshot = await db.collection('records').get();
            if (!recordsSnapshot.empty) {
                records = recordsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return normalizeRecord({ id: doc.id, ...data });
                });
                console.log('✅ Загружено из Firebase:', records.length);
            } else if (typeof initialData !== 'undefined') {
                for (const r of initialData) { 
                    const normalized = normalizeRecord({ ...r });
                    delete normalized.id;
                    const docRef = await db.collection('records').add(normalized);
                    records.push(normalizeRecord({ id: docRef.id, ...normalized }));
                }
                console.log('✅ Загружено из data.js:', records.length);
            }
        } else if (savedRecords) {
            records = JSON.parse(savedRecords).map(normalizeRecord);
        } else if (typeof initialData !== 'undefined') {
            records = initialData.map(r => normalizeRecord({
                id: Date.now() + Math.random(),
                ...r
            }));
        }        
        
        if (savedTariffs && typeof db !== 'undefined') {
            const tariffsSnapshot = await db.collection('tariffs').get();
            if (!tariffsSnapshot.empty) {
                tariffs = tariffsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return normalizeTariff({ id: doc.id, ...data });
                });
                console.log('✅ Загружено тарифов:', tariffs.length);
            } else if (typeof initialTariffs !== 'undefined') {
                for (const t of initialTariffs) {
                    const normalized = normalizeTariff({ ...t });
                    delete normalized.id;                    const docRef = await db.collection('tariffs').add(normalized);
                    tariffs.push(normalizeTariff({ id: docRef.id, ...normalized }));
                }
            }
        } else if (savedTariffs) {
            tariffs = JSON.parse(savedTariffs).map(normalizeTariff);
        } else if (typeof initialTariffs !== 'undefined') {
            tariffs = initialTariffs.map(t => normalizeTariff({ id: Date.now() + Math.random(), ...t }));
        }
        
        saveData();
        console.log('✅ Все данные загружены!');
    } catch (error) {
        console.error('❌ Ошибка загрузки:', error);
        const savedRecords = localStorage.getItem('driverRecords');
        const savedTariffs = localStorage.getItem('driverTariffs');
        if (savedRecords) {
            records = JSON.parse(savedRecords).map(normalizeRecord);
        }
        if (savedTariffs) {
            tariffs = JSON.parse(savedTariffs).map(normalizeTariff);
        }
    }
}

function saveData() {
    localStorage.setItem('driverRecords', JSON.stringify(records));
    localStorage.setItem('driverTariffs', JSON.stringify(tariffs));
}

async function saveRecordToFirebase(record) {
    try {
        if (!record.id || !records.find(r => r.id === record.id)) {
            const recordToSave = { ...record };
            delete recordToSave.id;
            const docRef = await db.collection('records').add(recordToSave);
            record.id = docRef.id;
        } else {
            const recordToSave = { ...record };
            delete recordToSave.id;
            await db.collection('records').doc(record.id).set(recordToSave);
        }
        console.log('✅ Запись сохранена в Firebase');
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
    }
}

async function deleteRecordFromFirebase(id) {
    try {        await db.collection('records').doc(id).delete();
        console.log('✅ Запись удалена из Firebase');
    } catch (error) {
        console.error('❌ Ошибка удаления:', error);
    }
}

function getTariffForDate(dateStr) {
    if (!tariffs || tariffs.length === 0) {
        return DEFAULT_TARIFF;
    }
    if (!dateStr) {
        const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
        return sorted[0];
    }
    const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const t of sorted) {
        if (t.date <= dateStr) return t;
    }
    return sorted[sorted.length - 1];
}

function getCurrentTariff() {
    const today = new Date().toISOString().split('T')[0];
    return getTariffForDate(today);
}

function updateTariffDisplay() {
    const dateVal = document.getElementById('date').value;
    const tariff = getTariffForDate(dateVal);
    document.getElementById('tariff-date-display').textContent = dateVal || 'сегодня';
    if (tariff) {
        document.getElementById('t-pickup').textContent = tariff.pickup;
        document.getElementById('t-delivery').textContent = tariff.delivery;
        document.getElementById('t-km').textContent = tariff.km;
        document.getElementById('t-weight').textContent = tariff.weight;
    }
}

function autoCalc(type) {
    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) return;
    let qtyField, priceField, rate;
    switch(type) {
        case 'pickup':
            qtyField = 'orders-pickup';
            priceField = 'pay-pickup';
            rate = tariff.pickup;
            break;
        case 'delivery':            qtyField = 'orders-delivery';
            priceField = 'pay-delivery';
            rate = tariff.delivery;
            break;
        case 'km':
            qtyField = 'distance';
            priceField = 'pay-distance';
            rate = tariff.km;
            break;
        case 'weight':
            qtyField = 'weight';
            priceField = 'pay-weight';
            rate = tariff.weight;
            break;
    }
    const qtyValue = document.getElementById(qtyField).value;
    if (!qtyValue || qtyValue === '') {
        document.getElementById(priceField).value = '';
        return;
    }
    const qty = parseFloat(qtyValue);
    if (isNaN(qty) || qty <= 0) {
        document.getElementById(priceField).value = '';
        return;
    }
    const calculated = Math.round(qty * rate * 100) / 100;
    document.getElementById(priceField).value = calculated;
}

function recalcCurrentByTariff() {
    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) {
        alert('❌ Тариф для этой даты не найден');
        return;
    }
    const pickup = parseFloat(document.getElementById('orders-pickup').value) || 0;
    const delivery = parseFloat(document.getElementById('orders-delivery').value) || 0;
    const km = parseFloat(document.getElementById('distance').value) || 0;
    const weight = parseFloat(document.getElementById('weight').value) || 0;
    if (pickup > 0) document.getElementById('pay-pickup').value = Math.round(pickup * tariff.pickup * 100) / 100;
    if (delivery > 0) document.getElementById('pay-delivery').value = Math.round(delivery * tariff.delivery * 100) / 100;
    if (km > 0) document.getElementById('pay-distance').value = Math.round(km * tariff.km * 100) / 100;
    if (weight > 0) document.getElementById('pay-weight').value = Math.round(weight * tariff.weight * 100) / 100;
    alert('✅ Пересчитано по тарифу на ' + document.getElementById('date').value);
}

function cancelEdit() {
    if (!confirm('Отменить редактирование? Все изменения будут потеряны.')) return;
    editingId = null;
    document.getElementById('editing-notice').style.display = 'none';    clearForm();
}

function onDateChange() {
    updateWeekday();
    updateTariffDisplay();
}

function updateWeekday() {
    const val = document.getElementById('date').value;
    if (val) {
        const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
        document.getElementById('weekday').value = days[new Date(val).getDay()];
    }
}

function calcIncome(r) {
    return (r.payPickup || 0) + (r.payDelivery || 0) + (r.payDistance || 0) +
        (r.payWeight || 0) + (r.loadPay || 0) + (r.bonusPay || 0) +  // ДОБАВИТЬ bonusPay
        (r.rating || 0) + (r.tips || 0);
}

function calcExpenses(r) {
    return (r.fuelCost || 0) + (r.repairCost || 0) + (r.tax || 0);
}

async function saveRecord(e) {
    e.preventDefault();
    const recordType = document.getElementById('record-type').value;
    const record = {
        id: editingId || Date.now().toString(),
        date: document.getElementById('date').value,
        weekday: document.getElementById('weekday').value.charAt(0).toUpperCase() + 
             document.getElementById('weekday').value.slice(1).toLowerCase(),
        hours: parseFloat(document.getElementById('hours').value) || 0,
        ordersPickup: parseInt(document.getElementById('orders-pickup').value) || 0,
        payPickup: parseFloat(document.getElementById('pay-pickup').value) || 0,
        ordersDelivery: parseInt(document.getElementById('orders-delivery').value) || 0,
        payDelivery: parseFloat(document.getElementById('pay-delivery').value) || 0,
        distance: parseFloat(document.getElementById('distance').value) || 0,
        payDistance: parseFloat(document.getElementById('pay-distance').value) || 0,
        weight: parseFloat(document.getElementById('weight').value) || 0,
        payWeight: parseFloat(document.getElementById('pay-weight').value) || 0,
        loadPay: parseFloat(document.getElementById('load-pay').value) || 0,
        bonusPay: parseFloat(document.getElementById('bonus-pay').value) || 0,
        rating: parseFloat(document.getElementById('rating').value) || 0,
        tips: parseFloat(document.getElementById('tips').value) || 0,
        fuelCost: parseFloat(document.getElementById('fuel-cost').value) || 0,
        repairCost: parseFloat(document.getElementById('repair-cost').value) || 0,
        tax: parseFloat(document.getElementById('tax').value) || 0,
        recordType: recordType,
        bonusPeriod: document.getElementById('bonus-period').value || ''
    };    const normalizedRecord = normalizeRecord(record);
    if (editingId) {
        const idx = records.findIndex(r => r.id === editingId);
        if (idx >= 0) {
            records[idx] = normalizedRecord;
        }
        editingId = null;
        document.getElementById('editing-notice').style.display = 'none';
    } else {
        const idx = records.findIndex(r => r.date === record.date && r.recordType === record.recordType);
        if (idx >= 0) {
            if (confirm('Запись за эту дату с таким типом уже существует. Перезаписать?')) {
                records[idx] = normalizedRecord;
            } else return;
        } else { 
            records.push(normalizedRecord);
        }
    }
    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (typeof db !== 'undefined') {
        await saveRecordToFirebase(normalizedRecord);
    }
    saveData();
    alert('✅ Сохранено! Доход: ' + formatMoney(normalizedRecord.totalIncome));
    clearForm();
    renderTable();
    populateFilters();
}

function clearForm() {
    document.getElementById('daily-form').reset();
    document.getElementById('date').valueAsDate = new Date();
    document.getElementById('record-type').value = 'work';
    document.getElementById('bonus-period').value = '';
    editingId = null;
    document.getElementById('editing-notice').style.display = 'none';
    onDateChange();
}

async function saveTariff(e) {
    e.preventDefault();
    const tariff = normalizeTariff({
        id: Date.now().toString(),
        date: document.getElementById('tariff-date').value,
        pickup: parseFloat(document.getElementById('tariff-pickup').value) || 0,
        delivery: parseFloat(document.getElementById('tariff-delivery').value) || 0,
        km: parseFloat(document.getElementById('tariff-km').value) || 0,
        weight: parseFloat(document.getElementById('tariff-weight').value) || 0
    });
    const idx = tariffs.findIndex(t => t.date === tariff.date);    if (idx >= 0) {
        if (confirm('Тариф на эту дату уже существует. Заменить?')) {
            tariffs[idx] = tariff;
        } else return;
    } else {
        tariffs.push(tariff);
    }
    tariffs.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (typeof db !== 'undefined') {
        try {
            const tariffToSave = { ...tariff };
            delete tariffToSave.id;
            const docRef = await db.collection('tariffs').add(tariffToSave);
            const idx = tariffs.findIndex(t => t.date === tariff.date);
            if (idx >= 0) tariffs[idx].id = docRef.id;
            console.log('✅ Тариф сохранён в Firebase');
        } catch (error) {
            console.error('❌ Ошибка сохранения тарифа:', error);
        }
    }
    saveData();
    alert('✅ Тариф сохранен!');
    document.getElementById('tariff-form').reset();
    renderTariffs();
    updateTariffDisplay();
}

async function deleteTariff(id) {
    if (tariffs.length <= 1) {
        alert('Нельзя удалить последний тариф!');
        return;
    }
    if (!confirm('Удалить этот тариф?')) return;
    if (typeof db !== 'undefined') {
        try {
            await db.collection('tariffs').doc(id).delete();
            console.log('✅ Тариф удалён из Firebase');
        } catch (error) {
            console.error('❌ Ошибка удаления тарифа:', error);
        }
    }
    tariffs = tariffs.filter(t => t.id !== id);
    saveData();
    renderTariffs();
    updateTariffDisplay();
}



function recalculateAllTariffs() {
    if (records.length === 0) {
        alert('Нет записей для пересчёта');        return;
    }
    if (!confirm('⚠️ Пересчитать ВСЕ записи по актуальным тарифам на их даты?')) {
        return;
    }
    let changedCount = 0;
    records = records.map(r => {
        const tariff = getTariffForDate(r.date);
        if (!tariff) return r;
        const newPayPickup = Math.round((r.ordersPickup || 0) * tariff.pickup * 100) / 100;
        const newPayDelivery = Math.round((r.ordersDelivery || 0) * tariff.delivery * 100) / 100;
        const newPayDistance = Math.round((r.distance || 0) * tariff.km * 100) / 100;
        const newPayWeight = Math.round((r.weight || 0) * tariff.weight * 100) / 100;
        if (newPayPickup !== r.payPickup || newPayDelivery !== r.payDelivery ||
            newPayDistance !== r.payDistance || newPayWeight !== r.payWeight) {
            changedCount++;
        }
        return normalizeRecord({
            ...r,
            payPickup: newPayPickup,
            payDelivery: newPayDelivery,
            payDistance: newPayDistance,
            payWeight: newPayWeight
        });
    });
    saveData();
    renderTable();
    updateAnalytics();
    alert('✅ Пересчитано записей: ' + changedCount + ' из ' + records.length);
}

function renderTariffs() {
    const list = document.getElementById('tariffs-list');
    list.innerHTML = '';
    const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
    const currentTariff = getCurrentTariff();
    sorted.forEach(t => {
        const isCurrent = currentTariff && t.id === currentTariff.id;
        const div = document.createElement('div');
        div.className = 'tariff-item' + (isCurrent ? ' current' : '');
        div.innerHTML = `
            <div class="tariff-date">
                📅 ${formatDate(t.date)}
                ${isCurrent ? '<span style="color:#10b981;font-weight:bold"> (действует)</span>' : ''}
            </div>
            <div class="tariff-values">
                <span>📦 ${t.pickup} ₽/шт</span>
                <span>📤 ${t.delivery} ₽/шт</span>
                <span>🛣️ ${t.km} ₽/км</span>
                <span>⚖️ ${t.weight} ₽/кг</span>            </div>
            <div class="tariff-actions">
                <button class="btn btn-danger" onclick="deleteTariff('${t.id}')">🗑️ Удалить</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateAnalytics() {
    const month = document.getElementById('filter-month').value;
    const year = document.getElementById('filter-year').value;
    let filtered = [...records];
    if (month) filtered = filtered.filter(r => (new Date(r.date).getMonth()+1).toString().padStart(2,'0') === month);
    if (year) filtered = filtered.filter(r => new Date(r.date).getFullYear().toString() === year);
    const uniqueDates = new Set();
    filtered.forEach(r => {
        if (r.hours > 0 || r.recordType === 'work') {
            uniqueDates.add(r.date);
        }
    });
    const s = {
        totalIncome: filtered.reduce((sum, r) => sum + (r.totalIncome || 0), 0),
        totalFuel: filtered.reduce((sum, r) => sum + (r.fuelCost || 0), 0),
        totalRepair: filtered.reduce((sum, r) => sum + (r.repairCost || 0), 0),
        totalTax: filtered.reduce((sum, r) => sum + (r.tax || 0), 0),
        totalExpenses: filtered.reduce((sum, r) => sum + (r.totalExpenses || 0), 0),
        netProfit: filtered.reduce((sum, r) => sum + (r.netProfit || 0), 0),
        totalHours: filtered.reduce((sum, r) => sum + (r.hours || 0), 0),
        totalOrders: filtered.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0),
        totalDistance: filtered.reduce((sum, r) => sum + (r.distance || 0), 0),
        workingDays: uniqueDates.size
    };
    const avgIncomePerDay = s.workingDays > 0 ? s.totalIncome / s.workingDays : 0;
    const avgNetProfitPerDay = s.workingDays > 0 ? s.netProfit / s.workingDays : 0;
    const avgPerHour = s.totalHours > 0 ? s.netProfit / s.totalHours : 0;
    const avgCheck = s.totalOrders > 0 ? s.totalIncome / s.totalOrders : 0;
    const ordersPerHour = s.totalHours > 0 ? s.totalOrders / s.totalHours : 0;
    const efficiencyPercent = s.totalIncome > 0 ? (s.netProfit / s.totalIncome) * 100 : 0;
    const setEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setEl('total-income', formatMoney(s.totalIncome));
    setEl('avg-income-per-day', formatMoney(avgIncomePerDay));
    setEl('total-fuel', formatMoney(s.totalFuel));
    setEl('total-repair', formatMoney(s.totalRepair));
    setEl('total-tax', formatMoney(s.totalTax));
    setEl('total-expenses', formatMoney(s.totalExpenses));
    setEl('net-profit', formatMoney(s.netProfit));    setEl('avg-net-profit-per-day', formatMoney(avgNetProfitPerDay));
    setEl('total-hours', s.totalHours.toFixed(0));
    setEl('total-orders', s.totalOrders);
    setEl('total-distance', s.totalDistance.toFixed(2));
    setEl('working-days', s.workingDays);
    setEl('avg-per-hour', formatMoney(avgPerHour));
    setEl('avg-check', formatMoney(avgCheck));
    setEl('orders-per-hour', ordersPerHour.toFixed(2));
    setEl('efficiency-percent', efficiencyPercent.toFixed(2) + '%');
    updateCharts(filtered);
}

function updateCharts(filteredRecords) {
    if (!filteredRecords || filteredRecords.length === 0) {
        if (incomeChart) { incomeChart.destroy(); incomeChart = null; }
        if (expensesChart) { expensesChart.destroy(); expensesChart = null; }
        return;
    }
    const sorted = [...filteredRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    const labels = sorted.map(r => { 
        const d = new Date(r.date); 
        return d.getDate() + '.' + (d.getMonth()+1); 
    });
    const canvas1 = document.getElementById('income-chart');
    const canvas2 = document.getElementById('expenses-chart');
    if (canvas1) {
        const ctx1 = canvas1.getContext('2d');
        if (incomeChart) incomeChart.destroy();
        incomeChart = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Доход', data: sorted.map(r => r.totalIncome || 0), backgroundColor: 'rgba(16,185,129,0.7)' },
                    { label: 'Прибыль', data: sorted.map(r => r.netProfit || 0), backgroundColor: 'rgba(102,126,234,0.7)' }
                ]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
    }
    if (canvas2) {
        const ctx2 = canvas2.getContext('2d');
        if (expensesChart) expensesChart.destroy();
        const fuel = sorted.reduce((sum, r) => sum + (r.fuelCost || 0), 0);
        const repair = sorted.reduce((sum, r) => sum + (r.repairCost || 0), 0);
        const tax = sorted.reduce((sum, r) => sum + (r.tax || 0), 0);
        if (fuel === 0 && repair === 0 && tax === 0) return;
        expensesChart = new Chart(ctx2, {
            type: 'doughnut',
            data: {                labels: ['Бензин', 'Ремонт', 'Налог'],
                datasets: [{ data: [fuel, repair, tax], backgroundColor: ['#ef4444','#f59e0b','#8b5cf6'] }]
            },
            options: { responsive: true }
        });
    }
}

function initComparisonSelectors() {
    const months = new Set(), years = new Set();
    records.forEach(r => {
        const d = new Date(r.date);
        months.add((d.getMonth()+1).toString().padStart(2,'0'));
        years.add(d.getFullYear());
    });
    const names = ['','Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');
    if (!c1m || !c1y || !c2m || !c2y) return;
    [c1m, c2m].forEach(select => {
        select.innerHTML = '<option value="">Весь год</option>';
        [...months].sort().forEach(m => {
            const o = document.createElement('option');
            o.value = m;
            o.textContent = names[+m];
            select.appendChild(o);
        });
    });
    [c1y, c2y].forEach(select => {
        select.innerHTML = '';
        [...years].sort().forEach(y => {
            const o = document.createElement('option');
            o.value = y;
            o.textContent = y;
            select.appendChild(o);
        });
    });
    if (years.size > 0) {
        const sortedYears = [...years].sort((a,b) => b - a);
        c1y.value = sortedYears[0];
        c2y.value = sortedYears[0];
    }
}

function getPeriodStats(month, year) {
    let filtered = [...records];
    if (year) {        filtered = filtered.filter(r => new Date(r.date).getFullYear().toString() === year);
    }
    if (month) {
        filtered = filtered.filter(r => (new Date(r.date).getMonth()+1).toString().padStart(2,'0') === month);
    }
    const uniqueDates = new Set();
    filtered.forEach(r => {
        if (r.hours > 0 || r.recordType === 'work') {
            uniqueDates.add(r.date);
        }
    });
    return {
        totalIncome: filtered.reduce((sum, r) => sum + (r.totalIncome || 0), 0),
        totalExpenses: filtered.reduce((sum, r) => sum + (r.totalExpenses || 0), 0),
        netProfit: filtered.reduce((sum, r) => sum + (r.netProfit || 0), 0),
        totalHours: filtered.reduce((sum, r) => sum + (r.hours || 0), 0),
        totalOrders: filtered.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0),
        totalDistance: filtered.reduce((sum, r) => sum + (r.distance || 0), 0),
        workingDays: uniqueDates.size,
        recordsCount: filtered.length
    };
}

function formatPeriodName(month, year) {
    const names = ['','Январь','Февраль','Март','Апрель','Май','Июнь',
        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    if (month && year) {
        return `${names[+month]} ${year}`;
    } else if (year) {
        return `${year} год`;
    }
    return 'Все данные';
}

function calcDiff(val1, val2) {
    if (val2 === 0) {
        return { diff: val1, percent: val1 !== 0 ? 100 : 0 };
    }
    const diff = val1 - val2;
    const percent = (diff / Math.abs(val2)) * 100;
    return { diff, percent };
}

function formatDiff(val1, val2, isMoney = true) {
    const diff = val1 - val2;
    const percent = val2 !== 0 ? (diff / Math.abs(val2)) * 100 : 0;
    const diffStr = isMoney ? formatMoney(Math.abs(diff)) : Math.abs(diff).toFixed(1);
    const percentStr = isFinite(percent) ? ` (${Math.abs(percent).toFixed(1)}%)` : '';
    if (diff > 0) {
        return `<span class="diff-positive">↑ +${diffStr}${percentStr}</span>`;    } else if (diff < 0) {
        return `<span class="diff-negative">↓ ${diffStr}${percentStr}</span>`;
    } else {
        return `<span class="diff-neutral">→ ${diffStr}${percentStr}</span>`;
    }
}

function updateComparison() {
    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');
    if (!c1m || !c1y || !c2m || !c2y) return;
    const month1 = c1m.value;
    const year1 = c1y.value;
    const month2 = c2m.value;
    const year2 = c2y.value;
    const s1 = getPeriodStats(month1, year1);
    const s2 = getPeriodStats(month2, year2);
    const name1 = formatPeriodName(month1, year1);
    const name2 = formatPeriodName(month2, year2);
    const results = document.getElementById('comparison-results');
    if (!results) return;
    if (s1.recordsCount === 0 && s2.recordsCount === 0) {
        results.innerHTML = '<p class="comparison-hint">Нет данных для выбранных периодов</p>';
        return;
    }
    const avgPerHour1 = s1.totalHours > 0 ? s1.netProfit / s1.totalHours : 0;
    const avgPerHour2 = s2.totalHours > 0 ? s2.netProfit / s2.totalHours : 0;
    const avgCheck1 = s1.totalOrders > 0 ? s1.totalIncome / s1.totalOrders : 0;
    const avgCheck2 = s2.totalOrders > 0 ? s2.totalIncome / s2.totalOrders : 0;
    const ordersPerHour1 = s1.totalHours > 0 ? s1.totalOrders / s1.totalHours : 0;
    const ordersPerHour2 = s2.totalHours > 0 ? s2.totalOrders / s2.totalHours : 0;
    const efficiency1 = s1.totalIncome > 0 ? (s1.netProfit / s1.totalIncome) * 100 : 0;
    const efficiency2 = s2.totalIncome > 0 ? (s2.netProfit / s2.totalIncome) * 100 : 0;
    const incomePerDay1 = s1.workingDays > 0 ? s1.totalIncome / s1.workingDays : 0;
    const incomePerDay2 = s2.workingDays > 0 ? s2.totalIncome / s2.workingDays : 0;
    const profitPerDay1 = s1.workingDays > 0 ? s1.netProfit / s1.workingDays : 0;
    const profitPerDay2 = s2.workingDays > 0 ? s2.netProfit / s2.workingDays : 0;
    let html = `
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Показатель</th>
                    <th>📅 ${name1}</th>
                    <th>📅 ${name2}</th>
                    <th>Разница</th>
                </tr>
            </thead>
            <tbody>                <tr>
                    <td class="metric-name">💰 Общий доход</td>
                    <td>${formatMoney(s1.totalIncome)}</td>
                    <td>${formatMoney(s2.totalIncome)}</td>
                    <td>${formatDiff(s1.totalIncome, s2.totalIncome)}</td>
                </tr>
                <tr>
                    <td class="metric-name">💰 Доход в день</td>
                    <td>${formatMoney(incomePerDay1)}</td>
                    <td>${formatMoney(incomePerDay2)}</td>
                    <td>${formatDiff(incomePerDay1, incomePerDay2)}</td>
                </tr>
                <tr>
                    <td class="metric-name">📉 Всего расходов</td>
                    <td>${formatMoney(s1.totalExpenses)}</td>
                    <td>${formatMoney(s2.totalExpenses)}</td>
                    <td>${formatDiff(s1.totalExpenses, s2.totalExpenses)}</td>
                </tr>
                <tr>
                    <td class="metric-name">✅ Чистая прибыль</td>
                    <td>${formatMoney(s1.netProfit)}</td>
                    <td>${formatMoney(s2.netProfit)}</td>
                    <td>${formatDiff(s1.netProfit, s2.netProfit)}</td>
                </tr>
                <tr>
                    <td class="metric-name">✅ Прибыль в день</td>
                    <td>${formatMoney(profitPerDay1)}</td>
                    <td>${formatMoney(profitPerDay2)}</td>
                    <td>${formatDiff(profitPerDay1, profitPerDay2)}</td>
                </tr>
                <tr>
                    <td class="metric-name">⏱️ Часов</td>
                    <td>${s1.totalHours.toFixed(1)}</td>
                    <td>${s2.totalHours.toFixed(1)}</td>
                    <td>${formatDiff(s1.totalHours, s2.totalHours, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name">📦 Заказов</td>
                    <td>${s1.totalOrders}</td>
                    <td>${s2.totalOrders}</td>
                    <td>${formatDiff(s1.totalOrders, s2.totalOrders, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name">🛣️ Пройдено км</td>
                    <td>${s1.totalDistance.toFixed(1)}</td>
                    <td>${s2.totalDistance.toFixed(1)}</td>
                    <td>${formatDiff(s1.totalDistance, s2.totalDistance, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name">📅 Рабочих дней</td>                    <td>${s1.workingDays}</td>
                    <td>${s2.workingDays}</td>
                    <td>${formatDiff(s1.workingDays, s2.workingDays, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name">💵 Средний ₽/час</td>
                    <td>${formatMoney(avgPerHour1)}</td>
                    <td>${formatMoney(avgPerHour2)}</td>
                    <td>${formatDiff(avgPerHour1, avgPerHour2)}</td>
                </tr>
                <tr>
                    <td class="metric-name">📦 Средний чек</td>
                    <td>${formatMoney(avgCheck1)}</td>
                    <td>${formatMoney(avgCheck2)}</td>
                    <td>${formatDiff(avgCheck1, avgCheck2)}</td>
                </tr>
                <tr>
                    <td class="metric-name">📦⏱️ Заказов в час</td>
                    <td>${ordersPerHour1.toFixed(2)}</td>
                    <td>${ordersPerHour2.toFixed(2)}</td>
                    <td>${formatDiff(ordersPerHour1, ordersPerHour2, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name">📊 Эффективность</td>
                    <td>${efficiency1.toFixed(1)}%</td>
                    <td>${efficiency2.toFixed(1)}%</td>
                    <td>${formatDiff(efficiency1, efficiency2, false)}</td>
                </tr>
            </tbody>
        </table>
    
    
    `;
    const profitDiff = calcDiff(s1.netProfit, s2.netProfit);
    const incomeDiff = calcDiff(s1.totalIncome, s2.totalIncome);
    const hoursDiff = calcDiff(s1.totalHours, s2.totalHours);
    const profitClass = profitDiff.diff > 0 ? 'positive' : (profitDiff.diff < 0 ? 'negative' : 'neutral');
    const incomeClass = incomeDiff.diff > 0 ? 'positive' : (incomeDiff.diff < 0 ? 'negative' : 'neutral');
    const hoursClass = hoursDiff.diff > 0 ? 'positive' : (hoursDiff.diff < 0 ? 'negative' : 'neutral');
    html += `
        <div class="comparison-summary">
            <div class="summary-card ${profitClass}">
                <h4>Итог по прибыли</h4>
                <div class="big-number">${profitDiff.diff > 0 ? '+' : ''}${formatMoney(profitDiff.diff)}</div>
                <div class="small-text">${profitDiff.diff > 0 ? 'Прибыль выше в' : profitDiff.diff < 0 ? 'Прибыль ниже, чем в' : 'Прибыль одинаковая'} ${name2}</div>
            </div>
            <div class="summary-card ${incomeClass}">
                <h4>Итог по доходу</h4>
                <div class="big-number">${incomeDiff.diff > 0 ? '+' : ''}${formatMoney(incomeDiff.diff)}</div>
                <div class="small-text">${isFinite(incomeDiff.percent) ? (incomeDiff.percent > 0 ? '+' : '') + incomeDiff.percent.toFixed(1) + '%' : '—'}</div>
            </div>
            <div class="summary-card ${hoursClass}">                <h4>Отработано часов</h4>
                <div class="big-number">${hoursDiff.diff > 0 ? '+' : ''}${hoursDiff.diff.toFixed(1)} ч</div>
                <div class="small-text">${name1}: ${s1.totalHours.toFixed(1)} ч vs ${name2}: ${s2.totalHours.toFixed(1)} ч</div>
            </div>
        </div>
    `;
    // Разделяем таблицу и карточки
const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
const summaryMatch = html.match(/<div class="comparison-summary"[\s\S]*$/);

if (tableMatch) {
    // Оборачиваем таблицу в прокручиваемый контейнер
    let newHtml = '<div class="table-scroll-container">' + tableMatch[0] + '</div>';
    if (summaryMatch) {
        newHtml += summaryMatch[0];
    }
    results.innerHTML = newHtml;
} else {
    results.innerHTML = html;
}
    updateComparisonChart(name1, name2, s1, s2);
}



function updateComparisonChart(name1, name2, s1, s2) {
    const canvas = document.getElementById('comparison-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (comparisonChart) comparisonChart.destroy();
    comparisonChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Доход', 'Расходы', 'Прибыль', 'Часы (x100)', 'Заказы (x10)'],
            datasets: [
                {
                    label: name1,
                    data: [
                        s1.totalIncome,
                        s1.totalExpenses,
                        s1.netProfit,
                        s1.totalHours * 100,
                        s1.totalOrders * 10
                    ],
                    backgroundColor: 'rgba(102, 126, 234, 0.7)',
                    borderColor: '#667eea',
                    borderWidth: 2
                },
                {
                    label: name2,
                    data: [
                        s2.totalIncome,
                        s2.totalExpenses,
                        s2.netProfit,
                        s2.totalHours * 100,
                        s2.totalOrders * 10
                    ],
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let val = context.raw;
                            const label = context.dataset.label;
                            if (context.dataIndex === 3) val = (val / 100).toFixed(1) + ' ч';
                            else if (context.dataIndex === 4) val = (val / 10).toFixed(0) + ' шт';
                            else val = formatMoney(val);
                            return `${label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function quickCompare(type) {
    const now = new Date();
    const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const currentYear = now.getFullYear().toString();
    if (type === 'month') {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        const prevMonth = (d.getMonth() + 1).toString().padStart(2, '0');
        const prevYear = d.getFullYear().toString();
        document.getElementById('compare1-month').value = currentMonth;
        document.getElementById('compare1-year').value = currentYear;
        document.getElementById('compare2-month').value = prevMonth;
        document.getElementById('compare2-year').value = prevYear;
    } else if (type === 'year') {
        document.getElementById('compare1-month').value = '';
        document.getElementById('compare1-year').value = currentYear;
        document.getElementById('compare2-month').value = '';
        document.getElementById('compare2-year').value = (parseInt(currentYear) - 1).toString();
    } else if (type === 'yoy') {
        document.getElementById('compare1-month').value = currentMonth;
        document.getElementById('compare1-year').value = currentYear;
        document.getElementById('compare2-month').value = currentMonth;
        document.getElementById('compare2-year').value = (parseInt(currentYear) - 1).toString();
    }
    updateComparison();
}

function populateFilters() {    const months = new Set(), years = new Set();
    records.forEach(r => {
        const d = new Date(r.date);
        months.add((d.getMonth()+1).toString().padStart(2,'0'));
        years.add(d.getFullYear());
    });
    const ms = document.getElementById('filter-month');
    const ys = document.getElementById('filter-year');
    const cm = ms.value, cy = ys.value;
    ms.innerHTML = '<option value="">Все месяцы</option>';
    ys.innerHTML = '<option value="">Все годы</option>';
    const names = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    [...months].sort().forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = names[+m]; ms.appendChild(o); });
    [...years].sort().forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y; ys.appendChild(o); });
    ms.value = cm; ys.value = cy;
}

function renderTable() {
    const tbody = document.getElementById('records-body');
    tbody.innerHTML = '';
    
    // Применяем фильтры
    let filteredRecords = [...records];
    filteredRecords = applyFilters(filteredRecords);
    
    // Сортируем
    filteredRecords.sort((a,b) => new Date(b.date) - new Date(a.date));
    
    filteredRecords.forEach(r => {
        const typeLabel = r.recordType === 'bonus' ? '🎁 Бонус' :
                         r.recordType === 'expense' ? '💸 Расход' : '📅 Работа';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${formatDate(r.date)}</td><td>${r.weekday || '-'}</td><td>${typeLabel}</td><td>${r.hours || '-'}</td><td>${r.ordersPickup || '-'}</td><td>${r.ordersDelivery || '-'}</td><td>${formatMoney(r.totalIncome)}</td><td>${formatMoney(r.totalExpenses)}</td><td style="color:${r.netProfit >= 0 ? '#10b981' : '#ef4444'};font-weight:bold">${formatMoney(r.netProfit)}</td><td><button class="btn btn-success" onclick="editRecord('${r.id}')">✏️</button><button class="btn btn-danger" onclick="deleteRecord('${r.id}')">🗑️</button></td>`;
        tbody.appendChild(tr);
    });
    
    // Обновляем счетчик отфильтрованных записей
let infoEl = document.getElementById('filter-info');
if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'filter-info';
    infoEl.style.cssText = 'padding:15px;background:#dbeafe;border-radius:8px;margin:10px 0;text-align:center;color:#1e40af;font-weight:600;';
    tbody.parentElement.appendChild(infoEl);
}

const count = filteredRecords.length;
const total = records.length;

if (count < total || count === 0) {
    infoEl.style.display = 'block';
    infoEl.textContent = `Показано ${count} из ${total} записей`;
} else {
    infoEl.style.display = 'none';
}
}

function editRecord(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    editingId = id;
    document.getElementById('date').value = r.date;
    updateWeekday();
    document.getElementById('hours').value = r.hours;
    document.getElementById('orders-pickup').value = r.ordersPickup;    document.getElementById('pay-pickup').value = r.payPickup;
    document.getElementById('orders-delivery').value = r.ordersDelivery;
    document.getElementById('pay-delivery').value = r.payDelivery;
    document.getElementById('distance').value = r.distance;
    document.getElementById('pay-distance').value = r.payDistance;
    document.getElementById('weight').value = r.weight;
    document.getElementById('pay-weight').value = r.payWeight;
    document.getElementById('load-pay').value = r.loadPay;
    document.getElementById('bonus-pay').value = r.bonusPay || '';
    document.getElementById('rating').value = r.rating;
    document.getElementById('tips').value = r.tips;
    document.getElementById('fuel-cost').value = r.fuelCost;
    document.getElementById('repair-cost').value = r.repairCost;
    document.getElementById('tax').value = r.tax;
    document.getElementById('record-type').value = r.recordType || 'work';
    document.getElementById('bonus-period').value = r.bonusPeriod || '';
    document.getElementById('editing-notice').style.display = 'block';
    switchTab('entry');
}

async function deleteRecord(id, confirmDelete = true) {
    if (confirmDelete && !confirm('Удалить запись?')) return;
    if (typeof db !== 'undefined') {
        await deleteRecordFromFirebase(id);
    }
    records = records.filter(r => r.id !== id);
    saveData();
    renderTable();
    populateFilters();
}

function exportData() {
    try {
        const data = { records, tariffs, exportDate: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `driver-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        alert('✅ Данные экспортированы!');
    } catch(err) {
        alert('❌ Ошибка при экспорте: ' + err.message);
    }
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const importBtn = e.target.previousElementSibling;
    const originalText = importBtn.textContent;
    importBtn.textContent = ' Загрузка...';
    importBtn.disabled = true;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (data.records) {
                records = data.records.map(normalizeRecord);
                if (data.tariffs) tariffs = data.tariffs.map(normalizeTariff);
                saveData();
                
                // Если есть Firebase - сохраняем туда новые данные
                if (typeof db !== 'undefined') {
                    await syncToFirebase();
                }
                
                renderTable();
                renderTariffs();
                populateFilters();
                updateAnalytics();
                alert('✅ Импортировано ' + records.length + ' записей');
            } else if (Array.isArray(data)) {
                records = data.map(normalizeRecord);
                saveData();
                
                if (typeof db !== 'undefined') {
                    await syncToFirebase();
                }
                
                renderTable();
                populateFilters();
                updateAnalytics();
                alert('✅ Импортировано ' + records.length + ' записей');
            }
        } catch(err) {
            alert('❌ Ошибка при импорте: ' + err.message);
        } finally {
            importBtn.textContent = originalText;
            importBtn.disabled = false;
            e.target.value = '';
        }
    };
    reader.onerror = () => {
        alert('❌ Ошибка при чтении файла');
        importBtn.textContent = originalText;
        importBtn.disabled = false;
        e.target.value = '';
    };
    reader.readAsText(file);
}

// Синхронизация данных с Firebase (полная замена)
async function syncToFirebase() {
    try {
        console.log('🔄 Синхронизация с Firebase...');
        
        // Удаляем все старые записи
        const oldRecords = await db.collection('records').get();
        const deletePromises1 = oldRecords.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises1);
        
        // Удаляем все старые тарифы
        const oldTariffs = await db.collection('tariffs').get();
        const deletePromises2 = oldTariffs.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises2);
        
        // Загружаем новые записи
        for (const r of records) {
            const recordToSave = { ...r };
            delete recordToSave.id;
            const docRef = await db.collection('records').add(recordToSave);
            r.id = docRef.id;
        }
        
        // Загружаем новые тарифы
        for (const t of tariffs) {
            const tariffToSave = { ...t };
            delete tariffToSave.id;
            const docRef = await db.collection('tariffs').add(tariffToSave);
            t.id = docRef.id;
        }
        
        console.log('✅ Данные синхронизированы с Firebase');
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
    }
}

function formatMoney(n) {
    return new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB', minimumFractionDigits: 2}).format(n);
}

function formatDate(s) {
    return new Date(s).toLocaleDateString('ru-RU');
}