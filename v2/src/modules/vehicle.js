/**
 * Модуль управления автомобилями v2
 * @module modules/vehicle
 */

import { db, auth } from '../config/firebase.js';
import { STORAGE_KEYS, DEFAULT_VEHICLE } from '../config/constants.js';
import { getState, setState } from '../store/index.js';

let vehicles = [];
let currentVehicleId = 'default';
let vehicleUnsubscribe = null;
let editingVehicleId = null;

/**
 * Загрузка автомобилей из localStorage и Firebase
 * @returns {Promise<void>}
 */
export async function loadVehicles() {
  try {
    // Локальная загрузка для мгновенного отображения
    const saved = localStorage.getItem(STORAGE_KEYS.VEHICLES);
    if (saved) vehicles = JSON.parse(saved);

    const savedCurrent = localStorage.getItem(STORAGE_KEYS.CURRENT_VEHICLE);
    if (savedCurrent) currentVehicleId = savedCurrent;

    // Гарантируем наличие автомобиля по умолчанию
    const hasDefault = vehicles.some(v => v.id === 'default');
    if (!hasDefault) {
      vehicles.unshift({ ...DEFAULT_VEHICLE });
    }

    // Проверка текущего выбранного автомобиля
    const currentExists = vehicles.some(v => v.id === currentVehicleId);
    if (!currentExists) {
      currentVehicleId = 'default';
    }

    saveVehiclesLocal();
    renderVehicleSelector();
    renderVehicleList();

    // Обновляем состояние в store
    setState('vehicles', vehicles);
    setState('currentVehicleId', currentVehicleId);

    // Real-time синхронизация с Firebase
    if (auth.currentUser && db) {
      if (vehicleUnsubscribe) vehicleUnsubscribe();

      vehicleUnsubscribe = db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('vehicles')
        .onSnapshot((snapshot) => {
          let fbVehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

          const hasDefaultInFb = fbVehicles.some(v => v.id === 'default');
          if (!hasDefaultInFb) {
            fbVehicles.unshift({ ...DEFAULT_VEHICLE });
          }

          vehicles = fbVehicles;

          const currentStillExists = vehicles.some(v => v.id === currentVehicleId);
          if (!currentStillExists) {
            currentVehicleId = 'default';
          }

          saveVehiclesLocal();
          setState('vehicles', vehicles);
          setState('currentVehicleId', currentVehicleId);
          renderVehicleSelector();
          renderVehicleList();
          notifyVehicleChanged();
        }, (error) => {
          console.error('❌ Ошибка real-time слушателя автомобилей:', error);
        });
    } else {
      notifyVehicleChanged();
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки автомобилей:', error);
  }
}

/**
 * Сохранение в localStorage
 * @private
 */
function saveVehiclesLocal() {
  localStorage.setItem(STORAGE_KEYS.VEHICLES, JSON.stringify(vehicles));
  localStorage.setItem(STORAGE_KEYS.CURRENT_VEHICLE, currentVehicleId);
}

/**
 * Добавление или редактирование автомобиля
 * @param {Event} e - Событие submit формы
 * @returns {Promise<void>}
 */
export async function addVehicle(e) {
  e.preventDefault();

  const name = document.getElementById('vehicle-name')?.value.trim();
  const plate = document.getElementById('vehicle-plate')?.value.trim();
  const year = parseInt(document.getElementById('vehicle-year')?.value) || new Date().getFullYear();

  if (!name) {
    alert('Введите название автомобиля');
    return;
  }

  try {
    if (editingVehicleId) {
      // Режим обновления
      const index = vehicles.findIndex(v => v.id === editingVehicleId);
      if (index !== -1) {
        vehicles[index] = {
          ...vehicles[index],
          name,
          plate: plate || 'Без номера',
          year,
          updatedAt: new Date().toISOString()
        };
        saveVehiclesLocal();
        setState('vehicles', vehicles);

        if (auth.currentUser && db) {
          await db.collection('users')
            .doc(auth.currentUser.uid)
            .collection('vehicles')
            .doc(editingVehicleId)
            .set(vehicles[index]);
        }
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
    } else {
      // Режим создания
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
      setState('vehicles', vehicles);
      setState('currentVehicleId', currentVehicleId);

      if (auth.currentUser && db) {
        await db.collection('users')
          .doc(auth.currentUser.uid)
          .collection('vehicles')
          .doc(newVehicle.id)
          .set(newVehicle);
      }
    }

    document.getElementById('vehicle-form')?.reset();
    renderVehicleSelector();
    renderVehicleList();
    notifyVehicleChanged();
  } catch (error) {
    console.error('❌ Ошибка сохранения автомобиля:', error);
    alert('Ошибка при сохранении: ' + error.message);
  }
}

/**
 * Редактирование автомобиля
 * @param {string} id - ID автомобиля
 */
export function editVehicle(id) {
  const vehicle = vehicles.find(v => v.id === id);
  if (!vehicle) return;

  editingVehicleId = id;

  const nameInput = document.getElementById('vehicle-name');
  const plateInput = document.getElementById('vehicle-plate');
  const yearInput = document.getElementById('vehicle-year');

  if (nameInput) nameInput.value = vehicle.name;
  if (plateInput) plateInput.value = vehicle.plate || '';
  if (yearInput) yearInput.value = vehicle.year || new Date().getFullYear();

  const cancelBtn = document.getElementById('cancel-edit-vehicle');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить изменения';
    submitBtn.classList.remove('btn-success');
    submitBtn.classList.add('btn-primary');
  }

  document.getElementById('vehicle-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Отмена редактирования
 */
export function cancelEditVehicle() {
  editingVehicleId = null;
  document.getElementById('vehicle-form')?.reset();

  const cancelBtn = document.getElementById('cancel-edit-vehicle');
  if (cancelBtn) cancelBtn.style.display = 'none';

  const submitBtn = document.querySelector('#vehicle-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить автомобиль';
    submitBtn.classList.remove('btn-primary');
    submitBtn.classList.add('btn-success');
  }
}

/**
 * Удаление автомобиля
 * @param {string} id - ID автомобиля
 * @returns {Promise<void>}
 */
export async function deleteVehicle(id) {
  if (id === 'default' && vehicles.length === 1) {
    alert('Нельзя удалить единственный автомобиль по умолчанию');
    return;
  }

  if (!confirm('Удалить этот автомобиль и все связанные с ним данные?')) return;

  try {
    vehicles = vehicles.filter(v => v.id !== id);
    if (currentVehicleId === id) {
      currentVehicleId = vehicles[0]?.id || 'default';
    }
    saveVehiclesLocal();
    setState('vehicles', vehicles);
    setState('currentVehicleId', currentVehicleId);

    if (auth.currentUser && db) {
      await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('vehicles')
        .doc(id)
        .delete();
    }

    if (editingVehicleId === id) {
      cancelEditVehicle();
    }

    renderVehicleSelector();
    renderVehicleList();
    notifyVehicleChanged();
  } catch (error) {
    console.error('❌ Ошибка удаления автомобиля:', error);
  }
}

/**
 * Выбор автомобиля
 * @param {string} id - ID автомобиля
 */
export function selectVehicle(id) {
  currentVehicleId = id;
  saveVehiclesLocal();
  setState('currentVehicleId', currentVehicleId);
  renderVehicleSelector();
  renderVehicleList();
  notifyVehicleChanged();
}

/**
 * Уведомление других модулей об изменении
 * @private
 */
function notifyVehicleChanged() {
  // Dispatch custom event для реактивности
  window.dispatchEvent(new CustomEvent('vehicle-changed', { 
    detail: { vehicleId: currentVehicleId } 
  }));

  // Вызываем функции загрузки других модулей если они существуют
  if (typeof window.loadFuelLogs === 'function') window.loadFuelLogs();
  if (typeof window.loadRepairRecords === 'function') window.loadRepairRecords();
}

/**
 * Рендер выпадающего списка
 * @private
 */
function renderVehicleSelector() {
  const select = document.getElementById('vehicle-selector');
  if (!select) return;

  select.innerHTML = vehicles.map(v =>
    `<option value="${v.id}" ${v.id === currentVehicleId ? 'selected' : ''}>${v.name} (${v.plate})</option>`
  ).join('');

  select.onchange = (e) => selectVehicle(e.target.value);
}

/**
 * Рендер списка в настройках
 * @private
 */
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
          ? `<button class="btn btn-small btn-primary" onclick="window.selectVehicle('${v.id}')">Выбрать</button>` 
          : '<span class="current-badge">Активен</span>'}
        <button class="btn btn-small btn-secondary" onclick="window.editVehicle('${v.id}')" title="Редактировать">
          <ion-icon name="create-outline"></ion-icon>
        </button>
        <button class="btn btn-small btn-danger" onclick="window.deleteVehicle('${v.id}')" title="Удалить">
          <ion-icon name="trash-outline"></ion-icon>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Получение имени автомобиля по ID
 * @param {string} vehicleId - ID автомобиля
 * @returns {string}
 */
export function getVehicleNameById(vehicleId) {
  if (!vehicleId) return 'Неизвестный автомобиль';
  const vehicle = vehicles.find(v => v.id === vehicleId);
  if (vehicle) {
    return `${vehicle.name} (${vehicle.plate})`;
  }
  return 'Неизвестный автомобиль';
}

// Экспорт для использования в других модулях
export const getCurrentVehicleId = () => currentVehicleId;
export const getVehicles = () => vehicles;

// Глобальный экспорт для HTML onclick обработчиков
window.selectVehicle = selectVehicle;
window.editVehicle = editVehicle;
window.cancelEditVehicle = cancelEditVehicle;
window.deleteVehicle = deleteVehicle;
window.getVehicleNameById = getVehicleNameById;
window.getCurrentVehicleId = getCurrentVehicleId;
window.getVehicles = getVehicles;

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('vehicle-form');
  if (form) form.addEventListener('submit', addVehicle);
  loadVehicles();
});
