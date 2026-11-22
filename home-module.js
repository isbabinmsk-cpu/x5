// ============================================
// МОДУЛЬ ВКЛАДКИ "ГЛАВНАЯ" v2.2 (С ПЛАШКАМИ ИКОНОК)
// ============================================
(function() {
    'use strict';

    const GOALS_STORAGE_KEY = 'driverGoals';
    const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    // Переменная для хранения смещения месяца (0 = последний активный, -1 = предыдущий и т.д.)
    let dashMonthOffset = 0;

    function $(id) { return document.getElementById(id); }
    
    function formatMoney(n) {
        if (typeof window.formatMoney === 'function') return window.formatMoney(n);
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(n || 0);
    }

    // Максимально надежный парсинг дат "YYYY-MM-DD" или "DD.MM.YYYY"
    function getYMD(dateStr) {
        if (!dateStr) return null;
        const s = String(dateStr).trim();
        const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
        }
        const parts = s.split('.');
        if (parts.length === 3) {
            return { year: parseInt(parts[2], 10), month: parseInt(parts[1], 10), day: parseInt(parts[0], 10) };
        }
        const d = new Date(s);
        if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
        return null;
    }

    // ============================================
    // 1. ОПРЕДЕЛЕНИЕ АКТИВНОГО ПЕРИОДА
    // ============================================
    function getActivePeriod(records) {
        if (!records || records.length === 0) {
            return { year: 0, month: 0 };
        }
        let maxDate = null;
        records.forEach(r => {
            const ymd = getYMD(r.date);
            if (!ymd) return;
            const t = new Date(ymd.year, ymd.month - 1, ymd.day).getTime();
            if (!maxDate || t > maxDate) maxDate = t;
        });
        if (!maxDate) return { year: 0, month: 0 };
        const d = new Date(maxDate);
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }

    // ============================================
    // 2. ЦЕЛИ
    // ============================================
    async function getGoals() {
        let cachedGoals = null;
        try {
            const saved = localStorage.getItem(GOALS_STORAGE_KEY);
            if (saved) cachedGoals = JSON.parse(saved);
        } catch (e) {}
        
        if (window.currentUser && typeof window.db !== 'undefined') {
            try {
                const doc = await window.db.collection('users').doc(window.currentUser.uid).get();
                const fbGoals = doc.exists ? doc.data().goals : null;
                if (fbGoals && typeof fbGoals.income === 'number') {
                    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(fbGoals));
                    return fbGoals;
                }
                const defaults = cachedGoals || { income: 100000, orders: 500, hours: 200 };
                await window.db.collection('users').doc(window.currentUser.uid).set({ goals: defaults }, { merge: true });
                return defaults;
            } catch (e) {
                if (cachedGoals) return cachedGoals;
            }
        }
        return cachedGoals || { income: 100000, orders: 500, hours: 200 };
    }

    async function saveGoalsToFirebase(goals) {
        if (!window.currentUser || typeof window.db === 'undefined') return false;
        try {
            await window.db.collection('users').doc(window.currentUser.uid).set({ goals }, { merge: true });
            return true;
        } catch (e) { return false; }
    }

    async function updateGoals() {
        const el = (id) => $(id);
        const goals = await getGoals();
        const records = window.records || [];
        
        // Цели всегда считаем за последний активный месяц
        const period = getActivePeriod(records);

        let mIncome = 0, mOrders = 0, mHours = 0;
        records.forEach(r => {
            const ymd = getYMD(r.date);
            if (ymd && ymd.year === period.year && ymd.month === period.month) {
                mIncome += Number(r.totalIncome) || 0;
                mOrders += Number(r.ordersDelivery) || 0;
                mHours += Number(r.hours) || 0;
            }
        });

        if (el('goal-income-current')) el('goal-income-current').textContent = Math.round(mIncome);
        if (el('goal-income-target')) el('goal-income-target').textContent = goals.income;
        if (el('goal-orders-current')) el('goal-orders-current').textContent = mOrders;
        if (el('goal-orders-target')) el('goal-orders-target').textContent = goals.orders;
        if (el('goal-hours-current')) el('goal-hours-current').textContent = mHours.toFixed(1);
        if (el('goal-hours-target')) el('goal-hours-target').textContent = goals.hours;

        if (el('goal-income-bar')) el('goal-income-bar').style.width = (goals.income > 0 ? Math.min((mIncome / goals.income) * 100, 100) : 0) + '%';
        if (el('goal-orders-bar')) el('goal-orders-bar').style.width = (goals.orders > 0 ? Math.min((mOrders / goals.orders) * 100, 100) : 0) + '%';
        if (el('goal-hours-bar')) el('goal-hours-bar').style.width = (goals.hours > 0 ? Math.min((mHours / goals.hours) * 100, 100) : 0) + '%';
    }
    
    async function showGoalSettings() {
        if (!window.currentUser) return;
        const goals = await getGoals();
        
        const overlay = document.createElement('div');
        overlay.className = 'goals-modal-overlay';
        overlay.innerHTML = `
            <div class="goals-modal">
                <div class="goals-modal-header">
                    <span class="home-icon-badge home-icon-sm home-icon-blue"><ion-icon name="flag-outline"></ion-icon></span>
                    <h3>Мои цели</h3>
                </div>
                <div class="goals-modal-body">
                    <div class="goal-input-group"><label>Доход</label><input type="number" id="gi" value="${goals.income}"></div>
                    <div class="goal-input-group"><label>Заказы</label><input type="number" id="go" value="${goals.orders}"></div>
                    <div class="goal-input-group"><label>Часы</label><input type="number" id="gh" value="${goals.hours}"></div>
                </div>
                <div class="goals-modal-footer">
                    <button class="btn btn-secondary" id="g-cancel">Отмена</button>
                    <button class="btn btn-primary" id="g-save">Сохранить</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const close = () => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 300); };
        overlay.querySelector('#g-cancel').onclick = close;
        overlay.querySelector('#g-save').onclick = async () => {
            const income = parseFloat($('gi').value) || 0;
            const orders = parseInt($('go').value) || 0;
            const hours = parseFloat($('gh').value) || 0;
            const newGoals = { income, orders, hours };
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(newGoals));
            await saveGoalsToFirebase(newGoals);
            await updateGoals();
            close();
        };
    }

    // ============================================
    // 3. ДОСТИЖЕНИЯ И ЗАПИСИ
    // ============================================
    function renderAchievements() {
        const container = $('profile-achievements');
        if (!container) return;
        const records = window.records || [];
        if (records.length === 0) {
            container.innerHTML = `<div style="padding:20px;color:var(--ios-text-tertiary)">Нет данных</div>`;
            return;
        }
        const inc = records.reduce((s, r) => s + (Number(r.totalIncome) || 0), 0);
        const ord = records.reduce((s, r) => s + (Number(r.ordersDelivery) || 0), 0);
        const days = new Set(records.map(r => r.date)).size;

        const list = [];
        if (inc >= 100000) list.push({ icon: '🏆', label: '100k+ доход', class: 'gold' });
        if (ord >= 500) list.push({ icon: '📦', label: '500+ заказов', class: 'gold' });
        if (days >= 50) list.push({ icon: '📅', label: '50+ дней', class: 'silver' });
        
        container.innerHTML = list.map(a => `<div class="achievement-badge ${a.class}"><span>${a.icon}</span> ${a.label}</div>`).join('');
    }

    function updateRecentRecords() {
        const container = $('recent-records-list');
        if (!container) return;
        const records = window.records || [];
        const sorted = [...records].sort((a, b) => {
            const ya = getYMD(a.date), yb = getYMD(b.date);
            if (!ya || !yb) return 0;
            return new Date(yb.year, yb.month - 1, yb.day) - new Date(ya.year, ya.month - 1, ya.day);
        });
        const recent = sorted.slice(0, 5);

        container.innerHTML = recent.map((r, i) => {
            const ymd = getYMD(r.date);
            const dateStr = ymd ? `${String(ymd.day).padStart(2, '0')}.${String(ymd.month).padStart(2, '0')}.${ymd.year}` : r.date;
            const profit = (Number(r.totalIncome) || 0) - (Number(r.totalExpenses) || 0);
            return `<div style="display: flex; justify-content: space-between; padding: 12px 0; ${i < recent.length - 1 ? 'border-bottom: 1px solid var(--ios-border);' : ''}">
                <div>
                    <div style="font-weight: 600;">${dateStr}</div>
                    <div style="font-size: 13px; color: var(--ios-text-tertiary);">${r.ordersDelivery || 0} зак · ${r.hours || 0} ч</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 700; color: ${profit >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)'};">${formatMoney(profit)}</div>
                </div>
            </div>`;
        }).join('');
    }

    // ============================================
    // 4. ОБЁРТКА ИКОНОК В ПЛАШКИ (БЕЗ КНОПОК МЕСЯЦЕВ И ЦЕЛЕЙ)
    // ============================================
    function wrapHomeIcons() {
        // 1. Иконки в карточках метрик (В день, Заказы, Часы, Ср. чек)
        const metricIcons = document.querySelectorAll('.dash-metric-header ion-icon');
        const metricColors = ['home-icon-green', 'home-icon-blue', 'home-icon-orange', 'home-icon-purple'];
        
        metricIcons.forEach((icon, index) => {
            if (icon.parentElement.classList.contains('home-icon-badge')) return; // Уже обёрнута
            const badge = document.createElement('span');
            badge.className = `home-icon-badge home-icon-sm ${metricColors[index % metricColors.length]}`;
            icon.parentNode.insertBefore(badge, icon);
            badge.appendChild(icon);
        });

        // 2. Иконки в заголовках секций (Мои цели, Достижения, Последние записи)
        const sectionIcons = document.querySelectorAll('.dash-section-header h2 ion-icon');
        const sectionColors = ['home-icon-orange', 'home-icon-purple', 'home-icon-blue'];
        
        sectionIcons.forEach((icon, index) => {
            if (icon.parentElement.classList.contains('home-icon-badge')) return;
            const badge = document.createElement('span');
            badge.className = `home-icon-badge home-icon-lg ${sectionColors[index % sectionColors.length]}`;
            icon.parentNode.insertBefore(badge, icon);
            badge.appendChild(icon);
        });

        // ⚠️ Кнопки .dash-nav-btn и .dash-icon-btn намеренно НЕ обрабатываются здесь!
    }

    // ============================================
    // 5. ГЛАВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ
    // ============================================
    function updateHomeTab() {
        const records = window.records || [];
        console.log('🔄 Обновление Главной. Всего записей:', records.length);
        
        // 1. Находим самый свежий месяц с записями
        const activePeriod = getActivePeriod(records);
        
        // 2. Применяем смещение (если пользователь нажал "назад")
        let targetMonth = activePeriod.month;
        let targetYear = activePeriod.year;
        
        if (dashMonthOffset !== 0) {
            const d = new Date(activePeriod.year, activePeriod.month - 1, 1);
            d.setMonth(d.getMonth() + dashMonthOffset);
            targetMonth = d.getMonth() + 1;
            targetYear = d.getFullYear();
        }

        // 3. Отбираем записи за нужный месяц
        const monthRecords = records.filter(r => {
            const ymd = getYMD(r.date);
            return ymd && ymd.year === targetYear && ymd.month === targetMonth;
        });
        
        // 4. Считаем
    let income = 0, expenses = 0, orders = 0, hours = 0;
    const daysSet = new Set();
    
    monthRecords.forEach(r => {
        // Финансы и метрики считаем по всем записям месяца (чтобы не ломать общую статистику)
        income += Number(r.totalIncome) || 0;
        expenses += Number(r.totalExpenses) || 0;
        orders += Number(r.ordersDelivery) || 0;
        hours += Number(r.hours) || 0;

        // ⭐ КОЛИЧЕСТВО СМЕН считаем ТОЛЬКО для записей типа "Работа"
        // (Если в вашей базе поле называется иначе, например recordType или category, 
        // замените 'r.type' на нужное название поля)
        if (r.type === 'work' || r.recordType === 'work') {
            daysSet.add(r.date);
        }
    });

    const profit = income - expenses;
    const days = daysSet.size; // Теперь здесь будет только количество дней с типом "Работа"
    const avgDay = days > 0 ? profit / days : 0;
    const avgCheck = orders > 0 ? income / orders : 0;

        // 5. Обновляем заголовок (Название месяца)
        const titleEl = $('dash-hero-month-name');
        if (titleEl) {
            titleEl.textContent = `${MONTH_NAMES[targetMonth - 1]} ${targetYear}`.toUpperCase();
        }

        // 6. Выводим цифры
        const setVal = (id, val) => { const el = $(id); if (el) el.textContent = val; };
        
        setVal('profile-total-profit', formatMoney(profit));
        setVal('hero-month-income', formatMoney(income));
        setVal('hero-month-expense', formatMoney(expenses));
        setVal('profile-total-days', days);
        
        setVal('profile-avg-per-day', formatMoney(avgDay));
        setVal('profile-total-orders', orders);
        setVal('profile-total-hours', hours.toFixed(1));
        setVal('profile-avg-check', formatMoney(avgCheck));

        // 7. Обновляем остальные блоки
        renderAchievements();
        updateGoals();
        updateRecentRecords();
        
        // 8. Применяем обёртку иконок (безопасно, так как проверяет classList)
        wrapHomeIcons();
        
        if (typeof window.updateTrends === 'function') window.updateTrends();
    }

    // ============================================
    // 6. ОБРАБОТЧИКИ КНОПОК ПЕРЕКЛЮЧЕНИЯ МЕСЯЦЕВ
    // ============================================
    document.addEventListener('click', (e) => {
        const prevBtn = e.target.closest('#dash-prev-month');
        const nextBtn = e.target.closest('#dash-next-month');

        if (prevBtn) {
            dashMonthOffset--;
            updateHomeTab();
        }
        if (nextBtn) {
            // Ограничиваем, чтобы нельзя было уйти в будущее дальше активного месяца
            if (dashMonthOffset < 0) {
                dashMonthOffset++;
                updateHomeTab();
            }
        }
    });

    // ============================================
    // 7. ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function init() {
        wrapHomeIcons(); // Запускаем сразу при загрузке
        
        // Наблюдатель на случай, если вкладка перерисуется динамически
        const homeTab = document.querySelector('#tab-home');
        if (homeTab) {
            const observer = new MutationObserver(() => {
                wrapHomeIcons();
            });
            observer.observe(homeTab, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Экспорт в глобальную область
    window.updateHomeTab = updateHomeTab;
    window.updateGoals = updateGoals;
    window.showGoalSettings = showGoalSettings;

    console.log('✅ Модуль "Главная" v1.0.7 (с плашками иконок, без трогания кнопок) загружен');
})();