// ============================================
// ПОЛНЫЙ БЭКАП ВСЕГО ПРИЛОЖЕНИЯ (backup-module.js v2.1)
// ============================================

const BACKUP_VERSION = '2.1';
const BACKUP_FILENAME_PREFIX = 'driver-journal-backup';

// Все ключи localStorage, которые нужно сохранять
const BACKUP_KEYS = [
    'driverRecords',
    'driverTariffs',
    'driverFuelLogs',
    'repair_records',
    'driverShifts',
    'driverVehicles',
    'currentVehicleId',
    'scheduleSettings',
    'driverGoals',
    'driverProfileAvatar',
    'driverTheme',
    'appState',
    'historyViewMode',
    'connectionMode'
];

/**
 * 📦 Создать полный бэкап ВСЕХ данных приложения
 */
function createFullBackup() {
    console.log('📦 Создание полного бэкапа...');
    
    const backup = {
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: '2.1',
        data: {}
    };
    
    let totalSize = 0;
    let itemsCount = 0;
    
    BACKUP_KEYS.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            try {
                const parsed = JSON.parse(value);
                backup.data[key] = parsed;
                totalSize += value.length;
                itemsCount++;
                
                if (Array.isArray(parsed)) {
                    console.log(`  ✅ ${key}: ${parsed.length} записей`);
                } else {
                    console.log(`  ✅ ${key}: сохранено`);
                }
            } catch (e) {
                backup.data[key] = value;
                totalSize += value.length;
                itemsCount++;
            }
        }
    });
    
    // 📊 ДЕТАЛЬНАЯ СТАТИСТИКА
    const repairRecords = backup.data.repair_records || [];
    const fuelLogs = backup.data.driverFuelLogs || [];
    const vehicles = backup.data.driverVehicles || [];
    const avatar = backup.data.driverProfileAvatar;
    
    // Подсчёт фото в ремонтах (проверяем длину строки, чтобы исключить пустые)
    let photosCount = 0;
    let receiptsCount = 0;
    let documentsCount = 0;
    
    repairRecords.forEach(r => {
        const hasReceipt = r.receiptPhotoUrl && r.receiptPhotoUrl.length > 100;
        const hasDocument = r.documentPhotoUrl && r.documentPhotoUrl.length > 100;
        if (hasReceipt) {
            receiptsCount++;
            photosCount++;
        }
        if (hasDocument) {
            documentsCount++;
            photosCount++;
        }
    });
    
    // Разбивка по автомобилям
    const vehicleStats = {};
    vehicles.forEach(v => {
        vehicleStats[v.id] = {
            name: v.name || 'Неизвестно',
            plate: v.plate || '',
            fuelCount: 0,
            repairCount: 0,
            fuelTotal: 0,
            repairTotal: 0
        };
    });
    
    fuelLogs.forEach(log => {
        const vId = log.vehicleId || 'default';
        if (vehicleStats[vId]) {
            vehicleStats[vId].fuelCount++;
            vehicleStats[vId].fuelTotal += log.amount || 0;
        } else {
            // Если авто не найдено, создаём запись
            vehicleStats[vId] = {
                name: 'Неизвестное авто',
                plate: '',
                fuelCount: 1,
                repairCount: 0,
                fuelTotal: log.amount || 0,
                repairTotal: 0
            };
        }
    });
    
    repairRecords.forEach(r => {
        const vId = r.vehicleId || 'default';
        if (vehicleStats[vId]) {
            vehicleStats[vId].repairCount++;
            vehicleStats[vId].repairTotal += r.total || 0;
        } else {
            vehicleStats[vId] = {
                name: 'Неизвестное авто',
                plate: '',
                fuelCount: 0,
                repairCount: 1,
                fuelTotal: 0,
                repairTotal: r.total || 0
            };
        }
    });
    
    const sizeKB = (totalSize / 1024).toFixed(1);
    const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
    
    const stats = {
        itemsCount,
        totalSizeKB: sizeKB,
        totalSizeMB: sizeMB,
        recordsCount: backup.data.driverRecords?.length || 0,
        fuelLogsCount: fuelLogs.length,
        repairCount: repairRecords.length,
        shiftsCount: backup.data.driverShifts?.length || 0,
        vehiclesCount: vehicles.length,
        hasAvatar: !!(avatar && avatar.length > 100),
        photosCount,
        receiptsCount,
        documentsCount,
        vehicleStats
    };
    
    console.log('📊 Статистика бэкапа:', stats);
    console.log(`📏 Размер: ${sizeKB} КБ (${sizeMB} МБ)`);
    console.log(`📸 Фото: ${photosCount} (чеков: ${receiptsCount}, документов: ${documentsCount})`);
    
    const json = JSON.stringify(backup, null, 2);
    
    return { backup, json, stats };
}

/**
 * 💾 Экспорт полного бэкапа в файл
 */
function exportFullBackup() {
    try {
        const { json, stats } = createFullBackup();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const date = new Date().toISOString().split('T')[0];
        const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        const filename = `${BACKUP_FILENAME_PREFIX}_${date}_${time}.json`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Формируем подробное сообщение
        let message = `✅ Бэкап создан!\n\n`;
        message += `📝 Записей: ${stats.recordsCount}\n`;
        message += `⛽ Заправок: ${stats.fuelLogsCount}\n`;
        message += `🔧 Ремонтов: ${stats.repairCount}\n`;
        message += `📅 Смен: ${stats.shiftsCount}\n`;
        message += `🚗 Авто: ${stats.vehiclesCount}\n`;
        
        // Разбивка по авто
        if (stats.vehiclesCount > 0) {
            message += `\n📊 По автомобилям:\n`;
            Object.values(stats.vehicleStats).forEach(v => {
                message += `  • ${v.name}${v.plate ? ' (' + v.plate + ')' : ''}\n`;
                message += `    Заправок: ${v.fuelCount} (${formatMoney(v.fuelTotal)})\n`;
                message += `    Ремонтов: ${v.repairCount} (${formatMoney(v.repairTotal)})\n`;
            });
        }
        
        message += `\n📸 Фото: ${stats.photosCount} (чеков: ${stats.receiptsCount}, документов: ${stats.documentsCount})\n`;
        message += `👤 Аватар: ${stats.hasAvatar ? 'есть' : 'нет'}\n`;
        message += `📏 Размер: ${stats.totalSizeMB} МБ`;
        
        alert(message);
        
    } catch (error) {
        console.error('❌ Ошибка экспорта:', error);
        alert('❌ Ошибка создания бэкапа: ' + error.message);
    }
}

/**
 * 📂 Импорт полного бэкапа из файла
 */
function importFullBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!confirm(`⚠️ Восстановление из бэкапа!\n\n` +
            `Файл: ${file.name}\n` +
            `Размер: ${(file.size / 1024 / 1024).toFixed(2)} МБ\n\n` +
            `ВСЕ текущие данные будут заменены!\n\n` +
            `Продолжить?`)) {
            return;
        }
        
        try {
            const text = await file.text();
            const backup = JSON.parse(text);
            
            if (backup.version && backup.version !== BACKUP_VERSION) {
                console.warn(`⚠️ Версия бэкапа (${backup.version}) отличается от текущей (${BACKUP_VERSION})`);
            }
            
            restoreFromBackup(backup);
            
        } catch (error) {
            console.error('❌ Ошибка чтения файла:', error);
            alert('❌ Файл повреждён или имеет неверный формат:\n' + error.message);
        }
    };
    
    input.click();
}

/**
 * 🔄 Восстановление данных из бэкапа
 */
function restoreFromBackup(backup) {
    console.log('🔄 Восстановление из бэкапа версии', backup.version);
    
    if (!backup.data) {
        backup.data = backup;
    }
    
    BACKUP_KEYS.forEach(key => localStorage.removeItem(key));
    
    let restoredCount = 0;
    Object.entries(backup.data).forEach(([key, value]) => {
        if (BACKUP_KEYS.includes(key)) {
            try {
                const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
                localStorage.setItem(key, stringValue);
                restoredCount++;
                console.log(`  ✅ ${key}: восстановлено`);
            } catch (e) {
                console.error(`  ❌ ${key}: ошибка восстановления`, e);
            }
        }
    });
    
    console.log(`✅ Восстановлено ${restoredCount} элементов`);
    
    alert(`✅ Данные восстановлены!\n\nВосстановлено ${restoredCount} элементов.\n\nПриложение перезагрузится.`);
    
    setTimeout(() => {
        location.reload();
    }, 1500);
}

/**
 * 🗑️ Полный сброс всех данных
 */
function resetAllAppData() {
    if (!confirm('⚠️ ПОЛНЫЙ СБРОС!\n\nВсе данные будут удалены:\n' +
        '• Записи работы\n' +
        '• Тарифы\n' +
        '• Топливо\n' +
        '• Ремонты (включая фото)\n' +
        '• Смены\n' +
        '• Автомобили\n' +
        '• Настройки\n' +
        '• Аватар\n\n' +
        'Это действие НЕЛЬЗЯ отменить!\n\n' +
        'Продолжить?')) {
        return;
    }
    
    if (!confirm('🔴 Вы уверены? Все данные будут УДАЛЕНЫ навсегда!')) {
        return;
    }
    
    BACKUP_KEYS.forEach(key => localStorage.removeItem(key));
    
    alert('✅ Все данные удалены.\nПриложение перезагрузится.');
    setTimeout(() => location.reload(), 1000);
}

// Экспорт в глобальную область
window.exportFullBackup = exportFullBackup;
window.importFullBackup = importFullBackup;
window.resetAllAppData = resetAllAppData;
window.createFullBackup = createFullBackup;

console.log('✅ Модуль полного бэкапа загружен (v2.1)');