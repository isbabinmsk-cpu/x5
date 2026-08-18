# Журнал работы водителя (Courier App)

Веб-приложение для учета доходов и расходов водителей курьерских служб.

## 📁 Структура проекта

```
/workspace
├── src/                          # Рефакторированный код (ES6 модули)
│   ├── config/
│   │   └── firebase.js           # Конфигурация Firebase
│   ├── utils/
│   │   ├── dateUtils.js          # Утилиты дат
│   │   ├── moneyUtils.js         # Денежные утилиты
│   │   └── imageCompressor.js    # Сжатие изображений
│   ├── modules/
│   │   ├── vehicle.js            # Модуль автомобилей
│   │   ├── fuel.js               # Модуль топлива
│   │   └── repair.js             # Модуль ремонта
│   └── store/
│       └── index.js              # Управление состоянием
│
├── index.html                    # Основной HTML
├── style.css                     # Стили (iOS 2026 Light Theme)
├── script.js                     # Основная логика (оригинал)
├── data.js                       # Начальные данные
├── firebase-config.js            # Firebase конфиг (оригинал)
├── fuel-module.js                # Учет топлива (оригинал)
├── repair-module.js              # Ремонт (оригинал)
├── vehicle-module.js             # Автомобили (оригинал)
├── README.md                     # Этот файл
└── REFACTORING_GUIDE.md          # Руководство по рефакторингу
```

## 🚀 Возможности

### Основные
- ✅ Учет рабочих дней и заказов
- ✅ Расчет доходов по различным параметрам
- ✅ Учет расходов (топливо, ремонт, налоги)
- ✅ Аналитика и графики
- ✅ Экспорт данных (Excel, PDF)

### Модуль автомобилей
- ✅ Управление несколькими автомобилями
- ✅ Выбор активного автомобиля
- ✅ Синхронизация с Firebase

### Модуль топлива
- ✅ Учет заправок
- ✅ Расчет расхода (л/100км)
- ✅ Отслеживание цены за литр
- ✅ Графики расхода и цен

### Модуль ремонта
- ✅ Учет ремонтов по категориям
- ✅ Детализация (запчасти + работы)
- ✅ Статистика по категориям
- ✅ График тренда расходов

## 🔧 Технологии

- **Frontend**: Vanilla JavaScript (ES6+)
- **Backend**: Firebase (Firestore, Auth)
- **Стили**: CSS3 (iOS дизайн)
- **Графики**: Chart.js
- **Экспорт**: XLSX, html2pdf

## 📦 Модульная структура

### Utils (Утилиты)

#### `utils/dateUtils.js`
```javascript
import { parseLocalDate, formatDate, getDatePeriod, isDateInRange } from './utils/dateUtils.js';

const date = parseLocalDate('2024-01-15');
console.log(formatDate(date)); // "15.01.2024"
```

#### `utils/moneyUtils.js`
```javascript
import { formatMoney, calcIncome, calcExpenses, calcNetProfit } from './utils/moneyUtils.js';

console.log(formatMoney(15000)); // "15 000,00 ₽"
```

#### `utils/imageCompressor.js`
```javascript
import { compressImage } from './utils/imageCompressor.js';

const compressed = await compressImage(file, 1); // 1 MB max
```

### Modules (Бизнес-логика)

#### `modules/vehicle.js`
```javascript
import { loadVehicles, addVehicle, editVehicle, deleteVehicle, selectVehicle } from './modules/vehicle.js';

await loadVehicles();
await addVehicle(event);
selectVehicle('car_123');
```

#### `modules/fuel.js`
```javascript
import { loadFuelLogs, addFuelLog, editFuelLog, deleteFuelLog } from './modules/fuel.js';

await loadFuelLogs();
await addFuelLog(event);
editFuelLog('fuel_456');
```

#### `modules/repair.js`
```javascript
import { loadRepairRecords, addRepairRecord, editRepairRecord, deleteRepairRecord } from './modules/repair.js';

await loadRepairRecords();
await addRepairRecord(event);
```

### Store (Состояние)

```javascript
import { getState, setState, subscribe, clearState } from './store/index.js';

// Получить значение
const currentUser = getState('currentUser');

// Установить значение
setState('currentUser', user);

// Подписка на изменения
const unsubscribe = subscribe(({ path, newValue, oldValue }) => {
  console.log(`Changed ${path}:`, oldValue, '→', newValue);
});

// Очистка при выходе
clearState();
```

## 🔐 Firebase конфигурация

Приложение использует Firebase для:
- Аутентификации пользователей
- Синхронизации данных между устройствами
- Хранения истории записей

Конфигурация находится в `src/config/firebase.js`.

## 🎨 Дизайн

Приложение использует тему **iOS 2026 Light** с:
- Адаптивным дизайном (Mobile/Tablet/Desktop)
- Плавными анимациями
- Тактильной обратной связью
- Accessibility поддержкой

## 📱 PWA возможности

- Установка на домашний экран
- Работа офлайн (localStorage)
- Автономный режим отображения

## 🔮 Планы развития

1. **Миграция на ES6 модули** - постепенный перенос старого кода
2. **Добавление TypeScript** - типизация всего кода
3. **Сборщик Vite/Webpack** - оптимизация бандла
4. **Unit тесты** - покрытие критического функционала
5. **CI/CD** - автоматический деплой

## 📝 Лицензия

MIT License

---

**Разработано с ❤️ для водителей курьерских служб**
