/**
 * Модуль учета топлива
 * @module modules/fuel
 */

import { db, auth } from '../config/firebase.js';
import { parseLocalDate, formatDate } from '../utils/dateUtils.js';
import { formatMoney } from '../utils/moneyUtils.js';
import { getCurrentVehicleId } from './vehicle.js';

const FUEL_STORAGE_KEY = 'driverFuelLogs';

let fuelLogs = [];
let editingFuelId = null;
let fuelChartInstance = null;
let fuelUnsubscribe = null;

/**
 * Загрузка данных о топливе
 */
export async function loadFuelLogs() {
  try {
    const saved = localStorage.getItem(FUEL_STORAGE_KEY);
    if (saved) fuelLogs = JSON.parse(saved);

    const vehicleId = getCurrentVehicleId ? getCurrentVehicleId() : 'default';

    if (auth.currentUser && db) {
      const snapshot = await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('fuelLogs')
        .where('vehicleId', '==', vehicleId)
        .get();

      if (!snapshot.empty) {
        let loadedLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Сортировка по дате (убывание)
        loadedLogs.sort((a, b) => {
          const dateA = parseLocalDate(a.date) || 0;
          const dateB = parseLocalDate(b.date) || 0;
          return dateB - dateA;
        });

        fuelLogs = loadedLogs;
        localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
        console.log(`✅ Топливо загружено из Firebase для авто: ${vehicleId} (${fuelLogs.length} заправок)`);
      } else {
        fuelLogs = [];
        localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
        console.log('ℹ️ Для выбранного автомобиля записей о топливе нет');
      }
    }

    renderFuelLogs();
    updateFuelStats();
    updateFuelChart();

    // Синхронизация с основными записями
    if (typeof window.syncFuelToRecords === 'function') {
      await window.syncFuelToRecords();
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки топлива:', error);
  }
}

/**
 * Расчет расхода топлива
 * @param {Array} logs - Массив записей о заправках
 * @returns {Array}
 */
export function calculateFuelConsumption(logs) {
  const sorted = [...logs].sort((a, b) => (a.mileage || 0) - (b.mileage || 0));
  
  sorted.forEach((log, index) => {
    if (index === 0) {
      log.consumption = null;
      log.costPerKm = null;
    } else {
      const diff = log.mileage - sorted[index - 1].mileage;
      if (diff > 0) {
        log.consumption = (log.liters / diff) * 100;
        log.costPerKm = log.amount / diff;
      } else {
        log.consumption = null;
        log.costPerKm = null;
      }
    }
    log.pricePerLiter = log.liters > 0 ? log.amount / log.liters : 0;
  });
  
  return sorted;
}

/**
 * Сохранение записи о топливе в Firebase
 * @param {Object} log - Объект записи
 * @returns {Promise<boolean>}
 */
async function saveFuelLogToFirebase(log) {
  if (!auth.currentUser || !db) return false;
  
  try {
    const logToSave = { ...log };
    delete logToSave.id;
    
    await db.collection('users')
      .doc(auth.currentUser.uid)
      .collection('fuelLogs')
      .doc(log.id)
      .set(logToSave);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка сохранения в Firebase:', error);
    return false;
  }
}

/**
 * Добавление или обновление записи о топливе
 * @param {Event} e - Событие submit формы
 */
export async function addFuelLog(e) {
  e.preventDefault();
  
  const vehicleId = getCurrentVehicleId ? getCurrentVehicleId() : 'default';
  
  const newLog = {
    date: document.getElementById('fuel-date').value,
    mileage: parseFloat(document.getElementById('fuel-mileage').value) || 0,
    liters: parseFloat(document.getElementById('fuel-liters').value) || 0,
    amount: parseFloat(document.getElementById('fuel-amount').value) || 0,
    gasStation: document.getElementById('fuel-gas-station').value.trim(),
    fuelType: document.getElementById('fuel-type').value,
    vehicleId,
    updatedAt: new Date().toISOString()
  };

  if (!newLog.date || !newLog.mileage || !newLog.liters || !newLog.amount) {
    alert('Заполните все обязательные поля');
    return;
  }

  try {
    if (editingFuelId) {
      // Режим обновления
      const index = fuelLogs.findIndex(l => l.id === editingFuelId);
      if (index !== -1) {
        newLog.id = editingFuelId;
        newLog.createdAt = fuelLogs[index].createdAt;
        fuelLogs[index] = newLog;
        
        await saveFuelLogToFirebase(newLog);
        localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
        
        editingFuelId = null;
        const cancelBtn = document.getElementById('cancel-edit-fuel');
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        const submitBtn = document.querySelector('#fuel-form button[type="submit"]');
        if (submitBtn) {
          submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить заправку';
          submitBtn.classList.remove('btn-primary');
          submitBtn.classList.add('btn-success');
        }
      }
    } else {
      // Режим создания
      newLog.id = 'fuel_' + Date.now();
      newLog.createdAt = new Date().toISOString();
      
      fuelLogs.unshift(newLog);
      
      await saveFuelLogToFirebase(newLog);
      localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));
    }

    document.getElementById('fuel-form').reset();
    loadFuelLogs();
    
    if (typeof window.showToast === 'function') {
      window.showToast('✅ Успешно', 'Запись сохранена', 'success');
    }
  } catch (error) {
    console.error('❌ Ошибка сохранения топлива:', error);
    alert('Ошибка при сохранении: ' + error.message);
  }
}

/**
 * Редактирование записи о топливе
 * @param {string} id - ID записи
 */
export function editFuelLog(id) {
  const log = fuelLogs.find(l => l.id === id);
  if (!log) return;

  editingFuelId = id;

  document.getElementById('fuel-date').value = log.date;
  document.getElementById('fuel-mileage').value = log.mileage;
  document.getElementById('fuel-liters').value = log.liters;
  document.getElementById('fuel-amount').value = log.amount;
  document.getElementById('fuel-gas-station').value = log.gasStation || '';
  document.getElementById('fuel-type').value = log.fuelType || 'ai95';

  const cancelBtn = document.getElementById('cancel-edit-fuel');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  const submitBtn = document.querySelector('#fuel-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить изменения';
    submitBtn.classList.remove('btn-success');
    submitBtn.classList.add('btn-primary');
  }

  document.getElementById('fuel-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Отмена редактирования
 */
export function cancelEditFuel() {
  editingFuelId = null;
  document.getElementById('fuel-form').reset();

  const cancelBtn = document.getElementById('cancel-edit-fuel');
  if (cancelBtn) cancelBtn.style.display = 'none';

  const submitBtn = document.querySelector('#fuel-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить заправку';
    submitBtn.classList.remove('btn-primary');
    submitBtn.classList.add('btn-success');
  }
}

/**
 * Удаление записи о топливе
 * @param {string} id - ID записи
 */
export async function deleteFuelLog(id) {
  if (!confirm('Удалить эту запись о заправке?')) return;

  fuelLogs = fuelLogs.filter(l => l.id !== id);
  localStorage.setItem(FUEL_STORAGE_KEY, JSON.stringify(fuelLogs));

  if (auth.currentUser && db) {
    try {
      await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection('fuelLogs')
        .doc(id)
        .delete();
    } catch (error) {
      console.error('❌ Ошибка удаления из Firebase:', error);
    }
  }

  if (editingFuelId === id) {
    cancelEditFuel();
  }

  loadFuelLogs();
  
  if (typeof window.showToast === 'function') {
    window.showToast('✅ Удалено', 'Запись удалена', 'success');
  }
}

/**
 * Рендер списка записей о топливе
 */
export function renderFuelLogs() {
  const container = document.getElementById('fuel-logs-list');
  if (!container) return;

  if (fuelLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <ion-icon name="flame-outline" size="large"></ion-icon>
        <p>Нет записей о заправках</p>
        <small>Добавьте первую запись, чтобы отслеживать расход топлива</small>
      </div>
    `;
    return;
  }

  const logs = calculateFuelConsumption(fuelLogs);

  container.innerHTML = logs.map(log => `
    <div class="fuel-log-item">
      <div class="fuel-log-header">
        <span class="fuel-date">${formatDate(log.date)}</span>
        <span class="fuel-mileage">${log.mileage} км</span>
      </div>
      <div class="fuel-log-body">
        <div class="fuel-info">
          <span class="fuel-liters">${log.liters} л</span>
          <span class="fuel-amount">${formatMoney(log.amount)}</span>
        </div>
        <div class="fuel-consumption">
          ${log.consumption ? `<span class="consumption-value">${log.consumption.toFixed(1)} л/100км</span>` : '<span class="consumption-value">-</span>'}
        </div>
      </div>
      <div class="fuel-log-footer">
        <span class="gas-station">${log.gasStation || 'Без названия'}</span>
        <span class="fuel-type">${getFuelTypeName(log.fuelType)}</span>
      </div>
      <div class="fuel-log-actions">
        <button class="btn-icon" onclick="window.editFuelLog('${log.id}')" title="Редактировать">
          <ion-icon name="create-outline"></ion-icon>
        </button>
        <button class="btn-icon btn-danger" onclick="window.deleteFuelLog('${log.id}')" title="Удалить">
          <ion-icon name="trash-outline"></ion-icon>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Получение названия типа топлива
 * @param {string} type - Тип топлива
 * @returns {string}
 */
function getFuelTypeName(type) {
  const names = {
    'ai92': 'АИ-92',
    'ai95': 'АИ-95',
    'ai98': 'АИ-98',
    'diesel': 'ДТ',
    'gas': 'Газ'
  };
  return names[type] || type || 'Не указан';
}

/**
 * Обновление статистики топлива
 */
export function updateFuelStats() {
  const totalLitersEl = document.getElementById('fuel-total-liters');
  const totalAmountEl = document.getElementById('fuel-total-amount');
  const avgConsumptionEl = document.getElementById('fuel-avg-consumption');
  const avgPriceEl = document.getElementById('fuel-avg-price');

  if (!totalLitersEl || !totalAmountEl || !avgConsumptionEl || !avgPriceEl) return;

  const logs = calculateFuelConsumption(fuelLogs);
  
  const totalLiters = logs.reduce((sum, log) => sum + (log.liters || 0), 0);
  const totalAmount = logs.reduce((sum, log) => sum + (log.amount || 0), 0);
  
  const consumptionValues = logs.filter(l => l.consumption !== null).map(l => l.consumption);
  const avgConsumption = consumptionValues.length > 0 
    ? consumptionValues.reduce((sum, val) => sum + val, 0) / consumptionValues.length 
    : 0;
  
  const avgPrice = totalLiters > 0 ? totalAmount / totalLiters : 0;

  totalLitersEl.textContent = `${totalLiters.toFixed(1)} л`;
  totalAmountEl.textContent = formatMoney(totalAmount);
  avgConsumptionEl.textContent = `${avgConsumption.toFixed(1)} л/100км`;
  avgPriceEl.textContent = formatMoney(avgPrice);
}

/**
 * Обновление графика топлива
 */
export function updateFuelChart() {
  const ctx = document.getElementById('fuel-chart');
  if (!ctx) return;

  if (fuelChartInstance) {
    fuelChartInstance.destroy();
  }

  const logs = [...fuelLogs].reverse();
  
  const labels = logs.map(log => formatDate(log.date));
  const consumptionData = logs.map(log => log.consumption || 0);
  const priceData = logs.map(log => log.pricePerLiter || 0);

  fuelChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Расход (л/100км)',
          data: consumptionData,
          borderColor: '#FF9500',
          backgroundColor: 'rgba(255, 149, 0, 0.1)',
          yAxisID: 'y',
          tension: 0.3
        },
        {
          label: 'Цена за литр',
          data: priceData,
          borderColor: '#007AFF',
          backgroundColor: 'rgba(0, 122, 255, 0.1)',
          yAxisID: 'y1',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'л/100км'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: '₽/л'
          }
        }
      }
    }
  });
}

// Глобальный экспорт для HTML onclick обработчиков
window.loadFuelLogs = loadFuelLogs;
window.editFuelLog = editFuelLog;
window.cancelEditFuel = cancelEditFuel;
window.deleteFuelLog = deleteFuelLog;

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('fuel-form');
  if (form) form.addEventListener('submit', addFuelLog);
});
