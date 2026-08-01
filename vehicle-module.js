// =============================================
// МОДУЛЬ УПРАВЛЕНИЯ АВТОМОБИЛЯМИ
// =============================================
const VEHICLES_STORAGE_KEY = 'driverVehicles';
const CURRENT_VEHICLE_KEY = 'currentVehicleId';

let vehicles = [];
let currentVehicleId = 'default';
let editingVehicleId = null; // НОВОЕ: для отслеживания режима редактирования

// 1. ЗАГРУЗКА АВТОМОБИЛЕЙ
async function loadVehicles() {
  try {
    const saved = localStorage.getItem(VEHICLES_STORAGE_KEY);
    if (saved) vehicles = JSON.parse(saved);
    
    const savedCurrent = localStorage.getItem(CURRENT_VEHICLE_KEY);
    if (savedCurrent) currentVehicleId = savedCurrent;
    
    // Всегда добавляем автомобиль по умолчанию, если его нет
    const hasDefault = vehicles.some(v => v.id === 'default');
    if (!hasDefault) {
      const defaultCar = {
        id: 'default',
        name: 'Основной автомобиль',
        plate: 'Не указан',
        year: new Date().getFullYear()
      };
      vehicles.unshift(defaultCar);
      console.log('✅ Добавлен автомобиль по умолчанию');
    }
    
    // Если текущий автомобиль не существует, переключаемся на default
    const currentExists = vehicles.some(v => v.id === currentVehicleId);
    if (!currentExists) {
      currentVehicleId = 'default';
      console.log('⚠️ Текущий автомобиль не найден, переключено на default');
    }
    
    saveVehiclesLocal();
    
    // Синхронизация с Firebase
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
      const snap = await db.collection('users').doc(auth.currentUser.uid).collection('vehicles').get();
      if (!snap.empty) {
        const fbVehicles = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Добавляем автомобили из Firebase, которых нет локально
        fbVehicles.forEach(fbCar => {
          const exists = vehicles.some(v => v.id === fbCar.id);
          if (!exists) vehicles.push(fbCar);
        });
        
        saveVehiclesLocal();
      }
    }
    
    renderVehicleSelector();
    renderVehicleList();
    notifyVehicleChanged();
    
  } catch (error) {
    console.error('❌ Ошибка загрузки автомобилей:', error);
  }
}

// 2. СОХРАНЕНИЕ ЛОКАЛЬНО
function saveVehiclesLocal() {
  localStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify(vehicles));
  localStorage.setItem(CURRENT_VEHICLE_KEY, currentVehicleId);
}

// 3. ДОБАВЛЕНИЕ ИЛИ РЕДАКТИРОВАНИЕ АВТОМОБИЛЯ
async function addVehicle(e) {
  e.preventDefault();
  const name = document.getElementById('vehicle-name').value.trim();
  const plate = document.getElementById('vehicle-plate').value.trim();
  const year = parseInt(document.getElementById('vehicle-year').value) || new Date().getFullYear();
  
  if (!name) {
    alert('Введите название автомобиля');
    return;
  }
  
  if (editingVehicleId) {
    // РЕЖИМ РЕДАКТИРОВАНИЯ
    const index = vehicles.findIndex(v => v.id === editingVehicleId);
    if (index !== -1) {
      vehicles[index] = {
        ...vehicles[index],
        name,
        plate: plate || 'Без номера',
        year: year,
        updatedAt: new Date().toISOString()
      };
      saveVehiclesLocal();
      
      // Обновляем в Firebase
      if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
        await db.collection('users').doc(auth.currentUser.uid).collection('vehicles').doc(editingVehicleId).set(vehicles[index]);
      }
      
      console.log('✅ Автомобиль отредактирован:', name);
    }
    
    // Выходим из режима редактирования
    editingVehicleId = null;
    const cancelBtn = document.getElementById('cancel-edit-vehicle');
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
    if (submitBtn) {
      submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить автомобиль';
      submitBtn.classList.remove('btn-primary');
      submitBtn.classList.add('btn-success');
    }
    
    if (typeof safeShowToast === 'function') safeShowToast('Успех', 'Автомобиль обновлен!', 'success');
    else alert('✅ Автомобиль обновлен!');
    
  } else {
    // РЕЖИМ СОЗДАНИЯ
    const newVehicle = {
      id: 'car_' + Date.now(),
      name,
      plate: plate || 'Без номера',
      year: year,
      createdAt: new Date().toISOString()
    };
    
    vehicles.push(newVehicle);
    currentVehicleId = newVehicle.id;
    saveVehiclesLocal();
    
    // Сохраняем в Firebase
    if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
      await db.collection('users').doc(auth.currentUser.uid).collection('vehicles').doc(newVehicle.id).set(newVehicle);
    }
    
    console.log('✅ Автомобиль добавлен:', name);
    if (typeof safeShowToast === 'function') safeShowToast('Успех', 'Автомобиль добавлен!', 'success');
    else alert('✅ Автомобиль добавлен!');
  }
  
  document.getElementById('vehicle-form').reset();
  renderVehicleSelector();
  renderVehicleList();
  notifyVehicleChanged();
}

// 4. РЕДАКТИРОВАНИЕ АВТОМОБИЛЯ
function editVehicle(id) {
  const vehicle = vehicles.find(v => v.id === id);
  if (!vehicle) return;
  
  editingVehicleId = id;
  
  // Заполняем форму данными автомобиля
  document.getElementById('vehicle-name').value = vehicle.name;
  document.getElementById('vehicle-plate').value = vehicle.plate || '';
  document.getElementById('vehicle-year').value = vehicle.year || new Date().getFullYear();
  
  // Показываем кнопку отмены
  const cancelBtn = document.getElementById('cancel-edit-vehicle');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  
  // Меняем текст кнопки сохранения
  const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить изменения';
    submitBtn.classList.remove('btn-success');
    submitBtn.classList.add('btn-primary');
  }
  
  // Прокручиваем к форме
  document.getElementById('vehicle-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  if (typeof safeShowToast === 'function') safeShowToast('✏️', 'Редактирование автомобиля', 'info', 2000);
}

// 5. ОТМЕНА РЕДАКТИРОВАНИЯ
function cancelEditVehicle() {
  editingVehicleId = null;
  document.getElementById('vehicle-form').reset();
  
  const cancelBtn = document.getElementById('cancel-edit-vehicle');
  if (cancelBtn) cancelBtn.style.display = 'none';
  
  const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить автомобиль';
    submitBtn.classList.remove('btn-primary');
    submitBtn.classList.add('btn-success');
  }
}

// 6. УДАЛЕНИЕ АВТОМОБИЛЯ
async function deleteVehicle(id) {
  if (id === 'default' && vehicles.length === 1) {
    alert('Нельзя удалить единственный автомобиль по умолчанию');
    return;
  }
  if (!confirm('Удалить этот автомобиль и все связанные с ним данные?')) return;
  
  vehicles = vehicles.filter(v => v.id !== id);
  if (currentVehicleId === id) {
    currentVehicleId = vehicles[0].id;
  }
  saveVehiclesLocal();
  
  if (typeof auth !== 'undefined' && auth.currentUser && typeof db !== 'undefined') {
    await db.collection('users').doc(auth.currentUser.uid).collection('vehicles').doc(id).delete();
  }
  
  // Если редактировали этот автомобиль, отменяем редактирование
  if (editingVehicleId === id) {
    cancelEditVehicle();
  }
  
  renderVehicleSelector();
  renderVehicleList();
  notifyVehicleChanged();
  
  if (typeof safeShowToast === 'function') safeShowToast('Успех', 'Автомобиль удален', 'success');
}

// 7. ВЫБОР АВТОМОБИЛЯ
function selectVehicle(id) {
  currentVehicleId = id;
  saveVehiclesLocal();
  renderVehicleSelector();
  renderVehicleList();
  notifyVehicleChanged();
}

// 8. УВЕДОМЛЕНИЕ ДРУГИХ МОДУЛЕЙ ОБ ИЗМЕНЕНИИ
function notifyVehicleChanged() {
  console.log('🚗 Автомобиль изменен на:', currentVehicleId);
  if (typeof loadFuelLogs === 'function') loadFuelLogs();
  if (typeof loadRepairRecords === 'function') loadRepairRecords();
}

// 9. РЕНДЕР ВЫПАДАЮЩЕГО СПИСКА
function renderVehicleSelector() {
  const select = document.getElementById('vehicle-selector');
  if (!select) return;
  
  select.innerHTML = vehicles.map(v =>
    `<option value="${v.id}" ${v.id === currentVehicleId ? 'selected' : ''}>${v.name} (${v.plate})</option>`
  ).join('');
  
  select.onchange = (e) => selectVehicle(e.target.value);
}

// 10. РЕНДЕР СПИСКА В НАСТРОЙКАХ
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
        ${v.id !== currentVehicleId ? `<button class="btn btn-small btn-primary" onclick="selectVehicle('${v.id}')">Выбрать</button>` : '<span class="current-badge">Активен</span>'}
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

// 11. ИНИЦИАЛИЗАЦИЯ
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('vehicle-form');
  if (form) form.addEventListener('submit', addVehicle);
  
  loadVehicles();
});

// Экспорт для использования в других модулях
window.getCurrentVehicleId = () => currentVehicleId;
window.getVehicles = () => vehicles;
window.loadVehicles = loadVehicles;
window.editVehicle = editVehicle;
window.cancelEditVehicle = cancelEditVehicle;
window.deleteVehicle = deleteVehicle;
window.selectVehicle = selectVehicle;