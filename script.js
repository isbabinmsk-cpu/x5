// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (ДОЛЖНЫ БЫТЬ В САМОМ ВЕРХУ ФАЙЛА)
// ==========================================

// 1. Основные данные
let records = [];
let tariffs = [];
let fuelLogs = []; // Добавлено для модуля топлива

// 2. Переменные графиков
let incomeChart = null;
let expensesChart = null;
let comparisonChart = null;
let fuelChartInstance = null;

// 3. Состояния интерфейса
let editingId = null;
let editingFuelId = null;
let currentHistoryPage = 1;
const RECORDS_PER_PAGE = 20;
let showAllHistoryMode = false;

// 4. Состояние авто-расчета
let autoCalcState = {
    km: true,
    weight: true
};

// 5. СОСТОЯНИЕ ФИЛЬТРОВ И СОРТИРОВКИ (КРИТИЧЕСКИ ВАЖНО!)
let filterState = {
    date: { type: 'month', values: [] },
    weekday: { type: 'checkbox', values: [] },
    type: { type: 'checkbox', values: [] },
    hours: { type: 'range', min: '', max: '' },
    ordersPickup: { type: 'range', min: '', max: '' },
    payPickup: { type: 'range', min: '', max: '' },
    ordersDelivery: { type: 'range', min: '', max: '' },
    payDelivery: { type: 'range', min: '', max: '' },
    distance: { type: 'range', min: '', max: '' },
    payDistance: { type: 'range', min: '', max: '' },
    weight: { type: 'range', min: '', max: '' },
    payWeight: { type: 'range', min: '', max: '' },
    loadPay: { type: 'range', min: '', max: '' },
    bonusPay: { type: 'range', min: '', max: '' },
    rating: { type: 'range', min: '', max: '' },
    tips: { type: 'range', min: '', max: '' },
    fuelCost: { type: 'range', min: '', max: '' },
    repairCost: { type: 'range', min: '', max: '' },
    tax: { type: 'range', min: '', max: '' },
    totalIncome: { type: 'range', min: '', max: '' },
    totalExpenses: { type: 'range', min: '', max: '' },
    netProfit: { type: 'range', min: '', max: '' }
};

let sortState = { column: null, direction: null };
let currentFilterColumn = null;

// ============================================
// УНИВЕРСАЛЬНЫЙ ПЕРЕХВАТЧИК FIREBASE LISTENERS
// ============================================
window._fbListeners = [];
window._isLoggingOut = false;

(function patchOnSnapshot() {
    if (typeof db === 'undefined') return;
    const originalOnSnapshot = firebase.firestore.Query.prototype.onSnapshot;
    if (!originalOnSnapshot || originalOnSnapshot.__patched) return;

    firebase.firestore.Query.prototype.onSnapshot = function (...args) {
        const unsub = originalOnSnapshot.apply(this, args);
        window._fbListeners.push(unsub);
        return function (...uargs) {
            const idx = window._fbListeners.indexOf(unsub);
            if (idx !== -1) window._fbListeners.splice(idx, 1);
            return unsub.apply(this, uargs);
        };
    };
    firebase.firestore.Query.prototype.onSnapshot.__patched = true;
})();

// Перехватчик console.error для подавления permission-denied при выходе
const _origConsoleError = console.error;
console.error = function (...args) {
    if (window._isLoggingOut) {
        const msg = (args[0] && args[0].code) || (args.join && args.join(' ')) || '';
        if (msg === 'permission-denied' ||
            (typeof msg === 'string' && msg.includes('permission-denied')) ||
            (args[1] && args[1] && args[1].code === 'permission-denied')) {
            return;
        }
    }
    _origConsoleError.apply(console, args);
};

// ===== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПАРСИНГА ДАТ БЕЗ СМЕЩЕНИЯ ЧАСОВОГО ПОЯСА =====
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(dateStr);
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    return new Date(year, month, day);
}

// ===== УТИЛИТА: АВТОМАТИЧЕСКОЕ СЖАТИЕ ИЗОБРАЖЕНИЙ =====
async function compressImage(file, maxSizeMB = 1) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let canvas = document.createElement('canvas');
                let ctx = canvas.getContext('2d');

                let width = img.width;
                let height = img.height;
                const MAX_DIMENSION = 1200;

                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) {
                        height = Math.round(height * (MAX_DIMENSION / width));
                        width = MAX_DIMENSION;
                    } else {
                        width = Math.round(width * (MAX_DIMENSION / height));
                        height = MAX_DIMENSION;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                let quality = 0.85;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);

                while ((dataUrl.length * 0.75) > (maxSizeMB * 1024 * 1024) && quality > 0.1) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                if ((dataUrl.length * 0.75) > (maxSizeMB * 1024 * 1024)) {
                    canvas.width = Math.round(width / 2);
                    canvas.height = Math.round(height / 2);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                }

                console.log(`✅ Изображение сжато: ${(file.size / 1024 / 1024).toFixed(2)} МБ -> ${(dataUrl.length * 0.75 / 1024 / 1024).toFixed(2)} МБ`);
                resolve(dataUrl);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// ============================================
// ЗАГРУЗКА ДАННЫХ ПОЛЬЗОВАТЕЛЯ ИЗ FIREBASE
// ============================================
async function loadUserData() {
    if (!currentUser) return;

    const mainContainer = document.querySelector('.container');
    const bottomNav = document.querySelector('.bottom-nav');
    const authScreen = document.getElementById('auth-screen');
    const statusWrapper = document.getElementById('connection-status-wrapper');
    if (authScreen) authScreen.classList.add('hidden');
    if (mainContainer) mainContainer.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (statusWrapper) statusWrapper.style.display = 'flex';

    try {
        console.log('🔄 Параллельная загрузка данных пользователя...');

        const [recordsSnap, tariffsSnap, userDoc] = await Promise.all([
            db.collection('users').doc(currentUser.uid).collection('records').orderBy('date', 'desc').get(),
            db.collection('users').doc(currentUser.uid).collection('tariffs').orderBy('date', 'desc').get(),
            db.collection('users').doc(currentUser.uid).get()
        ]);

        records = recordsSnap.docs.map(doc => normalizeRecord({ id: doc.id, ...doc.data() }));
        console.log('✅ Загружено записей:', records.length);

        tariffs = tariffsSnap.docs.map(doc => normalizeTariff({ id: doc.id, ...doc.data() }));
        console.log('✅ Загружено тарифов:', tariffs.length);

        if (tariffs.length === 0) {
            const defaultTariff = {
                date: new Date().toISOString().split('T')[0],
                pickup: 60, delivery: 81, km: 11, weight: 2
            };
            const docRef = await db.collection('users').doc(currentUser.uid)
                .collection('tariffs').add(defaultTariff);
            tariffs.push(normalizeTariff({ id: docRef.id, ...defaultTariff }));
        }

        const userData = userDoc.exists ? userDoc.data() : {};

        if (userData.avatar) {
            try {
                localStorage.setItem(AVATAR_STORAGE_KEY, userData.avatar);
                loadProfileAvatar();
                console.log('✅ Аватар загружен из кэша Firestore');
            } catch (e) {
                console.warn('⚠️ Аватар слишком большой для localStorage');
            }
        }

        saveData();

        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();

        if (typeof window.updateHomeTab === 'function') {
            window.updateHomeTab();
        }
        if (typeof window.updateGoals === 'function') {
            window.updateGoals();
        }

        connectionMode = 'firebase';
        firebaseErrorReason = '';
        if (typeof window.renderUnifiedStatus === 'function') { window.renderUnifiedStatus(); }
        console.log('✅ Все данные успешно загружены!');

    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        console.log('🔄 Загружаем из localStorage...');
        await loadData();
        connectionMode = 'local';
        firebaseErrorReason = error.message || 'Ошибка загрузки данных';
        if (typeof window.renderUnifiedStatus === 'function') { window.renderUnifiedStatus(); }

        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();

        if (typeof window.updateHomeTab === 'function') {
            window.updateHomeTab();
        }
        if (typeof window.updateGoals === 'function') {
            window.updateGoals();
        }

        alert('⚠️ Ошибка загрузки: ' + error.message + '\nДанные взяты из локального кэша.');
    }
}

// ===== СОХРАНЕНИЕ СОСТОЯНИЯ =====
const STATE_KEY = 'appState';
let isRestoringState = false;

function saveState() {
    try {
        const activeBtn = document.querySelector('.nav-item.active');
        const state = {
            activeTab: activeBtn ? activeBtn.getAttribute('data-tab') : 'entry',
            filterMonth: document.getElementById('filter-month')?.value || '',
            filterYear: document.getElementById('filter-year')?.value || '',
            compare1Month: document.getElementById('compare1-month')?.value || '',
            compare1Year: document.getElementById('compare1-year')?.value || '',
            compare2Month: document.getElementById('compare2-month')?.value || '',
            compare2Year: document.getElementById('compare2-year')?.value || '',
            timestamp: Date.now()
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Ошибка сохранения:', e);
    }
}

function restoreState() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        if (!saved) return;

        const state = JSON.parse(saved);
        console.log('🔄 Восстановление состояния:', state);

        const filterMonth = document.getElementById('filter-month');
        const filterYear = document.getElementById('filter-year');
        if (filterMonth && state.filterMonth) filterMonth.value = state.filterMonth;
        if (filterYear && state.filterYear) filterYear.value = state.filterYear;

        const c1m = document.getElementById('compare1-month');
        const c1y = document.getElementById('compare1-year');
        const c2m = document.getElementById('compare2-month');
        const c2y = document.getElementById('compare2-year');
        if (c1m && state.compare1Month) c1m.value = state.compare1Month;
        if (c1y && state.compare1Year) c1y.value = state.compare1Year;
        if (c2m && state.compare2Month) c2m.value = state.compare2Month;
        if (c2y && state.compare2Year) c2y.value = state.compare2Year;

        if (state.activeTab && state.activeTab !== 'home' && state.activeTab !== 'entry') {
            setTimeout(() => {
                switchTab(state.activeTab);
            }, 100);
        }
    } catch (e) {
        console.error('❌ Ошибка восстановления:', e);
    }
}

// ==========================================
// НАДЕЖНАЯ СИСТЕМА ФИЛЬТРАЦИИ
// ==========================================
function toggleFilter(column) {
    const filterRow = document.getElementById('filter-row');
    if (!filterRow) { console.error('❌ Нет #filter-row'); return; }

    if (filterRow.style.display === 'none' || filterRow.style.display === '') {
        filterRow.style.display = 'table-row';
        currentFilterColumn = column;
        renderFilterUI(column);
    } else if (currentFilterColumn === column) {
        filterRow.style.display = 'none';
        currentFilterColumn = null;
    } else {
        currentFilterColumn = column;
        renderFilterUI(column);
    }
}

function renderFilterUI(column) {
    Object.keys(filterState).forEach(col => {
        const cell = document.getElementById('filter-' + col);
        if (cell) {
            if (col === column) {
                cell.style.display = 'table-cell';
                buildFilterControls(col, cell);
            } else {
                cell.style.display = 'none';
                cell.innerHTML = '';
            }
        }
    });
}

function buildFilterControls(column, container) {
    container.innerHTML = '';

    if (column === 'date') {
        const select = document.createElement('select');
        select.style.cssText = 'width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:6px;';
        select.innerHTML = '<option value="">Все месяцы</option>';

        const monthsMap = new Map();
        records.forEach(r => {
            if (!r.date) return;
            const d = parseLocalDate(r.date);
            if (!d) return;
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const label = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'][d.getMonth()] + ' ' + d.getFullYear();
            if (!monthsMap.has(key)) monthsMap.set(key, label);
        });

        Array.from(monthsMap.entries()).sort((a, b) => b[0].localeCompare(a[0])).forEach(([key, label]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            if (filterState.date.values.includes(key)) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', (e) => {
            filterState.date.values = e.target.value ? [e.target.value] : [];
            renderTable();
        });
        container.appendChild(select);
    }
    else if (column === 'weekday') {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
        ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'].forEach(day => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; font-size:11px; cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = day;
            cb.checked = filterState.weekday.values.includes(day);
            cb.addEventListener('change', () => {
                if (cb.checked) filterState.weekday.values.push(day);
                else filterState.weekday.values = filterState.weekday.values.filter(v => v !== day);
                renderTable();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + day.slice(0, 3)));
            wrapper.appendChild(label);
        });
        container.appendChild(wrapper);
    }
    else if (column === 'type') {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

        [
            { v: 'work', l: 'Работа', icon: 'calendar-outline', color: 'var(--ios-accent, #007AFF)' },
            { v: 'bonus', l: 'Бонус', icon: 'gift-outline', color: 'var(--ios-purple, #AF52DE)' },
            { v: 'expense', l: 'Расход', icon: 'remove-circle-outline', color: 'var(--ios-danger, #FF3B30)' }
        ].forEach(t => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px;';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = t.v;
            cb.checked = filterState.type.values.includes(t.v);
            cb.addEventListener('change', () => {
                if (cb.checked) { if (!filterState.type.values.includes(t.v)) filterState.type.values.push(t.v); }
                else { filterState.type.values = filterState.type.values.filter(v => v !== t.v); }
                renderTable();
            });

            label.appendChild(cb);

            const textWrapper = document.createElement('span');
            textWrapper.style.cssText = 'display:flex; align-items:center; gap:4px;';
            textWrapper.innerHTML = `<ion-icon name="${t.icon}" style="color: ${t.color}; font-size: 16px;"></ion-icon> ${t.l}`;

            label.appendChild(textWrapper);
            wrapper.appendChild(label);
        });
        container.appendChild(wrapper);
    }
    else if (filterState[column] && filterState[column].type === 'range') {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; flex-direction:column; gap:6px;';

        const inputsDiv = document.createElement('div');
        inputsDiv.style.cssText = 'display:flex; gap:4px; align-items:center;';

        const minInp = document.createElement('input');
        minInp.type = 'number'; minInp.placeholder = 'От';
        minInp.style.cssText = 'width:50%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:6px;';
        minInp.value = filterState[column].min;

        const maxInp = document.createElement('input');
        maxInp.type = 'number'; maxInp.placeholder = 'До';
        maxInp.style.cssText = 'width:50%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:6px;';
        maxInp.value = filterState[column].max;

        minInp.addEventListener('input', (e) => {
            filterState[column].min = e.target.value;
            renderTable();
        });
        maxInp.addEventListener('input', (e) => {
            filterState[column].max = e.target.value;
            renderTable();
        });

        inputsDiv.appendChild(minInp);
        inputsDiv.appendChild(maxInp);
        wrapper.appendChild(inputsDiv);
        container.appendChild(wrapper);
    }
}

function clearAllFilters() {
    Object.keys(filterState).forEach(key => {
        if (filterState[key].type === 'range') {
            filterState[key].min = '';
            filterState[key].max = '';
        } else {
            filterState[key].values = [];
        }
    });
    sortState = { column: null, direction: null };
    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        filterRow.style.display = 'none';
        filterRow.querySelectorAll('td').forEach(td => { if (td.id.startsWith('filter-')) td.innerHTML = ''; });
    }
    currentFilterColumn = null;
    renderTable();
}

function applyFilters(data) {
    return data.filter(r => {
        if (filterState.date.values.length > 0) {
            const recMonth = r.date ? r.date.substring(0, 7) : '';
            if (!filterState.date.values.includes(recMonth)) return false;
        }
        if (filterState.weekday.values.length > 0) {
            const recDay = r.weekday ? r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase() : '';
            if (!filterState.weekday.values.includes(recDay)) return false;
        }
        if (filterState.type.values.length > 0) {
            if (!filterState.type.values.includes(r.recordType)) return false;
        }
        for (const key of Object.keys(filterState)) {
            const f = filterState[key];
            if (f.type !== 'range') continue;
            if (f.min === '' && f.max === '') continue;

            let val = 0;
            const raw = r[key];
            if (raw !== undefined && raw !== null && raw !== '' && raw !== '-') {
                val = parseFloat(raw);
                if (isNaN(val)) val = 0;
            }

            if (f.min !== '' && !isNaN(parseFloat(f.min)) && val < parseFloat(f.min)) return false;
            if (f.max !== '' && !isNaN(parseFloat(f.max)) && val > parseFloat(f.max)) return false;
        }
        return true;
    });
}

function applySorting(data) {
    if (!sortState.column || !sortState.direction) return data;
    const field = sortState.column;
    if (data.length === 0 || !(field in data[0])) return data;

    return [...data].sort((a, b) => {
        const rawA = a[field];
        const valA = (rawA === undefined || rawA === null || rawA === '' || rawA === '-') ? 0 : parseFloat(rawA);
        const rawB = b[field];
        const valB = (rawB === undefined || rawB === null || rawB === '' || rawB === '-') ? 0 : parseFloat(rawB);
        return sortState.direction === 'asc' ? valA - valB : valB - valA;
    });
}

// ============================================
// ОТКРЫТИЕ И ЗАКРЫТИЕ НАСТРОЕК (МОДАЛКА)
// ============================================
window.openAppSettings = function () {
    const modal = document.getElementById('tab-settings');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('visible');
    });
};

window.closeAppSettings = function () {
    const modal = document.getElementById('tab-settings');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
};

document.addEventListener('click', function (e) {
    const modal = document.getElementById('tab-settings');
    if (modal && modal.classList.contains('visible') && e.target === modal) {
        closeAppSettings();
    }
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('tab-settings');
        if (modal && modal.classList.contains('visible')) {
            closeAppSettings();
        }
    }
});

// ===== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК =====
function switchTab(tabName) {
    if (tabName === 'settings') {
        openAppSettings();
        return;
    }

    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
    });

    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) {
        targetTab.classList.add('active');
    }

    const activeBtn = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    switch (tabName) {
        case 'analytics':
            updateAnalytics();
            initComparisonSelectors();
            updateComparison();
            break;
        case 'history':
            if (!window._historyInitialized) {
                initHistoryFilters();
                window._historyInitialized = true;
            }
            renderTable();
            break;
        case 'tariffs':
            renderTariffs();
            break;
        case 'home':
            setTimeout(function () {
                if (typeof window.updateHomeTab === 'function') {
                    window.updateHomeTab();
                }
            }, 50);
            break;
        case 'fuel':
            setTimeout(function () {
                if (typeof renderFuelLogs === 'function') renderFuelLogs();
                if (typeof updateFuelStats === 'function') updateFuelStats();
                if (typeof updateFuelChart === 'function') updateFuelChart();
            }, 50);
            break;
        case 'repair':
            setTimeout(function () {
                if (typeof renderRepairList === 'function') renderRepairList();
                if (typeof updateRepairStats === 'function') updateRepairStats();
                if (typeof updateRepairCharts === 'function') updateRepairCharts();
            }, 50);
            break;
        case 'shifts':
            setTimeout(function () {
                if (typeof window.renderShiftCalendar === 'function') window.renderShiftCalendar();
            }, 50);
            break;
        default:
            break;
    }

    saveState();
}

window.switchTab = switchTab;

// ===== СБРОС ДАННЫХ (только localStorage, Firebase не трогаем!) =====
async function resetAllData() {
    if (!confirm('⚠️ Вы уверены? Локальные данные будут очищены.\n\nДанные в Firebase будут сохранены.')) return;

    localStorage.removeItem('driverRecords');
    localStorage.removeItem('driverTariffs');

    records = [];
    tariffs = [];

    alert('✅ Локальные данные очищены! Данные в Firebase сохранены.\nПриложение перезагрузится и загрузит данные из Firebase.');
    location.reload();
}

// ===== НОРМАЛИЗАЦИЯ ДАННЫХ =====
function normalizeRecord(r) {
    let recordType = r.recordType;
    if (!recordType || recordType === '' || recordType === 'undefined') {
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

// ===== ВАЛИДАЦИЯ ФОРМЫ =====
function addFormValidation() {
    const numericFields = ['hours', 'orders-pickup', 'orders-delivery', 'distance', 'weight',
        'pay-pickup', 'pay-delivery', 'pay-distance', 'pay-weight',
        'load-pay', 'rating', 'tips', 'fuel-cost', 'repair-cost', 'tax'];
    numericFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', function () {
                if (this.value && parseFloat(this.value) < 0) {
                    this.value = 0;
                }
            });
        }
    });
}

// ===== ЗАГРУЗКА ДАННЫХ (ТОЛЬКО LOCALSTORAGE) =====
async function loadData() {
    try {
        console.log('🔄 Загрузка данных из localStorage...');
        const savedRecords = localStorage.getItem('driverRecords');
        const savedTariffs = localStorage.getItem('driverTariffs');

        if (savedRecords) {
            records = JSON.parse(savedRecords).map(normalizeRecord);
        }

        if (savedTariffs) {
            tariffs = JSON.parse(savedTariffs).map(normalizeTariff);
        }

        console.log('✅ Локальные данные загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки из localStorage:', error);
    }
}

// ===== СОХРАНЕНИЕ ДАННЫХ В LOCALSTORAGE =====
function saveData() {
    try {
        localStorage.setItem('driverRecords', JSON.stringify(records));
        localStorage.setItem('driverTariffs', JSON.stringify(tariffs));
    } catch (error) {
        console.error('❌ Ошибка сохранения в localStorage:', error);
    }
}

async function saveRecordToFirebase(record) {
    if (!currentUser) return;

    try {
        const recordToSave = { ...record };
        delete recordToSave.id;

        const userRecordsRef = db.collection('users')
            .doc(currentUser.uid)
            .collection('records');

        if (!record.id || !records.find(r => r.id === record.id)) {
            const docRef = await userRecordsRef.add(recordToSave);
            record.id = docRef.id;
        } else {
            await userRecordsRef.doc(record.id).set(recordToSave);
        }

        console.log('✅ Запись сохранена в Firebase');

        // ⭐ Обновляем время синхронизации
        if (typeof window.remindersMarkAsSynced === 'function') {
            window.remindersMarkAsSynced();
        }
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
    }
}

async function saveRecordsBatchToFirebase(recordsToUpdate) {
    if (!currentUser || !recordsToUpdate.length) return;
    try {
        const recordsRef = db.collection('users').doc(currentUser.uid).collection('records');
        const BATCH_SIZE = 400;

        for (let i = 0; i < recordsToUpdate.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = recordsToUpdate.slice(i, i + BATCH_SIZE);

            for (const r of chunk) {
                const recordToSave = { ...r };
                delete recordToSave.id;
                batch.set(recordsRef.doc(r.id), recordToSave);
            }

            await batch.commit();
        }

        console.log(`✅ Пакетно сохранено ${recordsToUpdate.length} записей в Firebase`);

        // ⭐ Обновляем время синхронизации
        if (typeof window.remindersMarkAsSynced === 'function') {
            window.remindersMarkAsSynced();
        }
    } catch (error) {
        console.error('❌ Ошибка пакетного сохранения:', error);
    }
}

async function deleteRecordFromFirebase(id) {
    if (!currentUser) return;

    try {
        await db.collection('users')
            .doc(currentUser.uid)
            .collection('records')
            .doc(id)
            .delete();

        console.log('✅ Запись удалена из Firebase');

        // ⭐ Обновляем время синхронизации
        if (typeof window.remindersMarkAsSynced === 'function') {
            window.remindersMarkAsSynced();
        }
    } catch (error) {
        console.error('❌ Ошибка удаления:', error);
    }
}

// ===== ТАРИФЫ =====
const DEFAULT_TARIFF = { pickup: 60, delivery: 81, km: 11, weight: 2 };

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
    if (type === 'km' && autoCalcState && autoCalcState.km === false) {
        return;
    }
    if (type === 'weight' && autoCalcState && autoCalcState.weight === false) {
        return;
    }

    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) return;
    let qtyField, priceField, rate;
    switch (type) {
        case 'pickup':
            qtyField = 'orders-pickup';
            priceField = 'pay-pickup';
            rate = tariff.pickup;
            break;
        case 'delivery':
            qtyField = 'orders-delivery';
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
    if (!editingId) {
        alert('⚠️ Эта функция работает только при редактировании существующей записи.');
        return;
    }

    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) {
        alert('❌ Тариф для этой даты не найден');
        return;
    }

    const pickup = parseFloat(document.getElementById('orders-pickup').value) || 0;
    const delivery = parseFloat(document.getElementById('orders-delivery').value) || 0;
    const km = parseFloat(document.getElementById('distance').value) || 0;
    const weight = parseFloat(document.getElementById('weight').value) || 0;

    const newPayPickup = pickup > 0 ? Math.round(pickup * tariff.pickup * 100) / 100 : 0;
    const newPayDelivery = delivery > 0 ? Math.round(delivery * tariff.delivery * 100) / 100 : 0;
    const newPayDistance = km > 0 ? Math.round(km * tariff.km * 100) / 100 : 0;
    const newPayWeight = weight > 0 ? Math.round(weight * tariff.weight * 100) / 100 : 0;

    document.getElementById('pay-pickup').value = newPayPickup;
    document.getElementById('pay-delivery').value = newPayDelivery;
    document.getElementById('pay-distance').value = newPayDistance;
    document.getElementById('pay-weight').value = newPayWeight;

    const recordIndex = records.findIndex(r => r.id === editingId);
    if (recordIndex !== -1) {
        records[recordIndex].payPickup = newPayPickup;
        records[recordIndex].payDelivery = newPayDelivery;
        records[recordIndex].payDistance = newPayDistance;
        records[recordIndex].payWeight = newPayWeight;

        records[recordIndex] = normalizeRecord(records[recordIndex]);

        saveData();
        if (typeof db !== 'undefined' && currentUser) {
            saveRecordToFirebase(records[recordIndex]);
        }

        renderTable();
    }

    alert('✅ Пересчитано и сохранено по тарифу на ' + document.getElementById('date').value);
}

function cancelEditSilent() {
    editingId = null;
    const editingNotice = document.getElementById('editing-notice');
    if (editingNotice) editingNotice.style.display = 'none';
}
window.cancelEditSilent = cancelEditSilent;

function onDateChange() {
    updateWeekday();
    updateTariffDisplay();
}

function updateWeekday() {
    const val = document.getElementById('date').value;
    if (val) {
        const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
        document.getElementById('weekday').value = days[new Date(val).getDay()];
    }
}

function calcIncome(r) {
    return (r.payPickup || 0) + (r.payDelivery || 0) + (r.payDistance || 0) +
        (r.payWeight || 0) + (r.loadPay || 0) + (r.bonusPay || 0) +
        (r.rating || 0) + (r.tips || 0);
}

function calcExpenses(r) {
    return (r.fuelCost || 0) + (r.repairCost || 0) + (r.tax || 0);
}

async function saveRecord(e) {
    if (e) e.preventDefault();

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
    };

    const normalizedRecord = normalizeRecord(record);

    const existingIdx = records.findIndex(r => r.date === record.date && r.id !== editingId);

    if (existingIdx >= 0) {
        if (!confirm('Запись за ' + formatDate(record.date) + ' уже существует. Перезаписать её?')) {
            return false;
        }

        normalizedRecord.id = records[existingIdx].id;
        records[existingIdx] = normalizedRecord;

        if (editingId) {
            const oldIdx = records.findIndex(r => r.id === editingId);
            if (oldIdx >= 0 && oldIdx !== existingIdx) {
                if (typeof deleteRecordFromFirebase === 'function') {
                    await deleteRecordFromFirebase(editingId);
                }
                records.splice(oldIdx, 1);
            }
        }
    } else {
        if (editingId) {
            const idx = records.findIndex(r => r.id === editingId);
            if (idx >= 0) {
                normalizedRecord.id = editingId;
                records[idx] = normalizedRecord;
            }
        } else {
            records.push(normalizedRecord);
        }
    }

    editingId = null;
    const en = document.getElementById('editing-notice');
    if (en) en.style.display = 'none';

    records.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (typeof db !== 'undefined' && typeof saveRecordToFirebase === 'function') {
        await saveRecordToFirebase(normalizedRecord);
    }

    saveData();

    let saveMsg = '✅ Сохранено!';
    if (normalizedRecord.recordType === 'expense') {
        saveMsg += '\nРасход: ' + formatMoney(normalizedRecord.totalExpenses);
    } else if (normalizedRecord.recordType === 'bonus') {
        saveMsg += '\nБонус: ' + formatMoney(normalizedRecord.bonusPay || 0);
    } else {
        saveMsg += '\nДоход: ' + formatMoney(normalizedRecord.totalIncome);
        if (normalizedRecord.totalExpenses > 0) {
            saveMsg += '\nРасход: ' + formatMoney(normalizedRecord.totalExpenses);
        }
        saveMsg += '\nПрибыль: ' + formatMoney(normalizedRecord.netProfit);
    }
    alert(saveMsg);

    if (typeof clearForm === 'function') clearForm();
    if (typeof renderTable === 'function') renderTable();
    if (typeof populateFilters === 'function') populateFilters();

    if (typeof window.updateHomeTab === 'function' &&
        document.getElementById('tab-home')?.classList.contains('active')) {
        window.updateHomeTab();
    }

    return true;
}
window.saveRecord = saveRecord;

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

    const idx = tariffs.findIndex(t => t.date === tariff.date);
    if (idx >= 0) {
        if (confirm('Тариф на эту дату уже существует. Заменить?')) {
            tariffs[idx] = tariff;
        } else return;
    } else {
        tariffs.push(tariff);
    }

    tariffs.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (currentUser) {
        try {
            const tariffToSave = { ...tariff };
            delete tariffToSave.id;

            const docRef = await db.collection('users')
                .doc(currentUser.uid)
                .collection('tariffs')
                .add(tariffToSave);

            const idx = tariffs.findIndex(t => t.date === tariff.date);
            if (idx >= 0) tariffs[idx].id = docRef.id;

            console.log('✅ Тариф сохранён в Firebase');

            // ⭐ Обновляем время синхронизации
            if (typeof window.remindersMarkAsSynced === 'function') {
                window.remindersMarkAsSynced();
            }
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

    if (currentUser) {
        try {
            await db.collection('users')
                .doc(currentUser.uid)
                .collection('tariffs')
                .doc(id)
                .delete();

            console.log('✅ Тариф удалён из Firebase');

            // ⭐ Обновляем время синхронизации
            if (typeof window.remindersMarkAsSynced === 'function') {
                window.remindersMarkAsSynced();
            }
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
        alert('Нет записей для пересчёта');
        return;
    }
    if (!confirm('⚠️ Пересчитать ВСЕ записи по актуальным тарифам на их даты?\n\nПоля, изменённые вручную, будут пропущены.')) {
        return;
    }

    let changedCount = 0;
    let skippedCount = 0;
    const recordsToUpdate = [];

    records = records.map(r => {
        const tariff = getTariffForDate(r.date);
        if (!tariff) return r;

        const manualEdits = r.manualEdits || [];

        const newPayPickup = manualEdits.includes('payPickup') ? r.payPickup : Math.round((r.ordersPickup || 0) * tariff.pickup * 100) / 100;
        const newPayDelivery = manualEdits.includes('payDelivery') ? r.payDelivery : Math.round((r.ordersDelivery || 0) * tariff.delivery * 100) / 100;
        const newPayDistance = manualEdits.includes('payDistance') ? r.payDistance : Math.round((r.distance || 0) * tariff.km * 100) / 100;
        const newPayWeight = manualEdits.includes('payWeight') ? r.payWeight : Math.round((r.weight || 0) * tariff.weight * 100) / 100;

        const hasChanges = newPayPickup !== r.payPickup ||
            newPayDelivery !== r.payDelivery ||
            newPayDistance !== r.payDistance ||
            newPayWeight !== r.payWeight;

        if (hasChanges) {
            changedCount++;
            const updatedRecord = normalizeRecord({
                ...r,
                payPickup: newPayPickup,
                payDelivery: newPayDelivery,
                payDistance: newPayDistance,
                payWeight: newPayWeight
            });
            recordsToUpdate.push(updatedRecord);
            return updatedRecord;
        } else {
            skippedCount++;
            return r;
        }
    });

    saveData();

    if (currentUser && recordsToUpdate.length > 0) {
        saveRecordsBatchToFirebase(recordsToUpdate);
    }

    renderTable();
    updateAnalytics();

    const manualSkipped = records.filter(r => (r.manualEdits || []).length > 0).length;
    alert(`✅ Пересчитано: ${changedCount}\n⚠️ Пропущено (без изменений): ${skippedCount}\n⚠️ Пропущено (ручные правки): ${manualSkipped}`);
}

function renderTariffs() {
    const list = document.getElementById('tariffs-list');
    if (!list) return;
    list.innerHTML = '';
    const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
    const currentTariff = getCurrentTariff();
    sorted.forEach(t => {
        const isCurrent = currentTariff && t.id === currentTariff.id;
        const div = document.createElement('div');
        div.className = 'tariff-item' + (isCurrent ? ' current' : '');
        div.innerHTML = `
            <div class="tariff-date">
                <ion-icon name="calendar-outline" style="font-size: 24px; vertical-align: middle; margin-right: 6px; color: var(--ios-accent);"></ion-icon>
                ${formatDate(t.date)}
                ${isCurrent ? '<span style="color:#10b981;font-weight:bold"> (действует)</span>' : ''}
            </div>
            <div class="tariff-values">
                <span><ion-icon name="arrow-down-circle-outline" class="tariff-icon pickup-icon"></ion-icon> ${t.pickup} ₽/шт</span>
                <span><ion-icon name="arrow-up-circle-outline" class="tariff-icon delivery-icon"></ion-icon> ${t.delivery} ₽/шт</span>
                <span><ion-icon name="navigate-outline" class="tariff-icon km-icon"></ion-icon> ${t.km} ₽/км</span>
                <span><ion-icon name="scale-outline" class="tariff-icon weight-icon"></ion-icon> ${t.weight} ₽/кг</span>
            </div>
            <div class="tariff-actions">
                <button class="btn btn-danger" onclick="deleteTariff('${t.id}')">
                    <ion-icon name="trash-outline" style="font-size: 20px; vertical-align: middle; margin-right: 6px;"></ion-icon>
                    Удалить
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateAnalytics() {
    const month = document.getElementById('filter-month').value;
    const year = document.getElementById('filter-year').value;
    let filtered = [...records];

    if (month) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && (d.getMonth() + 1).toString().padStart(2, '0') === month;
        });
    }

    if (year) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d.getFullYear().toString() === year;
        });
    }

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
    setEl('net-profit', formatMoney(s.netProfit));
    setEl('avg-net-profit-per-day', formatMoney(avgNetProfitPerDay));
    setEl('total-hours', s.totalHours.toFixed(0));
    setEl('total-orders', s.totalOrders);
    setEl('total-distance', s.totalDistance.toFixed(2));
    setEl('working-days', s.workingDays);
    setEl('avg-per-hour', formatMoney(avgPerHour));
    setEl('avg-check', formatMoney(avgCheck));
    setEl('orders-per-hour', ordersPerHour.toFixed(2));
    setEl('efficiency-percent', efficiencyPercent.toFixed(2) + '%');

    updateCharts(filtered);

    saveState();
}

function updateCharts(filteredRecords) {
    if (!filteredRecords || filteredRecords.length === 0) {
        if (incomeChart) { incomeChart.destroy(); incomeChart = null; }
        if (expensesChart) { expensesChart.destroy(); expensesChart = null; }
        return;
    }

    const sorted = [...filteredRecords].sort((a, b) => {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (da || 0) - (db || 0);
    });

    const labels = sorted.map(r => {
        const d = parseLocalDate(r.date);
        if (!d) return '??';
        return d.getDate() + '.' + (d.getMonth() + 1);
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
            data: {
                labels: ['Бензин', 'Ремонт', 'Налог'],
                datasets: [{ data: [fuel, repair, tax], backgroundColor: ['#ef4444', '#f59e0b', '#8b5cf6'] }]
            },
            options: { responsive: true }
        });
    }
}

function initComparisonSelectors() {
    const months = new Set(), years = new Set();
    records.forEach(r => {
        const d = parseLocalDate(r.date);
        if (!d) return;
        months.add((d.getMonth() + 1).toString().padStart(2, '0'));
        years.add(d.getFullYear());
    });

    const names = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');

    if (!c1m || !c1y || !c2m || !c2y) return;

    [c1m, c2m].forEach(select => {
        select.innerHTML = '<option value="">Весь год</option>';
        const sortedMonths = [...months].sort((a, b) => a - b);
        sortedMonths.forEach(m => {
            const o = document.createElement('option');
            o.value = m;
            o.textContent = names[parseInt(m)];
            select.appendChild(o);
        });
    });

    [c1y, c2y].forEach(select => {
        select.innerHTML = '';
        const sortedYears = [...years].sort((a, b) => b - a);
        sortedYears.forEach(y => {
            const o = document.createElement('option');
            o.value = y;
            o.textContent = y;
            select.appendChild(o);
        });
    });

    if (years.size > 0) {
        const sortedYears = [...years].sort((a, b) => b - a);
        c1y.value = sortedYears[0];
        c2y.value = sortedYears[0];
    }
}

function getPeriodStats(month, year) {
    let filtered = [...records];

    if (year) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d.getFullYear().toString() === year;
        });
    }

    if (month) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && (d.getMonth() + 1).toString().padStart(2, '0') === month;
        });
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
    const names = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
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
        return `<span class="diff-positive">↑ +${diffStr}${percentStr}</span>`;
    } else if (diff < 0) {
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
                    <th><ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px;"></ion-icon>${name1}</th>
                    <th><ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px;"></ion-icon>${name2}</th>
                    <th>Разница</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="metric-name"><ion-icon name="cash-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Общий доход</td>
                    <td>${formatMoney(s1.totalIncome)}</td>
                    <td>${formatMoney(s2.totalIncome)}</td>
                    <td>${formatDiff(s1.totalIncome, s2.totalIncome)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="trending-up-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Доход в день</td>
                    <td>${formatMoney(incomePerDay1)}</td>
                    <td>${formatMoney(incomePerDay2)}</td>
                    <td>${formatDiff(incomePerDay1, incomePerDay2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="arrow-down-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Всего расходов</td>
                    <td>${formatMoney(s1.totalExpenses)}</td>
                    <td>${formatMoney(s2.totalExpenses)}</td>
                    <td>${formatDiff(s1.totalExpenses, s2.totalExpenses)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="checkmark-circle-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Чистая прибыль</td>
                    <td>${formatMoney(s1.netProfit)}</td>
                    <td>${formatMoney(s2.netProfit)}</td>
                    <td>${formatDiff(s1.netProfit, s2.netProfit)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="trophy-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Прибыль в день</td>
                    <td>${formatMoney(profitPerDay1)}</td>
                    <td>${formatMoney(profitPerDay2)}</td>
                    <td>${formatDiff(profitPerDay1, profitPerDay2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="time-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Часов</td>
                    <td>${s1.totalHours.toFixed(1)}</td>
                    <td>${s2.totalHours.toFixed(1)}</td>
                    <td>${formatDiff(s1.totalHours, s2.totalHours, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="cube-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Заказов</td>
                    <td>${s1.totalOrders}</td>
                    <td>${s2.totalOrders}</td>
                    <td>${formatDiff(s1.totalOrders, s2.totalOrders, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="navigate-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Пройдено км</td>
                    <td>${s1.totalDistance.toFixed(1)}</td>
                    <td>${s2.totalDistance.toFixed(1)}</td>
                    <td>${formatDiff(s1.totalDistance, s2.totalDistance, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Рабочих дней</td>
                    <td>${s1.workingDays}</td>
                    <td>${s2.workingDays}</td>
                    <td>${formatDiff(s1.workingDays, s2.workingDays, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="wallet-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Средний ₽/час</td>
                    <td>${formatMoney(avgPerHour1)}</td>
                    <td>${formatMoney(avgPerHour2)}</td>
                    <td>${formatDiff(avgPerHour1, avgPerHour2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="receipt-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Средний чек</td>
                    <td>${formatMoney(avgCheck1)}</td>
                    <td>${formatMoney(avgCheck2)}</td>
                    <td>${formatDiff(avgCheck1, avgCheck2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="speedometer-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Заказов в час</td>
                    <td>${ordersPerHour1.toFixed(2)}</td>
                    <td>${ordersPerHour2.toFixed(2)}</td>
                    <td>${formatDiff(ordersPerHour1, ordersPerHour2, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="analytics-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Эффективность</td>
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
            <div class="summary-card ${hoursClass}">
                <h4>Отработано часов</h4>
                <div class="big-number">${hoursDiff.diff > 0 ? '+' : ''}${hoursDiff.diff.toFixed(1)} ч</div>
                <div class="small-text">${name1}: ${s1.totalHours.toFixed(1)} ч vs ${name2}: ${s2.totalHours.toFixed(1)} ч</div>
            </div>
        </div>
    `;

    const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
    const summaryMatch = html.match(/<div class="comparison-summary"[\s\S]*$/);

    if (tableMatch) {
        let newHtml = '<div class="table-scroll-container">' + tableMatch[0] + '</div>';
        if (summaryMatch) {
            newHtml += summaryMatch[0];
        }
        results.innerHTML = newHtml;
    } else {
        results.innerHTML = html;
    }

    updateComparisonChart(name1, name2, s1, s2);
    saveState();
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
                    data: [s1.totalIncome, s1.totalExpenses, s1.netProfit, s1.totalHours * 100, s1.totalOrders * 10],
                    backgroundColor: 'rgba(102, 126, 234, 0.7)',
                    borderColor: '#667eea',
                    borderWidth: 2
                },
                {
                    label: name2,
                    data: [s2.totalIncome, s2.totalExpenses, s2.netProfit, s2.totalHours * 100, s2.totalOrders * 10],
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
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
            scales: { y: { beginAtZero: true } }
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

function populateFilters() {
    const months = new Set(), years = new Set();

    records.forEach(r => {
        const d = parseLocalDate(r.date);
        if (d) {
            months.add((d.getMonth() + 1).toString().padStart(2, '0'));
            years.add(d.getFullYear());
        }
    });

    const ms = document.getElementById('filter-month');
    const ys = document.getElementById('filter-year');

    if (!ms || !ys) return;

    const cm = ms.value;
    const cy = ys.value;

    ms.innerHTML = '<option value="">Все месяцы</option>';
    const names = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    const sortedMonths = [...months].sort((a, b) => a - b);
    sortedMonths.forEach(m => {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = names[parseInt(m)];
        ms.appendChild(o);
    });

    ys.innerHTML = '<option value="">Все годы</option>';
    const sortedYears = [...years].sort((a, b) => b - a);
    sortedYears.forEach(y => {
        const o = document.createElement('option');
        o.value = y;
        o.textContent = y;
        ys.appendChild(o);
    });

    ms.value = cm;
    ys.value = cy;
}

// ===== РЕНДЕР СТРОКИ ТАБЛИЦЫ =====
function getRecordRowHTML(r) {
    const typeLabel = r.recordType === 'bonus' ?
        ' <ion-icon name="gift-outline" style="vertical-align: middle; margin-right: 4px; color: #AF52DE;"></ion-icon>Бонус' :
        r.recordType === 'expense' ?
            ' <ion-icon name="remove-circle-outline" style="vertical-align: middle; margin-right: 4px; color: #FF3B30;"></ion-icon>Расход' :
            ' <ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px; color: #007AFF;"></ion-icon>Работа';

    const hasFuelDetails = r.fuelDetails && Array.isArray(r.fuelDetails) && r.fuelDetails.length > 0;
    const fuelCellClass = hasFuelDetails ? 'fuel-cell-with-details' : '';

    let fuelTooltipAttr = '';
    if (hasFuelDetails) {
        const fuelDetailsJSON = JSON.stringify(r.fuelDetails).replace(/'/g, "&apos;");
        const fuelLiters = r.fuelLiters || 0;
        const fuelCount = r.fuelLogCount || r.fuelDetails.length;
        fuelTooltipAttr = `data-fuel-details='${fuelDetailsJSON}' data-fuel-liters='${fuelLiters}' data-fuel-count='${fuelCount}'`;
    }

    const hasRepairDetails = r.repairDetails && Array.isArray(r.repairDetails) && r.repairDetails.length > 0;
    const repairCellClass = hasRepairDetails ? 'repair-cell-with-details' : '';

    let repairTooltipAttr = '';
    if (hasRepairDetails) {
        const repairDetailsJSON = JSON.stringify(r.repairDetails).replace(/'/g, "&apos;");
        const repairTotal = r.repairCost || 0;
        const repairCount = r.repairLogCount || r.repairDetails.length;
        repairTooltipAttr = `data-repair-details='${repairDetailsJSON}' data-repair-total='${repairTotal}' data-repair-count='${repairCount}'`;
    }

    return `
     <td>${formatDate(r.date)}</td>
     <td>${r.weekday || '-'}</td>
     <td>${typeLabel}</td>
     <td>${r.hours || '-'}</td>
     <td>${r.ordersPickup || '-'}</td>
     <td>${r.payPickup ? formatMoney(r.payPickup) : '-'}</td>
     <td>${r.ordersDelivery || '-'}</td>
     <td>${r.payDelivery ? formatMoney(r.payDelivery) : '-'}</td>
     <td>${r.distance ? r.distance.toFixed(1) : '-'}</td>
     <td>${r.payDistance ? formatMoney(r.payDistance) : '-'}</td>
     <td>${r.weight ? r.weight.toFixed(1) : '-'}</td>
     <td>${r.payWeight ? formatMoney(r.payWeight) : '-'}</td>
     <td>${r.loadPay ? formatMoney(r.loadPay) : '-'}</td>
     <td>${r.bonusPay ? formatMoney(r.bonusPay) : '-'}</td>
     <td>${r.rating ? formatMoney(r.rating) : '-'}</td>
     <td>${r.tips ? formatMoney(r.tips) : '-'}</td>
     <td class="${fuelCellClass}" ${fuelTooltipAttr}>${r.fuelCost ? formatMoney(r.fuelCost) : '-'}</td>
     <td class="${repairCellClass}" ${repairTooltipAttr}>${r.repairCost ? formatMoney(r.repairCost) : '-'}</td>
     <td>${r.tax ? formatMoney(r.tax) : '-'}</td>
     <td>${formatMoney(r.totalIncome)}</td>
     <td>${formatMoney(r.totalExpenses)}</td>
     <td style="color:${r.netProfit >= 0 ? '#10b981' : '#ef4444'};font-weight:bold">${formatMoney(r.netProfit)}</td>
     <td>
         <button class="btn btn-success" onclick="editRecord('${r.id}')"><ion-icon name="create-outline"></ion-icon></button>
         <button class="btn btn-danger" onclick="deleteRecord('${r.id}')"><ion-icon name="trash-outline"></ion-icon></button>
     </td>
 `;
}

// ============================================
// КАРТОЧНЫЙ РЕЖИМ ТАБЛИЦЫ
// ============================================
let currentViewMode = localStorage.getItem('historyViewMode') || 'auto';

function setViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem('historyViewMode', mode);
    const btnTable = document.getElementById('vmt-table');
    const btnCards = document.getElementById('vmt-cards');
    if (btnTable) btnTable.classList.toggle('active', mode === 'table');
    if (btnCards) btnCards.classList.toggle('active', mode === 'cards');
    renderTable();
}

function isCardsMode() {
    if (currentViewMode === 'cards') return true;
    if (currentViewMode === 'table') return false;
    return window.innerWidth < 768;
}

function getRecordCardHTML(r) {
    const typeIcon = r.recordType === 'bonus' ? 'gift-outline' :
        r.recordType === 'expense' ? 'remove-circle-outline' : 'calendar-outline';
    const typeColor = r.recordType === 'bonus' ? 'var(--ios-purple, #AF52DE)' :
        r.recordType === 'expense' ? 'var(--ios-danger, #FF3B30)' : 'var(--ios-accent, #007AFF)';
    const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
        r.recordType === 'expense' ? 'Расход' : 'Работа';
    const profitColor = r.netProfit >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)';
    const totalOrders = r.ordersDelivery || 0;
    const cardId = 'card-details-' + r.id;

    const details = [];
    if (r.ordersPickup) details.push({ label: 'Забор', value: r.ordersPickup + ' шт · ' + formatMoney(r.payPickup) });
    if (r.ordersDelivery) details.push({ label: 'Выдача', value: r.ordersDelivery + ' шт · ' + formatMoney(r.payDelivery) });
    if (r.payDistance) details.push({ label: 'Км', value: formatMoney(r.payDistance) });
    if (r.payWeight) details.push({ label: 'Вес', value: formatMoney(r.payWeight) });
    if (r.loadPay) details.push({ label: 'Нагрузка', value: formatMoney(r.loadPay) });
    if (r.bonusPay) details.push({ label: 'Бонус', value: formatMoney(r.bonusPay) });
    if (r.rating) details.push({ label: 'Рейтинг', value: formatMoney(r.rating) });
    if (r.tips) details.push({ label: 'Чаевые', value: formatMoney(r.tips) });

    if (r.fuelCost) {
        const hasFuel = r.fuelDetails && Array.isArray(r.fuelDetails) && r.fuelDetails.length > 0;
        details.push({
            label: 'Бензин',
            value: formatMoney(r.fuelCost),
            cls: hasFuel ? 'rcd-tappable rcd-fuel fuel-cell-with-details' : '',
            attrs: hasFuel ?
                `data-fuel-details='${JSON.stringify(r.fuelDetails).replace(/'/g, "&apos;")}' data-fuel-liters='${r.fuelLiters || 0}' data-fuel-count='${r.fuelLogCount || r.fuelDetails.length}' data-fuel-total='${r.fuelCost}'` :
                ''
        });
    }

    if (r.repairCost) {
        const hasRep = r.repairDetails && Array.isArray(r.repairDetails) && r.repairDetails.length > 0;
        details.push({
            label: 'Ремонт',
            value: formatMoney(r.repairCost),
            cls: hasRep ? 'rcd-tappable rcd-repair repair-cell-with-details' : '',
            attrs: hasRep ?
                `data-repair-details='${JSON.stringify(r.repairDetails).replace(/'/g, "&apos;")}' data-repair-total='${r.repairCost}' data-repair-count='${r.repairLogCount || r.repairDetails.length}'` :
                ''
        });
    }
    if (r.tax) details.push({ label: 'Налог', value: formatMoney(r.tax) });

    const detailsHTML = details.length ?
        details.map(d =>
            `<div class="rcd-item ${d.cls || ''}" ${d.attrs || ''}>
                <span class="rcd-label">${d.label}</span>
                <span class="rcd-val">${d.value}</span>
            </div>`).join('') :
        '<div class="rcd-empty">Нет дополнительных данных</div>';

    return `
    <div class="record-card">
        <div class="record-card-header">
            <div class="record-card-date">
                <ion-icon name="calendar-outline"></ion-icon>
                ${formatDate(r.date)} · ${r.weekday || '—'}
            </div>
            <div class="record-card-type" style="color: ${typeColor}">
                <ion-icon name="${typeIcon}"></ion-icon>
                ${typeLabel}
            </div>
        </div>
        <div class="record-card-metrics">
            <div class="rcm"><ion-icon name="time-outline"></ion-icon> ${r.hours || 0} ч</div>
            <div class="rcm"><ion-icon name="cube-outline"></ion-icon> ${totalOrders} зак.</div>
            <div class="rcm"><ion-icon name="navigate-outline"></ion-icon> ${r.distance ? r.distance.toFixed(1) : 0} км</div>
            ${r.weight ? `<div class="rcm"><ion-icon name="scale-outline"></ion-icon> ${r.weight.toFixed(1)} кг</div>` : ''}
        </div>
        <div class="record-card-financials">
            <div class="rcf income">
                <span class="rcf-label">Доход</span>
                <span class="rcf-value">${formatMoney(r.totalIncome)}</span>
            </div>
            <div class="rcf expense">
                <span class="rcf-label">Расход</span>
                <span class="rcf-value">${formatMoney(r.totalExpenses)}</span>
            </div>
            <div class="rcf profit">
                <span class="rcf-label">Прибыль</span>
                <span class="rcf-value" style="color: ${profitColor}">${formatMoney(r.netProfit)}</span>
            </div>
        </div>
        <div class="record-card-details" id="${cardId}">${detailsHTML}</div>
        <div class="record-card-footer">
            <button class="record-card-expand" onclick="toggleCardDetails('${cardId}', this)">
                <span>Детали</span>
                <ion-icon name="chevron-down-outline"></ion-icon>
            </button>
            <div class="record-card-actions">
                <button class="btn btn-small btn-success" onclick="editRecord('${r.id}')">
                    <ion-icon name="create-outline"></ion-icon>
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteRecord('${r.id}')">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            </div>
        </div>
    </div>`;
}

function toggleCardDetails(cardId, btn) {
    const el = document.getElementById(cardId);
    if (!el) return;
    const open = el.classList.toggle('open');
    btn.classList.toggle('expanded', open);
    btn.querySelector('span').textContent = open ? 'Скрыть' : 'Детали';
}

function renderCardsView(tbody, filteredRecords) {
    const table = tbody.closest('table');
    let cardsContainer = document.getElementById('records-cards');
    if (!cardsContainer) {
        cardsContainer = document.createElement('div');
        cardsContainer.id = 'records-cards';
        cardsContainer.className = 'records-cards-container';
        table.parentNode.insertBefore(cardsContainer, table);
    }
    table.style.display = 'none';
    const box = table.closest('.table-container') || table.parentElement;
    if (box) box.classList.add('cards-mode');
    cardsContainer.style.display = 'flex';
    cardsContainer.innerHTML = '';

    if (filteredRecords.length === 0) {
        cardsContainer.innerHTML = `
            <div style="text-align:center; padding:40px; color:var(--ios-text-tertiary);">
                <ion-icon name="document-text-outline" style="font-size:48px; display:block; margin:0 auto 12px;"></ion-icon>
                Нет записей за выбранный период
            </div>`;
        return;
    }

    const weeksMap = new Map();
    filteredRecords.forEach(r => {
        if (!r.date) return;
        const weekKey = getISOWeek(r.date);
        if (!weeksMap.has(weekKey)) weeksMap.set(weekKey, []);
        weeksMap.get(weekKey).push(r);
    });

    const sortedWeeks = Array.from(weeksMap.keys()).sort((a, b) => b.localeCompare(a));

    sortedWeeks.forEach(weekKey => {
        const weekRecords = weeksMap.get(weekKey);
        const weekRange = getWeekDateRange(weekKey);

        const header = document.createElement('div');
        header.className = 'week-card-header';
        header.innerHTML = `
            <ion-icon name="calendar-outline"></ion-icon>
            Неделя ${weekKey.split('-W')[1]} (${weekRange.label})`;
        cardsContainer.appendChild(header);

        weekRecords.forEach(r => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = getRecordCardHTML(r);
            cardsContainer.appendChild(wrapper.firstElementChild);
        });

        const summary = weekRecords.reduce((acc, r) => {
            acc.totalIncome += r.totalIncome || 0;
            acc.totalExpenses += r.totalExpenses || 0;
            acc.netProfit += r.netProfit || 0;
            acc.hours += r.hours || 0;
            acc.orders += (r.ordersPickup || 0) + (r.ordersDelivery || 0);
            return acc;
        }, { totalIncome: 0, totalExpenses: 0, netProfit: 0, hours: 0, orders: 0 });

        const summaryEl = document.createElement('div');
        summaryEl.className = 'week-card-summary';
        summaryEl.innerHTML = `
            <div class="wcs-item">
                <div class="wcs-label">Доход</div>
                <div class="wcs-value" style="color:var(--ios-success)">${formatMoney(summary.totalIncome)}</div>
            </div>
            <div class="wcs-item">
                <div class="wcs-label">Прибыль</div>
                <div class="wcs-value" style="color:${summary.netProfit >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)'}">${formatMoney(summary.netProfit)}</div>
            </div>
            <div class="wcs-item">
                <div class="wcs-label">Часы</div>
                <div class="wcs-value">${summary.hours.toFixed(1)} ч</div>
            </div>`;
        cardsContainer.appendChild(summaryEl);
    });
}

function showTableView() {
    const table = document.querySelector('#tab-history table');
    const cardsContainer = document.getElementById('records-cards');
    if (table) table.style.display = '';
    if (cardsContainer) cardsContainer.style.display = 'none';
    const box = document.querySelector('.table-container.cards-mode');
    if (box) box.classList.remove('cards-mode');
}

function renderTable() {
    const tbody = document.getElementById('records-body');
    if (!tbody) {
        console.error('❌ Элемент <tbody id="records-body"> не найден в HTML');
        return;
    }

    if (isCardsMode()) {
        let filteredRecords = [...records];
        const historyTab = document.getElementById('tab-history');
        const isHistoryActive = historyTab && historyTab.classList.contains('active');
        if (isHistoryActive && !showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
            filteredRecords = filteredRecords.filter(r => {
                if (!r.date) return false;
                const d = parseLocalDate(r.date);
                if (!d) return false;
                return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
            });
        }
        filteredRecords = applyFilters(filteredRecords);
        filteredRecords.sort((a, b) => {
            const da = parseLocalDate(a.date);
            const db = parseLocalDate(b.date);
            return (db || 0) - (da || 0);
        });
        renderCardsView(tbody, filteredRecords);
        return;
    }

    showTableView();

    tbody.innerHTML = '';

    const historyTab = document.getElementById('tab-history');
    const isHistoryActive = historyTab && historyTab.classList.contains('active');

    let filteredRecords = [...records];

    if (isHistoryActive) {
        if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear && filterState.date.values.length === 0) {
            filteredRecords = filteredRecords.filter(function (r) {
                if (!r.date) return false;
                const d = parseLocalDate(r.date);
                if (!d) return false;
                return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
            });
        }

        filteredRecords = applyFilters(filteredRecords);

        if (sortState.column && sortState.direction) {
            filteredRecords = applySorting(filteredRecords);
        } else {
            filteredRecords.sort((a, b) => {
                const da = parseLocalDate(a.date);
                const db = parseLocalDate(b.date);
                return (db || 0) - (da || 0);
            });
        }

        const hasActiveFilters = Object.keys(filterState).some(key => {
            const filter = filterState[key];
            if (filter.type === 'checkbox' || filter.type === 'month') return filter.values && filter.values.length > 0;
            else if (filter.type === 'range') return filter.min !== '' || filter.max !== '';
            return false;
        });

        const hasActiveSorting = sortState.column !== null && sortState.direction !== null;
        const shouldHideWeeklySummary = hasActiveFilters || hasActiveSorting;

        if (!shouldHideWeeklySummary && !showAllHistoryMode) {
            renderTableWithWeeklySummary(tbody, filteredRecords);
        } else {
            filteredRecords.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = getRecordRowHTML(r);
                tbody.appendChild(tr);
            });
        }

        const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);
        renderPagination(totalPages);
    } else {
        filteredRecords = applyFilters(filteredRecords);

        const hasActiveFilters = Object.keys(filterState).some(key => {
            const filter = filterState[key];
            if (filter.type === 'checkbox' || filter.type === 'month') return filter.values && filter.values.length > 0;
            else if (filter.type === 'range') return filter.min !== '' || filter.max !== '';
            return false;
        });

        const hasActiveSorting = sortState.column !== null && sortState.direction !== null;
        const shouldHideWeeklySummary = hasActiveFilters || hasActiveSorting;

        if (sortState.column && sortState.direction) {
            filteredRecords = applySorting(filteredRecords);
        } else {
            filteredRecords.sort((a, b) => {
                const da = parseLocalDate(a.date);
                const db = parseLocalDate(b.date);
                return (db || 0) - (da || 0);
            });
        }

        if (!shouldHideWeeklySummary) {
            renderTableWithWeeklySummary(tbody, filteredRecords);
        } else {
            filteredRecords.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = getRecordRowHTML(r);
                tbody.appendChild(tr);
            });
        }
    }

    let tableContainer = tbody.closest('.table-container');
    if (!tableContainer) tableContainer = tbody.closest('table');
    if (!tableContainer) tableContainer = tbody.parentElement;

    if (tableContainer) {
        let infoEl = document.getElementById('filter-info');
        if (!infoEl) {
            infoEl = document.createElement('div');
            infoEl.id = 'filter-info';
            infoEl.style.cssText = 'padding:15px;background:#dbeafe;border-radius:8px;margin:10px 0;text-align:center;color:#1e40af;font-weight:600;';
            if (tableContainer.tagName === 'TABLE') {
                tableContainer.parentElement.insertBefore(infoEl, tableContainer.nextSibling);
            } else {
                tableContainer.appendChild(infoEl);
            }
        }

        const count = filteredRecords.length;
        const total = records.length;

        if (count < total || count === 0) {
            infoEl.style.display = 'block';
            if (isHistoryActive) {
                let filterInfo = '';
                if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
                    const monthName = getMonthName(currentHistoryMonth);
                    filterInfo = ` за ${monthName} ${currentHistoryYear}`;
                }
                infoEl.textContent = `📅 Показано ${count} из ${total} записей${filterInfo}`;
            } else {
                infoEl.textContent = `📊 Показано ${count} из ${total} записей`;
            }
        } else {
            infoEl.style.display = 'none';
        }
    }
}

// ===== ISO-НЕДЕЛЯ =====
function getISOWeek(dateStr) {
    const date = parseLocalDate(dateStr);
    if (!date) return '';

    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
    const year = date.getFullYear();
    return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

function getWeekDateRange(weekKey) {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);

    const jan4 = parseLocalDate(`${year}-01-04`);
    if (!jan4) return { start: null, end: null, label: '' };

    const dayOfWeek = (jan4.getDay() + 6) % 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - dayOfWeek);

    const weekMonday = new Date(firstMonday);
    weekMonday.setDate(firstMonday.getDate() + (week - 1) * 7);

    const weekSunday = new Date(weekMonday);
    weekSunday.setDate(weekMonday.getDate() + 6);

    return {
        start: weekMonday,
        end: weekSunday,
        label: `${weekMonday.getDate()}.${String(weekMonday.getMonth() + 1).padStart(2, '0')} - ${weekSunday.getDate()}.${String(weekSunday.getMonth() + 1).padStart(2, '0')}.${weekSunday.getFullYear()}`
    };
}

function renderTableWithWeeklySummary(tbody, records) {
    const headerCells = document.querySelectorAll('thead tr:first-child th');
    const totalColumns = headerCells.length;

    const weeksMap = new Map();
    records.forEach(r => {
        if (!r.date) return;
        const weekKey = getISOWeek(r.date);
        if (!weeksMap.has(weekKey)) weeksMap.set(weekKey, []);
        weeksMap.get(weekKey).push(r);
    });

    const sortedWeeks = Array.from(weeksMap.keys()).sort((a, b) => b.localeCompare(a));

    sortedWeeks.forEach(weekKey => {
        const weekRecords = weeksMap.get(weekKey);
        const weekRange = getWeekDateRange(weekKey);

        const summary = weekRecords.reduce((acc, r) => {
            acc.hours += r.hours || 0;
            acc.ordersPickup += r.ordersPickup || 0;
            acc.payPickup += r.payPickup || 0;
            acc.ordersDelivery += r.ordersDelivery || 0;
            acc.payDelivery += r.payDelivery || 0;
            acc.distance += r.distance || 0;
            acc.payDistance += r.payDistance || 0;
            acc.weight += r.weight || 0;
            acc.payWeight += r.payWeight || 0;
            acc.loadPay += r.loadPay || 0;
            acc.bonusPay += r.bonusPay || 0;
            acc.rating += r.rating || 0;
            acc.tips += r.tips || 0;
            acc.fuelCost += r.fuelCost || 0;
            acc.repairCost += r.repairCost || 0;
            acc.tax += r.tax || 0;
            acc.totalIncome += r.totalIncome || 0;
            acc.totalExpenses += r.totalExpenses || 0;
            acc.netProfit += r.netProfit || 0;
            if (r.recordType === 'work') acc.workingDays += 1;
            return acc;
        }, {
            hours: 0, ordersPickup: 0, payPickup: 0,
            ordersDelivery: 0, payDelivery: 0,
            distance: 0, payDistance: 0,
            weight: 0, payWeight: 0,
            loadPay: 0, bonusPay: 0, rating: 0, tips: 0,
            fuelCost: 0, repairCost: 0, tax: 0,
            totalIncome: 0, totalExpenses: 0, netProfit: 0,
            workingDays: 0
        });

        const headerRow = document.createElement('tr');
        headerRow.className = 'week-summary-header';
        headerRow.innerHTML = `
            <td colspan="${totalColumns}">
                <ion-icon name="calendar-outline" class="week-header-icon"></ion-icon>
                Неделя ${weekKey.split('-W')[1]} (${weekRange.label}) — 
                ${summary.workingDays} ${summary.workingDays === 1 ? 'день' : (summary.workingDays >= 2 && summary.workingDays <= 4 ? 'дня' : 'дней')}
            </td>
        `;
        tbody.appendChild(headerRow);

        weekRecords.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = getRecordRowHTML(r);
            tbody.appendChild(tr);
        });

        const summaryRow = document.createElement('tr');
        summaryRow.className = 'week-summary-row';

        const values = [
            summary.hours.toFixed(1),
            summary.ordersPickup,
            formatMoney(summary.payPickup),
            summary.ordersDelivery,
            formatMoney(summary.payDelivery),
            summary.distance.toFixed(1),
            formatMoney(summary.payDistance),
            summary.weight.toFixed(1),
            formatMoney(summary.payWeight),
            formatMoney(summary.loadPay),
            formatMoney(summary.bonusPay),
            formatMoney(summary.rating),
            formatMoney(summary.tips),
            formatMoney(summary.fuelCost),
            formatMoney(summary.repairCost),
            formatMoney(summary.tax),
            formatMoney(summary.totalIncome),
            formatMoney(summary.totalExpenses),
            `<span style="color:${summary.netProfit >= 0 ? '#10b981' : '#ef4444'}">${formatMoney(summary.netProfit)}</span>`
        ];

        let summaryHTML = `<td colspan="3"><strong><ion-icon name="bar-chart-outline" class="week-summary-icon"></ion-icon> ИТОГО:</strong></td>`;
        values.forEach(v => {
            summaryHTML += `<td><strong>${v}</strong></td>`;
        });
        summaryHTML += `<td></td>`;

        summaryRow.innerHTML = summaryHTML;
        tbody.appendChild(summaryRow);
    });
}

function editRecord(id) {
    if (typeof window.openEntryModal === 'function') {
        window.openEntryModal(id);
    }
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

    if (typeof window.updateHomeTab === 'function' &&
        document.getElementById('tab-home')?.classList.contains('active')) {
        window.updateHomeTab();
    }
}

function exportData() {
    try {
        const recordsToExport = records || [];
        const tariffsToExport = tariffs || [];

        let fuelToExport = [];
        if (window.fuelLogs && window.fuelLogs.length > 0) {
            fuelToExport = window.fuelLogs;
        } else {
            const localFuel = localStorage.getItem('driverFuelLogs');
            if (localFuel) {
                try {
                    fuelToExport = JSON.parse(localFuel);
                } catch (e) {
                    console.error('❌ Ошибка парсинга топлива из localStorage:', e);
                }
            }
        }

        let repairToExport = [];
        if (window.repairRecords && window.repairRecords.length > 0) {
            repairToExport = window.repairRecords;
        } else {
            const localRepair = localStorage.getItem('repair_records');
            if (localRepair) {
                try {
                    repairToExport = JSON.parse(localRepair);
                } catch (e) {
                    console.error('❌ Ошибка парсинга ремонтов из localStorage:', e);
                }
            }
        }

        const data = {
            records: recordsToExport,
            tariffs: tariffsToExport,
            fuelLogs: fuelToExport,
            repairRecords: repairToExport,
            exportDate: new Date().toISOString(),
            version: '2.0'
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `driver-full-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);

        alert(`✅ Полная резервная копия экспортирована!\n\n📝 Записей: ${recordsToExport.length}\n⛽ Заправок: ${fuelToExport.length}\n🔧 Ремонтов: ${repairToExport.length}`);
    } catch (err) {
        alert('❌ Ошибка при экспорте: ' + err.message);
    }
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const importBtn = e.target.previousElementSibling;
    const originalText = importBtn.textContent;
    importBtn.textContent = '⏳ Загрузка...';
    importBtn.disabled = true;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);

            if (data.records) {
                records = data.records.map(normalizeRecord);
                if (data.tariffs) tariffs = data.tariffs.map(normalizeTariff);

                if (data.fuelLogs) {
                    window.fuelLogs = data.fuelLogs;
                    localStorage.setItem('driverFuelLogs', JSON.stringify(window.fuelLogs));
                    console.log('✅ Импортировано заправок:', window.fuelLogs.length);
                }

                if (data.repairRecords) {
                    window.repairRecords = data.repairRecords;
                    localStorage.setItem('repair_records', JSON.stringify(window.repairRecords));
                    console.log('✅ Импортировано ремонтов:', window.repairRecords.length);
                }

                saveData();

                if (typeof db !== 'undefined' && currentUser) {
                    await syncToFirebase();

                    if (data.fuelLogs && typeof window.saveFuelLogToFirebase === 'function') {
                        for (const log of data.fuelLogs) {
                            await window.saveFuelLogToFirebase(log);
                        }
                    }

                    if (data.repairRecords && typeof window.syncRepairToFirebase === 'function') {
                        for (const rec of data.repairRecords) {
                            await window.syncRepairToFirebase(rec);
                        }
                    }
                }

                renderTable();
                renderTariffs();
                populateFilters();
                updateAnalytics();

                if (typeof window.renderFuelLogs === 'function') window.renderFuelLogs();
                if (typeof window.updateFuelStats === 'function') window.updateFuelStats();
                if (typeof window.updateFuelChart === 'function') window.updateFuelChart();

                if (typeof window.renderRepairList === 'function') window.renderRepairList();
                if (typeof window.updateRepairStats === 'function') window.updateRepairStats();
                if (typeof window.updateRepairCharts === 'function') window.updateRepairCharts();

                if (typeof window.syncFuelToRecords === 'function') await window.syncFuelToRecords();
                if (typeof window.syncRepairToMainRecords === 'function') await window.syncRepairToMainRecords();

                const fuelCount = data.fuelLogs ? data.fuelLogs.length : 0;
                const repairCount = data.repairRecords ? data.repairRecords.length : 0;

                alert(`✅ Успешно импортировано:\n📝 Записей: ${records.length}\n⛽ Заправок: ${fuelCount}\n🔧 Ремонтов: ${repairCount}`);

                if (typeof window.updateHomeTab === 'function') {
                    window.updateHomeTab();
                }

            } else if (Array.isArray(data)) {
                records = data.map(normalizeRecord);
                saveData();

                if (typeof db !== 'undefined' && currentUser) {
                    await syncToFirebase();
                }

                renderTable();
                populateFilters();
                updateAnalytics();
                alert('✅ Импортировано ' + records.length + ' записей (старый формат)');
            } else {
                alert('❌ Неверный формат файла резервной копии');
            }
        } catch (err) {
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

async function syncToFirebase() {
    if (!currentUser) return;

    try {
        console.log('🔄 Запуск умной инкрементальной синхронизации...');
        const userRef = db.collection('users').doc(currentUser.uid);
        const recordsRef = userRef.collection('records');
        const tariffsRef = userRef.collection('tariffs');

        const BATCH_SIZE = 400;

        const fbRecordsSnapshot = await recordsRef.get();
        const fbRecordIds = new Set(fbRecordsSnapshot.docs.map(doc => doc.id));
        const localRecordIds = new Set(records.map(r => r.id));

        const idsToDelete = [...fbRecordIds].filter(id => !localRecordIds.has(id));

        if (idsToDelete.length > 0) {
            console.log(`🗑️ Очистка ${idsToDelete.length} удаленных локально записей из Firebase...`);
            for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
                const batch = db.batch();
                idsToDelete.slice(i, i + BATCH_SIZE).forEach(id => batch.delete(recordsRef.doc(id)));
                await batch.commit();
            }
        }

        if (records.length > 0) {
            console.log(`📤 Синхронизация ${records.length} записей (обновление + создание)...`);
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = db.batch();
                const chunk = records.slice(i, i + BATCH_SIZE);

                for (const r of chunk) {
                    const recordToSave = { ...r };
                    const docId = recordToSave.id;
                    delete recordToSave.id;

                    batch.set(recordsRef.doc(docId), recordToSave);
                }
                await batch.commit();
            }
        }

        const fbTariffsSnapshot = await tariffsRef.get();
        const fbTariffIds = new Set(fbTariffsSnapshot.docs.map(doc => doc.id));
        const localTariffIds = new Set(tariffs.map(t => t.id));

        const tariffIdsToDelete = [...fbTariffIds].filter(id => !localTariffIds.has(id));
        if (tariffIdsToDelete.length > 0) {
            for (let i = 0; i < tariffIdsToDelete.length; i += BATCH_SIZE) {
                const batch = db.batch();
                tariffIdsToDelete.slice(i, i + BATCH_SIZE).forEach(id => batch.delete(tariffsRef.doc(id)));
                await batch.commit();
            }
        }

        if (tariffs.length > 0) {
            for (let i = 0; i < tariffs.length; i += BATCH_SIZE) {
                const batch = db.batch();
                const chunk = tariffs.slice(i, i + BATCH_SIZE);

                for (const t of chunk) {
                    const tariffToSave = { ...t };
                    const docId = tariffToSave.id;
                    delete tariffToSave.id;
                    batch.set(tariffsRef.doc(docId), tariffToSave);
                }
                await batch.commit();
            }
        }

        saveData();
        console.log('✅ Умная синхронизация успешно завершена!');

        // ⭐ Обновляем время синхронизации
        if (typeof window.remindersMarkAsSynced === 'function') {
            window.remindersMarkAsSynced();
        }

    } catch (error) {
        console.error('❌ Критическая ошибка синхронизации:', error);
        alert('⚠️ Ошибка синхронизации с облаком. Проверьте интернет-соединение.');
    }
}

function formatMoney(n) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(n);
}

function formatDate(s) {
    if (!s) return '-';
    const d = parseLocalDate(s);
    if (!d) return s;
    return d.toLocaleDateString('ru-RU');
}

function toggleAutoCalc(field) {
    autoCalcState[field] = !autoCalcState[field];
    const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
    const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
    const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;

    if (autoCalcState[field]) {
        if (btn) btn.classList.remove('manual-mode');
        if (input) input.classList.remove('manual-edit');
        if (hint) hint.textContent = 'автоматически';

        if (editingId) {
            const recordIndex = records.findIndex(r => r.id === editingId);
            if (recordIndex !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (records[recordIndex].manualEdits) {
                    records[recordIndex].manualEdits = records[recordIndex].manualEdits.filter(f => f !== fieldName);
                }
            }
        }

        autoCalc(field);
    } else {
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';

        if (editingId) {
            const recordIndex = records.findIndex(r => r.id === editingId);
            if (recordIndex !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (!records[recordIndex].manualEdits) {
                    records[recordIndex].manualEdits = [];
                }
                if (!records[recordIndex].manualEdits.includes(fieldName)) {
                    records[recordIndex].manualEdits.push(fieldName);
                }
            }
        }
    }
}

function markManualEdit(field) {
    if (autoCalcState[field]) {
        autoCalcState[field] = false;
        const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
        const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
        const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';

        if (editingId) {
            const recordIndex = records.findIndex(r => r.id === editingId);
            if (recordIndex !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (!records[recordIndex].manualEdits) {
                    records[recordIndex].manualEdits = [];
                }
                if (!records[recordIndex].manualEdits.includes(fieldName)) {
                    records[recordIndex].manualEdits.push(fieldName);
                }
            }
        }
    }
}

// ===== ЭКСПОРТ В EXCEL =====
function exportToExcel() {
    console.log('📊 Начало экспорта в Excel...');

    if (!records || records.length === 0) {
        alert('❌ Нет данных для экспорта. Сначала добавьте записи.');
        return;
    }

    try {
        if (typeof XLSX === 'undefined') {
            alert('❌ Библиотека Excel не загружена. Обновите страницу.');
            return;
        }

        const data = records.map((r, index) => {
            const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
                r.recordType === 'expense' ? 'Расход' : 'Работа';

            const d = parseLocalDate(r.date);
            const dateStr = d ? d.toLocaleDateString('ru-RU') : r.date || '';

            return {
                '№': index + 1,
                'Дата': dateStr,
                'День недели': r.weekday || '',
                'Тип записи': typeLabel,
                'Часы работы': r.hours || 0,
                'Забор (шт)': r.ordersPickup || 0,
                'Забор (₽)': r.payPickup || 0,
                'Выдача (шт)': r.ordersDelivery || 0,
                'Выдача (₽)': r.payDelivery || 0,
                'Км': r.distance || 0,
                'Км (₽)': r.payDistance || 0,
                'Вес (кг)': r.weight || 0,
                'Вес (₽)': r.payWeight || 0,
                'Нагрузка (₽)': r.loadPay || 0,
                'Бонус (₽)': r.bonusPay || 0,
                'Рейтинг (₽)': r.rating || 0,
                'Чаевые (₽)': r.tips || 0,
                'Бензин (₽)': r.fuelCost || 0,
                'Ремонт (₽)': r.repairCost || 0,
                'Налог (₽)': r.tax || 0,
                'Общий доход (₽)': Math.round((r.totalIncome || 0) * 100) / 100,
                'Всего расходов (₽)': Math.round((r.totalExpenses || 0) * 100) / 100,
                'Чистая прибыль (₽)': Math.round((r.netProfit || 0) * 100) / 100
            };
        });

        console.log('✅ Подготовлено строк:', data.length);

        const ws = XLSX.utils.json_to_sheet(data);

        const colWidths = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length, 12) }));
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Журнал водителя");

        const fileName = `driver-data-${new Date().toISOString().split('T')[0]}.xlsx`;

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);

        link.click();

        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 1000);

        console.log('✅ Excel файл создан:', fileName);
        alert('✅ Excel файл успешно создан!\n\nИмя файла: ' + fileName + '\n\nПроверьте папку "Загрузки"');

    } catch (error) {
        console.error('❌ Ошибка экспорта в Excel:', error);
        alert('❌ Ошибка при создании Excel файла:\n\n' + error.message);
    }
}

// ===== ЭКСПОРТ В PDF =====
function exportToPDF() {
    if (!records || records.length === 0) {
        alert('❌ Нет данных для экспорта');
        return;
    }

    const totalIncome = records.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
    const totalExpenses = records.reduce((sum, r) => sum + (r.totalExpenses || 0), 0);
    const totalProfit = records.reduce((sum, r) => sum + (r.netProfit || 0), 0);
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);

    let rowsHTML = '';
    records.forEach(r => {
        const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
            r.recordType === 'expense' ? 'Расход' : 'Работа';
        const profitColor = r.netProfit >= 0 ? '#10b981' : '#ef4444';

        const d = parseLocalDate(r.date);
        const dateStr = d ? d.toLocaleDateString('ru-RU') : r.date || '-';

        rowsHTML += `
            <tr>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${dateStr}</td>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${r.weekday || '-'}</td>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${typeLabel}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.hours || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.ordersPickup || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payPickup * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.ordersDelivery || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payDelivery * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.distance || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payDistance * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.weight || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payWeight * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.loadPay * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.bonusPay * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.rating * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.tips * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.fuelCost * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.repairCost * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.tax * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px; font-weight: bold;">${Math.round(r.totalIncome * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px; font-weight: bold;">${Math.round(r.totalExpenses * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px; color: ${profitColor}; font-weight: bold;">${Math.round(r.netProfit * 100) / 100}</td>
            </tr>
        `;
    });

    const today = new Date();
    const exportDate = today.toLocaleDateString('ru-RU');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Журнал работы водителя</title>
            <style>
                @page { size: A4 landscape; margin: 8mm; }
                body { font-family: Arial, sans-serif; font-size: 10px; margin: 10px; color: #000; }
                h1 { text-align: center; margin-bottom: 8px; font-size: 18px; }
                .date-info { text-align: center; color: #666; margin-bottom: 12px; font-size: 11px; }
                table { width: 100%; border-collapse: collapse; font-size: 9px; }
                th, td { border: 1px solid #ddd; padding: 5px; font-size: 9px; }
                th { background-color: #f2f2f7; text-align: center; font-weight: bold; font-size: 9px; }
                td { text-align: right; }
                td:first-child, td:nth-child(2), td:nth-child(3) { text-align: left; }
                .summary-table { margin-top: 15px; width: 100%; border-collapse: collapse; }
                .summary-table td { padding: 10px; border: 1px solid #ddd; text-align: center; font-size: 11px; }
                .summary-table .label { background-color: #f2f2f7; font-weight: bold; text-align: left; width: 30%; }
                .summary-table .value { font-weight: bold; }
                @media print { body { margin: 0; } .no-print { display: none; } }
            </style>
        </head>
        <body>
            <h1>Журнал работы водителя</h1>
            <div class="date-info">Дата выгрузки: ${exportDate}</div>
            
            <table>
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>День</th>
                        <th>Тип</th>
                        <th>Часы</th>
                        <th>Забор<br>(шт)</th>
                        <th>Забор<br>(₽)</th>
                        <th>Выдача<br>(шт)</th>
                        <th>Выдача<br>(₽)</th>
                        <th>Км</th>
                        <th>Км<br>(₽)</th>
                        <th>Вес<br>(кг)</th>
                        <th>Вес<br>(₽)</th>
                        <th>Нагрузка<br>(₽)</th>
                        <th>Бонус<br>(₽)</th>
                        <th>Рейтинг<br>(₽)</th>
                        <th>Чаевые<br>(₽)</th>
                        <th>Бензин<br>(₽)</th>
                        <th>Ремонт<br>(₽)</th>
                        <th>Налог<br>(₽)</th>
                        <th>Доход<br>(₽)</th>
                        <th>Расход<br>(₽)</th>
                        <th>Прибыль<br>(₽)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
            </table>
            
            <table class="summary-table">
                <tr>
                    <td class="label">📊 ВСЕГО ЗАПИСЕЙ:</td>
                    <td class="value">${records.length}</td>
                    <td class="label">⏱ ОТРАБОТАНО ЧАСОВ:</td>
                    <td class="value">${totalHours.toFixed(1)}</td>
                </tr>
                <tr>
                    <td class="label">💰 ОБЩИЙ ДОХОД:</td>
                    <td class="value" style="color: #10b981;">${Math.round(totalIncome * 100) / 100} ₽</td>
                    <td class="label">💸 ВСЕГО РАСХОДОВ:</td>
                    <td class="value" style="color: #ef4444;">${Math.round(totalExpenses * 100) / 100} ₽</td>
                </tr>
                <tr>
                    <td class="label">✅ ЧИСТАЯ ПРИБЫЛЬ:</td>
                    <td class="value" style="color: ${totalProfit >= 0 ? '#10b981' : '#ef4444'}; font-size: 13px;">${Math.round(totalProfit * 100) / 100} ₽</td>
                    <td class="label">📈 СРЕДНИЙ ДОХОД В ДЕНЬ:</td>
                    <td class="value">${Math.round((totalIncome / records.length) * 100) / 100} ₽</td>
                </tr>
            </table>
            
            <div class="no-print" style="margin-top: 20px; text-align: center;">
                <button onclick="window.print()" style="padding: 12px 24px; font-size: 16px; background: #007AFF; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    💾 Сохранить как PDF
                </button>
                <p style="margin-top: 10px; color: #666; font-size: 13px;">
                    Нажмите кнопку выше или используйте Ctrl+P (Cmd+P на Mac)<br>
                    В диалоге печати выберите "Сохранить как PDF"
                </p>
            </div>
            
            <script>
                setTimeout(function() {
                    window.print();
                }, 500);
            <\/script>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    alert('💡 Откроется окно для сохранения PDF\n\nВыберите "Сохранить как PDF" в диалоге печати');
}

// ============================================
// ФИЛЬТРАЦИЯ ИСТОРИИ ПО МЕСЯЦУ И ГОДУ
// ============================================
let currentHistoryMonth = null;
let currentHistoryYear = null;

function initHistoryFilters() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const monthSelect = document.getElementById('history-month');
    if (monthSelect) {
        monthSelect.value = currentMonth;
    }

    const yearSelect = document.getElementById('history-year');
    if (yearSelect) {
        yearSelect.innerHTML = '';
        for (let year = 2020; year <= currentYear + 2; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
    }

    currentHistoryMonth = currentMonth;
    currentHistoryYear = currentYear;
    showAllHistoryMode = false;
    currentHistoryPage = 1;
}

function filterHistoryByMonth() {
    const monthSelect = document.getElementById('history-month');
    const yearSelect = document.getElementById('history-year');

    if (!monthSelect || !yearSelect) return;

    currentHistoryMonth = parseInt(monthSelect.value);
    currentHistoryYear = parseInt(yearSelect.value);
    showAllHistoryMode = false;
    currentHistoryPage = 1;

    updateHistoryInfo();
    renderTableWithMonthFilter();
}

function showAllHistory() {
    showAllHistoryMode = true;
    currentHistoryPage = 1;
    updateHistoryInfo();
    renderTableWithMonthFilter();
}

function updateHistoryInfo() {
    const infoDiv = document.getElementById('history-info');
    if (!infoDiv) return;

    const totalRecords = records.length;

    if (showAllHistoryMode) {
        infoDiv.textContent = 'Показаны все записи: ' + totalRecords + ' шт.';
    } else {
        const monthName = getMonthName(currentHistoryMonth);

        const filteredCount = records.filter(function (r) {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        }).length;

        infoDiv.textContent = 'Показано: ' + filteredCount + ' записей за ' + monthName + ' ' + currentHistoryYear + ' г. (всего: ' + totalRecords + ')';
    }
}

function getMonthName(month) {
    const months = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
    return months[month - 1] || '';
}

function renderTableWithMonthFilter() {
    const tbody = document.getElementById('records-body');
    if (!tbody) return;

    let filteredRecords = [...records];

    if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
        filteredRecords = filteredRecords.filter(function (r) {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        });
    }

    filteredRecords.sort(function (a, b) {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (db || 0) - (da || 0);
    });

    const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);
    const startIndex = (currentHistoryPage - 1) * RECORDS_PER_PAGE;
    const endIndex = Math.min(startIndex + RECORDS_PER_PAGE, filteredRecords.length);
    const pageRecords = filteredRecords.slice(startIndex, endIndex);

    tbody.innerHTML = '';

    if (pageRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="23" style="text-align: center; padding: 40px; color: var(--ios-text-tertiary);">' +
            '<ion-icon name="document-text-outline" style="font-size: 48px; display: block; margin: 0 auto 12px;"></ion-icon>' +
            'Нет записей за выбранный период</td></tr>';

        const paginationDiv = document.getElementById('history-pagination');
        if (paginationDiv) paginationDiv.innerHTML = '';
        return;
    }

    renderTableWithWeeklySummary(tbody, pageRecords);
    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const paginationDiv = document.getElementById('history-pagination');
    if (!paginationDiv) return;

    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }

    let html = '';

    if (currentHistoryPage > 1) {
        html += '<button class="btn btn-secondary btn-small" onclick="goToPage(' + (currentHistoryPage - 1) + ')">' +
            '<ion-icon name="chevron-back-outline"></ion-icon></button>';
    }

    for (let i = 1; i <= totalPages; i++) {
        if (i === currentHistoryPage) {
            html += '<button class="btn btn-primary btn-small" style="min-width: 40px;">' + i + '</button>';
        } else if (Math.abs(i - currentHistoryPage) <= 2 || i === 1 || i === totalPages) {
            html += '<button class="btn btn-secondary btn-small" onclick="goToPage(' + i + ')" style="min-width: 40px;">' + i + '</button>';
        } else if (Math.abs(i - currentHistoryPage) === 3) {
            html += '<span style="margin: 0 4px;">...</span>';
        }
    }

    if (currentHistoryPage < totalPages) {
        html += '<button class="btn btn-secondary btn-small" onclick="goToPage(' + (currentHistoryPage + 1) + ')">' +
            '<ion-icon name="chevron-forward-outline"></ion-icon></button>';
    }

    html += '<span style="margin-left: 12px; font-size: 13px; color: var(--ios-text-tertiary); align-self: center;">' +
        'Стр. ' + currentHistoryPage + ' из ' + totalPages + '</span>';

    paginationDiv.innerHTML = html;
}

function goToPage(page) {
    const filteredRecords = getFilteredRecords();
    const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);

    if (page < 1 || page > totalPages) return;

    currentHistoryPage = page;
    renderTableWithMonthFilter();

    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        tableContainer.scrollTop = 0;
    }
}

function getFilteredRecords() {
    let filteredRecords = [...records];

    if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
        filteredRecords = filteredRecords.filter(function (r) {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        });
    }

    filteredRecords.sort(function (a, b) {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (db || 0) - (da || 0);
    });

    return filteredRecords;
}

// ============================================
// ИНДИКАТОР СТАТУСА ПОДКЛЮЧЕНИЯ
// ============================================
let connectionMode = 'checking';
let firebaseErrorReason = '';

// ============================================
// ОБНОВЛЕНИЕ ИМЕНИ ПОЛЬЗОВАТЕЛЯ (ОСТАЁТСЯ В SCRIPT.JS)
// ============================================
async function updateUserName(newName) {
    if (!currentUser) {
        alert('❌ Пользователь не авторизован');
        return;
    }

    if (!newName || newName.trim() === '') {
        alert('❌ Имя не может быть пустым');
        return;
    }

    try {
        await currentUser.updateProfile({
            displayName: newName.trim()
        });

        if (typeof db !== 'undefined') {
            await db.collection('users')
                .doc(currentUser.uid)
                .set({
                    name: newName.trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
        }

        const nameEl = document.getElementById('profile-name');
        if (nameEl) {
            nameEl.textContent = newName.trim();
        }

        showToast('✅ Имя обновлено!');

        await loadUserData();

    } catch (error) {
        console.error('❌ Ошибка обновления имени:', error);
        alert('❌ Ошибка при обновлении имени: ' + error.message);
    }
}

window.showEditNameDialog = function () {
    const modal = document.getElementById('name-modal-overlay');
    const input = document.getElementById('name-modal-input');
    const nameEl = document.getElementById('profile-name');

    if (!modal || !input) return;

    input.value = nameEl ? nameEl.textContent : '';

    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('visible');
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    });
};

window.closeNameModal = function () {
    const modal = document.getElementById('name-modal-overlay');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
};

window.saveNameModal = async function () {
    const input = document.getElementById('name-modal-input');
    if (!input) return;

    const newName = input.value.trim();
    if (!newName) {
        if (typeof window.showToast === 'function') window.showToast('❌ Имя не может быть пустым');
        return;
    }

    closeNameModal();
    if (typeof window.updateUserName === 'function') {
        await window.updateUserName(newName);
    }
};

document.addEventListener('click', function (e) {
    const modal = document.getElementById('name-modal-overlay');
    if (modal && modal.classList.contains('visible') && e.target === modal) {
        closeNameModal();
    }
});

// ============================================
// ЗАГРУЗКА ФОТО ПРОФИЛЯ (ОСТАЁТСЯ В SCRIPT.JS)
// ============================================
const AVATAR_STORAGE_KEY = 'driverProfileAvatar';

function loadProfileAvatar() {
    const avatarImg = document.getElementById('avatar-image');
    const avatarIcon = document.getElementById('avatar-icon');
    const avatarContainer = document.getElementById('profile-avatar');

    if (!avatarImg || !avatarIcon) return;

    const savedAvatar = localStorage.getItem(AVATAR_STORAGE_KEY);

    if (savedAvatar) {
        try {
            avatarImg.src = savedAvatar;
            avatarImg.style.display = 'block';
            avatarIcon.style.display = 'none';
            avatarContainer.style.background = 'none';
            avatarContainer.style.borderColor = 'var(--ios-success)';

            const uploadBtn = document.getElementById('avatar-upload-btn');
            if (uploadBtn) {
                uploadBtn.style.background = 'var(--ios-success)';
            }
        } catch (e) {
            console.error('❌ Ошибка загрузки аватара:', e);
        }
    } else {
        avatarImg.style.display = 'none';
        avatarIcon.style.display = 'block';
        avatarContainer.style.background = 'var(--ios-accent-light)';
        avatarContainer.style.borderColor = 'var(--ios-accent)';

        const uploadBtn = document.getElementById('avatar-upload-btn');
        if (uploadBtn) {
            uploadBtn.style.background = 'var(--ios-accent)';
        }
    }
}

function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 1 * 1024 * 1024) {
        alert('❌ Файл слишком большой для облачной синхронизации!\nМаксимальный размер: 1 МБ.\nПожалуйста, выберите фото меньшего размера или сожмите его.');
        event.target.value = '';
        return;
    }

    if (!file.type.startsWith('image/')) {
        alert('❌ Пожалуйста, выберите изображение!');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const imageData = e.target.result;

        try {
            localStorage.setItem(AVATAR_STORAGE_KEY, imageData);
            console.log('✅ Аватар сохранён в localStorage');
        } catch (error) {
            console.error('❌ Ошибка сохранения аватара в localStorage:', error);
            alert('❌ Не удалось сохранить фото. Возможно, файл всё ещё слишком большой.');
            event.target.value = '';
            return;
        }

        const avatarImg = document.getElementById('avatar-image');
        const avatarIcon = document.getElementById('avatar-icon');
        const avatarContainer = document.getElementById('profile-avatar');
        if (avatarImg && avatarIcon) {
            avatarImg.src = imageData;
            avatarImg.style.display = 'block';
            avatarIcon.style.display = 'none';
            avatarContainer.style.background = 'none';
            avatarContainer.style.borderColor = 'var(--ios-success)';

            const uploadBtn = document.getElementById('avatar-upload-btn');
            if (uploadBtn) uploadBtn.style.background = 'var(--ios-success)';
        }

        if (currentUser && typeof db !== 'undefined') {
            saveAvatarToFirebase(imageData);
        }

        showToast('✅ Фото профиля обновлено!');
        event.target.value = '';
    };

    reader.onerror = function () {
        alert('❌ Ошибка чтения файла. Попробуйте ещё раз.');
        event.target.value = '';
    };
    reader.readAsDataURL(file);
}

async function saveAvatarToFirebase(imageData) {
    if (!currentUser) return;

    try {
        await db.collection('users')
            .doc(currentUser.uid)
            .set({
                avatar: imageData,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

        console.log('✅ Аватар сохранён в Firebase');

        // ⭐ Обновляем время синхронизации
        if (typeof window.remindersMarkAsSynced === 'function') {
            window.remindersMarkAsSynced();
        }
    } catch (error) {
        console.error('❌ Ошибка сохранения аватара в Firebase:', error);
    }
}

async function loadAvatarFromFirebase() {
    if (!currentUser || typeof db === 'undefined') return;

    try {
        const doc = await db.collection('users')
            .doc(currentUser.uid)
            .get();

        if (doc.exists && doc.data().avatar) {
            const avatarData = doc.data().avatar;

            localStorage.setItem(AVATAR_STORAGE_KEY, avatarData);

            const avatarImg = document.getElementById('avatar-image');
            const avatarIcon = document.getElementById('avatar-icon');
            const avatarContainer = document.getElementById('profile-avatar');

            if (avatarImg && avatarIcon) {
                avatarImg.src = avatarData;
                avatarImg.style.display = 'block';
                avatarIcon.style.display = 'none';
                avatarContainer.style.background = 'none';
                avatarContainer.style.borderColor = 'var(--ios-success)';

                const uploadBtn = document.getElementById('avatar-upload-btn');
                if (uploadBtn) {
                    uploadBtn.style.background = 'var(--ios-success)';
                }
            }

            console.log('✅ Аватар загружен из Firebase');
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки аватара из Firebase:', error);
    }
}

function removeAvatar() {
    if (!confirm('Удалить фото профиля?')) return;

    localStorage.removeItem(AVATAR_STORAGE_KEY);

    if (currentUser && typeof db !== 'undefined') {
        db.collection('users')
            .doc(currentUser.uid)
            .update({
                avatar: firebase.firestore.FieldValue.delete()
            })
            .then(() => {
                console.log('✅ Аватар удалён из Firebase');
                // ⭐ Обновляем время синхронизации
                if (typeof window.remindersMarkAsSynced === 'function') {
                    window.remindersMarkAsSynced();
                }
            })
            .catch(err => console.error('❌ Ошибка удаления:', err));
    }

    const avatarImg = document.getElementById('avatar-image');
    const avatarIcon = document.getElementById('avatar-icon');
    const avatarContainer = document.getElementById('profile-avatar');

    if (avatarImg && avatarIcon) {
        avatarImg.src = '';
        avatarImg.style.display = 'none';
        avatarIcon.style.display = 'block';
        avatarContainer.style.background = 'var(--ios-accent-light)';
        avatarContainer.style.borderColor = 'var(--ios-accent)';

        const uploadBtn = document.getElementById('avatar-upload-btn');
        if (uploadBtn) {
            uploadBtn.style.background = 'var(--ios-accent)';
        }
    }

    showToast('🗑️ Фото профиля удалено');
}

// ============================================
// TOAST УВЕДОМЛЕНИЕ
// ============================================
function showToast(message) {
    let toast = document.getElementById('custom-toast');
    if (toast) toast.remove();

    toast = document.createElement('div');
    toast.id = 'custom-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 120px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        color: white;
        padding: 12px 24px;
        border-radius: 14px;
        font-size: 15px;
        font-weight: 600;
        z-index: 99999;
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.32, 0.72, 0, 1);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        max-width: 90%;
        text-align: center;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 400);
    }, 2500);
}

// ============================================
// FAB — ПУЛЬСАЦИЯ И ТУЛТИП
// ============================================
let fabPulseRemoved = false;

function removeFabPulse() {
    if (fabPulseRemoved) return;
    const fab = document.getElementById('fab-add');
    if (fab) {
        fab.classList.remove('pulse');
        fabPulseRemoved = true;
    }
}

document.addEventListener('click', function (e) {
    const row = e.target.closest('.rcd-fuel, .rcd-repair');
    const myTip = document.getElementById('card-tooltip');

    if (myTip && !myTip.contains(e.target) && !row) closeCardTooltip();
    if (!row) return;

    setTimeout(() => {
        const moduleTip = document.querySelector(
            '.fuel-tooltip.visible:not(#card-tooltip), .repair-tooltip.visible:not(#card-tooltip)'
        );
        if (!moduleTip && !document.getElementById('card-tooltip')) {
            row.classList.contains('rcd-fuel') ?
                showCardFuelTooltip(row) :
                showCardRepairTooltip(row);
        }
        unifyTooltipHint();
    }, 150);
});

function unifyTooltipHint() {
    if (!window.matchMedia || !matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.fuel-tooltip-hint, .repair-tooltip-hint').forEach(h => {
        h.textContent = 'Тапните вне окна, чтобы закрыть';
    });
}

setTimeout(removeFabPulse, 10000);

document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (typeof window.openEntryModal === 'function') {
            window.openEntryModal();
        }
    }

    if (e.key === 'Escape' && document.getElementById('tab-entry')?.classList.contains('active')) {
        switchTab('home');
    }
});

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📱 DOM загружен, инициализация приложения...');

    window._homeTabInitialized = false;
    window._homeDataUpdated = false;

    (async function initApp() {
        console.log('🚀 Инициализация приложения...');

        await loadData();

        let fixed = false;
        records = records.map(r => {
            if (!r.recordType || r.recordType === '' || r.recordType === 'undefined') {
                fixed = true;
                r.recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
            }
            return normalizeRecord(r);
        });

        if (fixed) {
            console.log('✅ Исправлены некорректные recordType в localStorage');
            saveData();
        }

        const tariffForm = document.getElementById('tariff-form');
        if (tariffForm) {
            tariffForm.addEventListener('submit', saveTariff);
        }

        const mainContainer = document.querySelector('.container');
        const bottomNav = document.querySelector('.bottom-nav');
        const authScreen = document.getElementById('auth-screen');

        if (mainContainer) mainContainer.style.display = 'none';
        if (bottomNav) bottomNav.style.display = 'none';
        if (authScreen) authScreen.classList.remove('hidden');

        addFormValidation();

        console.log('✅ Базовая инициализация завершена. Ожидание авторизации...');
    })();

    initHistoryFilters();
    console.log('✅ Фильтры истории инициализированы');

    if (typeof window.renderUnifiedStatus === 'function') { window.renderUnifiedStatus(); }

    setTimeout(function () {
        if (typeof window.checkFirebaseConnection === 'function') {
            window.checkFirebaseConnection();
        }
    }, 3000);

    setInterval(function () {
        if (document.body.classList.contains('authenticated')) {
            if (typeof window.checkFirebaseConnection === 'function') {
                window.checkFirebaseConnection();
            }
        }
    }, 30000);
    console.log('✅ Индикатор подключения инициализирован');

    const nameEl = document.getElementById('profile-name');
    if (nameEl) {
        nameEl.addEventListener('dblclick', showEditNameDialog);
        nameEl.style.cursor = 'pointer';
        nameEl.title = 'Двойной клик для изменения имени';
    }
    console.log('✅ Имя пользователя инициализировано');

    const avatarContainer = document.getElementById('profile-avatar-container');
    if (avatarContainer) {
        let pressTimer = null;

        avatarContainer.addEventListener('mousedown', function () {
            pressTimer = setTimeout(function () {
                removeAvatar();
            }, 1000);
        });

        avatarContainer.addEventListener('mouseup', function () {
            clearTimeout(pressTimer);
        });

        avatarContainer.addEventListener('mouseleave', function () {
            clearTimeout(pressTimer);
        });

        avatarContainer.addEventListener('touchstart', function () {
            pressTimer = setTimeout(function () {
                removeAvatar();
            }, 1000);
        });

        avatarContainer.addEventListener('touchend', function () {
            clearTimeout(pressTimer);
        });

        avatarContainer.addEventListener('touchmove', function () {
            clearTimeout(pressTimer);
        });
    }

    loadProfileAvatar();
    console.log('✅ Аватар инициализирован');

    const fab = document.getElementById('fab-add');
    const tooltip = document.getElementById('fab-tooltip');

    if (fab && tooltip) {
        fab.addEventListener('mouseenter', function () {
            tooltip.style.opacity = '1';
            tooltip.style.transform = 'translateX(0) scale(1)';
        });

        fab.addEventListener('mouseleave', function () {
            tooltip.style.opacity = '0';
            tooltip.style.transform = 'translateX(10px) scale(0.9)';
        });

        let tooltipShown = false;
        fab.addEventListener('touchstart', function () {
            if (!tooltipShown) {
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateX(0) scale(1)';
                tooltipShown = true;
                setTimeout(() => {
                    tooltip.style.opacity = '0';
                    tooltip.style.transform = 'translateX(10px) scale(0.9)';
                }, 2000);
            }
        });
    }
    console.log('✅ FAB кнопка инициализирована');

    console.log('✅ Вкладка "Главная" ожидает авторизации...');
    console.log('✅ ВСЯ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА!');

    setTimeout(() => {
        restoreState();
    }, 500);
});

let _resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
        if (currentViewMode === 'auto') renderTable();
    }, 250);
});

const btnTable = document.getElementById('vmt-table');
const btnCards = document.getElementById('vmt-cards');
if (btnTable && btnCards) {
    if (currentViewMode === 'cards') {
        btnTable.classList.remove('active');
        btnCards.classList.add('active');
    } else if (currentViewMode === 'table') {
        btnTable.classList.add('active');
        btnCards.classList.remove('active');
    }
}

// ===== ГАРАНТИРОВАННАЯ ПРИВЯЗКА ФИЛЬТРОВ =====
document.addEventListener('DOMContentLoaded', function () {
    window.applyFilters = applyFilters;
    window.applySorting = applySorting;
    window.renderTable = renderTable;
    window.toggleFilter = toggleFilter;
    window.clearAllFilters = clearAllFilters;
    window.filterState = filterState;
    window.sortState = sortState;
    window.records = records;

    console.log('✅ Все функции и переменные экспортированы в window');

    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        console.log('✅ Строка фильтров найдена, display:', filterRow.style.display);
    } else {
        console.error('❌ Строка фильтров #filter-row НЕ НАЙДЕНА в HTML!');
    }
});

function updateFormVehicleSelects() {
    const vehicles = typeof window.getVehicles === 'function' ? window.getVehicles() : [{ id: 'default', name: 'Основной автомобиль', plate: 'Не указан' }];

    const optionsHTML = vehicles.map(v => `<option value="${v.id}">${v.name} (${v.plate})</option>`).join('');

    const fuelSelect = document.getElementById('fuel-vehicle-select');
    const repairSelect = document.getElementById('repair-vehicle-select');

    if (fuelSelect) fuelSelect.innerHTML = optionsHTML;
    if (repairSelect) repairSelect.innerHTML = optionsHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateFormVehicleSelects, 500);
});

const originalNotifyVehicleChanged = window.notifyVehicleChanged || function () { };
window.notifyVehicleChanged = function () {
    originalNotifyVehicleChanged();
    updateFormVehicleSelects();
};

// ============================================
// КНОПКИ «АВТО» И «ОТЧЁТЫ» С ВСПЛЫВАЮЩИМИ МЕНЮ
// ============================================
function toggleAutoMenu(e) {
    if (e) e.stopPropagation();
    togglePopupMenu('auto-menu', 'nav-auto-btn');
}
function toggleReportsMenu(e) {
    if (e) e.stopPropagation();
    togglePopupMenu('reports-menu', 'nav-reports-btn');
}
function togglePopupMenu(menuId, btnId) {
    const menu = document.getElementById(menuId);
    const btn = document.getElementById(btnId);
    if (!menu || !btn) return;
    const wasOpen = menu.classList.contains('open');
    closeAllMenus();
    if (wasOpen) return;

    const r = btn.getBoundingClientRect();
    const mw = 92;
    let left = r.left + r.width / 2 - mw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    menu.style.width = mw + 'px';
    menu.style.left = left + 'px';
    menu.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    menu.classList.add('open');
    btn.classList.add('menu-open');
}
function closeAllMenus() {
    ['auto-menu', 'reports-menu'].forEach(id => {
        const m = document.getElementById(id);
        if (m) m.classList.remove('open');
    });
    ['nav-auto-btn', 'nav-reports-btn'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.classList.remove('menu-open');
    });
}
function selectAutoTab(tab) { closeAllMenus(); switchTab(tab); }
function selectReportsTab(tab) { closeAllMenus(); switchTab(tab); }

document.addEventListener('click', function (e) {
    const menus = ['auto-menu', 'reports-menu'].map(id => document.getElementById(id)).filter(Boolean);
    const btns = ['nav-auto-btn', 'nav-reports-btn'].map(id => document.getElementById(id)).filter(Boolean);
    if (!menus.some(m => m.classList.contains('open'))) return;
    if (menus.some(m => m.contains(e.target))) return;
    if (btns.some(b => b.contains(e.target))) return;
    closeAllMenus();
});

// Обёртка switchTab для подсветки «Авто» и «Отчёты»
(function () {
    const origSwitchTab = window.switchTab;
    if (typeof origSwitchTab !== 'function') return;

    window.switchTab = function (tabName) {
        const autoBtn = document.getElementById('nav-auto-btn');
        const reportsBtn = document.getElementById('nav-reports-btn');
        if (autoBtn && (tabName === 'fuel' || tabName === 'repair')) {
            autoBtn.setAttribute('data-tab', tabName);
        }
        if (reportsBtn && (tabName === 'analytics' || tabName === 'history')) {
            reportsBtn.setAttribute('data-tab', tabName);
        }
        origSwitchTab.apply(this, arguments);

        document.querySelectorAll('#auto-menu .auto-menu-item').forEach(function (it) {
            it.classList.toggle('active', it.getAttribute('data-tab') === tabName);
        });
        document.querySelectorAll('#reports-menu .auto-menu-item').forEach(function (it) {
            it.classList.toggle('active', it.getAttribute('data-tab') === tabName);
        });
    };
})();

// ============================================
// FAB: МЕНЮ ДОБАВЛЕНИЯ
// ============================================
function toggleFabMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('fab-menu');
    const fab = document.getElementById('fab-add');
    if (!menu || !fab) return;

    if (menu.classList.contains('open')) { closeFabMenu(); return; }

    if (typeof closeAllMenus === 'function') closeAllMenus();

    const r = fab.getBoundingClientRect();
    const mw = 92;
    let left = r.left + r.width / 2 - mw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    menu.style.width = mw + 'px';
    menu.style.left = left + 'px';
    menu.style.bottom = (window.innerHeight - r.top + 12) + 'px';
    menu.classList.add('open');
    fab.classList.add('fab-open');
}

function closeFabMenu() {
    const menu = document.getElementById('fab-menu');
    const fab = document.getElementById('fab-add');
    if (menu) menu.classList.remove('open');
    if (fab) fab.classList.remove('fab-open');
}

function selectFabAction(action) {
    closeFabMenu();

    if (action === 'entry') {
        if (typeof window.openEntryModal === 'function') {
            window.openEntryModal();
        }
        return;
    }

    if (action === 'fuel') {
        if (typeof window.openFuelModal === 'function') {
            window.openFuelModal();
        } else {
            switchTab('fuel');
            setTimeout(() => scrollToFirstField('tab-fuel', ['fuel-form', 'fuel-log-form', 'add-fuel-form']), 350);
        }
        return;
    }

    if (action === 'repair') {
        if (typeof window.openRepairModal === 'function') {
            window.openRepairModal();
        } else {
            switchTab('repair');
            setTimeout(() => scrollToFirstField('tab-repair', ['repair-form', 'add-repair-form']), 350);
        }
        return;
    }
}

function scrollToFirstField(tabId, formIds) {
    let target = null;
    (formIds || []).forEach(id => { if (!target) target = document.getElementById(id); });
    if (!target) target = document.querySelector('#' + tabId + ' form');
    if (!target) target = document.querySelector('#' + tabId + ' input, #' + tabId + ' select');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusEl = (target.matches && target.matches('input,select')) ? target : target.querySelector('input,select');
    if (focusEl) {
        setTimeout(() => {
            try { focusEl.focus({ preventScroll: true }); } catch (e) { focusEl.focus(); }
        }, 450);
    }
}

document.addEventListener('click', function (e) {
    const menu = document.getElementById('fab-menu');
    const fab = document.getElementById('fab-add');
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target) || (fab && fab.contains(e.target))) return;
    closeFabMenu();
});

// ============================================
// СВОРАЧИВАНИЕ «УПРАВЛЕНИЕ ТАРИФАМИ»
// ============================================
(function () {
    function initTariffsCollapse() {
        if (document.getElementById('tariffs-collapse-done-v3')) return;

        const h2 = Array.from(document.querySelectorAll('h2'))
            .find(el => {
                const t = el.textContent.replace(/\s+/g, ' ').trim();
                return t.includes('Управление тарифами') || t.startsWith('Тариф');
            });
        if (!h2) return;
        const firstCard = h2.closest('.card') || h2.parentElement;
        if (!firstCard) return;

        const region1 = document.createElement('div');
        region1.className = 'collapse-region';
        const inner1 = document.createElement('div');
        inner1.className = 'collapse-inner';
        region1.appendChild(inner1);
        let node = h2.nextElementSibling;
        while (node) {
            const cur = node;
            node = node.nextElementSibling;
            inner1.appendChild(cur);
        }
        firstCard.appendChild(region1);

        const extraBlocks = [];
        let next = firstCard.nextElementSibling;
        while (next) {
            const heading = (next.querySelector('h2, h3') || {}).textContent || '';
            if (heading.includes('Массовые действия') || heading.includes('История тарифов')) {
                extraBlocks.push(next);
                next = next.nextElementSibling;
            } else break;
        }
        let region2 = null;
        if (extraBlocks.length) {
            region2 = document.createElement('div');
            region2.className = 'collapse-region';
            const inner2 = document.createElement('div');
            inner2.className = 'collapse-inner';
            region2.appendChild(inner2);
            firstCard.parentNode.insertBefore(region2, extraBlocks[0]);
            extraBlocks.forEach(b => inner2.appendChild(b));
        }

        region1.classList.add('collapsed');
        if (region2) region2.classList.add('collapsed');

        h2.classList.add('collapse-toggle');
        if (!h2.querySelector('.collapse-chevron')) {
            const chev = document.createElement('ion-icon');
            chev.setAttribute('name', 'chevron-down-outline');
            chev.className = 'collapse-chevron';
            h2.appendChild(chev);
        }
        h2.addEventListener('click', function () {
            const collapsed = !region1.classList.contains('collapsed');
            region1.classList.toggle('collapsed', collapsed);
            if (region2) region2.classList.toggle('collapsed', collapsed);
            h2.classList.toggle('open', !collapsed);
        });

        const mark = document.createElement('span');
        mark.id = 'tariffs-collapse-done-v3';
        mark.style.display = 'none';
        firstCard.appendChild(mark);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTariffsCollapse);
    } else {
        initTariffsCollapse();
    }
})();

// ============================================
// ШАПКА: автораспорка + живая дата
// ============================================
(function () {
    function syncSpacer() {
        const header = document.querySelector('.top-header');
        const spacer = document.getElementById('header-spacer');
        if (!header || !spacer) return;
        spacer.style.height = header.offsetHeight + 'px';
    }
    if ('ResizeObserver' in window) {
        const header = document.querySelector('.top-header');
        if (header) new ResizeObserver(syncSpacer).observe(header);
    }
    window.addEventListener('resize', syncSpacer);
    window.addEventListener('load', syncSpacer);
    setTimeout(syncSpacer, 300);
    setTimeout(syncSpacer, 1000);

    const sub = document.getElementById('header-subtitle');
    if (sub) {
        const s = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        sub.textContent = s.charAt(0).toUpperCase() + s.slice(1);
    }
})();

// ============================================
// СВОРАЧИВАНИЕ «МОИ АВТОМОБИЛИ»
// ============================================
(function () {
    function initVehiclesCollapse() {
        if (document.getElementById('vehicles-collapse-done-v2')) return;

        const h2 = Array.from(document.querySelectorAll('h2'))
            .find(el => el.textContent.includes('Мои автомобили'));
        if (!h2) return;
        const card = h2.closest('.card') || h2.parentElement;
        if (!card) return;

        const oldWrap = card.querySelector('.collapse-wrapper');
        if (oldWrap) {
            while (oldWrap.firstChild) card.insertBefore(oldWrap.firstChild, oldWrap);
            oldWrap.remove();
        }

        const region = document.createElement('div');
        region.className = 'collapse-region';
        const inner = document.createElement('div');
        inner.className = 'collapse-inner';
        region.appendChild(inner);
        let node = h2.nextElementSibling;
        while (node) {
            const cur = node;
            node = node.nextElementSibling;
            inner.appendChild(cur);
        }
        card.appendChild(region);

        region.classList.add('collapsed');

        h2.classList.add('collapse-toggle');
        if (!h2.querySelector('.collapse-chevron')) {
            const chev = document.createElement('ion-icon');
            chev.setAttribute('name', 'chevron-down-outline');
            chev.className = 'collapse-chevron';
            h2.appendChild(chev);
        }
        h2.addEventListener('click', function () {
            const collapsed = !region.classList.contains('collapsed');
            region.classList.toggle('collapsed', collapsed);
            h2.classList.toggle('open', !collapsed);
        });

        const mark = document.createElement('span');
        mark.id = 'vehicles-collapse-done-v2';
        mark.style.display = 'none';
        card.appendChild(mark);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVehiclesCollapse);
    } else {
        initVehiclesCollapse();
    }
})();

// ============================================
// iOS-СПИСКИ
// ============================================
function closeAllIosSelects() {
    document.querySelectorAll('.ios-select-wrap.open').forEach(w => w.classList.remove('open'));
}

function buildIosSelect(sel) {
    sel.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'ios-select-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    const display = document.createElement('button');
    display.type = 'button';
    display.className = 'ios-select-display';
    display.innerHTML = '<span class="ios-select-value"></span><ion-icon name="chevron-down-outline" class="chev"></ion-icon>';
    wrap.appendChild(display);

    const menu = document.createElement('div');
    menu.className = 'ios-select-menu';
    wrap.appendChild(menu);

    function rebuild() {
        menu.innerHTML = '';
        Array.from(sel.options).forEach(opt => {
            const row = document.createElement('div');
            row.className = 'ios-select-option';
            row.dataset.value = opt.value;
            row.innerHTML = '<span></span><ion-icon name="checkmark-circle"></ion-icon>';
            row.querySelector('span').textContent = opt.textContent;
            row.addEventListener('click', () => {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                sync();
                close();
            });
            menu.appendChild(row);
        });
    }

    function sync() {
        const opt = sel.options[sel.selectedIndex];
        display.querySelector('.ios-select-value').textContent = opt ? opt.textContent : '';
        menu.querySelectorAll('.ios-select-option').forEach(r =>
            r.classList.toggle('selected', r.dataset.value === sel.value));
    }

    function open() {
        closeAllIosSelects();
        rebuild();
        sync();
        wrap.classList.add('open');
        const selRow = menu.querySelector('.selected');
        if (selRow) setTimeout(() => selRow.scrollIntoView({ block: 'nearest' }), 60);
    }
    function close() { wrap.classList.remove('open'); }

    display.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.classList.contains('open') ? close() : open();
    });
    menu.addEventListener('click', e => e.stopPropagation());

    new MutationObserver(() => { wrap.classList.contains('open') ? rebuild() : sync(); })
        .observe(sel, { childList: true, subtree: true, characterData: true });

    sel.addEventListener('change', sync);
    setInterval(() => {
        const opt = sel.options[sel.selectedIndex];
        const cur = display.querySelector('.ios-select-value').textContent;
        if (opt && opt.textContent !== cur) sync();
    }, 600);

    sync();
}

function initCustomSelects() {
    const monthRe = /январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр/i;
    const yearRe = /все годы|^\d{4}$/i;

    document.querySelectorAll('select').forEach(sel => {
        if (sel.dataset.iosDone) return;
        const texts = Array.from(sel.options).map(o => o.textContent.trim());
        const isMonth = texts.some(t => monthRe.test(t));
        const isYear = texts.some(t => yearRe.test(t));
        const periodRe = /все время|этот месяц|месяца|полгода|недел|период|^\s*год\s*$/i;
        const isPeriod = texts.some(t => periodRe.test(t));
        const catRe = /все категории|категори|двигатель|трансмисс|тормозн|подвеск|электрик|кузов|шины|диски|масло|жидкост|охлажден|выхлопн|прочее/i;
        const isCategory = texts.some(t => catRe.test(t));
        if (!isMonth && !isYear && !isPeriod && !isCategory) return;
        sel.dataset.iosDone = '1';
        buildIosSelect(sel);
    });
}

document.addEventListener('click', closeAllIosSelects);
document.addEventListener('scroll', (e) => {
    if (e.target && e.target.closest && e.target.closest('.ios-select-menu')) return;
    closeAllIosSelects();
}, true);
window.addEventListener('resize', closeAllIosSelects);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomSelects);
} else {
    initCustomSelects();
}

let _iosTries = 0;
const _iosTimer = setInterval(() => {
    initCustomSelects();
    if (++_iosTries > 20) clearInterval(_iosTimer);
}, 1000);

new MutationObserver(() => initCustomSelects())
    .observe(document.body, { childList: true, subtree: true });

// ============================================
// ФИКС: ИСТОРИЯ — мгновенный пересчёт
// ============================================
document.addEventListener('change', function (e) {
    const sel = e.target;
    if (!sel || sel.tagName !== 'SELECT' || !sel.dataset.iosDone) return;
    if (!sel.closest('#tab-history')) return;

    setTimeout(() => {
        const card = sel.closest('.card');

        if (card) {
            const btn = card.querySelector('.btn-primary');
            if (btn) {
                btn.click();
                console.log('✅ Клик по кнопке фильтров Истории');
            }
        }

        if (typeof window.renderTable === 'function') {
            window.renderTable();
            console.log('✅ renderTable() вызван напрямую');
        }
    }, 60);
});

// ============================================
// ТЁМНАЯ ТЕМА
// ============================================
(function () {
    const KEY = 'driverTheme';
    const toggle = document.getElementById('theme-toggle');

    function applyTheme(dark) {
        document.body.classList.toggle('dark-theme', dark);
        document.documentElement.style.background = dark ? '#000000' : '#F2F2F7';
        if (toggle) toggle.checked = dark;

        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.content = dark ? '#000000' : '#F2F2F7';
        console.log(dark ? '🌙 Тёмная тема включена' : '☀️ Светлая тема включена');
    }

    const saved = localStorage.getItem(KEY);
    const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved === 'dark' : prefersDark);

    if (toggle) {
        toggle.addEventListener('change', function () {
            const dark = this.checked;
            localStorage.setItem(KEY, dark ? 'dark' : 'light');
            applyTheme(dark);
            showToast(dark ? '🌙 Тёмная тема включена' : '☀️ Светлая тема включена');
        });
    } else {
        console.warn('⚠️ #theme-toggle не найден в DOM');
    }
})();

// Помечаем «Детальная статистика» И «Тренды за месяц»
(function () {
    const targets = ['детальная статистика', 'тренды за месяц'];
    const doneMap = {};

    function tagSection(text) {
        if (doneMap[text]) return true;
        const heading = Array.from(
            document.querySelectorAll('#tab-home h1, #tab-home h2, #tab-home h3, #tab-home h4')
        ).find(el => el.textContent.toLowerCase().includes(text));
        if (!heading) return false;

        const card = heading.closest('.card') || heading.parentElement;

        let cells = [];
        const grid = heading.nextElementSibling;
        if (grid && grid.children.length) cells = Array.from(grid.children);
        if (!cells.length) cells = Array.from(card.querySelectorAll('.stat-card, .stats-grid > *'));
        if (!cells.length) cells = Array.from(card.children).filter(c => c !== heading);

        cells.forEach(el => el.classList.add('ds-cell'));
        doneMap[text] = true;
        console.log('✅ Секция «' + text + '» помечена, ячеек:', cells.length);
        return true;
    }

    function tagAll() { return targets.every(t => tagSection(t)); }

    let tries = 0;
    const timer = setInterval(() => {
        if (tagAll() || ++tries > 30) clearInterval(timer);
    }, 1000);

    const home = document.getElementById('tab-home');
    if (home) {
        new MutationObserver(() => tagAll()).observe(home, { childList: true, subtree: true });
    }
    tagAll();
})();

// Подсветка шестерёнки при открытии настроек
(function () {
    const orig = window.switchTab;
    if (typeof orig !== 'function') return;
    window.switchTab = function (tab, e) {
        const res = orig.call(this, tab, e);
        const btn = document.getElementById('header-settings-btn');
        if (btn) btn.classList.toggle('active', tab === 'settings');
        return res;
    };
})();

// ============================================
// СТОП-ПОДЁРГИВАНИЕ: гасим анимации карточки профиля
// ============================================
(function () {
    const home = document.getElementById('tab-home');
    if (!home) return;

    function killAnims() {
        const card = home.querySelector('.card');
        if (!card) return;
        [card, ...card.querySelectorAll('*')].forEach(el => {
            if (el.getAnimations) el.getAnimations().forEach(a => a.cancel());
        });
    }

    new MutationObserver(killAnims).observe(home, { childList: true, subtree: true });
    killAnims();
})();

// ============================================
// ТЁМНАЯ ТЕМА: кнопка-пилюля
// ============================================
(function () {
    const KEY = 'driverTheme';

    function applyTheme(dark) {
        document.body.classList.toggle('dark-theme', dark);
        document.documentElement.style.background = dark ? '#000000' : '#F2F2F7';
        const old = document.getElementById('theme-toggle');
        if (old) old.checked = dark;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.content = dark ? '#000000' : '#F2F2F7';
    }

    const saved = localStorage.getItem(KEY);
    const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved === 'dark' : prefersDark);

    document.addEventListener('click', function (e) {
        const btn = e.target.closest('#theme-toggle-btn');
        if (!btn) return;
        const dark = !document.body.classList.contains('dark-theme');
        localStorage.setItem(KEY, dark ? 'dark' : 'light');
        applyTheme(dark);
        if (window.showToast) showToast(dark ? '🌙 Тёмная тема' : '☀️ Светлая тема');
    });
})();

// ============================================
// КРАСИВЫЕ АЛЕРТЫ (iOS-стиль)
// ============================================
(function () {
    window.showIOSAlert = function (message) {
        const lines = String(message).split('\n').map(s => s.trim()).filter(Boolean);
        const title = lines[0] || '';
        const body = lines.slice(1)
            .map(s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
            .join('<br>');

        const overlay = document.createElement('div');
        overlay.className = 'ios-alert-overlay';
        overlay.innerHTML = `
            <div class="ios-alert">
                <div class="ios-alert-title">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
                ${body ? `<div class="ios-alert-body">${body}</div>` : ''}
                <button class="ios-alert-btn">OK</button>
            </div>`;
        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add('visible'));

        const close = (e) => {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 250);
        };

        overlay.querySelector('.ios-alert-btn').addEventListener('click', close);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(e);
        });
    };

    window.alert = window.showIOSAlert;
})();

// ============================================
// ТУЛТИПЫ БЕНЗИНА/РЕМОНТА В КАРТОЧКАХ
// ============================================
function _cardNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function getRepairCategoryName(cat) {
    if (!cat) return 'Ремонт';
    if (/[а-яА-Я]/.test(cat)) return cat;
    const ext = window.REPAIR_CATEGORIES || window.repairCategories;
    if (ext) {
        if (!Array.isArray(ext) && ext[cat]) return ext[cat].name || ext[cat].label || ext[cat];
        if (Array.isArray(ext)) {
            const found = ext.find(c => (c.value || c.id) === cat);
            if (found) return found.label || found.name;
        }
    }
    const map = {
        engine: 'Двигатель', transmission: 'Трансмиссия',
        brakes: 'Тормозная система', brake: 'Тормозная система',
        suspension: 'Подвеска', electrical: 'Электрика', electric: 'Электрика',
        body: 'Кузов', tires: 'Шины/Диски', wheels: 'Шины/Диски',
        oil: 'Масло/Жидкости', fluids: 'Масло/Жидкости',
        cooling: 'Охлаждение', exhaust: 'Выхлопная система', other: 'Прочее'
    };
    if (map[cat]) return map[cat];
    return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function closeCardTooltip() {
    const t = document.getElementById('card-tooltip');
    if (t) { t.classList.remove('visible'); setTimeout(() => t.remove(), 250); }
}

function positionCardTooltip(tip, anchor) {
    if (window.innerWidth <= 480) return;
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 12) top = r.top - th - 8;
    if (top < 12) top = 12;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
}

function showCardFuelTooltip(row) {
    closeCardTooltip();
    let details = [];
    try { details = JSON.parse(row.getAttribute('data-fuel-details') || '[]'); } catch (e) { details = []; }
    const liters = _cardNum(row.getAttribute('data-fuel-liters'));
    const count = _cardNum(row.getAttribute('data-fuel-count')) || details.length;
    const total = _cardNum(row.getAttribute('data-fuel-total'));

    const detailsHTML = details.map(d => {
        let name = d.vehicleName || d.vehicle || d.name;
        if (!name && d.vehicleId && typeof window.getVehicleNameById === 'function') {
            name = window.getVehicleNameById(d.vehicleId);
        }
        if (!name) name = 'Заправка';
        const plate = d.plate ? ' (' + d.plate + ')' : '';
        const lit = _cardNum(d.liters !== undefined ? d.liters : d.l);
        const mile = _cardNum(d.mileage !== undefined ? d.mileage : (d.odometer !== undefined ? d.odometer : d.km));
        const amount = _cardNum(d.amount !== undefined ? d.amount : (d.cost !== undefined ? d.cost : (d.sum !== undefined ? d.sum : d.price)));
        const comment = d.comment || d.note || '';
        return `
        <div class="fuel-tooltip-detail-item">
            <div class="detail-info">
                <div style="font-weight:600;color:var(--ios-accent);">${name}${plate}</div>
                ${(lit || mile) ? `<div class="detail-liters">⛽ ${lit ? lit.toFixed(2) + ' л' : ''}${lit && mile ? ' · ' : ''}${mile ? mile + ' км' : ''}</div>` : ''}
                ${comment ? `<div class="detail-comment">${comment}</div>` : ''}
            </div>
            <div class="detail-amount">${formatMoney(amount)}</div>
        </div>`;
    }).join('');

    const tip = document.createElement('div');
    tip.className = 'fuel-tooltip visible';
    tip.id = 'card-tooltip';
    tip.innerHTML = `
        <div class="fuel-tooltip-header">
            <ion-icon name="fuel-outline"></ion-icon>
            <h4>Подробности заправок</h4>
        </div>
        <div class="fuel-tooltip-summary">
            <div class="fuel-tooltip-summary-item"><div class="label">Заправок</div><div class="value">${count}</div></div>
            <div class="fuel-tooltip-summary-item"><div class="label">Литров</div><div class="value">${liters ? liters.toFixed(1) : '—'}</div></div>
            <div class="fuel-tooltip-summary-item"><div class="label">Сумма</div><div class="value">${formatMoney(total)}</div></div>
        </div>
        <div class="fuel-tooltip-details">${detailsHTML || '<div style="padding:10px;text-align:center;color:var(--ios-text-tertiary);font-size:13px;">Нет деталей</div>'}</div>
        <div class="fuel-tooltip-hint">Тапните вне окна, чтобы закрыть</div>`;
    document.body.appendChild(tip);
    positionCardTooltip(tip, row);
}

function showCardRepairTooltip(row) {
    closeCardTooltip();
    let details = [];
    try { details = JSON.parse(row.getAttribute('data-repair-details') || '[]'); } catch (e) { details = []; }
    const total = _cardNum(row.getAttribute('data-repair-total'));
    const count = _cardNum(row.getAttribute('data-repair-count')) || details.length;

    const detailsHTML = details.map(d => {
        const category = getRepairCategoryName(d.category);
        const title = d.title || d.name || category;
        const description = d.description || d.desc || '';
        const amount = _cardNum(d.amount !== undefined ? d.amount : (d.cost !== undefined ? d.cost : d.total));
        const date = d.date ? formatDate(d.date) : '';
        const mile = _cardNum(d.mileage !== undefined ? d.mileage : (d.odometer !== undefined ? d.odometer : d.km));
        const parts = Array.isArray(d.parts) ? d.parts : [];
        const works = Array.isArray(d.works) ? d.works : [];
        const partsHTML = parts.length ? `<div class="repair-tooltip-detail-parts"><div class="label">Запчасти:</div>${parts.map(p => `<div class="item">• ${p.name || p.title || ''}${p.cost ? ' — ' + formatMoney(_cardNum(p.cost)) : ''}</div>`).join('')}</div>` : '';
        const worksHTML = works.length ? `<div class="repair-tooltip-detail-works"><div class="label">Работы:</div>${works.map(w => `<div class="item">• ${w.name || w.title || ''}${w.cost ? ' — ' + formatMoney(_cardNum(w.cost)) : ''}</div>`).join('')}</div>` : '';
        return `
        <div class="repair-tooltip-detail-item">
            <div class="repair-tooltip-detail-header">
                <div class="repair-tooltip-detail-title">${title}</div>
                <div class="repair-tooltip-detail-amount">${formatMoney(amount)}</div>
            </div>
            ${(date || mile) ? `<div class="repair-tooltip-detail-meta">${date}${date && mile ? ' · ' : ''}${mile ? mile + ' км' : ''}</div>` : ''}
            ${description ? `<div class="repair-tooltip-detail-meta" style="font-style:italic;">${description}</div>` : ''}
            ${partsHTML}${worksHTML}
        </div>`;
    }).join('');

    const tip = document.createElement('div');
    tip.className = 'repair-tooltip visible';
    tip.id = 'card-tooltip';
    tip.innerHTML = `
        <div class="repair-tooltip-header">
            <ion-icon name="construct-outline"></ion-icon>
            <h4>Подробности ремонтов</h4>
        </div>
        <div class="repair-tooltip-summary">
            <div class="repair-tooltip-summary-item"><div class="label">Ремонтов</div><div class="value">${count}</div></div>
            <div class="repair-tooltip-summary-item"><div class="label">Сумма</div><div class="value">${formatMoney(total)}</div></div>
            <div class="repair-tooltip-summary-item"><div class="label">Средний чек</div><div class="value">${count ? formatMoney(total / count) : '0 ₽'}</div></div>
        </div>
        <div class="repair-tooltip-details">${detailsHTML || '<div style="padding:10px;text-align:center;color:var(--ios-text-tertiary);font-size:13px;">Нет деталей</div>'}</div>
        <div class="repair-tooltip-hint">Тапните вне окна, чтобы закрыть</div>`;
    document.body.appendChild(tip);
    positionCardTooltip(tip, row);
}

document.addEventListener('click', function (e) {
    const fuelRow = e.target.closest('.rcd-fuel');
    const repairRow = e.target.closest('.rcd-repair');
    const tip = document.getElementById('card-tooltip');

    if (fuelRow || repairRow) {
        const target = fuelRow || repairRow;
        const wasOpen = !!tip;
        closeCardTooltip();
        setTimeout(() => {
            if (fuelRow) showCardFuelTooltip(target);
            else showCardRepairTooltip(target);
        }, wasOpen ? 260 : 0);
        return;
    }
    if (tip && !tip.contains(e.target)) closeCardTooltip();
});
window.addEventListener('scroll', function (e) {
    const tip = document.getElementById('card-tooltip');
    if (tip && (e.target === tip || tip.contains(e.target))) return;
    closeCardTooltip();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCardTooltip(); });

document.addEventListener('keydown', function (e) {
    const modal = document.getElementById('name-modal-overlay');
    if (modal && modal.classList.contains('visible')) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveNameModal();
        }
        if (e.key === 'Escape') {
            closeNameModal();
        }
    }
});

// Прямая привязка тултипов к таблице (обходим fuel-module.js)
document.addEventListener('click', function(e) {
    const fuelCell = e.target.closest('td.fuel-cell-with-details');
    const repairCell = e.target.closest('td.repair-cell-with-details');
    const existingTip = document.getElementById('card-tooltip');

    // Если клик по ячейке таблицы — открываем тултип из script.js
    if (fuelCell || repairCell) {
        if (existingTip) existingTip.remove();

        if (fuelCell) {
            showCardFuelTooltip(fuelCell);
        } else {
            showCardRepairTooltip(repairCell);
        }
        return;
    }

    // Клик вне тултипа — закрываем
    if (existingTip && !existingTip.contains(e.target)) {
        closeCardTooltip();
    }
});

// ============================================
// СИНХРОНИЗАЦИЯ С WINDOW
// ============================================
function syncGlobalsToWindow() {
    window.records = records;
    window.tariffs = tariffs;
    window.currentUser = currentUser;
    window.connectionMode = connectionMode;
    window.firebaseErrorReason = firebaseErrorReason;
    window.fuelLogs = fuelLogs;
}

window.syncGlobalsToWindow = syncGlobalsToWindow;

// Экспорт функций (без updateHomeTab/updateGoals/saveGoalsToFirebase — они в home-module.js)
window.loadUserData = loadUserData;
window.loadData = loadData;
window.saveData = saveData;
window.normalizeRecord = normalizeRecord;
window.normalizeTariff = normalizeTariff;
window.renderTable = renderTable;
window.renderTariffs = renderTariffs;
window.populateFilters = populateFilters;
window.updateAnalytics = updateAnalytics;
window.loadProfileAvatar = loadProfileAvatar;
window.showToast = showToast;