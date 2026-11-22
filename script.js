// ==========================================
// script.js — ЯДРО ПРИЛОЖЕНИЯ (v5.2)
// ==========================================
// Что здесь:
//   • данные records/tariffs + Firebase sync
//   • утилиты (parseLocalDate, formatMoney, formatDate, calcIncome, calcExpenses)
//   • нормализация записей/тарифов
//   • рендер таблицы/карточек/аналитики/сравнения
//   • навигация (switchTab, меню FAB/отчётов/авто)
//   • фильтры/сортировка/пагинация
//   • профиль: аватар, имя (связано с loadUserData / Firestore)
//   • тёмная тема, iOS-алерты, iOS-селекты, сворачивание секций
//   • каркас тултипов для модулей (__tooltipShow/Close)
//
// Чего здесь НЕТ (в модулях):
//   • топливо → fuel-module.js
//   • ремонт  → repair-module.js
//   • авто    → vehicle-module.js
//   • главная → home-module.js (дашборд, цели, достижения)
//   • смены   → shift-module.js
//   • ввод дня → entry-module.js (вся логика модалки)
//   • бэкап   → backup-module.js
//   • control center → control-center.js
// ==========================================

// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ==========================================
let records = [];
let tariffs = [];

let incomeChart = null;
let expensesChart = null;
let comparisonChart = null;

let currentHistoryPage = 1;
const RECORDS_PER_PAGE = 20;
let showAllHistoryMode = false;

let currentHistoryMonth = null;
let currentHistoryYear = null;

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

let currentViewMode = localStorage.getItem('historyViewMode') || 'auto';

let connectionMode = 'checking';
let firebaseErrorReason = '';

const AVATAR_STORAGE_KEY = 'driverProfileAvatar';

// ============================================
// ПЕРЕХВАТЧИК FIREBASE LISTENERS
// ============================================
window._fbListeners = [];
window._isLoggingOut = false;

(function patchOnSnapshot() {
    if (typeof db === 'undefined') return;
    const original = firebase.firestore.Query.prototype.onSnapshot;
    if (!original || original.__patched) return;

    firebase.firestore.Query.prototype.onSnapshot = function (...args) {
        const unsub = original.apply(this, args);
        window._fbListeners.push(unsub);
        return function (...uargs) {
            const idx = window._fbListeners.indexOf(unsub);
            if (idx !== -1) window._fbListeners.splice(idx, 1);
            return unsub.apply(this, uargs);
        };
    };
    firebase.firestore.Query.prototype.onSnapshot.__patched = true;
})();

// Подавление permission-denied при выходе
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

// ============================================
// УТИЛИТЫ
// ============================================
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const p = String(dateStr).split('-');
    if (p.length !== 3) return new Date(dateStr);
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

function formatMoney(n) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency', currency: 'RUB', minimumFractionDigits: 2
    }).format(Number(n) || 0);
}

function formatDate(s) {
    if (!s) return '-';
    const d = parseLocalDate(s);
    return d ? d.toLocaleDateString('ru-RU') : s;
}

function calcIncome(r) {
    return (r.payPickup || 0) + (r.payDelivery || 0) + (r.payDistance || 0) +
        (r.payWeight || 0) + (r.loadPay || 0) + (r.bonusPay || 0) +
        (r.rating || 0) + (r.tips || 0);
}

function calcExpenses(r) {
    return (r.fuelCost || 0) + (r.repairCost || 0) + (r.tax || 0);
}

function normalizeRecord(r) {
    let recordType = r.recordType;
    if (!recordType || recordType === '' || recordType === 'undefined') {
        recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
    }
    return {
        ...r,
        date: typeof r.date === 'string' ? r.date.trim() : r.date,
        weekday: typeof r.weekday === 'string'
            ? (r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase())
            : r.weekday,
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

function showToast(message) {
    let toast = document.getElementById('custom-toast');
    if (toast) toast.remove();

    toast = document.createElement('div');
    toast.id = 'custom-toast';
    toast.style.cssText = `
        position: fixed; bottom: 120px; left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(0,0,0,.8);
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        color:#fff; padding:12px 24px; border-radius:14px;
        font-size:15px; font-weight:600; z-index:99999;
        opacity:0; transition: all .4s cubic-bezier(.32,.72,0,1);
        box-shadow: 0 8px 32px rgba(0,0,0,.2);
        max-width:90%; text-align:center; pointer-events:none;
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",sans-serif;
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
        setTimeout(() => toast.parentNode && toast.remove(), 400);
    }, 2500);
}

function syncGlobalsToWindow() {
    window.records = records;
    window.tariffs = tariffs;
    window.connectionMode = connectionMode;
    window.firebaseErrorReason = firebaseErrorReason;
    window.filterState = filterState;
    window.sortState = sortState;
}

// ============================================
// FIREBASE: ЗАГРУЗКА ДАННЫХ
// ============================================
async function loadUserData() {
    if (!window.currentUser) return;

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
            db.collection('users').doc(window.currentUser.uid).collection('records').orderBy('date', 'desc').get(),
            db.collection('users').doc(window.currentUser.uid).collection('tariffs').orderBy('date', 'desc').get(),
            db.collection('users').doc(window.currentUser.uid).get()
        ]);

        records = recordsSnap.docs.map(d => normalizeRecord({ id: d.id, ...d.data() }));
        console.log('✅ Загружено записей:', records.length);

        tariffs = tariffsSnap.docs.map(d => normalizeTariff({ id: d.id, ...d.data() }));
        console.log('✅ Загружено тарифов:', tariffs.length);

        if (tariffs.length === 0) {
            const defaultTariff = {
                date: new Date().toISOString().split('T')[0],
                pickup: 60, delivery: 81, km: 11, weight: 2
            };
            const ref = await db.collection('users').doc(window.currentUser.uid)
                .collection('tariffs').add(defaultTariff);
            tariffs.push(normalizeTariff({ id: ref.id, ...defaultTariff }));
        }

        const userData = userDoc.exists ? userDoc.data() : {};
        if (userData.avatar) {
            try {
                localStorage.setItem(AVATAR_STORAGE_KEY, userData.avatar);
                loadProfileAvatar();
            } catch (e) { console.warn('⚠️ Аватар слишком большой для localStorage'); }
        }

        saveData();
        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();
        if (typeof window.updateHomeTab === 'function') window.updateHomeTab();
        if (typeof window.updateGoals === 'function') window.updateGoals();

        connectionMode = 'firebase';
        firebaseErrorReason = '';
        syncGlobalsToWindow();
        if (typeof window.renderUnifiedStatus === 'function') window.renderUnifiedStatus();
        console.log('✅ Все данные успешно загружены!');
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        await loadData();
        connectionMode = 'local';
        firebaseErrorReason = error.message || 'Ошибка загрузки данных';
        syncGlobalsToWindow();
        if (typeof window.renderUnifiedStatus === 'function') window.renderUnifiedStatus();

        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();
        if (typeof window.updateHomeTab === 'function') window.updateHomeTab();
        if (typeof window.updateGoals === 'function') window.updateGoals();
        alert('⚠️ Ошибка загрузки: ' + error.message + '\nДанные взяты из локального кэша.');
    }
}

async function loadData() {
    try {
        console.log('🔄 Загрузка данных из localStorage...');
        const savedRecords = localStorage.getItem('driverRecords');
        const savedTariffs = localStorage.getItem('driverTariffs');
        if (savedRecords) records = JSON.parse(savedRecords).map(normalizeRecord);
        if (savedTariffs) tariffs = JSON.parse(savedTariffs).map(normalizeTariff);
        syncGlobalsToWindow();
        console.log('✅ Локальные данные загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки из localStorage:', error);
    }
}

function saveData() {
    try {
        localStorage.setItem('driverRecords', JSON.stringify(records));
        localStorage.setItem('driverTariffs', JSON.stringify(tariffs));
        syncGlobalsToWindow();
    } catch (error) {
        console.error('❌ Ошибка сохранения в localStorage:', error);
    }
}

// ============================================
// FIREBASE: СОХРАНЕНИЕ ЗАПИСЕЙ
// ============================================
async function saveRecordToFirebase(record) {
    if (!window.currentUser) return;
    try {
        const recordToSave = { ...record };
        delete recordToSave.id;
        const ref = db.collection('users').doc(window.currentUser.uid).collection('records');
        if (!record.id || !records.find(r => r.id === record.id)) {
            const docRef = await ref.add(recordToSave);
            record.id = docRef.id;
        } else {
            await ref.doc(record.id).set(recordToSave);
        }
        console.log('✅ Запись сохранена в Firebase');
        if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
    }
}

async function saveRecordsBatchToFirebase(recordsToUpdate) {
    if (!window.currentUser || !recordsToUpdate.length) return;
    try {
        const ref = db.collection('users').doc(window.currentUser.uid).collection('records');
        const BATCH_SIZE = 400;
        for (let i = 0; i < recordsToUpdate.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = recordsToUpdate.slice(i, i + BATCH_SIZE);
            for (const r of chunk) {
                const payload = { ...r };
                delete payload.id;
                batch.set(ref.doc(r.id), payload);
            }
            await batch.commit();
        }
        console.log(`✅ Пакетно сохранено ${recordsToUpdate.length} записей в Firebase`);
        if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
    } catch (error) {
        console.error('❌ Ошибка пакетного сохранения:', error);
    }
}

async function deleteRecordFromFirebase(id) {
    if (!window.currentUser) return;
    try {
        await db.collection('users').doc(window.currentUser.uid).collection('records').doc(id).delete();
        console.log('✅ Запись удалена из Firebase');
        if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
    } catch (error) {
        console.error('❌ Ошибка удаления:', error);
    }
}

// ============================================
// ТАРИФЫ
// ============================================
const DEFAULT_TARIFF = { pickup: 60, delivery: 81, km: 11, weight: 2 };

function getTariffForDate(dateStr) {
    if (!tariffs || tariffs.length === 0) return DEFAULT_TARIFF;
    const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!dateStr) return sorted[0];
    for (const t of sorted) if (t.date <= dateStr) return t;
    return sorted[sorted.length - 1];
}

function getCurrentTariff() {
    return getTariffForDate(new Date().toISOString().split('T')[0]);
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
        if (!confirm('Тариф на эту дату уже существует. Заменить?')) return;
        tariffs[idx] = tariff;
    } else {
        tariffs.push(tariff);
    }
    tariffs.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (window.currentUser) {
        try {
            const payload = { ...tariff };
            delete payload.id;
            const ref = await db.collection('users').doc(window.currentUser.uid)
                .collection('tariffs').add(payload);
            const j = tariffs.findIndex(t => t.date === tariff.date);
            if (j >= 0) tariffs[j].id = ref.id;
            if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
        } catch (error) {
            console.error('❌ Ошибка сохранения тарифа:', error);
        }
    }

        saveData();
    showToast('✅ Тариф сохранен!'); // ✅ Маленькое всплывающее уведомление снизу
    document.getElementById('tariff-form').reset();
    renderTariffs();
    if (typeof window.updateTariffDisplay === 'function') window.updateTariffDisplay();
    }

async function deleteTariff(id) {
    if (tariffs.length <= 1) { alert('Нельзя удалить последний тариф!'); return; }
    if (!confirm('Удалить этот тариф?')) return;
    if (window.currentUser) {
        try {
            await db.collection('users').doc(window.currentUser.uid)
                .collection('tariffs').doc(id).delete();
            if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
        } catch (error) { console.error('❌ Ошибка удаления тарифа:', error); }
    }
    tariffs = tariffs.filter(t => t.id !== id);
    saveData();
    renderTariffs();
    if (typeof window.updateTariffDisplay === 'function') window.updateTariffDisplay();
}

function recalculateAllTariffs() {
    if (records.length === 0) { alert('Нет записей для пересчёта'); return; }
    if (!confirm('⚠️ Пересчитать ВСЕ записи по актуальным тарифам на их даты?\n\nПоля, изменённые вручную, будут пропущены.')) return;

    let changedCount = 0, skippedCount = 0;
    const toUpdate = [];

    records = records.map(r => {
        const t = getTariffForDate(r.date);
        if (!t) return r;
        const me = r.manualEdits || [];
        const newPayPickup = me.includes('payPickup') ? r.payPickup : Math.round((r.ordersPickup || 0) * t.pickup * 100) / 100;
        const newPayDelivery = me.includes('payDelivery') ? r.payDelivery : Math.round((r.ordersDelivery || 0) * t.delivery * 100) / 100;
        const newPayDistance = me.includes('payDistance') ? r.payDistance : Math.round((r.distance || 0) * t.km * 100) / 100;
        const newPayWeight = me.includes('payWeight') ? r.payWeight : Math.round((r.weight || 0) * t.weight * 100) / 100;

        const changed = newPayPickup !== r.payPickup || newPayDelivery !== r.payDelivery ||
            newPayDistance !== r.payDistance || newPayWeight !== r.payWeight;

        if (changed) {
            changedCount++;
            const updated = normalizeRecord({
                ...r, payPickup: newPayPickup, payDelivery: newPayDelivery,
                payDistance: newPayDistance, payWeight: newPayWeight
            });
            toUpdate.push(updated);
            return updated;
        }
        skippedCount++;
        return r;
    });

    saveData();
    if (window.currentUser && toUpdate.length > 0) saveRecordsBatchToFirebase(toUpdate);
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
    const current = getCurrentTariff();
    sorted.forEach(t => {
        const isCur = current && t.id === current.id;
        const div = document.createElement('div');
        div.className = 'tariff-item' + (isCur ? ' current' : '');
        div.innerHTML = `
            <div class="tariff-date">
                <ion-icon name="calendar-outline" style="font-size:24px;vertical-align:middle;margin-right:6px;color:var(--ios-accent);"></ion-icon>
                ${formatDate(t.date)}
                ${isCur ? '<span style="color:#10b981;font-weight:bold"> (действует)</span>' : ''}
            </div>
            <div class="tariff-values">
                <span><ion-icon name="arrow-down-circle-outline" class="tariff-icon pickup-icon"></ion-icon> ${t.pickup} ₽/шт</span>
                <span><ion-icon name="arrow-up-circle-outline" class="tariff-icon delivery-icon"></ion-icon> ${t.delivery} ₽/шт</span>
                <span><ion-icon name="navigate-outline" class="tariff-icon km-icon"></ion-icon> ${t.km} ₽/км</span>
                <span><ion-icon name="scale-outline" class="tariff-icon weight-icon"></ion-icon> ${t.weight} ₽/кг</span>
            </div>
            <div class="tariff-actions">
                <button class="btn btn-danger" onclick="deleteTariff('${t.id}')">
                    <ion-icon name="trash-outline" style="font-size:20px;vertical-align:middle;margin-right:6px;"></ion-icon>
                    Удалить
                </button>
            </div>`;
        list.appendChild(div);
    });
}

// ============================================
// ФИЛЬТРЫ/СОРТИРОВКА
// ============================================
function toggleFilter(column) {
    const row = document.getElementById('filter-row');
    if (!row) return;
    if (row.style.display === 'none' || row.style.display === '') {
        row.style.display = 'table-row';
        currentFilterColumn = column;
        renderFilterUI(column);
    } else if (currentFilterColumn === column) {
        row.style.display = 'none';
        currentFilterColumn = null;
    } else {
        currentFilterColumn = column;
        renderFilterUI(column);
    }
}

function renderFilterUI(column) {
    Object.keys(filterState).forEach(col => {
        const cell = document.getElementById('filter-' + col);
        if (!cell) return;
        if (col === column) {
            cell.style.display = 'table-cell';
            buildFilterControls(col, cell);
        } else {
            cell.style.display = 'none';
            cell.innerHTML = '';
        }
    });
}

function buildFilterControls(column, container) {
    container.innerHTML = '';
    if (column === 'date') {
        const select = document.createElement('select');
        select.style.cssText = 'width:100%;padding:6px;font-size:12px;border:1px solid #ccc;border-radius:6px;';
        select.innerHTML = '<option value="">Все месяцы</option>';
        const monthsMap = new Map();
        records.forEach(r => {
            if (!r.date) return;
            const d = parseLocalDate(r.date);
            if (!d) return;
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const label = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][d.getMonth()] + ' ' + d.getFullYear();
            if (!monthsMap.has(key)) monthsMap.set(key, label);
        });
        Array.from(monthsMap.entries()).sort((a, b) => b[0].localeCompare(a[0])).forEach(([key, label]) => {
            const o = document.createElement('option');
            o.value = key; o.textContent = label;
            if (filterState.date.values.includes(key)) o.selected = true;
            select.appendChild(o);
        });
        select.addEventListener('change', e => {
            filterState.date.values = e.target.value ? [e.target.value] : [];
            renderTable();
        });
        container.appendChild(select);
    } else if (column === 'weekday') {
        const w = document.createElement('div');
        w.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
        ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'].forEach(day => {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;font-size:11px;cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.value = day;
            cb.checked = filterState.weekday.values.includes(day);
            cb.addEventListener('change', () => {
                if (cb.checked) filterState.weekday.values.push(day);
                else filterState.weekday.values = filterState.weekday.values.filter(v => v !== day);
                renderTable();
            });
            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(' ' + day.slice(0, 3)));
            w.appendChild(lbl);
        });
        container.appendChild(w);
    } else if (column === 'type') {
        const w = document.createElement('div');
        w.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        [
            { v: 'work', l: 'Работа', icon: 'calendar-outline', color: 'var(--ios-accent,#007AFF)' },
            { v: 'bonus', l: 'Бонус', icon: 'gift-outline', color: 'var(--ios-purple,#AF52DE)' },
            { v: 'expense', l: 'Расход', icon: 'remove-circle-outline', color: 'var(--ios-danger,#FF3B30)' }
        ].forEach(t => {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.value = t.v;
            cb.checked = filterState.type.values.includes(t.v);
            cb.addEventListener('change', () => {
                if (cb.checked) { if (!filterState.type.values.includes(t.v)) filterState.type.values.push(t.v); }
                else filterState.type.values = filterState.type.values.filter(v => v !== t.v);
                renderTable();
            });
            lbl.appendChild(cb);
            const span = document.createElement('span');
            span.style.cssText = 'display:flex;align-items:center;gap:4px;';
            span.innerHTML = `<ion-icon name="${t.icon}" style="color:${t.color};font-size:16px;"></ion-icon> ${t.l}`;
            lbl.appendChild(span);
            w.appendChild(lbl);
        });
        container.appendChild(w);
    } else if (filterState[column] && filterState[column].type === 'range') {
        const w = document.createElement('div');
        w.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;align-items:center;';
        const minI = document.createElement('input');
        minI.type = 'number'; minI.placeholder = 'От';
        minI.style.cssText = 'width:50%;padding:6px;font-size:12px;border:1px solid #ccc;border-radius:6px;';
        minI.value = filterState[column].min;
        const maxI = document.createElement('input');
        maxI.type = 'number'; maxI.placeholder = 'До';
        maxI.style.cssText = 'width:50%;padding:6px;font-size:12px;border:1px solid #ccc;border-radius:6px;';
        maxI.value = filterState[column].max;
        minI.addEventListener('input', e => { filterState[column].min = e.target.value; renderTable(); });
        maxI.addEventListener('input', e => { filterState[column].max = e.target.value; renderTable(); });
        row.appendChild(minI); row.appendChild(maxI);
        w.appendChild(row); container.appendChild(w);
    }
}

function clearAllFilters() {
    Object.keys(filterState).forEach(key => {
        if (filterState[key].type === 'range') { filterState[key].min = ''; filterState[key].max = ''; }
        else filterState[key].values = [];
    });
    sortState = { column: null, direction: null };
    const row = document.getElementById('filter-row');
    if (row) {
        row.style.display = 'none';
        row.querySelectorAll('td').forEach(td => { if (td.id.startsWith('filter-')) td.innerHTML = ''; });
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
            const recDay = r.weekday
                ? r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase()
                : '';
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
        const rawA = a[field], rawB = b[field];
        const valA = (rawA === undefined || rawA === null || rawA === '' || rawA === '-') ? 0 : parseFloat(rawA);
        const valB = (rawB === undefined || rawB === null || rawB === '' || rawB === '-') ? 0 : parseFloat(rawB);
        return sortState.direction === 'asc' ? valA - valB : valB - valA;
    });
}

// ============================================
// РЕНДЕР: строка / карточка
// ============================================
function getRecordRowHTML(r) {
    const typeLabel = r.recordType === 'bonus'
        ? ' <ion-icon name="gift-outline" style="vertical-align:middle;margin-right:4px;color:#AF52DE;"></ion-icon>Бонус'
        : r.recordType === 'expense'
            ? ' <ion-icon name="remove-circle-outline" style="vertical-align:middle;margin-right:4px;color:#FF3B30;"></ion-icon>Расход'
            : ' <ion-icon name="calendar-outline" style="vertical-align:middle;margin-right:4px;color:#007AFF;"></ion-icon>Работа';

    const hasFuel = r.fuelDetails && Array.isArray(r.fuelDetails) && r.fuelDetails.length > 0;
    let fuelAttr = '';
    if (hasFuel) {
        const json = JSON.stringify(r.fuelDetails).replace(/'/g, '&apos;');
        fuelAttr = `data-fuel-details='${json}' data-fuel-liters='${r.fuelLiters || 0}' data-fuel-count='${r.fuelLogCount || r.fuelDetails.length}'`;
    }
    const hasRepair = r.repairDetails && Array.isArray(r.repairDetails) && r.repairDetails.length > 0;
    let repairAttr = '';
    if (hasRepair) {
        const json = JSON.stringify(r.repairDetails).replace(/'/g, '&apos;');
        repairAttr = `data-repair-details='${json}' data-repair-total='${r.repairCost || 0}' data-repair-count='${r.repairLogCount || r.repairDetails.length}'`;
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
     <td class="${hasFuel ? 'fuel-cell-with-details' : ''}" ${fuelAttr}>${r.fuelCost ? formatMoney(r.fuelCost) : '-'}</td>
     <td class="${hasRepair ? 'repair-cell-with-details' : ''}" ${repairAttr}>${r.repairCost ? formatMoney(r.repairCost) : '-'}</td>
     <td>${r.tax ? formatMoney(r.tax) : '-'}</td>
     <td>${formatMoney(r.totalIncome)}</td>
     <td>${formatMoney(r.totalExpenses)}</td>
     <td style="color:${r.netProfit >= 0 ? '#10b981' : '#ef4444'};font-weight:bold">${formatMoney(r.netProfit)}</td>
     <td>
         <button class="btn btn-success" onclick="editRecord('${r.id}')"><ion-icon name="create-outline"></ion-icon></button>
         <button class="btn btn-danger" onclick="deleteRecord('${r.id}')"><ion-icon name="trash-outline"></ion-icon></button>
     </td>`;
}

function getRecordCardHTML(r) {
    const typeIcon = r.recordType === 'bonus' ? 'gift-outline'
        : r.recordType === 'expense' ? 'remove-circle-outline' : 'calendar-outline';
    const typeColor = r.recordType === 'bonus' ? 'var(--ios-purple,#AF52DE)'
        : r.recordType === 'expense' ? 'var(--ios-danger,#FF3B30)' : 'var(--ios-accent,#007AFF)';
    const typeLabel = r.recordType === 'bonus' ? 'Бонус'
        : r.recordType === 'expense' ? 'Расход' : 'Работа';
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
            label: 'Бензин', value: formatMoney(r.fuelCost),
            cls: hasFuel ? 'rcd-tappable rcd-fuel fuel-cell-with-details' : '',
            attrs: hasFuel
                ? `data-fuel-details='${JSON.stringify(r.fuelDetails).replace(/'/g, '&apos;')}' data-fuel-liters='${r.fuelLiters || 0}' data-fuel-count='${r.fuelLogCount || r.fuelDetails.length}' data-fuel-total='${r.fuelCost}'`
                : ''
        });
    }
    if (r.repairCost) {
        const hasRep = r.repairDetails && Array.isArray(r.repairDetails) && r.repairDetails.length > 0;
        details.push({
            label: 'Ремонт', value: formatMoney(r.repairCost),
            cls: hasRep ? 'rcd-tappable rcd-repair repair-cell-with-details' : '',
            attrs: hasRep
                ? `data-repair-details='${JSON.stringify(r.repairDetails).replace(/'/g, '&apos;')}' data-repair-total='${r.repairCost}' data-repair-count='${r.repairLogCount || r.repairDetails.length}'`
                : ''
        });
    }
    if (r.tax) details.push({ label: 'Налог', value: formatMoney(r.tax) });

    const detailsHTML = details.length
        ? details.map(d => `<div class="rcd-item ${d.cls || ''}" ${d.attrs || ''}><span class="rcd-label">${d.label}</span><span class="rcd-val">${d.value}</span></div>`).join('')
        : '<div class="rcd-empty">Нет дополнительных данных</div>';

    return `
    <div class="record-card">
        <div class="record-card-header">
            <div class="record-card-date"><ion-icon name="calendar-outline"></ion-icon>${formatDate(r.date)} · ${r.weekday || '—'}</div>
            <div class="record-card-type" style="color:${typeColor}"><ion-icon name="${typeIcon}"></ion-icon>${typeLabel}</div>
        </div>
        <div class="record-card-metrics">
            <div class="rcm"><ion-icon name="time-outline"></ion-icon> ${r.hours || 0} ч</div>
            <div class="rcm"><ion-icon name="cube-outline"></ion-icon> ${totalOrders} зак.</div>
            <div class="rcm"><ion-icon name="navigate-outline"></ion-icon> ${r.distance ? r.distance.toFixed(1) : 0} км</div>
            ${r.weight ? `<div class="rcm"><ion-icon name="scale-outline"></ion-icon> ${r.weight.toFixed(1)} кг</div>` : ''}
        </div>
        <div class="record-card-financials">
            <div class="rcf income"><span class="rcf-label">Доход</span><span class="rcf-value">${formatMoney(r.totalIncome)}</span></div>
            <div class="rcf expense"><span class="rcf-label">Расход</span><span class="rcf-value">${formatMoney(r.totalExpenses)}</span></div>
            <div class="rcf profit"><span class="rcf-label">Прибыль</span><span class="rcf-value" style="color:${profitColor}">${formatMoney(r.netProfit)}</span></div>
        </div>
        <div class="record-card-details" id="${cardId}">${detailsHTML}</div>
        <div class="record-card-footer">
            <button class="record-card-expand" onclick="toggleCardDetails('${cardId}', this)"><span>Детали</span><ion-icon name="chevron-down-outline"></ion-icon></button>
            <div class="record-card-actions">
                <button class="btn btn-small btn-success" onclick="editRecord('${r.id}')"><ion-icon name="create-outline"></ion-icon></button>
                <button class="btn btn-small btn-danger" onclick="deleteRecord('${r.id}')"><ion-icon name="trash-outline"></ion-icon></button>
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

// ============================================
// НЕДЕЛЬНЫЕ ИТОГИ
// ============================================
function getISOWeek(dateStr) {
    const date = parseLocalDate(dateStr);
    if (!date) return '';
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    const week = 1 + Math.ceil((firstThursday - target) / 604800000);
    return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getWeekDateRange(weekKey) {
    const [yS, wS] = weekKey.split('-W');
    const year = parseInt(yS), week = parseInt(wS);
    const jan4 = parseLocalDate(`${year}-01-04`);
    if (!jan4) return { start: null, end: null, label: '' };
    const dayOfWeek = (jan4.getDay() + 6) % 7;
    const firstMon = new Date(jan4);
    firstMon.setDate(jan4.getDate() - dayOfWeek);
    const mon = new Date(firstMon);
    mon.setDate(firstMon.getDate() + (week - 1) * 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
        start: mon, end: sun,
        label: `${mon.getDate()}.${String(mon.getMonth() + 1).padStart(2, '0')} - ${sun.getDate()}.${String(sun.getMonth() + 1).padStart(2, '0')}.${sun.getFullYear()}`
    };
}

function renderTableWithWeeklySummary(tbody, list) {
    const totalColumns = document.querySelectorAll('thead tr:first-child th').length;
    const weeksMap = new Map();
    list.forEach(r => {
        if (!r.date) return;
        const wk = getISOWeek(r.date);
        if (!weeksMap.has(wk)) weeksMap.set(wk, []);
        weeksMap.get(wk).push(r);
    });
    Array.from(weeksMap.keys()).sort((a, b) => b.localeCompare(a)).forEach(wk => {
        const wr = weeksMap.get(wk);
        const range = getWeekDateRange(wk);
        const s = wr.reduce((a, r) => {
            a.hours += r.hours || 0;
            a.ordersPickup += r.ordersPickup || 0; a.payPickup += r.payPickup || 0;
            a.ordersDelivery += r.ordersDelivery || 0; a.payDelivery += r.payDelivery || 0;
            a.distance += r.distance || 0; a.payDistance += r.payDistance || 0;
            a.weight += r.weight || 0; a.payWeight += r.payWeight || 0;
            a.loadPay += r.loadPay || 0; a.bonusPay += r.bonusPay || 0;
            a.rating += r.rating || 0; a.tips += r.tips || 0;
            a.fuelCost += r.fuelCost || 0; a.repairCost += r.repairCost || 0;
            a.tax += r.tax || 0;
            a.totalIncome += r.totalIncome || 0;
            a.totalExpenses += r.totalExpenses || 0;
            a.netProfit += r.netProfit || 0;
            if (r.recordType === 'work') a.workingDays += 1;
            return a;
        }, {
            hours: 0, ordersPickup: 0, payPickup: 0, ordersDelivery: 0, payDelivery: 0,
            distance: 0, payDistance: 0, weight: 0, payWeight: 0, loadPay: 0,
            bonusPay: 0, rating: 0, tips: 0, fuelCost: 0, repairCost: 0, tax: 0,
            totalIncome: 0, totalExpenses: 0, netProfit: 0, workingDays: 0
        });
        const header = document.createElement('tr');
        header.className = 'week-summary-header';
        header.innerHTML = `<td colspan="${totalColumns}">
            <ion-icon name="calendar-outline" class="week-header-icon"></ion-icon>
            Неделя ${wk.split('-W')[1]} (${range.label}) — 
            ${s.workingDays} ${s.workingDays === 1 ? 'день' : (s.workingDays >= 2 && s.workingDays <= 4 ? 'дня' : 'дней')}
        </td>`;
        tbody.appendChild(header);
        wr.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = getRecordRowHTML(r);
            tbody.appendChild(tr);
        });
        const row = document.createElement('tr');
        row.className = 'week-summary-row';
        const vals = [
            s.hours.toFixed(1), s.ordersPickup, formatMoney(s.payPickup),
            s.ordersDelivery, formatMoney(s.payDelivery),
            s.distance.toFixed(1), formatMoney(s.payDistance),
            s.weight.toFixed(1), formatMoney(s.payWeight),
            formatMoney(s.loadPay), formatMoney(s.bonusPay),
            formatMoney(s.rating), formatMoney(s.tips),
            formatMoney(s.fuelCost), formatMoney(s.repairCost),
            formatMoney(s.tax), formatMoney(s.totalIncome),
            formatMoney(s.totalExpenses),
            `<span style="color:${s.netProfit >= 0 ? '#10b981' : '#ef4444'}">${formatMoney(s.netProfit)}</span>`
        ];
        let html = `<td colspan="3"><strong><ion-icon name="bar-chart-outline" class="week-summary-icon"></ion-icon> ИТОГО:</strong></td>`;
        vals.forEach(v => { html += `<td><strong>${v}</strong></td>`; });
        html += `<td></td>`;
        row.innerHTML = html;
        tbody.appendChild(row);
    });
}

// ============================================
// КАРТОЧНЫЙ РЕЖИМ
// ============================================
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

function renderCardsView(tbody, list) {
    const table = tbody.closest('table');
    let container = document.getElementById('records-cards');
    if (!container) {
        container = document.createElement('div');
        container.id = 'records-cards';
        container.className = 'records-cards-container';
        table.parentNode.insertBefore(container, table);
    }
    table.style.display = 'none';
    const box = table.closest('.table-container') || table.parentElement;
    if (box) box.classList.add('cards-mode');
    container.style.display = 'flex';
    container.innerHTML = '';

    if (list.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ios-text-tertiary);">
            <ion-icon name="document-text-outline" style="font-size:48px;display:block;margin:0 auto 12px;"></ion-icon>
            Нет записей за выбранный период
        </div>`;
        return;
    }

    const weeksMap = new Map();
    list.forEach(r => {
        if (!r.date) return;
        const wk = getISOWeek(r.date);
        if (!weeksMap.has(wk)) weeksMap.set(wk, []);
        weeksMap.get(wk).push(r);
    });
    Array.from(weeksMap.keys()).sort((a, b) => b.localeCompare(a)).forEach(wk => {
        const wr = weeksMap.get(wk);
        const range = getWeekDateRange(wk);
        const header = document.createElement('div');
        header.className = 'week-card-header';
        header.innerHTML = `<ion-icon name="calendar-outline"></ion-icon>Неделя ${wk.split('-W')[1]} (${range.label})`;
        container.appendChild(header);
        wr.forEach(r => {
            const wrap = document.createElement('div');
            wrap.innerHTML = getRecordCardHTML(r);
            container.appendChild(wrap.firstElementChild);
        });
        const s = wr.reduce((a, r) => {
            a.totalIncome += r.totalIncome || 0;
            a.netProfit += r.netProfit || 0;
            a.hours += r.hours || 0;
            return a;
        }, { totalIncome: 0, netProfit: 0, hours: 0 });
        const summary = document.createElement('div');
        summary.className = 'week-card-summary';
        summary.innerHTML = `
            <div class="wcs-item"><div class="wcs-label">Доход</div><div class="wcs-value" style="color:var(--ios-success)">${formatMoney(s.totalIncome)}</div></div>
            <div class="wcs-item"><div class="wcs-label">Прибыль</div><div class="wcs-value" style="color:${s.netProfit >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)'}">${formatMoney(s.netProfit)}</div></div>
            <div class="wcs-item"><div class="wcs-label">Часы</div><div class="wcs-value">${s.hours.toFixed(1)} ч</div></div>`;
        container.appendChild(summary);
    });
}

function showTableView() {
    const table = document.querySelector('#tab-history table');
    const container = document.getElementById('records-cards');
    if (table) table.style.display = '';
    if (container) container.style.display = 'none';
    const box = document.querySelector('.table-container.cards-mode');
    if (box) box.classList.remove('cards-mode');
}

// ============================================
// ГЛАВНЫЙ РЕНДЕР ТАБЛИЦЫ
// ============================================
function renderTable() {
    const tbody = document.getElementById('records-body');
    if (!tbody) return;

    const historyTab = document.getElementById('tab-history');
    const isHistoryActive = historyTab && historyTab.classList.contains('active');

    let list = [...records];

    if (isHistoryActive && !showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
        list = list.filter(r => {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        });
    }

    list = applyFilters(list);
    list = (sortState.column && sortState.direction)
        ? applySorting(list)
        : list.sort((a, b) => (parseLocalDate(b.date) || 0) - (parseLocalDate(a.date) || 0));

    if (isCardsMode()) {
        renderCardsView(tbody, list);
        return;
    }

    showTableView();
    tbody.innerHTML = '';

    const hasFilters = Object.keys(filterState).some(k => {
        const f = filterState[k];
        if (f.type === 'checkbox' || f.type === 'month') return f.values && f.values.length > 0;
        if (f.type === 'range') return f.min !== '' || f.max !== '';
        return false;
    });
    const hasSort = sortState.column !== null && sortState.direction !== null;
    const hideWeekly = hasFilters || hasSort || showAllHistoryMode;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="23" style="text-align:center;padding:40px;color:var(--ios-text-tertiary);">
            <ion-icon name="document-text-outline" style="font-size:48px;display:block;margin:0 auto 12px;"></ion-icon>
            Нет записей за выбранный период
        </td></tr>`;
    } else if (!hideWeekly) {
        renderTableWithWeeklySummary(tbody, list);
    } else {
        list.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = getRecordRowHTML(r);
            tbody.appendChild(tr);
        });
    }

    const totalPages = Math.ceil(list.length / RECORDS_PER_PAGE);
    renderPagination(totalPages);

    let tc = tbody.closest('.table-container') || tbody.closest('table') || tbody.parentElement;
    if (tc) {
        let info = document.getElementById('filter-info');
        if (!info) {
            info = document.createElement('div');
            info.id = 'filter-info';
            info.style.cssText = 'padding:15px;background:#dbeafe;border-radius:8px;margin:10px 0;text-align:center;color:#1e40af;font-weight:600;';
            if (tc.tagName === 'TABLE') tc.parentElement.insertBefore(info, tc.nextSibling);
            else tc.appendChild(info);
        }
        const count = list.length, total = records.length;
        if (count < total || count === 0) {
            info.style.display = 'block';
            let suffix = '';
            if (isHistoryActive && !showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
                suffix = ` за ${getMonthName(currentHistoryMonth)} ${currentHistoryYear}`;
            }
            info.textContent = `📅 Показано ${count} из ${total} записей${suffix}`;
        } else {
            info.style.display = 'none';
        }
    }
}

function renderPagination(totalPages) {
    const div = document.getElementById('history-pagination');
    if (!div) return;
    if (totalPages <= 1) { div.innerHTML = ''; return; }
    let html = '';
    if (currentHistoryPage > 1) {
        html += `<button class="btn btn-secondary btn-small" onclick="goToPage(${currentHistoryPage - 1})"><ion-icon name="chevron-back-outline"></ion-icon></button>`;
    }
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentHistoryPage) {
            html += `<button class="btn btn-primary btn-small" style="min-width:40px;">${i}</button>`;
        } else if (Math.abs(i - currentHistoryPage) <= 2 || i === 1 || i === totalPages) {
            html += `<button class="btn btn-secondary btn-small" onclick="goToPage(${i})" style="min-width:40px;">${i}</button>`;
        } else if (Math.abs(i - currentHistoryPage) === 3) {
            html += '<span style="margin:0 4px;">...</span>';
        }
    }
    if (currentHistoryPage < totalPages) {
        html += `<button class="btn btn-secondary btn-small" onclick="goToPage(${currentHistoryPage + 1})"><ion-icon name="chevron-forward-outline"></ion-icon></button>`;
    }
    html += `<span style="margin-left:12px;font-size:13px;color:var(--ios-text-tertiary);align-self:center;">Стр. ${currentHistoryPage} из ${totalPages}</span>`;
    div.innerHTML = html;
}

function goToPage(page) {
    currentHistoryPage = page;
    renderTable();
    const c = document.querySelector('.table-container');
    if (c) c.scrollTop = 0;
}

// ============================================
// ФИЛЬТРЫ МЕСЯЦ/ГОД (общая утилита)
// ============================================
function getMonthName(month) {
    const m = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    return m[month - 1] || '';
}

function populateMonthYearSelects(monthSelectId, yearSelectId, yearsBack = 5, yearsForward = 2) {
    const months = new Set(), years = new Set();
    records.forEach(r => {
        const d = parseLocalDate(r.date);
        if (!d) return;
        months.add((d.getMonth() + 1).toString().padStart(2, '0'));
        years.add(d.getFullYear());
    });
    
    const ms = document.getElementById(monthSelectId);
    const ys = document.getElementById(yearSelectId);
    if (!ms || !ys) return;

    const cm = ms.value, cy = ys.value;
    
    // Месяцы
    ms.innerHTML = '<option value="all">Все месяцы</option>';
    const names = ['', 'Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    [...months].sort((a, b) => a - b).forEach(m => {
        const o = document.createElement('option');
        o.value = m; o.textContent = names[parseInt(m)];
        ms.appendChild(o);
    });

    // Годы
    ys.innerHTML = '<option value="all">Все годы</option>'; // ⭐ добавлен пункт
    const nowY = new Date().getFullYear();
    const from = nowY - yearsBack, to = nowY + yearsForward;
    
    for (let y = to; y >= from; y--) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        ys.appendChild(o);
    }
    
    // Добавляем годы из записей, если они вне диапазона
    [...years].sort((a, b) => b - a).forEach(y => {
        if (y < from || y > to) {
            const o = document.createElement('option');
            o.value = y; o.textContent = y;
            ys.appendChild(o);
        }
    });
    
    // Восстанавливаем значения
    if (cm) ms.value = cm;
    if (cy && cy !== 'undefined') ys.value = cy;
}

function populateFilters() {
    populateMonthYearSelects('filter-month', 'filter-year');
}

function initHistoryFilters() {
    populateMonthYearSelects('history-month', 'history-year');
    const ms = document.getElementById('history-month');
    const ys = document.getElementById('history-year');
    const now = new Date();
    
    if (ms) ms.value = now.getMonth() + 1;
    if (ys) ys.value = now.getFullYear();
    
    currentHistoryMonth = now.getMonth() + 1;
    currentHistoryYear = now.getFullYear();
    showAllHistoryMode = false;
    currentHistoryPage = 1;
}

function filterHistoryByMonth() {
    const ms = document.getElementById('history-month');
    const ys = document.getElementById('history-year');
    if (!ms || !ys) return;
    currentHistoryMonth = parseInt(ms.value);
    currentHistoryYear = parseInt(ys.value);
    showAllHistoryMode = false;
    currentHistoryPage = 1;
    renderTable();
}

function showAllHistory() {
    showAllHistoryMode = true;
    currentHistoryPage = 1;
    renderTable();
}

// ============================================
// АНАЛИТИКА
// ============================================
function updateAnalytics() {
    const monthSelect = document.getElementById('filter-month');
    const yearSelect = document.getElementById('filter-year');
    const titleElement = document.getElementById('analytics-month-title');
    
    const monthValue = monthSelect ? monthSelect.value : '';
    const yearValue = yearSelect ? yearSelect.value : '';
    
    // === 1. ОБНОВЛЕНИЕ ЗАГОЛОВКА ===
    if (titleElement) {
        const monthText = monthSelect && monthSelect.selectedIndex >= 0 ?
            monthSelect.options[monthSelect.selectedIndex].text :
            '';
        
        if ((!monthValue || monthValue === 'all') && (!yearValue || yearValue === 'all')) {
            titleElement.innerText = 'ВСЕ ВРЕМЯ';
        } else if ((!monthValue || monthValue === 'all') && yearValue && yearValue !== 'all') {
            titleElement.innerText = `${yearValue} ГОД`;
        } else if (monthValue && monthValue !== 'all' && (!yearValue || yearValue === 'all')) {
            titleElement.innerText = `${monthText}`.toUpperCase();
        } else {
            titleElement.innerText = `${monthText} ${yearValue}`.toUpperCase();
        }
    }
    
    // === 2. ФИЛЬТРАЦИЯ ДАННЫХ ===
    let list = [...records];
    
    if (monthValue && monthValue !== 'all') {
        list = list.filter(r => {
            const d = parseLocalDate(r.date);
            return d && (d.getMonth() + 1).toString().padStart(2, '0') === monthValue;
        });
    }
    
    if (yearValue && yearValue !== 'all') {
        list = list.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d.getFullYear().toString() === yearValue;
        });
    }
    
    // === 3. ПОДСЧЕТ СТАТИСТИКИ ===
    const unique = new Set();
    list.forEach(r => { if (r.hours > 0 || r.recordType === 'work') unique.add(r.date); });
    
    const s = {
        totalIncome: list.reduce((x, r) => x + (r.totalIncome || 0), 0),
        totalFuel: list.reduce((x, r) => x + (r.fuelCost || 0), 0),
        totalRepair: list.reduce((x, r) => x + (r.repairCost || 0), 0),
        totalTax: list.reduce((x, r) => x + (r.tax || 0), 0),
        totalExpenses: list.reduce((x, r) => x + (r.totalExpenses || 0), 0),
        netProfit: list.reduce((x, r) => x + (r.netProfit || 0), 0),
        totalHours: list.reduce((x, r) => x + (r.hours || 0), 0),
        totalOrders: list.reduce((x, r) => x + (r.ordersDelivery || 0), 0),
        totalDistance: list.reduce((x, r) => x + (r.distance || 0), 0),
        workingDays: unique.size
    };
    
    const avgIncome = s.workingDays > 0 ? s.totalIncome / s.workingDays : 0;
    const avgProfit = s.workingDays > 0 ? s.netProfit / s.workingDays : 0;
    const avgHour = s.totalHours > 0 ? s.netProfit / s.totalHours : 0;
    const avgCheck = s.totalOrders > 0 ? s.totalIncome / s.totalOrders : 0;
    const oph = s.totalHours > 0 ? s.totalOrders / s.totalHours : 0;
    const eff = s.totalIncome > 0 ? (s.netProfit / s.totalIncome) * 100 : 0;
    
    // === 4. ВЫВОД НА ЭКРАН ===
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('total-income', formatMoney(s.totalIncome));
    set('avg-income-per-day', formatMoney(avgIncome));
    set('total-fuel', formatMoney(s.totalFuel));
    set('total-repair', formatMoney(s.totalRepair));
    set('total-tax', formatMoney(s.totalTax));
    set('total-expenses', formatMoney(s.totalExpenses));
    set('net-profit', formatMoney(s.netProfit));
    set('avg-net-profit-per-day', formatMoney(avgProfit));
    set('total-hours', s.totalHours.toFixed(0));
    set('total-orders', s.totalOrders);
    set('total-distance', s.totalDistance.toFixed(2));
    set('working-days', s.workingDays);
    set('avg-per-hour', formatMoney(avgHour));
    set('avg-check', formatMoney(avgCheck));
    set('orders-per-hour', oph.toFixed(2));
    set('efficiency-percent', eff.toFixed(2) + '%');
    
    updateCharts(list);
}

function updateCharts(list) {
    if (!list || list.length === 0) {
        if (incomeChart) { incomeChart.destroy(); incomeChart = null; }
        if (expensesChart) { expensesChart.destroy(); expensesChart = null; }
        return;
    }
    const sorted = [...list].sort((a, b) => (parseLocalDate(a.date) || 0) - (parseLocalDate(b.date) || 0));
    const labels = sorted.map(r => {
        const d = parseLocalDate(r.date);
        return d ? d.getDate() + '.' + (d.getMonth() + 1) : '??';
    });

    const c1 = document.getElementById('income-chart');
    const c2 = document.getElementById('expenses-chart');

    if (c1) {
        if (incomeChart) incomeChart.destroy();
        incomeChart = new Chart(c1.getContext('2d'), {
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
    if (c2) {
        if (expensesChart) expensesChart.destroy();
        const fuel = sorted.reduce((x, r) => x + (r.fuelCost || 0), 0);
        const repair = sorted.reduce((x, r) => x + (r.repairCost || 0), 0);
        const tax = sorted.reduce((x, r) => x + (r.tax || 0), 0);
        if (fuel === 0 && repair === 0 && tax === 0) return;
        expensesChart = new Chart(c2.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Бензин', 'Ремонт', 'Налог'],
                datasets: [{ data: [fuel, repair, tax], backgroundColor: ['#ef4444', '#f59e0b', '#8b5cf6'] }]
            },
            options: { responsive: true }
        });
    }
}

// ============================================
// СРАВНЕНИЕ ПЕРИОДОВ
// ============================================
function initComparisonSelectors() {
    populateMonthYearSelects('compare1-month', 'compare1-year', 5, 1);
    populateMonthYearSelects('compare2-month', 'compare2-year', 5, 1);
    const c1 = document.getElementById('compare1-year');
    const c2 = document.getElementById('compare2-year');
    const y = new Date().getFullYear();
    if (c1) c1.value = y;
    if (c2) c2.value = y;
}

function getPeriodStats(month, year) {
    let list = [...records];
    
    // Проверка года (игнорируем 'all')
    if (year && year !== 'all') {
        list = list.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d.getFullYear().toString() === year;
        });
    }
    
    // Проверка месяца (игнорируем 'all' и пустые)
    if (month && month !== 'all' && month !== '') {
        list = list.filter(r => {
            const d = parseLocalDate(r.date);
            return d && (d.getMonth() + 1).toString().padStart(2, '0') === month;
        });
    }
    
    const unique = new Set();
    list.forEach(r => { if (r.hours > 0 || r.recordType === 'work') unique.add(r.date); });
    
    return {
        totalIncome: list.reduce((x, r) => x + (r.totalIncome || 0), 0),
        totalExpenses: list.reduce((x, r) => x + (r.totalExpenses || 0), 0),
        netProfit: list.reduce((x, r) => x + (r.netProfit || 0), 0),
        totalHours: list.reduce((x, r) => x + (r.hours || 0), 0),
        totalOrders: list.reduce((x, r) => x + (r.ordersDelivery || 0), 0),
        totalDistance: list.reduce((x, r) => x + (r.distance || 0), 0),
        workingDays: unique.size,
        recordsCount: list.length
    };
}

function formatPeriodName(month, year) {
    const n = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    
    const isValidMonth = month && month !== 'all' && month !== '';
    const isValidYear = year && year !== 'all' && year !== '';
    
    if (isValidMonth && isValidYear) return `${n[+month]} ${year}`;
    if (isValidYear) return `${year} год`;
    if (isValidMonth) return `${n[+month]}`;
    return 'Все данные';
}

function calcDiff(a, b) {
    if (b === 0) return { diff: a, percent: a !== 0 ? 100 : 0 };
    const diff = a - b;
    return { diff, percent: (diff / Math.abs(b)) * 100 };
}

function formatDiff(a, b, isMoney = true) {
    const diff = a - b;
    const percent = b !== 0 ? (diff / Math.abs(b)) * 100 : 0;
    const ds = isMoney ? formatMoney(Math.abs(diff)) : Math.abs(diff).toFixed(1);
    const ps = isFinite(percent) ? ` (${Math.abs(percent).toFixed(1)}%)` : '';
    if (diff > 0) return `<span class="diff-positive">↑ +${ds}${ps}</span>`;
    if (diff < 0) return `<span class="diff-negative">↓ ${ds}${ps}</span>`;
    return `<span class="diff-neutral">→ ${ds}${ps}</span>`;
}

function updateComparison() {
    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');
    if (!c1m || !c1y || !c2m || !c2y) return;

    const s1 = getPeriodStats(c1m.value, c1y.value);
    const s2 = getPeriodStats(c2m.value, c2y.value);
    const name1 = formatPeriodName(c1m.value, c1y.value);
    const name2 = formatPeriodName(c2m.value, c2y.value);
    const results = document.getElementById('comparison-results');
    if (!results) return;
    if (s1.recordsCount === 0 && s2.recordsCount === 0) {
        results.innerHTML = '<p class="comparison-hint">Нет данных для выбранных периодов</p>';
        return;
    }

    const aH1 = s1.totalHours > 0 ? s1.netProfit / s1.totalHours : 0;
    const aH2 = s2.totalHours > 0 ? s2.netProfit / s2.totalHours : 0;
    const aC1 = s1.totalOrders > 0 ? s1.totalIncome / s1.totalOrders : 0;
    const aC2 = s2.totalOrders > 0 ? s2.totalIncome / s2.totalOrders : 0;
    const o1 = s1.totalHours > 0 ? s1.totalOrders / s1.totalHours : 0;
    const o2 = s2.totalHours > 0 ? s2.totalOrders / s2.totalHours : 0;
    const e1 = s1.totalIncome > 0 ? (s1.netProfit / s1.totalIncome) * 100 : 0;
    const e2 = s2.totalIncome > 0 ? (s2.netProfit / s2.totalIncome) * 100 : 0;
    const iD1 = s1.workingDays > 0 ? s1.totalIncome / s1.workingDays : 0;
    const iD2 = s2.workingDays > 0 ? s2.totalIncome / s2.workingDays : 0;
    const pD1 = s1.workingDays > 0 ? s1.netProfit / s1.workingDays : 0;
    const pD2 = s2.workingDays > 0 ? s2.netProfit / s2.workingDays : 0;

    let html = `
        <div class="table-scroll-container">
        <table class="comparison-table">
            <thead><tr><th>Показатель</th><th>${name1}</th><th>${name2}</th><th>Разница</th></tr></thead>
            <tbody>
                <tr><td class="metric-name">Общий доход</td><td>${formatMoney(s1.totalIncome)}</td><td>${formatMoney(s2.totalIncome)}</td><td>${formatDiff(s1.totalIncome, s2.totalIncome)}</td></tr>
                <tr><td class="metric-name">Доход в день</td><td>${formatMoney(iD1)}</td><td>${formatMoney(iD2)}</td><td>${formatDiff(iD1, iD2)}</td></tr>
                <tr><td class="metric-name">Всего расходов</td><td>${formatMoney(s1.totalExpenses)}</td><td>${formatMoney(s2.totalExpenses)}</td><td>${formatDiff(s1.totalExpenses, s2.totalExpenses)}</td></tr>
                <tr><td class="metric-name">Чистая прибыль</td><td>${formatMoney(s1.netProfit)}</td><td>${formatMoney(s2.netProfit)}</td><td>${formatDiff(s1.netProfit, s2.netProfit)}</td></tr>
                <tr><td class="metric-name">Прибыль в день</td><td>${formatMoney(pD1)}</td><td>${formatMoney(pD2)}</td><td>${formatDiff(pD1, pD2)}</td></tr>
                <tr><td class="metric-name">Часов</td><td>${s1.totalHours.toFixed(1)}</td><td>${s2.totalHours.toFixed(1)}</td><td>${formatDiff(s1.totalHours, s2.totalHours, false)}</td></tr>
                <tr><td class="metric-name">Заказов</td><td>${s1.totalOrders}</td><td>${s2.totalOrders}</td><td>${formatDiff(s1.totalOrders, s2.totalOrders, false)}</td></tr>
                <tr><td class="metric-name">Пройдено км</td><td>${s1.totalDistance.toFixed(1)}</td><td>${s2.totalDistance.toFixed(1)}</td><td>${formatDiff(s1.totalDistance, s2.totalDistance, false)}</td></tr>
                <tr><td class="metric-name">Рабочих дней</td><td>${s1.workingDays}</td><td>${s2.workingDays}</td><td>${formatDiff(s1.workingDays, s2.workingDays, false)}</td></tr>
                <tr><td class="metric-name">Средний ₽/час</td><td>${formatMoney(aH1)}</td><td>${formatMoney(aH2)}</td><td>${formatDiff(aH1, aH2)}</td></tr>
                <tr><td class="metric-name">Средний чек</td><td>${formatMoney(aC1)}</td><td>${formatMoney(aC2)}</td><td>${formatDiff(aC1, aC2)}</td></tr>
                <tr><td class="metric-name">Заказов в час</td><td>${o1.toFixed(2)}</td><td>${o2.toFixed(2)}</td><td>${formatDiff(o1, o2, false)}</td></tr>
                <tr><td class="metric-name">Эффективность</td><td>${e1.toFixed(1)}%</td><td>${e2.toFixed(1)}%</td><td>${formatDiff(e1, e2, false)}</td></tr>
            </tbody>
        </table>
        </div>`;

    const p = calcDiff(s1.netProfit, s2.netProfit);
    const i = calcDiff(s1.totalIncome, s2.totalIncome);
    const h = calcDiff(s1.totalHours, s2.totalHours);
    const pc = p.diff > 0 ? 'positive' : (p.diff < 0 ? 'negative' : 'neutral');
    const ic = i.diff > 0 ? 'positive' : (i.diff < 0 ? 'negative' : 'neutral');
    const hc = h.diff > 0 ? 'positive' : (h.diff < 0 ? 'negative' : 'neutral');

    html += `
        <div class="comparison-summary">
            <div class="summary-card ${pc}"><h4>Итог по прибыли</h4><div class="big-number">${p.diff > 0 ? '+' : ''}${formatMoney(p.diff)}</div><div class="small-text">${p.diff > 0 ? 'Выше, чем в' : p.diff < 0 ? 'Ниже, чем в' : 'Одинаково с'} ${name2}</div></div>
            <div class="summary-card ${ic}"><h4>Итог по доходу</h4><div class="big-number">${i.diff > 0 ? '+' : ''}${formatMoney(i.diff)}</div><div class="small-text">${isFinite(i.percent) ? (i.percent > 0 ? '+' : '') + i.percent.toFixed(1) + '%' : '—'}</div></div>
            <div class="summary-card ${hc}"><h4>Отработано часов</h4><div class="big-number">${h.diff > 0 ? '+' : ''}${h.diff.toFixed(1)} ч</div><div class="small-text">${name1}: ${s1.totalHours.toFixed(1)} ч vs ${name2}: ${s2.totalHours.toFixed(1)} ч</div></div>
        </div>`;
    results.innerHTML = html;
    updateComparisonChart(name1, name2, s1, s2);
}

function updateComparisonChart(n1, n2, s1, s2) {
    const canvas = document.getElementById('comparison-chart');
    if (!canvas) return;
    if (comparisonChart) comparisonChart.destroy();
    comparisonChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Доход', 'Расходы', 'Прибыль', 'Часы (x100)', 'Заказы (x10)'],
            datasets: [
                { label: n1, data: [s1.totalIncome, s1.totalExpenses, s1.netProfit, s1.totalHours * 100, s1.totalOrders * 10], backgroundColor: 'rgba(102,126,234,0.7)', borderColor: '#667eea', borderWidth: 2 },
                { label: n2, data: [s2.totalIncome, s2.totalExpenses, s2.netProfit, s2.totalHours * 100, s2.totalOrders * 10], backgroundColor: 'rgba(16,185,129,0.7)', borderColor: '#10b981', borderWidth: 2 }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: { callbacks: { label: (ctx) => {
                    let v = ctx.raw;
                    if (ctx.dataIndex === 3) v = (v / 100).toFixed(1) + ' ч';
                    else if (ctx.dataIndex === 4) v = (v / 10).toFixed(0) + ' шт';
                    else v = formatMoney(v);
                    return `${ctx.dataset.label}: ${v}`;
                } } }
            },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function quickCompare(type) {
    const now = new Date();
    const cm = (now.getMonth() + 1).toString().padStart(2, '0');
    const cy = now.getFullYear().toString();
    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');
    if (!c1m || !c1y || !c2m || !c2y) return;

    if (type === 'month') {
        const d = new Date(); d.setMonth(d.getMonth() - 1);
        c1m.value = cm; c1y.value = cy;
        c2m.value = (d.getMonth() + 1).toString().padStart(2, '0');
        c2y.value = d.getFullYear().toString();
    } else if (type === 'year') {
        c1m.value = ''; c1y.value = cy;
        c2m.value = ''; c2y.value = (parseInt(cy) - 1).toString();
    } else if (type === 'yoy') {
        c1m.value = cm; c1y.value = cy;
        c2m.value = cm; c2y.value = (parseInt(cy) - 1).toString();
    }
    updateComparison();
}

// ============================================
// РЕДАКТИРОВАНИЕ / УДАЛЕНИЕ
// ============================================
function editRecord(id) {
    window.editingId = id; // ⭐ синхронизация с entry-module
    if (typeof window.openEntryModal === 'function') window.openEntryModal(id);
}

async function deleteRecord(id, confirmDelete = true) {
    if (confirmDelete && !confirm('Удалить запись?')) return;
    if (typeof db !== 'undefined') await deleteRecordFromFirebase(id);
    records = records.filter(r => r.id !== id);
    saveData();
    renderTable();
    populateFilters();
    
    // ⭐ Обновляем аналитику
    updateAnalytics();
    
    // ⭐ СИНХРОНИЗАЦИЯ С КАЛЕНДАРЕМ
    if (typeof window.forceSyncHistoryToCalendar === 'function') {
        window.forceSyncHistoryToCalendar();
    }
    
    if (typeof window.updateHomeTab === 'function' &&
        document.getElementById('tab-home')?.classList.contains('active')) {
        window.updateHomeTab();
    }
}

// ============================================
// СОХРАНЕНИЕ ЗАПИСИ (вызывается из entry-module.js)
// ============================================
async function saveRecord(e) {
    if (e) e.preventDefault();
    const recordType = document.getElementById('record-type').value;
    const editingId = window.editingId;

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
        recordType, bonusPeriod: document.getElementById('bonus-period').value || ''
    };

    const normalized = normalizeRecord(record);
    const existingIdx = records.findIndex(r => r.date === record.date && r.id !== editingId);

    if (existingIdx >= 0) {
        if (!confirm('Запись за ' + formatDate(record.date) + ' уже существует. Перезаписать её?')) return false;
        normalized.id = records[existingIdx].id;
        records[existingIdx] = normalized;
        if (editingId) {
            const oldIdx = records.findIndex(r => r.id === editingId);
            if (oldIdx >= 0 && oldIdx !== existingIdx) {
                await deleteRecordFromFirebase(editingId);
                records.splice(oldIdx, 1);
            }
        }
    } else if (editingId) {
        const idx = records.findIndex(r => r.id === editingId);
        if (idx >= 0) { normalized.id = editingId; records[idx] = normalized; }
    } else {
        records.push(normalized);
    }

    window.editingId = null;
    const en = document.getElementById('editing-notice');
    if (en) en.style.display = 'none';
    records.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Сохраняем в Firebase и локально
    if (typeof db !== 'undefined') await saveRecordToFirebase(normalized);
    saveData();

    // ⭐ 1. СНАЧАЛА СИНХРОНИЗИРУЕМ КАЛЕНДАРЬ (ДО alert, чтобы не блокировать)
    if (typeof window.forceSyncHistoryToCalendar === 'function') {
        console.log('🔥 saveRecord → forceSyncHistoryToCalendar');
        window.forceSyncHistoryToCalendar();
    }

    // ⭐ 2. ОБНОВЛЯЕМ ИНТЕРФЕЙС
    if (typeof window.clearForm === 'function') window.clearForm();
    renderTable();
    populateFilters();
    updateAnalytics();

    // ⭐ 3. ОБНОВЛЯЕМ ГЛАВНУЮ (если открыта)
    if (typeof window.updateHomeTab === 'function' &&
        document.getElementById('tab-home')?.classList.contains('active')) {
        window.updateHomeTab();
    }

    // ⭐ 4. ALERT В САМОМ КОНЦЕ (не мешает синхронизации)
    let msg = '✅ Сохранено!';
    if (normalized.recordType === 'expense') msg += '\nРасход: ' + formatMoney(normalized.totalExpenses);
    else if (normalized.recordType === 'bonus') msg += '\nБонус: ' + formatMoney(normalized.bonusPay || 0);
    else {
        msg += '\nДоход: ' + formatMoney(normalized.totalIncome);
        if (normalized.totalExpenses > 0) msg += '\nРасход: ' + formatMoney(normalized.totalExpenses);
        msg += '\nПрибыль: ' + formatMoney(normalized.netProfit);
    }
    alert(msg);

    return true;
}
window.saveRecord = saveRecord;

// ============================================
// НАВИГАЦИЯ
// ============================================
function switchTab(tabName) {
    if (tabName === 'settings') {
        if (typeof window.openAppSettings === 'function') window.openAppSettings();
        return;
    }
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const target = document.getElementById('tab-' + tabName);
    if (target) target.classList.add('active');
    const btn = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
    if (btn) btn.classList.add('active');

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
        case 'tariffs': renderTariffs(); break;
        case 'home':
            setTimeout(() => { if (typeof window.updateHomeTab === 'function') window.updateHomeTab(); }, 50);
            break;
        case 'fuel':
            setTimeout(() => {
                if (typeof window.renderFuelLogs === 'function') window.renderFuelLogs();
                if (typeof window.updateFuelStats === 'function') window.updateFuelStats();
                if (typeof window.updateFuelChart === 'function') window.updateFuelChart();
            }, 50);
            break;
        case 'repair':
            setTimeout(() => {
                if (typeof window.renderRepairList === 'function') window.renderRepairList();
                if (typeof window.updateRepairStats === 'function') window.updateRepairStats();
                if (typeof window.updateRepairCharts === 'function') window.updateRepairCharts();
            }, 50);
            break;
        case 'shifts':
            setTimeout(() => {
                if (typeof window.renderShiftCalendar === 'function') window.renderShiftCalendar();
            }, 50);
            break;
    }
    saveState();
}
window.switchTab = switchTab;

// ============================================
// СОСТОЯНИЕ UI
// ============================================
const STATE_KEY = 'appState';

function saveState() {
    try {
        const activeBtn = document.querySelector('.nav-item.active');
        const state = {
            activeTab: activeBtn ? activeBtn.getAttribute('data-tab') : 'home',
            filterMonth: document.getElementById('filter-month')?.value || '',
            filterYear: document.getElementById('filter-year')?.value || '',
            compare1Month: document.getElementById('compare1-month')?.value || '',
            compare1Year: document.getElementById('compare1-year')?.value || '',
            compare2Month: document.getElementById('compare2-month')?.value || '',
            compare2Year: document.getElementById('compare2-year')?.value || '',
            timestamp: Date.now()
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) { console.error('Ошибка сохранения:', e); }
}

function restoreState() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        if (!saved) return;
        const s = JSON.parse(saved);
        const fm = document.getElementById('filter-month');
        const fy = document.getElementById('filter-year');
        if (fm && s.filterMonth) fm.value = s.filterMonth;
        if (fy && s.filterYear) fy.value = s.filterYear;
        const c1m = document.getElementById('compare1-month');
        const c1y = document.getElementById('compare1-year');
        const c2m = document.getElementById('compare2-month');
        const c2y = document.getElementById('compare2-year');
        if (c1m && s.compare1Month) c1m.value = s.compare1Month;
        if (c1y && s.compare1Year) c1y.value = s.compare1Year;
        if (c2m && s.compare2Month) c2m.value = s.compare2Month;
        if (c2y && s.compare2Year) c2y.value = s.compare2Year;
        if (s.activeTab && s.activeTab !== 'home') {
            setTimeout(() => switchTab(s.activeTab), 100);
        }
    } catch (e) { console.error('❌ Ошибка восстановления:', e); }
}

// ============================================
// МЕНЮ «АВТО» / «ОТЧЁТЫ»
// ============================================
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

function toggleAutoMenu(e) { if (e) e.stopPropagation(); togglePopupMenu('auto-menu', 'nav-auto-btn'); }
function toggleReportsMenu(e) { if (e) e.stopPropagation(); togglePopupMenu('reports-menu', 'nav-reports-btn'); }
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

// Обёртка switchTab для подсветки
(function () {
    const orig = window.switchTab;
    if (typeof orig !== 'function') return;
    window.switchTab = function (tabName) {
        const autoBtn = document.getElementById('nav-auto-btn');
        const reportsBtn = document.getElementById('nav-reports-btn');
        if (autoBtn && (tabName === 'fuel' || tabName === 'repair')) autoBtn.setAttribute('data-tab', tabName);
        if (reportsBtn && (tabName === 'analytics' || tabName === 'history')) reportsBtn.setAttribute('data-tab', tabName);
        orig.apply(this, arguments);
        document.querySelectorAll('#auto-menu .auto-menu-item').forEach(it => it.classList.toggle('active', it.getAttribute('data-tab') === tabName));
        document.querySelectorAll('#reports-menu .auto-menu-item').forEach(it => it.classList.toggle('active', it.getAttribute('data-tab') === tabName));
    };
})();

// ============================================
// FAB
// ============================================
function closeFabMenu() {
    const menu = document.getElementById('fab-menu');
    const fab = document.getElementById('fab-add');
    if (menu) menu.classList.remove('open');
    if (fab) fab.classList.remove('fab-open');
}

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

function selectFabAction(action) {
    closeFabMenu();
    if (action === 'entry') {
        if (typeof window.openEntryModal === 'function') window.openEntryModal();
    } else if (action === 'fuel') {
        if (typeof window.openFuelModal === 'function') window.openFuelModal();
        else switchTab('fuel');
    } else if (action === 'repair') {
        if (typeof window.openRepairModal === 'function') window.openRepairModal();
        else switchTab('repair');
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
// ПРОФИЛЬ: АВАТАР + ИМЯ (связано с loadUserData)
// ============================================
function loadProfileAvatar() {
    const img = document.getElementById('avatar-image');
    const icon = document.getElementById('avatar-icon');
    const container = document.getElementById('profile-avatar');
    if (!img || !icon) return;
    const saved = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (saved) {
        try {
            img.src = saved;
            img.style.display = 'block';
            icon.style.display = 'none';
            if (container) {
                container.style.background = 'none';
                container.style.borderColor = 'var(--ios-success)';
            }
            const btn = document.getElementById('avatar-upload-btn');
            if (btn) btn.style.background = 'var(--ios-success)';
        } catch (e) { console.error('❌ Ошибка загрузки аватара:', e); }
    } else {
        img.style.display = 'none';
        icon.style.display = 'block';
        if (container) {
            container.style.background = 'var(--ios-accent-light)';
            container.style.borderColor = 'var(--ios-accent)';
        }
        const btn = document.getElementById('avatar-upload-btn');
        if (btn) btn.style.background = 'var(--ios-accent)';
    }
}

function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 1 * 1024 * 1024) {
        alert('❌ Файл слишком большой для облачной синхронизации!\nМаксимум 1 МБ.');
        event.target.value = '';
        return;
    }
    if (!file.type.startsWith('image/')) {
        alert('❌ Выберите изображение!');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        const data = e.target.result;
        try {
            localStorage.setItem(AVATAR_STORAGE_KEY, data);
        } catch (err) {
            alert('❌ Не удалось сохранить. Файл слишком большой.');
            event.target.value = '';
            return;
        }
        loadProfileAvatar();
        if (window.currentUser && typeof db !== 'undefined') saveAvatarToFirebase(data);
        showToast('✅ Фото профиля обновлено!');
        event.target.value = '';
    };
    reader.onerror = function () {
        alert('❌ Ошибка чтения файла.');
        event.target.value = '';
    };
    reader.readAsDataURL(file);
}

async function saveAvatarToFirebase(data) {
    if (!window.currentUser || typeof db === 'undefined') return;
    try {
        await db.collection('users').doc(window.currentUser.uid).set({
            avatar: data,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
    } catch (e) { console.error('❌ Ошибка сохранения аватара:', e); }
}

async function loadAvatarFromFirebase() {
    if (!window.currentUser || typeof db === 'undefined') return;
    try {
        const doc = await db.collection('users').doc(window.currentUser.uid).get();
        if (doc.exists && doc.data().avatar) {
            localStorage.setItem(AVATAR_STORAGE_KEY, doc.data().avatar);
            loadProfileAvatar();
        }
    } catch (e) { console.error('❌ Ошибка загрузки аватара:', e); }
}

function removeAvatar() {
    if (!confirm('Удалить фото профиля?')) return;
    localStorage.removeItem(AVATAR_STORAGE_KEY);
    if (window.currentUser && typeof db !== 'undefined') {
        db.collection('users').doc(window.currentUser.uid)
            .update({ avatar: firebase.firestore.FieldValue.delete() })
            .then(() => {
                if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
            })
            .catch(err => console.error('❌ Ошибка удаления аватара:', err));
    }
    loadProfileAvatar();
    showToast('🗑️ Фото профиля удалено');
}

async function updateUserName(newName) {
    if (!window.currentUser) { alert('❌ Пользователь не авторизован'); return; }
    if (!newName || !newName.trim()) { alert('❌ Имя не может быть пустым'); return; }
    try {
        await window.currentUser.updateProfile({ displayName: newName.trim() });
        if (typeof db !== 'undefined') {
            await db.collection('users').doc(window.currentUser.uid).set({
                name: newName.trim(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        const el = document.getElementById('profile-name');
        if (el) el.textContent = newName.trim();
        showToast('✅ Имя обновлено!');
        await loadUserData();
    } catch (e) {
        console.error('❌ Ошибка обновления имени:', e);
        alert('❌ Ошибка: ' + e.message);
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
        setTimeout(() => { input.focus(); input.select(); }, 100);
    });
};
window.closeNameModal = function () {
    const modal = document.getElementById('name-modal-overlay');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
};
window.saveNameModal = async function () {
    const input = document.getElementById('name-modal-input');
    if (!input) return;
    const newName = input.value.trim();
    if (!newName) { showToast('❌ Имя не может быть пустым'); return; }
    window.closeNameModal();
    await updateUserName(newName);
};
document.addEventListener('click', function (e) {
    const m = document.getElementById('name-modal-overlay');
    if (m && m.classList.contains('visible') && e.target === m) window.closeNameModal();
});
document.addEventListener('keydown', function (e) {
    const m = document.getElementById('name-modal-overlay');
    if (!m || !m.classList.contains('visible')) return;
    if (e.key === 'Enter') { e.preventDefault(); window.saveNameModal(); }
    if (e.key === 'Escape') window.closeNameModal();
});

// Долгое нажатие на аватар — удалить
(function () {
    const c = document.getElementById('profile-avatar-container');
    if (!c) return;
    let t = null;
    const start = () => { t = setTimeout(removeAvatar, 1000); };
    const stop = () => clearTimeout(t);
    c.addEventListener('mousedown', start);
    c.addEventListener('mouseup', stop);
    c.addEventListener('mouseleave', stop);
    c.addEventListener('touchstart', start, { passive: true });
    c.addEventListener('touchend', stop);
    c.addEventListener('touchmove', stop);
})();

// ============================================
// НАСТРОЙКИ (модалка)
// ============================================
window.openAppSettings = function() {
    const modal = document.getElementById('tab-settings');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('visible'));
};
window.closeAppSettings = function () {
    const modal = document.getElementById('tab-settings');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
};
document.addEventListener('click', function (e) {
    const m = document.getElementById('tab-settings');
    if (m && m.classList.contains('visible') && e.target === m) window.closeAppSettings();
});
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const m = document.getElementById('tab-settings');
        if (m && m.classList.contains('visible')) window.closeAppSettings();
    }
});

// ============================================
// ТЁМНАЯ ТЕМА
// ============================================
(function () {
    const KEY = 'driverTheme';
    function apply(dark) {
        document.body.classList.toggle('dark-theme', dark);
        document.documentElement.style.background = dark ? '#000000' : '#F2F2F7';
        const t = document.getElementById('theme-toggle');
        if (t) t.checked = dark;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.content = dark ? '#000000' : '#F2F2F7';
    }
    const saved = localStorage.getItem(KEY);
    const prefers = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(saved ? saved === 'dark' : prefers);

    const t = document.getElementById('theme-toggle');
    if (t) t.addEventListener('change', function () {
        const dark = this.checked;
        localStorage.setItem(KEY, dark ? 'dark' : 'light');
        apply(dark);
        showToast(dark ? '🌙 Тёмная тема включена' : '☀️ Светлая тема включена');
    });

    document.addEventListener('click', function (e) {
        const btn = e.target.closest('#theme-toggle-btn');
        if (!btn) return;
        const dark = !document.body.classList.contains('dark-theme');
        localStorage.setItem(KEY, dark ? 'dark' : 'light');
        apply(dark);
        showToast(dark ? '🌙 Тёмная тема' : '☀️ Светлая тема');
    });
})();

// ============================================
// iOS-АЛЕРТЫ
// ============================================
(function () {
    window.showIOSAlert = function (message) {
        const lines = String(message).split('\n').map(s => s.trim()).filter(Boolean);
        const title = lines[0] || '';
        const body = lines.slice(1).map(s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
        const ov = document.createElement('div');
        ov.className = 'ios-alert-overlay';
        ov.innerHTML = `<div class="ios-alert">
            <div class="ios-alert-title">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
            ${body ? `<div class="ios-alert-body">${body}</div>` : ''}
            <button class="ios-alert-btn">OK</button>
        </div>`;
        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add('visible'));
        const close = (e) => {
            if (e) { e.stopPropagation(); e.preventDefault(); }
            ov.classList.remove('visible');
            setTimeout(() => ov.remove(), 250);
        };
        ov.querySelector('.ios-alert-btn').addEventListener('click', close);
        ov.addEventListener('click', e => { if (e.target === ov) close(e); });
    };
    window.alert = window.showIOSAlert;
})();

// ============================================
// iOS-СЕЛЕКТЫ
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
                sync(); close();
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
        closeAllIosSelects(); rebuild(); sync();
        wrap.classList.add('open');
        const sr = menu.querySelector('.selected');
        if (sr) setTimeout(() => sr.scrollIntoView({ block: 'nearest' }), 60);
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
        const isCat = texts.some(t => catRe.test(t));
        if (!isMonth && !isYear && !isPeriod && !isCat) return;
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCustomSelects);
else initCustomSelects();

let _iosTries = 0;
const _iosTimer = setInterval(() => {
    initCustomSelects();
    if (++_iosTries > 20) clearInterval(_iosTimer);
}, 1000);
new MutationObserver(() => initCustomSelects()).observe(document.body, { childList: true, subtree: true });

// Пересчёт таблицы при смене iOS-селекта в истории
document.addEventListener('change', function (e) {
    const sel = e.target;
    if (!sel || sel.tagName !== 'SELECT' || !sel.dataset.iosDone) return;
    if (!sel.closest('#tab-history')) return;
    setTimeout(() => {
        if (typeof window.renderTable === 'function') window.renderTable();
    }, 60);
});

// ============================================
// СВОРАЧИВАНИЕ СЕКЦИЙ В НАСТРОЙКАХ
// ============================================
(function() {
    function setupCollapse() {
        const modal = document.getElementById('tab-settings');
        if (!modal) return;
        
        // 1. Ищем все заголовки в настройках
        const allH2 = Array.from(modal.querySelectorAll('h2'));
        
        // 2. Настраиваем "Тарифы"
        const tariffsH2 = allH2.find(el => el.textContent.includes('Тарифы') || el.textContent.includes('Управление тарифами'));
        if (tariffsH2 && !tariffsH2.classList.contains('collapse-toggle')) {
            const card = tariffsH2.closest('.card');
            if (card) {
                // Создаем контейнер для скрытия
                const region = document.createElement('div');
                region.className = 'collapse-region collapsed';
                const inner = document.createElement('div');
                inner.className = 'collapse-inner';
                region.appendChild(inner);
                
                // Переносим всё после заголовка в контейнер
                let node = tariffsH2.nextElementSibling;
                while (node) {
                    const cur = node;
                    node = node.nextElementSibling;
                    inner.appendChild(cur);
                }
                card.appendChild(region);
                
                // Ищем и скрываем "Массовые действия" и "Историю тарифов"
                let region2 = null;
                let nextCard = card.nextElementSibling;
                const extraCards = [];
                while (nextCard) {
                    const hd = (nextCard.querySelector('h2, h3') || {}).textContent || '';
                    if (hd.includes('Массовые действия') || hd.includes('История тарифов')) {
                        extraCards.push(nextCard);
                        nextCard = nextCard.nextElementSibling;
                    } else {
                        break;
                    }
                }
                if (extraCards.length) {
                    region2 = document.createElement('div');
                    region2.className = 'collapse-region collapsed';
                    const inner2 = document.createElement('div');
                    inner2.className = 'collapse-inner';
                    region2.appendChild(inner2);
                    card.parentNode.insertBefore(region2, extraCards[0]);
                    extraCards.forEach(b => inner2.appendChild(b));
                }
                
                // Добавляем стрелочку и клик
                tariffsH2.classList.add('collapse-toggle');
                if (!tariffsH2.querySelector('.collapse-chevron')) {
                    const chev = document.createElement('ion-icon');
                    chev.setAttribute('name', 'chevron-down-outline');
                    chev.className = 'collapse-chevron';
                    tariffsH2.appendChild(chev);
                }
                
                tariffsH2.addEventListener('click', function() {
                    const isCollapsed = region.classList.contains('collapsed');
                    region.classList.toggle('collapsed', !isCollapsed);
                    if (region2) region2.classList.toggle('collapsed', !isCollapsed);
                    tariffsH2.classList.toggle('open', isCollapsed); // Если было свернуто -> открываем
                });
            }
        }
        
        // 3. Настраиваем "Мои автомобили"
        const vehiclesH2 = allH2.find(el => el.textContent.includes('Мои автомобили'));
        if (vehiclesH2 && !vehiclesH2.classList.contains('collapse-toggle')) {
            const card = vehiclesH2.closest('.card');
            if (card) {
                const region = document.createElement('div');
                region.className = 'collapse-region collapsed';
                const inner = document.createElement('div');
                inner.className = 'collapse-inner';
                region.appendChild(inner);
                
                let node = vehiclesH2.nextElementSibling;
                while (node) {
                    const cur = node;
                    node = node.nextElementSibling;
                    inner.appendChild(cur);
                }
                card.appendChild(region);
                
                vehiclesH2.classList.add('collapse-toggle');
                if (!vehiclesH2.querySelector('.collapse-chevron')) {
                    const chev = document.createElement('ion-icon');
                    chev.setAttribute('name', 'chevron-down-outline');
                    chev.className = 'collapse-chevron';
                    vehiclesH2.appendChild(chev);
                }
                
                vehiclesH2.addEventListener('click', function() {
                    const isCollapsed = region.classList.contains('collapsed');
                    region.classList.toggle('collapsed', !isCollapsed);
                    vehiclesH2.classList.toggle('open', isCollapsed);
                });
            }
        }
    }
    
    // Запускаем при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupCollapse);
    } else {
        setupCollapse();
    }
    
    // ⭐ ГЛАВНЫЙ ФИКС: принудительно сворачиваем при КАЖДОМ открытии настроек
    const origOpen = window.openAppSettings;
    window.openAppSettings = function() {
        if (typeof origOpen === 'function') origOpen();
        
        // Ждем 50мс, чтобы модалка отрисовалась, и сворачиваем всё
        setTimeout(() => {
            const modal = document.getElementById('tab-settings');
            if (!modal) return;
            modal.querySelectorAll('.collapse-region').forEach(r => r.classList.add('collapsed'));
            modal.querySelectorAll('.collapse-toggle').forEach(t => t.classList.remove('open'));
        }, 50);
    };
})();

// ============================================
// ЖИВАЯ ДАТА В ШАПКЕ
// ============================================
(function () {
    function syncSpacer() {
        const h = document.querySelector('.top-header');
        const s = document.getElementById('header-spacer');
        if (!h || !s) return;
        s.style.height = h.offsetHeight + 'px';
    }
    if ('ResizeObserver' in window) {
        const h = document.querySelector('.top-header');
        if (h) new ResizeObserver(syncSpacer).observe(h);
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
// ВАЛИДАЦИЯ ЧИСЛОВЫХ ПОЛЕЙ
// ============================================
function addFormValidation() {
    const fields = ['hours', 'orders-pickup', 'orders-delivery', 'distance', 'weight',
        'pay-pickup', 'pay-delivery', 'pay-distance', 'pay-weight',
        'load-pay', 'rating', 'tips', 'fuel-cost', 'repair-cost', 'tax'];
    fields.forEach(id => {
        const f = document.getElementById(id);
        if (!f) return;
        f.addEventListener('input', function () {
            if (this.value && parseFloat(this.value) < 0) this.value = 0;
        });
    });
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📱 DOM загружен, инициализация ядра...');

    (async function initApp() {
        await loadData();

        let fixed = false;
        records = records.map(r => {
            if (!r.recordType || r.recordType === '' || r.recordType === 'undefined') {
                fixed = true;
                r.recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
            }
            return normalizeRecord(r);
        });
        if (fixed) saveData();

        const form = document.getElementById('tariff-form');
        if (form) form.addEventListener('submit', saveTariff);

        const main = document.querySelector('.container');
        const nav = document.querySelector('.bottom-nav');
        const auth = document.getElementById('auth-screen');
        if (main) main.style.display = 'none';
        if (nav) nav.style.display = 'none';
        if (auth) auth.classList.remove('hidden');

        addFormValidation();
        console.log('✅ Базовая инициализация завершена. Ожидание авторизации...');
    })();

    initHistoryFilters();

    if (typeof window.renderUnifiedStatus === 'function') window.renderUnifiedStatus();

    setTimeout(() => {
        if (typeof window.checkFirebaseConnection === 'function') window.checkFirebaseConnection();
    }, 3000);

    setInterval(() => {
        if (document.body.classList.contains('authenticated')) {
            if (typeof window.checkFirebaseConnection === 'function') window.checkFirebaseConnection();
        }
    }, 30000);

    // FAB tooltip
    const fab = document.getElementById('fab-add');
    const tip = document.getElementById('fab-tooltip');
    if (fab && tip) {
        fab.addEventListener('mouseenter', () => {
            tip.style.opacity = '1';
            tip.style.transform = 'translateX(0) scale(1)';
        });
        fab.addEventListener('mouseleave', () => {
            tip.style.opacity = '0';
            tip.style.transform = 'translateX(10px) scale(0.9)';
        });
    }

    // Двойной клик по имени
    const nameEl = document.getElementById('profile-name');
    if (nameEl) {
        nameEl.addEventListener('dblclick', window.showEditNameDialog);
        nameEl.style.cursor = 'pointer';
        nameEl.title = 'Двойной клик — изменить';
    }

    loadProfileAvatar();

    setTimeout(() => restoreState(), 500);
});

// Ресайз → перерендер карточек
let _rzTimer;
window.addEventListener('resize', () => {
    clearTimeout(_rzTimer);
    _rzTimer = setTimeout(() => {
        if (currentViewMode === 'auto') renderTable();
    }, 250);
});

// Восстановление активной кнопки переключателя вида
(function () {
    const bt = document.getElementById('vmt-table');
    const bc = document.getElementById('vmt-cards');
    if (!bt || !bc) return;
    if (currentViewMode === 'cards') { bt.classList.remove('active'); bc.classList.add('active'); }
    else if (currentViewMode === 'table') { bt.classList.add('active'); bc.classList.remove('active'); }
})();

// ============================================
// ОБЩИЙ КАРКАС ТУЛТИПА (позиционирование + закрытие)
// Контент формируют модули (fuel/repair)
// ============================================
(function () {
    let _currentTip = null;

    window.__tooltipShow = function (html, anchor, cssClass) {
        window.__tooltipClose();
        const tip = document.createElement('div');
        tip.className = (cssClass || 'fuel-tooltip') + ' visible';
        tip.id = 'card-tooltip';
        tip.innerHTML = html;
        document.body.appendChild(tip);

        if (window.innerWidth > 480 && anchor) {
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
        _currentTip = tip;
        return tip;
    };

    window.__tooltipClose = function () {
        if (!_currentTip) return;
        _currentTip.classList.remove('visible');
        const t = _currentTip;
        setTimeout(() => { if (t.parentNode) t.remove(); }, 250);
        _currentTip = null;
    };

    document.addEventListener('click', function (e) {
        if (!_currentTip) return;
        if (_currentTip.contains(e.target)) return;
        const isAnchor = e.target.closest(
            'td.fuel-cell-with-details, td.repair-cell-with-details, .rcd-fuel, .rcd-repair'
        );
        if (!isAnchor) window.__tooltipClose();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') window.__tooltipClose();
    });

    window.addEventListener('scroll', function (e) {
        if (!_currentTip) return;
        if (e.target === _currentTip || _currentTip.contains(e.target)) return;
        window.__tooltipClose();
    }, true);
})();

// ============================================
// ПАТЧ: модалка «Настройки» → стиль fuel/repair
// (только графика, логика/id/onclick НЕ трогается)
// ============================================
(function () {
    'use strict';

    const BLACKLIST = new Set([
        'chevron-down','chevron-up','chevron-forward','chevron-back',
        'arrow-forward','arrow-back','arrow-up','arrow-down',
        'swap-horizontal','swap-vertical','ellipsis','ellipsis-horizontal','ellipsis-vertical',
        'filter','search','add','add-outline','add-circle-outline','remove','remove-outline'
    ]);

    const COLORS = {
        'pricetag-outline':'yellow','pricetag':'yellow','key-outline':'yellow','trophy-outline':'yellow',
        'car-outline':'blue','settings-outline':'blue','save-outline':'blue','sync-outline':'blue',
        'grid-outline':'blue','grid':'blue','info-outline':'blue','document-outline':'blue','receipt-outline':'blue',
        'cloud-outline':'green','cloud-upload-outline':'green','cloud-download-outline':'green','checkmark-outline':'green','lock-closed-outline':'green',
        'document-text-outline':'purple','person-circle-outline':'purple','person-outline':'purple','mail-outline':'blue','list-outline':'purple',
        'layers-outline':'orange','flame-outline':'orange','construct-outline':'orange','speedometer-outline':'orange',
        'download-outline':'cyan','water-outline':'cyan','snow-outline':'cyan',
        'trash-outline':'red','alert-circle-outline':'red','close-outline':'red','log-out-outline':'red','warning-outline':'red',
        'cash-outline':'green','wallet-outline':'red','trending-up-outline':'teal','chatbubble-outline':'teal'
    };
    const colorFor = n => 'asm-icon-' + (COLORS[n] || 'blue');

    function findSettingsModal() {
        let best = null, bestLen = Infinity;
        document.querySelectorAll('div, section').forEach(el => {
            const t = el.textContent || '';
            if (t.includes('Резервное копирование') && t.includes('Мои автомобили') && t.includes('Тарифы')) {
                if (t.length < bestLen) { bestLen = t.length; best = el; }
            }
        });
        return best;
    }

    function wrapIcons(modal) {
        modal.querySelectorAll('ion-icon').forEach(icon => {
            if (icon.closest('.asm-icon-badge')) return;
            const name = icon.getAttribute('name') || '';
            if (BLACKLIST.has(name)) return;
            const parent = icon.parentElement;
            if (!parent) return;
            // иконка без подписи рядом (крестик X в шапке) — не оборачиваем
            if (parent.textContent.trim() === '') return;
            const span = document.createElement('span');
            span.className = 'asm-icon-badge ' + colorFor(name);
            icon.replaceWith(span);
            span.appendChild(icon);
        });
    }

    let done = false;
    function run() {
        if (done) return;
        const m = findSettingsModal();
        if (!m) return;
        if (m.dataset.asmPatched === '1') { done = true; return; }
        m.classList.add('asm-modal');
        wrapIcons(m);
        m.dataset.asmPatched = '1';
        done = true;
    }

    function boot() {
        run();
        if (done) return;
        const obs = new MutationObserver(() => {
            run();
            if (done) obs.disconnect();
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

// ============================================
// АККОРДЕОНЫ В МОДАЛКЕ «НАСТРОЙКИ»
// ============================================
function toggleSettingsSection(headerEl) {
    const card = headerEl.closest('.settings-card');
    if (!card) return;
    card.classList.toggle('collapsed');
    
    // Запоминаем состояние по тексту заголовка
    const title = (headerEl.textContent || '').trim();
    try {
        const state = JSON.parse(localStorage.getItem('settingsAccordionState') || '{}');
        state[title] = card.classList.contains('collapsed');
        localStorage.setItem('settingsAccordionState', JSON.stringify(state));
    } catch (e) {}
}

// Восстановление состояния (свёрнутые секции остаются свёрнутыми)
function restoreSettingsAccordionState() {
    try {
        const state = JSON.parse(localStorage.getItem('settingsAccordionState') || '{}');
        document.querySelectorAll('#tab-settings .settings-accordion-header').forEach(header => {
            const title = (header.textContent || '').trim();
            const card = header.closest('.settings-card');
            if (card && state[title] === true) card.classList.add('collapsed');
        });
    } catch (e) {}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreSettingsAccordionState);
} else {
    restoreSettingsAccordionState();
}
window.toggleSettingsSection = toggleSettingsSection;

// ============================================
// SWIPE TO DISMISS — закрытие модалок свайпом вниз
// ============================================
(function() {
    'use strict';
    
    const DISMISS_THRESHOLD = 120; // пикселей, после которых модалка закроется
    
    function enableSwipeToDismiss(overlayId, closeFn) {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return;
        
        const modal = overlay.querySelector('.fuel-modal, .entry-modal, .cp-settings-modal');
        if (!modal) return;
        
        // Зона свайпа: ручка или шапка
        const dragHandle = overlay.querySelector('.fuel-modal-handle, .entry-modal-handle, .fuel-modal-header');
        if (!dragHandle) return;
        
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        let isAnimating = false;
        
        // Тело со скроллом (для проверки scrollTop)
        const modalBody = overlay.querySelector('.fuel-modal-body, .entry-modal-body, .cp-settings-body');
        
        function canSwipe() {
            // Разрешаем свайп только если контент прокручен до самого верха
            return !modalBody || modalBody.scrollTop <= 2;
        }
        
        function onTouchStart(e) {
            if (isAnimating) return;
            if (!canSwipe()) return;
            if (e.touches.length !== 1) return;
            
            isDragging = true;
            startY = e.touches[0].clientY;
            currentY = startY;
            modal.style.transition = 'none';
        }
        
        function onTouchMove(e) {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;
            
            // Реагируем только на движение ВНИЗ
            if (deltaY > 0) {
                // Если пользователь начал тянуть вниз — блокируем скролл страницы
                if (deltaY > 5) e.preventDefault();
                // Плавное сопротивление после 100px
                const resistance = deltaY < 100 ? 1 : 100 + (deltaY - 100) * 0.4;
                modal.style.transform = `translateY(${resistance}px)`;
            }
        }
        
        function onTouchEnd() {
            if (!isDragging) return;
            isDragging = false;
            isAnimating = true;
            
            const deltaY = currentY - startY;
            
            if (deltaY > DISMISS_THRESHOLD) {
                // Закрываем
                modal.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
                modal.style.transform = 'translateY(100%)';
                
                setTimeout(() => {
                    modal.style.transform = '';
                    isAnimating = false;
                    if (typeof closeFn === 'function') closeFn();
                }, 300);
            } else {
                // Возвращаем на место
                modal.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
                modal.style.transform = '';
                setTimeout(() => { isAnimating = false; }, 350);
            }
        }
        
        dragHandle.addEventListener('touchstart', onTouchStart, { passive: true });
        dragHandle.addEventListener('touchmove', onTouchMove, { passive: false });
        dragHandle.addEventListener('touchend', onTouchEnd);
        dragHandle.addEventListener('touchcancel', onTouchEnd);
        
        // Курсор grab для десктопа
        dragHandle.style.cursor = 'grab';
        dragHandle.addEventListener('mousedown', (e) => {
            if (isAnimating) return;
            if (!canSwipe()) return;
            isDragging = true;
            startY = e.clientY;
            currentY = startY;
            modal.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            currentY = e.clientY;
            const deltaY = currentY - startY;
            if (deltaY > 0) {
                const resistance = deltaY < 100 ? 1 : 100 + (deltaY - 100) * 0.4;
                modal.style.transform = `translateY(${resistance}px)`;
            }
        });
        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            const deltaY = currentY - startY;
            isDragging = false;
            isAnimating = true;
            if (deltaY > DISMISS_THRESHOLD) {
                modal.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
                modal.style.transform = 'translateY(100%)';
                setTimeout(() => {
                    modal.style.transform = '';
                    isAnimating = false;
                    if (typeof closeFn === 'function') closeFn();
                }, 300);
            } else {
                modal.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
                modal.style.transform = '';
                setTimeout(() => { isAnimating = false; }, 350);
            }
        });
    }
    
    // Инициализация для всех модалок
    function initAllSwipeDismiss() {
        enableSwipeToDismiss('fuel-modal-overlay', () => {
            if (typeof window.closeFuelModal === 'function') window.closeFuelModal();
        });
        enableSwipeToDismiss('repair-modal-overlay', () => {
            if (typeof window.closeRepairModal === 'function') window.closeRepairModal();
        });
        enableSwipeToDismiss('tab-settings', () => {
            if (typeof window.closeAppSettings === 'function') window.closeAppSettings();
        });
        enableSwipeToDismiss('entry-modal-overlay', () => {
            if (typeof window.closeEntryModal === 'function') window.closeEntryModal();
        });
        enableSwipeToDismiss('name-modal-overlay', () => {
            if (typeof window.closeNameModal === 'function') window.closeNameModal();
        });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAllSwipeDismiss);
    } else {
        initAllSwipeDismiss();
    }
    
    // Наблюдаем за DOM на случай динамического создания модалок
    const observer = new MutationObserver(() => {
        initAllSwipeDismiss();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    console.log('✅ Swipe-to-dismiss модуль загружен');
})();    

// ============================================
// ЭКСПОРТ В WINDOW
// ============================================
window.loadUserData = loadUserData;
window.loadData = loadData;
window.saveData = saveData;
window.normalizeRecord = normalizeRecord;
window.normalizeTariff = normalizeTariff;
window.renderTable = renderTable;
window.renderTariffs = renderTariffs;
window.populateFilters = populateFilters;
window.updateAnalytics = updateAnalytics;
window.showToast = showToast;
window.filterState = filterState;
window.sortState = sortState;
window.applyFilters = applyFilters;
window.applySorting = applySorting;
window.toggleFilter = toggleFilter;
window.clearAllFilters = clearAllFilters;
window.setViewMode = setViewMode;
window.toggleCardDetails = toggleCardDetails;
window.editRecord = editRecord;
window.deleteRecord = deleteRecord;
window.saveTariff = saveTariff;
window.deleteTariff = deleteTariff;
window.recalculateAllTariffs = recalculateAllTariffs;
window.updateComparison = updateComparison;
window.quickCompare = quickCompare;
window.initComparisonSelectors = initComparisonSelectors;
window.filterHistoryByMonth = filterHistoryByMonth;
window.showAllHistory = showAllHistory;
window.goToPage = goToPage;
window.toggleAutoMenu = toggleAutoMenu;
window.toggleReportsMenu = toggleReportsMenu;
window.selectAutoTab = selectAutoTab;
window.selectReportsTab = selectReportsTab;
window.toggleFabMenu = toggleFabMenu;
window.selectFabAction = selectFabAction;
window.closeFabMenu = closeFabMenu;
window.formatMoney = formatMoney;
window.formatDate = formatDate;
window.parseLocalDate = parseLocalDate;
window.getTariffForDate = getTariffForDate;
window.getCurrentTariff = getCurrentTariff;
window.calcIncome = calcIncome;
window.calcExpenses = calcExpenses;
window.saveRecordToFirebase = saveRecordToFirebase;
window.saveRecordsBatchToFirebase = saveRecordsBatchToFirebase;
window.deleteRecordFromFirebase = deleteRecordFromFirebase;
window.loadProfileAvatar = loadProfileAvatar;
window.uploadAvatar = uploadAvatar;
window.saveAvatarToFirebase = saveAvatarToFirebase;
window.loadAvatarFromFirebase = loadAvatarFromFirebase;
window.removeAvatar = removeAvatar;
window.updateUserName = updateUserName;

console.log('✅ script.js (ядро v5.2) загружен');