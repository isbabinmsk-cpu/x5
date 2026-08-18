/**
 * Денежные утилиты
 * @module utils/moneyUtils
 */

/**
 * Форматирование денежной суммы
 * @param {number} amount - Сумма
 * @param {string} currency - Валюта (по умолчанию 'RUB')
 * @param {string} locale - Локаль (по умолчанию 'ru-RU')
 * @returns {string}
 */
export function formatMoney(amount, currency = 'RUB', locale = 'ru-RU') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount || 0);
}

/**
 * Расчет дохода записи
 * @param {Object} record - Объект записи
 * @returns {number}
 */
export function calcIncome(record) {
  return (
    (parseFloat(record.payPickup) || 0) +
    (parseFloat(record.payDelivery) || 0) +
    (parseFloat(record.payDistance) || 0) +
    (parseFloat(record.payWeight) || 0) +
    (parseFloat(record.loadPay) || 0) +
    (parseFloat(record.rating) || 0) +
    (parseFloat(record.tips) || 0)
  );
}

/**
 * Расчет расходов записи
 * @param {Object} record - Объект записи
 * @returns {number}
 */
export function calcExpenses(record) {
  return (
    (parseFloat(record.fuelCost) || 0) +
    (parseFloat(record.repairCost) || 0) +
    (parseFloat(record.tax) || 0)
  );
}

/**
 * Расчет чистой прибыли
 * @param {Object} record - Объект записи
 * @returns {number}
 */
export function calcNetProfit(record) {
  return calcIncome(record) - calcExpenses(record);
}

/**
 * Округление до 2 знаков после запятой
 * @param {number} value - Число для округления
 * @returns {number}
 */
export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
