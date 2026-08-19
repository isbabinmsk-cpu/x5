/**
 * Утилиты для работы с асинхронными операциями и retry-логикой
 * @module utils/asyncUtils
 */

import { RETRY_CONFIG } from '../config/constants.js';

/**
 * Функция задержки (sleep)
 * @param {number} ms - Миллисекунды
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Выполнение функции с retry-логикой
 * @param {Function} fn - Асинхронная функция для выполнения
 * @param {Object} options - Опции
 * @param {number} [options.maxAttempts=RETRY_CONFIG.MAX_ATTEMPTS] - Максимум попыток
 * @param {number} [options.delayMs=RETRY_CONFIG.DELAY_MS] - Начальная задержка
 * @param {number} [options.backoffMultiplier=RETRY_CONFIG.BACKOFF_MULTIPLIER] - Множитель экспоненциальной задержки
 * @param {Function} [options.onError] - Callback при ошибке (attempt, error)
 * @returns {Promise<any>} Результат выполнения функции
 * @throws {Error} Последняя ошибка, если все попытки исчерпаны
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS,
    delayMs = RETRY_CONFIG.DELAY_MS,
    backoffMultiplier = RETRY_CONFIG.BACKOFF_MULTIPLIER,
    onError
  } = options;

  let lastError;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (onError) {
        onError(attempt, error);
      }

      if (attempt < maxAttempts) {
        console.warn(`⚠️ Попытка ${attempt}/${maxAttempts} не удалась. Следующая через ${currentDelay}мс`);
        await delay(currentDelay);
        currentDelay *= backoffMultiplier; // Экспоненциальное увеличение
      }
    }
  }

  console.error(`❌ Все ${maxAttempts} попыток исчерпаны`);
  throw lastError;
}

/**
 * Debounce функция
 * @param {Function} func - Функция для вызова
 * @param {number} wait - Задержка в мс
 * @returns {Function} Debounced функция
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle функция
 * @param {Function} func - Функция для вызова
 * @param {number} limit - Минимальный интервал между вызовами
 * @returns {Function} Throttled функция
 */
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Обёртка для обработки ошибок в async функциях
 * @param {Promise} promise - Промис
 * @returns {Promise<[error, result]>} Кортеж [ошибка, результат]
 */
export async function to(promise) {
  try {
    const data = await promise;
    return [null, data];
  } catch (error) {
    return [error, null];
  }
}

/**
 * Проверка онлайн-статуса
 * @returns {boolean}
 */
export function isOnline() {
  return navigator.onLine !== false;
}

/**
 * Ожидание онлайн-режима
 * @param {number} timeout - Таймаут в мс
 * @returns {Promise<boolean>}
 */
export async function waitForOnline(timeout = 30000) {
  if (isOnline()) return true;

  return new Promise((resolve) => {
    const handler = () => {
      cleanup();
      resolve(true);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', handler);
    };

    window.addEventListener('online', handler, { once: true });
  });
}
