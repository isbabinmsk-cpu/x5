/**
 * Утилиты для сжатия изображений
 * @module utils/imageCompressor
 */

/**
 * Сжатие изображения с автоматическим подбором качества
 * @param {File} file - Исходный файл изображения
 * @param {number} maxSizeMB - Максимальный размер в МБ (по умолчанию 1)
 * @returns {Promise<string>} Base64 строка сжатого изображения
 */
export async function compressImage(file, maxSizeMB = 1) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      
      img.onload = () => {
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');

        // Ограничиваем максимальные размеры
        let width = img.width;
        let height = img.height;
        const MAX_DIMENSION = 1200;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round(height * (MAX_DIMENSION / width));
            width = MAX_DIMENSION;
          } else {
            width = Math.round(width * (MAX_DIMENSION / height));
            height = MAX_DIMENSION;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Итеративное сжатие JPEG
        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        while ((dataUrl.length * 0.75) > (maxSizeMB * 1024 * 1024) && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        // Если всё ещё слишком большое, уменьшаем размер холста
        if ((dataUrl.length * 0.75) > (maxSizeMB * 1024 * 1024)) {
          canvas.width = Math.round(width / 2);
          canvas.height = Math.round(height / 2);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        }

        console.log(
          `✅ Изображение сжато: ${(file.size / 1024 / 1024).toFixed(2)} МБ -> ` +
          `${(dataUrl.length * 0.75 / 1024 / 1024).toFixed(2)} МБ`
        );
        
        resolve(dataUrl);
      };
      
      img.onerror = reject;
    };
    
    reader.onerror = reject;
  });
}
