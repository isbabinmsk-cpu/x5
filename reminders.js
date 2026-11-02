// ============================================
// МОДУЛЬ НАПОМИНАНИЙ И УВЕДОМЛЕНИЙ (reminders.js)
// ИСПРАВЛЕННАЯ ВЕРСИЯ: Устранен цикл синхронизации
// ============================================
(function () {
    'use strict';

    const DEFAULT_SETTINGS = {
        enabled: true,
        systemNotifications: false,
        to: {
            enabled: true,
            warnBeforeKm: 500,
            services: {
                oil:     { enabled: true, intervalKm: 10000, months: 12 },
                trans:   { enabled: true, intervalKm: 60000, months: 48 },
                air:     { enabled: true, intervalKm: 15000, months: 12 },
                cabin:   { enabled: true, intervalKm: 15000, months: 12 },
                plugs:   { enabled: true, intervalKm: 30000, months: 24 },
                brakefl: { enabled: true, intervalKm: 40000, months: 24 },
                coolant: { enabled: true, intervalKm: 60000, months: 36 },
                belt:    { enabled: true, intervalKm: 80000, months: 60 },
                battery: { enabled: true, intervalKm: 60000, months: 48 }
            }
        },
        shift: { enabled: true, remindAtHour: 20, anchor: '', workDays: 3, offDays: 3 },
        fuel:  { enabled: true, risePercent: 15 },
        goals: { enabled: true }
    };

    let settings = { ...DEFAULT_SETTINGS };
    let dismissed = {};
    let notified = {};
    let activeReminders = [];
    let isDataLoaded = false;
    let isMigrated = false;
    let remindersUnsubscribe = null;
    let saveTimeout = null;
    let lastSaveTime = 0;
    let isRemoteUpdate = false; // Флаг: данные пришли из Firebase
    const SAVE_DEBOUNCE_MS = 2000;
    const MIN_SAVE_INTERVAL_MS = 60000; // УВЕЛИЧЕНО: 60 сек вместо 30

    // ---------- УТИЛИТЫ ----------
    function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
    
    function localISO(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    
    function parseISO(s) {
        if (!s) return null;
        const p = String(s).split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    
    function fmtDate(s) { return (typeof formatDate === 'function') ? formatDate(s) : s; }

    function getAllVehicles() {
        try {
            const s = localStorage.getItem('driverVehicles');
            const vehicles = s ? JSON.parse(s) : [];
            return vehicles.length > 0 ? vehicles : [{ id: 'default', name: 'Основной автомобиль', plate: '' }];
        } catch (e) {
            return [{ id: 'default', name: 'Основной автомобиль', plate: '' }];
        }
    }
    
    function isAuthenticated() { return document.body.classList.contains('authenticated'); }

    function getRecords() {
        if (typeof records !== 'undefined' && Array.isArray(records)) return records;
        try { const s = localStorage.getItem('driverRecords'); return s ? JSON.parse(s) : []; } catch (e) { return []; }
    }
    
    function getAllFuelLogs() {
        try { 
            const s = localStorage.getItem('driverFuelLogs'); 
            return s ? JSON.parse(s) : (Array.isArray(window.fuelLogs) ? window.fuelLogs : []);
        } catch (e) { return []; }
    }
    
    function getAllRepairs() {
        try { 
            const s = localStorage.getItem('repair_records'); 
            return s ? JSON.parse(s) : (Array.isArray(window.repairRecords) ? window.repairRecords : []);
        } catch (e) { return []; }
    }

    function loadFromLocal() {
        settings = JSON.parse(localStorage.getItem('driverRemindersSettings') || 'null') || { ...DEFAULT_SETTINGS };
        dismissed = JSON.parse(localStorage.getItem('driverRemindersDismissed') || '{}') || {};
        notified = JSON.parse(localStorage.getItem('driverRemindersNotified') || '{}') || {};
    }

    // ---------- ХРАНИЛИЩЕ: ИСПРАВЛЕННЫЙ ЦИКЛ ----------
    async function loadRemindersData() {
        loadFromLocal();
        isDataLoaded = true;
        // УБРАНО: refresh() при загрузке (он вызовется из onSnapshot)

        if (currentUser && typeof db !== 'undefined') {
            const docRef = db.collection('users').doc(currentUser.uid).collection('reminders').doc('config');

            if (!isMigrated) {
                try {
                    const doc = await docRef.get();
                    if (!doc.exists) {
                        await docRef.set({ settings, dismissed, notified });
                        console.log('✅ Данные мигрированы в Firebase');
                    }
                    isMigrated = true;
                } catch (e) {
                    console.warn('⚠️ Ошибка миграции:', e);
                    isMigrated = true;
                }
            }

            if (typeof remindersUnsubscribe === 'function') {
                remindersUnsubscribe();
            }

            remindersUnsubscribe = docRef.onSnapshot((doc) => {
                if (!currentUser) return;

                if (doc.exists) {
                    const data = doc.data();
                    
                    // Проверяем, действительно ли данные изменились
                    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(data.settings);
                    const dismissedChanged = JSON.stringify(dismissed) !== JSON.stringify(data.dismissed);
                    const notifiedChanged = JSON.stringify(notified) !== JSON.stringify(data.notified);

                    if (settingsChanged || dismissedChanged || notifiedChanged) {
                        isRemoteUpdate = true; // Помечаем как remote update
                        
                        settings = { 
                            ...DEFAULT_SETTINGS, 
                            ...data.settings,
                            to: { 
                                ...DEFAULT_SETTINGS.to, 
                                ...(data.settings?.to || {}), 
                                services: { ...DEFAULT_SETTINGS.to.services, ...(data.settings?.to?.services || {}) } 
                            }
                        };
                        dismissed = data.dismissed || {};
                        notified = data.notified || {};
                        
                        localStorage.setItem('driverRemindersSettings', JSON.stringify(settings));
                        localStorage.setItem('driverRemindersDismissed', JSON.stringify(dismissed));
                        localStorage.setItem('driverRemindersNotified', JSON.stringify(notified));
                        
                        console.log('📥 Данные обновлены из Firebase');
                    }
                }
                
                isDataLoaded = true;
                refresh(); 
            }, (error) => {
                console.warn('⚠️ Ошибка слушателя Firestore:', error);
                loadFromLocal();
                isDataLoaded = true;
                refresh();
            });
            
            console.log('✅ Real-time слушатель подключен');
        }
    }

    // Debounced save — ТЕПЕРЬ БЕЗ ЦИКЛА
    async function saveRemindersData() {
        // Если это remote update — НЕ сохраняем обратно (разрываем цикл!)
        if (isRemoteUpdate) {
            isRemoteUpdate = false;
            return;
        }

        const now = Date.now();
        
        if (now - lastSaveTime < MIN_SAVE_INTERVAL_MS) {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => saveRemindersData(), SAVE_DEBOUNCE_MS);
            return;
        }

        lastSaveTime = now;
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }

        localStorage.setItem('driverRemindersSettings', JSON.stringify(settings));
        localStorage.setItem('driverRemindersDismissed', JSON.stringify(dismissed));
        localStorage.setItem('driverRemindersNotified', JSON.stringify(notified));

        if (currentUser && typeof db !== 'undefined') {
            try {
                const docRef = db.collection('users').doc(currentUser.uid).collection('reminders').doc('config');
                await docRef.set({ settings, dismissed, notified }, { merge: true });
                console.log('💾 Настройки сохранены в Firebase');
            } catch (e) {
                console.error(' Ошибка сохранения:', e);
            }
        }
    }

    // ---------- ЛОГИКА НАПОМИНАНИЙ ----------
    function hasService(r, key) {
        return Array.isArray(r.serviceItems) && r.serviceItems.indexOf(key) !== -1;
    }
    function hasAnyService(r) {
        return Array.isArray(r.serviceItems) && r.serviceItems.length > 0;
    }
    function repairText(r) {
        const parts = (r.parts || []).map(p => p.name || '').join(' ');
        const works = (r.works || []).map(w => w.name || '').join(' ');
        return ((r.description || '') + ' ' + (r.comment || '') + ' ' + parts + ' ' + works).toLowerCase();
    }

    const SERVICE_REGISTRY = [
        { id: 'oil',     title: 'Замена масла и фильтра', intervalKm: 10000, months: 12,
          match: r => r.category === 'oil' || hasService(r, 'oil') || hasService(r, 'oilFilter') || (!hasAnyService(r) && /масло|\boil\b/.test(repairText(r))) },
        { id: 'air',     title: 'Воздушный фильтр',       intervalKm: 15000, months: 12,
          match: r => hasService(r, 'airFilter') || (!hasAnyService(r) && /воздушн/.test(repairText(r))) },
        { id: 'cabin',   title: 'Салонный фильтр',        intervalKm: 15000, months: 12,
          match: r => hasService(r, 'cabinFilter') || (!hasAnyService(r) && /салонн/.test(repairText(r))) },
        { id: 'plugs',   title: 'Свечи зажигания',        intervalKm: 30000, months: 24,
          match: r => hasService(r, 'sparkPlugs') || (!hasAnyService(r) && /свеч/.test(repairText(r))) },
        { id: 'brakefl', title: 'Тормозная жидкость',     intervalKm: 40000, months: 24,
          match: r => hasService(r, 'brakeFluid') || (!hasAnyService(r) && /тормозн.{0,20}жидк/.test(repairText(r))) },
        { id: 'coolant', title: 'Охлаждающая жидкость',   intervalKm: 60000, months: 36,
          match: r => r.category === 'cooling' || hasService(r, 'coolant') || (!hasAnyService(r) && /антифриз|охлажда|coolant/.test(repairText(r))) },
        { id: 'trans',   title: 'Масло в МКПП',           intervalKm: 60000, months: 48,
          match: r => r.category === 'transmission' || hasService(r, 'transmissionFluid') || (!hasAnyService(r) && /трансмисс|мкпп|кпп|коробк|механич/.test(repairText(r))) },
        { id: 'belt',    title: 'Ремень ГРМ',             intervalKm: 80000, months: 60,
          match: r => /грм|ремень|timing/.test(repairText(r)) },
        { id: 'battery', title: 'Аккумулятор',            intervalKm: 60000, months: 48,
          match: r => hasService(r, 'battery') || (!hasAnyService(r) && /аккумулятор/.test(repairText(r))) }
    ];

    function buildServiceReminders() {
        if (!settings.to.enabled) return [];
        const allRepairs = getAllRepairs();
        const allLogs = getAllFuelLogs();
        const vehicles = getAllVehicles();
        const now = new Date();
        const out = [];

        vehicles.forEach(vehicle => {
            const vId = vehicle.id || 'default';
            const vName = vehicle.name || 'Автомобиль';
            const vPlate = vehicle.plate || '';

            const vRepairs = allRepairs.filter(r => (r.vehicleId || 'default') === vId);
            let maxMileage = 0;
            
            vRepairs.forEach(r => {
                const m = num(r.mileage !== undefined ? r.mileage : r.odometer);
                if (m > maxMileage) maxMileage = m;
            });
            allLogs.filter(l => (l.vehicleId || 'default') === vId).forEach(l => {
                const m = num(l.mileage !== undefined ? l.mileage : l.odometer);
                if (m > maxMileage) maxMileage = m;
            });

            if (!maxMileage) return;

            SERVICE_REGISTRY.forEach(svc => {
                const svcSettings = settings.to.services?.[svc.id] || { enabled: true, intervalKm: svc.intervalKm, months: svc.months };
                if (!svcSettings.enabled) return;

                let lastMileage = 0, lastDate = '';
                vRepairs.forEach(r => {
                    if (!svc.match(r)) return;
                    const m = num(r.mileage);
                    if (m > lastMileage) lastMileage = m;
                    if (r.date && r.date > lastDate) lastDate = r.date;
                });

                const vPrefix = `${vName}${vPlate ? ' (' + vPlate + ')' : ''}: `;

                if (!lastMileage && !lastDate) {
                    if (svc.id === 'oil' && maxMileage >= svcSettings.intervalKm) {
                        out.push({
                            id: `svc:oil:none:${vId}`,
                            type: 'to', icon: 'construct-outline', priority: 2,
                            vehicleId: vId, vehicleName: vName, vehiclePlate: vPlate,
                            title: 'Техобслуживание',
                            text: vPrefix + 'Пробег ' + maxMileage.toLocaleString('ru-RU') + ' км — нет записи о замене масла.'
                        });
                    }
                    return;
                }

                const reasons = [];
                if (maxMileage && lastMileage) {
                    const left = (lastMileage + svcSettings.intervalKm) - maxMileage;
                    if (left <= 0) reasons.push('просрочено на ' + Math.abs(left).toLocaleString('ru-RU') + ' км');
                    else if (left <= settings.to.warnBeforeKm) reasons.push('осталось ~' + left.toLocaleString('ru-RU') + ' км');
                }
                if (lastDate && svcSettings.months) {
                    const d = parseISO(lastDate);
                    if (d) {
                        const monthsPassed = (now - d) / (1000 * 60 * 60 * 24 * 30.44);
                        if (monthsPassed >= svcSettings.months) reasons.push('по сроку: ' + Math.floor(monthsPassed) + ' мес.');
                    }
                }

                if (reasons.length) {
                    out.push({
                        id: `svc:${svc.id}:${vId}:${lastMileage}:${lastDate}`,
                        type: 'to', icon: 'construct-outline',
                        vehicleId: vId, vehicleName: vName, vehiclePlate: vPlate,
                        title: svc.title, priority: reasons[0].includes('просрочено') ? 1 : 2,
                        text: vPrefix + svc.title + ': ' + reasons.join(', ') +
                              (lastMileage ? ' (последняя на ' + lastMileage.toLocaleString('ru-RU') + ' км)' : '')
                    });
                }
            });
        });
        return out;
    }

    function isWorkDay(date) {
        const s = settings.shift;
        const anchor = parseISO(s.anchor);
        if (!anchor) return null;
        const cycle = num(s.workDays) + num(s.offDays);
        if (cycle <= 0) return null;
        const diff = Math.floor((date - anchor) / 86400000);
        const pos = ((diff % cycle) + cycle) % cycle;
        return pos < num(s.workDays);
    }

    function buildShiftReminder() {
        if (!settings.shift.enabled || !settings.shift.anchor) return null;
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        if (now.getHours() >= num(settings.shift.remindAtHour) && isWorkDay(tomorrow)) {
            return { 
                id: 'shift:' + localISO(tomorrow), 
                type: 'shift', 
                icon: 'calendar-outline', 
                priority: 3,
                vehicleId: null,
                title: 'Завтра рабочая смена',
                text: 'Завтра (' + fmtDate(localISO(tomorrow)) + ') рабочий день по графику ' + settings.shift.workDays + '/' + settings.shift.offDays + '.' 
            };
        }
        if (isWorkDay(now) && now.getHours() < 12) {
            return { 
                id: 'shift-today:' + localISO(now), 
                type: 'shift', 
                icon: 'calendar-outline', 
                priority: 3,
                vehicleId: null,
                title: 'Сегодня рабочая смена',
                text: 'По графику ' + settings.shift.workDays + '/' + settings.shift.offDays + ' сегодня рабочий день.' 
            };
        }
        return null;
    }

    function buildFuelReminder() {
        if (!settings.fuel.enabled) return [];
        const allLogs = getAllFuelLogs();
        const vehicles = getAllVehicles();
        const out = [];

        vehicles.forEach(vehicle => {
            const vId = vehicle.id || 'default';
            const vName = vehicle.name || 'Автомобиль';
            const vPlate = vehicle.plate || '';

            const logs = allLogs.filter(l => (l.vehicleId || 'default') === vId)
                .filter(l => num(l.liters) > 0 && num(l.mileage !== undefined ? l.mileage : l.odometer) > 0)
                .sort((a, b) => num(a.mileage !== undefined ? a.mileage : a.odometer) - num(b.mileage !== undefined ? b.mileage : b.odometer));

            if (logs.length < 6) return;

            const cons = [];
            for (let i = 1; i < logs.length; i++) {
                const dm = num(logs[i].mileage !== undefined ? logs[i].mileage : logs[i].odometer) -
                           num(logs[i - 1].mileage !== undefined ? logs[i - 1].mileage : logs[i - 1].odometer);
                if (dm > 0) cons.push(num(logs[i].liters) / dm * 100);
            }
            if (cons.length < 6) return;

            const last3 = cons.slice(-3).reduce((s, v) => s + v, 0) / 3;
            const prev3 = cons.slice(-6, -3).reduce((s, v) => s + v, 0) / 3;
            if (!prev3) return;

            const rise = (last3 - prev3) / prev3 * 100;
            if (rise >= num(settings.fuel.risePercent)) {
                const vPrefix = `${vName}${vPlate ? ' (' + vPlate + ')' : ''}: `;
                out.push({ 
                    id: `fuel:${vId}:${localISO(new Date()).slice(0, 7)}`, 
                    type: 'fuel', 
                    icon: 'fuel-outline', 
                    priority: 2,
                    vehicleId: vId, vehicleName: vName, vehiclePlate: vPlate,
                    title: 'Вырос расход топлива',
                    text: vPrefix + 'Средний расход вырос на ' + rise.toFixed(0) + '% (' + prev3.toFixed(1) + ' → ' + last3.toFixed(1) + ' л/100км).' 
                });
            }
        });
        return out;
    }

    function buildGoalReminder() {
        if (!settings.goals.enabled) return null;
        let goals = null;
        try { goals = JSON.parse(localStorage.getItem('driverGoals') || 'null'); } catch (e) {}
        if (!goals) return null;

        const now = new Date();
        const monthRecs = getRecords().filter(r => {
            const d = parseISO(r.date);
            return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        
        const income = monthRecs.reduce((s, r) => s + (r.totalIncome || 0), 0);
        const orders = monthRecs.reduce((s, r) => s + (r.ordersDelivery || 0), 0);
        const key = localISO(now).slice(0, 7);

        if (goals.income > 0 && income >= goals.income) {
            return { 
                id: 'goal-income:' + key, 
                type: 'goal', 
                icon: 'trophy-outline', 
                priority: 3,
                vehicleId: null,
                title: 'Цель по доходу достигнута! 🎉',
                text: 'Заработано ' + Math.round(income).toLocaleString('ru-RU') + ' ₽ при цели ' + goals.income.toLocaleString('ru-RU') + ' ₽.' 
            };
        }
        if (goals.orders > 0 && orders >= goals.orders) {
            return { 
                id: 'goal-orders:' + key, 
                type: 'goal', 
                icon: 'cube-outline', 
                priority: 3,
                vehicleId: null,
                title: 'Цель по заказам достигнута! 🎉',
                text: 'Выполнено ' + orders + ' заказов при цели ' + goals.orders + '.' 
            };
        }
        return null;
    }

    // ---------- СБОР НАПОМИНАНИЙ ----------
    function collectReminders() {
        if (!settings.enabled || !isAuthenticated() || !isDataLoaded) return [];
        const list = [];
        
        buildServiceReminders().forEach(r => list.push(r));
        
        const shift = buildShiftReminder();
        if (shift) list.push(shift);
        
        buildFuelReminder().forEach(r => list.push(r));
        
        const goal = buildGoalReminder();
        if (goal) list.push(goal);

        return list.filter(r => !dismissed[r.id]);
    }

    function refresh() {
        if (!isDataLoaded) return;
        activeReminders = collectReminders();
        updateBadge();
        if (document.getElementById('rem-panel')?.classList.contains('open')) renderPanel();
        
        const today = localISO(new Date());
        let hasChanges = false;
        
        activeReminders.forEach(r => {
            if (notified[r.id] !== today) {
                notified[r.id] = today; 
                hasChanges = true;
                showBanner(r);
                systemNotify(r);
            }
        });

        // Сохраняем ТОЛЬКО если это не remote update
        if (hasChanges && !isRemoteUpdate) {
            saveRemindersData();
        }
    }

    function systemNotify(r) {
        if (!settings.systemNotifications) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        
        let title = 'Журнал водителя: ' + r.title;
        if (r.vehicleId && r.vehicleId !== 'default' && r.vehicleName) {
            title = `Журнал (${r.vehicleName}${r.vehiclePlate ? ' ' + r.vehiclePlate : ''}): ${r.title}`;
        }
        
        try { new Notification(title, { body: r.text, tag: r.id }); } catch (e) {}
    }

    function dismissReminder(id) {
        dismissed[id] = Date.now();
        saveRemindersData();
        refresh();
    }

    // ---------- UI ----------
    function injectStyles() {
        if (document.getElementById('reminders-styles')) return;
        const style = document.createElement('style');
        style.id = 'reminders-styles';
        style.textContent = `
            .rem-bell { position: relative; width: 40px; height: 40px; border-radius: 50%; background: transparent; border: none; box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.16), 0 1px 0 rgba(255, 255, 255, 0.95); color: var(--ios-text-secondary, #3C3C43); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.15s, background-color 0.15s; -webkit-tap-highlight-color: transparent; }
            body.dark-theme .rem-bell { box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.85), 0 1px 0 rgba(255, 255, 255, 0.14); color: rgba(235, 235, 245, 0.70); }
            .rem-bell:active { transform: scale(0.92); background: rgba(0,0,0,0.05); }
            body.dark-theme .rem-bell:active { background: rgba(255,255,255,0.06); }
            .rem-bell.has-items { color: var(--ios-accent, #007AFF); box-shadow: inset 0 0 0 2px rgba(0, 122, 255, 0.55), 0 1px 0 rgba(255, 255, 255, 0.95); }
            body.dark-theme .rem-bell.has-items { box-shadow: inset 0 0 0 2px rgba(10, 132, 255, 0.65), 0 1px 0 rgba(255, 255, 255, 0.14); color: #0A84FF; }
            .rem-bell ion-icon { font-size: 22px; }
            .rem-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; background: var(--ios-danger, #FF3B30); color: #fff; font-size: 11px; font-weight: 700; border-radius: 9px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--ios-bg-primary, #F2F2F7); }
            .rem-panel { position: fixed; top: 80px; right: 16px; width: 320px; max-width: calc(100vw - 32px); max-height: 70vh; background: var(--ios-bg-card, rgba(255,255,255,0.95)); backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%); border-radius: 20px; box-shadow: 0 16px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05); z-index: 2000; display: flex; flex-direction: column; transform: translateY(-20px) scale(0.95); opacity: 0; pointer-events: none; transition: all 0.25s cubic-bezier(0.32, 0.72, 0, 1); }
            body.dark-theme .rem-panel { background: linear-gradient(180deg, #2A2A2E 0%, #1D1D21 100%); box-shadow: 0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08); }
            .rem-panel.open { transform: translateY(0) scale(1); opacity: 1; pointer-events: auto; }
            .rem-panel-header { display: flex; align-items: center; gap: 8px; padding: 16px; border-bottom: 1px solid var(--ios-border, rgba(0,0,0,0.08)); }
            .rem-panel-header h4 { margin: 0; font-size: 17px; font-weight: 600; flex: 1; color: var(--ios-text-primary); }
            .rem-panel-header ion-icon { font-size: 22px; color: var(--ios-accent); }
            .rem-panel-close { width: 32px; height: 32px; border: none; border-radius: 50%; background: rgba(142, 142, 147, 0.15); color: var(--ios-text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s cubic-bezier(0.32, 0.72, 0, 1); flex-shrink: 0; margin-left: auto; }
            .rem-panel-close:active { transform: scale(0.88); background: rgba(142, 142, 147, 0.25); }
            .rem-panel-close ion-icon { font-size: 20px; }
            body.dark-theme .rem-panel-close { background: rgba(255, 255, 255, 0.12); color: rgba(235, 235, 245, 0.80); }
            body.dark-theme .rem-panel-close:active { background: rgba(255, 255, 255, 0.20); }
            .rem-list { flex: 1; overflow-y: auto; padding: 8px; }
            .rem-empty { text-align: center; padding: 32px 16px; color: var(--ios-text-tertiary); display: flex; flex-direction: column; align-items: center; gap: 8px; }
            .rem-empty ion-icon { font-size: 36px; color: var(--ios-success); }
            .rem-item { display: flex; gap: 12px; padding: 12px; border-radius: 14px; margin-bottom: 8px; background: var(--ios-bg-secondary, rgba(0,0,0,0.03)); align-items: flex-start; }
            body.dark-theme .rem-item { background: rgba(255,255,255,0.05); }
            .rem-item-icon { font-size: 24px; color: var(--ios-warning); flex-shrink: 0; margin-top: 2px; }
            .rem-type-to .rem-item-icon { color: var(--ios-accent); }
            .rem-type-goal .rem-item-icon { color: var(--ios-success); }
            .rem-type-fuel .rem-item-icon { color: var(--ios-danger); }
            .rem-item-body { flex: 1; min-width: 0; }
            .rem-item-title { font-size: 15px; font-weight: 600; color: var(--ios-text-primary); margin-bottom: 4px; }
            .rem-item-text { font-size: 13px; color: var(--ios-text-secondary); line-height: 1.4; }
            .rem-item-vehicle { font-size: 11px; color: var(--ios-text-tertiary); margin-top: 4px; font-style: italic; }
            .rem-item-dismiss { background: none; border: none; color: var(--ios-text-tertiary); font-size: 20px; cursor: pointer; padding: 4px; display: flex; flex-shrink: 0; border-radius: 50%; }
            .rem-item-dismiss:hover { background: rgba(142, 142, 147, 0.15); color: var(--ios-danger); }
            .rem-panel-footer { padding: 12px 16px; border-top: 1px solid var(--ios-border, rgba(0,0,0,0.08)); display: flex; gap: 8px; }
            .rem-btn { flex: 1; padding: 10px; border-radius: 12px; border: none; background: var(--ios-accent-light, rgba(0,122,255,0.08)); color: var(--ios-accent); font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: transform 0.15s, background 0.15s; }
            .rem-btn:active { transform: scale(0.96); background: var(--ios-accent); color: #fff; }
            .rem-banner { position: fixed; top: 80px; left: 50%; transform: translateX(-50%) translateY(-30px); width: calc(100% - 32px); max-width: 400px; background: var(--ios-bg-card, #fff); box-shadow: 0 12px 32px rgba(0,0,0,0.15); border-radius: 16px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; z-index: 3000; opacity: 0; pointer-events: none; transition: all 0.35s cubic-bezier(0.32, 0.72, 0, 1); border-left: 4px solid var(--ios-accent); cursor: pointer; }
            body.dark-theme .rem-banner { background: #2A2A2E; box-shadow: 0 12px 32px rgba(0,0,0,0.6); }
            .rem-banner.visible { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
            .rem-banner ion-icon { font-size: 28px; color: var(--ios-accent); flex-shrink: 0; }
            .rem-banner div { flex: 1; min-width: 0; }
            .rem-banner strong { display: block; font-size: 15px; color: var(--ios-text-primary); margin-bottom: 2px; }
            .rem-banner span { font-size: 13px; color: var(--ios-text-secondary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .rem-banner-vehicle { font-size: 11px; color: var(--ios-text-tertiary); margin-top: 2px; font-style: italic; }
            .rem-type-fuel.rem-banner { border-left-color: var(--ios-danger); }
            .rem-type-fuel.rem-banner ion-icon { color: var(--ios-danger); }
            .rem-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 4000; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.25s; }
            .rem-overlay.visible { opacity: 1; pointer-events: auto; }
            .rem-modal { width: calc(100% - 32px); max-width: 480px; max-height: 85vh; background: var(--ios-bg-secondary, #fff); border-radius: 20px; display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0,0,0,0.2); transform: scale(0.9) translateY(20px); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
            body.dark-theme .rem-modal { background: #1C1C1E; box-shadow: 0 24px 64px rgba(0,0,0,0.6); }
            .rem-overlay.visible .rem-modal { transform: scale(1) translateY(0); }
            .rem-modal-header { padding: 16px 20px; border-bottom: 1px solid var(--ios-border); display: flex; align-items: center; gap: 10px; }
            .rem-modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; flex: 1; color: var(--ios-text-primary); }
            .rem-modal-header ion-icon { font-size: 24px; color: var(--ios-accent); }
            .rem-modal-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
            .rem-section { font-size: 12px; font-weight: 700; color: var(--ios-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 8px; }
            .rem-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--ios-divider, rgba(0,0,0,0.05)); font-size: 15px; color: var(--ios-text-primary); cursor: pointer; }
            .rem-row input[type="number"], .rem-row input[type="date"] { width: 110px; padding: 6px 10px; border: 1px solid var(--ios-border); border-radius: 8px; font-size: 14px; text-align: right; background: var(--ios-bg-input, #fff); color: var(--ios-text-primary); font-family: inherit; }
            body.dark-theme .rem-row input { background: #2C2C2E; border-color: rgba(255,255,255,0.1); }
            .rem-switch { position: relative; width: 51px; height: 31px; flex-shrink: 0; }
            .rem-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 2; }
            .rem-switch-track { position: absolute; inset: 0; border-radius: 100px; background: rgba(120, 120, 128, 0.16); transition: background 0.3s; }
            .rem-switch-thumb { position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.15); transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1); }
            .rem-switch input:checked + .rem-switch-track { background: var(--ios-success, #34C759); }
            .rem-switch input:checked + .rem-switch-track .rem-switch-thumb { transform: translateX(20px); }
            .rem-modal-footer { padding: 12px 20px; border-top: 1px solid var(--ios-border); display: flex; gap: 10px; }
            .rem-modal-footer .rem-btn { padding: 12px; font-size: 16px; border-radius: 14px; }
        `;
        document.head.appendChild(style);
    }

    function buildUI() {
        const actions = document.querySelector('.header-actions');
        if (!actions) return false;
        if (document.getElementById('rem-bell')) return true;

        const bell = document.createElement('button');
        bell.id = 'rem-bell';
        bell.className = 'rem-bell';
        bell.type = 'button';
        bell.title = 'Напоминания';
        bell.innerHTML = '<ion-icon name="notifications-outline"></ion-icon><span class="rem-badge" hidden>0</span>';
        bell.addEventListener('click', e => { e.stopPropagation(); togglePanel(); });
        actions.insertBefore(bell, actions.firstChild);

        const panel = document.createElement('div');
        panel.id = 'rem-panel';
        panel.className = 'rem-panel';
        document.body.appendChild(panel);

        document.addEventListener('click', e => {
            if (panel.classList.contains('open') && !panel.contains(e.target) && !bell.contains(e.target)) closePanel();
        });
        return true;
    }

    function updateBadge() {
        const bell = document.getElementById('rem-bell');
        if (!bell) return;
        const badge = bell.querySelector('.rem-badge');
        const n = activeReminders.length;
        badge.hidden = n === 0;
        badge.textContent = n > 9 ? '9+' : n;
        bell.classList.toggle('has-items', n > 0);
    }

    function togglePanel() {
        const p = document.getElementById('rem-panel');
        p.classList.contains('open') ? closePanel() : openPanel();
    }
    function openPanel() { renderPanel(); document.getElementById('rem-panel').classList.add('open'); }
    function closePanel() { const p = document.getElementById('rem-panel'); if (p) p.classList.remove('open'); }

    function needPermissionButton() {
        return ('Notification' in window) && Notification.permission === 'default';
    }

    function renderPanel() {
        const panel = document.getElementById('rem-panel');
        if (!panel) return;
        const items = activeReminders.slice().sort((a, b) => a.priority - b.priority);
        
        panel.innerHTML =
            '<div class="rem-panel-header">' +
                '<ion-icon name="notifications-outline"></ion-icon><h4>Напоминания</h4>' +
                '<button class="rem-panel-close" id="rem-panel-close" type="button"><ion-icon name="close-outline"></ion-icon></button>' +
            '</div>' +
            '<div class="rem-list">' +
            (items.length ? items.map(r => {
                const vehicleText = (r.vehicleId && r.vehicleId !== 'default' && r.vehicleName) ?
                    ` (${r.vehicleName}${r.vehiclePlate ? ': ' + r.vehiclePlate : ''})` : '';
                
                return '<div class="rem-item rem-type-' + r.type + '">' +
                    '<div class="rem-item-icon"><ion-icon name="' + r.icon + '"></ion-icon></div>' +
                    '<div class="rem-item-body">' +
                        '<div class="rem-item-title">' + r.title + vehicleText + '</div>' +
                        '<div class="rem-item-text">' + r.text + '</div>' +
                    '</div>' +
                    '<button class="rem-item-dismiss" type="button" data-rem-id="' + r.id + '" title="Скрыть">' +
                        '<ion-icon name="close-circle-outline"></ion-icon></button>' +
                '</div>';
            }).join('')
                : '<div class="rem-empty"><ion-icon name="checkmark-circle-outline"></ion-icon><span>Нет активных напоминаний</span></div>') +
            '</div>' +
            '<div class="rem-panel-footer">' +
                '<button class="rem-btn" id="rem-open-settings" type="button"><ion-icon name="settings-outline"></ion-icon> Настройки</button>' +
                (needPermissionButton() ? '<button class="rem-btn" id="rem-request-permission" type="button"><ion-icon name="desktop-outline"></ion-icon> Разрешить</button>' : '') +
            '</div>';

        panel.querySelector('#rem-panel-close').addEventListener('click', closePanel);
        panel.querySelector('#rem-open-settings').addEventListener('click', e => { e.stopPropagation(); openSettings(); });
        const rp = panel.querySelector('#rem-request-permission');
        if (rp) rp.addEventListener('click', e => { e.stopPropagation(); requestPermission(); });
        panel.querySelectorAll('.rem-item-dismiss').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); dismissReminder(btn.dataset.remId); });
        });
    }

    function showBanner(r) {
        const b = document.createElement('div');
        b.className = 'rem-banner rem-type-' + r.type;
        
        let vehicleHTML = '';
        if (r.vehicleId && r.vehicleId !== 'default' && r.vehicleName) {
            vehicleHTML = `<div class="rem-banner-vehicle">${r.vehicleName}${r.vehiclePlate ? ' (' + r.vehiclePlate + ')' : ''}</div>`;
        }
        
        b.innerHTML = '<ion-icon name="' + r.icon + '"></ion-icon><div><strong>' + r.title + '</strong><span>' + r.text + '</span>' + 
            vehicleHTML + 
            '</div>';
        document.body.appendChild(b);
        requestAnimationFrame(() => b.classList.add('visible'));
        const remove = () => { b.classList.remove('visible'); setTimeout(() => b.remove(), 350); };
        b.addEventListener('click', () => { remove(); openPanel(); });
        setTimeout(remove, 6000);
    }

    function requestPermission() {
        if (!('Notification' in window)) {
            if (typeof showToast === 'function') showToast('⚠️ Браузер не поддерживает системные уведомления');
            return;
        }
        Notification.requestPermission().then(async p => {
            if (p === 'granted') {
                settings.systemNotifications = true;
                await saveRemindersData();
                if (typeof showToast === 'function') showToast('✅ Системные уведомления включены');
            }
            renderPanel();
        });
    }

    function switchRow(path, label, checked) {
        return '<label class="rem-row"><span>' + label + '</span>' +
            '<span class="rem-switch"><input type="checkbox" data-path="' + path + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="rem-switch-track"><span class="rem-switch-thumb"></span></span></span></label>';
    }
    function numRow(path, label, value, min) {
        return '<label class="rem-row"><span>' + label + '</span>' +
            '<input type="number" data-path="' + path + '" value="' + value + '" min="' + min + '" step="1"></label>';
    }
    function dateRow(path, label, value) {
        return '<label class="rem-row"><span>' + label + '</span>' +
            '<input type="date" data-path="' + path + '" value="' + (value || '') + '"></label>';
    }
    function setByPath(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object' || Array.isArray(cur[parts[i]])) {
                cur[parts[i]] = {};
            }
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function openSettings() {
        if (document.getElementById('rem-settings-overlay')) return;
        const s = settings;
        
        const getSvc = (id, defKm, defMonths) => ({
            enabled: s.to.services?.[id]?.enabled ?? true,
            intervalKm: s.to.services?.[id]?.intervalKm ?? defKm,
            months: s.to.services?.[id]?.months ?? defMonths
        });

        const oil = getSvc('oil', 10000, 12);
        const trans = getSvc('trans', 60000, 48);
        const air = getSvc('air', 15000, 12);
        const cabin = getSvc('cabin', 15000, 12);
        const plugs = getSvc('plugs', 30000, 24);
        const brakefl = getSvc('brakefl', 40000, 24);
        const coolant = getSvc('coolant', 60000, 36);
        const belt = getSvc('belt', 80000, 60);
        const battery = getSvc('battery', 60000, 48);

        const buildSvcRow = (id, name, def) => `
            <div style="margin: 8px 0 8px 12px; padding: 10px; background: var(--ios-bg-tertiary, rgba(0,0,0,0.03)); border-radius: 12px; border-left: 3px solid var(--ios-accent);">
                ${switchRow(`to.services.${id}.enabled`, name, def.enabled)}
                ${def.enabled ? `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
                        ${numRow(`to.services.${id}.intervalKm`, 'Интервал (км)', def.intervalKm, 1000)}
                        ${numRow(`to.services.${id}.months`, 'Интервал (мес.)', def.months, 1)}
                    </div>
                ` : ''}
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.id = 'rem-settings-overlay';
        overlay.className = 'rem-overlay';
        overlay.innerHTML = `
            <div class="rem-modal">
                <div class="rem-modal-header">
                    <ion-icon name="settings-outline"></ion-icon>
                    <h3>Настройки напоминаний</h3>
                </div>
                <div class="rem-modal-body" style="max-height: 70vh; overflow-y: auto; padding-right: 8px;">
                    ${switchRow('enabled', 'Все напоминания', s.enabled)}
                    ${switchRow('systemNotifications', 'Системные уведомления', s.systemNotifications)}
                    <div class="rem-section">Техобслуживание (ТО)</div>
                    ${switchRow('to.enabled', 'Включить напоминания о ТО', s.to.enabled)}
                    ${s.to.enabled ? numRow('to.warnBeforeKm', 'Предупреждать за (км)', s.to.warnBeforeKm, 0) : ''}
                    ${s.to.enabled ? `
                        <div style="margin-top: 12px;">
                            ${buildSvcRow('oil', '🛢️ Замена масла и фильтра', oil)}
                            ${buildSvcRow('trans', '⚙️ Масло в МКПП / АКПП', trans)}
                            ${buildSvcRow('air', '💨 Воздушный фильтр', air)}
                            ${buildSvcRow('cabin', '🌬️ Салонный фильтр', cabin)}
                            ${buildSvcRow('plugs', '⚡ Свечи зажигания', plugs)}
                            ${buildSvcRow('brakefl', '💧 Тормозная жидкость', brakefl)}
                            ${buildSvcRow('coolant', '❄️ Охлаждающая жидкость', coolant)}
                            ${buildSvcRow('belt', '🔗 Ремень / Цепь ГРМ', belt)}
                            ${buildSvcRow('battery', '🔋 Аккумулятор', battery)}
                        </div>
                    ` : ''}
                    <div class="rem-section">Смены</div>
                    ${switchRow('shift.enabled', 'Напоминать о сменах', s.shift.enabled)}
                    ${s.shift.enabled ? `
                        ${dateRow('shift.anchor', 'Начало цикла (1-й раб. день)', s.shift.anchor)}
                        ${numRow('shift.workDays', 'Рабочих дней', s.shift.workDays, 1)}
                        ${numRow('shift.offDays', 'Выходных дней', s.shift.offDays, 1)}
                        ${numRow('shift.remindAtHour', 'Напоминать с часа (0-23)', s.shift.remindAtHour, 0)}
                    ` : ''}
                    <div class="rem-section">Топливо</div>
                    ${switchRow('fuel.enabled', 'Контроль роста расхода', s.fuel.enabled)}
                    ${s.fuel.enabled ? numRow('fuel.risePercent', 'Порог роста (%)', s.fuel.risePercent, 1) : ''}
                    <div class="rem-section">Цели</div>
                    ${switchRow('goals.enabled', 'Достижение целей', s.goals.enabled)}
                </div>
                <div class="rem-modal-footer">
                    <button class="rem-btn" id="rem-settings-cancel" type="button">Отмена</button>
                    <button class="rem-btn" id="rem-settings-save" type="button"><ion-icon name="checkmark-outline"></ion-icon> Сохранить</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const close = () => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 300); };
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('#rem-settings-cancel').addEventListener('click', close);
        overlay.querySelector('#rem-settings-save').addEventListener('click', async () => {
            overlay.querySelectorAll('[data-path]').forEach(inp => {
                const path = inp.dataset.path;
                if (inp.type === 'checkbox') setByPath(settings, path, inp.checked);
                else if (inp.type === 'number') setByPath(settings, path, num(inp.value));
                else setByPath(settings, path, inp.value);
            });
            await saveRemindersData();
            close();
            refresh();
            if (typeof showToast === 'function') showToast('✅ Настройки сохранены');
        });
    }

    // ---------- Старт ----------
    async function init() {
        injectStyles();
        if (!buildUI()) { setTimeout(init, 1000); return; }
        
        let attempts = 0;
        while ((!currentUser || typeof db === 'undefined') && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!currentUser || typeof db === 'undefined') {
            console.warn('⚠️ Пользователь не вошел в аккаунт.');
        } else {
            console.log('✅ Пользователь авторизован');
        }
        
        await loadRemindersData();
        
        refresh();
        setInterval(refresh, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden && isDataLoaded) refresh(); });
        console.log('✅ Модуль напоминаний запущен (цикл устранен)');
    }

    window.remindersRefresh = refresh;
    window.remindersOpenSettings = openSettings;
    window.remindersDebug = function () {
        return {
            isDataLoaded,
            allVehicles: getAllVehicles(),
            storage: (currentUser && typeof db !== 'undefined') ? 'Firebase (Real-time + localStorage cache)' : 'localStorage',
            settings: settings,
            all_repairs_count: getAllRepairs().length,
            all_fuelLogs_count: getAllFuelLogs().length,
            active_reminders: activeReminders
        };
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();