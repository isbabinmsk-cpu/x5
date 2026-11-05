// ============================================
// МОДУЛЬ ВВОДА ДАННЫХ ЗА ДЕНЬ (МОДАЛЬНОЕ ОКНО)
// v1.0.3 — работает со СТАРЫМ HTML (onclick="selectFabAction('entry')")
// ============================================
(function() {
    'use strict';

    let entryModalOverlay = null;
    let isModalOpen = false;

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
            if (typeof window.updateTariffDisplay === 'function') {
                try { window.updateTariffDisplay(); } catch (e) {}
            }
            const dateInput = document.getElementById('date');
            if (dateInput && !dateInput.value) {
                dateInput.valueAsDate = new Date();
                if (typeof window.onDateChange === 'function') {
                    try { window.onDateChange(); } catch (e) {}
                }
            }
        });
    }

    function closeEntryModal() {
        if (!entryModalOverlay || !isModalOpen) return;
        entryModalOverlay.classList.remove('visible');
        isModalOpen = false;
        document.body.style.overflow = '';
        if (typeof window.cancelEditSilent === 'function') {
            try { window.cancelEditSilent(); } catch (e) {}
        }
    }

    function resetEntryForm() {
        try { window.editingId = null; } catch (e) {}
        const form = document.getElementById('daily-form');
        if (form) form.reset();
        const dateInput = document.getElementById('date');
        if (dateInput) dateInput.valueAsDate = new Date();
        const rt = document.getElementById('record-type');
        if (rt) rt.value = 'work';
        const bp = document.getElementById('bonus-period');
        if (bp) bp.value = '';
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'none';
        if (typeof window.onDateChange === 'function') {
            try { window.onDateChange(); } catch (e) {}
        }
    }

    function fillFormFromRecord(id) {
        const rec = (window.records || []).find(r => r.id === id);
        if (!rec) return;
        try { window.editingId = id; } catch (e) {}
        const set = (elId, val) => {
            const el = document.getElementById(elId);
            if (el) el.value = val != null ? val : '';
        };
        set('date', rec.date); set('hours', rec.hours);
        set('orders-pickup', rec.ordersPickup); set('pay-pickup', rec.payPickup);
        set('orders-delivery', rec.ordersDelivery); set('pay-delivery', rec.payDelivery);
        set('distance', rec.distance); set('pay-distance', rec.payDistance);
        set('weight', rec.weight); set('pay-weight', rec.payWeight);
        set('load-pay', rec.loadPay); set('bonus-pay', rec.bonusPay);
        set('rating', rec.rating); set('tips', rec.tips);
        set('fuel-cost', rec.fuelCost); set('repair-cost', rec.repairCost);
        set('tax', rec.tax); set('record-type', rec.recordType || 'work');
        set('bonus-period', rec.bonusPeriod);
        if (typeof window.updateWeekday === 'function') {
            try { window.updateWeekday(); } catch (e) {}
        }
        if (typeof window.updateTariffDisplay === 'function') {
            try { window.updateTariffDisplay(); } catch (e) {}
        }
        const en = document.getElementById('editing-notice');
        if (en) en.style.display = 'flex';
    }

    function attachEntryEventListeners() {
        entryModalOverlay.addEventListener('click', function(e) {
            if (e.target === entryModalOverlay) closeEntryModal();
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isModalOpen) closeEntryModal();
        });
        const dateInput = document.getElementById('date');
        if (dateInput) {
            dateInput.addEventListener('change', function() {
                if (typeof window.onDateChange === 'function') {
                    try { window.onDateChange(); } catch (e) {}
                }
            });
        }
    }

    function submitEntryForm() {
        if (typeof window.saveRecord !== 'function') {
            alert('Ошибка: функция сохранения недоступна');
            return;
        }
        const fakeEvent = { preventDefault: function() {} };
        try {
            window.saveRecord(fakeEvent);
            closeEntryModal();
        } catch (err) {
            console.error('❌ Ошибка сохранения:', err);
            alert('Ошибка сохранения: ' + err.message);
        }
    }

    function clearEntryForm() {
        if (typeof window.clearForm === 'function') {
            try { window.clearForm(); } catch (e) {}
        } else {
            resetEntryForm();
        }
    }

    // Экспорт в window
    window.openEntryModal = openEntryModal;
    window.closeEntryModal = closeEntryModal;
    window.submitEntryForm = submitEntryForm;
    window.clearEntryForm = clearEntryForm;

    // ============================================
    // ГЛАВНЫЙ ФИКС: перехват selectFabAction СИЛОЙ
    // ============================================
    // Проблема: в script.js ДВЕ функции selectFabAction, вторая перезаписывает первую.
    // Мы не можем знать, какая "победит" — поэтому:
    // 1. Через defineProperty делаем selectFabAction "неперезаписываемым"
    // 2. Или перехватываем через addEventListener на document (перехват кликов)

    // Способ 1: перехват КЛИКОВ на document (самый надёжный!)
    // Ловим клики по кнопкам внутри #fab-menu и обрабатываем их сами
    document.addEventListener('click', function(e) {
        // Клик по кнопке "Запись" в FAB-меню
        const entryBtn = e.target.closest('#fab-menu .auto-menu-item');
        if (!entryBtn) return;
        
        const text = (entryBtn.textContent || '').trim();
        const hasCalendarIcon = entryBtn.querySelector('ion-icon[name="calendar-outline"]');
        
        // Определяем, какая это кнопка
        if (hasCalendarIcon || text.includes('Запись')) {
            // Это "Запись" — перехватываем клик!
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log('🖱️ Перехвачен клик по "Запись" в FAB-меню');
            
            // Закрываем меню
            const fabMenu = document.getElementById('fab-menu');
            const fab = document.getElementById('fab-add');
            if (fabMenu) fabMenu.classList.remove('open');
            if (fab) fab.classList.remove('fab-open');
            
            // Открываем модалку
            openEntryModal();
            return;
        }
        
        // Клик по "Топливо" — ОТКРЫВАЕМ МОДАЛКУ (ИСПРАВЛЕНО)
if (entryBtn.querySelector('ion-icon[name="flame-outline"]') || text.includes('Топливо')) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    console.log('🔵 Перехвачен клик по "Топливо" в FAB-меню — открываем модалку');
    
    // Закрываем меню
    const fabMenu = document.getElementById('fab-menu');
    const fab = document.getElementById('fab-add');
    if (fabMenu) fabMenu.classList.remove('open');
    if (fab) fab.classList.remove('fab-open');
    
    // Открываем МОДАЛКУ, а не вкладку!
    if (typeof window.openFuelModal === 'function') {
        window.openFuelModal();
    } else {
        console.warn('⚠️ openFuelModal не найден, открываем вкладку (фолбэк)');
        if (typeof window.switchTab === 'function') window.switchTab('fuel');
    }
    return;
}
        
        // Клик по "Ремонт"
        if (entryBtn.querySelector('ion-icon[name="construct-outline"]') || text.includes('Ремонт')) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const fabMenu = document.getElementById('fab-menu');
            const fab = document.getElementById('fab-add');
            if (fabMenu) fabMenu.classList.remove('open');
            if (fab) fab.classList.remove('fab-open');
            if (typeof window.switchTab === 'function') window.switchTab('repair');
            setTimeout(() => {
                const form = document.getElementById('repair-form');
                if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 350);
        }
    }, true); // ← capture:true — перехватываем ДО того, как сработает onclick

    console.log('✅ entry-module v1.0.3 загружен (перехват кликов через capture)');

    // ============================================
    // Дополнительно: перехват openEntryTab и editRecord
    // ============================================
    let patchAttempts = 0;
    function tryPatch() {
        patchAttempts++;
        if (typeof window.openEntryTab === 'function' && !window.openEntryTab.__patched) {
            const w = function() { openEntryModal(); };
            w.__patched = true;
            window.openEntryTab = w;
        }
        if (typeof window.editRecord === 'function' && !window.editRecord.__patched) {
            const w = function(id) { openEntryModal(id); };
            w.__patched = true;
            window.editRecord = w;
        }
        if (typeof window.switchTab === 'function' && !window.switchTab.__entryPatched) {
            const orig = window.switchTab;
            const w = function(tabName) {
                if (isModalOpen) closeEntryModal();
                return orig.apply(this, arguments);
            };
            w.__entryPatched = true;
            window.switchTab = w;
        }
        if (patchAttempts >= 50) return true;
        const ok = window.openEntryTab?.__patched && window.editRecord?.__patched;
        return !!ok;
    }
    if (!tryPatch()) {
        const t = setInterval(() => { if (tryPatch()) clearInterval(t); }, 100);
    }
    window.addEventListener('load', tryPatch);
})();