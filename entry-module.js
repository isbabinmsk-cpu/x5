// ============================================
// МОДУЛЬ ВВОДА ДАННЫХ ЗА ДЕНЬ (entry-module.js) v2.1 (ИСПРАВЛЕНО)
// ============================================
(function () {
    'use strict';

    let entryModalOverlay = null;
    let isModalOpen = false;
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
                <span class="entry-icon-badge entry-icon-blue"><ion-icon name="calendar-outline"></ion-icon></span>
                Ввод данных за день
            </h3>
            <button class="entry-modal-close" type="button" onclick="closeEntryModal()" aria-label="Закрыть">
                <ion-icon name="close-outline"></ion-icon>
            </button>
        </div>

        <div class="entry-modal-body">
            <div id="editing-notice" class="editing-notice" style="display:none;">
                <span class="entry-icon-badge entry-icon-orange"><ion-icon name="create-outline"></ion-icon></span>
                Режим редактирования.
                <button type="button" class="btn btn-secondary btn-small" onclick="recalcCurrentByTariff()">
                    <ion-icon name="calculator-outline" class="btn-icon-small"></ion-icon> Пересчитать
                </button>
                <button type="button" class="btn btn-danger btn-small" onclick="cancelEdit()">
                    <ion-icon name="close-circle-outline" class="btn-icon-small"></ion-icon> Отменить
                </button>
            </div>

            <div class="current-tariffs-info">
                <h3>
                    <span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="pricetag-outline"></ion-icon></span>
                    ТАРИФЫ НА <span id="tariff-date-display">сегодня</span>
                </h3>
                <div class="tariff-badges">
                    <div class="tariff-badge tariff-pickup">Забор: <strong id="t-pickup">60</strong> ₽/шт</div>
                    <div class="tariff-badge tariff-delivery">Выдача: <strong id="t-delivery">81</strong> ₽/шт</div>
                    <div class="tariff-badge tariff-km">Км: <strong id="t-km">11</strong> ₽/км</div>
                    <div class="tariff-badge tariff-weight">Вес: <strong id="t-weight">2</strong> ₽/кг</div>
                </div>
            </div>

            <form id="daily-form" onsubmit="return false;">

                <!-- ===== КАРТОЧКА 1: Время и график ===== -->
                <div class="entry-card">
                    <div class="entry-card-title">
                        <span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="time-outline"></ion-icon></span>
                        Время и график
                    </div>
                    <div class="entry-card-body">
                        <div class="form-row form-row-3">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="calendar-outline"></ion-icon></span> Дата *</label>
                                <input type="date" id="date" required>
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="calendar-number-outline"></ion-icon></span> День недели</label>
                                <input type="text" id="weekday" readonly class="weekday-display">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-yellow entry-icon-sm"><ion-icon name="time-outline"></ion-icon></span> Часы</label>
                                <input type="number" id="hours" step="0.1" min="0" placeholder="Например: 8.5">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ===== КАРТОЧКА 2: Выработки ===== -->
                <div class="entry-card">
                    <div class="entry-card-title">
                        <span class="entry-icon-badge entry-icon-green entry-icon-sm"><ion-icon name="cube-outline"></ion-icon></span>
                        Выработки
                    </div>
                    <div class="entry-card-body">
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-green entry-icon-sm"><ion-icon name="arrow-down-circle-outline"></ion-icon></span> Забор (шт)</label>
                                <input type="number" id="orders-pickup" min="0" placeholder="0" oninput="autoCalc('pickup')">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-green entry-icon-sm"><ion-icon name="cash-outline"></ion-icon></span> Забор (₽)</label>
                                <input type="number" id="pay-pickup" readonly>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="arrow-up-circle-outline"></ion-icon></span> Выдача (шт)</label>
                                <input type="number" id="orders-delivery" min="0" placeholder="0" oninput="autoCalc('delivery')">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="cash-outline"></ion-icon></span> Выдача (₽)</label>
                                <input type="number" id="pay-delivery" readonly>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-cyan entry-icon-sm"><ion-icon name="navigate-outline"></ion-icon></span> Км</label>
                                <input type="number" id="distance" step="0.001" min="0" placeholder="0.000" oninput="autoCalc('km')">
                            </div>
                            <div class="form-group">
                                <label>
                                    <span class="entry-icon-badge entry-icon-cyan entry-icon-sm"><ion-icon name="cash-outline"></ion-icon></span> Км (₽)
                                    <span class="auto-hint">автоматически</span>
                                    <button type="button" class="btn-auto-toggle" onclick="toggleAutoCalc('km')"><ion-icon name="sync-outline"></ion-icon></button>
                                </label>
                                <input type="number" id="pay-distance" step="0.01" min="0" placeholder="0.00" oninput="markManualEdit('km')">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-purple entry-icon-sm"><ion-icon name="scale-outline"></ion-icon></span> Вес (кг)</label>
                                <input type="number" id="weight" step="0.001" min="0" placeholder="0.000" oninput="autoCalc('weight')">
                            </div>
                            <div class="form-group">
                                <label>
                                    <span class="entry-icon-badge entry-icon-purple entry-icon-sm"><ion-icon name="cash-outline"></ion-icon></span> Вес (₽)
                                    <span class="auto-hint">автоматически</span>
                                    <button type="button" class="btn-auto-toggle" onclick="toggleAutoCalc('weight')"><ion-icon name="sync-outline"></ion-icon></button>
                                </label>
                                <input type="number" id="pay-weight" step="0.01" min="0" placeholder="0.00" oninput="markManualEdit('weight')">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ===== КАРТОЧКА 3: Доплаты и бонусы ===== -->
                <div class="entry-card">
                    <div class="entry-card-title">
                        <span class="entry-icon-badge entry-icon-yellow entry-icon-sm"><ion-icon name="gift-outline"></ion-icon></span>
                        Доплаты и бонусы
                    </div>
                    <div class="entry-card-body">
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-orange entry-icon-sm"><ion-icon name="layers-outline"></ion-icon></span> Нагрузка (₽)</label>
                                <input type="number" id="load-pay" step="0.01" min="0" placeholder="0.00">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-red entry-icon-sm"><ion-icon name="gift-outline"></ion-icon></span> Бонус (₽)</label>
                                <input type="number" id="bonus-pay" step="0.01" min="0" placeholder="0.00">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-yellow entry-icon-sm"><ion-icon name="trophy-outline"></ion-icon></span> Рейтинг (₽)</label>
                                <input type="number" id="rating" step="0.01" min="0" placeholder="0.00">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-green entry-icon-sm"><ion-icon name="cash-outline"></ion-icon></span> Чаевые (₽)</label>
                                <input type="number" id="tips" step="0.01" min="0" placeholder="0.00">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ===== КАРТОЧКА 4: Расходы ===== -->
                <div class="entry-card">
                    <div class="entry-card-title">
                        <span class="entry-icon-badge entry-icon-red entry-icon-sm"><ion-icon name="wallet-outline"></ion-icon></span>
                        Расходы
                    </div>
                    <div class="entry-card-body">
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-orange entry-icon-sm"><ion-icon name="flame-outline"></ion-icon></span> Бензин (₽)</label>
                                <input type="number" id="fuel-cost" step="0.01" min="0" placeholder="0.00">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-red entry-icon-sm"><ion-icon name="construct-outline"></ion-icon></span> Ремонт (₽)</label>
                                <input type="number" id="repair-cost" step="0.01" min="0" placeholder="0.00">
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-blue entry-icon-sm"><ion-icon name="receipt-outline"></ion-icon></span> Налог (₽)</label>
                                <input type="number" id="tax" step="0.01" min="0" placeholder="0.00">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ===== КАРТОЧКА 5: Дополнительно ===== -->
                <div class="entry-card">
                    <div class="entry-card-title">
                        <span class="entry-icon-badge entry-icon-purple entry-icon-sm"><ion-icon name="options-outline"></ion-icon></span>
                        Дополнительно
                    </div>
                    <div class="entry-card-body">
                        <div class="form-row">
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-purple entry-icon-sm"><ion-icon name="list-outline"></ion-icon></span> Тип записи</label>
                                <select id="record-type">
                                    <option value="work">Рабочий день</option>
                                    <option value="bonus">Бонус</option>
                                    <option value="expense">Только расход</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label><span class="entry-icon-badge entry-icon-yellow entry-icon-sm"><ion-icon name="calendar-number-outline"></ion-icon></span> Период бонуса</label>
                                <input type="text" id="bonus-period" placeholder="Например: Июль 2024">
                            </div>
                        </div>
                    </div>
                </div>

            </form>
        </div>

        <div class="entry-modal-footer">
            <button type="button" class="btn btn-secondary btn-clear" onclick="clearEntryForm()">
                <span class="entry-icon-badge entry-icon-red entry-icon-sm"><ion-icon name="trash-outline"></ion-icon></span> Очистить
            </button>
            <button type="button" class="btn btn-success" onclick="submitEntryForm()">
                <span class="entry-icon-badge entry-icon-green entry-icon-sm"><ion-icon name="save-outline"></ion-icon></span> Сохранить
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
    // ПЕРЕСЧЁТ ПО ТАРИФУ
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
    // ОТМЕНА / ОЧИСТКА
    // ============================================
    function cancelEdit() {
        window.editingId = null;
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'none';
    }

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
    // ПАТЧ editRecord ИЗ script.js
    // ============================================
    let attempts = 0;
    function tryPatch() {
        attempts++;
        if (typeof window.editRecord === 'function' && !window.editRecord.__entryPatched) {
            const orig = window.editRecord;
            const w = function (id) {
                if (typeof orig === 'function' && !orig.__entryPatched) {
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

    console.log('✅ entry-module v2.1 загружен (исправлено сохранение)');
})();