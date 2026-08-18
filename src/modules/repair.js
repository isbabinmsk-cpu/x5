/**
 * Модуль учета ремонта автомобилей
 * @module modules/repair
 */

import { db, auth } from '../config/firebase.js';
import { parseLocalDate, formatDate } from '../utils/dateUtils.js';
import { formatMoney } from '../utils/moneyUtils.js';
import { getCurrentVehicleId, getVehicleNameById } from './vehicle.js';

const COLLECTION_REPAIR = 'repair_records';
const REPAIR_STORAGE_KEY = 'repair_records';

let repairRecords = [];
let editingRepairId = null;
let repairChart = null;
let repairTrendChart = null;
let repairUnsubscribe = null;

/**
 * Категории ремонта
 */
const REPAIR_CATEGORIES = {
  engine: { label: 'Двигатель', icon: 'cog-outline', color: '#FF3B30' },
  transmission: { label: 'Трансмиссия', icon: 'settings-outline', color: '#FF9500' },
  brakes: { label: 'Тормозная система', icon: 'alert-circle-outline', color: '#FF2D55' },
  suspension: { label: 'Подвеска', icon: 'bicycle-outline', color: '#AF52DE' },
  electrics: { label: 'Электрика', icon: 'flash-outline', color: '#007AFF' },
  body: { label: 'Кузов', icon: 'car-outline', color: '#34C759' },
  tires: { label: 'Шины/Диски', icon: 'disc-outline', color: '#5856D6' },
  oil: { label: 'Масло/Жидкости', icon: 'water-outline', color: '#5AC8FA' },
  cooling: { label: 'Охлаждение', icon: 'thermometer-outline', color: '#64D2FF' },
  exhaust: { label: 'Выхлопная система', icon: 'leaf-outline', color: '#8E8E93' },
  other: { label: 'Прочее', icon: 'construct-outline', color: '#636366' }
};

/**
 * Загрузка данных о ремонте
 */
export async function loadRepairRecords() {
  try {
    const saved = localStorage.getItem(REPAIR_STORAGE_KEY);
    if (saved) repairRecords = JSON.parse(saved);

    const vehicleId = getCurrentVehicleId ? getCurrentVehicleId() : 'default';

    if (auth.currentUser && db) {
      const snapshot = await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection(COLLECTION_REPAIR)
        .where('vehicleId', '==', vehicleId)
        .get();

      if (!snapshot.empty) {
        let loadedRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Сортировка по дате (убывание)
        loadedRecords.sort((a, b) => {
          const dateA = parseLocalDate(a.date) || 0;
          const dateB = parseLocalDate(b.date) || 0;
          return dateB - dateA;
        });

        repairRecords = loadedRecords;
        localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
        console.log(`✅ Ремонт загружен из Firebase для авто: ${vehicleId} (${repairRecords.length} записей)`);
      } else {
        repairRecords = [];
        localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
        console.log('ℹ️ Для выбранного автомобиля записей о ремонте нет');
      }
    }

    renderRepairRecords();
    updateRepairStats();
    updateRepairCharts();
  } catch (error) {
    console.error('❌ Ошибка загрузки ремонта:', error);
  }
}

/**
 * Сохранение записи о ремонте в Firebase
 * @param {Object} record - Объект записи
 * @returns {Promise<boolean>}
 */
async function saveRepairRecordToFirebase(record) {
  if (!auth.currentUser || !db) return false;
  
  try {
    const recordToSave = { ...record };
    delete recordToSave.id;
    
    await db.collection('users')
      .doc(auth.currentUser.uid)
      .collection(COLLECTION_REPAIR)
      .doc(record.id)
      .set(recordToSave);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка сохранения в Firebase:', error);
    return false;
  }
}

/**
 * Добавление или обновление записи о ремонте
 * @param {Event} e - Событие submit формы
 */
export async function addRepairRecord(e) {
  e.preventDefault();
  
  const vehicleId = getCurrentVehicleId ? getCurrentVehicleId() : 'default';
  
  // Сбор деталей и работ
  const parts = [];
  const works = [];
  
  document.querySelectorAll('.repair-part-name').forEach(el => {
    const name = el.value.trim();
    const costEl = el.parentElement.querySelector('.repair-part-cost');
    const cost = parseFloat(costEl?.value) || 0;
    if (name && cost > 0) {
      parts.push({ name, cost });
    }
  });
  
  document.querySelectorAll('.repair-work-name').forEach(el => {
    const name = el.value.trim();
    const costEl = el.parentElement.querySelector('.repair-work-cost');
    const cost = parseFloat(costEl?.value) || 0;
    if (name && cost > 0) {
      works.push({ name, cost });
    }
  });
  
  const partsTotal = parts.reduce((sum, p) => sum + p.cost, 0);
  const worksTotal = works.reduce((sum, w) => sum + w.cost, 0);
  const totalCost = partsTotal + worksTotal;
  
  const newRecord = {
    date: document.getElementById('repair-date').value,
    mileage: parseFloat(document.getElementById('repair-mileage').value) || 0,
    category: document.getElementById('repair-category').value,
    description: document.getElementById('repair-description').value.trim(),
    parts,
    works,
    partsTotal,
    worksTotal,
    totalCost,
    vehicleId,
    workshop: document.getElementById('repair-workshop').value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (!newRecord.date || !newRecord.totalCost) {
    alert('Заполните обязательные поля');
    return;
  }

  try {
    if (editingRepairId) {
      // Режим обновления
      const index = repairRecords.findIndex(r => r.id === editingRepairId);
      if (index !== -1) {
        newRecord.id = editingRepairId;
        newRecord.createdAt = repairRecords[index].createdAt;
        repairRecords[index] = newRecord;
        
        await saveRepairRecordToFirebase(newRecord);
        localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
        
        editingRepairId = null;
        const cancelBtn = document.getElementById('cancel-edit-repair');
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        const submitBtn = document.querySelector('#repair-form button[type="submit"]');
        if (submitBtn) {
          submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить ремонт';
          submitBtn.classList.remove('btn-primary');
          submitBtn.classList.add('btn-success');
        }
      }
    } else {
      // Режим создания
      newRecord.id = 'repair_' + Date.now();
      newRecord.createdAt = new Date().toISOString();
      
      repairRecords.unshift(newRecord);
      
      await saveRepairRecordToFirebase(newRecord);
      localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));
    }

    document.getElementById('repair-form').reset();
    document.querySelectorAll('.dynamic-item').forEach(el => el.remove());
    loadRepairRecords();
    
    if (typeof window.showToast === 'function') {
      window.showToast('✅ Успешно', 'Запись о ремонте сохранена', 'success');
    }
  } catch (error) {
    console.error('❌ Ошибка сохранения ремонта:', error);
    alert('Ошибка при сохранении: ' + error.message);
  }
}

/**
 * Редактирование записи о ремонте
 * @param {string} id - ID записи
 */
export function editRepairRecord(id) {
  const record = repairRecords.find(r => r.id === id);
  if (!record) return;

  editingRepairId = id;

  document.getElementById('repair-date').value = record.date;
  document.getElementById('repair-mileage').value = record.mileage;
  document.getElementById('repair-category').value = record.category;
  document.getElementById('repair-description').value = record.description || '';
  document.getElementById('repair-workshop').value = record.workshop || '';

  // Добавляем детали
  const partsContainer = document.getElementById('repair-parts-list');
  if (partsContainer && record.parts) {
    record.parts.forEach(part => {
      const item = document.createElement('div');
      item.className = 'dynamic-item';
      item.innerHTML = `
        <input type="text" class="repair-part-name" placeholder="Название детали" value="${part.name}">
        <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0" value="${part.cost}">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairTotal();">
          <ion-icon name="trash-outline"></ion-icon>
        </button>
      `;
      partsContainer.appendChild(item);
    });
  }

  // Добавляем работы
  const worksContainer = document.getElementById('repair-works-list');
  if (worksContainer && record.works) {
    record.works.forEach(work => {
      const item = document.createElement('div');
      item.className = 'dynamic-item';
      item.innerHTML = `
        <input type="text" class="repair-work-name" placeholder="Название работы" value="${work.name}">
        <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0" value="${work.cost}">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateRepairTotal();">
          <ion-icon name="trash-outline"></ion-icon>
        </button>
      `;
      worksContainer.appendChild(item);
    });
  }

  calculateRepairTotal();

  const cancelBtn = document.getElementById('cancel-edit-repair');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  const submitBtn = document.querySelector('#repair-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> Сохранить изменения';
    submitBtn.classList.remove('btn-success');
    submitBtn.classList.add('btn-primary');
  }

  document.getElementById('repair-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Отмена редактирования
 */
export function cancelEditRepair() {
  editingRepairId = null;
  document.getElementById('repair-form').reset();
  document.querySelectorAll('.dynamic-item').forEach(el => el.remove());
  calculateRepairTotal();

  const cancelBtn = document.getElementById('cancel-edit-repair');
  if (cancelBtn) cancelBtn.style.display = 'none';

  const submitBtn = document.querySelector('#repair-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<ion-icon name="add-circle-outline"></ion-icon> Добавить ремонт';
    submitBtn.classList.remove('btn-primary');
    submitBtn.classList.add('btn-success');
  }
}

/**
 * Удаление записи о ремонте
 * @param {string} id - ID записи
 */
export async function deleteRepairRecord(id) {
  if (!confirm('Удалить эту запись о ремонте?')) return;

  repairRecords = repairRecords.filter(r => r.id !== id);
  localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairRecords));

  if (auth.currentUser && db) {
    try {
      await db.collection('users')
        .doc(auth.currentUser.uid)
        .collection(COLLECTION_REPAIR)
        .doc(id)
        .delete();
    } catch (error) {
      console.error('❌ Ошибка удаления из Firebase:', error);
    }
  }

  if (editingRepairId === id) {
    cancelEditRepair();
  }

  loadRepairRecords();
  
  if (typeof window.showToast === 'function') {
    window.showToast('✅ Удалено', 'Запись удалена', 'success');
  }
}

/**
 * Расчет общей стоимости ремонта
 */
export function calculateRepairTotal() {
  let partsTotal = 0;
  let worksTotal = 0;

  document.querySelectorAll('.repair-part-cost').forEach(el => {
    partsTotal += parseFloat(el.value) || 0;
  });
  
  document.querySelectorAll('.repair-work-cost').forEach(el => {
    worksTotal += parseFloat(el.value) || 0;
  });

  const totalEl = document.getElementById('repair-total');
  if (totalEl) {
    totalEl.textContent = formatMoney(partsTotal + worksTotal);
  }
}

/**
 * Добавление поля детали
 */
export function addRepairPart() {
  const container = document.getElementById('repair-parts-list');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'dynamic-item';
  item.innerHTML = `
    <input type="text" class="repair-part-name" placeholder="Название детали">
    <input type="number" class="repair-part-cost" placeholder="Стоимость" step="0.01" min="0" oninput="window.calculateRepairTotal()">
    <button type="button" class="btn-remove" onclick="this.parentElement.remove(); window.calculateRepairTotal();">
      <ion-icon name="trash-outline"></ion-icon>
    </button>
  `;
  container.appendChild(item);
  calculateRepairTotal();
}

/**
 * Добавление поля работы
 */
export function addRepairWork() {
  const container = document.getElementById('repair-works-list');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'dynamic-item';
  item.innerHTML = `
    <input type="text" class="repair-work-name" placeholder="Название работы">
    <input type="number" class="repair-work-cost" placeholder="Стоимость" step="0.01" min="0" oninput="window.calculateRepairTotal()">
    <button type="button" class="btn-remove" onclick="this.parentElement.remove(); window.calculateRepairTotal();">
      <ion-icon name="trash-outline"></ion-icon>
    </button>
  `;
  container.appendChild(item);
  calculateRepairTotal();
}

/**
 * Рендер списка записей о ремонте
 */
export function renderRepairRecords() {
  const container = document.getElementById('repair-records-list');
  if (!container) return;

  if (repairRecords.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <ion-icon name="construct-outline" size="large"></ion-icon>
        <p>Нет записей о ремонте</p>
        <small>Добавьте первую запись, чтобы отслеживать расходы на ремонт</small>
      </div>
    `;
    return;
  }

  container.innerHTML = repairRecords.map(record => {
    const category = REPAIR_CATEGORIES[record.category] || REPAIR_CATEGORIES.other;
    
    return `
      <div class="repair-record-item">
        <div class="repair-record-header">
          <span class="repair-date">${formatDate(record.date)}</span>
          <span class="repair-mileage">${record.mileage} км</span>
        </div>
        <div class="repair-record-body">
          <div class="repair-category-badge" style="background-color: ${category.color}20; color: ${category.color}">
            <ion-icon name="${category.icon}"></ion-icon>
            <span>${category.label}</span>
          </div>
          <div class="repair-description">${record.description || 'Без описания'}</div>
        </div>
        <div class="repair-record-footer">
          <div class="repair-costs">
            <span class="parts-cost">Детали: ${formatMoney(record.partsTotal)}</span>
            <span class="works-cost">Работы: ${formatMoney(record.worksTotal)}</span>
          </div>
          <div class="repair-total">${formatMoney(record.totalCost)}</div>
        </div>
        ${record.workshop ? `<div class="repair-workshop">📍 ${record.workshop}</div>` : ''}
        <div class="repair-record-actions">
          <button class="btn-icon" onclick="window.editRepairRecord('${record.id}')" title="Редактировать">
            <ion-icon name="create-outline"></ion-icon>
          </button>
          <button class="btn-icon btn-danger" onclick="window.deleteRepairRecord('${record.id}')" title="Удалить">
            <ion-icon name="trash-outline"></ion-icon>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Обновление статистики ремонта
 */
export function updateRepairStats() {
  const totalEl = document.getElementById('repair-total-cost');
  const countEl = document.getElementById('repair-count');
  const avgEl = document.getElementById('repair-avg-cost');

  if (!totalEl || !countEl || !avgEl) return;

  const totalCost = repairRecords.reduce((sum, r) => sum + (r.totalCost || 0), 0);
  const count = repairRecords.length;
  const avgCost = count > 0 ? totalCost / count : 0;

  totalEl.textContent = formatMoney(totalCost);
  countEl.textContent = `${count}`;
  avgEl.textContent = formatMoney(avgCost);
}

/**
 * Обновление графиков ремонта
 */
export function updateRepairCharts() {
  updateRepairCategoryChart();
  updateRepairTrendChart();
}

/**
 * График по категориям
 */
function updateRepairCategoryChart() {
  const ctx = document.getElementById('repair-category-chart');
  if (!ctx) return;

  if (repairChart) {
    repairChart.destroy();
  }

  const categoryData = {};
  repairRecords.forEach(record => {
    const cat = record.category || 'other';
    if (!categoryData[cat]) {
      categoryData[cat] = 0;
    }
    categoryData[cat] += record.totalCost || 0;
  });

  const labels = Object.keys(categoryData).map(key => {
    const cat = REPAIR_CATEGORIES[key] || REPAIR_CATEGORIES.other;
    return cat.label;
  });
  
  const data = Object.values(categoryData);
  const colors = Object.keys(categoryData).map(key => {
    const cat = REPAIR_CATEGORIES[key] || REPAIR_CATEGORIES.other;
    return cat.color;
  });

  repairChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom'
        }
      }
    }
  });
}

/**
 * График тренда расходов
 */
function updateRepairTrendChart() {
  const ctx = document.getElementById('repair-trend-chart');
  if (!ctx) return;

  if (repairTrendChart) {
    repairTrendChart.destroy();
  }

  // Группировка по месяцам
  const monthlyData = {};
  repairRecords.forEach(record => {
    const date = parseLocalDate(record.date);
    if (!date) return;
    
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyData[key]) {
      monthlyData[key] = 0;
    }
    monthlyData[key] += record.totalCost || 0;
  });

  const sortedKeys = Object.keys(monthlyData).sort();
  const labels = sortedKeys.map(key => {
    const [year, month] = key.split('-');
    return `${month}.${year.slice(2)}`;
  });
  
  const data = sortedKeys.map(key => monthlyData[key]);

  repairTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Расходы на ремонт',
        data,
        backgroundColor: 'rgba(255, 59, 48, 0.7)',
        borderColor: '#FF3B30',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => formatMoney(value)
          }
        }
      }
    }
  });
}

// Глобальный экспорт для HTML onclick обработчиков
window.loadRepairRecords = loadRepairRecords;
window.editRepairRecord = editRepairRecord;
window.cancelEditRepair = cancelEditRepair;
window.deleteRepairRecord = deleteRepairRecord;
window.calculateRepairTotal = calculateRepairTotal;
window.addRepairPart = addRepairPart;
window.addRepairWork = addRepairWork;

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('repair-form');
  if (form) form.addEventListener('submit', addRepairRecord);
});
