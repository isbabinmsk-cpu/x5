// =============================================
// МОДУЛЬ УЧЁТА РЕМОНТА АВТО (repair-module.js) v7.0
// =============================================
// Экономная версия (без onSnapshot).
// Чтение из Firebase происходит только 1 раз при запуске.
// =============================================
(function () {
    'use strict';

    const COLLECTION_REPAIR = 'repair_records';
    const REPAIR_STORAGE_KEY = 'repair_records';

    let repairRecords = [];
    let editingRepairId = null;
    let editingRepairModalId = null;
    let repairChart = null;
    let repairTrendChart = null;
    let currentRepairUserUid = null;

    // Фото в старой форме на вкладке
    let repairPhotos = { receipt: null, document: null };
    let existingPhotos = { receipt: null, document: null };

    // Фото в модалке ремонта
    let repairModalPhotos = { receipt: null, document: null };
    let repairModalExistingPhotos = { receipt: null, document: null };

    // Просмотрщик фото
    let photoViewerState = { photos: [], currentIndex: 0 };
    let photoClickTimer = null;

    // ============================================
    // УТИЛИТЫ
    // ============================================
    function toast(msg) {
        if (typeof window.showToast === 'function') {
            try { window.showToast(msg); return; } catch (e) {}
        }
        console.log('🔔', msg);
    }

    function fmtMoney(n) {
        if (typeof window.formatMoney === 'function') return window.formatMoney(n);
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(Number(n) || 0);
    }

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function parseDate(s) {
        if (typeof window.parseLocalDate === 'function') return window.parseLocalDate(s);
        if (!s) return null;
        const p = String(s).split('-');
        return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : new Date(s);
    }

    function getVId() {
        return typeof window.getCurrentVehicleId === 'function' ? window.getCurrentVehicleId() : 'default';
    }

    function getAllVehicles() {
        return typeof window.getVehicles === 'function' ? window.getVehicles() : [];
    }

    function isFirebaseReady() {
        return typeof window.db !== 'undefined' && window.db
            && typeof window.auth !== 'undefined' && window.auth && window.auth.currentUser;
    }

    function persistLocal() {
        try {
            localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
        } catch (e) {
            console.warn('⚠️ Не удалось сохранить ремонты локально:', e.message);
        }
    }

    function genId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'repair_' + crypto.randomUUID();
        return 'repair_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
    }

    function deepClone(obj) {
        try { return JSON.parse(JSON.stringify(obj)); }
        catch (e) { return { ...obj }; }
    }

    // ============================================
    // КАТЕГОРИИ
    // ============================================
    function getCategoryLabel(category) {
        const labels = {
            engine: 'Двигатель', transmission: 'Трансмиссия',
            brakes: 'Тормозная система', suspension: 'Подвеска',
            electrics: 'Электрика', body: 'Кузов',
            tires: 'Шины/Диски', oil: 'Масло/Жидкости',
            cooling: 'Охлаждение', exhaust: 'Выхлопная система',
            other: 'Прочее'
        };
        return labels[category] || category || 'Другое';
    }
    function getCategoryIcon(category) {
        const icons = {
            engine: 'cog-outline', transmission: 'settings-outline',
            brakes: 'alert-circle-outline', suspension: 'bicycle-outline',
            electrics: 'flash-outline', body: 'car-outline',
            tires: 'disc-outline', oil: 'water-outline',
            cooling: 'thermometer-outline', exhaust: 'leaf-outline',
            other: 'construct-outline'
        };
        return icons[category] || 'construct-outline';
    }
    function getCategoryColor(category) {
        const colors = {
            engine: '#FF3B30', transmission: '#FF9500',
            brakes: '#FF2D55', suspension: '#AF52DE',
            electrics: '#007AFF', body: '#34C759',
            tires: '#5856D6', oil: '#5AC8FA',
            cooling: '#64D2FF', exhaust: '#8E8E93',
            other: '#636366'
        };
        return colors[category] || '#636366';
    }

    // ============================================
    // СЖАТИЕ ФОТО
    // ============================================
    function calculatePhotoBudget() {
        const hasReceipt = !!(repairPhotos.receipt || repairModalPhotos.receipt);
        const hasDocument = !!(repairPhotos.document || repairModalPhotos.document);
        const total = (hasReceipt ? 1 : 0) + (hasDocument ? 1 : 0);
        const BUDGET = 990;
        if (total === 0) return 0;
        if (total === 1) return BUDGET - 30;
        return Math.floor((BUDGET - 30) / total);
    }

    async function compressImageForUpload(file, maxWidth = 1400, initialQuality = 0.85) {
        try {
            let bitmap;
            try {
                bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch (e) {
                bitmap = await createImageBitmap(file);
            }
            let width = bitmap.width;
            let height = bitmap.height;
            if (width > maxWidth) {
                height = Math.round(height * maxWidth / width);
                width = maxWidth;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, width, height);
            if (bitmap.close) bitmap.close();

            const budgetKB = calculatePhotoBudget() || 800;
            let quality = initialQuality;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);
            const maxSize = budgetKB * 1024;

            while (dataUrl.length > maxSize && quality > 0.3) {
                quality -= 0.05;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            if (dataUrl.length > maxSize) {
                const scale = Math.sqrt(maxSize / dataUrl.length) * 0.95;
                canvas.width = Math.round(width * scale);
                canvas.height = Math.round(height * scale);
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            }
            return dataUrl;
        } catch (error) {
            console.error('❌ Ошибка сжатия, fallback:', error);
            return compressImageFallback(file, maxWidth, initialQuality);
        }
    }

    function compressImageFallback(file, maxWidth, initialQuality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    if (width > maxWidth) {
                        height = Math.round(height * maxWidth / width);
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);

                    const budgetKB = calculatePhotoBudget() || 800;
                    let quality = initialQuality;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    const maxSize = budgetKB * 1024;
                    while (dataUrl.length > maxSize && quality > 0.3) {
                        quality -= 0.05;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(dataUrl);
                };
                img.onerror = reject;
                img.src = event.target.result;
            };
            reader.onerror = reject;
        });
    }

    // ============================================
    // ФОТО (СТАРАЯ ФОРМА НА ВКЛАДКЕ)
    // ============================================
    function handlePhotoSelect(event, photoType) {
        const file = event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast('❌ Пожалуйста, выберите изображение'); return; }
        if (file.size > 5 * 1024 * 1024) { toast('❌ Файл больше 5MB'); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            repairPhotos[photoType] = { file: file, preview: e.target.result };
            updatePhotoPreview(photoType);
        };
        reader.readAsDataURL(file);
    }

    function updatePhotoPreview(photoType) {
        const previewEl = document.getElementById(`repair-${photoType}-preview`);
        const rotateControls = document.getElementById(`repair-${photoType}-rotate`);
        if (!previewEl) return;
        const photoData = repairPhotos[photoType];
        const existingUrl = existingPhotos[photoType];
        let hasPhoto = false;

        if (photoData && photoData.preview) {
            previewEl.innerHTML = `<img src="${photoData.preview}" alt="Preview"><button type="button" class="remove-photo-btn" onclick="removePhoto('${photoType}')"><ion-icon name="close-outline"></ion-icon></button>`;
            previewEl.classList.add('has-image');
            hasPhoto = true;
        } else if (existingUrl) {
            previewEl.innerHTML = `<img src="${existingUrl}" alt="Existing"><button type="button" class="remove-photo-btn" onclick="removePhoto('${photoType}')"><ion-icon name="close-outline"></ion-icon></button>`;
            previewEl.classList.add('has-image');
            hasPhoto = true;
        } else {
            previewEl.innerHTML = `<ion-icon name="image-outline"></ion-icon><span>Нет фото</span>`;
            previewEl.classList.remove('has-image');
        }
        if (rotateControls) rotateControls.style.display = hasPhoto ? 'flex' : 'none';
    }

    function removePhoto(photoType) {
        repairPhotos[photoType] = null;
        existingPhotos[photoType] = null;
        updatePhotoPreview(photoType);
        const inputEl = document.getElementById(`repair-${photoType}-upload`);
        if (inputEl) inputEl.value = '';
    }

    function rotatePhoto(photoType, degrees) {
        const photoData = repairPhotos[photoType];
        const existingUrl = existingPhotos[photoType];
        let sourceDataUrl = null;
        let isNewPhoto = false;

        if (photoData && photoData.preview) { sourceDataUrl = photoData.preview; isNewPhoto = true; }
        else if (existingUrl) { sourceDataUrl = existingUrl; isNewPhoto = false; }
        else return;

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (degrees === 90 || degrees === -90) { canvas.width = img.height; canvas.height = img.width; }
            else { canvas.width = img.width; canvas.height = img.height; }
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(degrees * Math.PI / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
            const rotated = canvas.toDataURL('image/jpeg', 0.92);

            if (isNewPhoto) {
                photoData.preview = rotated;
                fetch(rotated).then(r => r.blob()).then(blob => {
                    photoData.file = new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    updatePhotoPreview(photoType);
                    toast('Фото повёрнуто');
                });
            } else {
                fetch(rotated).then(r => r.blob()).then(blob => {
                    repairPhotos[photoType] = { file: new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' }), preview: rotated };
                    updatePhotoPreview(photoType);
                    toast('Фото повёрнуто');
                });
            }
        };
        img.onerror = () => toast('❌ Не удалось повернуть фото');
        img.src = sourceDataUrl;
    }

    async function uploadPhotoToStorage(file) {
        try {
            return await compressImageForUpload(file);
        } catch (e) {
            console.error('❌ Ошибка сжатия фото:', e);
            return null;
        }
    }

    // ============================================
    // ФОТО (МОДАЛКА)
    // ============================================
    function handleRepairModalPhotoSelect(event, photoType) {
        const file = event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast('❌ Выберите изображение'); return; }
        if (file.size > 5 * 1024 * 1024) { toast('❌ Файл больше 5MB'); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            repairModalPhotos[photoType] = { file: file, preview: e.target.result };
            updateRepairModalPhotoPreview(photoType);
        };
        reader.readAsDataURL(file);
    }

    function updateRepairModalPhotoPreview(photoType) {
        const previewEl = document.getElementById(`repair-modal-${photoType}-preview`);
        const rotateControls = document.getElementById(`repair-modal-${photoType}-rotate`);
        if (!previewEl) return;
        const photoData = repairModalPhotos[photoType];
        const existingUrl = repairModalExistingPhotos[photoType];
        let hasPhoto = false;

        if (photoData && photoData.preview) {
            previewEl.innerHTML = `<img src="${photoData.preview}" alt="Preview"><button type="button" class="remove-photo-btn" onclick="removeRepairModalPhoto('${photoType}')"><ion-icon name="close-outline"></ion-icon></button>`;
            previewEl.classList.add('has-image');
            hasPhoto = true;
        } else if (existingUrl) {
            previewEl.innerHTML = `<img src="${existingUrl}" alt="Existing"><button type="button" class="remove-photo-btn" onclick="removeRepairModalPhoto('${photoType}')"><ion-icon name="close-outline"></ion-icon></button>`;
            previewEl.classList.add('has-image');
            hasPhoto = true;
        } else {
            previewEl.innerHTML = `<ion-icon name="image-outline"></ion-icon><span>Нет фото</span>`;
            previewEl.classList.remove('has-image');
        }
        if (rotateControls) rotateControls.style.display = hasPhoto ? 'flex' : 'none';
    }

    function removeRepairModalPhoto(photoType) {
        repairModalPhotos[photoType] = null;
        repairModalExistingPhotos[photoType] = null;
        updateRepairModalPhotoPreview(photoType);
        const inputEl = document.getElementById(`repair-modal-${photoType}-upload`);
        if (inputEl) inputEl.value = '';
    }

    function rotateRepairModalPhoto(photoType, degrees) {
        const photoData = repairModalPhotos[photoType];
        const existingUrl = repairModalExistingPhotos[photoType];
        let sourceDataUrl = null;
        let isNew = false;

        if (photoData && photoData.preview) { sourceDataUrl = photoData.preview; isNew = true; }
        else if (existingUrl) { sourceDataUrl = existingUrl; isNew = false; }
        else return;

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (degrees === 90 || degrees === -90) { canvas.width = img.height; canvas.height = img.width; }
            else { canvas.width = img.width; canvas.height = img.height; }
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(degrees * Math.PI / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
            const rotated = canvas.toDataURL('image/jpeg', 0.92);

            if (isNew) {
                photoData.preview = rotated;
                fetch(rotated).then(r => r.blob()).then(blob => {
                    photoData.file = new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    updateRepairModalPhotoPreview(photoType);
                    toast('Фото повёрнуто');
                });
            } else {
                fetch(rotated).then(r => r.blob()).then(blob => {
                    repairModalPhotos[photoType] = { file: new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' }), preview: rotated };
                    updateRepairModalPhotoPreview(photoType);
                    toast('Фото повёрнуто');
                });
            }
        };
        img.onerror = () => toast('❌ Не удалось повернуть фото');
        img.src = sourceDataUrl;
    }

    async function uploadRepairModalPhoto(photoType) {
        const photoData = repairModalPhotos[photoType];
        if (!photoData || !photoData.file) return repairModalExistingPhotos[photoType] || null;
        try {
            return await compressImageForUpload(photoData.file);
        } catch (e) {
            console.error(`❌ Ошибка сжатия ${photoType}:`, e);
            return repairModalExistingPhotos[photoType] || null;
        }
    }

    // ============================================
    // МОДАЛКА РЕМОНТА
    // ============================================
    function populateRepairModalVehicleSelect() {
        const select = document.getElementById('repair-modal-vehicle-select');
        if (!select) return;
        select.innerHTML = '';
        const list = getAllVehicles();
        if (list && list.length > 0) {
            list.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.name || `${v.brand || ''} ${v.model || ''}`.trim() || 'Автомобиль';
                select.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = 'default';
            opt.textContent = 'Автомобиль по умолчанию';
            select.appendChild(opt);
        }
        select.value = getVId();
    }

    function openRepairModal(editId) {
        const overlay = document.getElementById('repair-modal-overlay');
        if (!overlay) { console.error('❌ #repair-modal-overlay не найден'); return; }

        editingRepairModalId = editId || null;

        if (editId) {
            fillRepairModalFromRecord(editId);
            const t = document.getElementById('repair-modal-title-text');
            if (t) t.textContent = 'Редактировать ремонт';
            const s = document.getElementById('repair-modal-submit-text');
            if (s) s.textContent = 'Обновить ремонт';
        } else {
            resetRepairModalForm();
            const t = document.getElementById('repair-modal-title-text');
            if (t) t.textContent = 'Добавить ремонт';
            const s = document.getElementById('repair-modal-submit-text');
            if (s) s.textContent = 'Сохранить';
        }

        populateRepairModalVehicleSelect();
        overlay.style.display = 'flex';
        requestAnimationFrame(() => overlay.classList.add('visible'));
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            const dateEl = document.getElementById('repair-modal-date');
            if (dateEl && !dateEl.value) dateEl.valueAsDate = new Date();
        }, 100);

        calculateRepairModalTotal();
    }

    function closeRepairModal() {
        const overlay = document.getElementById('repair-modal-overlay');
        if (!overlay) return;
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.style.display = 'none'; resetRepairModalForm(); }, 300);
        document.body.style.overflow = '';
        editingRepairModalId = null;
    }

    function resetRepairModalForm() {
        const form = document.getElementById('repair-modal-form');
        if (form) form.reset();
        const dateEl = document.getElementById('repair-modal-date');
        if (dateEl) dateEl.valueAsDate = new Date();

        const partsList = document.getElementById('repair-modal-parts-list');
        if (partsList) partsList.innerHTML = '';
        const worksList = document.getElementById('repair-modal-works-list');
        if (worksList) worksList.innerHTML = '';

        addRepairModalPart();
        addRepairModalWork();
        calculateRepairModalTotal();
        editingRepairModalId = null;

        repairModalPhotos = { receipt: null, document: null };
        repairModalExistingPhotos = { receipt: null, document: null };
        updateRepairModalPhotoPreview('receipt');
        updateRepairModalPhotoPreview('document');
        const r = document.getElementById('repair-modal-receipt-upload');
        const d = document.getElementById('repair-modal-document-upload');
        if (r) r.value = '';
        if (d) d.value = '';
    }

    function fillRepairModalFromRecord(id) {
        const rec = repairRecords.find(r => r.id === id);
        if (!rec) return;

        const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val != null ? val : ''; };
        set('repair-modal-date', rec.date);
        set('repair-modal-mileage', rec.mileage);
        set('repair-modal-category', rec.category);
        set('repair-modal-description', rec.description || '');
        set('repair-modal-comment', rec.comment || '');

        const v = document.getElementById('repair-modal-vehicle-select');
        if (v) v.value = rec.vehicleId || 'default';

        const partsList = document.getElementById('repair-modal-parts-list');
        if (partsList) {
            partsList.innerHTML = '';
            (rec.parts || []).forEach(p => {
                const item = document.createElement('div');
                item.className = 'dynamic-item';
                item.innerHTML = `<input type="text" class="repair-modal-part-name" placeholder="Название" value="${esc(p.name)}">
                    <input type="number" class="repair-modal-part-cost" placeholder="Стоимость" step="0.01" min="0" value="${p.cost || 0}">
                    <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairModalTotal();"><ion-icon name="trash-outline"></ion-icon></button>`;
                partsList.appendChild(item);
            });
        }

        const worksList = document.getElementById('repair-modal-works-list');
        if (worksList) {
            worksList.innerHTML = '';
            (rec.works || []).forEach(w => {
                const item = document.createElement('div');
                item.className = 'dynamic-item';
                item.innerHTML = `<input type="text" class="repair-modal-work-name" placeholder="Название" value="${esc(w.name)}">
                    <input type="number" class="repair-modal-work-cost" placeholder="Стоимость" step="0.01" min="0" value="${w.cost || 0}">
                    <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairModalTotal();"><ion-icon name="trash-outline"></ion-icon></button>`;
                worksList.appendChild(item);
            });
        }

        repairModalPhotos = { receipt: null, document: null };
        repairModalExistingPhotos = {
            receipt: rec.receiptPhotoUrl || null,
            document: rec.documentPhotoUrl || null
        };
        updateRepairModalPhotoPreview('receipt');
        updateRepairModalPhotoPreview('document');

        const r = document.getElementById('repair-modal-receipt-upload');
        const d = document.getElementById('repair-modal-document-upload');
        if (r) r.value = '';
        if (d) d.value = '';
    }

    function addRepairModalPart() {
        const c = document.getElementById('repair-modal-parts-list');
        if (!c) return;
        const item = document.createElement('div');
        item.className = 'dynamic-item';
        item.innerHTML = `<input type="text" class="repair-modal-part-name" placeholder="Название детали">
            <input type="number" class="repair-modal-part-cost" placeholder="Стоимость" step="0.01" min="0">
            <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairModalTotal();"><ion-icon name="trash-outline"></ion-icon></button>`;
        c.appendChild(item);
        calculateRepairModalTotal();
    }

    function addRepairModalWork() {
        const c = document.getElementById('repair-modal-works-list');
        if (!c) return;
        const item = document.createElement('div');
        item.className = 'dynamic-item';
        item.innerHTML = `<input type="text" class="repair-modal-work-name" placeholder="Название работы">
            <input type="number" class="repair-modal-work-cost" placeholder="Стоимость" step="0.01" min="0">
            <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairModalTotal();"><ion-icon name="trash-outline"></ion-icon></button>`;
        c.appendChild(item);
        calculateRepairModalTotal();
    }

    function calculateRepairModalTotal() {
        let pT = 0, wT = 0;
        document.querySelectorAll('.repair-modal-part-cost').forEach(el => { pT += parseFloat(el.value) || 0; });
        document.querySelectorAll('.repair-modal-work-cost').forEach(el => { wT += parseFloat(el.value) || 0; });
        const total = pT + wT;
        const el1 = document.getElementById('repair-modal-parts-total');
        const el2 = document.getElementById('repair-modal-works-total');
        const el3 = document.getElementById('repair-modal-total-cost');
        if (el1) el1.textContent = fmtMoney(pT);
        if (el2) el2.textContent = fmtMoney(wT);
        if (el3) el3.textContent = fmtMoney(total);
    }

    function clearRepairModalForm() {
        const form = document.getElementById('repair-modal-form');
        if (form) form.reset();
        const dateEl = document.getElementById('repair-modal-date');
        if (dateEl) dateEl.valueAsDate = new Date();

        const partsList = document.getElementById('repair-modal-parts-list');
        if (partsList) partsList.innerHTML = '';
        const worksList = document.getElementById('repair-modal-works-list');
        if (worksList) worksList.innerHTML = '';

        addRepairModalPart();
        addRepairModalWork();
        calculateRepairModalTotal();

        const s = document.getElementById('repair-modal-submit-text');
        if (s) s.textContent = 'Сохранить';
        const t = document.getElementById('repair-modal-title-text');
        if (t) t.textContent = 'Добавить ремонт';
        editingRepairModalId = null;

        repairModalPhotos = { receipt: null, document: null };
        repairModalExistingPhotos = { receipt: null, document: null };
        updateRepairModalPhotoPreview('receipt');
        updateRepairModalPhotoPreview('document');
        const r = document.getElementById('repair-modal-receipt-upload');
        const d = document.getElementById('repair-modal-document-upload');
        if (r) r.value = '';
        if (d) d.value = '';

        toast('🗑️ Форма очищена');
    }

    // ============================================
    // СОХРАНЕНИЕ / УДАЛЕНИЕ
    // ============================================
    async function syncRepairToFirebase(record) {
        if (!isFirebaseReady()) return false;
        try {
            const payload = deepClone(record);
            delete payload.id;
            await window.db.collection('users').doc(window.auth.currentUser.uid)
                .collection(COLLECTION_REPAIR).doc(record.id).set({
                    ...payload,
                    userId: window.auth.currentUser.uid,
                    updatedAt: new Date().toISOString()
                });
            if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
            return true;
        } catch (error) {
            console.error('❌ Ошибка сохранения ремонта в Firebase:', error);
            if (error.message && error.message.includes('maximum size')) {
                toast('❌ Документ слишком большой. Уменьшите фото.');
            }
            return false;
        }
    }

    async function deleteRepairFromFirebase(id) {
        if (!isFirebaseReady()) return false;
        try {
            await window.db.collection('users').doc(window.auth.currentUser.uid)
                .collection(COLLECTION_REPAIR).doc(id).delete();
            if (typeof window.remindersMarkAsSynced === 'function') window.remindersMarkAsSynced();
            return true;
        } catch (error) {
            console.error('❌ Ошибка удаления ремонта из Firebase:', error);
            return false;
        }
    }

    async function submitRepairModal() {
        const date = document.getElementById('repair-modal-date')?.value;
        const mileage = parseInt(document.getElementById('repair-modal-mileage')?.value);
        const category = document.getElementById('repair-modal-category')?.value;
        const description = document.getElementById('repair-modal-description')?.value.trim();
        const comment = document.getElementById('repair-modal-comment')?.value.trim();
        const vehicleSelect = document.getElementById('repair-modal-vehicle-select');
        const vehicleId = vehicleSelect ? vehicleSelect.value : 'default';

        if (!date || !mileage || mileage <= 0 || !category) {
            toast('⚠️ Заполните дату, пробег и категорию');
            return;
        }

        toast('⏳ Обработка фото...');
        let receiptUrl = repairModalExistingPhotos.receipt || null;
        let documentUrl = repairModalExistingPhotos.document || null;
        if (repairModalPhotos.receipt) {
            const u = await uploadRepairModalPhoto('receipt');
            if (u) receiptUrl = u;
        }
        if (repairModalPhotos.document) {
            const u = await uploadRepairModalPhoto('document');
            if (u) documentUrl = u;
        }
        toast('⏳ Сохранение...');

        const parts = [];
        document.querySelectorAll('#repair-modal-parts-list .dynamic-item').forEach(item => {
            const name = item.querySelector('.repair-modal-part-name')?.value?.trim();
            const cost = parseFloat(item.querySelector('.repair-modal-part-cost')?.value) || 0;
            if (name) parts.push({ name, cost });
        });
        const works = [];
        document.querySelectorAll('#repair-modal-works-list .dynamic-item').forEach(item => {
            const name = item.querySelector('.repair-modal-work-name')?.value?.trim();
            const cost = parseFloat(item.querySelector('.repair-modal-work-cost')?.value) || 0;
            if (name) works.push({ name, cost });
        });
        const partsTotal = parts.reduce((s, p) => s + p.cost, 0);
        const worksTotal = works.reduce((s, w) => s + w.cost, 0);
        const total = partsTotal + worksTotal;

        try {
            const data = {
                date, mileage, category,
                description: description || getCategoryLabel(category),
                comment: comment || '',
                parts, works, partsTotal, worksTotal, total,
                vehicleId,
                receiptPhotoUrl: receiptUrl,
                documentPhotoUrl: documentUrl,
                updatedAt: new Date().toISOString()
            };

            if (editingRepairModalId) {
                const idx = repairRecords.findIndex(r => r.id === editingRepairModalId);
                if (idx !== -1) {
                    repairRecords[idx] = { ...repairRecords[idx], ...data };
                    await syncRepairToFirebase(repairRecords[idx]);
                }
            } else {
                const newRecord = {
                    id: genId(),
                    userId: window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null,
                    ...data,
                    createdAt: new Date().toISOString()
                };
                repairRecords.push(newRecord);
                await syncRepairToFirebase(newRecord);
            }

            persistLocal();
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
            await syncRepairToMainRecords();

            toast(editingRepairModalId ? '✅ Ремонт обновлён' : '✅ Ремонт добавлен');
            closeRepairModal();
        } catch (error) {
            console.error('❌ Ошибка сохранения:', error);
            toast('❌ Не удалось сохранить ремонт');
        }
    }

    async function deleteRepairRecord(id) {
        if (!confirm('Удалить эту запись о ремонте?')) return;
        toast('⏳ Удаление...');
        try {
            repairRecords = repairRecords.filter(r => r.id !== id);
            persistLocal();
            await deleteRepairFromFirebase(id);
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
            await syncRepairToMainRecords();
            toast('✅ Запись удалена');
        } catch (error) {
            console.error('❌ Ошибка удаления:', error);
            toast('❌ Не удалось удалить запись');
        }
    }

    // ============================================
    // СТАРАЯ ФОРМА НА ВКЛАДКЕ
    // ============================================
    function addRepairPart() {
        const c = document.getElementById('repair-parts-list');
        if (!c) return;
        const item = document.createElement('div');
        item.className = 'dynamic-item';
        item.innerHTML = `<input type="text" class="repair-part-name" placeholder="Название детали">
            <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0">
            <button type="button" class="btn-remove" data-action="remove-part"><ion-icon name="trash-outline"></ion-icon></button>`;
        c.appendChild(item);
        calculateRepairTotal();
    }

    function addRepairWork() {
        const c = document.getElementById('repair-works-list');
        if (!c) return;
        const item = document.createElement('div');
        item.className = 'dynamic-item';
        item.innerHTML = `<input type="text" class="repair-work-name" placeholder="Название работы">
            <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0">
            <button type="button" class="btn-remove" data-action="remove-work"><ion-icon name="trash-outline"></ion-icon></button>`;
        c.appendChild(item);
        calculateRepairTotal();
    }

    function setupDynamicListDelegation() {
        const p = document.getElementById('repair-parts-list');
        const w = document.getElementById('repair-works-list');
        const handler = (e) => {
            if (e.target.closest('[data-action^="remove-"]')) {
                const it = e.target.closest('.dynamic-item');
                if (it) { it.remove(); calculateRepairTotal(); }
                return;
            }
            if (e.target.classList.contains('repair-part-cost') || e.target.classList.contains('repair-work-cost')) {
                calculateRepairTotal();
            }
        };
        [p, w].forEach(c => {
            if (!c || c._delegationBound) return;
            c._delegationBound = true;
            c.addEventListener('input', handler);
            c.addEventListener('click', handler);
        });
    }

    function calculateRepairTotal() {
        let pT = 0, wT = 0;
        document.querySelectorAll('.repair-part-cost').forEach(el => { pT += parseFloat(el.value) || 0; });
        document.querySelectorAll('.repair-work-cost').forEach(el => { wT += parseFloat(el.value) || 0; });
        const total = pT + wT;
        const e1 = document.getElementById('repair-parts-total');
        const e2 = document.getElementById('repair-works-total');
        const e3 = document.getElementById('repair-total-cost');
        if (e1) e1.textContent = fmtMoney(pT);
        if (e2) e2.textContent = fmtMoney(wT);
        if (e3) e3.textContent = fmtMoney(total);
    }

    async function handleRepairSubmit(e) {
        if (e) e.preventDefault();
        toast('⏳ Сохранение ремонта...');

        const date = document.getElementById('repair-date')?.value;
        const mileage = parseInt(document.getElementById('repair-mileage')?.value);
        const category = document.getElementById('repair-category')?.value;
        const description = document.getElementById('repair-description')?.value.trim();
        const comment = document.getElementById('repair-comment')?.value.trim();
        const vehicleId = document.getElementById('repair-vehicle-select')?.value || 'default';
        const isEditing = !!editingRepairId;

        if (!date || !mileage || mileage <= 0 || !category) {
            toast('⚠️ Заполните дату, пробег и категорию');
            return;
        }

        const parts = [];
        document.querySelectorAll('#repair-parts-list .dynamic-item').forEach(item => {
            const name = item.querySelector('.repair-part-name')?.value?.trim();
            const cost = parseFloat(item.querySelector('.repair-part-cost')?.value) || 0;
            if (name) parts.push({ name, cost });
        });
        const works = [];
        document.querySelectorAll('#repair-works-list .dynamic-item').forEach(item => {
            const name = item.querySelector('.repair-work-name')?.value?.trim();
            const cost = parseFloat(item.querySelector('.repair-work-cost')?.value) || 0;
            if (name) works.push({ name, cost });
        });
        const pT = parts.reduce((s, p) => s + p.cost, 0);
        const wT = works.reduce((s, w) => s + w.cost, 0);
        const total = pT + wT;

        const serviceItems = [];
        document.querySelectorAll('#repair-service-items input[type="checkbox"]:checked').forEach(cb => {
            serviceItems.push(cb.value);
        });

        let receiptUrl = existingPhotos.receipt;
        let documentUrl = existingPhotos.document;
        const recordId = isEditing ? editingRepairId : genId();

        if (repairPhotos.receipt) {
            const u = await uploadPhotoToStorage(repairPhotos.receipt.file);
            if (u) receiptUrl = u;
        }
        if (repairPhotos.document) {
            const u = await uploadPhotoToStorage(repairPhotos.document.file);
            if (u) documentUrl = u;
        }

        const data = {
            date, mileage, category,
            description: description || getCategoryLabel(category),
            comment: comment || '',
            parts, works, partsTotal: pT, worksTotal: wT, total, serviceItems,
            receiptPhotoUrl: receiptUrl || null,
            documentPhotoUrl: documentUrl || null,
            updatedAt: new Date().toISOString()
        };

        try {
            if (isEditing) {
                const idx = repairRecords.findIndex(r => r.id === editingRepairId);
                if (idx !== -1) {
                    repairRecords[idx] = { ...repairRecords[idx], ...data, vehicleId };
                    await syncRepairToFirebase(repairRecords[idx]);
                }
            } else {
                const newRecord = {
                    id: recordId,
                    vehicleId,
                    userId: window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null,
                    ...data,
                    createdAt: new Date().toISOString()
                };
                repairRecords.push(newRecord);
                await syncRepairToFirebase(newRecord);
            }

            persistLocal();
            clearRepairForm();
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
            await syncRepairToMainRecords();

            toast(isEditing ? '✅ Ремонт обновлён' : '✅ Ремонт добавлен');
        } catch (error) {
            console.error('❌ Ошибка сохранения:', error);
            toast('❌ Не удалось сохранить ремонт');
        }
    }

    function editRepairRecordTab(id) {
        const rec = repairRecords.find(r => r.id === id);
        if (!rec) return;
        editingRepairId = id;

        const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val != null ? val : ''; };
        set('repair-date', rec.date);
        set('repair-mileage', rec.mileage);
        set('repair-category', rec.category);
        set('repair-description', rec.description || '');
        set('repair-comment', rec.comment || '');

        const v = document.getElementById('repair-vehicle-select');
        if (v) v.value = rec.vehicleId || 'default';

        const serviceItems = rec.serviceItems || [];
        document.querySelectorAll('#repair-service-items input[type="checkbox"]').forEach(cb => {
            cb.checked = serviceItems.includes(cb.value);
        });

        const pC = document.getElementById('repair-parts-list');
        if (pC) {
            pC.innerHTML = '';
            (rec.parts || []).forEach(p => {
                const item = document.createElement('div');
                item.className = 'dynamic-item';
                item.innerHTML = `<input type="text" class="repair-part-name" value="${esc(p.name)}"><input type="number" class="repair-part-cost" step="0.01" min="0" value="${p.cost}"><button type="button" class="btn-remove" data-action="remove-part"><ion-icon name="trash-outline"></ion-icon></button>`;
                pC.appendChild(item);
            });
        }
        const wC = document.getElementById('repair-works-list');
        if (wC) {
            wC.innerHTML = '';
            (rec.works || []).forEach(w => {
                const item = document.createElement('div');
                item.className = 'dynamic-item';
                item.innerHTML = `<input type="text" class="repair-work-name" value="${esc(w.name)}"><input type="number" class="repair-work-cost" step="0.01" min="0" value="${w.cost}"><button type="button" class="btn-remove" data-action="remove-work"><ion-icon name="trash-outline"></ion-icon></button>`;
                wC.appendChild(item);
            });
        }

        existingPhotos.receipt = rec.receiptPhotoUrl || null;
        existingPhotos.document = rec.documentPhotoUrl || null;
        repairPhotos.receipt = null;
        repairPhotos.document = null;

        const r = document.getElementById('repair-receipt-upload');
        const d = document.getElementById('repair-document-upload');
        if (r) r.value = '';
        if (d) d.value = '';

        updatePhotoPreview('receipt');
        updatePhotoPreview('document');
        calculateRepairTotal();

        const s = document.querySelector('#repair-form button[type="submit"]');
        if (s) {
            s.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Обновить ремонт';
            s.classList.remove('btn-success');
            s.classList.add('btn-primary');
        }
        const form = document.getElementById('repair-form');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('✏️ Редактирование ремонта');
    }

    function clearRepairForm() {
        const today = new Date().toISOString().split('T')[0];
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('repair-date', today);
        set('repair-mileage', '');
        set('repair-category', 'engine');
        set('repair-description', '');
        set('repair-comment', '');
        document.querySelectorAll('#repair-service-items input[type="checkbox"]').forEach(cb => cb.checked = false);

        const pC = document.getElementById('repair-parts-list');
        if (pC) pC.innerHTML = '';
        const wC = document.getElementById('repair-works-list');
        if (wC) wC.innerHTML = '';

        addRepairPart();
        addRepairWork();
        calculateRepairTotal();

        repairPhotos.receipt = null;
        repairPhotos.document = null;
        existingPhotos.receipt = null;
        existingPhotos.document = null;
        const r = document.getElementById('repair-receipt-upload');
        const d = document.getElementById('repair-document-upload');
        if (r) r.value = '';
        if (d) d.value = '';
        updatePhotoPreview('receipt');
        updatePhotoPreview('document');

        editingRepairId = null;
        const s = document.querySelector('#repair-form button[type="submit"]');
        if (s) {
            s.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить';
            s.classList.remove('btn-primary');
            s.classList.add('btn-success');
        }
    }

    // ============================================
    // ЗАГРУЗКА (ОДНОРАЗОВАЯ, БЕЗ onSnapshot)
    // ============================================
    let isRepairLoaded = false; // ⭐ ДОБАВИТЬ В САМОЕ НАЧАЛО IIFE

async function loadRepairRecords(force = false) { // ⭐ добавили force
    try {
        const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
        if (saved) {
            try { repairRecords = JSON.parse(saved); } catch (e) { repairRecords = []; }
        }
        
        // ⭐ ЗАЩИТА
        if (isRepairLoaded && !force) {
            console.log('ℹ️ Ремонты уже в памяти, пропускаем Firebase');
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
            return;
        }
        
        if (isFirebaseReady()) {
            console.log('☁️ Загрузка ремонтов из Firebase (1 раз)...');
            const snap = await window.db.collection('users').doc(window.auth.currentUser.uid)
                .collection(COLLECTION_REPAIR)
                .orderBy('date', 'desc')
                .get();
            
            if (!snap.empty) {
                const fb = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                fb.sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
                repairRecords = fb;
                persistLocal();
                console.log('✅ Ремонты загружены из Firebase:', repairRecords.length);
            }
            isRepairLoaded = true; // ⭐ ставим флаг
        }
        
        renderRepairList();
        updateRepairStats();
        updateRepairCharts();
        await syncRepairToMainRecords();
    } catch (error) {
        console.error('❌ Ошибка загрузки ремонтов:', error);
        renderRepairList();
        updateRepairStats();
        updateRepairCharts();
    }
}

    // ============================================
    // ФИЛЬТРАЦИЯ / РЕНДЕР
    // ============================================
    function getFilteredRepairs() {
        const period = document.getElementById('repair-filter-period')?.value || 'all';
        const category = document.getElementById('repair-filter-category')?.value || 'all';
        const search = (document.getElementById('repair-filter-search')?.value || '').toLowerCase();
        const vId = getVId();

        let list = repairRecords.filter(r => (r.vehicleId || 'default') === vId);

        if (period !== 'all') {
            const now = new Date();
            const cutoff = new Date();
            if (period === 'month') cutoff.setMonth(now.getMonth() - 1);
            else if (period === '3months') cutoff.setMonth(now.getMonth() - 3);
            else if (period === 'year') cutoff.setFullYear(now.getFullYear() - 1);
            list = list.filter(r => { const d = parseDate(r.date); return d && d >= cutoff; });
        }
        if (category !== 'all') list = list.filter(r => r.category === category);
        if (search) {
            list = list.filter(r =>
                (r.description || '').toLowerCase().includes(search) ||
                (r.comment || '').toLowerCase().includes(search) ||
                (r.parts || []).some(p => (p.name || '').toLowerCase().includes(search)) ||
                (r.works || []).some(w => (w.name || '').toLowerCase().includes(search))
            );
        }
        return list.sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
    }

    function renderRepairList() {
        const container = document.getElementById('repair-list');
        if (!container) return;
        const filtered = getFilteredRepairs();

        if (filtered.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-tertiary,#86868b);">
                <ion-icon name="construct-outline" style="font-size:48px;display:block;margin:0 auto 12px;"></ion-icon>
                Нет записей о ремонте для этого авто
            </div>`;
            return;
        }

        const totalAmount = filtered.reduce((s, r) => s + (r.total || 0), 0);

        container.innerHTML = `
            <div style="margin-bottom:16px;text-align:center;font-weight:600;color:var(--text-secondary,#86868b);">
                Всего: ${filtered.length} записей на сумму ${fmtMoney(totalAmount)}
            </div>
            ${filtered.map(record => {
                const d = parseDate(record.date);
                const dateStr = d ? d.toLocaleDateString('ru-RU') : record.date;
                const catLabel = getCategoryLabel(record.category);
                const catIcon = getCategoryIcon(record.category);
                const catColor = getCategoryColor(record.category);

                const partsHTML = (record.parts || []).length
                    ? `<div style="margin-top:8px;font-size:14px;color:var(--text-secondary,#86868b);"><strong>Запчасти:</strong> ${record.parts.map(p => `${esc(p.name)} (${fmtMoney(p.cost)})`).join(', ')}</div>` : '';
                const worksHTML = (record.works || []).length
                    ? `<div style="margin-top:4px;font-size:14px;color:var(--text-secondary,#86868b);"><strong>Работы:</strong> ${record.works.map(w => `${esc(w.name)} (${fmtMoney(w.cost)})`).join(', ')}</div>` : '';
                const serviceHTML = (record.serviceItems || []).length
                    ? `<div style="margin-top:4px;font-size:13px;color:var(--text-tertiary,#a1a1a6);"><strong>Выполнено:</strong> ${record.serviceItems.map(it => {
                        const n = { oil: '🛢️ Масло', oilFilter: '🔵 Масляный фильтр', airFilter: '💨 Воздушный', cabinFilter: '🌬️ Салонный', sparkPlugs: '⚡ Свечи', brakePads: '🔴 Колодки', coolant: '❄️ Охлаждайка', brakeFluid: '💧 Тормозная', transmissionFluid: '⚙️ Трансмиссия', tires: '🛞 Шины', battery: '🔋 АКБ', wipers: '🌧️ Дворники' };
                        return n[it] || it;
                    }).join(' · ')}</div>` : '';

                const photosHTML = (record.receiptPhotoUrl || record.documentPhotoUrl) ? `
                    <div class="repair-photos-indicator" data-record-id="${record.id}">
                        ${record.receiptPhotoUrl ? `<button type="button" class="repair-photo-thumb" onclick="openPhotoViewer('${record.id}','receipt')" title="Чек"><img src="${record.receiptPhotoUrl}" class="repair-photo-mini" loading="lazy"><span class="repair-photo-label"><ion-icon name="receipt-outline"></ion-icon>Чек</span></button>` : ''}
                        ${record.documentPhotoUrl ? `<button type="button" class="repair-photo-thumb" onclick="openPhotoViewer('${record.id}','document')" title="Документ"><img src="${record.documentPhotoUrl}" class="repair-photo-mini" loading="lazy"><span class="repair-photo-label"><ion-icon name="document-text-outline"></ion-icon>Документ</span></button>` : ''}
                    </div>` : '';

                return `
                    <div class="repair-item" style="background:var(--bg-secondary,#fff);border:1px solid var(--border-light,rgba(0,0,0,.08));border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.04);border-left:4px solid ${catColor};transition:all .2s;">
                        <div style="display:flex;align-items:flex-start;gap:12px;">
                            <div style="width:40px;height:40px;border-radius:50%;background:${catColor}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${catColor};font-size:20px;">
                                <ion-icon name="${catIcon}"></ion-icon>
                            </div>
                            <div style="flex:1;min-width:0;">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
                                    <div style="font-weight:600;font-size:16px;color:var(--text-primary,#1d1d1f);">${catLabel} ${record.description ? '— ' + esc(record.description) : ''}</div>
                                    <div style="font-weight:700;font-size:20px;color:${catColor};">${fmtMoney(record.total || 0)}</div>
                                </div>
                                <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;font-size:14px;color:var(--text-secondary,#86868b);">
                                    <span><ion-icon name="calendar-outline" style="vertical-align:middle;"></ion-icon> ${dateStr}</span>
                                    <span><ion-icon name="speedometer-outline" style="vertical-align:middle;"></ion-icon> ${(record.mileage || 0).toLocaleString('ru-RU')} км</span>
                                    ${record.comment ? `<span style="font-style:italic;color:var(--text-tertiary,#a1a1a6);">${esc(record.comment)}</span>` : ''}
                                </div>
                                ${partsHTML}${worksHTML}${serviceHTML}${photosHTML}
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                            <button class="btn btn-secondary btn-small" onclick="openRepairModal('${record.id}')"><ion-icon name="create-outline"></ion-icon> Редактировать</button>
                            <button class="btn btn-danger btn-small" onclick="deleteRepairRecord('${record.id}')"><ion-icon name="trash-outline"></ion-icon> Удалить</button>
                        </div>
                    </div>`;
            }).join('')}
        `;
    }

    function updateRepairStats() {
        const vId = getVId();
        const list = repairRecords.filter(r => (r.vehicleId || 'default') === vId);
        const totalCount = list.length;
        const totalAmount = list.reduce((s, r) => s + (r.total || 0), 0);
        const avg = totalCount ? totalAmount / totalCount : 0;

        const byCat = {};
        list.forEach(r => {
            const c = r.category || 'other';
            byCat[c] = (byCat[c] || 0) + 1;
        });
        let mostCommon = '—', maxC = 0;
        for (const [c, n] of Object.entries(byCat)) {
            if (n > maxC) { maxC = n; mostCommon = getCategoryLabel(c); }
        }

        const maxM = list.reduce((m, r) => Math.max(m, r.mileage || 0), 0);
        const minM = list.reduce((m, r) => Math.min(m, r.mileage || 9999999), 0);
        const diff = maxM - minM;
        const costPerKm = diff > 0 ? totalAmount / diff : 0;

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('repair-total-count', totalCount);
        set('repair-total-amount', fmtMoney(totalAmount));
        set('repair-avg-amount', fmtMoney(avg));
        set('repair-most-common', mostCommon);
        set('repair-total-mileage', diff > 0 ? diff.toFixed(0) + ' км' : '—');
        set('repair-cost-per-km', costPerKm > 0 ? costPerKm.toFixed(2) + ' ₽/км' : '—');
    }

    function updateRepairCharts() {
        updateRepairCategoryChart();
        updateRepairTrendChart();
    }

    function updateRepairCategoryChart() {
        const canvas = document.getElementById('repair-category-chart');
        if (!canvas) return;
        if (repairChart) { repairChart.destroy(); repairChart = null; }

        const vId = getVId();
        const list = repairRecords.filter(r => (r.vehicleId || 'default') === vId);

        if (list.length === 0) {
            canvas.style.display = 'none';
            const em = document.getElementById('repair-chart-empty');
            if (em) em.style.display = 'block';
            return;
        }
        canvas.style.display = 'block';
        const em = document.getElementById('repair-chart-empty');
        if (em) em.style.display = 'none';

        const cats = {};
        list.forEach(r => {
            const k = r.category || 'other';
            if (!cats[k]) cats[k] = { total: 0, label: getCategoryLabel(k) };
            cats[k].total += (r.total || 0);
        });
        const keys = Object.keys(cats);
        const labels = keys.map(k => cats[k].label);
        const data = keys.map(k => cats[k].total);
        const colors = keys.map(k => getCategoryColor(k));

        repairChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: colors.map(c => c + 'CC'), borderColor: colors, borderWidth: 2, hoverOffset: 8 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 12, weight: '600' }, color: '#3C3C43' } },
                    tooltip: {
                        backgroundColor: 'rgba(255,255,255,.95)', titleColor: '#1d1d1f', bodyColor: '#3C3C43',
                        borderColor: 'rgba(0,0,0,.1)', borderWidth: 1, padding: 12,
                        callbacks: {
                            label: (ctx) => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                                return `${ctx.label}: ${fmtMoney(ctx.parsed)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function updateRepairTrendChart() {
        const canvas = document.getElementById('repair-trend-chart');
        if (!canvas) return;
        if (repairTrendChart) { repairTrendChart.destroy(); repairTrendChart = null; }

        const vId = getVId();
        const list = repairRecords.filter(r => (r.vehicleId || 'default') === vId);
        const sorted = [...list].sort((a, b) => (parseDate(a.date) || 0) - (parseDate(b.date) || 0));

        if (sorted.length < 2) {
            canvas.style.display = 'none';
            const em = document.getElementById('repair-trend-empty');
            if (em) em.style.display = 'block';
            return;
        }
        canvas.style.display = 'block';
        const em = document.getElementById('repair-trend-empty');
        if (em) em.style.display = 'none';

        const labels = sorted.map(r => {
            const d = parseDate(r.date);
            return d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : r.date;
        });
        const data = sorted.map(r => r.total || 0);

        repairTrendChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'Расходы на ремонт', data, backgroundColor: 'rgba(255,59,48,.6)', borderColor: '#FF3B30', borderWidth: 2, borderRadius: 4 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } } }
            }
        });
    }

    // ============================================
    // СИНК С ОСНОВНОЙ ТАБЛИЦЕЙ (БЕЗ ЗАПРОСОВ В FIREBASE)
    // ============================================
    async function syncRepairToMainRecords() {
        const records = (typeof window.records !== 'undefined' && Array.isArray(window.records))
            ? window.records
            : null;
        if (!records) return 0;

        // Используем данные из памяти (repairRecords), а не делаем запрос в Firebase!
        if (repairRecords.length === 0) return 0;

        const byDate = {};
        repairRecords.forEach(r => {
            if (!r.date) return;
            if (!byDate[r.date]) byDate[r.date] = { totalAmount: 0, count: 0, details: [] };
            byDate[r.date].totalAmount += r.total || 0;
            byDate[r.date].count += 1;
            byDate[r.date].details.push({
                category: r.category, description: r.description, parts: r.parts || [], works: r.works || [],
                total: r.total || 0, mileage: r.mileage, comment: r.comment, vehicleId: r.vehicleId || 'default'
            });
        });

        let updated = 0;
        const changedDates = [];

        records.forEach(record => {
            if (!record.date) return;
            const data = byDate[record.date];
            const oldCost = record.repairCost || 0;
            const linked = record.repairDetails && Array.isArray(record.repairDetails) && record.repairDetails.length > 0;

            if (data) {
                let need = false;
                if (data.totalAmount !== oldCost) need = true;
                else if (!record.repairDetails || record.repairDetails.length !== data.count) need = true;
                else {
                    const a = record.repairDetails.map(d => ({ c: d.category, de: d.description, t: d.total, m: d.mileage })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
                    const b = data.details.map(d => ({ c: d.category, de: d.description, t: d.total, m: d.mileage })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
                    if (JSON.stringify(a) !== JSON.stringify(b)) need = true;
                }
                if (need) {
                    record.repairCost = data.totalAmount;
                    record.repairDetails = data.details;
                    record.repairLogCount = data.count;
                    record.totalExpenses = typeof window.calcExpenses === 'function' ? window.calcExpenses(record) : 0;
                    const inc = typeof window.calcIncome === 'function' ? window.calcIncome(record) : (record.totalIncome || 0);
                    record.netProfit = inc - record.totalExpenses;
                    updated++;
                    changedDates.push(record.date);
                }
            } else if (linked) {
                if (oldCost > 0 || record.repairDetails) {
                    record.repairCost = 0;
                    record.repairDetails = [];
                    record.repairLogCount = 0;
                    record.totalExpenses = typeof window.calcExpenses === 'function' ? window.calcExpenses(record) : 0;
                    const inc = typeof window.calcIncome === 'function' ? window.calcIncome(record) : (record.totalIncome || 0);
                    record.netProfit = inc - record.totalExpenses;
                    updated++;
                    changedDates.push(record.date);
                }
            }
        });

        if (updated > 0) {
            if (typeof window.saveData === 'function') window.saveData();
            if (isFirebaseReady() && typeof window.saveRecordsBatchToFirebase === 'function') {
                try {
                    const toUpdate = records.filter(r => changedDates.includes(r.date));
                    await window.saveRecordsBatchToFirebase(toUpdate);
                } catch (e) { console.error('❌ Batch ремонтов в Firebase:', e); }
            }
            if (typeof window.renderTable === 'function') window.renderTable();
            if (typeof window.updateAnalytics === 'function') window.updateAnalytics();
        }
        return updated;
    }

    // ============================================
    // ПРОСМОТРЩИК ФОТО
    // ============================================
    function openPhotoViewer(recordId, startType = 'receipt') {
        const rec = repairRecords.find(r => r.id === recordId);
        if (!rec) { toast('❌ Запись не найдена'); return; }
        const photos = [];
        if (rec.receiptPhotoUrl) photos.push({ url: rec.receiptPhotoUrl, label: 'Чек', type: 'receipt' });
        if (rec.documentPhotoUrl) photos.push({ url: rec.documentPhotoUrl, label: 'Документ', type: 'document' });
        if (photos.length === 0) { toast('ℹ️ Нет фото'); return; }
        let idx = photos.findIndex(p => p.type === startType);
        if (idx === -1) idx = 0;
        photoViewerState.photos = photos;
        photoViewerState.currentIndex = idx;
        renderPhotoViewer();
        openPhotoViewerOverlay();
    }

    function renderPhotoViewer() {
        const track = document.getElementById('photo-viewer-track');
        const dots = document.getElementById('photo-viewer-dots');
        const counter = document.getElementById('photo-viewer-counter');
        if (!track || !dots || !counter) return;
        const { photos, currentIndex } = photoViewerState;
        track.innerHTML = photos.map((p, i) =>
            `<div class="photo-viewer-slide" data-label="${p.label}" data-index="${i}"><img src="${p.url}" alt="${p.label}" onclick="handlePhotoClick(event)" ondblclick="handlePhotoDoubleTap(event)"></div>`
        ).join('');
        if (photos.length > 1) {
            dots.style.display = 'flex';
            dots.innerHTML = photos.map((_, i) => `<div class="photo-viewer-dot ${i === currentIndex ? 'active' : ''}" data-index="${i}"></div>`).join('');
            dots.querySelectorAll('.photo-viewer-dot').forEach(d => {
                d.addEventListener('click', () => scrollToSlide(parseInt(d.dataset.index)));
            });
        } else dots.style.display = 'none';
        counter.textContent = `${currentIndex + 1} из ${photos.length}`;
        requestAnimationFrame(() => {
            const w = track.clientWidth;
            track.scrollLeft = currentIndex * w;
        });
        if (!track._photoScrollBound) {
            track._photoScrollBound = true;
            track.addEventListener('scroll', handlePhotoViewerScroll, { passive: true });
        }
    }

    function handlePhotoViewerScroll(e) {
        const track = e.target;
        const w = track.clientWidth;
        if (w === 0) return;
        const idx = Math.round(track.scrollLeft / w);
        if (idx === photoViewerState.currentIndex) return;
        photoViewerState.currentIndex = idx;
        const c = document.getElementById('photo-viewer-counter');
        if (c) c.textContent = `${idx + 1} из ${photoViewerState.photos.length}`;
        document.querySelectorAll('.photo-viewer-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    }

    function scrollToSlide(idx) {
        const track = document.getElementById('photo-viewer-track');
        if (!track) return;
        track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
    }

    function openPhotoViewerOverlay() {
        const overlay = document.getElementById('photo-viewer');
        if (!overlay) return;
        overlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handlePhotoViewerKeydown);
    }

    function closePhotoViewer() {
        const overlay = document.getElementById('photo-viewer');
        if (!overlay) return;
        overlay.classList.remove('visible');
        document.body.style.overflow = '';
        document.removeEventListener('keydown', handlePhotoViewerKeydown);
        setTimeout(() => {
            const track = document.getElementById('photo-viewer-track');
            if (track) track.innerHTML = '';
            photoViewerState.photos = [];
            photoViewerState.currentIndex = 0;
        }, 300);
    }

    function handlePhotoViewerKeydown(e) {
        if (e.key === 'Escape') closePhotoViewer();
        if (e.key === 'ArrowLeft') scrollToSlide(Math.max(0, photoViewerState.currentIndex - 1));
        if (e.key === 'ArrowRight') scrollToSlide(Math.min(photoViewerState.photos.length - 1, photoViewerState.currentIndex + 1));
    }

    function handlePhotoClick(event) {
        event.stopPropagation();
        const img = event.currentTarget;
        if (img.classList.contains('zoomed')) { img.classList.remove('zoomed'); img.style.transform = 'scale(1)'; return; }
        clearTimeout(photoClickTimer);
        photoClickTimer = setTimeout(() => closePhotoViewer(), 250);
    }

    function handlePhotoDoubleTap(event) {
        event.stopPropagation();
        clearTimeout(photoClickTimer);
        const img = event.currentTarget;
        if (img.classList.contains('zoomed')) { img.classList.remove('zoomed'); img.style.transform = 'scale(1)'; }
        else { img.classList.add('zoomed'); img.style.transform = 'scale(2.5)'; }
    }

    async function downloadCurrentPhoto() {
        const { photos, currentIndex } = photoViewerState;
        if (!photos[currentIndex]) return;
        const photo = photos[currentIndex];
        if (photo.url.startsWith('data:')) {
            const a = document.createElement('a');
            a.href = photo.url;
            a.download = `repair_${photo.type}_${Date.now()}.jpg`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            toast(`✅ ${photo.label} сохранён`);
            return;
        }
        try {
            const r = await fetch(photo.url);
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `repair_${photo.type}_${Date.now()}.jpg`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast(`✅ ${photo.label} сохранён`);
        } catch (e) {
            window.open(photo.url, '_blank');
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    function exportRepairData() {
        if (repairRecords.length === 0) { toast('⚠️ Нет данных о ремонте'); return; }
        const data = { repairs: repairRecords, exportDate: new Date().toISOString(), version: '3.0' };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `repairs-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('✅ Ремонты экспортированы');
    }

    // ============================================
    // ТУЛТИП РЕМОНТА (через общий каркас script.js)
    // ============================================
    function buildRepairTooltipHTML(anchor) {
        let details = [];
        try {
            const raw = anchor.getAttribute('data-repair-details') || '[]';
            details = JSON.parse(raw.replace(/&apos;/g, "'"));
        } catch (e) { details = []; }
        const total = parseFloat(anchor.getAttribute('data-repair-total')) || 0;
        const count = parseFloat(anchor.getAttribute('data-repair-count')) || details.length;

        const items = details.map(d => {
            const catLabel = getCategoryLabel(d.category);
            const title = d.title || d.name || catLabel;
            const description = d.description || d.desc || '';
            const amount = parseFloat(d.amount !== undefined ? d.amount : (d.cost !== undefined ? d.cost : d.total)) || 0;
            const date = d.date ? (typeof window.formatDate === 'function' ? window.formatDate(d.date) : d.date) : '';
            const mile = parseFloat(d.mileage !== undefined ? d.mileage : (d.odometer !== undefined ? d.odometer : d.km)) || 0;
            const parts = Array.isArray(d.parts) ? d.parts : [];
            const works = Array.isArray(d.works) ? d.works : [];
            const vName = d.vehicleId && typeof window.getVehicleNameById === 'function'
                ? window.getVehicleNameById(d.vehicleId) : '';

            const partsHTML = parts.length
                ? `<div class="repair-tooltip-detail-parts"><div class="label">Запчасти:</div>${parts.map(p => `<div class="item">• ${esc(p.name || p.title || '')}${p.cost ? ' — ' + fmtMoney(parseFloat(p.cost) || 0) : ''}</div>`).join('')}</div>`
                : '';
            const worksHTML = works.length
                ? `<div class="repair-tooltip-detail-works"><div class="label">Работы:</div>${works.map(w => `<div class="item">• ${esc(w.name || w.title || '')}${w.cost ? ' — ' + fmtMoney(parseFloat(w.cost) || 0) : ''}</div>`).join('')}</div>`
                : '';

            return `<div class="repair-tooltip-detail-item">
                ${vName ? `<div style="font-weight:600;color:var(--ios-accent);font-size:12px;margin-bottom:6px;">${esc(vName)}</div>` : ''}
                <div class="repair-tooltip-detail-header">
                    <div class="repair-tooltip-detail-title">${esc(title)}</div>
                    <div class="repair-tooltip-detail-amount">${fmtMoney(amount)}</div>
                </div>
                ${(date || mile) ? `<div class="repair-tooltip-detail-meta">${date}${date && mile ? ' · ' : ''}${mile ? mile.toLocaleString('ru-RU') + ' км' : ''}</div>` : ''}
                ${description && description !== catLabel ? `<div class="repair-tooltip-detail-meta" style="font-style:italic;">${esc(description)}</div>` : ''}
                ${partsHTML}${worksHTML}
            </div>`;
        }).join('');

        return `
            <div class="repair-tooltip-header"><ion-icon name="construct-outline"></ion-icon><h4>Подробности ремонтов</h4></div>
            <div class="repair-tooltip-summary">
                <div class="repair-tooltip-summary-item"><div class="label">Ремонтов</div><div class="value">${count}</div></div>
                <div class="repair-tooltip-summary-item"><div class="label">Сумма</div><div class="value">${fmtMoney(total)}</div></div>
                <div class="repair-tooltip-summary-item"><div class="label">Средний чек</div><div class="value">${count ? fmtMoney(total / count) : '0 ₽'}</div></div>
            </div>
            <div class="repair-tooltip-details">${items || '<div style="padding:10px;text-align:center;color:var(--ios-text-tertiary);font-size:13px;">Нет деталей</div>'}</div>
            <div class="repair-tooltip-hint">Тапните вне окна, чтобы закрыть</div>`;
    }

    function openRepairTooltip(anchor) {
        if (typeof window.__tooltipShow !== 'function') return;
        window.__tooltipShow(buildRepairTooltipHTML(anchor), anchor, 'repair-tooltip');
    }

    document.addEventListener('click', function (e) {
        const anchor = e.target.closest('td.repair-cell-with-details, .rcd-repair');
        if (!anchor) return;
        e.preventDefault();
        e.stopPropagation();
        if (document.getElementById('card-tooltip')) {
            if (typeof window.__tooltipClose === 'function') window.__tooltipClose();
            return;
        }
        openRepairTooltip(anchor);
    });

    // ============================================
    // РЕАКЦИЯ НА СМЕНУ АВТО / ПОЛЬЗОВАТЕЛЯ
    // ============================================
    window.addEventListener('vehicleChanged', function (e) {
        console.log('🚗 repair-module: смена авто →', e.detail ? e.detail.vehicleId : '?');
        populateRepairModalVehicleSelect();
        renderRepairList();
        updateRepairStats();
        updateRepairCharts();
    });

    function onUserChanged(user) {
        currentRepairUserUid = null;
        if (user && typeof window.db !== 'undefined') {
            currentRepairUserUid = user.uid;
            // Данные загрузятся при вызове loadRepairRecords() из auth-module
        } else {
            repairRecords = [];
            persistLocal();
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
        }
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function init() {
        const form = document.getElementById('repair-form');
        if (form) form.addEventListener('submit', handleRepairSubmit);

        const dateEl = document.getElementById('repair-date');
        if (dateEl) dateEl.valueAsDate = new Date();

        ['repair-filter-period', 'repair-filter-category', 'repair-filter-search'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', renderRepairList);
            if (id === 'repair-filter-search') el.addEventListener('input', renderRepairList);
        });

        const receiptUpload = document.getElementById('repair-receipt-upload');
        const documentUpload = document.getElementById('repair-document-upload');
        if (receiptUpload) receiptUpload.addEventListener('change', e => handlePhotoSelect(e, 'receipt'));
        if (documentUpload) documentUpload.addEventListener('change', e => handlePhotoSelect(e, 'document'));

        // Модалка: клик по overlay
        document.addEventListener('click', function (e) {
            const overlay = document.getElementById('repair-modal-overlay');
            if (overlay && e.target === overlay) closeRepairModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            const overlay = document.getElementById('repair-modal-overlay');
            if (overlay && overlay.classList.contains('visible')) closeRepairModal();
        });

        // Делегирование для модалки (авторасчёт)
        document.addEventListener('input', function (e) {
            if (e.target.classList.contains('repair-modal-part-cost') ||
                e.target.classList.contains('repair-modal-work-cost')) {
                calculateRepairModalTotal();
            }
        });

        setupDynamicListDelegation();
        addRepairPart();
        addRepairWork();
        calculateRepairTotal();

        // Подписка на смену пользователя
        if (typeof window.auth !== 'undefined' && typeof window.auth.onAuthStateChanged === 'function') {
            window.auth.onAuthStateChanged(onUserChanged);
        }

        loadRepairRecords();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    Object.defineProperty(window, 'repairRecords', {
        get: function () { return repairRecords; },
        configurable: true
    });

    window.loadRepairRecords = loadRepairRecords;
    window.handleRepairSubmit = handleRepairSubmit;
    window.editRepairRecordTab = editRepairRecordTab;
    window.deleteRepairRecord = deleteRepairRecord;
    window.clearRepairForm = clearRepairForm;
    window.renderRepairList = renderRepairList;
    window.updateRepairStats = updateRepairStats;
    window.updateRepairCharts = updateRepairCharts;
    window.syncRepairToMainRecords = syncRepairToMainRecords;
    window.exportRepairData = exportRepairData;
    window.getCategoryLabel = getCategoryLabel;
    window.getCategoryIcon = getCategoryIcon;
    window.getCategoryColor = getCategoryColor;
    window.addRepairPart = addRepairPart;
    window.addRepairWork = addRepairWork;
    window.calculateRepairTotal = calculateRepairTotal;
    window.handlePhotoSelect = handlePhotoSelect;
    window.removePhoto = removePhoto;
    window.updatePhotoPreview = updatePhotoPreview;
    window.rotatePhoto = rotatePhoto;
    window.compressImageForUpload = compressImageForUpload;
    window.calculatePhotoBudget = calculatePhotoBudget;

    window.openRepairModal = openRepairModal;
    window.closeRepairModal = closeRepairModal;
    window.submitRepairModal = submitRepairModal;
    window.addRepairModalPart = addRepairModalPart;
    window.addRepairModalWork = addRepairModalWork;
    window.calculateRepairModalTotal = calculateRepairModalTotal;
    window.clearRepairModalForm = clearRepairModalForm;
    window.handleRepairModalPhotoSelect = handleRepairModalPhotoSelect;
    window.removeRepairModalPhoto = removeRepairModalPhoto;
    window.rotateRepairModalPhoto = rotateRepairModalPhoto;
    window.updateRepairModalPhotoPreview = updateRepairModalPhotoPreview;
    window.populateRepairModalVehicleSelect = populateRepairModalVehicleSelect;

    window.openPhotoViewer = openPhotoViewer;
    window.closePhotoViewer = closePhotoViewer;
    window.downloadCurrentPhoto = downloadCurrentPhoto;
    window.handlePhotoClick = handlePhotoClick;
    window.handlePhotoDoubleTap = handlePhotoDoubleTap;

    console.log('✅ repair-module.js v7.0 (Firebase-экономный) загружен');
})();