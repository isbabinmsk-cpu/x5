// ============================================
// МОДУЛЬ ВВОДА ДАННЫХ ЗА ДЕНЬ (entry-module.js) v1.1
// ============================================
// Всё, что связано с модалкой ввода — ЗДЕСЬ:
//   • HTML модалки
//   • открытие/закрытие
//   • autoCalc / toggleAutoCalc / markManualEdit
//   • updateWeekday / updateTariffDisplay / onDateChange
//   • recalcCurrentByTariff / cancelEdit / clearForm
//   • сохранение через window.saveRecord (из script.js)
//
// Из ядра используется:
//   • window.records, window.tariffs (данные)
//   • window.saveRecord (сохранение)
//   • window.getTariffForDate (тариф на дату)
//   • window.normalizeRecord, window.formatMoney, window.parseLocalDate
//   • window.openFuelModal, window.openRepairModal (для FAB-меню, если есть)
// ============================================
(function () {
    'use strict';

    let entryModalOverlay = null;
    let isModalOpen = false;

    // ============================================
    // СОСТОЯНИЕ АВТО-РАСЧЁТА
    // ============================================
    const autoCalcState = { km: true, weight: true };

    // ============================================
    // HTML МОДАЛКИ
    // ============================================
    function getEntryModalHTML() {
        return `
<div id="entry-modal-overlay" class="entry-modal-overlay">
    <div class="entry-modal" role="dialog" aria-modal="true">
        <div class="entry-modal-header">
            <div class="entry-modal-handle"></div>
            <h3 class="entry-modal-title">
                <ion-icon name="calendar-outline"></ion-icon>
                Ввод данных за день
            </h3>
            <button class="entry-modal-close" type="button" onclick="closeEntryModal()" aria-label="Закрыть">
                <ion-icon name="close-outline"></ion-icon>
            </button>
        </div>

        <div class="entry-modal-body">
            <div id="editing-notice" class="editing-notice" style="display:none;">
                <ion-icon name="create-outline" class="notice-icon"></ion-icon>
                Режим редактирования.
                <button type="button" class="btn btn-secondary btn-small" onclick="recalcCurrentByTariff()">
                    <ion-icon name="calculator-outline" class="btn-icon-small"></ion-icon>
                    Пересчитать
                </button>
                <button type="button" class="btn btn-danger btn-small" onclick="cancelEdit()">
                    <ion-icon name="close-circle-outline" class="btn-icon-small"></ion-icon>
                    Отменить
                </button>
            </div>

            <div class="current-tariffs-info">
                <h3>
                    <ion-icon name="pricetag-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>
                    ТАРИФЫ НА <span id="tariff-date-display">сегодня</span>
                </h3>
                <div class="tariff-badges">
                    <div class="tariff-badge tariff-pickup">
                        <ion-icon name="arrow-down-outline" class="tariff-icon"></ion-icon>
                        Забор: <strong id="t-pickup">60</strong> ₽/шт
                    </div>
                    <div class="tariff-badge tariff-delivery">
                        <ion-icon name="arrow-up-outline" class="tariff-icon"></ion-icon>
                        Выдача: <strong id="t-delivery">81</strong> ₽/шт
                    </div>
                    <div class="tariff-badge tariff-km">
                        <ion-icon name="navigate-outline" class="tariff-icon"></ion-icon>
                        Км: <strong id="t-km">11</strong> ₽/км
                    </div>
                    <div class="tariff-badge tariff-weight">
                        <ion-icon name="scale-outline" class="tariff-icon"></ion-icon>
                        Вес: <strong id="t-weight">2</strong> ₽/кг
                    </div>
                </div>
            </div>

            <form id="daily-form" onsubmit="return false;">
                <div class="form-row">
                    <div class="form-group">
                        <label><ion-icon name="calendar-outline" class="form-icon date-field-icon"></ion-icon> Дата *</label>
                        <input type="date" id="date" required>
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="calendar-number-outline" class="form-icon weekday-icon"></ion-icon> День недели</label>
                        <input type="text" id="weekday" readonly>
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="time-outline" class="form-icon hours-icon"></ion-icon> Часы</label>
                        <input type="number" id="hours" step="0.1" min="0">
                    </div>
                </div>

                <div class="auto-calc-row">
                    <div class="form-row">
                        <div class="form-group">
                            <label><ion-icon name="arrow-down-circle-outline" class="form-icon"></ion-icon> Забор (шт)</label>
                            <input type="number" id="orders-pickup" min="0" oninput="autoCalc('pickup')">
                        </div>
                        <div class="form-group">
                            <label><ion-icon name="arrow-down-circle-outline" class="form-icon"></ion-icon> Забор (₽) <span class="auto-hint">автоматически</span></label>
                            <input type="number" id="pay-pickup" readonly>
                        </div>
                    </div>
                </div>

                <div class="auto-calc-row">
                    <div class="form-row">
                        <div class="form-group">
                            <label><ion-icon name="arrow-up-circle-outline" class="form-icon delivery-icon"></ion-icon> Выдача (шт)</label>
                            <input type="number" id="orders-delivery" min="0" oninput="autoCalc('delivery')">
                        </div>
                        <div class="form-group">
                            <label><ion-icon name="arrow-up-circle-outline" class="form-icon delivery-icon"></ion-icon> Выдача (₽) <span class="auto-hint">автоматически</span></label>
                            <input type="number" id="pay-delivery" readonly>
                        </div>
                    </div>
                </div>

                <div class="auto-calc-row">
                    <div class="form-row">
                        <div class="form-group">
                            <label><ion-icon name="navigate-outline" class="form-icon km-icon"></ion-icon> Км</label>
                            <input type="number" id="distance" step="0.001" min="0" oninput="autoCalc('km')">
                        </div>
                        <div class="form-group">
                            <label>
                                <ion-icon name="navigate-outline" class="form-icon km-icon"></ion-icon> Км (₽)
                                <span class="auto-hint">автоматически</span>
                                <button type="button" class="btn-auto-toggle" onclick="toggleAutoCalc('km')"><ion-icon name="sync-outline"></ion-icon></button>
                            </label>
                            <input type="number" id="pay-distance" step="0.01" min="0" oninput="markManualEdit('km')">
                        </div>
                    </div>
                </div>

                <div class="auto-calc-row">
                    <div class="form-row">
                        <div class="form-group">
                            <label><ion-icon name="scale-outline" class="form-icon weight-icon"></ion-icon> Вес (кг)</label>
                            <input type="number" id="weight" step="0.001" min="0" oninput="autoCalc('weight')">
                        </div>
                        <div class="form-group">
                            <label>
                                <ion-icon name="scale-outline" class="form-icon weight-icon"></ion-icon> Вес (₽)
                                <span class="auto-hint">автоматически</span>
                                <button type="button" class="btn-auto-toggle" onclick="toggleAutoCalc('weight')"><ion-icon name="sync-outline"></ion-icon></button>
                            </label>
                            <input type="number" id="pay-weight" step="0.01" min="0" oninput="markManualEdit('weight')">
                        </div>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label><ion-icon name="layers-outline" class="form-icon load-icon"></ion-icon> Нагрузка (₽)</label>
                        <input type="number" id="load-pay" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="gift-outline" class="form-icon bonus-icon"></ion-icon> Бонус (₽)</label>
                        <input type="number" id="bonus-pay" step="0.01" min="0">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label><ion-icon name="trophy-outline" class="form-icon rating-icon"></ion-icon> Рейтинг (₽)</label>
                        <input type="number" id="rating" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="cash-outline" class="form-icon tips-icon"></ion-icon> Чаевые (₽)</label>
                        <input type="number" id="tips" step="0.01" min="0">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label><ion-icon name="flame-outline" class="form-icon fuel-icon"></ion-icon> Бензин (₽)</label>
                        <input type="number" id="fuel-cost" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="construct-outline" class="form-icon repair-icon"></ion-icon> Ремонт (₽)</label>
                        <input type="number" id="repair-cost" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="receipt-outline" class="form-icon tax-icon"></ion-icon> Налог (₽)</label>
                        <input type="number" id="tax" step="0.01" min="0">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label><ion-icon name="list-outline" class="form-icon type-icon"></ion-icon> Тип записи</label>
                        <select id="record-type">
                            <option value="work">Рабочий день</option>
                            <option value="bonus">Бонус</option>
                            <option value="expense">Только расход</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label><ion-icon name="calendar-number-outline" class="form-icon bonus-period-icon"></ion-icon> Период бонуса</label>
                        <input type="text" id="bonus-period" placeholder="Например: Июль 2024">
                    </div>
                </div>
            </form>
        </div>

        <div class="entry-modal-footer">
            <button type="button" class="btn btn-secondary btn-clear" onclick="clearEntryForm()">
                <ion-icon name="trash-outline"></ion-icon> Очистить
            </button>
            <button type="button" class="btn btn-success" onclick="submitEntryForm()">
                <ion-icon name="save-outline"></ion-icon> Сохранить
            </button>
        </div>
    </div>
</div>`;
    }

    // ============================================
    // УТИЛИТЫ МОДАЛКИ
    // ============================================
    function getTariff(dateStr) {
        if (typeof window.getTariffForDate === 'function') return window.getTariffForDate(dateStr);
        return { pickup: 60, delivery: 81, km: 11, weight: 2 };
    }

    function updateWeekday() {
        const dateEl = document.getElementById('date');
        const weekdayEl = document.getElementById('weekday');
        if (!dateEl || !weekdayEl) return;
        const val = dateEl.value;
        if (!val) { weekdayEl.value = ''; return; }
        const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
        weekdayEl.value = days[new Date(val).getDay()];
    }

    function updateTariffDisplay() {
        const dateEl = document.getElementById('date');
        const display = document.getElementById('tariff-date-display');
        if (!dateEl || !display) return;
        const dateVal = dateEl.value;
        display.textContent = dateVal || 'сегодня';
        const t = getTariff(dateVal);
        const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        if (t) {
            setEl('t-pickup', t.pickup);
            setEl('t-delivery', t.delivery);
            setEl('t-km', t.km);
            setEl('t-weight', t.weight);
        }
    }

    function onDateChange() {
        updateWeekday();
        updateTariffDisplay();
    }

    // ============================================
    // АВТО-РАСЧЁТ
    // ============================================
    function autoCalc(type) {
        if (type === 'km' && autoCalcState.km === false) return;
        if (type === 'weight' && autoCalcState.weight === false) return;

        const dateEl = document.getElementById('date');
        const tariff = getTariff(dateEl ? dateEl.value : '');
        if (!tariff) return;

        let qtyId, priceId, rate;
        switch (type) {
            case 'pickup': qtyId = 'orders-pickup'; priceId = 'pay-pickup'; rate = tariff.pickup; break;
            case 'delivery': qtyId = 'orders-delivery'; priceId = 'pay-delivery'; rate = tariff.delivery; break;
            case 'km': qtyId = 'distance'; priceId = 'pay-distance'; rate = tariff.km; break;
            case 'weight': qtyId = 'weight'; priceId = 'pay-weight'; rate = tariff.weight; break;
            default: return;
        }
        const qtyEl = document.getElementById(qtyId);
        const priceEl = document.getElementById(priceId);
        if (!qtyEl || !priceEl) return;

        if (!qtyEl.value || qtyEl.value === '') { priceEl.value = ''; return; }
        const qty = parseFloat(qtyEl.value);
        if (isNaN(qty) || qty <= 0) { priceEl.value = ''; return; }
        priceEl.value = Math.round(qty * rate * 100) / 100;
    }

    function toggleAutoCalc(field) {
        autoCalcState[field] = !autoCalcState[field];
        const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
        const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
        const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
        const editingId = window.editingId;

        if (autoCalcState[field]) {
            if (btn) btn.classList.remove('manual-mode');
            if (input) input.classList.remove('manual-edit');
            if (hint) hint.textContent = 'автоматически';

            if (editingId) {
                const idx = (window.records || []).findIndex(r => r.id === editingId);
                if (idx !== -1) {
                    const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                    if (window.records[idx].manualEdits) {
                        window.records[idx].manualEdits = window.records[idx].manualEdits.filter(f => f !== fieldName);
                    }
                }
            }
            autoCalc(field);
        } else {
            if (btn) btn.classList.add('manual-mode');
            if (input) input.classList.add('manual-edit');
            if (hint) hint.textContent = 'ручной ввод';

            if (editingId) {
                const idx = (window.records || []).findIndex(r => r.id === editingId);
                if (idx !== -1) {
                    const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                    if (!window.records[idx].manualEdits) window.records[idx].manualEdits = [];
                    if (!window.records[idx].manualEdits.includes(fieldName)) {
                        window.records[idx].manualEdits.push(fieldName);
                    }
                }
            }
        }
    }

    function markManualEdit(field) {
        if (!autoCalcState[field]) return;
        autoCalcState[field] = false;
        const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
        const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
        const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';

        const editingId = window.editingId;
        if (editingId) {
            const idx = (window.records || []).findIndex(r => r.id === editingId);
            if (idx !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (!window.records[idx].manualEdits) window.records[idx].manualEdits = [];
                if (!window.records[idx].manualEdits.includes(fieldName)) {
                    window.records[idx].manualEdits.push(fieldName);
                }
            }
        }
    }

    // ============================================
    // ПЕРЕСЧЁТ ПО ТАРИФУ (кнопка в режиме редактирования)
    // ============================================
    function recalcCurrentByTariff() {
        const editingId = window.editingId;
        if (!editingId) {
            alert('⚠️ Эта функция работает только при редактировании существующей записи.');
            return;
        }
        const dateEl = document.getElementById('date');
        const tariff = getTariff(dateEl ? dateEl.value : '');
        if (!tariff) { alert('❌ Тариф для этой даты не найден'); return; }

        const pickup = parseFloat(document.getElementById('orders-pickup').value) || 0;
        const delivery = parseFloat(document.getElementById('orders-delivery').value) || 0;
        const km = parseFloat(document.getElementById('distance').value) || 0;
        const weight = parseFloat(document.getElementById('weight').value) || 0;

        const newPickup = pickup > 0 ? Math.round(pickup * tariff.pickup * 100) / 100 : 0;
        const newDelivery = delivery > 0 ? Math.round(delivery * tariff.delivery * 100) / 100 : 0;
        const newDistance = km > 0 ? Math.round(km * tariff.km * 100) / 100 : 0;
        const newWeight = weight > 0 ? Math.round(weight * tariff.weight * 100) / 100 : 0;

        document.getElementById('pay-pickup').value = newPickup;
        document.getElementById('pay-delivery').value = newDelivery;
        document.getElementById('pay-distance').value = newDistance;
        document.getElementById('pay-weight').value = newWeight;

        const records = window.records || [];
        const idx = records.findIndex(r => r.id === editingId);
        if (idx !== -1) {
            records[idx].payPickup = newPickup;
            records[idx].payDelivery = newDelivery;
            records[idx].payDistance = newDistance;
            records[idx].payWeight = newWeight;
            if (typeof window.normalizeRecord === 'function') {
                window.records[idx] = window.normalizeRecord(records[idx]);
            }
            if (typeof window.saveData === 'function') window.saveData();
            if (typeof window.saveRecordToFirebase === 'function' && window.currentUser) {
                window.saveRecordToFirebase(window.records[idx]);
            }
            if (typeof window.renderTable === 'function') window.renderTable();
        }
        alert('✅ Пересчитано и сохранено по тарифу на ' + (dateEl ? dateEl.value : ''));
    }

    // ============================================
    // ОТМЕНА РЕДАКТИРОВАНИЯ
    // ============================================
    function cancelEdit() {
        window.editingId = null;
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'none';
        const dateEl = document.getElementById('date');
        if (dateEl && dateEl.value && typeof window.renderTable === 'function') {
            // Ничего не рендерим, просто выходим из режима
        }
    }

    // ============================================
    // ОЧИСТКА ФОРМЫ
    // ============================================
    function clearForm() {
        const form = document.getElementById('daily-form');
        if (form) form.reset();
        const dateEl = document.getElementById('date');
        if (dateEl) dateEl.valueAsDate = new Date();
        const rt = document.getElementById('record-type');
        if (rt) rt.value = 'work';
        const bp = document.getElementById('bonus-period');
        if (bp) bp.value = '';
        window.editingId = null;
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'none';
        onDateChange();
    }

    // ============================================
    // ОТКРЫТИЕ / ЗАКРЫТИЕ
    // ============================================
    function openEntryModal(editId) {
        console.log('📝 openEntryModal, editId =', editId);

        if (!entryModalOverlay) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = getEntryModalHTML();
            entryModalOverlay = wrapper.firstElementChild;
            document.body.appendChild(entryModalOverlay);
            attachEntryEventListeners();
            console.log('✅ Модалка создана в DOM');
        }

        if (editId) fillFormFromRecord(editId);
        else resetEntryForm();

        requestAnimationFrame(() => {
            entryModalOverlay.classList.add('visible');
            isModalOpen = true;
            document.body.style.overflow = 'hidden';
            updateTariffDisplay();
            const dateEl = document.getElementById('date');
            if (dateEl && !dateEl.value) {
                dateEl.valueAsDate = new Date();
                onDateChange();
            }
        });
    }

    function closeEntryModal() {
        if (!entryModalOverlay || !isModalOpen) return;
        entryModalOverlay.classList.remove('visible');
        isModalOpen = false;
        document.body.style.overflow = '';
        cancelEdit();
    }

    function resetEntryForm() {
        window.editingId = null;
        const form = document.getElementById('daily-form');
        if (form) form.reset();
        const dateEl = document.getElementById('date');
        if (dateEl) dateEl.valueAsDate = new Date();
        const rt = document.getElementById('record-type');
        if (rt) rt.value = 'work';
        const bp = document.getElementById('bonus-period');
        if (bp) bp.value = '';
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'none';
        onDateChange();
    }

    function fillFormFromRecord(id) {
        const records = window.records || [];
        const rec = records.find(r => r.id === id);
        if (!rec) return;
        window.editingId = id;
        const set = (elId, val) => {
            const el = document.getElementById(elId);
            if (el) el.value = val != null ? val : '';
        };
        set('date', rec.date);
        set('hours', rec.hours);
        set('orders-pickup', rec.ordersPickup);
        set('pay-pickup', rec.payPickup);
        set('orders-delivery', rec.ordersDelivery);
        set('pay-delivery', rec.payDelivery);
        set('distance', rec.distance);
        set('pay-distance', rec.payDistance);
        set('weight', rec.weight);
        set('pay-weight', rec.payWeight);
        set('load-pay', rec.loadPay);
        set('bonus-pay', rec.bonusPay);
        set('rating', rec.rating);
        set('tips', rec.tips);
        set('fuel-cost', rec.fuelCost);
        set('repair-cost', rec.repairCost);
        set('tax', rec.tax);
        set('record-type', rec.recordType || 'work');
        set('bonus-period', rec.bonusPeriod);
        updateWeekday();
        updateTariffDisplay();
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'flex';
    }

    function attachEntryEventListeners() {
        entryModalOverlay.addEventListener('click', function (e) {
            if (e.target === entryModalOverlay) closeEntryModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isModalOpen) closeEntryModal();
        });
        const dateEl = document.getElementById('date');
        if (dateEl) {
            dateEl.addEventListener('change', onDateChange);
        }
    }

    function submitEntryForm() {
        if (typeof window.saveRecord !== 'function') {
            alert('Ошибка: функция сохранения недоступна');
            return;
        }
        const fakeEvent = { preventDefault: function () {} };
        try {
            const ok = window.saveRecord(fakeEvent);
            // saveRecord может вернуть false, если пользователь отменил
            if (ok !== false) closeEntryModal();
        } catch (err) {
            console.error('❌ Ошибка сохранения:', err);
            alert('Ошибка сохранения: ' + err.message);
        }
    }

    function clearEntryForm() {
        clearForm();
    }

    // ============================================
    // ЭКСПОРТ В WINDOW
    // ============================================
    window.openEntryModal = openEntryModal;
    window.closeEntryModal = closeEntryModal;
    window.submitEntryForm = submitEntryForm;
    window.clearEntryForm = clearEntryForm;

    // Функции, которые вызывает HTML модалки
    window.autoCalc = autoCalc;
    window.toggleAutoCalc = toggleAutoCalc;
    window.markManualEdit = markManualEdit;
    window.recalcCurrentByTariff = recalcCurrentByTariff;
    window.cancelEdit = cancelEdit;
    window.clearForm = clearForm;
    window.onDateChange = onDateChange;
    window.updateWeekday = updateWeekday;
    window.updateTariffDisplay = updateTariffDisplay;

    // ============================================
    // FAB-меню: подстраховка
    // ============================================
    // В штатном режиме script.js.selectFabAction сам вызывает нужную модалку.
    // Но если по какой-то причине selectFabAction не сработал (старый HTML,
    // дублирующиеся обработчики) — перехватываем клик по FAB-меню.
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('#fab-menu .auto-menu-item');
        if (!btn) return;

        const text = (btn.textContent || '').trim();
        const hasCalendar = btn.querySelector('ion-icon[name="calendar-outline"]');
        const hasFlame = btn.querySelector('ion-icon[name="flame-outline"]');
        const hasConstruct = btn.querySelector('ion-icon[name="construct-outline"]');

        // Если script.js уже сам вызвал действие — флаг __fabHandled
        // выставляется в selectFabAction (см. ниже — мы его не трогаем).
        // Здесь только фолбэк для "Запись", т.к. openEntryModal — наш.
        if (hasCalendar || text.includes('Запись')) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            console.log('🖱️ FAB → Запись (фолбэк entry-module)');
            if (typeof window.closeFabMenu === 'function') window.closeFabMenu();
            openEntryModal();
            return;
        }

        // Топливо и Ремонт — не наш DOM, отдаём модулям
        if (hasFlame || text.includes('Топливо')) {
            if (typeof window.openFuelModal === 'function') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (typeof window.closeFabMenu === 'function') window.closeFabMenu();
                window.openFuelModal();
            }
            return;
        }
        if (hasConstruct || text.includes('Ремонт')) {
            if (typeof window.openRepairModal === 'function') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (typeof window.closeFabMenu === 'function') window.closeFabMenu();
                window.openRepairModal();
            }
            return;
        }
    }, true);

    // ============================================
    // ПАТЧ editRecord ИЗ script.js (чтобы открывал модалку)
    // ============================================
    let attempts = 0;
    function tryPatch() {
        attempts++;
        if (typeof window.editRecord === 'function' && !window.editRecord.__entryPatched) {
            const orig = window.editRecord;
            const w = function (id) {
                if (typeof orig === 'function' && !orig.__entryPatched) {
                    // В новом script.js editRecord уже вызывает openEntryModal
                    return orig.call(this, id);
                }
                openEntryModal(id);
            };
            w.__entryPatched = true;
            window.editRecord = w;
        }
        if (attempts >= 30) return true;
        return false;
    }
    tryPatch();
    if (attempts < 30) {
        const t = setInterval(() => { if (tryPatch()) clearInterval(t); }, 200);
    }

    console.log('✅ entry-module v1.1 загружен (самодостаточный)');
})();