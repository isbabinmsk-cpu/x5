let records = [];
let tariffs = [];
let incomeChart = null;
let expensesChart = null;
let comparisonChart = null;
let editingId = null;
const DEFAULT_TARIFF = { pickup: 60, delivery: 81, km: 11, weight: 2 };
// Состояние авто-расчета для полей км и вес
let autoCalcState = {
    km: true,
    weight: true
};

// ===== АУТЕНТИФИКАЦИЯ =====
function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabs = document.querySelectorAll('.auth-tab');
    
    tabs.forEach(t => t.classList.remove('active'));
    
    if (tab === 'login') {
        loginForm.style.display = 'flex';
        registerForm.style.display = 'none';
        tabs[0].classList.add('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'flex';
        tabs[1].classList.add('active');
    }
    
    // Очищаем ошибки
    document.getElementById('login-error').textContent = '';
    document.getElementById('register-error').textContent = '';
}

// Обработчик входа
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        errorEl.textContent = '';
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        errorEl.textContent = getAuthErrorMessage(error.code);
    }
});

// Обработчик регистрации
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    const errorEl = document.getElementById('register-error');
    
    if (password !== confirm) {
        errorEl.textContent = 'Пароли не совпадают';
        return;
    }
    
    try {
        errorEl.textContent = '';
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        
        // Сохраняем имя пользователя
        await userCredential.user.updateProfile({
            displayName: name
        });
        
        // Создаем документ пользователя в Firestore
        await db.collection('users').doc(userCredential.user.uid).set({
            name: name,
            email: email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        errorEl.textContent = getAuthErrorMessage(error.code);
    }
});

// Обработчик выхода
document.getElementById('logout-btn').addEventListener('click', async () => {
    if (confirm('Выйти из аккаунта?')) {
        await auth.signOut();
    }
});

// Слушатель состояния аутентификации
auth.onAuthStateChanged(async (user) => {
    const authScreen = document.getElementById('auth-screen');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (user) {
        // Пользователь вошел
        currentUser = user;
        
        // Проверяем существование элементов перед изменением
        if (authScreen) authScreen.classList.add('hidden');
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
        
        console.log('✅ Пользователь вошел:', user.email);
        
        // Загружаем данные пользователя с обработкой ошибок
        try {
            await loadUserData();
        } catch (error) {
            console.error('❌ Ошибка загрузки данных пользователя:', error);
            alert('Ошибка загрузки данных: ' + error.message);
        }
    } else {
        // Пользователь вышел
        currentUser = null;
        
        // Проверяем существование элементов
        if (authScreen) authScreen.classList.remove('hidden');
        if (logoutBtn) logoutBtn.style.display = 'none';
        
        // Очищаем данные
        records = [];
        tariffs = [];
        saveData();
    }
});

// Функция получения сообщений об ошибках
function getAuthErrorMessage(errorCode) {
    const messages = {
        'auth/email-already-in-use': 'Этот email уже используется',
        'auth/invalid-email': 'Некорректный email',
        'auth/weak-password': 'Пароль слишком короткий (минимум 6 символов)',
        'auth/user-not-found': 'Пользователь не найден',
        'auth/wrong-password': 'Неверный пароль',
        'auth/invalid-credential': 'Неверный email или пароль',
        'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже'
    };
    return messages[errorCode] || 'Произошла ошибка. Попробуйте еще раз';
}

// Загрузка данных пользователя из Firebase
async function loadUserData() {
    if (!currentUser) return;
    
    // В функции loadUserData(), в самом начале, добавьте:
const mainContainer = document.querySelector('.container');
const bottomNav = document.querySelector('.bottom-nav');
const authScreen = document.getElementById('auth-screen');

if (authScreen) authScreen.classList.add('hidden');
if (mainContainer) mainContainer.style.display = 'block';
if (bottomNav) bottomNav.style.display = 'flex';
    
    try {
        console.log('🔄 Загрузка данных пользователя...');
        
        // Загружаем записи пользователя
        const recordsSnapshot = await db.collection('users')
            .doc(currentUser.uid)
            .collection('records')
            .orderBy('date', 'desc')
            .get();
        
        records = recordsSnapshot.docs.map(doc => {
            return normalizeRecord({ id: doc.id, ...doc.data() });
        });
        
        console.log('✅ Загружено записей:', records.length);
        
        // Загружаем тарифы пользователя
        const tariffsSnapshot = await db.collection('users')
            .doc(currentUser.uid)
            .collection('tariffs')
            .orderBy('date', 'desc')
            .get();
        
        tariffs = tariffsSnapshot.docs.map(doc => {
            return normalizeTariff({ id: doc.id, ...doc.data() });
        });
        
        console.log('✅ Загружено тарифов:', tariffs.length);
        
        // Если нет тарифов - создаем стандартный
        if (tariffs.length === 0) {
            const defaultTariff = {
                date: new Date().toISOString().split('T')[0],
                pickup: 60,
                delivery: 81,
                km: 11,
                weight: 2
            };
            const docRef = await db.collection('users')
                .doc(currentUser.uid)
                .collection('tariffs')
                .add(defaultTariff);
            tariffs.push(normalizeTariff({ id: docRef.id, ...defaultTariff }));
        }
        
        saveData();
        
        // Обновляем интерфейс
        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        alert('Ошибка загрузки данных: ' + error.message);
    }
}

// ===== СОХРАНЕНИЕ СОСТОЯНИЯ =====
const STATE_KEY = 'appState';
let isRestoringState = false; // Флаг восстановления состояния

function saveState() {
    try {
        const activeBtn = document.querySelector('.nav-btn.active');
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
        
        // Восстанавливаем фильтры аналитики
        const filterMonth = document.getElementById('filter-month');
        const filterYear = document.getElementById('filter-year');
        if (filterMonth && state.filterMonth) filterMonth.value = state.filterMonth;
        if (filterYear && state.filterYear) filterYear.value = state.filterYear;
        
        // Восстанавливаем периоды сравнения
        const c1m = document.getElementById('compare1-month');
        const c1y = document.getElementById('compare1-year');
        const c2m = document.getElementById('compare2-month');
        const c2y = document.getElementById('compare2-year');
        if (c1m && state.compare1Month) c1m.value = state.compare1Month;
        if (c1y && state.compare1Year) c1y.value = state.compare1Year;
        if (c2m && state.compare2Month) c2m.value = state.compare2Month;
        if (c2y && state.compare2Year) c2y.value = state.compare2Year;
        
        // Переключаем вкладку
        if (state.activeTab) {
            // Устанавливаем классы напрямую БЕЗ вызова switchTab
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
            
            const targetTab = document.getElementById('tab-' + state.activeTab);
            const targetBtn = document.querySelector('.nav-btn[data-tab="' + state.activeTab + '"]');
            
            if (targetTab) targetTab.classList.add('active');
            if (targetBtn) targetBtn.classList.add('active');
            
            // Запускаем функции для активной вкладки
            if (state.activeTab === 'analytics') {
                updateAnalytics();
                initComparisonSelectors();
                updateComparison();
            } else if (state.activeTab === 'history') {
                renderTable();
            } else if (state.activeTab === 'tariffs') {
                renderTariffs();
            }
        }
    } catch (e) {
        console.error('❌ Ошибка восстановления:', e);
    }
}

// ===== ФИЛЬТРЫ =====
let activeFilters = {};
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

// ===== СОРТИРОВКА =====
let sortState = {
    column: null,
    direction: null
};
let currentFilterColumn = null;

// ===== ФУНКЦИИ ФИЛЬТРАЦИИ =====
function toggleFilter(column) {
    const filterRow = document.getElementById('filter-row');
    if (!filterRow) return;

    if (filterRow.style.display === 'none' || filterRow.style.display === '') {
        filterRow.style.display = 'table-row';
        currentFilterColumn = column;
        showFilterForColumn(column);
    } else if (currentFilterColumn === column) {
        filterRow.style.display = 'none';
        currentFilterColumn = null;
    } else {
        currentFilterColumn = column;
        showFilterForColumn(column);
    }
}

function showFilterForColumn(column) {
    const columns = Object.keys(filterState);
    columns.forEach(col => {
        const cell = document.getElementById('filter-' + col);
        if (cell) {
            if (col === column) {
                cell.style.display = 'table-cell';
                renderFilter(col);
            } else {
                cell.style.display = 'none';
                cell.innerHTML = '';
            }
        }
    });
}

function renderFilter(column) {
    const container = document.getElementById('filter-' + column);
    if (!container) return;
    container.innerHTML = '';
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
        select.onclick = (e) => e.stopPropagation();
        select.onchange = (e) => {
            filterState.date.values = e.target.value ? [e.target.value] : [];
            renderTable();
        };
        container.appendChild(select);
    } 
    else if (column === 'weekday') {
        const days = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
        wrapper.onclick = (e) => e.stopPropagation();
        days.forEach(day => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;font-size:11px;cursor:pointer;';
            label.onclick = (e) => e.stopPropagation();
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = day;
            checkbox.checked = filterState.weekday.values.includes(day);
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
            { value: 'work', label: '<ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px; color: #007AFF;"></ion-icon>Работа' },
            { value: 'bonus', label: '<ion-icon name="gift-outline" style="vertical-align: middle; margin-right: 4px; color: #AF52DE;"></ion-icon>Бонус' },
            { value: 'expense', label: '<ion-icon name="remove-circle-outline" style="vertical-align: middle; margin-right: 4px; color: #FF3B30;"></ion-icon>Расход' }
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
                    if (!filterState.type.values.includes(t.value)) filterState.type.values.push(t.value);
                } else {
                    filterState.type.values = filterState.type.values.filter(v => v !== t.value);
                }
                renderTable();
            };
            label.appendChild(checkbox);
            const span = document.createElement('span');
            span.innerHTML = t.label;
            label.appendChild(span);
            wrapper.appendChild(label);
        });
        container.appendChild(wrapper);
    } 
    else if (filterState[column] && filterState[column].type === 'range') {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        wrapper.onclick = (e) => e.stopPropagation();

        // Поля ввода для диапазона
        const inputsWrapper = document.createElement('div');
        inputsWrapper.style.cssText = 'display:flex;gap:4px;align-items:center;';
        
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.placeholder = 'От';
        minInput.style.cssText = 'width:60px;padding:4px;font-size:11px;border:1px solid #ccc;border-radius:4px;';
        minInput.value = filterState[column].min;
        minInput.onclick = (e) => e.stopPropagation();
        minInput.onchange = (e) => { filterState[column].min = e.target.value; renderTable(); };

        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.placeholder = 'До';
        maxInput.style.cssText = 'width:60px;padding:4px;font-size:11px;border:1px solid #ccc;border-radius:4px;';
        maxInput.value = filterState[column].max;
        maxInput.onclick = (e) => e.stopPropagation();
        maxInput.onchange = (e) => { filterState[column].max = e.target.value; renderTable(); };

        inputsWrapper.appendChild(minInput);
        inputsWrapper.appendChild(maxInput);
        wrapper.appendChild(inputsWrapper);

        // Кнопки сортировки
        const sortWrapper = document.createElement('div');
        sortWrapper.style.cssText = 'display:flex;gap:4px;';
        
        const btnAsc = document.createElement('button');
        btnAsc.innerHTML = '↑ А→Я';
        btnAsc.style.cssText = `padding:4px 8px;font-size:11px;cursor:pointer;border:1px solid #ccc;border-radius:6px;background:${sortState.column === column && sortState.direction === 'asc' ? '#007AFF' : '#fff'};color:${sortState.column === column && sortState.direction === 'asc' ? '#fff' : '#333'};`;
        btnAsc.onclick = (e) => {
            e.stopPropagation();
            if (sortState.column === column && sortState.direction === 'asc') { sortState.column = null; sortState.direction = null; } 
            else { sortState.column = column; sortState.direction = 'asc'; }
            renderTable(); renderFilter(column);
        };

        const btnDesc = document.createElement('button');
        btnDesc.innerHTML = '↓ Я→А';
        btnDesc.style.cssText = `padding:4px 8px;font-size:11px;cursor:pointer;border:1px solid #ccc;border-radius:6px;background:${sortState.column === column && sortState.direction === 'desc' ? '#007AFF' : '#fff'};color:${sortState.column === column && sortState.direction === 'desc' ? '#fff' : '#333'};`;
        btnDesc.onclick = (e) => {
            e.stopPropagation();
            if (sortState.column === column && sortState.direction === 'desc') { sortState.column = null; sortState.direction = null; } 
            else { sortState.column = column; sortState.direction = 'desc'; }
            renderTable(); renderFilter(column);
        };

        sortWrapper.appendChild(btnAsc);
        sortWrapper.appendChild(btnDesc);
        wrapper.appendChild(sortWrapper);
        container.appendChild(wrapper);
    }
}

function updateWeekdayFilter(e) {
    if (e) e.stopPropagation();
    const checkboxes = document.querySelectorAll('#filter-weekday input[type="checkbox"]');
    filterState.weekday.values = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    renderTable();
}

function getUniqueMonths() {
    const monthsMap = new Map();
    records.forEach(r => {
        if (!r.date) return;
        const d = new Date(r.date);
        const monthKey = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        const monthLabel = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][d.getMonth()] + ' ' + d.getFullYear();
        if (!monthsMap.has(monthKey)) monthsMap.set(monthKey, { value: monthKey, label: monthLabel });
    });
    return Array.from(monthsMap.values()).sort((a,b) => b.value.localeCompare(a.value));
}

function clearAllFilters() {
    filterState = {
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
    
    sortState = { column: null, direction: null };

    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        filterRow.style.display = 'none';
        const cells = filterRow.querySelectorAll('td');
        cells.forEach(cell => { if (cell.id && cell.id.startsWith('filter-')) cell.innerHTML = ''; });
    }
    currentFilterColumn = null;
    renderTable();
}

function applyFilters(data) {
    return data.filter(r => {
        if (filterState.date.values.length > 0) {
            const recordMonth = r.date ? r.date.substring(0, 7) : '';
            if (!filterState.date.values.includes(recordMonth)) return false;
        }
        if (filterState.weekday.values.length > 0) {
            const recordWeekday = r.weekday ? r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase() : '';
            if (!filterState.weekday.values.includes(recordWeekday)) return false;
        }
        if (filterState.type.values.length > 0) {
            if (!filterState.type.values.includes(r.recordType)) return false;
        }
        
        const rangeFields = Object.keys(filterState).filter(k => filterState[k].type === 'range');
        for (const field of rangeFields) {
            const filter = filterState[field];
            const value = parseFloat(r[field]) || 0;
            if (filter.min !== '' && value < parseFloat(filter.min)) return false;
            if (filter.max !== '' && value > parseFloat(filter.max)) return false;
        }
        return true;
    });
}

function applySorting(data) {
    if (!sortState.column || !sortState.direction) return data;
    const field = sortState.column;
    if (data.length === 0 || !(field in data[0])) return data;
    
    return [...data].sort((a, b) => {
        const valA = parseFloat(a[field]) || 0;
        const valB = parseFloat(b[field]) || 0;
        return sortState.direction === 'asc' ? valA - valB : valB - valA;
    });
}

// ===== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ РЕНДЕРА СТРОКИ (ГАРАНТИЯ ВЫРАВНИВАНИЯ) =====
function getRecordRowHTML(r) {
    const typeLabel = r.recordType === 'bonus'
        ? '<ion-icon name="gift-outline" style="vertical-align: middle; margin-right: 4px; color: #AF52DE;"></ion-icon>Бонус'
        : r.recordType === 'expense'
        ? '<ion-icon name="remove-circle-outline" style="vertical-align: middle; margin-right: 4px; color: #FF3B30;"></ion-icon>Расход'
        : '<ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px; color: #007AFF;"></ion-icon>Работа';

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
        <td>${r.fuelCost ? formatMoney(r.fuelCost) : '-'}</td>
        <td>${r.repairCost ? formatMoney(r.repairCost) : '-'}</td>
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

function renderTable() {
    const tbody = document.getElementById('records-body');
    
    // ✅ ПРОВЕРКА: существует ли tbody
    if (!tbody) {
        console.error(' Элемент <tbody id="records-body"> не найден в HTML');
        return; // Выходим из функции, чтобы избежать ошибки
    }
    
    tbody.innerHTML = '';
    
    // ... остальной код функции

    let filteredRecords = [...records];
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
        filteredRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
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

// ===== РЕНДЕР ТАБЛИЦЫ С ПОНЕДЕЛЬНЫМИ ИТОГАМИ =====
function renderTableWithWeeklySummary(tbody, records) {
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
        }, { hours: 0, ordersPickup: 0, payPickup: 0, ordersDelivery: 0, payDelivery: 0, distance: 0, payDistance: 0, weight: 0, payWeight: 0, loadPay: 0, bonusPay: 0, rating: 0, tips: 0, fuelCost: 0, repairCost: 0, tax: 0, totalIncome: 0, totalExpenses: 0, netProfit: 0, workingDays: 0 });

        // Заголовок недели
        const headerRow = document.createElement('tr');
        headerRow.className = 'week-summary-header';
        headerRow.innerHTML = `<td colspan="23"><ion-icon name="calendar-outline" class="week-header-icon"></ion-icon> Неделя ${weekKey.split('-W')[1]} (${weekRange.label}) — ${summary.workingDays} ${summary.workingDays === 1 ? 'день' : (summary.workingDays >= 2 && summary.workingDays <= 4 ? 'дня' : 'дней')}</td>`;
        tbody.appendChild(headerRow);

        // Записи недели
        weekRecords.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = getRecordRowHTML(r);
            tbody.appendChild(tr);
        });

        // Итоговая строка недели (ровно 23 ячейки: 3 объединенные + 19 числовых + 1 пустая)
        const summaryRow = document.createElement('tr');
        summaryRow.className = 'week-summary-row';
        summaryRow.innerHTML = `
            <td colspan="3"><strong><ion-icon name="bar-chart-outline" class="week-summary-icon"></ion-icon> ИТОГО:</strong></td>
            <td><strong>${summary.hours.toFixed(1)}</strong></td>
            <td><strong>${summary.ordersPickup}</strong></td>
            <td><strong>${formatMoney(summary.payPickup)}</strong></td>
            <td><strong>${summary.ordersDelivery}</strong></td>
            <td><strong>${formatMoney(summary.payDelivery)}</strong></td>
            <td><strong>${summary.distance.toFixed(1)}</strong></td>
            <td><strong>${formatMoney(summary.payDistance)}</strong></td>
            <td><strong>${summary.weight.toFixed(1)}</strong></td>
            <td><strong>${formatMoney(summary.payWeight)}</strong></td>
            <td><strong>${formatMoney(summary.loadPay)}</strong></td>
            <td><strong>${formatMoney(summary.bonusPay)}</strong></td>
            <td><strong>${formatMoney(summary.rating)}</strong></td>
            <td><strong>${formatMoney(summary.tips)}</strong></td>
            <td><strong>${formatMoney(summary.fuelCost)}</strong></td>
            <td><strong>${formatMoney(summary.repairCost)}</strong></td>
            <td><strong>${formatMoney(summary.tax)}</strong></td>
            <td><strong>${formatMoney(summary.totalIncome)}</strong></td>
            <td><strong>${formatMoney(summary.totalExpenses)}</strong></td>
            <td style="color:${summary.netProfit >= 0 ? '#10b981' : '#ef4444'};font-weight:bold"><strong>${formatMoney(summary.netProfit)}</strong></td>
            <td></td>
        `;
        tbody.appendChild(summaryRow);
    });
}




// ===== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК =====
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    // ИСПРАВЛЕНО: используем .nav-item вместо .nav-btn
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    
    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) targetTab.classList.add('active');
    
    // ИСПРАВЛЕНО: используем .nav-item
    const activeBtn = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
    if (activeBtn) activeBtn.classList.add('active');
    
    if (tabName === 'analytics') {
        updateAnalytics();
        initComparisonSelectors();
        updateComparison();
    }
    if (tabName === 'history') renderTable();
    if (tabName === 'tariffs') renderTariffs();
    
    // Сохраняем состояние ТОЛЬКО если это не восстановление
    if (!isRestoringState) {
        saveState();
    }
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
// ===== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Инициализация приложения...');
    
    // 1. СНАЧАЛА загружаем локальный кэш (быстрый старт)
    // Данные из Firebase загрузятся позже через loadUserData() после авторизации
    await loadData();
    
    // 2. Исправляем все некорректные recordType в локальном кэше
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
    
    // 3. Инициализируем базовые обработчики форм
    document.getElementById('date').addEventListener('change', onDateChange);
    document.getElementById('daily-form').addEventListener('submit', saveRecord);
    document.getElementById('tariff-form').addEventListener('submit', saveTariff);
    document.getElementById('date').valueAsDate = new Date();
    onDateChange();
    
    // 4. ВАЖНО: Скрываем основной интерфейс до авторизации
    // onAuthStateChanged() сам покажет его после входа
    const mainContainer = document.querySelector('.container');
    const bottomNav = document.querySelector('.bottom-nav');
    const authScreen = document.getElementById('auth-screen');
    
    if (mainContainer) mainContainer.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    if (authScreen) authScreen.classList.remove('hidden');
    
    // 5. Инициализируем валидацию форм
    addFormValidation();
    
    // 6. НЕ рендерим таблицу и тарифы здесь!
    // Они будут отрендерены в loadUserData() после успешной авторизации.
    // Если рендерить сейчас — покажутся пустые/старые данные до входа.
    
    console.log('✅ Базовая инициализация завершена. Ожидание авторизации...');
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
// ===== ЗАГРУЗКА ДАННЫХ (ТОЛЬКО LOCALSTORAGE) =====
// Данные из Firebase загружаются отдельно через loadUserData() после авторизации
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
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
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
    // Для km и weight проверяем, включен ли авто-расчет
    if (type === 'km' && autoCalcState && autoCalcState.km === false) {
        return;
    }
    if (type === 'weight' && autoCalcState && autoCalcState.weight === false) {
        return;
    }
    
    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) return;
    let qtyField, priceField, rate;
    switch(type) {
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
                <ion-icon name="calendar-outline" style="font-size: 24px; vertical-align: middle; margin-right: 6px; color: var(--ios-accent);"></ion-icon>
                ${formatDate(t.date)}
                ${isCurrent ? '<span style="color:#10b981;font-weight:bold"> (действует)</span>' : ''}
            </div>
            <div class="tariff-values">
                <span>
                    <ion-icon name="arrow-down-circle-outline" class="tariff-icon pickup-icon"></ion-icon>
                    ${t.pickup} ₽/шт
                </span>
                <span>
                    <ion-icon name="arrow-up-circle-outline" class="tariff-icon delivery-icon"></ion-icon>
                    ${t.delivery} ₽/шт
                </span>
                <span>
                    <ion-icon name="navigate-outline" class="tariff-icon km-icon"></ion-icon>
                    ${t.km} ₽/км
                </span>
                <span>
                    <ion-icon name="scale-outline" class="tariff-icon weight-icon"></ion-icon>
                    ${t.weight} ₽/кг
                </span>
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
    
    // Сохраняем состояние
    saveState();
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
                <tr>                    <td class="metric-name"><ion-icon name="trending-up-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Доход в день</td>
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
                    <td>${formatMoney(avgPerHour1)}</td>                    <td>${formatMoney(avgPerHour2)}</td>
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
    
    // Сохраняем состояние
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

function getRecordRowHTML(r) {
    const typeLabel = r.recordType === 'bonus'
        ? '<ion-icon name="gift-outline" style="vertical-align: middle; margin-right: 4px; color: #AF52DE;"></ion-icon>Бонус'
        : r.recordType === 'expense'
        ? '<ion-icon name="remove-circle-outline" style="vertical-align: middle; margin-right: 4px; color: #FF3B30;"></ion-icon>Расход'
        : '<ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px; color: #007AFF;"></ion-icon>Работа';

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
        <td>${r.fuelCost ? formatMoney(r.fuelCost) : '-'}</td>
        <td>${r.repairCost ? formatMoney(r.repairCost) : '-'}</td>
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

function renderTable() {
    const tbody = document.getElementById('records-body');
    
    // ✅ ПРОВЕРКА: существует ли tbody
    if (!tbody) {
        console.error('❌ Элемент <tbody id="records-body"> не найден в HTML');
        return;
    }
    
    tbody.innerHTML = '';
    
    // Применяем фильтры
    let filteredRecords = [...records];
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
        filteredRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
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

    // ✅ БЕЗОПАСНОЕ ДОБАВЛЕНИЕ ИНФОРМАЦИОННОГО БЛОКА
    // Ищем контейнер таблицы
    let tableContainer = tbody.closest('.table-container');
    if (!tableContainer) {
        tableContainer = tbody.closest('table');
    }
    if (!tableContainer) {
        tableContainer = tbody.parentElement;
    }
    
    if (tableContainer) {
        let infoEl = document.getElementById('filter-info');
        if (!infoEl) {
            infoEl = document.createElement('div');
            infoEl.id = 'filter-info';
            infoEl.style.cssText = 'padding:15px;background:#dbeafe;border-radius:8px;margin:10px 0;text-align:center;color:#1e40af;font-weight:600;';
            // Вставляем после таблицы
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
            infoEl.textContent = `Показано ${count} из ${total} записей`;
        } else {
            infoEl.style.display = 'none';
        }
    }
}


// ===== ПОЛУЧЕНИЕ ISO НЕДЕЛИ ИЗ ДАТЫ =====
function getISOWeek(dateStr) {
    const date = new Date(dateStr);
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

// ===== ПОЛУЧЕНИЕ ДИАПАЗОНА ДАТ НЕДЕЛИ =====
function getWeekDateRange(weekKey) {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);
    
    // Находим первый день года
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = (jan4.getDay() + 6) % 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - dayOfWeek);
    
    // Находим понедельник нужной недели
    const weekMonday = new Date(firstMonday);
    weekMonday.setDate(firstMonday.getDate() + (week - 1) * 7);
        const weekSunday = new Date(weekMonday);
    weekSunday.setDate(weekMonday.getDate() + 6);
    
    return {
        start: weekMonday,
        end: weekSunday,
        label: `${weekMonday.getDate()}.${String(weekMonday.getMonth()+1).padStart(2,'0')} - ${weekSunday.getDate()}.${String(weekSunday.getMonth()+1).padStart(2,'0')}.${weekSunday.getFullYear()}`
    };
}

// ===== РЕНДЕР ТАБЛИЦЫ С ПОНЕДЕЛЬНЫМИ ИТОГАМИ =====
// ===== РЕНДЕР ТАБЛИЦЫ С ПОНЕДЕЛЬНЫМИ ИТОГАМИ =====
function renderTableWithWeeklySummary(tbody, records) {
    // Определяем реальное количество колонок из thead
    const headerCells = document.querySelectorAll('thead tr:first-child th');
    const totalColumns = headerCells.length; // Динамически получаем число колонок!
    
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

        // ✅ Заголовок недели — colspan = ВСЕМ колонкам
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

        // Записи недели
        weekRecords.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = getRecordRowHTML(r);
            tbody.appendChild(tr);
        });

        // ✅ Итоговая строка — ровно totalColumns ячеек
        const summaryRow = document.createElement('tr');
        summaryRow.className = 'week-summary-row';
        
        // Собираем все значения в массив в правильном порядке
        const values = [
            summary.hours.toFixed(1),           // Часы
            summary.ordersPickup,               // Забор (шт)
            formatMoney(summary.payPickup),     // Забор (₽)
            summary.ordersDelivery,             // Выдача (шт)
            formatMoney(summary.payDelivery),   // Выдача (₽)
            summary.distance.toFixed(1),        // Км
            formatMoney(summary.payDistance),   // Км (₽)
            summary.weight.toFixed(1),          // Вес (кг)
            formatMoney(summary.payWeight),     // Вес (₽)
            formatMoney(summary.loadPay),       // Нагрузка (₽)
            formatMoney(summary.bonusPay),      // Бонус (₽)
            formatMoney(summary.rating),        // Рейтинг (₽)
            formatMoney(summary.tips),          // Чаевые (₽)
            formatMoney(summary.fuelCost),      // Бензин (₽)
            formatMoney(summary.repairCost),    // Ремонт (₽)
            formatMoney(summary.tax),           // Налог (₽)
            formatMoney(summary.totalIncome),   // Доход (₽)
            formatMoney(summary.totalExpenses), // Расход (₽)
            `<span style="color:${summary.netProfit >= 0 ? '#10b981' : '#ef4444'}">${formatMoney(summary.netProfit)}</span>` // Прибыль
        ];
        
        // Формируем HTML: 3 объединённые ячейки (Дата, День, Тип) + все значения + пустая для действий
        let summaryHTML = `<td colspan="3"><strong><ion-icon name="bar-chart-outline" class="week-summary-icon"></ion-icon> ИТОГО:</strong></td>`;
        values.forEach(v => {
            summaryHTML += `<td><strong>${v}</strong></td>`;
        });
        summaryHTML += `<td></td>`; // Пустая ячейка для колонки "Действия"
        
        summaryRow.innerHTML = summaryHTML;
        tbody.appendChild(summaryRow);
    });
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
    if (!currentUser) return;
    
    try {
        console.log('🔄 Синхронизация с Firebase...');
        
        const userRef = db.collection('users').doc(currentUser.uid);
        
        // Удаляем все старые записи
        const oldRecords = await userRef.collection('records').get();
        const deletePromises1 = oldRecords.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises1);
        
        // Удаляем все старые тарифы
        const oldTariffs = await userRef.collection('tariffs').get();
        const deletePromises2 = oldTariffs.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises2);
        
        // Загружаем новые записи
        for (const r of records) {
            const recordToSave = { ...r };
            delete recordToSave.id;
            const docRef = await userRef.collection('records').add(recordToSave);
            r.id = docRef.id;
        }
        
        // Загружаем новые тарифы
        for (const t of tariffs) {
            const tariffToSave = { ...t };
            delete tariffToSave.id;
            const docRef = await userRef.collection('tariffs').add(tariffToSave);
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

// Переключение режима авто-расчета
function toggleAutoCalc(field) {
    autoCalcState[field] = !autoCalcState[field];
    
    const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
    const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
    const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
    
    if (autoCalcState[field]) {
        // Включаем авто-расчет
        if (btn) btn.classList.remove('manual-mode');
        if (input) input.classList.remove('manual-edit');
        if (hint) hint.textContent = 'автоматически';
        
        // Пересчитываем автоматически
        autoCalc(field);
    } else {
        // Отключаем авто-расчет
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';
    }
}

// Помечаем поле как отредактированное вручную
function markManualEdit(field) {
    if (autoCalcState[field]) {
        autoCalcState[field] = false;
        
        const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
        const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
        const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
        
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';
    }
}

// ===== ЭКСПОРТ В EXCEL (отдельная функция) =====
function exportToExcel() {
    console.log(' Начало экспорта в Excel...');
    
    if (!records || records.length === 0) {
        alert('❌ Нет данных для экспорта. Сначала добавьте записи.');
        return;
    }
    
    try {
        // Проверяем библиотеку
        if (typeof XLSX === 'undefined') {
            alert('❌ Библиотека Excel не загружена. Обновите страницу.');
            return;
        }
        
        // Формируем данные
        const data = records.map((r, index) => {
            const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
                r.recordType === 'expense' ? 'Расход' : 'Работа';
            return {
                '№': index + 1,
                'Дата': formatDate(r.date),
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
        
        // Создаем worksheet
        const ws = XLSX.utils.json_to_sheet(data);
        
        // Настраиваем ширину колонок
        const colWidths = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length, 12) }));
        ws['!cols'] = colWidths;
        
        // Создаем workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Журнал водителя");
        
        // Сохраняем файл
        const fileName = `driver-data-${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        console.log('✅ Excel файл создан:', fileName);
        alert('✅ Excel файл успешно создан!\n\nФайл сохранен в папку "Загрузки"');
        
    } catch (error) {
        console.error('❌ Ошибка экспорта в Excel:', error);
        alert('❌ Ошибка при создании Excel файла:\n\n' + error.message);
    }
}

// ===== ЭКСПОРТ В PDF (через печать браузера) =====
function exportToPDF() {
    if (!records || records.length === 0) {
        alert('❌ Нет данных для экспорта');
        return;
    }
    
    // Считаем итоги
    const totalIncome = records.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
    const totalExpenses = records.reduce((sum, r) => sum + (r.totalExpenses || 0), 0);
    const totalProfit = records.reduce((sum, r) => sum + (r.netProfit || 0), 0);
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);
    
    // Создаем HTML контент со ВСЕМИ столбцами
    let rowsHTML = '';
    records.forEach(r => {
        const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
            r.recordType === 'expense' ? 'Расход' : 'Работа';
        const profitColor = r.netProfit >= 0 ? '#10b981' : '#ef4444';
        
        rowsHTML += `
            <tr>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${formatDate(r.date)}</td>
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
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Журнал работы водителя</title>
            <style>
                @page { size: A4 landscape; margin: 8mm; }
                body { 
                    font-family: Arial, sans-serif; 
                    font-size: 10px; 
                    margin: 10px;
                    color: #000;
                }
                h1 { 
                    text-align: center; 
                    margin-bottom: 8px; 
                    font-size: 18px;
                }
                .date-info {
                    text-align: center;
                    color: #666;
                    margin-bottom: 12px;
                    font-size: 11px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse;
                    font-size: 9px;
                }
                th, td { 
                    border: 1px solid #ddd; 
                    padding: 5px; 
                    font-size: 9px;
                }
                th { 
                    background-color: #f2f2f7; 
                    text-align: center;
                    font-weight: bold;
                    font-size: 9px;
                }
                td {
                    text-align: right;
                }
                td:first-child, td:nth-child(2), td:nth-child(3) {
                    text-align: left;
                }
                /* Итоговая строка - НЕ в tfoot, чтобы не повторялась */
                .total-row {
                    background-color: #f2f2f7;
                    font-weight: bold;
                    border-top: 2px solid #ddd;
                }
                .total-row td {
                    padding: 8px 5px;
                }
                /* Отделяем таблицу итогов от основной */
                .summary-table {
                    margin-top: 15px;
                    width: 100%;
                    border-collapse: collapse;
                }
                .summary-table td {
                    padding: 10px;
                    border: 1px solid #ddd;
                    text-align: center;
                    font-size: 11px;
                }
                .summary-table .label {
                    background-color: #f2f2f7;
                    font-weight: bold;
                    text-align: left;
                    width: 30%;
                }
                .summary-table .value {
                    font-weight: bold;
                }
                @media print {
                    body { margin: 0; }
                    .no-print { display: none; }
                    /* Запрещаем повторение footer на каждой странице */
                    tfoot {
                        display: table-footer-group;
                    }
                }
            </style>
        </head>
        <body>
            <h1>Журнал работы водителя</h1>
            <div class="date-info">Дата выгрузки: ${new Date().toLocaleDateString('ru-RU')}</div>
            
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
            
            <!-- ИТОГИ ОТДЕЛЬНОЙ ТАБЛИЦЕЙ ПОСЛЕ ОСНОВНОЙ -->
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
    
    // Открываем в новом окне
    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    alert('💡 Откроется окно для сохранения PDF\n\nВыберите "Сохранить как PDF" в диалоге печати');
}