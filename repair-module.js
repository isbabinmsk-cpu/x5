// =============================================
// МОДУЛЬ УЧЕТА РЕМОНТА АВТО (v4.0 — Firestore Base64 + Поворот фото + EXIF)
// Фото хранятся прямо в Firestore как base64 (без Firebase Storage)
// =============================================

// ===== 1. КОНСТАНТЫ =====
const COLLECTION_REPAIR = 'repair_records';
const REPAIR_STORAGE_KEY = 'repair_records';
let repairRecords = [];
let editingRepairId = null;
let repairChart = null;
let repairTrendChart = null;
let repairPhotos = { receipt: null, document: null };
let existingPhotos = { receipt: null, document: null };

// ===== 2. БЕЗОПАСНЫЙ ДОСТУП =====
function safeShowLoading(text) {
    if (typeof showLoading === 'function') showLoading(text);
    else console.log('⏳', text);
}
function safeHideLoading() {
    if (typeof hideLoading === 'function') hideLoading();
    else console.log('✅ Загрузка завершена');
}
function safeShowToast(title, message, type, duration) {
    if (typeof showToast === 'function') showToast(title, message, type, duration);
    else console.log(`[${type}] ${title}: ${message}`);
}
function safeShowConfirm(title, message, okText, cancelText, type) {
    if (typeof showConfirm === 'function') return showConfirm(title, message, okText, cancelText, type);
    return Promise.resolve(confirm(message));
}
function safeFormatMoney(amount) {
    if (typeof formatMoney === 'function') return formatMoney(amount);
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(amount || 0);
}
function safeEscapeHtml(text) {
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * Генерация уникального ID
 */
function generateRecordId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'repair_' + crypto.randomUUID();
    }
    return 'repair_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Глубокая копия объекта
 */
function deepClone(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        console.warn('⚠️ deepClone fallback:', e);
        return { ...obj };
    }
}

// ===== 3. ПАРСИНГ ДАТЫ =====
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(dateStr);
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

// ===== 4. КАТЕГОРИИ =====
function getCategoryLabel(category) {
    const labels = {
        'engine': 'Двигатель', 'transmission': 'Трансмиссия',
        'brakes': 'Тормозная система', 'suspension': 'Подвеска',
        'electrics': 'Электрика', 'body': 'Кузов',
        'tires': 'Шины/Диски', 'oil': 'Масло/Жидкости',
        'cooling': 'Охлаждение', 'exhaust': 'Выхлопная система',
        'other': 'Прочее'
    };
    return labels[category] || category || 'Другое';
}
function getCategoryIcon(category) {
    const icons = {
        'engine': 'cog-outline', 'transmission': 'settings-outline',
        'brakes': 'alert-circle-outline', 'suspension': 'bicycle-outline',
        'electrics': 'flash-outline', 'body': 'car-outline',
        'tires': 'disc-outline', 'oil': 'water-outline',
        'cooling': 'thermometer-outline', 'exhaust': 'leaf-outline',
        'other': 'construct-outline'
    };
    return icons[category] || 'construct-outline';
}
function getCategoryColor(category) {
    const colors = {
        'engine': '#FF3B30', 'transmission': '#FF9500',
        'brakes': '#FF2D55', 'suspension': '#AF52DE',
        'electrics': '#007AFF', 'body': '#34C759',
        'tires': '#5856D6', 'oil': '#5AC8FA',
        'cooling': '#64D2FF', 'exhaust': '#8E8E93',
        'other': '#636366'
    };
    return colors[category] || '#636366';
}

// ===== 5. ДИНАМИЧЕСКИЕ СПИСКИ =====
function addRepairPart() {
    const container = document.getElementById('repair-parts-list');
    if (!container) return;

    const item = document.createElement('div');
    item.className = 'dynamic-item';
    item.innerHTML = `
        <input type="text" class="repair-part-name" placeholder="Название детали">
        <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0">
        <button type="button" class="btn-remove" data-action="remove-part">
            <ion-icon name="trash-outline"></ion-icon>
        </button>
    `;
    container.appendChild(item);
    calculateRepairTotal();
}

function addRepairWork() {
    const container = document.getElementById('repair-works-list');
    if (!container) return;

    const item = document.createElement('div');
    item.className = 'dynamic-item';
    item.innerHTML = `
        <input type="text" class="repair-work-name" placeholder="Название работы">
        <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0">
        <button type="button" class="btn-remove" data-action="remove-work">
            <ion-icon name="trash-outline"></ion-icon>
        </button>
    `;
    container.appendChild(item);
    calculateRepairTotal();
}

function setupDynamicListDelegation() {
    const partsContainer = document.getElementById('repair-parts-list');
    const worksContainer = document.getElementById('repair-works-list');

    const handleEvent = (e) => {
        if (e.target.closest('[data-action^="remove-"]')) {
            const item = e.target.closest('.dynamic-item');
            if (item) {
                item.remove();
                calculateRepairTotal();
            }
            return;
        }
        if (e.target.classList.contains('repair-part-cost') ||
            e.target.classList.contains('repair-work-cost')) {
            calculateRepairTotal();
        }
    };

    [partsContainer, worksContainer].forEach(c => {
        if (!c || c._delegationBound) return;
        c._delegationBound = true;
        c.addEventListener('input', handleEvent);
        c.addEventListener('click', handleEvent);
    });
}

function calculateRepairTotal() {
    let partsTotal = 0, worksTotal = 0;
    document.querySelectorAll('.repair-part-cost').forEach(el => {
        partsTotal += parseFloat(el.value) || 0;
    });
    document.querySelectorAll('.repair-work-cost').forEach(el => {
        worksTotal += parseFloat(el.value) || 0;
    });
    const total = partsTotal + worksTotal;

    const el1 = document.getElementById('repair-parts-total');
    const el2 = document.getElementById('repair-works-total');
    const el3 = document.getElementById('repair-total-cost');
    if (el1) el1.textContent = safeFormatMoney(partsTotal);
    if (el2) el2.textContent = safeFormatMoney(worksTotal);
    if (el3) el3.textContent = safeFormatMoney(total);
}

// ===== ФУНКЦИИ ДЛЯ РАБОТЫ С ФОТО =====

/**
 * Обработчик выбора фото
 */
function handlePhotoSelect(event, photoType) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        safeShowToast('Ошибка', 'Пожалуйста, выберите изображение', 'danger');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        safeShowToast('Ошибка', 'Файл слишком большой. Максимум 5MB.', 'danger');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        repairPhotos[photoType] = { file: file, preview: e.target.result };
        updatePhotoPreview(photoType);
    };
    reader.readAsDataURL(file);
}

/**
 * Обновить превью фото + показать/скрыть кнопки поворота
 */
function updatePhotoPreview(photoType) {
    const previewEl = document.getElementById(`repair-${photoType}-preview`);
    const rotateControls = document.getElementById(`repair-${photoType}-rotate`);
    if (!previewEl) return;

    const photoData = repairPhotos[photoType];
    const existingUrl = existingPhotos[photoType];

    let hasPhoto = false;

    if (photoData && photoData.preview) {
        previewEl.innerHTML = `
            <img src="${photoData.preview}" alt="Preview">
            <button type="button" class="remove-photo-btn" onclick="removePhoto('${photoType}')">
                <ion-icon name="close-outline"></ion-icon>
            </button>
        `;
        previewEl.classList.add('has-image');
        hasPhoto = true;
    } else if (existingUrl) {
        previewEl.innerHTML = `
            <img src="${existingUrl}" alt="Existing">
            <button type="button" class="remove-photo-btn" onclick="removePhoto('${photoType}')">
                <ion-icon name="close-outline"></ion-icon>
            </button>
        `;
        previewEl.classList.add('has-image');
        hasPhoto = true;
    } else {
        previewEl.innerHTML = `
            <ion-icon name="image-outline"></ion-icon>
            <span>Нет фото</span>
        `;
        previewEl.classList.remove('has-image');
        hasPhoto = false;
    }

    // Показываем/скрываем кнопки поворота
    if (rotateControls) {
        rotateControls.style.display = hasPhoto ? 'flex' : 'none';
    }
}

/**
 * Удалить фото из превью
 */
function removePhoto(photoType) {
    repairPhotos[photoType] = null;
    existingPhotos[photoType] = null;
    updatePhotoPreview(photoType);
    const inputEl = document.getElementById(`repair-${photoType}-upload`);
    if (inputEl) inputEl.value = '';
}

/**
 * 🔄 ПОВОРОТ ФОТО (ручной)
 * @param {string} photoType - 'receipt' или 'document'
 * @param {number} degrees - -90 (влево) или 90 (вправо)
 */
function rotatePhoto(photoType, degrees) {
    const photoData = repairPhotos[photoType];
    const existingUrl = existingPhotos[photoType];

    // Определяем, что поворачивать: новое фото или существующее
    let sourceDataUrl = null;
    let isNewPhoto = false;

    if (photoData && photoData.preview) {
        sourceDataUrl = photoData.preview;
        isNewPhoto = true;
    } else if (existingUrl) {
        sourceDataUrl = existingUrl;
        isNewPhoto = false;
    } else {
        return;
    }

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (degrees === 90 || degrees === -90) {
            canvas.width = img.height;
            canvas.height = img.width;
        } else {
            canvas.width = img.width;
            canvas.height = img.height;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(degrees * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        const rotatedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

        if (isNewPhoto) {
            // Обновляем новый файл
            photoData.preview = rotatedDataUrl;
            fetch(rotatedDataUrl)
                .then(res => res.blob())
                .then(blob => {
                    photoData.file = new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    updatePhotoPreview(photoType);
                    safeShowToast('Повёрнуто', 'Фото повёрнуто. Не забудьте сохранить.', 'info', 2000);
                })
                .catch(err => {
                    console.error('Ошибка конвертации:', err);
                    updatePhotoPreview(photoType);
                });
        } else {
            // Существующее фото — превращаем в "новый файл"
            fetch(rotatedDataUrl)
                .then(res => res.blob())
                .then(blob => {
                    repairPhotos[photoType] = {
                        file: new File([blob], `rotated_${Date.now()}.jpg`, { type: 'image/jpeg' }),
                        preview: rotatedDataUrl
                    };
                    updatePhotoPreview(photoType);
                    safeShowToast('Повёрнуто', 'Фото повёрнуто. Не забудьте сохранить.', 'info', 2000);
                })
                .catch(err => {
                    console.error('Ошибка конвертации:', err);
                });
        }
    };
    img.onerror = () => {
        safeShowToast('Ошибка', 'Не удалось повернуть фото', 'danger');
    };
    img.src = sourceDataUrl;
}

/**
 * 🔥 СЖАТИЕ С ПОДДЕРЖКОЙ EXIF-ОРИЕНТАЦИИ
 * Автоматически поворачивает фото правильно (iPhone/Android)
 */
async function compressImageForUpload(file, maxWidth = 1400, initialQuality = 0.85) {
    try {
        // ✅ КЛЮЧЕВОЕ: createImageBitmap с imageOrientation: 'from-image'
        let bitmap;
        try {
            bitmap = await createImageBitmap(file, {
                imageOrientation: 'from-image'
            });
        } catch (e) {
            console.warn('⚠️ createImageBitmap не поддерживает imageOrientation, используем fallback');
            bitmap = await createImageBitmap(file);
        }

        let width = bitmap.width;
        let height = bitmap.height;
        console.log(`📐 Ориентация учтена: ${width}×${height}`);

        if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
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

        const photoBudgetKB = calculatePhotoBudget();
        let quality = initialQuality;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        const MAX_SIZE = photoBudgetKB * 1024;

        while (dataUrl.length > MAX_SIZE && quality > 0.3) {
            quality -= 0.05;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (dataUrl.length > MAX_SIZE) {
            const scale = Math.sqrt(MAX_SIZE / dataUrl.length) * 0.95;
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        }

        const finalKB = (dataUrl.length * 0.75 / 1024).toFixed(0);
        console.log(`📸 Сжатие: ${(file.size / 1024).toFixed(0)} KB → ${finalKB} KB (${canvas.width}×${canvas.height}, q=${quality.toFixed(2)})`);
        return dataUrl;

    } catch (error) {
        console.error('❌ Ошибка createImageBitmap, fallback на canvas:', error);
        return compressImageFallback(file, maxWidth, initialQuality);
    }
}

/**
 * Fallback для старых браузеров
 */
function compressImageFallback(file, maxWidth, initialQuality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const photoBudgetKB = calculatePhotoBudget();
                let quality = initialQuality;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);
                const MAX_SIZE = photoBudgetKB * 1024;

                while (dataUrl.length > MAX_SIZE && quality > 0.3) {
                    quality -= 0.05;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(dataUrl);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

/**
 * 🎯 Расчёт бюджета для фото (KB)
 */
function calculatePhotoBudget() {
    const hasReceipt = repairPhotos.receipt !== null;
    const hasDocument = repairPhotos.document !== null;
    const totalPhotos = (hasReceipt ? 1 : 0) + (hasDocument ? 1 : 0);

    const SAFE_BUDGET_KB = 990;
    if (totalPhotos === 0) return 0;
    if (totalPhotos === 1) return SAFE_BUDGET_KB - 30;
    if (totalPhotos === 2) return Math.floor((SAFE_BUDGET_KB - 30) / 2);
    return Math.floor((SAFE_BUDGET_KB - 30) / totalPhotos);
}

/**
 * 🔥 ВАРИАНТ FIRESTORE: возвращаем сжатый base64 data URL
 */
async function uploadPhotoToStorage(file, recordId, photoType) {
    try {
        const base64DataUrl = await compressImageForUpload(file);
        console.log(`✅ Фото ${photoType} сжато и готово к сохранению (base64)`);
        return base64DataUrl;
    } catch (error) {
        console.error(`❌ Ошибка сжатия фото ${photoType}:`, error);
        return null;
    }
}

/**
 * 🔥 ВАРИАНТ FIRESTORE: ничего не удаляем
 */
async function deletePhotoFromStorage(photoUrl) {
    console.log('ℹ️ Удаление не требуется (base64 в Firestore)');
}

// ===== 6. ЗАГРУЗКА ДАННЫХ И REAL-TIME СЛУШАТЕЛЬ =====
let repairUnsubscribe = null;

async function loadRepairRecords() {
    console.log('🔧 Инициализация модуля ремонта...');
    try {
        const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
        if (saved) {
            repairRecords = JSON.parse(saved);
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
        }

        if (typeof connectionMode !== 'undefined' && connectionMode === 'firebase' &&
            typeof auth !== 'undefined' && auth.currentUser) {

            console.log('☁️ Подключение real-time слушателя ремонтов...');
            if (typeof repairUnsubscribe === 'function') repairUnsubscribe();

            repairUnsubscribe = db.collection('users')
                .doc(auth.currentUser.uid)
                .collection(COLLECTION_REPAIR)
                .orderBy('date', 'desc')
                .onSnapshot((snapshot) => {
                    const vId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
                    let fbData = snapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() }))
                        .filter(r => (r.vehicleId || 'default') === vId);

                    fbData.sort((a, b) => {
                        const dateA = parseLocalDate(a.date) || 0;
                        const dateB = parseLocalDate(b.date) || 0;
                        return dateB - dateA;
                    });

                    repairRecords = fbData;
                    saveRepairLocal();
                    renderRepairList();
                    updateRepairStats();
                    updateRepairCharts();
                    syncRepairToMainRecords();
                }, (error) => {
                    console.error('❌ Ошибка слушателя ремонтов:', error);
                });
        }
    } catch (error) {
        console.error('❌ Критическая ошибка загрузки:', error);
        const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
        if (saved) {
            repairRecords = JSON.parse(saved);
            saveRepairLocal();
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
        }
    }
}

// ===== 7. СОХРАНЕНИЕ =====
function saveRepairLocal() {
    try {
        localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
    } catch (e) {
        console.warn('⚠️ Не удалось сохранить в localStorage:', e.message);
    }
}

async function syncRepairToFirebase(record) {
    if (typeof connectionMode === 'undefined' || connectionMode !== 'firebase' ||
        typeof auth === 'undefined' || !auth.currentUser) return false;
    try {
        const recordToSave = deepClone(record);
        delete recordToSave.id;

        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection(COLLECTION_REPAIR)
            .doc(record.id)
            .set({
                ...recordToSave,
                userId: auth.currentUser.uid,
                updatedAt: new Date().toISOString()
            });
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения в Firebase:', error);
        if (error.message && error.message.includes('maximum size')) {
            safeShowToast('Ошибка', 'Документ слишком большой. Попробуйте фото меньшего размера.', 'danger');
        }
        return false;
    }
}

async function deleteRepairFromFirebase(id) {
    if (typeof connectionMode === 'undefined' || connectionMode !== 'firebase' ||
        typeof auth === 'undefined' || !auth.currentUser) return false;
    try {
        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection(COLLECTION_REPAIR)
            .doc(id)
            .delete();
        return true;
    } catch (error) {
        console.error('❌ Ошибка удаления из Firebase:', error);
        return false;
    }
}

// ===== 8. ОБРАБОТЧИК ФОРМЫ =====
async function handleRepairSubmit(e) {
    e.preventDefault();
    safeShowLoading('Сохранение ремонта...');

    const date = document.getElementById('repair-date')?.value;
    const mileage = parseInt(document.getElementById('repair-mileage')?.value);
    const category = document.getElementById('repair-category')?.value;
    const description = document.getElementById('repair-description')?.value.trim();
    const comment = document.getElementById('repair-comment')?.value.trim();
    const vehicleId = document.getElementById('repair-vehicle-select')?.value || 'default';

    const isEditing = !!editingRepairId;

    if (!date || !mileage || mileage <= 0 || !category) {
        safeHideLoading();
        safeShowToast('Внимание', 'Заполните дату, пробег и категорию!', 'warning');
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

    const partsTotal = parts.reduce((sum, p) => sum + p.cost, 0);
    const worksTotal = works.reduce((sum, w) => sum + w.cost, 0);
    const total = partsTotal + worksTotal;

    const serviceItems = [];
    document.querySelectorAll('#repair-service-items input[type="checkbox"]:checked').forEach(cb => {
        serviceItems.push(cb.value);
    });

    // === БЕЗОПАСНАЯ ОБРАБОТКА ФОТО ===
    let receiptPhotoUrl = existingPhotos.receipt;
    let documentPhotoUrl = existingPhotos.document;
    const recordId = isEditing ? editingRepairId : generateRecordId();

    if (repairPhotos.receipt) {
        const newUrl = await uploadPhotoToStorage(repairPhotos.receipt.file, recordId, 'receipt');
        if (newUrl) {
            receiptPhotoUrl = newUrl;
        } else {
            safeShowToast('Внимание', 'Не удалось обработать фото чека. Старое фото сохранено.', 'warning');
        }
    }

    if (repairPhotos.document) {
        const newUrl = await uploadPhotoToStorage(repairPhotos.document.file, recordId, 'document');
        if (newUrl) {
            documentPhotoUrl = newUrl;
        } else {
            safeShowToast('Внимание', 'Не удалось обработать фото документа. Старое фото сохранено.', 'warning');
        }
    }

    const repairData = {
        date, mileage, category,
        description: description || getCategoryLabel(category),
        comment: comment || '',
        parts, works, partsTotal, worksTotal, total, serviceItems,
        receiptPhotoUrl: receiptPhotoUrl || null,
        documentPhotoUrl: documentPhotoUrl || null,
        updatedAt: new Date().toISOString()
    };

    try {
        if (isEditing) {
            const index = repairRecords.findIndex(r => r.id === editingRepairId);
            if (index !== -1) {
                repairRecords[index] = { ...repairRecords[index], ...repairData, vehicleId };
                await syncRepairToFirebase(repairRecords[index]);
            }
        } else {
            const newRecord = {
                id: recordId,
                vehicleId,
                userId: typeof auth !== 'undefined' && auth.currentUser ? auth.currentUser.uid : null,
                ...repairData,
                createdAt: new Date().toISOString()
            };
            repairRecords.push(newRecord);
            await syncRepairToFirebase(newRecord);
        }

        saveRepairLocal();
        clearRepairForm();
        renderRepairList();
        updateRepairStats();
        updateRepairCharts();
        syncRepairToMainRecords();

        safeHideLoading();
        safeShowToast('Успех', isEditing ? 'Ремонт обновлен!' : 'Ремонт добавлен!', 'success');
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
        safeHideLoading();
        safeShowToast('Ошибка', 'Не удалось сохранить ремонт', 'danger');
    }
}

// ===== 9. РЕДАКТИРОВАНИЕ =====
function editRepairRecord(id) {
    const record = repairRecords.find(r => r.id === id);
    if (!record) return;

    editingRepairId = id;

    document.getElementById('repair-date').value = record.date;
    document.getElementById('repair-mileage').value = record.mileage;
    document.getElementById('repair-category').value = record.category;
    document.getElementById('repair-description').value = record.description || '';
    document.getElementById('repair-comment').value = record.comment || '';

    const vehicleSelect = document.getElementById('repair-vehicle-select');
    if (vehicleSelect) vehicleSelect.value = record.vehicleId || 'default';

    const serviceItems = record.serviceItems || [];
    document.querySelectorAll('#repair-service-items input[type="checkbox"]').forEach(cb => {
        cb.checked = serviceItems.includes(cb.value);
    });

    const partsContainer = document.getElementById('repair-parts-list');
    if (partsContainer) {
        partsContainer.innerHTML = '';
        (record.parts || []).forEach(p => {
            const item = document.createElement('div');
            item.className = 'dynamic-item';
            item.innerHTML = `
                <input type="text" class="repair-part-name" placeholder="Название детали" value="${safeEscapeHtml(p.name)}">
                <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0" value="${p.cost}">
                <button type="button" class="btn-remove" data-action="remove-part">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;
            partsContainer.appendChild(item);
        });
    }

    const worksContainer = document.getElementById('repair-works-list');
    if (worksContainer) {
        worksContainer.innerHTML = '';
        (record.works || []).forEach(w => {
            const item = document.createElement('div');
            item.className = 'dynamic-item';
            item.innerHTML = `
                <input type="text" class="repair-work-name" placeholder="Название работы" value="${safeEscapeHtml(w.name)}">
                <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0" value="${w.cost}">
                <button type="button" class="btn-remove" data-action="remove-work">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;
            worksContainer.appendChild(item);
        });
    }

    // Фото
    existingPhotos.receipt = record.receiptPhotoUrl || null;
    existingPhotos.document = record.documentPhotoUrl || null;
    repairPhotos.receipt = null;
    repairPhotos.document = null;

    const receiptInput = document.getElementById('repair-receipt-upload');
    const documentInput = document.getElementById('repair-document-upload');
    if (receiptInput) receiptInput.value = '';
    if (documentInput) documentInput.value = '';

    updatePhotoPreview('receipt');
    updatePhotoPreview('document');

    calculateRepairTotal();

    const submitBtn = document.querySelector('#repair-form button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Обновить ремонт';
        submitBtn.classList.remove('btn-success');
        submitBtn.classList.add('btn-primary');
    }

    document.getElementById('repair-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    safeShowToast('✏️', 'Редактирование ремонта', 'info', 2000);
}

// ===== 10. УДАЛЕНИЕ =====
async function deleteRepairRecord(id) {
    if (!await safeShowConfirm('Удаление ремонта', 'Вы уверены, что хотите удалить эту запись?', 'Удалить', 'Отмена', 'danger')) return;

    safeShowLoading('Удаление...');

    try {
        repairRecords = repairRecords.filter(r => r.id !== id);
        saveRepairLocal();
        await deleteRepairFromFirebase(id);

        renderRepairList();
        updateRepairStats();
        updateRepairCharts();
        syncRepairToMainRecords();

        safeHideLoading();
        safeShowToast('Успех', 'Запись удалена!', 'success');
    } catch (error) {
        console.error('❌ Ошибка удаления:', error);
        safeHideLoading();
        safeShowToast('Ошибка', 'Не удалось удалить запись', 'danger');
    }
}

// ===== 11. ОЧИСТКА ФОРМЫ =====
function clearRepairForm() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('repair-date').value = today;
    document.getElementById('repair-mileage').value = '';
    document.getElementById('repair-category').value = 'engine';
    document.getElementById('repair-description').value = '';
    document.getElementById('repair-comment').value = '';

    document.querySelectorAll('#repair-service-items input[type="checkbox"]').forEach(cb => cb.checked = false);

    const partsContainer = document.getElementById('repair-parts-list');
    if (partsContainer) partsContainer.innerHTML = '';
    const worksContainer = document.getElementById('repair-works-list');
    if (worksContainer) worksContainer.innerHTML = '';

    addRepairPart();
    addRepairWork();
    calculateRepairTotal();

    // Сброс фото
    repairPhotos.receipt = null;
    repairPhotos.document = null;
    existingPhotos.receipt = null;
    existingPhotos.document = null;
    const receiptInput = document.getElementById('repair-receipt-upload');
    const documentInput = document.getElementById('repair-document-upload');
    if (receiptInput) receiptInput.value = '';
    if (documentInput) documentInput.value = '';
    updatePhotoPreview('receipt');
    updatePhotoPreview('document');

    editingRepairId = null;

    const submitBtn = document.querySelector('#repair-form button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить ремонт';
        submitBtn.classList.remove('btn-primary');
        submitBtn.classList.add('btn-success');
    }
}

// ===== 12. ФИЛЬТРАЦИЯ =====
function getFilteredRepairs() {
    const period = document.getElementById('repair-filter-period')?.value || 'all';
    const category = document.getElementById('repair-filter-category')?.value || 'all';
    const search = document.getElementById('repair-filter-search')?.value.toLowerCase() || '';

    let filtered = [...repairRecords];

    if (period !== 'all') {
        const now = new Date();
        const cutoff = new Date();
        if (period === 'month') cutoff.setMonth(now.getMonth() - 1);
        else if (period === '3months') cutoff.setMonth(now.getMonth() - 3);
        else if (period === 'year') cutoff.setFullYear(now.getFullYear() - 1);
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d >= cutoff;
        });
    }
    if (category !== 'all') {
        filtered = filtered.filter(r => r.category === category);
    }
    if (search) {
        filtered = filtered.filter(r =>
            (r.description || '').toLowerCase().includes(search) ||
            (r.comment || '').toLowerCase().includes(search) ||
            (r.parts || []).some(p => p.name.toLowerCase().includes(search)) ||
            (r.works || []).some(w => w.name.toLowerCase().includes(search))
        );
    }
    return filtered.sort((a, b) => (parseLocalDate(b.date) || 0) - (parseLocalDate(a.date) || 0));
}

// ===== 13. РЕНДЕР СПИСКА =====
function renderRepairList() {
    const container = document.getElementById('repair-list');
    if (!container) return;

    const filtered = getFilteredRepairs();

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-tertiary, #86868b);">
                <ion-icon name="construct-outline" style="font-size: 48px; display: block; margin: 0 auto 12px;"></ion-icon>
                Нет записей о ремонте
            </div>
        `;
        return;
    }

    const totalAmount = filtered.reduce((sum, r) => sum + (r.total || 0), 0);
    const formatMoney = safeFormatMoney;
    const escapeHtml = safeEscapeHtml;

    container.innerHTML = `
        <div style="margin-bottom: 16px; text-align: center; font-weight: 600; color: var(--text-secondary, #86868b);">
            Всего: ${filtered.length} записей на сумму ${formatMoney(totalAmount)}
        </div>
        ${filtered.map(record => {
            const d = parseLocalDate(record.date);
            const dateStr = d ? d.toLocaleDateString('ru-RU') : record.date;
            const categoryLabel = getCategoryLabel(record.category);
            const categoryIcon = getCategoryIcon(record.category);
            const categoryColor = getCategoryColor(record.category);

            const partsHTML = (record.parts || []).length > 0 ? `
                <div style="margin-top: 8px; font-size: 14px; color: var(--text-secondary, #86868b);">
                    <strong>Запчасти:</strong>
                    ${record.parts.map(p => `${escapeHtml(p.name)} (${formatMoney(p.cost)})`).join(', ')}
                </div>
            ` : '';

            const worksHTML = (record.works || []).length > 0 ? `
                <div style="margin-top: 4px; font-size: 14px; color: var(--text-secondary, #86868b);">
                    <strong>Работы:</strong>
                    ${record.works.map(w => `${escapeHtml(w.name)} (${formatMoney(w.cost)})`).join(', ')}
                </div>
            ` : '';

            const serviceItemsHTML = (record.serviceItems || []).length > 0 ? `
                <div style="margin-top: 4px; font-size: 13px; color: var(--text-tertiary, #a1a1a6);">
                    <strong>Выполнено:</strong>
                    ${record.serviceItems.map(item => {
                        const names = {
                            'oil': '🛢️ Масло', 'oilFilter': '🔵 Масляный фильтр',
                            'airFilter': '💨 Воздушный фильтр', 'cabinFilter': '🌬️ Салонный фильтр',
                            'sparkPlugs': '⚡ Свечи', 'brakePads': '🔴 Колодки',
                            'coolant': '❄️ Охлаждающая жидкость', 'brakeFluid': '💧 Тормозная жидкость',
                            'transmissionFluid': '⚙️ Трансмиссионное масло', 'tires': '🛞 Шины/Колёса',
                            'battery': '🔋 Аккумулятор', 'wipers': '🌧️ Дворники'
                        };
                        return names[item] || item;
                    }).join(' · ')}
                </div>
            ` : '';

            const photosHTML = (record.receiptPhotoUrl || record.documentPhotoUrl) ? `
                <div class="repair-photos-indicator" data-record-id="${record.id}">
                    ${record.receiptPhotoUrl ? `
                        <button type="button" class="repair-photo-thumb" onclick="openPhotoViewer('${record.id}', 'receipt')" title="Фото чека">
                            <img src="${record.receiptPhotoUrl}" alt="Чек" class="repair-photo-mini" loading="lazy">
                            <span class="repair-photo-label">
                                <ion-icon name="receipt-outline"></ion-icon>
                                Чек
                            </span>
                        </button>
                    ` : ''}
                    ${record.documentPhotoUrl ? `
                        <button type="button" class="repair-photo-thumb" onclick="openPhotoViewer('${record.id}', 'document')" title="Фото документа">
                            <img src="${record.documentPhotoUrl}" alt="Документ" class="repair-photo-mini" loading="lazy">
                            <span class="repair-photo-label">
                                <ion-icon name="document-text-outline"></ion-icon>
                                Документ
                            </span>
                        </button>
                    ` : ''}
                </div>
            ` : '';

            return `
                <div class="repair-item" style="
                    background: var(--bg-secondary, #ffffff);
                    border: 1px solid var(--border-light, rgba(0,0,0,0.08));
                    border-radius: 16px;
                    padding: 16px;
                    margin-bottom: 12px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                    border-left: 4px solid ${categoryColor};
                    transition: all 0.2s;
                ">
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <div style="
                            width: 40px; height: 40px;
                            border-radius: 50%;
                            background: ${categoryColor}20;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                            color: ${categoryColor};
                            font-size: 20px;
                        ">
                            <ion-icon name="${categoryIcon}"></ion-icon>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
                                <div style="font-weight: 600; font-size: 16px; color: var(--text-primary, #1d1d1f);">
                                    ${categoryLabel}
                                    ${record.description ? `— ${escapeHtml(record.description)}` : ''}
                                </div>
                                <div style="font-weight: 700; font-size: 20px; color: ${categoryColor};">
                                    ${formatMoney(record.total || 0)}
                                </div>
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 14px; color: var(--text-secondary, #86868b);">
                                <span><ion-icon name="calendar-outline" style="vertical-align: middle;"></ion-icon> ${dateStr}</span>
                                <span><ion-icon name="speedometer-outline" style="vertical-align: middle;"></ion-icon> ${record.mileage.toLocaleString()} км</span>
                                ${record.comment ? `<span style="font-style: italic; color: var(--text-tertiary, #a1a1a6);">${escapeHtml(record.comment)}</span>` : ''}
                            </div>
                            ${partsHTML}
                            ${worksHTML}
                            ${serviceItemsHTML}
                            ${photosHTML}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;">
                        <button class="btn btn-secondary btn-small" onclick="editRepairRecord('${record.id}')">
                            <ion-icon name="create-outline"></ion-icon> Редактировать
                        </button>
                        <button class="btn btn-danger btn-small" onclick="deleteRepairRecord('${record.id}')">
                            <ion-icon name="trash-outline"></ion-icon> Удалить
                        </button>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// ===== 14. СТАТИСТИКА =====
function updateRepairStats() {
    const totalCount = repairRecords.length;
    const totalAmount = repairRecords.reduce((sum, r) => sum + (r.total || 0), 0);
    const avgAmount = totalCount > 0 ? totalAmount / totalCount : 0;

    const categoryCount = {};
    repairRecords.forEach(r => {
        const cat = r.category || 'other';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });
    let mostCommon = '—', maxCount = 0;
    for (const [cat, count] of Object.entries(categoryCount)) {
        if (count > maxCount) { maxCount = count; mostCommon = getCategoryLabel(cat); }
    }

    const maxMileage = repairRecords.reduce((max, r) => Math.max(max, r.mileage || 0), 0);
    const minMileage = repairRecords.reduce((min, r) => Math.min(min, r.mileage || 9999999), 0);
    const totalMileage = maxMileage - minMileage;
    const costPerKm = totalMileage > 0 ? totalAmount / totalMileage : 0;

    const setEl = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setEl('repair-total-count', totalCount);
    setEl('repair-total-amount', safeFormatMoney(totalAmount));
    setEl('repair-avg-amount', safeFormatMoney(avgAmount));
    setEl('repair-most-common', mostCommon);
    setEl('repair-total-mileage', totalMileage > 0 ? totalMileage.toFixed(0) + ' км' : '—');
    setEl('repair-cost-per-km', costPerKm > 0 ? costPerKm.toFixed(2) + ' ₽/км' : '—');
}

// ===== 15. ГРАФИКИ =====
function updateRepairCharts() {
    updateRepairCategoryChart();
    updateRepairTrendChart();
}

function updateRepairCategoryChart() {
    const canvas = document.getElementById('repair-category-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (repairChart) { repairChart.destroy(); repairChart = null; }

    if (repairRecords.length === 0) {
        canvas.style.display = 'none';
        const emptyMsg = document.getElementById('repair-chart-empty');
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }
    canvas.style.display = 'block';
    const emptyMsg = document.getElementById('repair-chart-empty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    const categoryData = {};
    repairRecords.forEach(r => {
        const catKey = r.category || 'other';
        if (!categoryData[catKey]) categoryData[catKey] = { total: 0, label: getCategoryLabel(catKey) };
        categoryData[catKey].total += (r.total || 0);
    });

    const catKeys = Object.keys(categoryData);
    const labels = catKeys.map(key => categoryData[key].label);
    const data = catKeys.map(key => categoryData[key].total);
    const colors = catKeys.map(key => getCategoryColor(key));

    repairChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.map(c => c + 'CC'),
                borderColor: colors,
                borderWidth: 2,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 12, weight: '600' }, color: '#3C3C43' }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#1d1d1f',
                    bodyColor: '#3C3C43',
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
                            return `${context.label}: ${safeFormatMoney(context.parsed)} (${pct}%)`;
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
    const ctx = canvas.getContext('2d');
    if (repairTrendChart) { repairTrendChart.destroy(); repairTrendChart = null; }

    const sorted = [...repairRecords].sort((a, b) => (parseLocalDate(a.date) || 0) - (parseLocalDate(b.date) || 0));

    if (sorted.length < 2) {
        canvas.style.display = 'none';
        const emptyMsg = document.getElementById('repair-trend-empty');
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }
    canvas.style.display = 'block';
    const emptyMsg = document.getElementById('repair-trend-empty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    const labels = sorted.map(r => {
        const d = parseLocalDate(r.date);
        return d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : r.date;
    });
    const data = sorted.map(r => r.total || 0);

    repairTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Расходы на ремонт',
                data,
                backgroundColor: 'rgba(255, 59, 48, 0.6)',
                borderColor: '#FF3B30',
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: function(value) { return safeFormatMoney(value); } }
                }
            }
        }
    });
}

// ===== 16. СИНХРОНИЗАЦИЯ С ОСНОВНОЙ ТАБЛИЦЕЙ =====
async function syncRepairToMainRecords() {
    console.log('🔄 Синхронизация ремонтов с основной таблицей...');
    if (typeof records === 'undefined') return 0;

    let allRepairRecords = [];

    if (typeof connectionMode !== 'undefined' && connectionMode === 'firebase' &&
        typeof auth !== 'undefined' && auth.currentUser) {
        try {
            const snap = await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection(COLLECTION_REPAIR)
                .get();
            if (!snap.empty) {
                allRepairRecords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки для синхронизации:', error);
        }
    } else {
        const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
        if (saved) allRepairRecords = JSON.parse(saved);
    }

    if (allRepairRecords.length === 0) return 0;

    const repairsByDate = {};
    allRepairRecords.forEach(r => {
        if (!r.date) return;
        if (!repairsByDate[r.date]) repairsByDate[r.date] = { totalAmount: 0, count: 0, details: [] };
        repairsByDate[r.date].totalAmount += r.total || 0;
        repairsByDate[r.date].count += 1;
        repairsByDate[r.date].details.push({
            category: r.category,
            description: r.description,
            parts: r.parts || [],
            works: r.works || [],
            total: r.total || 0,
            mileage: r.mileage,
            comment: r.comment,
            vehicleId: r.vehicleId || 'default'
        });
    });

    let updatedCount = 0;
    let changedDates = [];

    records.forEach(record => {
        if (!record.date) return;
        const repairData = repairsByDate[record.date];
        const oldRepairCost = record.repairCost || 0;
        const isLinkedToRepairModule = record.repairDetails && Array.isArray(record.repairDetails) && record.repairDetails.length > 0;

        if (repairData) {
            const newRepairCost = repairData.totalAmount;
            let needsUpdate = false;

            if (newRepairCost !== oldRepairCost) {
                needsUpdate = true;
            } else if (!record.repairDetails || record.repairDetails.length !== repairData.count) {
                needsUpdate = true;
            } else if (record.repairDetails && record.repairDetails.length > 0) {
                const oldDetailsSimple = record.repairDetails.map(d => ({
                    category: d.category, description: d.description, total: d.total, mileage: d.mileage
                })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

                const newDetailsSimple = repairData.details.map(d => ({
                    category: d.category, description: d.description, total: d.total, mileage: d.mileage
                })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

                if (JSON.stringify(oldDetailsSimple) !== JSON.stringify(newDetailsSimple)) {
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                record.repairCost = newRepairCost;
                record.repairDetails = repairData.details;
                record.repairLogCount = repairData.count;
                record.totalExpenses = calcExpenses(record);
                record.netProfit = calcIncome(record) - record.totalExpenses;
                updatedCount++;
                changedDates.push(record.date);
            }
        } else if (isLinkedToRepairModule) {
            if (oldRepairCost > 0 || record.repairDetails) {
                record.repairCost = 0;
                record.repairDetails = [];
                record.repairLogCount = 0;
                record.totalExpenses = calcExpenses(record);
                record.netProfit = calcIncome(record) - record.totalExpenses;
                updatedCount++;
                changedDates.push(record.date);
            }
        }
    });

    if (updatedCount > 0) {
        if (typeof saveData === 'function') saveData();
        if (typeof connectionMode !== 'undefined' && connectionMode === 'firebase' &&
            typeof auth !== 'undefined' && auth.currentUser &&
            typeof saveRecordsBatchToFirebase === 'function') {
            try {
                const recordsToUpdate = records.filter(r => changedDates.includes(r.date));
                await saveRecordsBatchToFirebase(recordsToUpdate);
            } catch (error) {
                console.error('❌ Ошибка синхронизации с Firebase:', error);
            }
        }
        if (typeof renderTable === 'function') renderTable();
        if (typeof updateAnalytics === 'function') updateAnalytics();
    }
    return updatedCount;
}

// ===== 17. ЭКСПОРТ =====
function exportRepairData() {
    if (repairRecords.length === 0) {
        safeShowToast('Внимание', 'Нет данных о ремонте для экспорта', 'warning');
        return;
    }
    const data = { repairs: repairRecords, exportDate: new Date().toISOString(), version: '3.0' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repairs-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    safeShowToast('Успех', 'Данные о ремонте экспортированы!', 'success');
}

// ===== 18. ОТКРЫТИЕ ВКЛАДКИ =====
function openRepairTab() {
    if (typeof switchTab === 'function') switchTab('repair');
    setTimeout(() => {
        renderRepairList();
        updateRepairStats();
        updateRepairCharts();
    }, 100);
}

// ===== 19. ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', function() {
    const repairForm = document.getElementById('repair-form');
    if (repairForm) repairForm.addEventListener('submit', handleRepairSubmit);

    const dateInput = document.getElementById('repair-date');
    if (dateInput) dateInput.valueAsDate = new Date();

    ['repair-filter-period', 'repair-filter-category', 'repair-filter-search'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', renderRepairList);
            if (id === 'repair-filter-search') el.addEventListener('input', renderRepairList);
        }
    });

    // Обработчики загрузки фото
    const receiptUpload = document.getElementById('repair-receipt-upload');
    const documentUpload = document.getElementById('repair-document-upload');
    if (receiptUpload) receiptUpload.addEventListener('change', (e) => handlePhotoSelect(e, 'receipt'));
    if (documentUpload) documentUpload.addEventListener('change', (e) => handlePhotoSelect(e, 'document'));

    setupDynamicListDelegation();

    addRepairPart();
    addRepairWork();
    calculateRepairTotal();

    loadRepairRecords();
    console.log('✅ Модуль ремонта инициализирован (v4.0 — с поворотом фото и EXIF)');
});

// ===== 20. ИНТЕГРАЦИЯ С ПЕРЕКЛЮЧЕНИЕМ ВКЛАДОК =====
const _origSwitchTabRepair = window.switchTab || function() {};
window.switchTab = function(tabName) {
    if (typeof _origSwitchTabRepair === 'function') _origSwitchTabRepair(tabName);
    if (tabName === 'repair') {
        setTimeout(() => {
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
            setupDynamicListDelegation();
        }, 100);
    }
};

// ===== 21. ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ =====
window.repairRecords = repairRecords;
window.loadRepairRecords = loadRepairRecords;
window.handleRepairSubmit = handleRepairSubmit;
window.editRepairRecord = editRepairRecord;
window.deleteRepairRecord = deleteRepairRecord;
window.clearRepairForm = clearRepairForm;
window.renderRepairList = renderRepairList;
window.updateRepairStats = updateRepairStats;
window.updateRepairCharts = updateRepairCharts;
window.syncRepairToMainRecords = syncRepairToMainRecords;
window.exportRepairData = exportRepairData;
window.openRepairTab = openRepairTab;
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

console.log('✅ Модуль ремонта полностью загружен (v4.0)');

// ============================================
// ПРОСМОТРЩИК ФОТО РЕМОНТОВ (iOS-СТИЛЬ)
// ============================================
let photoViewerState = { photos: [], currentIndex: 0 };
let photoClickTimer = null;

function openPhotoViewer(recordId, startType = 'receipt') {
    const record = repairRecords.find(r => r.id === recordId);
    if (!record) {
        safeShowToast('Ошибка', 'Запись не найдена', 'danger');
        return;
    }

    const photos = [];
    if (record.receiptPhotoUrl) photos.push({ url: record.receiptPhotoUrl, label: 'Чек', type: 'receipt' });
    if (record.documentPhotoUrl) photos.push({ url: record.documentPhotoUrl, label: 'Документ', type: 'document' });

    if (photos.length === 0) {
        safeShowToast('Инфо', 'У этой записи нет фото', 'warning');
        return;
    }

    let startIndex = photos.findIndex(p => p.type === startType);
    if (startIndex === -1) startIndex = 0;

    photoViewerState.photos = photos;
    photoViewerState.currentIndex = startIndex;

    renderPhotoViewer();
    openPhotoViewerOverlay();
}

function renderPhotoViewer() {
    const track = document.getElementById('photo-viewer-track');
    const dots = document.getElementById('photo-viewer-dots');
    const counter = document.getElementById('photo-viewer-counter');
    if (!track || !dots || !counter) return;

    const { photos, currentIndex } = photoViewerState;

    track.innerHTML = photos.map((p, i) => `
        <div class="photo-viewer-slide" data-label="${p.label}" data-index="${i}">
            <img src="${p.url}" alt="${p.label}" 
                 onclick="handlePhotoClick(event)"
                 ondblclick="handlePhotoDoubleTap(event)">
        </div>
    `).join('');

    if (photos.length > 1) {
        dots.style.display = 'flex';
        dots.innerHTML = photos.map((_, i) =>
            `<div class="photo-viewer-dot ${i === currentIndex ? 'active' : ''}" data-index="${i}"></div>`
        ).join('');

        dots.querySelectorAll('.photo-viewer-dot').forEach(dot => {
            dot.addEventListener('click', () => scrollToSlide(parseInt(dot.dataset.index)));
        });
    } else {
        dots.style.display = 'none';
    }

    counter.textContent = `${currentIndex + 1} из ${photos.length}`;

    requestAnimationFrame(() => {
        const slideWidth = track.clientWidth;
        track.scrollLeft = currentIndex * slideWidth;
    });

    if (!track._photoViewerScrollBound) {
        track._photoViewerScrollBound = true;
        track.addEventListener('scroll', handlePhotoViewerScroll, { passive: true });
    }
}

function handlePhotoViewerScroll(e) {
    const track = e.target;
    const slideWidth = track.clientWidth;
    if (slideWidth === 0) return;

    const index = Math.round(track.scrollLeft / slideWidth);
    if (index === photoViewerState.currentIndex) return;

    photoViewerState.currentIndex = index;
    const counter = document.getElementById('photo-viewer-counter');
    if (counter) counter.textContent = `${index + 1} из ${photoViewerState.photos.length}`;

    document.querySelectorAll('.photo-viewer-dot').forEach((d, i) => d.classList.toggle('active', i === index));
}

function scrollToSlide(index) {
    const track = document.getElementById('photo-viewer-track');
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
}

function openPhotoViewerOverlay() {
    const overlay = document.getElementById('photo-viewer');
    if (!overlay) {
        console.error('❌ #photo-viewer не найден в DOM!');
        safeShowToast('Ошибка', 'Просмотрщик не найден в HTML', 'danger');
        return;
    }
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

function handlePhotoDoubleTap(event) {
    event.stopPropagation();
    clearTimeout(photoClickTimer);

    const img = event.currentTarget;
    const isZoomed = img.classList.contains('zoomed');

    if (isZoomed) {
        img.classList.remove('zoomed');
        img.style.transform = 'scale(1)';
    } else {
        img.classList.add('zoomed');
        img.style.transform = 'scale(2.5)';
    }
}

function handlePhotoClick(event) {
    event.stopPropagation();
    const img = event.currentTarget;

    if (img.classList.contains('zoomed')) {
        img.classList.remove('zoomed');
        img.style.transform = 'scale(1)';
        return;
    }

    clearTimeout(photoClickTimer);
    photoClickTimer = setTimeout(() => closePhotoViewer(), 250);
}

async function downloadCurrentPhoto() {
    const { photos, currentIndex } = photoViewerState;
    if (!photos[currentIndex]) return;

    const photo = photos[currentIndex];

    if (photo.url.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = photo.url;
        a.download = `repair_${photo.type}_${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        safeShowToast('Успех', `${photo.label} сохранён`, 'success');
        return;
    }

    try {
        const response = await fetch(photo.url);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `repair_${photo.type}_${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        safeShowToast('Успех', `${photo.label} сохранён`, 'success');
    } catch (error) {
        console.error('Ошибка скачивания:', error);
        window.open(photo.url, '_blank');
    }
}

window.openPhotoViewer = openPhotoViewer;
window.closePhotoViewer = closePhotoViewer;
window.downloadCurrentPhoto = downloadCurrentPhoto;
window.handlePhotoClick = handlePhotoClick;
window.handlePhotoDoubleTap = handlePhotoDoubleTap;

console.log('✅ Просмотрщик фото инициализирован');

// ============================================
// TOOLTIP ДЛЯ ДЕТАЛЕЙ РЕМОНТА
// ============================================
let repairTooltipElement = null;
function createRepairTooltip() {
    if (repairTooltipElement) return repairTooltipElement;
    repairTooltipElement = document.createElement('div');
    repairTooltipElement.className = 'repair-tooltip';
    repairTooltipElement.id = 'repair-tooltip';
    document.body.appendChild(repairTooltipElement);
    return repairTooltipElement;
}

function showRepairTooltip(event, cell) {
    const details = cell.getAttribute('data-repair-details');
    const count = cell.getAttribute('data-repair-count');
    if (!details) return;

    let repairDetails;
    try {
        repairDetails = JSON.parse(details.replace(/&apos;/g, "'"));
    } catch (e) {
        console.error('Ошибка парсинга деталей тултипа:', e);
        return;
    }

    const tooltip = createRepairTooltip();

    let html = `
        <div class="repair-tooltip-header">
            <ion-icon name="construct-outline"></ion-icon>
            <h4>Подробности ремонта</h4>
        </div>
        <div class="repair-tooltip-summary">
            <div class="repair-tooltip-summary-item">
                <div class="label">Ремонтов</div>
                <div class="value">${count}</div>
            </div>
            <div class="repair-tooltip-summary-item">
                <div class="label">Всего</div>
                <div class="value">${cell.textContent.trim()}</div>
            </div>
        </div>
        <div class="repair-tooltip-details">
    `;

    repairDetails.forEach((detail) => {
        const categoryLabel = getCategoryLabel ? getCategoryLabel(detail.category) : detail.category;
        const vehicleName = typeof window.getVehicleNameById === 'function' ?
            window.getVehicleNameById(detail.vehicleId) : 'Неизвестный автомобиль';

        const partsHTML = (detail.parts || []).length > 0 ? `
            <div class="repair-tooltip-detail-parts">
                <div class="label">Запчасти:</div>
                ${detail.parts.map(p => `<div class="item">• ${safeEscapeHtml(p.name)} - ${safeFormatMoney(p.cost)}</div>`).join('')}
            </div>
        ` : '';

        const worksHTML = (detail.works || []).length > 0 ? `
            <div class="repair-tooltip-detail-works">
                <div class="label">Работы:</div>
                ${detail.works.map(w => `<div class="item">• ${safeEscapeHtml(w.name)} - ${safeFormatMoney(w.cost)}</div>`).join('')}
            </div>
        ` : '';

        html += `
            <div class="repair-tooltip-detail-item">
                <div style="font-weight: 600; color: var(--ios-accent); font-size: 12px; margin-bottom: 6px;">
                    ${safeEscapeHtml(vehicleName)}
                </div>
                <div class="repair-tooltip-detail-header">
                    <div class="repair-tooltip-detail-title">${safeEscapeHtml(categoryLabel)}</div>
                    <div class="repair-tooltip-detail-amount">${safeFormatMoney(detail.total)}</div>
                </div>
                ${detail.description && detail.description !== categoryLabel ? `<div class="repair-tooltip-detail-meta">${safeEscapeHtml(detail.description)}</div>` : ''}
                ${detail.mileage ? `<div class="repair-tooltip-detail-meta">Пробег: ${detail.mileage.toLocaleString()} км</div>` : ''}
                ${partsHTML}
                ${worksHTML}
            </div>
        `;
    });

    html += `
        </div>
        <div class="repair-tooltip-hint">Наведите для просмотра деталей</div>
    `;

    tooltip.innerHTML = html;

    const rect = cell.getBoundingClientRect();
    const tooltipWidth = 350;
    const tooltipHeight = tooltip.offsetHeight || 250;
    let left = rect.right + 10;
    let top = rect.top;

    if (left + tooltipWidth > window.innerWidth) left = rect.left - tooltipWidth - 10;
    if (top + tooltipHeight > window.innerHeight) top = window.innerHeight - tooltipHeight - 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.classList.add('visible');
}

function hideRepairTooltip() {
    if (repairTooltipElement) repairTooltipElement.classList.remove('visible');
}

document.addEventListener('mouseover', function(event) {
    const cell = event.target.closest('.repair-cell-with-details');
    if (cell) showRepairTooltip(event, cell);
});

document.addEventListener('mouseout', function(event) {
    const cell = event.target.closest('.repair-cell-with-details');
    if (cell) {
        const tooltip = document.getElementById('repair-tooltip');
        if (tooltip && !tooltip.contains(event.relatedTarget)) hideRepairTooltip();
    }
});

document.addEventListener('click', function(event) {
    const cell = event.target.closest('.repair-cell-with-details');
    if (cell) {
        if (repairTooltipElement && repairTooltipElement.classList.contains('visible')) {
            hideRepairTooltip();
        } else {
            showRepairTooltip(event, cell);
        }
    } else if (!event.target.closest('#repair-tooltip')) {
        hideRepairTooltip();
    }
});

console.log('✅ Tooltip для ремонта инициализирован');

// ============================================
// «Что менялось?» — сворачиваемая секция
// ============================================
(function() {
    function setup() {
        const heads = Array.from(
            document.querySelectorAll('#tab-repair h3, #tab-repair h4, #tab-repair .section-title, #tab-repair .form-section > h3')
        ).filter(el =>
            el.children.length <= 1 &&
            el.textContent.trim().replace(/\s+/g, ' ') === 'Что менялось?'
        );

        for (const head of heads) {
            if (head.closest('.chg-collapse')) continue;
            const list = head.nextElementSibling;
            if (!list || list.closest('.chg-collapse')) continue;

            const wrap = document.createElement('div');
            wrap.className = 'chg-collapse collapsed';
            head.parentNode.insertBefore(wrap, head);

            const header = document.createElement('div');
            header.className = 'chg-collapse-header';
            const chev = document.createElement('ion-icon');
            chev.setAttribute('name', 'chevron-down-outline');
            chev.className = 'chg-chevron';

            wrap.appendChild(header);
            header.appendChild(head);
            header.appendChild(chev);

            const inner = document.createElement('div');
            inner.className = 'chg-collapse-inner';
            inner.appendChild(list);
            wrap.appendChild(inner);

            header.addEventListener('click', () => wrap.classList.toggle('collapsed'));
        }
    }

    let tries = 0;
    const timer = setInterval(() => {
        setup();
        if (++tries > 30) clearInterval(timer);
    }, 1000);

    const rep = document.getElementById('tab-repair');
    if (rep) new MutationObserver(() => setup()).observe(rep, { childList: true, subtree: true });
    setup();
})();