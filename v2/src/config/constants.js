/**
 * Глобальные константы приложения
 * @module config/constants
 */

// ===== ЛИМИТЫ И РАЗМЕРЫ =====
export const MAX_IMAGE_SIZE_MB = 1;
export const MAX_IMAGE_DIMENSION = 1200;
export const IMAGE_COMPRESSION_QUALITY = 0.85;
export const IMAGE_COMPRESSION_MIN_QUALITY = 0.1;

// ===== ПАГИНАЦИЯ =====
export const RECORDS_PER_PAGE = 20;
export const SHOW_ALL_THRESHOLD = 100;

// ===== FIREBASE =====
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD93OqstVAnohtNuGZkAxKtr9m1Q3FImlk",
  authDomain: "driver-journal-f6b84.firebaseapp.com",
  projectId: "driver-journal-f6b84",
  storageBucket: "driver-journal-f6b84.firebasestorage.app",
  messagingSenderId: "858380884983",
  appId: "1:858380884983:web:3c109af8e6c81c6910acf2"
};

// ===== ХРАНИЛИЩА localStorage =====
export const STORAGE_KEYS = {
  VEHICLES: 'driverVehicles',
  CURRENT_VEHICLE: 'currentVehicleId',
  FUEL_LOGS: 'driverFuelLogs',
  REPAIR_RECORDS: 'driverRepairRecords',
  RECORDS: 'driverRecords',
  TARIFFS: 'driverTariffs',
  AUTH_STATE: 'driverAuthState',
  APP_STATE: 'appState'
};

// ===== ФИЛЬТРЫ =====
export const DEFAULT_FILTER_STATE = {
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
};

// ===== СОРТИРОВКА =====
export const SORT_DIRECTIONS = {
  ASC: 'asc',
  DESC: 'desc'
};

// ===== ВАЛЮТЫ И ЛОКАЛИ =====
export const CURRENCY = 'RUB';
export const LOCALE = 'ru-RU';

// ===== ТРАНСПОРТНЫЕ ТИПЫ =====
export const VEHICLE_TYPES = {
  DEFAULT: 'default',
  CAR: 'car',
  TRUCK: 'truck',
  MOTORCYCLE: 'motorcycle'
};

// ===== КАТЕГОРИИ РЕМОНТА =====
export const REPAIR_CATEGORIES = [
  'Техническое обслуживание',
  'Шины и диски',
  'Тормозная система',
  'Двигатель',
  'Трансмиссия',
  'Подвеска',
  'Электрика',
  'Кузовной ремонт',
  'Расходные материалы',
  'Другое'
];

// ===== DEBOUNCE DELAYS =====
export const DEBOUNCE = {
  SEARCH: 300,
  FILTER: 500,
  SAVE: 1000
};

// ===== RETRY CONFIG =====
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  DELAY_MS: 1000,
  BACKOFF_MULTIPLIER: 2
};

// ===== АВТО-РАСЧЁТ =====
export const AUTO_CALC_DEFAULTS = {
  km: true,
  weight: true
};

// ===== DEFAULT VEHICLE =====
export const DEFAULT_VEHICLE = {
  id: 'default',
  name: 'Основной автомобиль',
  plate: 'Не указан',
  year: new Date().getFullYear()
};
