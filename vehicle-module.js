// =============================================
// МОДУЛЬ УПРАВЛЕНИЯ АВТОМОБИЛЯМИ (vehicle-module.js) v1.3
// =============================================
// Экономная версия (без onSnapshot).
// Чтение из Firebase происходит только 1 раз при запуске.
// =============================================
(function () {
    'use strict';

    const VEHICLES_STORAGE_KEY = 'driverVehicles';
    const CURRENT_VEHICLE_KEY = 'currentVehicleId';

    let vehicles = [];
    let currentVehicleId = 'default';
    let editingVehicleId = null;

    // ============================================
    // УТИЛИТЫ
    // ============================================
    function safeToast(titleOrMsg, message) {
        const text = message ? `${titleOrMsg}: ${message}` : titleOrMsg;
        if (typeof window.showToast === 'function') {
            try { window.showToast(text); return; } catch (e) {}
        }
        console.log('🔔', text);
    }

    function saveVehiclesLocal() {
        try {
            localStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify(vehicles));
            localStorage.setItem(CURRENT_VEHICLE_KEY, currentVehicleId);
        } catch (e) {
            console.error('❌ Ошибка сохранения авто:', e);
        }
        window.vehicles = vehicles;
        window.currentVehicleId = currentVehicleId;
    }

    function isFirebaseReady() {
        return typeof window.auth !== 'undefined' && window.auth.currentUser
            && typeof window.db !== 'undefined';
    }

    // ============================================
    // 1. ЗАГРУЗКА АВТОМОБИЛЕЙ (БЕЗ onSnapshot)
    // ============================================
    async function loadVehicles() {
        try {
            // 1. Локально
            const saved = localStorage.getItem(VEHICLES_STORAGE_KEY);
            if (saved) {
                try { vehicles = JSON.parse(saved); } catch (e) { vehicles = []; }
            }

            const savedCurrent = localStorage.getItem(CURRENT_VEHICLE_KEY);
            if (savedCurrent) currentVehicleId = savedCurrent;

            // 2. Гарантируем default
            if (!vehicles.some(v => v.id === 'default')) {
                vehicles.unshift({
                    id: 'default',
                    name: 'Основной автомобиль',
                    plate: 'Не указан',
                    year: new Date().getFullYear()
                });
                console.log('✅ Добавлен автомобиль по умолчанию');
            }

            if (!vehicles.some(v => v.id === currentVehicleId)) {
                currentVehicleId = 'default';
                console.log('⚠️ Текущий автомобиль не найден, переключено на default');
            }

            saveVehiclesLocal();
            renderVehicleSelector();
            renderVehicleList();

            // 3. Одноразовая загрузка из Firebase
            if (isFirebaseReady()) {
                console.log('☁️ Загрузка автомобилей из Firebase (1 раз)...');
                const snapshot = await window.db.collection('users')
                    .doc(window.auth.currentUser.uid)
                    .collection('vehicles')
                    .get();

                if (!snapshot.empty) {
                    const fbVehicles = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                    
                    if (!fbVehicles.some(v => v.id === 'default')) {
                        fbVehicles.unshift({
                            id: 'default',
                            name: 'Основной автомобиль',
                            plate: 'Не указан',
                            year: new Date().getFullYear()
                        });
                    }

                    vehicles = fbVehicles;

                    if (!vehicles.some(v => v.id === currentVehicleId)) {
                        currentVehicleId = 'default';
                        console.log('⚠️ Текущий автомобиль не найден, переключено на default');
                    }

                    saveVehiclesLocal();
                    renderVehicleSelector();
                    renderVehicleList();
                    console.log(`✅ Автомобилей из Firebase: ${vehicles.length}`);
                }
            }

            notifyVehicleChanged();
        } catch (error) {
            console.error('❌ Ошибка загрузки автомобилей:', error);
        }
    }

    // ============================================
    // 2. ДОБАВЛЕНИЕ / РЕДАКТИРОВАНИЕ
    // ============================================
    async function addVehicle(e) {
        if (e) e.preventDefault();

        const nameEl = document.getElementById('vehicle-name');
        const plateEl = document.getElementById('vehicle-plate');
        const yearEl = document.getElementById('vehicle-year');
        if (!nameEl) return;

        const name = nameEl.value.trim();
        const plate = plateEl ? plateEl.value.trim() : '';
        const year = yearEl ? (parseInt(yearEl.value) || new Date().getFullYear()) : new Date().getFullYear();

        if (!name) {
            safeToast('Введите название автомобиля');
            return;
        }

        const isEdit = !!editingVehicleId;

        if (isEdit) {
            const idx = vehicles.findIndex(v => v.id === editingVehicleId);
            if (idx !== -1) {
                vehicles[idx] = {
                    ...vehicles[idx],
                    name,
                    plate: plate || 'Без номера',
                    year,
                    updatedAt: new Date().toISOString()
                };
                saveVehiclesLocal();

                if (isFirebaseReady()) {
                    try {
                        await window.db.collection('users')
                            .doc(window.auth.currentUser.uid)
                            .collection('vehicles')
                            .doc(editingVehicleId)
                            .set(vehicles[idx]);
                        if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
                    } catch (err) {
                        console.error('❌ Ошибка сохранения авто в Firebase:', err);
                    }
                }
                console.log('✅ Автомобиль отредактирован:', name);
            }

            editingVehicleId = null;
            const cancelBtn = document.getElementById('cancel-edit-vehicle');
            if (cancelBtn) cancelBtn.style.display = 'none';
            const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить автомобиль';
                submitBtn.classList.remove('btn-primary');
                submitBtn.classList.add('btn-success');
            }
            safeToast('✅ Автомобиль обновлён!');
        } else {
            const newVehicle = {
                id: 'car_' + Date.now(),
                name,
                plate: plate || 'Без номера',
                year,
                createdAt: new Date().toISOString()
            };
            vehicles.push(newVehicle);
            currentVehicleId = newVehicle.id;
            saveVehiclesLocal();

            if (isFirebaseReady()) {
                try {
                    await window.db.collection('users')
                        .doc(window.auth.currentUser.uid)
                        .collection('vehicles')
                        .doc(newVehicle.id)
                        .set(newVehicle);
                    if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
                } catch (err) {
                    console.error('❌ Ошибка сохранения авто в Firebase:', err);
                }
            }
            console.log('✅ Автомобиль добавлен:', name);
            safeToast('✅ Автомобиль добавлен!');
        }

        const form = document.getElementById('vehicle-form');
        if (form) form.reset();
        renderVehicleSelector();
        renderVehicleList();
        notifyVehicleChanged();
    }

    // ============================================
    // 3. РЕДАКТИРОВАНИЕ
    // ============================================
    function editVehicle(id) {
        const v = vehicles.find(x => x.id === id);
        if (!v) return;

        editingVehicleId = id;

        const nameEl = document.getElementById('vehicle-name');
        const plateEl = document.getElementById('vehicle-plate');
        const yearEl = document.getElementById('vehicle-year');
        if (nameEl) nameEl.value = v.name;
        if (plateEl) plateEl.value = v.plate || '';
        if (yearEl) yearEl.value = v.year || new Date().getFullYear();

        const cancelBtn = document.getElementById('cancel-edit-vehicle');
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';

        const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
        if (submitBtn) {
            submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить изменения';
            submitBtn.classList.remove('btn-success');
            submitBtn.classList.add('btn-primary');
        }

        const form = document.getElementById('vehicle-form');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });

        safeToast('✏️ Редактирование автомобиля');
    }

    function cancelEditVehicle() {
        editingVehicleId = null;
        const form = document.getElementById('vehicle-form');
        if (form) form.reset();

        const cancelBtn = document.getElementById('cancel-edit-vehicle');
        if (cancelBtn) cancelBtn.style.display = 'none';

        const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
        if (submitBtn) {
            submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить автомобиль';
            submitBtn.classList.remove('btn-primary');
            submitBtn.classList.add('btn-success');
        }
    }

    // ============================================
    // 4. УДАЛЕНИЕ
    // ============================================
    async function deleteVehicle(id) {
        if (id === 'default' && vehicles.length === 1) {
            safeToast('Нельзя удалить единственный автомобиль по умолчанию');
            return;
        }
        if (!confirm('Удалить этот автомобиль? Данные топлива/ремонтов останутся в базе, но будут скрыты.')) return;

        vehicles = vehicles.filter(v => v.id !== id);
        
        // Защита от удаления текущего авто (переключаемся на первый оставшийся или default)
        if (currentVehicleId === id) {
            const next = vehicles.find(v => v.id === 'default') || vehicles[0];
            currentVehicleId = next ? next.id : 'default';
        }
        saveVehiclesLocal();

        if (isFirebaseReady()) {
            try {
                await window.db.collection('users')
                    .doc(window.auth.currentUser.uid)
                    .collection('vehicles')
                    .doc(id)
                    .delete();
                if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
            } catch (err) {
                console.error('❌ Ошибка удаления авто в Firebase:', err);
            }
        }

        if (editingVehicleId === id) cancelEditVehicle();

        renderVehicleSelector();
        renderVehicleList();
        notifyVehicleChanged();

        safeToast('✅ Автомобиль удалён');
    }

    // ============================================
    // 5. ВЫБОР
    // ============================================
    function selectVehicle(id) {
        currentVehicleId = id;
        saveVehiclesLocal();
        renderVehicleSelector();
        renderVehicleList();
        notifyVehicleChanged();
    }

    // ============================================
    // 6. ОПОВЕЩЕНИЕ МОДУЛЕЙ
    // ============================================
    function notifyVehicleChanged() {
        console.log('🚗 Автомобиль изменён на:', currentVehicleId);

        // 6.1. Селекты
        if (typeof window.populateVehicleSelect === 'function') {
            try { window.populateVehicleSelect(); } catch (e) {}
        }
        if (typeof window.populateRepairModalVehicleSelect === 'function') {
            try { window.populateRepairModalVehicleSelect(); } catch (e) {}
        }

        // 6.2. Перезагрузка данных
        if (typeof window.loadFuelLogs === 'function') {
            try { window.loadFuelLogs(); } catch (e) {}
        }
        if (typeof window.loadRepairRecords === 'function') {
            try { window.loadRepairRecords(); } catch (e) {}
        }

        // 6.3. Перерисовка
        ['renderFuelLogs', 'updateFuelStats', 'updateFuelChart',
         'renderRepairList', 'updateRepairStats', 'updateRepairCharts'].forEach(fn => {
            if (typeof window[fn] === 'function') {
                try { window[fn](); } catch (e) {}
            }
        });

        // 6.4. Дашборд
        if (typeof window.updateHomeTab === 'function') {
            try { window.updateHomeTab(); } catch (e) {}
        }

        // 6.5. Событие
        try {
            window.dispatchEvent(new CustomEvent('vehicleChanged', {
                detail: { vehicleId: currentVehicleId }
            }));
        } catch (e) {}
    }

    // ============================================
    // 7. РЕНДЕР
    // ============================================
    function renderVehicleSelector() {
        const select = document.getElementById('vehicle-selector');
        if (!select) return;
        select.innerHTML = vehicles.map(v =>
            `<option value="${v.id}" ${v.id === currentVehicleId ? 'selected' : ''}>${v.name} (${v.plate})</option>`
        ).join('');
        select.onchange = (e) => selectVehicle(e.target.value);
    }

    function renderVehicleList() {
        const container = document.getElementById('vehicle-list');
        if (!container) return;
        container.innerHTML = vehicles.map(v => `
            <div class="vehicle-item ${v.id === currentVehicleId ? 'active' : ''}">
                <div class="vehicle-info">
                    <div class="vehicle-name">${v.name}</div>
                    <div class="vehicle-meta">${v.plate} · ${v.year} г.</div>
                </div>
                <div class="vehicle-actions">
                    ${v.id !== currentVehicleId
                        ? `<button class="btn btn-small btn-primary" onclick="selectVehicle('${v.id}')">Выбрать</button>`
                        : '<span class="current-badge">Активен</span>'}
                    <button class="btn btn-small btn-secondary" onclick="editVehicle('${v.id}')" title="Редактировать">
                        <ion-icon name="create-outline"></ion-icon>
                    </button>
                    <button class="btn btn-small btn-danger" onclick="deleteVehicle('${v.id}')" title="Удалить">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // ============================================
    // 8. УТИЛИТЫ
    // ============================================
    function getVehicleNameById(vehicleId) {
        if (!vehicleId) return 'Неизвестный автомобиль';
        const v = vehicles.find(x => x.id === vehicleId);
        return v ? `${v.name} (${v.plate})` : 'Неизвестный автомобиль';
    }

    // ============================================
    // 9. РЕАКЦИЯ НА СМЕНУ ПОЛЬЗОВАТЕЛЯ
    // ============================================
    function onUserChanged(user) {
        if (user && typeof window.db !== 'undefined') {
            loadVehicles(); // перезагружаем при входе
        } else {
            // При выходе — сбрасываем
            vehicles = [];
            currentVehicleId = 'default';
            saveVehiclesLocal();
            renderVehicleSelector();
            renderVehicleList();
        }
    }

    // ============================================
    // 10. ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function init() {
        const form = document.getElementById('vehicle-form');
        if (form) form.addEventListener('submit', addVehicle);

        loadVehicles();

        if (typeof window.auth !== 'undefined' && typeof window.auth.onAuthStateChanged === 'function') {
            window.auth.onAuthStateChanged(onUserChanged);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ============================================
    // 11. ЭКСПОРТ
    // ============================================
    window.getCurrentVehicleId = () => currentVehicleId;
    window.getVehicles = () => vehicles;
    window.loadVehicles = loadVehicles;
    window.editVehicle = editVehicle;
    window.cancelEditVehicle = cancelEditVehicle;
    window.deleteVehicle = deleteVehicle;
    window.selectVehicle = selectVehicle;
    window.getVehicleNameById = getVehicleNameById;
    window.notifyVehicleChanged = notifyVehicleChanged;
    window.saveVehiclesLocal = saveVehiclesLocal;

    window.vehicles = vehicles;
    window.currentVehicleId = currentVehicleId;

    console.log('✅ vehicle-module v1.3 (Firebase-экономный) загружен');
})();