/**
 * Утилиты для работы с датами
 * @module utils/dateUtils
 */

/**
 * Парсинг даты без смещения часового пояса
 * @param {string} dateStr - Дата в формате YYYY-MM-DD
 * @returns {Date|null}
 */
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(dateStr);
  
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  return new Date(year, month, day);
}

/**
 * Форматирование даты в локальном формате
 * @param {Date|string} date - Дата для форматирования
 * @param {string} locale - Локаль (по умолчанию 'ru-RU')
 * @returns {string}
 */
export function formatDate(date, locale = 'ru-RU') {
  const d = date instanceof Date ? date : parseLocalDate(date);
  if (!d) return '';
  return d.toLocaleDateString(locale);
}

/**
 * Получение периода (месяц, год) из даты
 * @param {string} dateStr - Дата в формате YYYY-MM-DD
 * @returns {{month: number, year: number}}
 */
export function getDatePeriod(dateStr) {
  const date = parseLocalDate(dateStr);
  if (!date) return { month: 0, year: 0 };
  return {
    month: date.getMonth(),
    year: date.getFullYear()
  };
}

/**
 * Проверка попадания даты в диапазон
 * @param {string} dateStr - Проверяемая дата
 * @param {Date} startDate - Начало диапазона
 * @param {Date} endDate - Конец диапазона
 * @returns {boolean}
 */
export function isDateInRange(dateStr, startDate, endDate) {
  const date = parseLocalDate(dateStr);
  if (!date) return false;
  return date >= startDate && date <= endDate;
}
