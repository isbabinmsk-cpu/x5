// =============================================
// МОДУЛЬ УЧЕТА РЕМОНТА АВТО
// =============================================

// ===== 1. КОНСТАНТЫ =====
const COLLECTION_REPAIR = 'repair_records';
const REPAIR_STORAGE_KEY = 'repair_records';
let repairRecords = [];
let editingRepairId = null;
let repairChart = null;
let repairTrendChart = null;

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
    const str = String(text);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
        'engine': 'Двигатель',
        'transmission': 'Трансмиссия',
        'brakes': 'Тормозная система',
        'suspension': 'Подвеска',
        'electrics': 'Электрика',
        'body': 'Кузов',
        'tires': 'Шины/Диски',
        'oil': 'Масло/Жидкости',
        'cooling': 'Охлаждение',
        'exhaust': 'Выхлопная система',
        'other': 'Прочее'
    };
    return labels[category] || category || 'Другое';
}

function getCategoryIcon(category) {
    const icons = {
        'engine': 'cog-outline',
        'transmission': 'settings-outline',
        'brakes': 'alert-circle-outline',
        'suspension': 'bicycle-outline',
        'electrics': 'flash-outline',
        'body': 'car-outline',
        'tires': 'disc-outline',
        'oil': 'water-outline',
        'cooling': 'thermometer-outline',
        'exhaust': 'leaf-outline',
        'other': 'construct-outline'
    };
    return icons[category] || 'construct-outline';
}

function getCategoryColor(category) {
    const colors = {
        'engine': '#FF3B30',
        'transmission': '#FF9500',
        'brakes': '#FF2D55',
        'suspension': '#AF52DE',
        'electrics': '#007AFF',
        'body': '#34C759',
        'tires': '#5856D6',
        'oil': '#5AC8FA',
        'cooling': '#64D2FF',
        'exhaust': '#8E8E93',
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
        <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0" oninput="calculateRepairTotal()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairTotal();">
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
        <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0" oninput="calculateRepairTotal()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairTotal();">
            <ion-icon name="trash-outline"></ion-icon>
        </button>
    `;
    container.appendChild(item);
    calculateRepairTotal();
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

// ===== 6. ЗАГРУЗКА ДАННЫХ И REAL-TIME СЛУШАТЕЛЬ =====
let repairUnsubscribe = null; // Переменная для хранения подписки

async function loadRepairRecords() {
    console.log('🔧 Инициализация модуля ремонта...');
    try {
        // 1. МГНОВЕННО показываем то, что уже есть в localStorage
        const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
        if (saved) {
            repairRecords = JSON.parse(saved);
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
        }
        
        // 2. Если есть подключение к Firebase и пользователь авторизован
        if (typeof connectionMode !== 'undefined' && connectionMode === 'firebase' &&
            typeof auth !== 'undefined' && auth.currentUser) {
            
            console.log('☁️ Подключение real-time слушателя ремонтов...');
            
            // Получаем ID текущего автомобиля
            const vId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
            
            // Если слушатель уже был, отключаем его
            if (typeof repairUnsubscribe === 'function') {
                repairUnsubscribe();
            }
            
            // ИСПРАВЛЕНИЕ: Убрали .orderBy('date', 'desc'), чтобы избежать ошибки failed-precondition
            // onSnapshot срабатывает при ЛЮБОМ изменении
// Загружаем ВСЕ записи без фильтра vehicleId
repairUnsubscribe = db.collection('users')
    .doc(auth.currentUser.uid)
    .collection(COLLECTION_REPAIR)
    .orderBy('date', 'desc')
    .onSnapshot((snapshot) => {
        console.log('🔄 Получены изменения из Firebase (onSnapshot)');
        
        const vId = typeof getCurrentVehicleId === 'function' ? getCurrentVehicleId() : 'default';
        
        // Фильтруем в JavaScript: берем записи нужного авто ИЛИ без vehicleId (считаем их default)
        let fbData = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(r => (r.vehicleId || 'default') === vId);
        
        // Сортируем по дате
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
        
        console.log(`✅ Синхронизировано для авто ${vId}. Актуально записей: ${repairRecords.length}`);
    }, (error) => {
        console.error('❌ Ошибка real-time слушателя ремонтов:', error);
    });
        } else {
            console.log('⚠️ Пропуск real-time синхронизации (режим:', typeof connectionMode !== 'undefined' ? connectionMode : 'undefined', ')');
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка загрузки ремонтов:', error);
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
    localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
}

async function syncRepairToFirebase(record) {
    // ИСПРАВЛЕНИЕ: Проверка connectionMode вместо isFirebaseConnected
    if (typeof connectionMode === 'undefined' || connectionMode !== 'firebase' || 
        typeof auth === 'undefined' || !auth.currentUser) {
        return false;
    }
    try {
        const recordToSave = { ...record };
        delete recordToSave.id; 
        
        // ИСПРАВЛЕНИЕ: Правильный путь Compat SDK
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
        console.error('❌ Ошибка сохранения ремонта в Firebase:', error);
        return false;
    }
}

async function deleteRepairFromFirebase(id) {
    if (typeof connectionMode === 'undefined' || connectionMode !== 'firebase' ||
        typeof auth === 'undefined' || !auth.currentUser) {
        return false;
    }
    try {
        // ИСПРАВЛЕНИЕ: Правильный путь Compat SDK
        await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection(COLLECTION_REPAIR)
            .doc(id)
            .delete();
        return true;
    } catch (error) {
        console.error('❌ Ошибка удаления ремонта из Firebase:', error);
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
    // ✅ ЧИТАЕМ ВЫБРАННЫЙ АВТОМОБИЛЬ ИЗ ФОРМЫ
    const vehicleId = document.getElementById('repair-vehicle-select')?.value || 'default';
    
    const isEditing = !!editingRepairId;
    
    if (!date || !mileage || mileage <= 0 || !category) {
        safeHideLoading();
        safeShowToast('Внимание', 'Заполните дату, пробег и категорию!', 'warning');
        return;
    }
    
    // ... (остальной код сбора запчастей и работ остается без изменений) ...
    // Собираем запчасти
    const parts = [];
    document.querySelectorAll('#repair-parts-list .dynamic-item').forEach(item => {
        const name = item.querySelector('.repair-part-name')?.value?.trim();
        const cost = parseFloat(item.querySelector('.repair-part-cost')?.value) || 0;
        if (name) parts.push({ name, cost });
    });
    
    // Собираем работы
    const works = [];
    document.querySelectorAll('#repair-works-list .dynamic-item').forEach(item => {
        const name = item.querySelector('.repair-work-name')?.value?.trim();
        const cost = parseFloat(item.querySelector('.repair-work-cost')?.value) || 0;
        if (name) works.push({ name, cost });
    });
    
    const partsTotal = parts.reduce((sum, p) => sum + p.cost, 0);
    const worksTotal = works.reduce((sum, w) => sum + w.cost, 0);
    const total = partsTotal + worksTotal;
    
    // Собираем чекбоксы "Что менялось?"
    const serviceItems = [];
    document.querySelectorAll('#repair-service-items input[type="checkbox"]:checked').forEach(cb => {
        serviceItems.push(cb.value);
    });
    
    const repairData = {
        date: date,
        mileage: mileage,
        category: category,
        description: description || getCategoryLabel(category),
        comment: comment || '',
        parts: parts,
        works: works,
        partsTotal: partsTotal,
        worksTotal: worksTotal,
        total: total,
        serviceItems: serviceItems,
        updatedAt: new Date().toISOString()
    };
    
    try {
        if (isEditing) {
            const index = repairRecords.findIndex(r => r.id === editingRepairId);
            if (index !== -1) {
                repairRecords[index] = {
                    ...repairRecords[index],
                    ...repairData,
                    vehicleId // ✅ СОХРАНЯЕМ НОВЫЙ vehicleId
                };
                await syncRepairToFirebase(repairRecords[index]);
            }
        } else {
            const newRecord = {
                id: 'repair_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                vehicleId, // ✅ ДОБАВЛЯЕМ vehicleId
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
    
    // ✅ НОВОЕ: Выбираем нужный автомобиль в списке (или 'default' для старых записей)
    const vehicleSelect = document.getElementById('repair-vehicle-select');
    if (vehicleSelect) {
        vehicleSelect.value = record.vehicleId || 'default';
    }
    
    // Заполняем чекбоксы
    const serviceItems = record.serviceItems || [];
    document.querySelectorAll('#repair-service-items input[type="checkbox"]').forEach(cb => {
        cb.checked = serviceItems.includes(cb.value);
    });
    
    // Заполняем запчасти
    const partsContainer = document.getElementById('repair-parts-list');
    if (partsContainer) {
        partsContainer.innerHTML = '';
        (record.parts || []).forEach(p => {
            const item = document.createElement('div');
            item.className = 'dynamic-item';
            item.innerHTML = `
                <input type="text" class="repair-part-name" placeholder="Название детали" value="${safeEscapeHtml(p.name)}">
                <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0" value="${p.cost}" oninput="calculateRepairTotal()">
                <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairTotal();">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;
            partsContainer.appendChild(item);
        });
    }
    
    // Заполняем работы
    const worksContainer = document.getElementById('repair-works-list');
    if (worksContainer) {
        worksContainer.innerHTML = '';
        (record.works || []).forEach(w => {
            const item = document.createElement('div');
            item.className = 'dynamic-item';
            item.innerHTML = `
                <input type="text" class="repair-work-name" placeholder="Название работы" value="${safeEscapeHtml(w.name)}">
                <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0" value="${w.cost}" oninput="calculateRepairTotal()">
                <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairTotal();">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;
            worksContainer.appendChild(item);
        });
    }
    
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
    
    // Добавляем по одной пустой строке
    addRepairPart();
    addRepairWork();
    calculateRepairTotal();
    
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
            
            // Список запчастей
            const partsHTML = (record.parts || []).length > 0 ? `
                <div style="margin-top: 8px; font-size: 14px; color: var(--text-secondary, #86868b);">
                    <strong>Запчасти:</strong>
                    ${record.parts.map(p => `${escapeHtml(p.name)} (${formatMoney(p.cost)})`).join(', ')}
                </div>
            ` : '';
            
            // Список работ
            const worksHTML = (record.works || []).length > 0 ? `
                <div style="margin-top: 4px; font-size: 14px; color: var(--text-secondary, #86868b);">
                    <strong>Работы:</strong>
                    ${record.works.map(w => `${escapeHtml(w.name)} (${formatMoney(w.cost)})`).join(', ')}
                </div>
            ` : '';
            
            // Чекбоксы "Что менялось?"
            const serviceItemsHTML = (record.serviceItems || []).length > 0 ? `
                <div style="margin-top: 4px; font-size: 13px; color: var(--text-tertiary, #a1a1a6);">
                    <strong>Выполнено:</strong>
                    ${record.serviceItems.map(item => {
                        const names = {
                            'oil': '🛢️ Масло',
                            'oilFilter': '🔵 Масляный фильтр',
                            'airFilter': '💨 Воздушный фильтр',
                            'cabinFilter': '🌬️ Салонный фильтр',
                            'sparkPlugs': '⚡ Свечи',
                            'brakePads': '🔴 Колодки',
                            'coolant': '❄️ Охлаждающая жидкость',
                            'brakeFluid': '💧 Тормозная жидкость',
                            'transmissionFluid': '⚙️ Трансмиссионное масло',
                            'tires': '🛞 Шины/Колёса',
                            'battery': '🔋 Аккумулятор',
                            'wipers': '🌧️ Дворники'
                        };
                        return names[item] || item;
                    }).join(' · ')}
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
    let mostCommon = '—';
    let maxCount = 0;
    for (const [cat, count] of Object.entries(categoryCount)) {
        if (count > maxCount) {
            maxCount = count;
            mostCommon = getCategoryLabel(cat);
        }
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
    
    // ✅ ИСПРАВЛЕНИЕ: Используем r.category (ключ) как ключ объекта, а не лейбл
    const categoryData = {};
    repairRecords.forEach(r => {
        const catKey = r.category || 'other';
        if (!categoryData[catKey]) {
            categoryData[catKey] = { total: 0, label: getCategoryLabel(catKey) };
        }
        categoryData[catKey].total += (r.total || 0);
    });
    
    // Формируем массивы для Chart.js
    const catKeys = Object.keys(categoryData);
    const labels = catKeys.map(key => categoryData[key].label);
    const data = catKeys.map(key => categoryData[key].total);
    
    // ✅ ИСПРАВЛЕНИЕ: Получаем цвета напрямую по ключу категории
    const colors = catKeys.map(key => getCategoryColor(key));
    
    repairChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.map(c => c + 'CC'), // Добавляем прозрачность 80%
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
                    labels: { 
                        padding: 12, 
                        usePointStyle: true, 
                        pointStyle: 'circle', 
                        font: { size: 12, weight: '600' },
                        color: '#3C3C43'
                    }
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
                            const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
                            return `${context.label}: ${safeFormatMoney(context.parsed)} (${percentage}%)`;
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
            labels: labels,
            datasets: [{
                label: 'Расходы на ремонт',
                data: data,
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

// ===== 16. СИНХРОНИЗАЦИЯ С ОСНОВНОЙ ТАБЛИЦЕЙ (ВСЕ АВТОМОБИЛИ) =====
async function syncRepairToMainRecords() {
    console.log('🔄 Синхронизация ремонтов с основной таблицей (ВСЕ АВТОМОБИЛИ)...');
    
    if (typeof records === 'undefined') return 0;
    
    let allRepairRecords = [];
    
    // 1. Загружаем ВСЕ ремонты из Firebase
    if (typeof connectionMode !== 'undefined' && connectionMode === 'firebase' &&
        typeof auth !== 'undefined' && auth.currentUser) {
        try {
            const snap = await db.collection('users')
                .doc(auth.currentUser.uid)
                .collection(COLLECTION_REPAIR)
                .get();
            
            if (!snap.empty) {
                allRepairRecords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                console.log('✅ Загружено ремонтов для синхронизации (все авто):', allRepairRecords.length);
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки всех ремонтов для синхронизации:', error);
        }
    } else {
        const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
        if (saved) {
            allRepairRecords = JSON.parse(saved);
        }
    }
    
    if (allRepairRecords.length === 0) {
        console.log('ℹ️ Нет записей о ремонте для синхронизации');
        return 0;
    }
    
    // 2. Группируем ремонты по дате
    const repairsByDate = {};
    allRepairRecords.forEach(r => {
        if (!r.date) return;
        if (!repairsByDate[r.date]) {
            repairsByDate[r.date] = { totalAmount: 0, count: 0, details: [] };
        }
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
    
    // 3. Проходим по всем записям в Истории
    records.forEach(record => {
        if (!record.date) return;
        
        const repairData = repairsByDate[record.date];
        const oldRepairCost = record.repairCost || 0;
        const isLinkedToRepairModule = record.repairDetails && Array.isArray(record.repairDetails) && record.repairDetails.length > 0;
        
        if (repairData) {
            const newRepairCost = repairData.totalAmount;
            
            // ✅ УМНАЯ ПРОВЕРКА ИЗМЕНЕНИЙ
            let needsUpdate = false;
            
            // 1. Проверяем, изменилась ли сумма
            if (newRepairCost !== oldRepairCost) {
                needsUpdate = true;
                console.log(`📝 Обновление ремонта за ${record.date}: ${oldRepairCost} ₽ → ${newRepairCost} ₽ (изменилась сумма)`);
            }
            // 2. Если сумма не изменилась, проверяем количество записей
            else if (!record.repairDetails || record.repairDetails.length !== repairData.count) {
                needsUpdate = true;
                console.log(`📝 Обновление ремонта за ${record.date}: ${oldRepairCost} ₽ (изменилось количество: ${record.repairDetails?.length || 0} → ${repairData.count})`);
            }
            // 3. Если и количество совпало, проверяем только ключевые поля (без vehicleId)
            else if (record.repairDetails && record.repairDetails.length > 0) {
                // Сравниваем только основные поля, игнорируя vehicleId
                const oldDetailsSimple = record.repairDetails.map(d => ({
                    category: d.category,
                    description: d.description,
                    total: d.total,
                    mileage: d.mileage
                })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
                
                const newDetailsSimple = repairData.details.map(d => ({
                    category: d.category,
                    description: d.description,
                    total: d.total,
                    mileage: d.mileage
                })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
                
                if (JSON.stringify(oldDetailsSimple) !== JSON.stringify(newDetailsSimple)) {
                    needsUpdate = true;
                    console.log(`📝 Обновление ремонта за ${record.date}: ${oldRepairCost} ₽ (изменились детали)`);
                } else {
                    console.log(`⏭️ Пропуск за ${record.date}: данные не изменились (${oldRepairCost} ₽, ${repairData.count} записей)`);
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
                console.log(`🗑️ Обнуление ремонта за ${record.date}: было ${oldRepairCost} ₽`);
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
    
    console.log(`📊 Итог синхронизации ремонта: Обновлено ${updatedCount}, Пропущено ${records.length - updatedCount}`);
    
    // 4. Сохраняем ТОЛЬКО если что-то реально изменилось
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
    
    const data = {
        repairs: repairRecords,
        exportDate: new Date().toISOString(),
        version: '1.0'
    };
    
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
    
    // Добавляем начальные строки для запчастей и работ
    addRepairPart();
    addRepairWork();
    calculateRepairTotal();
    
    loadRepairRecords();
    console.log('✅ Модуль ремонта инициализирован');
});

// ===== 20. ИНТЕГРАЦИЯ С ПЕРЕКЛЮЧЕНИЕМ ВКЛАДОК =====
const originalSwitchTab = window.switchTab || function() {};
window.switchTab = function(tabName) {
    if (typeof originalSwitchTab === 'function') originalSwitchTab(tabName);
    if (tabName === 'repair') {
        setTimeout(() => {
            renderRepairList();
            updateRepairStats();
            updateRepairCharts();
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

console.log('✅ Модуль ремонта полностью загружен');

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
    const total = cell.getAttribute('data-repair-total');
    const count = cell.getAttribute('data-repair-count');
    if (!details) return;
    
    const repairDetails = JSON.parse(details.replace(/&apos;/g, "'"));
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
    
    repairDetails.forEach((detail, index) => {
        const categoryLabel = getCategoryLabel ? getCategoryLabel(detail.category) : detail.category;
        
        // ✅ ДОБАВЛЕНО: Получаем название автомобиля
        const vehicleName = typeof window.getVehicleNameById === 'function' ?
            window.getVehicleNameById(detail.vehicleId) :
            'Неизвестный автомобиль';
        
        const partsHTML = (detail.parts || []).length > 0 ? `
         <div class="repair-tooltip-detail-parts">
             <div class="label">Запчасти:</div>
             ${detail.parts.map(p => `<div class="item">• ${p.name} - ${formatMoney(p.cost)}</div>`).join('')}
         </div>
     ` : '';
        
        const worksHTML = (detail.works || []).length > 0 ? `
         <div class="repair-tooltip-detail-works">
             <div class="label">Работы:</div>
             ${detail.works.map(w => `<div class="item">• ${w.name} - ${formatMoney(w.cost)}</div>`).join('')}
         </div>
     ` : '';
        
        html += `
         <div class="repair-tooltip-detail-item">
             <div style="font-weight: 600; color: var(--ios-accent); font-size: 12px; margin-bottom: 6px;">
                 ${vehicleName}
             </div>
             <div class="repair-tooltip-detail-header">
                 <div class="repair-tooltip-detail-title">${categoryLabel}</div>
                 <div class="repair-tooltip-detail-amount">${formatMoney(detail.total)}</div>
             </div>
             ${detail.description && detail.description !== categoryLabel ? `<div class="repair-tooltip-detail-meta">${detail.description}</div>` : ''}
             ${detail.mileage ? `<div class="repair-tooltip-detail-meta">Пробег: ${detail.mileage.toLocaleString()} км</div>` : ''}
             ${partsHTML}
             ${worksHTML}
         </div>
     `;
    });
    
    html += `
     </div>
     <div class="repair-tooltip-hint">
         Наведите для просмотра деталей
     </div>
 `;
    
    tooltip.innerHTML = html;
    
    const rect = cell.getBoundingClientRect();
    const tooltipWidth = 350;
    const tooltipHeight = tooltip.offsetHeight || 250;
    let left = rect.right + 10;
    let top = rect.top;
    
    if (left + tooltipWidth > window.innerWidth) {
        left = rect.left - tooltipWidth - 10;
    }
    if (top + tooltipHeight > window.innerHeight) {
        top = window.innerHeight - tooltipHeight - 10;
    }
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.classList.add('visible');
}

function hideRepairTooltip() {
if (repairTooltipElement) {
repairTooltipElement.classList.remove('visible');
}
}

// Делегирование событий для ячеек с ремонтом
document.addEventListener('mouseover', function(event) {
const cell = event.target.closest('.repair-cell-with-details');
if (cell) {
showRepairTooltip(event, cell);
}
});

document.addEventListener('mouseout', function(event) {
const cell = event.target.closest('.repair-cell-with-details');
if (cell) {
const tooltip = document.getElementById('repair-tooltip');
if (tooltip && !tooltip.contains(event.relatedTarget)) {
hideRepairTooltip();
}
}
});

// Для мобильных устройств - показывать по клику
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
// «Что менялось?» — сворачиваемая секция (свёрнута по умолчанию)
// ============================================
(function() {
    function setup() {
        const heads = Array.from(document.querySelectorAll('#tab-repair *')).filter(el =>
            el.children.length <= 1 &&
            el.textContent.trim().replace(/\s+/g, ' ') === 'Что менялось?');
        
        for (const head of heads) {
            if (head.closest('.chg-collapse')) continue; // уже обёрнуто
            const list = head.nextElementSibling; // список чекбоксов
            if (!list || list.closest('.chg-collapse')) continue;
            
            // Контейнер секции
            const wrap = document.createElement('div');
            wrap.className = 'chg-collapse collapsed'; // ← свёрнуто по умолчанию
            head.parentNode.insertBefore(wrap, head);
            
            // Заголовок-кнопка с шевроном
            const header = document.createElement('div');
            header.className = 'chg-collapse-header';
            const chev = document.createElement('ion-icon');
            chev.setAttribute('name', 'chevron-down-outline');
            chev.className = 'chg-chevron';
            
            wrap.appendChild(header);
            header.appendChild(head);
            header.appendChild(chev);
            
            // Сворачиваемое содержимое
            const inner = document.createElement('div');
            inner.className = 'chg-collapse-inner';
            inner.appendChild(list);
            wrap.appendChild(inner);
            
            header.addEventListener('click', () => wrap.classList.toggle('collapsed'));
        }
    }
    
    // Ретрай, пока форма ремонта не отрисуется
    let tries = 0;
    const timer = setInterval(() => {
        setup();
        if (++tries > 30) clearInterval(timer);
    }, 1000);
    
    // Мгновенно при изменениях DOM (форма пересоздаётся)
    const rep = document.getElementById('tab-repair');
    if (rep) new MutationObserver(() => setup()).observe(rep, { childList: true, subtree: true });
    setup();
})();