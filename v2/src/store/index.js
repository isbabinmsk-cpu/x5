/**
 * Модуль управления состоянием приложения (Store)
 * @module store/index
 */

// Состояние приложения
const state = {
  // Пользователь
  currentUser: null,
  
  // Данные
  records: [],
  tariffs: [],
  fuelLogs: [],
  repairRecords: [],
  vehicles: [],
  currentVehicleId: 'default',
  
  // UI состояние
  editingId: null,
  editingFuelId: null,
  editingRepairId: null,
  currentHistoryPage: 1,
  showAllHistoryMode: false,
  
  // Фильтры и сортировка
  filterState: {
    date: { type: 'month', values: [] },
    weekday: { type: 'checkbox', values: [] },
    type: { type: 'checkbox', values: [] },
    hours: { type: 'range', min: '', max: '' },
    ordersPickup: { type: 'range', min: '', max: '' },
    payPickup: { type: 'range', min: '', max: '' },
    ordersDelivery: { type: 'range', min: '', max: '' },
    payDelivery: { type: 'range', min: '', max: '' },
    distance: { type: 'range', min: '', max: '' },
    payDistance: { type: 'range', min: '', max: '' },
    weight: { type: 'range', min: '', max: '' },
    payWeight: { type: 'range', min: '', max: '' },
    loadPay: { type: 'range', min: '', max: '' },
    bonusPay: { type: 'range', min: '', max: '' },
    rating: { type: 'range', min: '', max: '' },
    tips: { type: 'range', min: '', max: '' },
    fuelCost: { type: 'range', min: '', max: '' },
    repairCost: { type: 'range', min: '', max: '' },
    tax: { type: 'range', min: '', max: '' },
    totalIncome: { type: 'range', min: '', max: '' },
    totalExpenses: { type: 'range', min: '', max: '' },
    netProfit: { type: 'range', min: '', max: '' }
  },
  
  sortState: { column: null, direction: null },
  currentFilterColumn: null,
  
  // Режимы
  autoCalcState: {
    km: true,
    weight: true
  },
  
  connectionMode: 'local',
  firebaseErrorReason: ''
};

// Подписчики на изменения
let subscribers = [];

/**
 * Получить состояние
 * @param {string} [path] - Путь к свойству (например, 'currentUser')
 * @returns {any}
 */
export function getState(path) {
  if (!path) return { ...state };
  
  const keys = path.split('.');
  let value = state;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }
  
  return value;
}

/**
 * Установить значение в состоянии
 * @param {string} path - Путь к свойству
 * @param {any} value - Новое значение
 */
export function setState(path, value) {
  const keys = path.split('.');
  let target = state;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in target)) {
      target[key] = {};
    }
    target = target[key];
  }
  
  const lastKey = keys[keys.length - 1];
  const oldValue = target[lastKey];
  
  if (oldValue !== value) {
    target[lastKey] = value;
    notifySubscribers(path, value, oldValue);
  }
}

/**
 * Подписаться на изменения состояния
 * @param {Function} callback - Функция обратного вызова
 * @returns {Function} Функция отписки
 */
export function subscribe(callback) {
  subscribers.push(callback);
  
  return () => {
    const index = subscribers.indexOf(callback);
    if (index !== -1) {
      subscribers.splice(index, 1);
    }
  };
}

/**
 * Уведомить подписчиков об изменении
 * @param {string} path - Измененный путь
 * @param {any} newValue - Новое значение
 * @param {any} oldValue - Старое значение
 */
function notifySubscribers(path, newValue, oldValue) {
  subscribers.forEach(callback => {
    try {
      callback({ path, newValue, oldValue });
    } catch (error) {
      console.error('Ошибка в подписчике store:', error);
    }
  });
}

/**
 * Очистить состояние (при выходе)
 */
export function clearState() {
  state.currentUser = null;
  state.records = [];
  state.tariffs = [];
  state.fuelLogs = [];
  state.repairRecords = [];
  state.vehicles = [];
  state.currentVehicleId = 'default';
  state.editingId = null;
  state.editingFuelId = null;
  state.editingRepairId = null;
  state.currentHistoryPage = 1;
  state.showAllHistoryMode = false;
  state.connectionMode = 'local';
  state.firebaseErrorReason = '';
  
  notifySubscribers('all', null, null);
}

/**
 * Загрузить состояние из localStorage
 */
export function loadFromStorage() {
  try {
    const saved = localStorage.getItem('appState');
    if (saved) {
      const parsed = JSON.parse(saved);
      
      // Восстанавливаем только безопасные поля
      if (parsed.autoCalcState) {
        state.autoCalcState = { ...state.autoCalcState, ...parsed.autoCalcState };
      }
      if (parsed.filterState) {
        state.filterState = { ...state.filterState, ...parsed.filterState };
      }
      if (parsed.currentVehicleId) {
        state.currentVehicleId = parsed.currentVehicleId;
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки состояния из localStorage:', error);
  }
}

/**
 * Сохранить состояние в localStorage
 */
export function saveToStorage() {
  try {
    const toSave = {
      autoCalcState: state.autoCalcState,
      filterState: state.filterState,
      currentVehicleId: state.currentVehicleId
    };
    
    localStorage.setItem('appState', JSON.stringify(toSave));
  } catch (error) {
    console.error('Ошибка сохранения состояния в localStorage:', error);
  }
}

/**
 * Получить селектор для записей с фильтрацией и сортировкой
 * @returns {Array}
 */
export function getFilteredRecords() {
  let result = [...state.records];
  
  // Применяем фильтры
  const filters = state.filterState;
  
  // Пример фильтра по дате
  if (filters.date.values && filters.date.values.length > 0) {
    const { parseLocalDate } = require('../utils/dateUtils.js');
    
    if (filters.date.type === 'month') {
      result = result.filter(record => {
        const recordDate = parseLocalDate(record.date);
        return filters.date.values.some(month => {
          const [year, monthNum] = month.split('-').map(Number);
          return recordDate.getFullYear() === year && 
                 recordDate.getMonth() === monthNum - 1;
        });
      });
    }
  }
  
  // Применяем сортировку
  if (state.sortState.column && state.sortState.direction) {
    const { column, direction } = state.sortState;
    const multiplier = direction === 'asc' ? 1 : -1;
    
    result.sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];
      
      // Числовое сравнение
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * multiplier;
      }
      
      // Строковое сравнение
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * multiplier;
      }
      
      // Дата
      if (column === 'date') {
        const { parseLocalDate } = require('../utils/dateUtils.js');
        const dateA = parseLocalDate(aVal) || 0;
        const dateB = parseLocalDate(bVal) || 0;
        return (dateA - dateB) * multiplier;
      }
      
      return 0;
    });
  }
  
  return result;
}

// Экспорт констант
export const RECORDS_PER_PAGE = 20;

// Инициализация
loadFromStorage();

// Автосохранение при изменениях
subscribe(() => {
  saveToStorage();
});
