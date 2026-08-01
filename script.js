// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (ДОЛЖНЫ БЫТЬ В САМОМ ВЕРХУ ФАЙЛА)
// ==========================================

// 1. Основные данные
let records = [];
let tariffs = [];
let fuelLogs = []; // Добавлено для модуля топлива

// 2. Переменные графиков
let incomeChart = null;
let expensesChart = null;
let comparisonChart = null;
let fuelChartInstance = null;

// 3. Состояния интерфейса
let editingId = null;
let editingFuelId = null;
let currentHistoryPage = 1;
const RECORDS_PER_PAGE = 20;
let showAllHistoryMode = false;

// 4. Состояние авто-расчета
let autoCalcState = {
    km: true,
    weight: true
};

// 5. СОСТОЯНИЕ ФИЛЬТРОВ И СОРТИРОВКИ (КРИТИЧЕСКИ ВАЖНО!)
let filterState = {
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

let sortState = { column: null, direction: null };
let currentFilterColumn = null;

// ==========================================
// ДАЛЕЕ ИДЕТ ВАШ ОСТАЛЬНОЙ КОД (Firebase инициализация и т.д.)
// ==========================================

// ===== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПАРСИНГА ДАТ БЕЗ СМЕЩЕНИЯ ЧАСОВОГО ПОЯСА =====
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(dateStr);
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // Месяцы в JS 0-11
    const day = parseInt(parts[2]);
    return new Date(year, month, day);
}

// ===== УТИЛИТА: АВТОМАТИЧЕСКОЕ СЖАТИЕ ИЗОБРАЖЕНИЙ =====
async function compressImage(file, maxSizeMB = 1) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let canvas = document.createElement('canvas');
                let ctx = canvas.getContext('2d');

                // 1. Ограничиваем максимальные размеры (чтобы не сжимать гигантские фото до микроскопических)
                let width = img.width;
                let height = img.height;
                const MAX_DIMENSION = 1200; // Максимум 1200px по длинной стороне (достаточно для аватара/чека)

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

                // 2. Итеративное сжатие качества JPEG
                let quality = 0.85; // Начинаем с 85% качества
                let dataUrl = canvas.toDataURL('image/jpeg', quality);

                // Длина base64 строки * 0.75 ≈ размер в байтах
                while ((dataUrl.length * 0.75) > (maxSizeMB * 1024 * 1024) && quality > 0.1) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                // 3. Если всё ещё слишком большое, уменьшаем размер холста в 2 раза
                if ((dataUrl.length * 0.75) > (maxSizeMB * 1024 * 1024)) {
                    canvas.width = Math.round(width / 2);
                    canvas.height = Math.round(height / 2);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                }

                console.log(`✅ Изображение сжато: ${(file.size / 1024 / 1024).toFixed(2)} МБ -> ${(dataUrl.length * 0.75 / 1024 / 1024).toFixed(2)} МБ`);
                resolve(dataUrl);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// ===== АУТЕНТИФИКАЦИЯ =====
function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabs = document.querySelectorAll('.auth-tab');
    
    tabs.forEach(t => t.classList.remove('active'));
    
    if (tab === 'login') {
        loginForm.style.display = 'flex';
        registerForm.style.display = 'none';
        tabs[0].classList.add('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'flex';
        tabs[1].classList.add('active');
    }
    
    // Очищаем ошибки
    document.getElementById('login-error').textContent = '';
    document.getElementById('register-error').textContent = '';
}

// Обработчик входа
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        errorEl.textContent = '';
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        errorEl.textContent = getAuthErrorMessage(error.code);
    }
});

// Обработчик регистрации
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    const errorEl = document.getElementById('register-error');
    
    if (password !== confirm) {
        errorEl.textContent = 'Пароли не совпадают';
        return;
    }
    
    try {
        errorEl.textContent = '';
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        
        // Сохраняем имя пользователя
        await userCredential.user.updateProfile({
            displayName: name
        });
        
        // Создаем документ пользователя в Firestore
        await db.collection('users').doc(userCredential.user.uid).set({
            name: name,
            email: email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        errorEl.textContent = getAuthErrorMessage(error.code);
    }
});

// Обработчик выхода
document.getElementById('logout-btn').addEventListener('click', async () => {
    if (confirm('Выйти из аккаунта?')) {
        // 1. СНАЧАЛА показываем экран авторизации
        const authScreen = document.getElementById('auth-screen');
        const container = document.querySelector('.container');
        const bottomNav = document.querySelector('.bottom-nav');
        const logoutBtn = document.getElementById('logout-btn');
        
        // Скрываем интерфейс приложения
        if (container) {
            container.style.display = 'none';
        }
        if (bottomNav) {
            bottomNav.style.display = 'none';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
        }
        
        // Убираем класс authenticated
        document.body.classList.remove('authenticated');
        
        // Показываем экран авторизации
        if (authScreen) {
            authScreen.classList.remove('hidden');
            authScreen.style.display = 'flex';
        }
        
        // 2. Очищаем localStorage
        localStorage.removeItem('driverAuthState');
        
        // 3. Очищаем данные
        records = [];
        tariffs = [];
        saveData();
        
        // 4. Очищаем формы авторизации
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const loginError = document.getElementById('login-error');
        const registerError = document.getElementById('register-error');
        
        if (loginForm) loginForm.reset();
        if (registerForm) registerForm.reset();
        if (loginError) loginError.textContent = '';
        if (registerError) registerError.textContent = '';
        
        // 5. Переключаем на вкладку входа
        if (typeof switchAuthTab === 'function') {
            switchAuthTab('login');
        }
        
        // 6. Выходим из Firebase
        try {
            await auth.signOut();
            console.log('✅ Вы вышли из аккаунта');
        } catch (error) {
            console.error('Ошибка выхода:', error);
        }
        
        // 7. Очищаем текущего пользователя
        currentUser = null;
    }
});

// ============================================
// СЛУШАТЕЛЬ СОСТОЯНИЯ АУТЕНТИФИКАЦИИ
// ============================================
auth.onAuthStateChanged(async (user) => {
    const logoutBtn = document.getElementById('logout-btn');
    const authScreen = document.getElementById('auth-screen');
    const container = document.querySelector('.container');
    const bottomNav = document.querySelector('.bottom-nav');
    const statusWrapper = document.getElementById('connection-status-wrapper');
    
    if (user) {
        // ===== ПОЛЬЗОВАТЕЛЬ ВОШЕЛ =====
        currentUser = user;
        localStorage.setItem('driverAuthState', 'true');
        document.body.classList.add('authenticated');

        // Показываем интерфейс
        if (authScreen) { authScreen.classList.add('hidden'); authScreen.style.display = 'none'; }
        if (container) container.style.display = 'block';
        if (bottomNav) bottomNav.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
        if (statusWrapper) statusWrapper.style.display = 'flex';

        // ⭐⭐⭐ МГНОВЕННО показываем имя и email (не ждём Firebase!)
        const nameEl = document.getElementById('profile-name');
        const emailEl = document.getElementById('profile-email');
        const syncEl = document.getElementById('profile-sync-status');
        
        const userName = user.displayName || (user.email ? user.email.split('@')[0] : 'Водитель');
        if (nameEl) nameEl.textContent = userName;
        if (emailEl) emailEl.textContent = user.email || '';
        if (syncEl) {
            syncEl.innerHTML = '<ion-icon name="sync-outline" style="font-size: 16px;"></ion-icon> Загрузка данных...';
            syncEl.style.color = 'var(--ios-warning)';
        }
        
        // ⭐⭐⭐ Мгновенно показываем аватар из localStorage (если есть)
        const homeTab = document.getElementById('tab-home');
        if (homeTab && homeTab.classList.contains('active')) {
            loadProfileAvatar(); 
        }

        console.log('✅ Пользователь вошел:', user.email);

        // Обновляем индикатор статуса
        connectionMode = 'checking';
        firebaseErrorReason = '';
        updateConnectionIndicator();

// ⭐⭐⭐ ТЕПЕРЬ грузим данные (имя и email уже показаны!)
try {
    // 1. Загружаем основные данные: записи, тарифы, аватар и цели
    await loadUserData();
    
    // 2. ⭐ КЛЮЧЕВОЕ: Загружаем автомобили ПЕРЕД топливом и ремонтом!
    // Это гарантирует, что currentVehicleId будет определен, и модули загрузят правильные данные
    if (typeof loadVehicles === 'function') {
        await loadVehicles();
        console.log('✅ Модуль автомобилей инициализирован');
    }

    // 3. Загружаем топливо (теперь оно автоматически отфильтруется по currentVehicleId)
    if (typeof loadFuelLogs === 'function') {
        await loadFuelLogs();
        console.log('✅ Модуль топлива инициализирован');
    }

    // 4. Загружаем ремонты (также отфильтруется по currentVehicleId и включит onSnapshot)
    if (typeof loadRepairRecords === 'function') {
        await loadRepairRecords();
        console.log('✅ Модуль ремонта инициализирован');
    }
    
    // 5. Проверяем подключение к Firebase
    setTimeout(() => checkFirebaseConnection(), 1000);
    
} catch (error) {
    console.error('❌ Ошибка загрузки данных:', error);
    connectionMode = 'local';
    firebaseErrorReason = 'Ошибка загрузки данных: ' + error.message;
    updateConnectionIndicator();
}

    } else {
        // ===== ПОЛЬЗОВАТЕЛЬ ВЫШЕЛ =====
        currentUser = null;
        localStorage.removeItem('driverAuthState');
        document.body.classList.remove('authenticated');
        
        // Скрываем интерфейс
        if (container) container.style.display = 'none';
        if (bottomNav) bottomNav.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        
        // Скрываем индикатор статуса
        if (statusWrapper) {
            statusWrapper.style.display = 'none';
        }
        
        // Показываем экран авторизации
        if (authScreen) {
            authScreen.classList.remove('hidden');
            authScreen.style.display = 'flex';
        }
        
        // Очищаем данные
        records = [];
        tariffs = [];
        saveData();
        
        // Обновляем статус
        connectionMode = 'local';
        firebaseErrorReason = 'Пользователь не авторизован';
        
        // Очищаем формы
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        if (loginForm) loginForm.reset();
        if (registerForm) registerForm.reset();
        
        // Сбрасываем ошибки
        const loginError = document.getElementById('login-error');
        const registerError = document.getElementById('register-error');
        if (loginError) loginError.textContent = '';
        if (registerError) registerError.textContent = '';
        
        // Переключаем на вкладку входа
        if (typeof switchAuthTab === 'function') {
            switchAuthTab('login');
        }
        
        console.log('👤 Пользователь вышел, показан экран авторизации');
    }
});

// Функция получения сообщений об ошибках
function getAuthErrorMessage(errorCode) {
    const messages = {
        'auth/email-already-in-use': 'Этот email уже используется',
        'auth/invalid-email': 'Некорректный email',
        'auth/weak-password': 'Пароль слишком короткий (минимум 6 символов)',
        'auth/user-not-found': 'Пользователь не найден',
        'auth/wrong-password': 'Неверный пароль',
        'auth/invalid-credential': 'Неверный email или пароль',
        'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже'
    };
    return messages[errorCode] || 'Произошла ошибка. Попробуйте еще раз';
}

// Загрузка данных пользователя из Firebase
async function loadUserData() {
    if (!currentUser) return;

    const mainContainer = document.querySelector('.container');
    const bottomNav = document.querySelector('.bottom-nav');
    const authScreen = document.getElementById('auth-screen');
    const statusWrapper = document.getElementById('connection-status-wrapper');
    if (authScreen) authScreen.classList.add('hidden');
    if (mainContainer) mainContainer.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (statusWrapper) statusWrapper.style.display = 'flex';

    try {
        console.log('🔄 Параллельная загрузка данных пользователя...');

        // ⭐⭐⭐ ГЛАВНОЕ ИЗМЕНЕНИЕ: Все запросы идут ОДНОВРЕМЕННО
        const [recordsSnap, tariffsSnap, userDoc] = await Promise.all([
            db.collection('users').doc(currentUser.uid).collection('records').orderBy('date', 'desc').get(),
            db.collection('users').doc(currentUser.uid).collection('tariffs').orderBy('date', 'desc').get(),
            db.collection('users').doc(currentUser.uid).get()
        ]);

        // Обрабатываем записи
        records = recordsSnap.docs.map(doc => normalizeRecord({ id: doc.id, ...doc.data() }));
        console.log('✅ Загружено записей:', records.length);

        // Обрабатываем тарифы
        tariffs = tariffsSnap.docs.map(doc => normalizeTariff({ id: doc.id, ...doc.data() }));
        console.log('✅ Загружено тарифов:', tariffs.length);

        // Если нет тарифов — создаём стандартный
        if (tariffs.length === 0) {
            const defaultTariff = {
                date: new Date().toISOString().split('T')[0],
                pickup: 60, delivery: 81, km: 11, weight: 2
            };
            const docRef = await db.collection('users').doc(currentUser.uid)
                .collection('tariffs').add(defaultTariff);
            tariffs.push(normalizeTariff({ id: docRef.id, ...defaultTariff }));
        }

        // ⭐⭐⭐ Обрабатываем аватар и цели ИЗ УЖЕ ЗАГРУЖЕННОГО userDoc (без доп. запроса!)
        const userData = userDoc.exists ? userDoc.data() : {};
        
        if (userData.avatar) {
            try {
                localStorage.setItem(AVATAR_STORAGE_KEY, userData.avatar);
                loadProfileAvatar();
                console.log('✅ Аватар загружен из кэша Firestore');
            } catch (e) {
                console.warn('⚠️ Аватар слишком большой для localStorage');
            }
        }

        // Цели — тоже из userDoc, без отдельного запроса
        if (userData.goals && typeof userData.goals === 'object') {
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(userData.goals));
            console.log('✅ Цели загружены из кэша Firestore');
        } else {
            const defaultGoals = { income: 100000, orders: 500, hours: 200 };
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(defaultGoals));
            await saveGoalsToFirebase(defaultGoals);
        }

        // Сохраняем в localStorage
        saveData();

        // ⭐⭐⭐ Обновляем интерфейс параллельно (не ждём друг друга)
        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();
        
        // Цели и главная — асинхронно, не блокируя
        updateGoals();
        updateHomeTab();

        // Статус
        connectionMode = 'firebase';
        firebaseErrorReason = '';
        updateConnectionIndicator();
        console.log('✅ Все данные успешно загружены!');

    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        console.log('🔄 Загружаем из localStorage...');
        await loadData();
        connectionMode = 'local';
        firebaseErrorReason = error.message || 'Ошибка загрузки данных';
        updateConnectionIndicator();
        
        renderTable();
        renderTariffs();
        populateFilters();
        updateAnalytics();
        updateGoals();
        updateHomeTab();
        alert('⚠️ Ошибка загрузки: ' + error.message + '\nДанные взяты из локального кэша.');
    }
}

// ============================================
// ЗАГРУЗКА ЦЕЛЕЙ ИЗ FIREBASE
// ============================================

async function loadGoalsFromFirebase() {
    if (!currentUser || typeof db === 'undefined') {
        console.log('⚠️ Firebase не доступен, загружаем из localStorage');
        // Пробуем загрузить из localStorage
        const localGoals = localStorage.getItem(GOALS_STORAGE_KEY);
        if (localGoals) {
            try {
                const goals = JSON.parse(localGoals);
                if (goals && typeof goals === 'object') {
                    console.log('📊 Цели загружены из localStorage:', goals);
                    return goals;
                }
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга целей из localStorage:', e);
            }
        }
        // Создаем дефолтные цели
        const defaultGoals = { income: 100000, orders: 500, hours: 200 };
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(defaultGoals));
        console.log('📊 Созданы дефолтные цели в localStorage');
        return defaultGoals;
    }
    
    try {
        console.log('🔄 Загрузка целей из Firebase...');
        
        const doc = await db.collection('users')
            .doc(currentUser.uid)
            .get();
        
        // Проверяем, есть ли цели в Firebase
        if (doc.exists && doc.data().goals) {
            const goals = doc.data().goals;
            
            // Проверяем, что цели имеют правильную структуру
            if (goals && typeof goals === 'object' && 
                typeof goals.income === 'number' && 
                typeof goals.orders === 'number' && 
                typeof goals.hours === 'number') {
                
                // Сохраняем в localStorage для кэша
                localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
                console.log('✅ Цели загружены из Firebase:', goals);
                return goals;
            } else {
                console.warn('⚠️ Структура целей в Firebase повреждена, создаем новые');
                // Создаем правильную структуру
                const defaultGoals = { income: 100000, orders: 500, hours: 200 };
                localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(defaultGoals));
                await saveGoalsToFirebase(defaultGoals);
                console.log('📊 Созданы и сохранены дефолтные цели в Firebase');
                return defaultGoals;
            }
        } else {
            // Если в Firebase нет целей, создаем дефолтные и сохраняем
            console.log('📊 В Firebase нет целей, создаем дефолтные...');
            const defaultGoals = { income: 100000, orders: 500, hours: 200 };
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(defaultGoals));
            await saveGoalsToFirebase(defaultGoals);
            console.log('✅ Созданы и сохранены дефолтные цели в Firebase');
            return defaultGoals;
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки целей из Firebase:', error);
        
        // Пробуем загрузить из localStorage
        console.log('🔄 Пытаемся загрузить цели из localStorage...');
        const localGoals = localStorage.getItem(GOALS_STORAGE_KEY);
        if (localGoals) {
            try {
                const goals = JSON.parse(localGoals);
                if (goals && typeof goals === 'object' && 
                    typeof goals.income === 'number' && 
                    typeof goals.orders === 'number' && 
                    typeof goals.hours === 'number') {
                    console.log('📊 Цели загружены из localStorage:', goals);
                    return goals;
                }
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга целей из localStorage:', e);
            }
        }
        
        // Если ничего не получилось, создаем дефолтные
        const defaultGoals = { income: 100000, orders: 500, hours: 200 };
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(defaultGoals));
        console.log('📊 Созданы дефолтные цели (после ошибки)');
        return defaultGoals;
    }
}

// ===== СОХРАНЕНИЕ СОСТОЯНИЯ =====
const STATE_KEY = 'appState';
let isRestoringState = false; // Флаг восстановления состояния

function saveState() {
    try {
        const activeBtn = document.querySelector('.nav-item.active');
        const state = {
            activeTab: activeBtn ? activeBtn.getAttribute('data-tab') : 'entry',
            filterMonth: document.getElementById('filter-month')?.value || '',
            filterYear: document.getElementById('filter-year')?.value || '',
            compare1Month: document.getElementById('compare1-month')?.value || '',
            compare1Year: document.getElementById('compare1-year')?.value || '',
            compare2Month: document.getElementById('compare2-month')?.value || '',
            compare2Year: document.getElementById('compare2-year')?.value || '',
            timestamp: Date.now()
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Ошибка сохранения:', e);
    }
}

function restoreState() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        if (!saved) return;
        
        const state = JSON.parse(saved);
        console.log('🔄 Восстановление состояния:', state);
        
        // Восстанавливаем фильтры аналитики
        const filterMonth = document.getElementById('filter-month');
        const filterYear = document.getElementById('filter-year');
        if (filterMonth && state.filterMonth) filterMonth.value = state.filterMonth;
        if (filterYear && state.filterYear) filterYear.value = state.filterYear;
        
        // Восстанавливаем периоды сравнения
        const c1m = document.getElementById('compare1-month');
        const c1y = document.getElementById('compare1-year');
        const c2m = document.getElementById('compare2-month');
        const c2y = document.getElementById('compare2-year');
        if (c1m && state.compare1Month) c1m.value = state.compare1Month;
        if (c1y && state.compare1Year) c1y.value = state.compare1Year;
        if (c2m && state.compare2Month) c2m.value = state.compare2Month;
        if (c2y && state.compare2Year) c2y.value = state.compare2Year;
        
        // ✅ ИСПРАВЛЕНИЕ: Используем switchTab() вместо ручной манипуляции
        if (state.activeTab && state.activeTab !== 'home') {
            // Небольшая задержка, чтобы DOM успел полностью загрузиться
            setTimeout(() => {
                switchTab(state.activeTab);
            }, 100);
        }
    } catch (e) {
        console.error('❌ Ошибка восстановления:', e);
    }
}

// ==========================================
// НАДЕЖНАЯ СИСТЕМА ФИЛЬТРАЦИИ (ВЕРСИЯ 3.0)
// ==========================================



function toggleFilter(column) {
    const filterRow = document.getElementById('filter-row');
    if (!filterRow) { console.error('❌ Нет #filter-row'); return; }

    if (filterRow.style.display === 'none' || filterRow.style.display === '') {
        filterRow.style.display = 'table-row';
        currentFilterColumn = column;
        renderFilterUI(column);
    } else if (currentFilterColumn === column) {
        filterRow.style.display = 'none';
        currentFilterColumn = null;
    } else {
        currentFilterColumn = column;
        renderFilterUI(column);
    }
}

function renderFilterUI(column) {
    // Скрываем все ячейки фильтров, показываем только нужную
    Object.keys(filterState).forEach(col => {
        const cell = document.getElementById('filter-' + col);
        if (cell) {
            if (col === column) {
                cell.style.display = 'table-cell';
                buildFilterControls(col, cell);
            } else {
                cell.style.display = 'none';
                cell.innerHTML = '';
            }
        }
    });
}

function buildFilterControls(column, container) {
    container.innerHTML = '';
    
    // 1. ФИЛЬТР ПО МЕСЯЦАМ
    if (column === 'date') {
        const select = document.createElement('select');
        select.style.cssText = 'width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:6px;';
        select.innerHTML = '<option value="">Все месяцы</option>';
        
        const monthsMap = new Map();
        records.forEach(r => {
            if (!r.date) return;
            const d = parseLocalDate(r.date);
            if (!d) return;
            const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
            const label = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][d.getMonth()] + ' ' + d.getFullYear();
            if (!monthsMap.has(key)) monthsMap.set(key, label);
        });
        
        Array.from(monthsMap.entries()).sort((a,b) => b[0].localeCompare(a[0])).forEach(([key, label]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            if (filterState.date.values.includes(key)) opt.selected = true;
            select.appendChild(opt);
        });
        
        select.addEventListener('change', (e) => {
            filterState.date.values = e.target.value ? [e.target.value] : [];
            renderTable();
        });
        container.appendChild(select);
    }
    // 2. ФИЛЬТР ПО ДНЯМ НЕДЕЛИ
    else if (column === 'weekday') {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
        ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'].forEach(day => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; font-size:11px; cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = day;
            cb.checked = filterState.weekday.values.includes(day);
            cb.addEventListener('change', () => {
                if (cb.checked) filterState.weekday.values.push(day);
                else filterState.weekday.values = filterState.weekday.values.filter(v => v !== day);
                renderTable();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + day.slice(0,3)));
            wrapper.appendChild(label);
        });
        container.appendChild(wrapper);
    }
// 3. ФИЛЬТР ПО ТИПУ
else if (column === 'type') {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    
    // Добавлены свойства icon и color для каждого типа
    [
        { v: 'work', l: 'Работа', icon: 'calendar-outline', color: 'var(--ios-accent, #007AFF)' },
        { v: 'bonus', l: 'Бонус', icon: 'gift-outline', color: 'var(--ios-purple, #AF52DE)' },
        { v: 'expense', l: 'Расход', icon: 'remove-circle-outline', color: 'var(--ios-danger, #FF3B30)' }
    ].forEach(t => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px;';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = t.v;
        cb.checked = filterState.type.values.includes(t.v);
        cb.addEventListener('change', () => {
            if (cb.checked) { if (!filterState.type.values.includes(t.v)) filterState.type.values.push(t.v); }
            else { filterState.type.values = filterState.type.values.filter(v => v !== t.v); }
            renderTable();
        });
        
        label.appendChild(cb);
        
        // Создаем обертку для иконки и текста для идеального выравнивания
        const textWrapper = document.createElement('span');
        textWrapper.style.cssText = 'display:flex; align-items:center; gap:4px;';
        textWrapper.innerHTML = `<ion-icon name="${t.icon}" style="color: ${t.color}; font-size: 16px;"></ion-icon> ${t.l}`;
        
        label.appendChild(textWrapper);
        wrapper.appendChild(label);
    });
    container.appendChild(wrapper);
}
    // 4. ДИАПАЗОННЫЕ ФИЛЬТРЫ (ЧИСЛА)
    else if (filterState[column] && filterState[column].type === 'range') {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
        
        const inputsDiv = document.createElement('div');
        inputsDiv.style.cssText = 'display:flex; gap:4px; align-items:center;';
        
        const minInp = document.createElement('input');
        minInp.type = 'number'; minInp.placeholder = 'От';
        minInp.style.cssText = 'width:50%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:6px;';
        minInp.value = filterState[column].min;
        
        const maxInp = document.createElement('input');
        maxInp.type = 'number'; maxInp.placeholder = 'До';
        maxInp.style.cssText = 'width:50%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:6px;';
        maxInp.value = filterState[column].max;

        // 🌟 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: используем addEventListener 'input'
        minInp.addEventListener('input', (e) => {
            filterState[column].min = e.target.value;
            renderTable();
        });
        maxInp.addEventListener('input', (e) => {
            filterState[column].max = e.target.value;
            renderTable();
        });

        inputsDiv.appendChild(minInp);
        inputsDiv.appendChild(maxInp);
        wrapper.appendChild(inputsDiv);
        container.appendChild(wrapper);
    }
}

function clearAllFilters() {
    Object.keys(filterState).forEach(key => {
        if (filterState[key].type === 'range') {
            filterState[key].min = '';
            filterState[key].max = '';
        } else {
            filterState[key].values = [];
        }
    });
    sortState = { column: null, direction: null };
    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        filterRow.style.display = 'none';
        filterRow.querySelectorAll('td').forEach(td => { if(td.id.startsWith('filter-')) td.innerHTML = ''; });
    }
    currentFilterColumn = null;
    renderTable();
}

// ===== ПРИМЕНЕНИЕ ФИЛЬТРОВ (МАКСИМАЛЬНО ЗАЩИЩЕННОЕ) =====
function applyFilters(data) {
    return data.filter(r => {
        // 1. Дата
        if (filterState.date.values.length > 0) {
            const recMonth = r.date ? r.date.substring(0, 7) : '';
            if (!filterState.date.values.includes(recMonth)) return false;
        }
        // 2. День недели
        if (filterState.weekday.values.length > 0) {
            const recDay = r.weekday ? r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase() : '';
            if (!filterState.weekday.values.includes(recDay)) return false;
        }
        // 3. Тип
        if (filterState.type.values.length > 0) {
            if (!filterState.type.values.includes(r.recordType)) return false;
        }
        // 4. Числовые диапазоны
        for (const key of Object.keys(filterState)) {
            const f = filterState[key];
            if (f.type !== 'range') continue;
            if (f.min === '' && f.max === '') continue; // Пропускаем, если фильтр пуст

            // Безопасное получение числа
            let val = 0;
            const raw = r[key];
            if (raw !== undefined && raw !== null && raw !== '' && raw !== '-') {
                val = parseFloat(raw);
                if (isNaN(val)) val = 0;
            }

            if (f.min !== '' && !isNaN(parseFloat(f.min)) && val < parseFloat(f.min)) return false;
            if (f.max !== '' && !isNaN(parseFloat(f.max)) && val > parseFloat(f.max)) return false;
        }
        return true;
    });
}

function applySorting(data) {
    if (!sortState.column || !sortState.direction) return data;
    const field = sortState.column;
    if (data.length === 0 || !(field in data[0])) return data;
    
    return [...data].sort((a, b) => {
        const rawA = a[field];
        const valA = (rawA === undefined || rawA === null || rawA === '' || rawA === '-') ? 0 : parseFloat(rawA);
        const rawB = b[field];
        const valB = (rawB === undefined || rawB === null || rawB === '' || rawB === '-') ? 0 : parseFloat(rawB);
        return sortState.direction === 'asc' ? valA - valB : valB - valA;
    });
}



// ===== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК (ЕДИНАЯ ФУНКЦИЯ) =====
function switchTab(tabName) {
    // Скрываем все вкладки
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Убираем активный класс со всех кнопок навигации
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Показываем нужную вкладку
    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // Активируем кнопку в навигации
    const activeBtn = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // Выполняем действия в зависимости от вкладки
    switch (tabName) {
        case 'analytics':
            updateAnalytics();
            initComparisonSelectors();
            updateComparison();
            break;
        case 'history':
            // Инициализация фильтров при первом открытии
            if (!window._historyInitialized) {
                initHistoryFilters();
                window._historyInitialized = true;
            }
            renderTable();
            break;
        case 'tariffs':
            renderTariffs();
            break;
        case 'home':
            // Вызываем updateHomeTab с задержкой, чтобы DOM успел обновиться
            setTimeout(function() {
                updateHomeTab();
            }, 50);
            break;
        case 'entry':
            // Опциональные действия для вкладки ввода
            break;
        
        // ===== ДОБАВЛЕНО: Обработка вкладки "Топливо" =====
        case 'fuel':
            setTimeout(function() {
                // Проверки typeof гарантируют, что ошибки не будет, если модуль еще не загрузился
                if (typeof renderFuelLogs === 'function') renderFuelLogs();
                if (typeof updateFuelStats === 'function') updateFuelStats();
                if (typeof updateFuelChart === 'function') updateFuelChart();
            }, 50);
            break;
        // ==================================================

        case 'settings':
            // Ничего не делаем, просто показываем
            break;
        default:
            break;
    }
    
    // Сохраняем состояние
    saveState();
}

// Гарантируем, что функция доступна глобально
window.switchTab = switchTab;

// ===== СБРОС ДАННЫХ (только localStorage, Firebase не трогаем!) =====
async function resetAllData() {
    if (!confirm('⚠️ Вы уверены? Локальные данные будут очищены.\n\nДанные в Firebase будут сохранены.')) return;
    
    // Очищаем ТОЛЬКО localStorage
    localStorage.removeItem('driverRecords');
    localStorage.removeItem('driverTariffs');
    
    records = [];
    tariffs = [];
    
    alert('✅ Локальные данные очищены! Данные в Firebase сохранены.\nПриложение перезагрузится и загрузит данные из Firebase.');
    location.reload();
}
// ===== НОРМАЛИЗАЦИЯ ДАННЫХ =====
function normalizeRecord(r) {
    // Исправляем recordType если он некорректный
    let recordType = r.recordType;
    if (!recordType || recordType === '' || recordType === 'undefined') {
        // Если есть bonusPay или bonusPeriod - это бонус, иначе работа
        recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
    }
    
    return {
        ...r,
        date: typeof r.date === 'string' ? r.date.trim() : r.date,
        weekday: typeof r.weekday === 'string' ? 
            (r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase()) : r.weekday,
        recordType: recordType,
        totalIncome: calcIncome(r),
        totalExpenses: calcExpenses(r),
        netProfit: calcIncome(r) - calcExpenses(r)
    };
}

function normalizeTariff(t) {
    return {
        ...t,
        date: typeof t.date === 'string' ? t.date.trim() : t.date,
        pickup: t.pickup || 0,
        delivery: t.delivery || 0,
        km: t.km || 0,
        weight: t.weight || 0
    };
}



// ===== ВАЛИДАЦИЯ ФОРМЫ =====
function addFormValidation() {
    const numericFields = ['hours', 'orders-pickup', 'orders-delivery', 'distance', 'weight',
        'pay-pickup', 'pay-delivery', 'pay-distance', 'pay-weight',
        'load-pay', 'rating', 'tips', 'fuel-cost', 'repair-cost', 'tax'];
    numericFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', function() {
                if (this.value && parseFloat(this.value) < 0) {
                    this.value = 0;
                }            });
        }
    });
}

// ===== ЗАГРУЗКА ДАННЫХ =====
// ===== ЗАГРУЗКА ДАННЫХ (ТОЛЬКО LOCALSTORAGE) =====
// Данные из Firebase загружаются отдельно через loadUserData() после авторизации
async function loadData() {
    try {
        console.log('🔄 Загрузка данных из localStorage...');
        const savedRecords = localStorage.getItem('driverRecords');
        const savedTariffs = localStorage.getItem('driverTariffs');
        
        if (savedRecords) {
            records = JSON.parse(savedRecords).map(normalizeRecord);
        }
        
        if (savedTariffs) {
            tariffs = JSON.parse(savedTariffs).map(normalizeTariff);
        }
        
        console.log('✅ Локальные данные загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки из localStorage:', error);
    }
}

// ===== СОХРАНЕНИЕ ДАННЫХ В LOCALSTORAGE =====
function saveData() {
    try {
        localStorage.setItem('driverRecords', JSON.stringify(records));
        localStorage.setItem('driverTariffs', JSON.stringify(tariffs));
    } catch (error) {
        console.error('❌ Ошибка сохранения в localStorage:', error);
    }
}

async function saveRecordToFirebase(record) {
    if (!currentUser) return;
    
    try {
        const recordToSave = { ...record };
        delete recordToSave.id;
        
        const userRecordsRef = db.collection('users')
            .doc(currentUser.uid)
            .collection('records');
        
        if (!record.id || !records.find(r => r.id === record.id)) {
            const docRef = await userRecordsRef.add(recordToSave);
            record.id = docRef.id;
        } else {
            await userRecordsRef.doc(record.id).set(recordToSave);
        }
        
        console.log('✅ Запись сохранена в Firebase');
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
    }
}

// Пакетное обновление записей в Firebase
async function saveRecordsBatchToFirebase(recordsToUpdate) {
    if (!currentUser || !recordsToUpdate.length) return;
    try {
        const recordsRef = db.collection('users').doc(currentUser.uid).collection('records');
        const BATCH_SIZE = 400;
        
        for (let i = 0; i < recordsToUpdate.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = recordsToUpdate.slice(i, i + BATCH_SIZE);
            
            for (const r of chunk) {
                const recordToSave = { ...r };
                delete recordToSave.id;
                batch.set(recordsRef.doc(r.id), recordToSave);
            }
            
            await batch.commit();
        }
        
        console.log(`✅ Пакетно сохранено ${recordsToUpdate.length} записей в Firebase`);
    } catch (error) {
        console.error('❌ Ошибка пакетного сохранения:', error);
    }
}

async function deleteRecordFromFirebase(id) {
    if (!currentUser) return;
    
    try {
        await db.collection('users')
            .doc(currentUser.uid)
            .collection('records')
            .doc(id)
            .delete();
        
        console.log('✅ Запись удалена из Firebase');
    } catch (error) {
        console.error('❌ Ошибка удаления:', error);
    }
}

function getTariffForDate(dateStr) {
    if (!tariffs || tariffs.length === 0) {
        return DEFAULT_TARIFF;
    }
    if (!dateStr) {
        const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
        return sorted[0];
    }
    const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const t of sorted) {
        if (t.date <= dateStr) return t;
    }
    return sorted[sorted.length - 1];
}

function getCurrentTariff() {
    const today = new Date().toISOString().split('T')[0];
    return getTariffForDate(today);
}

function updateTariffDisplay() {
    const dateVal = document.getElementById('date').value;
    const tariff = getTariffForDate(dateVal);
    document.getElementById('tariff-date-display').textContent = dateVal || 'сегодня';
    if (tariff) {
        document.getElementById('t-pickup').textContent = tariff.pickup;
        document.getElementById('t-delivery').textContent = tariff.delivery;
        document.getElementById('t-km').textContent = tariff.km;
        document.getElementById('t-weight').textContent = tariff.weight;
    }
}

function autoCalc(type) {
    // Для km и weight проверяем, включен ли авто-расчет
    if (type === 'km' && autoCalcState && autoCalcState.km === false) {
        return;
    }
    if (type === 'weight' && autoCalcState && autoCalcState.weight === false) {
        return;
    }
    
    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) return;
    let qtyField, priceField, rate;
    switch(type) {
        case 'pickup':
            qtyField = 'orders-pickup';
            priceField = 'pay-pickup';
            rate = tariff.pickup;
            break;
        case 'delivery':
            qtyField = 'orders-delivery';
            priceField = 'pay-delivery';
            rate = tariff.delivery;
            break;
        case 'km':
            qtyField = 'distance';
            priceField = 'pay-distance';
            rate = tariff.km;
            break;
        case 'weight':
            qtyField = 'weight';
            priceField = 'pay-weight';
            rate = tariff.weight;
            break;
    }
    const qtyValue = document.getElementById(qtyField).value;
    if (!qtyValue || qtyValue === '') {
        document.getElementById(priceField).value = '';
        return;
    }
    const qty = parseFloat(qtyValue);
    if (isNaN(qty) || qty <= 0) {
        document.getElementById(priceField).value = '';
        return;
    }
    const calculated = Math.round(qty * rate * 100) / 100;
    document.getElementById(priceField).value = calculated;
}

function recalcCurrentByTariff() {
    // Проверяем, что мы в режиме редактирования
    if (!editingId) {
        alert('⚠️ Эта функция работает только при редактировании существующей записи.');
        return;
    }
    
    const tariff = getTariffForDate(document.getElementById('date').value);
    if (!tariff) {
        alert('❌ Тариф для этой даты не найден');
        return;
    }
    
    const pickup = parseFloat(document.getElementById('orders-pickup').value) || 0;
    const delivery = parseFloat(document.getElementById('orders-delivery').value) || 0;
    const km = parseFloat(document.getElementById('distance').value) || 0;
    const weight = parseFloat(document.getElementById('weight').value) || 0;
    
    // Считаем новые значения
    const newPayPickup = pickup > 0 ? Math.round(pickup * tariff.pickup * 100) / 100 : 0;
    const newPayDelivery = delivery > 0 ? Math.round(delivery * tariff.delivery * 100) / 100 : 0;
    const newPayDistance = km > 0 ? Math.round(km * tariff.km * 100) / 100 : 0;
    const newPayWeight = weight > 0 ? Math.round(weight * tariff.weight * 100) / 100 : 0;
    
    // Обновляем поля формы
    document.getElementById('pay-pickup').value = newPayPickup;
    document.getElementById('pay-delivery').value = newPayDelivery;
    document.getElementById('pay-distance').value = newPayDistance;
    document.getElementById('pay-weight').value = newPayWeight;
    
    // Сохраняем изменения в массив записей
    const recordIndex = records.findIndex(r => r.id === editingId);
    if (recordIndex !== -1) {
        records[recordIndex].payPickup = newPayPickup;
        records[recordIndex].payDelivery = newPayDelivery;
        records[recordIndex].payDistance = newPayDistance;
        records[recordIndex].payWeight = newPayWeight;
        
        // Пересчитываем итоги
        records[recordIndex] = normalizeRecord(records[recordIndex]);
        
        // Сохраняем в localStorage и Firebase
        saveData();
        if (typeof db !== 'undefined' && currentUser) {
            saveRecordToFirebase(records[recordIndex]);
        }
        
        // Обновляем таблицу
        renderTable();
    }
    
    alert('✅ Пересчитано и сохранено по тарифу на ' + document.getElementById('date').value);
}

function cancelEdit() {
    if (!confirm('Отменить редактирование? Все изменения будут потеряны.')) return;
    editingId = null;
    document.getElementById('editing-notice').style.display = 'none';    clearForm();
}

function onDateChange() {
    updateWeekday();
    updateTariffDisplay();
}

function updateWeekday() {
    const val = document.getElementById('date').value;
    if (val) {
        const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
        document.getElementById('weekday').value = days[new Date(val).getDay()];
    }
}

function calcIncome(r) {
    return (r.payPickup || 0) + (r.payDelivery || 0) + (r.payDistance || 0) +
        (r.payWeight || 0) + (r.loadPay || 0) + (r.bonusPay || 0) +  // ДОБАВИТЬ bonusPay
        (r.rating || 0) + (r.tips || 0);
}

function calcExpenses(r) {
    return (r.fuelCost || 0) + (r.repairCost || 0) + (r.tax || 0);
}

async function saveRecord(e) {
    e.preventDefault();
    const recordType = document.getElementById('record-type').value;
    const record = {
        id: editingId || Date.now().toString(),
        date: document.getElementById('date').value,
        weekday: document.getElementById('weekday').value.charAt(0).toUpperCase() + 
             document.getElementById('weekday').value.slice(1).toLowerCase(),
        hours: parseFloat(document.getElementById('hours').value) || 0,
        ordersPickup: parseInt(document.getElementById('orders-pickup').value) || 0,
        payPickup: parseFloat(document.getElementById('pay-pickup').value) || 0,
        ordersDelivery: parseInt(document.getElementById('orders-delivery').value) || 0,
        payDelivery: parseFloat(document.getElementById('pay-delivery').value) || 0,
        distance: parseFloat(document.getElementById('distance').value) || 0,
        payDistance: parseFloat(document.getElementById('pay-distance').value) || 0,
        weight: parseFloat(document.getElementById('weight').value) || 0,
        payWeight: parseFloat(document.getElementById('pay-weight').value) || 0,
        loadPay: parseFloat(document.getElementById('load-pay').value) || 0,
        bonusPay: parseFloat(document.getElementById('bonus-pay').value) || 0,
        rating: parseFloat(document.getElementById('rating').value) || 0,
        tips: parseFloat(document.getElementById('tips').value) || 0,
        fuelCost: parseFloat(document.getElementById('fuel-cost').value) || 0,
        repairCost: parseFloat(document.getElementById('repair-cost').value) || 0,
        tax: parseFloat(document.getElementById('tax').value) || 0,
        recordType: recordType,
        bonusPeriod: document.getElementById('bonus-period').value || ''
    };    const normalizedRecord = normalizeRecord(record);
    if (editingId) {
        const idx = records.findIndex(r => r.id === editingId);
        if (idx >= 0) {
            records[idx] = normalizedRecord;
        }
        editingId = null;
        document.getElementById('editing-notice').style.display = 'none';
    } else {
        const idx = records.findIndex(r => r.date === record.date && r.recordType === record.recordType);
        if (idx >= 0) {
            if (confirm('Запись за эту дату с таким типом уже существует. Перезаписать?')) {
                records[idx] = normalizedRecord;
            } else return;
        } else { 
            records.push(normalizedRecord);
        }
    }
    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (typeof db !== 'undefined') {
        await saveRecordToFirebase(normalizedRecord);
    }
    saveData();
    alert('✅ Сохранено! Доход: ' + formatMoney(normalizedRecord.totalIncome));
    clearForm();
    renderTable();
    populateFilters();
}

function clearForm() {
    document.getElementById('daily-form').reset();
    document.getElementById('date').valueAsDate = new Date();
    document.getElementById('record-type').value = 'work';
    document.getElementById('bonus-period').value = '';
    editingId = null;
    document.getElementById('editing-notice').style.display = 'none';
    onDateChange();
}

async function saveTariff(e) {
    e.preventDefault();
    const tariff = normalizeTariff({
        id: Date.now().toString(),
        date: document.getElementById('tariff-date').value,
        pickup: parseFloat(document.getElementById('tariff-pickup').value) || 0,
        delivery: parseFloat(document.getElementById('tariff-delivery').value) || 0,
        km: parseFloat(document.getElementById('tariff-km').value) || 0,
        weight: parseFloat(document.getElementById('tariff-weight').value) || 0
    });
    
    const idx = tariffs.findIndex(t => t.date === tariff.date);
    if (idx >= 0) {
        if (confirm('Тариф на эту дату уже существует. Заменить?')) {
            tariffs[idx] = tariff;
        } else return;
    } else {
        tariffs.push(tariff);
    }
    
    tariffs.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (currentUser) {
        try {
            const tariffToSave = { ...tariff };
            delete tariffToSave.id;
            
            const docRef = await db.collection('users')
                .doc(currentUser.uid)
                .collection('tariffs')
                .add(tariffToSave);
            
            const idx = tariffs.findIndex(t => t.date === tariff.date);
            if (idx >= 0) tariffs[idx].id = docRef.id;
            
            console.log('✅ Тариф сохранён в Firebase');
        } catch (error) {
            console.error('❌ Ошибка сохранения тарифа:', error);
        }
    }
    
    saveData();
    alert('✅ Тариф сохранен!');
    document.getElementById('tariff-form').reset();
    renderTariffs();
    updateTariffDisplay();
}

async function deleteTariff(id) {
    if (tariffs.length <= 1) {
        alert('Нельзя удалить последний тариф!');
        return;
    }
    
    if (!confirm('Удалить этот тариф?')) return;
    
    if (currentUser) {
        try {
            await db.collection('users')
                .doc(currentUser.uid)
                .collection('tariffs')
                .doc(id)
                .delete();
            
            console.log('✅ Тариф удалён из Firebase');
        } catch (error) {
            console.error('❌ Ошибка удаления тарифа:', error);
        }
    }
    
    tariffs = tariffs.filter(t => t.id !== id);
    saveData();
    renderTariffs();
    updateTariffDisplay();
}



function recalculateAllTariffs() {
    if (records.length === 0) {
        alert('Нет записей для пересчёта');
        return;
    }
    if (!confirm('️ Пересчитать ВСЕ записи по актуальным тарифам на их даты?\n\nПоля, изменённые вручную, будут пропущены.')) {
        return;
    }
    
    let changedCount = 0;
    let skippedCount = 0;
    const recordsToUpdate = [];
    
    records = records.map(r => {
        const tariff = getTariffForDate(r.date);
        if (!tariff) return r;
        
        // Получаем список полей, изменённых вручную
        const manualEdits = r.manualEdits || [];
        
        // Рассчитываем новые значения только для полей, не изменённых вручную
        const newPayPickup = manualEdits.includes('payPickup') ? r.payPickup : Math.round((r.ordersPickup || 0) * tariff.pickup * 100) / 100;
        const newPayDelivery = manualEdits.includes('payDelivery') ? r.payDelivery : Math.round((r.ordersDelivery || 0) * tariff.delivery * 100) / 100;
        const newPayDistance = manualEdits.includes('payDistance') ? r.payDistance : Math.round((r.distance || 0) * tariff.km * 100) / 100;
        const newPayWeight = manualEdits.includes('payWeight') ? r.payWeight : Math.round((r.weight || 0) * tariff.weight * 100) / 100;
        
        // Проверяем, изменилось ли что-то
        const hasChanges = newPayPickup !== r.payPickup ||
            newPayDelivery !== r.payDelivery ||
            newPayDistance !== r.payDistance ||
            newPayWeight !== r.payWeight;
        
        if (hasChanges) {
            changedCount++;
            const updatedRecord = normalizeRecord({
                ...r,
                payPickup: newPayPickup,
                payDelivery: newPayDelivery,
                payDistance: newPayDistance,
                payWeight: newPayWeight
            });
            recordsToUpdate.push(updatedRecord);
            return updatedRecord;
        } else {
            skippedCount++;
            return r;
        }
    });
    
    // Сохраняем в localStorage
    saveData();
    
    // Сохраняем в Firebase (пакетно)
    if (currentUser && recordsToUpdate.length > 0) {
        saveRecordsBatchToFirebase(recordsToUpdate);
    }
    
    renderTable();
    updateAnalytics();
    
    const manualSkipped = records.filter(r => (r.manualEdits || []).length > 0).length;
    alert(`✅ Пересчитано: ${changedCount}\n️ Пропущено (без изменений): ${skippedCount}\n️ Пропущено (ручные правки): ${manualSkipped}`);
}

function renderTariffs() {
    const list = document.getElementById('tariffs-list');
    list.innerHTML = '';
    const sorted = [...tariffs].sort((a, b) => new Date(b.date) - new Date(a.date));
    const currentTariff = getCurrentTariff();
    sorted.forEach(t => {
        const isCurrent = currentTariff && t.id === currentTariff.id;
        const div = document.createElement('div');
        div.className = 'tariff-item' + (isCurrent ? ' current' : '');
        div.innerHTML = `
            <div class="tariff-date">
                <ion-icon name="calendar-outline" style="font-size: 24px; vertical-align: middle; margin-right: 6px; color: var(--ios-accent);"></ion-icon>
                ${formatDate(t.date)}
                ${isCurrent ? '<span style="color:#10b981;font-weight:bold"> (действует)</span>' : ''}
            </div>
            <div class="tariff-values">
                <span>
                    <ion-icon name="arrow-down-circle-outline" class="tariff-icon pickup-icon"></ion-icon>
                    ${t.pickup} ₽/шт
                </span>
                <span>
                    <ion-icon name="arrow-up-circle-outline" class="tariff-icon delivery-icon"></ion-icon>
                    ${t.delivery} ₽/шт
                </span>
                <span>
                    <ion-icon name="navigate-outline" class="tariff-icon km-icon"></ion-icon>
                    ${t.km} ₽/км
                </span>
                <span>
                    <ion-icon name="scale-outline" class="tariff-icon weight-icon"></ion-icon>
                    ${t.weight} ₽/кг
                </span>
            </div>
            <div class="tariff-actions">
                <button class="btn btn-danger" onclick="deleteTariff('${t.id}')">
                    <ion-icon name="trash-outline" style="font-size: 20px; vertical-align: middle; margin-right: 6px;"></ion-icon>
                    Удалить
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateAnalytics() {
    const month = document.getElementById('filter-month').value;
    const year = document.getElementById('filter-year').value;
    let filtered = [...records];
    
    // Фильтрация по месяцу с использованием parseLocalDate
    if (month) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && (d.getMonth() + 1).toString().padStart(2, '0') === month;
        });
    }
    
    // Фильтрация по году с использованием parseLocalDate
    if (year) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d.getFullYear().toString() === year;
        });
    }
    
    const uniqueDates = new Set();
    filtered.forEach(r => {
        if (r.hours > 0 || r.recordType === 'work') {
            uniqueDates.add(r.date);
        }
    });
    
    const s = {
        totalIncome: filtered.reduce((sum, r) => sum + (r.totalIncome || 0), 0),
        totalFuel: filtered.reduce((sum, r) => sum + (r.fuelCost || 0), 0),
        totalRepair: filtered.reduce((sum, r) => sum + (r.repairCost || 0), 0),
        totalTax: filtered.reduce((sum, r) => sum + (r.tax || 0), 0),
        totalExpenses: filtered.reduce((sum, r) => sum + (r.totalExpenses || 0), 0),
        netProfit: filtered.reduce((sum, r) => sum + (r.netProfit || 0), 0),
        totalHours: filtered.reduce((sum, r) => sum + (r.hours || 0), 0),
        totalOrders: filtered.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0),
        totalDistance: filtered.reduce((sum, r) => sum + (r.distance || 0), 0),
        workingDays: uniqueDates.size
    };
    
    const avgIncomePerDay = s.workingDays > 0 ? s.totalIncome / s.workingDays : 0;
    const avgNetProfitPerDay = s.workingDays > 0 ? s.netProfit / s.workingDays : 0;
    const avgPerHour = s.totalHours > 0 ? s.netProfit / s.totalHours : 0;
    const avgCheck = s.totalOrders > 0 ? s.totalIncome / s.totalOrders : 0;
    const ordersPerHour = s.totalHours > 0 ? s.totalOrders / s.totalHours : 0;
    const efficiencyPercent = s.totalIncome > 0 ? (s.netProfit / s.totalIncome) * 100 : 0;
    
    const setEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    
    setEl('total-income', formatMoney(s.totalIncome));
    setEl('avg-income-per-day', formatMoney(avgIncomePerDay));
    setEl('total-fuel', formatMoney(s.totalFuel));
    setEl('total-repair', formatMoney(s.totalRepair));
    setEl('total-tax', formatMoney(s.totalTax));
    setEl('total-expenses', formatMoney(s.totalExpenses));
    setEl('net-profit', formatMoney(s.netProfit));
    setEl('avg-net-profit-per-day', formatMoney(avgNetProfitPerDay));
    setEl('total-hours', s.totalHours.toFixed(0));
    setEl('total-orders', s.totalOrders);
    setEl('total-distance', s.totalDistance.toFixed(2));
    setEl('working-days', s.workingDays);
    setEl('avg-per-hour', formatMoney(avgPerHour));
    setEl('avg-check', formatMoney(avgCheck));
    setEl('orders-per-hour', ordersPerHour.toFixed(2));
    setEl('efficiency-percent', efficiencyPercent.toFixed(2) + '%');
    
    updateCharts(filtered);
    
    // Сохраняем состояние
    saveState();
}

function updateCharts(filteredRecords) {
    if (!filteredRecords || filteredRecords.length === 0) {
        if (incomeChart) { incomeChart.destroy(); incomeChart = null; }
        if (expensesChart) { expensesChart.destroy(); expensesChart = null; }
        return;
    }
    
    // Сортировка с использованием parseLocalDate
    const sorted = [...filteredRecords].sort((a, b) => {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (da || 0) - (db || 0);
    });
    
    // Формирование меток с использованием parseLocalDate
    const labels = sorted.map(r => { 
        const d = parseLocalDate(r.date);
        if (!d) return '??';
        return d.getDate() + '.' + (d.getMonth() + 1); 
    });
    
    const canvas1 = document.getElementById('income-chart');
    const canvas2 = document.getElementById('expenses-chart');
    
    if (canvas1) {
        const ctx1 = canvas1.getContext('2d');
        if (incomeChart) incomeChart.destroy();
        incomeChart = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Доход', data: sorted.map(r => r.totalIncome || 0), backgroundColor: 'rgba(16,185,129,0.7)' },
                    { label: 'Прибыль', data: sorted.map(r => r.netProfit || 0), backgroundColor: 'rgba(102,126,234,0.7)' }
                ]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
    }
    
    if (canvas2) {
        const ctx2 = canvas2.getContext('2d');
        if (expensesChart) expensesChart.destroy();
        const fuel = sorted.reduce((sum, r) => sum + (r.fuelCost || 0), 0);
        const repair = sorted.reduce((sum, r) => sum + (r.repairCost || 0), 0);
        const tax = sorted.reduce((sum, r) => sum + (r.tax || 0), 0);
        if (fuel === 0 && repair === 0 && tax === 0) return;
        expensesChart = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: ['Бензин', 'Ремонт', 'Налог'],
                datasets: [{ data: [fuel, repair, tax], backgroundColor: ['#ef4444','#f59e0b','#8b5cf6'] }]
            },
            options: { responsive: true }
        });
    }
}

function initComparisonSelectors() {
    const months = new Set(), years = new Set();
    records.forEach(r => {
        const d = parseLocalDate(r.date);
        if (!d) return;
        months.add((d.getMonth() + 1).toString().padStart(2, '0'));
        years.add(d.getFullYear());
    });
    
    const names = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                   'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    
    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');
    
    if (!c1m || !c1y || !c2m || !c2y) return;
    
    // Заполняем селекторы месяцев
    [c1m, c2m].forEach(select => {
        select.innerHTML = '<option value="">Весь год</option>';
        const sortedMonths = [...months].sort((a, b) => a - b);
        sortedMonths.forEach(m => {
            const o = document.createElement('option');
            o.value = m;
            o.textContent = names[parseInt(m)];
            select.appendChild(o);
        });
    });
    
    // Заполняем селекторы годов
    [c1y, c2y].forEach(select => {
        select.innerHTML = '';
        const sortedYears = [...years].sort((a, b) => b - a); // Сортировка по убыванию (сначала новые)
        sortedYears.forEach(y => {
            const o = document.createElement('option');
            o.value = y;
            o.textContent = y;
            select.appendChild(o);
        });
    });
    
    // Устанавливаем значения по умолчанию (последний год)
    if (years.size > 0) {
        const sortedYears = [...years].sort((a, b) => b - a);
        c1y.value = sortedYears[0];
        c2y.value = sortedYears[0];
    }
}

function getPeriodStats(month, year) {
    let filtered = [...records];
    
    // Фильтрация по году
    if (year) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && d.getFullYear().toString() === year;
        });
    }
    
    // Фильтрация по месяцу
    if (month) {
        filtered = filtered.filter(r => {
            const d = parseLocalDate(r.date);
            return d && (d.getMonth() + 1).toString().padStart(2, '0') === month;
        });
    }
    
    const uniqueDates = new Set();
    filtered.forEach(r => {
        if (r.hours > 0 || r.recordType === 'work') {
            uniqueDates.add(r.date);
        }
    });
    
    return {
        totalIncome: filtered.reduce((sum, r) => sum + (r.totalIncome || 0), 0),
        totalExpenses: filtered.reduce((sum, r) => sum + (r.totalExpenses || 0), 0),
        netProfit: filtered.reduce((sum, r) => sum + (r.netProfit || 0), 0),
        totalHours: filtered.reduce((sum, r) => sum + (r.hours || 0), 0),
        totalOrders: filtered.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0),
        totalDistance: filtered.reduce((sum, r) => sum + (r.distance || 0), 0),
        workingDays: uniqueDates.size,
        recordsCount: filtered.length
    };
}

function formatPeriodName(month, year) {
    const names = ['','Январь','Февраль','Март','Апрель','Май','Июнь',
        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    if (month && year) {
        return `${names[+month]} ${year}`;
    } else if (year) {
        return `${year} год`;
    }
    return 'Все данные';
}

function calcDiff(val1, val2) {
    if (val2 === 0) {
        return { diff: val1, percent: val1 !== 0 ? 100 : 0 };
    }
    const diff = val1 - val2;
    const percent = (diff / Math.abs(val2)) * 100;
    return { diff, percent };
}

function formatDiff(val1, val2, isMoney = true) {
    const diff = val1 - val2;
    const percent = val2 !== 0 ? (diff / Math.abs(val2)) * 100 : 0;
    const diffStr = isMoney ? formatMoney(Math.abs(diff)) : Math.abs(diff).toFixed(1);
    const percentStr = isFinite(percent) ? ` (${Math.abs(percent).toFixed(1)}%)` : '';
    if (diff > 0) {
        return `<span class="diff-positive">↑ +${diffStr}${percentStr}</span>`;    } else if (diff < 0) {
        return `<span class="diff-negative">↓ ${diffStr}${percentStr}</span>`;
    } else {
        return `<span class="diff-neutral">→ ${diffStr}${percentStr}</span>`;
    }
}

function updateComparison() {
    const c1m = document.getElementById('compare1-month');
    const c1y = document.getElementById('compare1-year');
    const c2m = document.getElementById('compare2-month');
    const c2y = document.getElementById('compare2-year');
    if (!c1m || !c1y || !c2m || !c2y) return;
    const month1 = c1m.value;
    const year1 = c1y.value;
    const month2 = c2m.value;
    const year2 = c2y.value;
    const s1 = getPeriodStats(month1, year1);
    const s2 = getPeriodStats(month2, year2);
    const name1 = formatPeriodName(month1, year1);
    const name2 = formatPeriodName(month2, year2);
    const results = document.getElementById('comparison-results');
    if (!results) return;
    if (s1.recordsCount === 0 && s2.recordsCount === 0) {
        results.innerHTML = '<p class="comparison-hint">Нет данных для выбранных периодов</p>';
        return;
    }
    const avgPerHour1 = s1.totalHours > 0 ? s1.netProfit / s1.totalHours : 0;
    const avgPerHour2 = s2.totalHours > 0 ? s2.netProfit / s2.totalHours : 0;
    const avgCheck1 = s1.totalOrders > 0 ? s1.totalIncome / s1.totalOrders : 0;
    const avgCheck2 = s2.totalOrders > 0 ? s2.totalIncome / s2.totalOrders : 0;
    const ordersPerHour1 = s1.totalHours > 0 ? s1.totalOrders / s1.totalHours : 0;
    const ordersPerHour2 = s2.totalHours > 0 ? s2.totalOrders / s2.totalHours : 0;
    const efficiency1 = s1.totalIncome > 0 ? (s1.netProfit / s1.totalIncome) * 100 : 0;
    const efficiency2 = s2.totalIncome > 0 ? (s2.netProfit / s2.totalIncome) * 100 : 0;
    const incomePerDay1 = s1.workingDays > 0 ? s1.totalIncome / s1.workingDays : 0;
    const incomePerDay2 = s2.workingDays > 0 ? s2.totalIncome / s2.workingDays : 0;
    const profitPerDay1 = s1.workingDays > 0 ? s1.netProfit / s1.workingDays : 0;
    const profitPerDay2 = s2.workingDays > 0 ? s2.netProfit / s2.workingDays : 0;
    let html = `
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Показатель</th>
                    <th><ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px;"></ion-icon>${name1}</th>
                    <th><ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 4px;"></ion-icon>${name2}</th>
                    <th>Разница</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="metric-name"><ion-icon name="cash-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Общий доход</td>
                    <td>${formatMoney(s1.totalIncome)}</td>
                    <td>${formatMoney(s2.totalIncome)}</td>
                    <td>${formatDiff(s1.totalIncome, s2.totalIncome)}</td>
                </tr>
                <tr>                    <td class="metric-name"><ion-icon name="trending-up-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Доход в день</td>
                    <td>${formatMoney(incomePerDay1)}</td>
                    <td>${formatMoney(incomePerDay2)}</td>
                    <td>${formatDiff(incomePerDay1, incomePerDay2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="arrow-down-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Всего расходов</td>
                    <td>${formatMoney(s1.totalExpenses)}</td>
                    <td>${formatMoney(s2.totalExpenses)}</td>
                    <td>${formatDiff(s1.totalExpenses, s2.totalExpenses)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="checkmark-circle-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Чистая прибыль</td>
                    <td>${formatMoney(s1.netProfit)}</td>
                    <td>${formatMoney(s2.netProfit)}</td>
                    <td>${formatDiff(s1.netProfit, s2.netProfit)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="trophy-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Прибыль в день</td>
                    <td>${formatMoney(profitPerDay1)}</td>
                    <td>${formatMoney(profitPerDay2)}</td>
                    <td>${formatDiff(profitPerDay1, profitPerDay2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="time-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Часов</td>
                    <td>${s1.totalHours.toFixed(1)}</td>
                    <td>${s2.totalHours.toFixed(1)}</td>
                    <td>${formatDiff(s1.totalHours, s2.totalHours, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="cube-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Заказов</td>
                    <td>${s1.totalOrders}</td>
                    <td>${s2.totalOrders}</td>
                    <td>${formatDiff(s1.totalOrders, s2.totalOrders, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="navigate-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Пройдено км</td>
                    <td>${s1.totalDistance.toFixed(1)}</td>
                    <td>${s2.totalDistance.toFixed(1)}</td>
                    <td>${formatDiff(s1.totalDistance, s2.totalDistance, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="calendar-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Рабочих дней</td>
                    <td>${s1.workingDays}</td>
                    <td>${s2.workingDays}</td>
                    <td>${formatDiff(s1.workingDays, s2.workingDays, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="wallet-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Средний ₽/час</td>
                    <td>${formatMoney(avgPerHour1)}</td>                    <td>${formatMoney(avgPerHour2)}</td>
                    <td>${formatDiff(avgPerHour1, avgPerHour2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="receipt-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Средний чек</td>
                    <td>${formatMoney(avgCheck1)}</td>
                    <td>${formatMoney(avgCheck2)}</td>
                    <td>${formatDiff(avgCheck1, avgCheck2)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="speedometer-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Заказов в час</td>
                    <td>${ordersPerHour1.toFixed(2)}</td>
                    <td>${ordersPerHour2.toFixed(2)}</td>
                    <td>${formatDiff(ordersPerHour1, ordersPerHour2, false)}</td>
                </tr>
                <tr>
                    <td class="metric-name"><ion-icon name="analytics-outline" style="vertical-align: middle; margin-right: 6px;"></ion-icon>Эффективность</td>
                    <td>${efficiency1.toFixed(1)}%</td>
                    <td>${efficiency2.toFixed(1)}%</td>
                    <td>${formatDiff(efficiency1, efficiency2, false)}</td>
                </tr>
            </tbody>
        </table>
    `;
    const profitDiff = calcDiff(s1.netProfit, s2.netProfit);
    const incomeDiff = calcDiff(s1.totalIncome, s2.totalIncome);
    const hoursDiff = calcDiff(s1.totalHours, s2.totalHours);
    const profitClass = profitDiff.diff > 0 ? 'positive' : (profitDiff.diff < 0 ? 'negative' : 'neutral');
    const incomeClass = incomeDiff.diff > 0 ? 'positive' : (incomeDiff.diff < 0 ? 'negative' : 'neutral');
    const hoursClass = hoursDiff.diff > 0 ? 'positive' : (hoursDiff.diff < 0 ? 'negative' : 'neutral');
    html += `
        <div class="comparison-summary">
            <div class="summary-card ${profitClass}">
                <h4>Итог по прибыли</h4>
                <div class="big-number">${profitDiff.diff > 0 ? '+' : ''}${formatMoney(profitDiff.diff)}</div>
                <div class="small-text">${profitDiff.diff > 0 ? 'Прибыль выше в' : profitDiff.diff < 0 ? 'Прибыль ниже, чем в' : 'Прибыль одинаковая'} ${name2}</div>
            </div>
            <div class="summary-card ${incomeClass}">
                <h4>Итог по доходу</h4>
                <div class="big-number">${incomeDiff.diff > 0 ? '+' : ''}${formatMoney(incomeDiff.diff)}</div>
                <div class="small-text">${isFinite(incomeDiff.percent) ? (incomeDiff.percent > 0 ? '+' : '') + incomeDiff.percent.toFixed(1) + '%' : '—'}</div>
            </div>
            <div class="summary-card ${hoursClass}">                <h4>Отработано часов</h4>
                <div class="big-number">${hoursDiff.diff > 0 ? '+' : ''}${hoursDiff.diff.toFixed(1)} ч</div>
                <div class="small-text">${name1}: ${s1.totalHours.toFixed(1)} ч vs ${name2}: ${s2.totalHours.toFixed(1)} ч</div>
            </div>
        </div>
    `;
    // Разделяем таблицу и карточки
const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
const summaryMatch = html.match(/<div class="comparison-summary"[\s\S]*$/);

if (tableMatch) {
    // Оборачиваем таблицу в прокручиваемый контейнер
    let newHtml = '<div class="table-scroll-container">' + tableMatch[0] + '</div>';
    if (summaryMatch) {
        newHtml += summaryMatch[0];
    }
    results.innerHTML = newHtml;
} else {
    results.innerHTML = html;
}
    updateComparisonChart(name1, name2, s1, s2);
    
    // Сохраняем состояние
    saveState();
}



function updateComparisonChart(name1, name2, s1, s2) {
    const canvas = document.getElementById('comparison-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (comparisonChart) comparisonChart.destroy();
    comparisonChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Доход', 'Расходы', 'Прибыль', 'Часы (x100)', 'Заказы (x10)'],
            datasets: [
                {
                    label: name1,
                    data: [
                        s1.totalIncome,
                        s1.totalExpenses,
                        s1.netProfit,
                        s1.totalHours * 100,
                        s1.totalOrders * 10
                    ],
                    backgroundColor: 'rgba(102, 126, 234, 0.7)',
                    borderColor: '#667eea',
                    borderWidth: 2
                },
                {
                    label: name2,
                    data: [
                        s2.totalIncome,
                        s2.totalExpenses,
                        s2.netProfit,
                        s2.totalHours * 100,
                        s2.totalOrders * 10
                    ],
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let val = context.raw;
                            const label = context.dataset.label;
                            if (context.dataIndex === 3) val = (val / 100).toFixed(1) + ' ч';
                            else if (context.dataIndex === 4) val = (val / 10).toFixed(0) + ' шт';
                            else val = formatMoney(val);
                            return `${label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function quickCompare(type) {
    const now = new Date();
    const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const currentYear = now.getFullYear().toString();
    if (type === 'month') {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        const prevMonth = (d.getMonth() + 1).toString().padStart(2, '0');
        const prevYear = d.getFullYear().toString();
        document.getElementById('compare1-month').value = currentMonth;
        document.getElementById('compare1-year').value = currentYear;
        document.getElementById('compare2-month').value = prevMonth;
        document.getElementById('compare2-year').value = prevYear;
    } else if (type === 'year') {
        document.getElementById('compare1-month').value = '';
        document.getElementById('compare1-year').value = currentYear;
        document.getElementById('compare2-month').value = '';
        document.getElementById('compare2-year').value = (parseInt(currentYear) - 1).toString();
    } else if (type === 'yoy') {
        document.getElementById('compare1-month').value = currentMonth;
        document.getElementById('compare1-year').value = currentYear;
        document.getElementById('compare2-month').value = currentMonth;
        document.getElementById('compare2-year').value = (parseInt(currentYear) - 1).toString();
    }
    updateComparison();
}

function populateFilters() {
    const months = new Set(), years = new Set();
    
    records.forEach(r => {
        const d = parseLocalDate(r.date);
        if (d) {
            months.add((d.getMonth() + 1).toString().padStart(2, '0'));
            years.add(d.getFullYear());
        }
    });
    
    const ms = document.getElementById('filter-month');
    const ys = document.getElementById('filter-year');
    
    if (!ms || !ys) return;
    
    const cm = ms.value;
    const cy = ys.value;
    
    // Заполняем селектор месяцев
    ms.innerHTML = '<option value="">Все месяцы</option>';
    const names = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                   'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    
    const sortedMonths = [...months].sort((a, b) => a - b);
    sortedMonths.forEach(m => {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = names[parseInt(m)];
        ms.appendChild(o);
    });
    
    // Заполняем селектор годов
    ys.innerHTML = '<option value="">Все годы</option>';
    const sortedYears = [...years].sort((a, b) => b - a); // Сортировка по убыванию (сначала новые)
    sortedYears.forEach(y => {
        const o = document.createElement('option');
        o.value = y;
        o.textContent = y;
        ys.appendChild(o);
    });
    
    // Восстанавливаем выбранные значения
    ms.value = cm;
    ys.value = cy;
}

// ===== РЕНДЕР СТРОКИ ТАБЛИЦЫ С ИНТЕГРАЦИЕЙ ТОПЛИВА И TOOLTIP =====
function getRecordRowHTML(r) {
    const typeLabel = r.recordType === 'bonus' ?
        ' <ion-icon name= "gift-outline " style= "vertical-align: middle; margin-right: 4px; color: #AF52DE; " > </ion-icon >Бонус' :
        r.recordType === 'expense' ?
        ' <ion-icon name= "remove-circle-outline " style= "vertical-align: middle; margin-right: 4px; color: #FF3B30; " > </ion-icon >Расход' :
        ' <ion-icon name= "calendar-outline " style= "vertical-align: middle; margin-right: 4px; color: #007AFF; " > </ion-icon >Работа';
    
    // Проверяем, есть ли детали заправок для tooltip
    const hasFuelDetails = r.fuelDetails && Array.isArray(r.fuelDetails) && r.fuelDetails.length > 0;
    const fuelCellClass = hasFuelDetails ? 'fuel-cell-with-details' : '';
    
    // Формируем data-атрибуты для tooltip топлива (только если есть детали)
    let fuelTooltipAttr = '';
    if (hasFuelDetails) {
        const fuelDetailsJSON = JSON.stringify(r.fuelDetails).replace(/'/g, "&apos;");
        const fuelLiters = r.fuelLiters || 0;
        const fuelCount = r.fuelLogCount || r.fuelDetails.length;
        fuelTooltipAttr = `data-fuel-details='${fuelDetailsJSON}' data-fuel-liters='${fuelLiters}' data-fuel-count='${fuelCount}'`;
    }
    
    // Проверяем, есть ли детали ремонта для tooltip
    const hasRepairDetails = r.repairDetails && Array.isArray(r.repairDetails) && r.repairDetails.length > 0;
    const repairCellClass = hasRepairDetails ? 'repair-cell-with-details' : '';
    
    // Формируем data-атрибуты для tooltip ремонта
    let repairTooltipAttr = '';
    if (hasRepairDetails) {
        const repairDetailsJSON = JSON.stringify(r.repairDetails).replace(/'/g, "&apos;");
        const repairTotal = r.repairCost || 0;
        const repairCount = r.repairLogCount || r.repairDetails.length;
        repairTooltipAttr = `data-repair-details='${repairDetailsJSON}' data-repair-total='${repairTotal}' data-repair-count='${repairCount}'`;
    }
    
    return `
     <td>${formatDate(r.date)}</td>
     <td>${r.weekday || '-'}</td>
     <td>${typeLabel}</td>
     <td>${r.hours || '-'}</td>
     <td>${r.ordersPickup || '-'}</td>
     <td>${r.payPickup ? formatMoney(r.payPickup) : '-'}</td>
     <td>${r.ordersDelivery || '-'}</td>
     <td>${r.payDelivery ? formatMoney(r.payDelivery) : '-'}</td>
     <td>${r.distance ? r.distance.toFixed(1) : '-'}</td>
     <td>${r.payDistance ? formatMoney(r.payDistance) : '-'}</td>
     <td>${r.weight ? r.weight.toFixed(1) : '-'}</td>
     <td>${r.payWeight ? formatMoney(r.payWeight) : '-'}</td>
     <td>${r.loadPay ? formatMoney(r.loadPay) : '-'}</td>
     <td>${r.bonusPay ? formatMoney(r.bonusPay) : '-'}</td>
     <td>${r.rating ? formatMoney(r.rating) : '-'}</td>
     <td>${r.tips ? formatMoney(r.tips) : '-'}</td>
     <td class="${fuelCellClass}" ${fuelTooltipAttr}>${r.fuelCost ? formatMoney(r.fuelCost) : '-'}</td>
     <td class="${repairCellClass}" ${repairTooltipAttr}>${r.repairCost ? formatMoney(r.repairCost) : '-'}</td>
     <td>${r.tax ? formatMoney(r.tax) : '-'}</td>
     <td>${formatMoney(r.totalIncome)}</td>
     <td>${formatMoney(r.totalExpenses)}</td>
     <td style="color:${r.netProfit >= 0 ? '#10b981' : '#ef4444'};font-weight:bold">${formatMoney(r.netProfit)}</td>
     <td>
         <button class="btn btn-success" onclick="editRecord('${r.id}')"><ion-icon name="create-outline"></ion-icon></button>
         <button class="btn btn-danger" onclick="deleteRecord('${r.id}')"><ion-icon name="trash-outline"></ion-icon></button>
     </td>
 `;
}

function renderTable() {
    const tbody = document.getElementById('records-body');
    
    if (!tbody) {
        console.error('❌ Элемент <tbody id="records-body"> не найден в HTML');
        return;
    }
    
    tbody.innerHTML = '';
    
    // Определяем, активна ли вкладка "История"
    const historyTab = document.getElementById('tab-history');
    const isHistoryActive = historyTab && historyTab.classList.contains('active');
    
    let filteredRecords = [...records];
    
    // ===== ЕСЛИ АКТИВНА ВКЛАДКА "ИСТОРИЯ" =====
    if (isHistoryActive) {
// 1. Сначала применяем фильтр по дате (месяц/год) ТОЛЬКО если не активен фильтр по столбцу "Дата"
if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear && filterState.date.values.length === 0) {
    filteredRecords = filteredRecords.filter(function(r) {
        if (!r.date) return false;
        const d = parseLocalDate(r.date);
        if (!d) return false;
        return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
    });
}
        
        // 2. Затем применяем ВСЕ фильтры из filterState (по всем 23 столбцам)
        // ⭐ ИСПРАВЛЕНИЕ: было Filters, стало applyFilters
        filteredRecords = applyFilters(filteredRecords);
        
        // 3. Сортируем
        if (sortState.column && sortState.direction) {
            filteredRecords = applySorting(filteredRecords);
        } else {
            filteredRecords.sort((a, b) => {
                const da = parseLocalDate(a.date);
                const db = parseLocalDate(b.date);
                return (db || 0) - (da || 0);
            });
        }
        
        // 4. Рендерим с недельными итогами или без
        const hasActiveFilters = Object.keys(filterState).some(key => {
            const filter = filterState[key];
            if (filter.type === 'checkbox' || filter.type === 'month') return filter.values && filter.values.length > 0;
            else if (filter.type === 'range') return filter.min !== '' || filter.max !== '';
            return false;
        });
        
        const hasActiveSorting = sortState.column !== null && sortState.direction !== null;
        const shouldHideWeeklySummary = hasActiveFilters || hasActiveSorting;
        
        if (!shouldHideWeeklySummary && !showAllHistoryMode) {
            renderTableWithWeeklySummary(tbody, filteredRecords);
        } else {
            filteredRecords.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = getRecordRowHTML(r);
                tbody.appendChild(tr);
            });
        }
        
        // Обновляем пагинацию
        const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);
        renderPagination(totalPages);
        
    } else {
        // ===== ДЛЯ ДРУГИХ ВКЛАДОК (аналитика и т.д.) =====
        filteredRecords = applyFilters(filteredRecords);
        
        const hasActiveFilters = Object.keys(filterState).some(key => {
            const filter = filterState[key];
            if (filter.type === 'checkbox' || filter.type === 'month') return filter.values && filter.values.length > 0;
            else if (filter.type === 'range') return filter.min !== '' || filter.max !== '';
            return false;
        });
        
        const hasActiveSorting = sortState.column !== null && sortState.direction !== null;
        const shouldHideWeeklySummary = hasActiveFilters || hasActiveSorting;
        
        if (sortState.column && sortState.direction) {
            filteredRecords = applySorting(filteredRecords);
        } else {
            filteredRecords.sort((a, b) => {
                const da = parseLocalDate(a.date);
                const db = parseLocalDate(b.date);
                return (db || 0) - (da || 0);
            });
        }
        
        if (!shouldHideWeeklySummary) {
            renderTableWithWeeklySummary(tbody, filteredRecords);
        } else {
            filteredRecords.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = getRecordRowHTML(r);
                tbody.appendChild(tr);
            });
        }
    }

    
    // ===== ИНФОРМАЦИОННЫЙ БЛОК =====
    let tableContainer = tbody.closest('.table-container');
    if (!tableContainer) {
        tableContainer = tbody.closest('table');
    }
    if (!tableContainer) {
        tableContainer = tbody.parentElement;
    }
    
    if (tableContainer) {
        let infoEl = document.getElementById('filter-info');
        if (!infoEl) {
            infoEl = document.createElement('div');
            infoEl.id = 'filter-info';
            infoEl.style.cssText = 'padding:15px;background:#dbeafe;border-radius:8px;margin:10px 0;text-align:center;color:#1e40af;font-weight:600;';
            if (tableContainer.tagName === 'TABLE') {
                tableContainer.parentElement.insertBefore(infoEl, tableContainer.nextSibling);
            } else {
                tableContainer.appendChild(infoEl);
            }
        }
        
        const count = filteredRecords.length;
        const total = records.length;
        
        if (count < total || count === 0) {
            infoEl.style.display = 'block';
            if (isHistoryActive) {
                let filterInfo = '';
                if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
                    const monthName = getMonthName(currentHistoryMonth);
                    filterInfo = ` за ${monthName} ${currentHistoryYear}`;
                }
                infoEl.textContent = `📅 Показано ${count} из ${total} записей${filterInfo}`;
            } else {
                infoEl.textContent = `📊 Показано ${count} из ${total} записей`;
            }
        } else {
            infoEl.style.display = 'none';
        }
    }
}

// ===== ПРИМЕНЕНИЕ ВСЕХ ФИЛЬТРОВ (ДЛЯ ИСТОРИИ) =====
function applyAllFilters(data) {
    return data.filter(r => {
        // 1. Фильтр по дате (месяц)
        if (filterState.date.values.length > 0) {
            const recordMonth = r.date ? r.date.substring(0, 7) : '';
            if (!filterState.date.values.includes(recordMonth)) return false;
        }
        
        // 2. Фильтр по дню недели
        if (filterState.weekday.values.length > 0) {
            const recordWeekday = r.weekday ? r.weekday.trim().charAt(0).toUpperCase() + r.weekday.trim().slice(1).toLowerCase() : '';
            if (!filterState.weekday.values.includes(recordWeekday)) return false;
        }
        
        // 3. Фильтр по типу записи
        if (filterState.type.values.length > 0) {
            if (!filterState.type.values.includes(r.recordType)) return false;
        }
        
        // 4. Фильтры по диапазонам для всех числовых полей
        const rangeFields = Object.keys(filterState).filter(k => filterState[k].type === 'range');
        for (const field of rangeFields) {
            const filter = filterState[field];
            const value = parseFloat(r[field]) || 0;
            if (filter.min !== '' && value < parseFloat(filter.min)) return false;
            if (filter.max !== '' && value > parseFloat(filter.max)) return false;
        }
        
        return true;
    });
}


// ===== ПОЛУЧЕНИЕ ISO НЕДЕЛИ ИЗ ДАТЫ =====
function getISOWeek(dateStr) {
    const date = parseLocalDate(dateStr);
    if (!date) return '';
    
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
    const year = date.getFullYear();
    return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

// ===== ПОЛУЧЕНИЕ ДИАПАЗОНА ДАТ НЕДЕЛИ =====
function getWeekDateRange(weekKey) {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);
    
    // Находим первый день года — используем parseLocalDate
    const jan4 = parseLocalDate(`${year}-01-04`);
    if (!jan4) return { start: null, end: null, label: '' };
    
    const dayOfWeek = (jan4.getDay() + 6) % 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - dayOfWeek);
    
    // Находим понедельник нужной недели
    const weekMonday = new Date(firstMonday);
    weekMonday.setDate(firstMonday.getDate() + (week - 1) * 7);
    
    const weekSunday = new Date(weekMonday);
    weekSunday.setDate(weekMonday.getDate() + 6);
    
    return {
        start: weekMonday,
        end: weekSunday,
        label: `${weekMonday.getDate()}.${String(weekMonday.getMonth()+1).padStart(2,'0')} - ${weekSunday.getDate()}.${String(weekSunday.getMonth()+1).padStart(2,'0')}.${weekSunday.getFullYear()}`
    };
}

// ===== РЕНДЕР ТАБЛИЦЫ С ПОНЕДЕЛЬНЫМИ ИТОГАМИ =====
// ===== РЕНДЕР ТАБЛИЦЫ С ПОНЕДЕЛЬНЫМИ ИТОГАМИ =====
function renderTableWithWeeklySummary(tbody, records) {
    // Определяем реальное количество колонок из thead
    const headerCells = document.querySelectorAll('thead tr:first-child th');
    const totalColumns = headerCells.length; // Динамически получаем число колонок!
    
    const weeksMap = new Map();
    records.forEach(r => {
        if (!r.date) return;
        const weekKey = getISOWeek(r.date);
        if (!weeksMap.has(weekKey)) weeksMap.set(weekKey, []);
        weeksMap.get(weekKey).push(r);
    });

    const sortedWeeks = Array.from(weeksMap.keys()).sort((a, b) => b.localeCompare(a));

    sortedWeeks.forEach(weekKey => {
        const weekRecords = weeksMap.get(weekKey);
        const weekRange = getWeekDateRange(weekKey);

        const summary = weekRecords.reduce((acc, r) => {
            acc.hours += r.hours || 0;
            acc.ordersPickup += r.ordersPickup || 0;
            acc.payPickup += r.payPickup || 0;
            acc.ordersDelivery += r.ordersDelivery || 0;
            acc.payDelivery += r.payDelivery || 0;
            acc.distance += r.distance || 0;
            acc.payDistance += r.payDistance || 0;
            acc.weight += r.weight || 0;
            acc.payWeight += r.payWeight || 0;
            acc.loadPay += r.loadPay || 0;
            acc.bonusPay += r.bonusPay || 0;
            acc.rating += r.rating || 0;
            acc.tips += r.tips || 0;
            acc.fuelCost += r.fuelCost || 0;
            acc.repairCost += r.repairCost || 0;
            acc.tax += r.tax || 0;
            acc.totalIncome += r.totalIncome || 0;
            acc.totalExpenses += r.totalExpenses || 0;
            acc.netProfit += r.netProfit || 0;
            if (r.recordType === 'work') acc.workingDays += 1;
            return acc;
        }, { 
            hours: 0, ordersPickup: 0, payPickup: 0, 
            ordersDelivery: 0, payDelivery: 0, 
            distance: 0, payDistance: 0, 
            weight: 0, payWeight: 0, 
            loadPay: 0, bonusPay: 0, rating: 0, tips: 0,
            fuelCost: 0, repairCost: 0, tax: 0,
            totalIncome: 0, totalExpenses: 0, netProfit: 0, 
            workingDays: 0 
        });

        // ✅ Заголовок недели — colspan = ВСЕМ колонкам
        const headerRow = document.createElement('tr');
        headerRow.className = 'week-summary-header';
        headerRow.innerHTML = `
            <td colspan="${totalColumns}">
                <ion-icon name="calendar-outline" class="week-header-icon"></ion-icon>
                Неделя ${weekKey.split('-W')[1]} (${weekRange.label}) — 
                ${summary.workingDays} ${summary.workingDays === 1 ? 'день' : (summary.workingDays >= 2 && summary.workingDays <= 4 ? 'дня' : 'дней')}
            </td>
        `;
        tbody.appendChild(headerRow);

        // Записи недели
        weekRecords.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = getRecordRowHTML(r);
            tbody.appendChild(tr);
        });

        // ✅ Итоговая строка — ровно totalColumns ячеек
        const summaryRow = document.createElement('tr');
        summaryRow.className = 'week-summary-row';
        
        // Собираем все значения в массив в правильном порядке
        const values = [
            summary.hours.toFixed(1),           // Часы
            summary.ordersPickup,               // Забор (шт)
            formatMoney(summary.payPickup),     // Забор (₽)
            summary.ordersDelivery,             // Выдача (шт)
            formatMoney(summary.payDelivery),   // Выдача (₽)
            summary.distance.toFixed(1),        // Км
            formatMoney(summary.payDistance),   // Км (₽)
            summary.weight.toFixed(1),          // Вес (кг)
            formatMoney(summary.payWeight),     // Вес (₽)
            formatMoney(summary.loadPay),       // Нагрузка (₽)
            formatMoney(summary.bonusPay),      // Бонус (₽)
            formatMoney(summary.rating),        // Рейтинг (₽)
            formatMoney(summary.tips),          // Чаевые (₽)
            formatMoney(summary.fuelCost),      // Бензин (₽)
            formatMoney(summary.repairCost),    // Ремонт (₽)
            formatMoney(summary.tax),           // Налог (₽)
            formatMoney(summary.totalIncome),   // Доход (₽)
            formatMoney(summary.totalExpenses), // Расход (₽)
            `<span style="color:${summary.netProfit >= 0 ? '#10b981' : '#ef4444'}">${formatMoney(summary.netProfit)}</span>` // Прибыль
        ];
        
        // Формируем HTML: 3 объединённые ячейки (Дата, День, Тип) + все значения + пустая для действий
        let summaryHTML = `<td colspan="3"><strong><ion-icon name="bar-chart-outline" class="week-summary-icon"></ion-icon> ИТОГО:</strong></td>`;
        values.forEach(v => {
            summaryHTML += `<td><strong>${v}</strong></td>`;
        });
        summaryHTML += `<td></td>`; // Пустая ячейка для колонки "Действия"
        
        summaryRow.innerHTML = summaryHTML;
        tbody.appendChild(summaryRow);
    });
}

function editRecord(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    editingId = id;
    document.getElementById('date').value = r.date;
    updateWeekday();
    document.getElementById('hours').value = r.hours;
    document.getElementById('orders-pickup').value = r.ordersPickup;    document.getElementById('pay-pickup').value = r.payPickup;
    document.getElementById('orders-delivery').value = r.ordersDelivery;
    document.getElementById('pay-delivery').value = r.payDelivery;
    document.getElementById('distance').value = r.distance;
    document.getElementById('pay-distance').value = r.payDistance;
    document.getElementById('weight').value = r.weight;
    document.getElementById('pay-weight').value = r.payWeight;
    document.getElementById('load-pay').value = r.loadPay;
    document.getElementById('bonus-pay').value = r.bonusPay || '';
    document.getElementById('rating').value = r.rating;
    document.getElementById('tips').value = r.tips;
    document.getElementById('fuel-cost').value = r.fuelCost;
    document.getElementById('repair-cost').value = r.repairCost;
    document.getElementById('tax').value = r.tax;
    document.getElementById('record-type').value = r.recordType || 'work';
    document.getElementById('bonus-period').value = r.bonusPeriod || '';
    document.getElementById('editing-notice').style.display = 'block';
    switchTab('entry');
}

async function deleteRecord(id, confirmDelete = true) {
    if (confirmDelete && !confirm('Удалить запись?')) return;
    if (typeof db !== 'undefined') {
        await deleteRecordFromFirebase(id);
    }
    records = records.filter(r => r.id !== id);
    saveData();
    renderTable();
    populateFilters();
}

function exportData() {
    try {
        // Получаем данные из глобальных переменных ИЛИ из localStorage
        const recordsToExport = records || [];
        const tariffsToExport = tariffs || [];
        
        // Получаем топливо: сначала пробуем window.fuelLogs, потом localStorage
        let fuelToExport = [];
        if (window.fuelLogs && window.fuelLogs.length > 0) {
            fuelToExport = window.fuelLogs;
        } else {
            const localFuel = localStorage.getItem('driverFuelLogs');
            if (localFuel) {
                try {
                    fuelToExport = JSON.parse(localFuel);
                } catch (e) {
                    console.error('❌ Ошибка парсинга топлива из localStorage:', e);
                }
            }
        }
        
        // Получаем ремонты: сначала пробуем window.repairRecords, потом localStorage
        let repairToExport = [];
        if (window.repairRecords && window.repairRecords.length > 0) {
            repairToExport = window.repairRecords;
        } else {
            const localRepair = localStorage.getItem('repair_records');
            if (localRepair) {
                try {
                    repairToExport = JSON.parse(localRepair);
                } catch (e) {
                    console.error(' Ошибка парсинга ремонтов из localStorage:', e);
                }
            }
        }
        
        const data = {
            records: recordsToExport,
            tariffs: tariffsToExport,
            fuelLogs: fuelToExport,
            repairRecords: repairToExport,
            exportDate: new Date().toISOString(),
            version: '2.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `driver-full-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        
        alert(`✅ Полная резервная копия экспортирована!\n\n📝 Записей: ${recordsToExport.length}\n⛽ Заправок: ${fuelToExport.length}\n🔧 Ремонтов: ${repairToExport.length}`);
    } catch (err) {
        alert('❌ Ошибка при экспорте: ' + err.message);
    }
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const importBtn = e.target.previousElementSibling;
    const originalText = importBtn.textContent;
    importBtn.textContent = '⏳ Загрузка...';
    importBtn.disabled = true;
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            
            if (data.records) {
                // 1. Восстанавливаем основные записи и тарифы
                records = data.records.map(normalizeRecord);
                if (data.tariffs) tariffs = data.tariffs.map(normalizeTariff);
                
                // 2. Восстанавливаем данные топлива
                if (data.fuelLogs) {
                    window.fuelLogs = data.fuelLogs;
                    localStorage.setItem('driverFuelLogs', JSON.stringify(window.fuelLogs));
                    console.log('✅ Импортировано заправок:', window.fuelLogs.length);
                }
                
                // 3. Восстанавливаем данные ремонтов
                if (data.repairRecords) {
                    window.repairRecords = data.repairRecords;
                    localStorage.setItem('repair_records', JSON.stringify(window.repairRecords));
                    console.log('✅ Импортировано ремонтов:', window.repairRecords.length);
                }
                
                // 4. Сохраняем основные данные в localStorage
                saveData();
                
                // 5. Синхронизация с Firebase (если пользователь авторизован)
                if (typeof db !== 'undefined' && currentUser) {
                    // Синхронизируем записи и тарифы
                    await syncToFirebase();
                    
                    // Синхронизируем топливо
                    if (data.fuelLogs && typeof window.saveFuelLogToFirebase === 'function') {
                        for (const log of data.fuelLogs) {
                            await window.saveFuelLogToFirebase(log);
                        }
                    }
                    
                    // Синхронизируем ремонты
                    if (data.repairRecords && typeof window.syncRepairToFirebase === 'function') {
                        for (const rec of data.repairRecords) {
                            await window.syncRepairToFirebase(rec);
                        }
                    }
                }
                
                // 6. Обновляем интерфейс основной таблицы
                renderTable();
                renderTariffs();
                populateFilters();
                updateAnalytics();
                
                // 7. Обновляем интерфейс модуля топлива
                if (typeof window.renderFuelLogs === 'function') window.renderFuelLogs();
                if (typeof window.updateFuelStats === 'function') window.updateFuelStats();
                if (typeof window.updateFuelChart === 'function') window.updateFuelChart();
                
                // 8. Обновляем интерфейс модуля ремонта
                if (typeof window.renderRepairList === 'function') window.renderRepairList();
                if (typeof window.updateRepairStats === 'function') window.updateRepairStats();
                if (typeof window.updateRepairCharts === 'function') window.updateRepairCharts();
                
                // 9. КРИТИЧЕСКИ ВАЖНО: Пересчитываем расходы в основной таблице на основе импортированных данных
                if (typeof window.syncFuelToRecords === 'function') await window.syncFuelToRecords();
                if (typeof window.syncRepairToMainRecords === 'function') await window.syncRepairToMainRecords();
                
                const fuelCount = data.fuelLogs ? data.fuelLogs.length : 0;
                const repairCount = data.repairRecords ? data.repairRecords.length : 0;
                
                alert(`✅ Успешно импортировано:\n📝 Записей: ${records.length}\n⛽ Заправок: ${fuelCount}\n🔧 Ремонтов: ${repairCount}`);
                
            } else if (Array.isArray(data)) {
                // Поддержка старого формата (только массив записей)
                records = data.map(normalizeRecord);
                saveData();
                
                if (typeof db !== 'undefined' && currentUser) {
                    await syncToFirebase();
                }
                
                renderTable();
                populateFilters();
                updateAnalytics();
                alert('✅ Импортировано ' + records.length + ' записей (старый формат)');
            } else {
                alert('❌ Неверный формат файла резервной копии');
            }
        } catch (err) {
            alert('❌ Ошибка при импорте: ' + err.message);
        } finally {
            importBtn.textContent = originalText;
            importBtn.disabled = false;
            e.target.value = ''; // Сброс input для возможности повторного выбора того же файла
        }
    };
    
    reader.onerror = () => {
        alert('❌ Ошибка при чтении файла');
        importBtn.textContent = originalText;
        importBtn.disabled = false;
        e.target.value = '';
    };
    
    reader.readAsText(file);
}

// Синхронизация данных с Firebase (полная замена)
async function syncToFirebase() {
    if (!currentUser) return;

    try {
        console.log('🔄 Запуск умной инкрементальной синхронизации...');
        const userRef = db.collection('users').doc(currentUser.uid);
        const recordsRef = userRef.collection('records');
        const tariffsRef = userRef.collection('tariffs');

        const BATCH_SIZE = 400; // Безопасный лимит Firestore

        // ==========================================
        // 1. ПОДГОТОВКА: Получаем ID всех записей, которые уже есть в Firebase
        // ==========================================
        const fbRecordsSnapshot = await recordsRef.get();
        const fbRecordIds = new Set(fbRecordsSnapshot.docs.map(doc => doc.id));
        const localRecordIds = new Set(records.map(r => r.id));

        // Находим записи, которые были УДАЛЕНЫ локально, чтобы удалить их и из Firebase
        const idsToDelete = [...fbRecordIds].filter(id => !localRecordIds.has(id));
        
        if (idsToDelete.length > 0) {
            console.log(`🗑️ Очистка ${idsToDelete.length} удаленных локально записей из Firebase...`);
            for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
                const batch = db.batch();
                idsToDelete.slice(i, i + BATCH_SIZE).forEach(id => batch.delete(recordsRef.doc(id)));
                await batch.commit();
            }
        }

        // ==========================================
        // 2. УМНАЯ ЗАГРУЗКА/ОБНОВЛЕНИЕ ЗАПИСЕЙ (UPSERT)
        // ==========================================
        if (records.length > 0) {
            console.log(`📤 Синхронизация ${records.length} записей (обновление + создание)...`);
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = db.batch();
                const chunk = records.slice(i, i + BATCH_SIZE);

                for (const r of chunk) {
                    const recordToSave = { ...r };
                    const docId = recordToSave.id; // Сохраняем ID, чтобы использовать его как ID документа
                    delete recordToSave.id; // В теле документа поле id не храним

                    // batch.set работает как Upsert: 
                    // Если документ с docId существует -> обновит его.
                    // Если не существует -> создаст новый.
                    batch.set(recordsRef.doc(docId), recordToSave);
                }
                await batch.commit();
            }
        }

        // ==========================================
        // 3. УМНАЯ ЗАГРУЗКА/ОБНОВЛЕНИЕ ТАРИФОВ (аналогично)
        // ==========================================
        const fbTariffsSnapshot = await tariffsRef.get();
        const fbTariffIds = new Set(fbTariffsSnapshot.docs.map(doc => doc.id));
        const localTariffIds = new Set(tariffs.map(t => t.id));
        
        const tariffIdsToDelete = [...fbTariffIds].filter(id => !localTariffIds.has(id));
        if (tariffIdsToDelete.length > 0) {
            for (let i = 0; i < tariffIdsToDelete.length; i += BATCH_SIZE) {
                const batch = db.batch();
                tariffIdsToDelete.slice(i, i + BATCH_SIZE).forEach(id => batch.delete(tariffsRef.doc(id)));
                await batch.commit();
            }
        }

        if (tariffs.length > 0) {
            for (let i = 0; i < tariffs.length; i += BATCH_SIZE) {
                const batch = db.batch();
                const chunk = tariffs.slice(i, i + BATCH_SIZE);

                for (const t of chunk) {
                    const tariffToSave = { ...t };
                    const docId = tariffToSave.id;
                    delete tariffToSave.id;
                    batch.set(tariffsRef.doc(docId), tariffToSave);
                }
                await batch.commit();
            }
        }

        // ==========================================
        // 4. СОХРАНЕНИЕ СОСТОЯНИЯ
        // ==========================================
        saveData(); 
        console.log('✅ Умная синхронизация успешно завершена!');
        
    } catch (error) {
        console.error('❌ Критическая ошибка синхронизации:', error);
        alert('⚠️ Ошибка синхронизации с облаком. Проверьте интернет-соединение.');
    }
}

function formatMoney(n) {
    return new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB', minimumFractionDigits: 2}).format(n);
}

function formatDate(s) {
    if (!s) return '-';
    const d = parseLocalDate(s);
    if (!d) return s;
    return d.toLocaleDateString('ru-RU');
}

// Переключение режима авто-расчета
function toggleAutoCalc(field) {
    autoCalcState[field] = !autoCalcState[field];
    const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
    const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
    const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
    
    if (autoCalcState[field]) {
        // Включаем авто-расчет
        if (btn) btn.classList.remove('manual-mode');
        if (input) input.classList.remove('manual-edit');
        if (hint) hint.textContent = 'автоматически';
        
        // Убираем поле из списка ручных правок
        if (editingId) {
            const recordIndex = records.findIndex(r => r.id === editingId);
            if (recordIndex !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (records[recordIndex].manualEdits) {
                    records[recordIndex].manualEdits = records[recordIndex].manualEdits.filter(f => f !== fieldName);
                }
            }
        }
        
        // Пересчитываем автоматически
        autoCalc(field);
    } else {
        // Отключаем авто-расчет
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';
        
        // Добавляем поле в список ручных правок
        if (editingId) {
            const recordIndex = records.findIndex(r => r.id === editingId);
            if (recordIndex !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (!records[recordIndex].manualEdits) {
                    records[recordIndex].manualEdits = [];
                }
                if (!records[recordIndex].manualEdits.includes(fieldName)) {
                    records[recordIndex].manualEdits.push(fieldName);
                }
            }
        }
    }
}

// Помечаем поле как отредактированное вручную
function markManualEdit(field) {
    if (autoCalcState[field]) {
        autoCalcState[field] = false;
        const btn = document.querySelector(`[onclick="toggleAutoCalc('${field}')"]`);
        const input = document.getElementById(field === 'km' ? 'pay-distance' : 'pay-weight');
        const hint = input ? input.closest('.form-group').querySelector('.auto-hint') : null;
        if (btn) btn.classList.add('manual-mode');
        if (input) input.classList.add('manual-edit');
        if (hint) hint.textContent = 'ручной ввод';
        
        // Добавляем поле в список ручных правок текущей записи
        if (editingId) {
            const recordIndex = records.findIndex(r => r.id === editingId);
            if (recordIndex !== -1) {
                const fieldName = field === 'km' ? 'payDistance' : 'payWeight';
                if (!records[recordIndex].manualEdits) {
                    records[recordIndex].manualEdits = [];
                }
                if (!records[recordIndex].manualEdits.includes(fieldName)) {
                    records[recordIndex].manualEdits.push(fieldName);
                }
            }
        }
    }
}

// ===== ЭКСПОРТ В EXCEL (отдельная функция) =====
// ===== ЭКСПОРТ В EXCEL =====
function exportToExcel() {
    console.log('📊 Начало экспорта в Excel...');
    
    if (!records || records.length === 0) {
        alert('❌ Нет данных для экспорта. Сначала добавьте записи.');
        return;
    }
    
    try {
        // Проверяем библиотеку
        if (typeof XLSX === 'undefined') {
            alert('❌ Библиотека Excel не загружена. Обновите страницу.');
            return;
        }
        
        // Формируем данные
        const data = records.map((r, index) => {
            const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
                r.recordType === 'expense' ? 'Расход' : 'Работа';
            
            // Используем parseLocalDate для форматирования даты
            const d = parseLocalDate(r.date);
            const dateStr = d ? d.toLocaleDateString('ru-RU') : r.date || '';
            
            return {
                '№': index + 1,
                'Дата': dateStr,
                'День недели': r.weekday || '',
                'Тип записи': typeLabel,
                'Часы работы': r.hours || 0,
                'Забор (шт)': r.ordersPickup || 0,
                'Забор (₽)': r.payPickup || 0,
                'Выдача (шт)': r.ordersDelivery || 0,
                'Выдача (₽)': r.payDelivery || 0,
                'Км': r.distance || 0,
                'Км (₽)': r.payDistance || 0,
                'Вес (кг)': r.weight || 0,
                'Вес (₽)': r.payWeight || 0,
                'Нагрузка (₽)': r.loadPay || 0,
                'Бонус (₽)': r.bonusPay || 0,
                'Рейтинг (₽)': r.rating || 0,
                'Чаевые (₽)': r.tips || 0,
                'Бензин (₽)': r.fuelCost || 0,
                'Ремонт (₽)': r.repairCost || 0,
                'Налог (₽)': r.tax || 0,
                'Общий доход (₽)': Math.round((r.totalIncome || 0) * 100) / 100,
                'Всего расходов (₽)': Math.round((r.totalExpenses || 0) * 100) / 100,
                'Чистая прибыль (₽)': Math.round((r.netProfit || 0) * 100) / 100
            };
        });
        
        console.log('✅ Подготовлено строк:', data.length);
        
        // Создаем worksheet
        const ws = XLSX.utils.json_to_sheet(data);
        
        // Настраиваем ширину колонок
        const colWidths = Object.keys(data[0]).map(key => ({ wch: Math.max(key.length, 12) }));
        ws['!cols'] = colWidths;
        
        // Создаем workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Журнал водителя");
        
        // ===== НАДЕЖНОЕ СОХРАНЕНИЕ ФАЙЛА (РАБОТАЕТ ВЕЗДЕ, ВКЛЮЧАЯ iOS/Android) =====
        const fileName = `driver-data-${new Date().toISOString().split('T')[0]}.xlsx`;
        
        // 1. Генерируем бинарный буфер данных
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        
        // 2. Создаем Blob-объект
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        // 3. Создаем временную ссылку для скачивания
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        
        // 4. Инициируем клик по ссылке (скачивание)
        link.click();
        
        // 5. Очищаем память через небольшую задержку
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 1000);
        
        console.log('✅ Excel файл создан:', fileName);
        alert('✅ Excel файл успешно создан!\n\nИмя файла: ' + fileName + '\n\nПроверьте папку "Загрузки"');
        
    } catch (error) {
        console.error('❌ Ошибка экспорта в Excel:', error);
        alert('❌ Ошибка при создании Excel файла:\n\n' + error.message);
    }
}

// ===== ЭКСПОРТ В PDF (через печать браузера) =====
function exportToPDF() {
    if (!records || records.length === 0) {
        alert('❌ Нет данных для экспорта');
        return;
    }
    
    // Считаем итоги
    const totalIncome = records.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
    const totalExpenses = records.reduce((sum, r) => sum + (r.totalExpenses || 0), 0);
    const totalProfit = records.reduce((sum, r) => sum + (r.netProfit || 0), 0);
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);
    
    // Создаем HTML контент со ВСЕМИ столбцами
    let rowsHTML = '';
    records.forEach(r => {
        const typeLabel = r.recordType === 'bonus' ? 'Бонус' :
            r.recordType === 'expense' ? 'Расход' : 'Работа';
        const profitColor = r.netProfit >= 0 ? '#10b981' : '#ef4444';
        
        // Используем parseLocalDate для форматирования даты
        const d = parseLocalDate(r.date);
        const dateStr = d ? d.toLocaleDateString('ru-RU') : r.date || '-';
        
        rowsHTML += `
            <tr>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${dateStr}</td>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${r.weekday || '-'}</td>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 10px;">${typeLabel}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.hours || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.ordersPickup || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payPickup * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.ordersDelivery || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payDelivery * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.distance || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payDistance * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${r.weight || 0}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.payWeight * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.loadPay * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.bonusPay * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.rating * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.tips * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.fuelCost * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.repairCost * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px;">${Math.round(r.tax * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px; font-weight: bold;">${Math.round(r.totalIncome * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px; font-weight: bold;">${Math.round(r.totalExpenses * 100) / 100}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-size: 10px; color: ${profitColor}; font-weight: bold;">${Math.round(r.netProfit * 100) / 100}</td>
            </tr>
        `;
    });
    
    // Используем parseLocalDate для даты выгрузки
    const today = new Date();
    const exportDate = today.toLocaleDateString('ru-RU');
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Журнал работы водителя</title>
            <style>
                @page { size: A4 landscape; margin: 8mm; }
                body { 
                    font-family: Arial, sans-serif; 
                    font-size: 10px; 
                    margin: 10px;
                    color: #000;
                }
                h1 { 
                    text-align: center; 
                    margin-bottom: 8px; 
                    font-size: 18px;
                }
                .date-info {
                    text-align: center;
                    color: #666;
                    margin-bottom: 12px;
                    font-size: 11px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse;
                    font-size: 9px;
                }
                th, td { 
                    border: 1px solid #ddd; 
                    padding: 5px; 
                    font-size: 9px;
                }
                th { 
                    background-color: #f2f2f7; 
                    text-align: center;
                    font-weight: bold;
                    font-size: 9px;
                }
                td {
                    text-align: right;
                }
                td:first-child, td:nth-child(2), td:nth-child(3) {
                    text-align: left;
                }
                .summary-table {
                    margin-top: 15px;
                    width: 100%;
                    border-collapse: collapse;
                }
                .summary-table td {
                    padding: 10px;
                    border: 1px solid #ddd;
                    text-align: center;
                    font-size: 11px;
                }
                .summary-table .label {
                    background-color: #f2f2f7;
                    font-weight: bold;
                    text-align: left;
                    width: 30%;
                }
                .summary-table .value {
                    font-weight: bold;
                }
                @media print {
                    body { margin: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <h1>Журнал работы водителя</h1>
            <div class="date-info">Дата выгрузки: ${exportDate}</div>
            
            <table>
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>День</th>
                        <th>Тип</th>
                        <th>Часы</th>
                        <th>Забор<br>(шт)</th>
                        <th>Забор<br>(₽)</th>
                        <th>Выдача<br>(шт)</th>
                        <th>Выдача<br>(₽)</th>
                        <th>Км</th>
                        <th>Км<br>(₽)</th>
                        <th>Вес<br>(кг)</th>
                        <th>Вес<br>(₽)</th>
                        <th>Нагрузка<br>(₽)</th>
                        <th>Бонус<br>(₽)</th>
                        <th>Рейтинг<br>(₽)</th>
                        <th>Чаевые<br>(₽)</th>
                        <th>Бензин<br>(₽)</th>
                        <th>Ремонт<br>(₽)</th>
                        <th>Налог<br>(₽)</th>
                        <th>Доход<br>(₽)</th>
                        <th>Расход<br>(₽)</th>
                        <th>Прибыль<br>(₽)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
            </table>
            
            <!-- ИТОГИ ОТДЕЛЬНОЙ ТАБЛИЦЕЙ ПОСЛЕ ОСНОВНОЙ -->
            <table class="summary-table">
                <tr>
                    <td class="label">📊 ВСЕГО ЗАПИСЕЙ:</td>
                    <td class="value">${records.length}</td>
                    <td class="label">⏱ ОТРАБОТАНО ЧАСОВ:</td>
                    <td class="value">${totalHours.toFixed(1)}</td>
                </tr>
                <tr>
                    <td class="label">💰 ОБЩИЙ ДОХОД:</td>
                    <td class="value" style="color: #10b981;">${Math.round(totalIncome * 100) / 100} ₽</td>
                    <td class="label">💸 ВСЕГО РАСХОДОВ:</td>
                    <td class="value" style="color: #ef4444;">${Math.round(totalExpenses * 100) / 100} ₽</td>
                </tr>
                <tr>
                    <td class="label">✅ ЧИСТАЯ ПРИБЫЛЬ:</td>
                    <td class="value" style="color: ${totalProfit >= 0 ? '#10b981' : '#ef4444'}; font-size: 13px;">${Math.round(totalProfit * 100) / 100} ₽</td>
                    <td class="label">📈 СРЕДНИЙ ДОХОД В ДЕНЬ:</td>
                    <td class="value">${Math.round((totalIncome / records.length) * 100) / 100} ₽</td>
                </tr>
            </table>
            
            <div class="no-print" style="margin-top: 20px; text-align: center;">
                <button onclick="window.print()" style="padding: 12px 24px; font-size: 16px; background: #007AFF; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    💾 Сохранить как PDF
                </button>
                <p style="margin-top: 10px; color: #666; font-size: 13px;">
                    Нажмите кнопку выше или используйте Ctrl+P (Cmd+P на Mac)<br>
                    В диалоге печати выберите "Сохранить как PDF"
                </p>
            </div>
            
            <script>
                setTimeout(function() {
                    window.print();
                }, 500);
            <\/script>
        </body>
        </html>
    `;
    
    // Открываем в новом окне
    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    alert('💡 Откроется окно для сохранения PDF\n\nВыберите "Сохранить как PDF" в диалоге печати');
}

// ============================================
// ФИЛЬТРАЦИЯ ИСТОРИИ ПО МЕСЯЦУ И ГОДУ
// ============================================

let currentHistoryMonth = null;
let currentHistoryYear = null;




// Заполняем фильтры при загрузке
function initHistoryFilters() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    
    // Устанавливаем текущий месяц
    const monthSelect = document.getElementById('history-month');
    if (monthSelect) {
        monthSelect.value = currentMonth;
    }
    
    // Заполняем список годов
    const yearSelect = document.getElementById('history-year');
    if (yearSelect) {
        yearSelect.innerHTML = '';
        for (let year = 2020; year <= currentYear + 2; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
    }
    
    // Устанавливаем текущие значения
    currentHistoryMonth = currentMonth;
    currentHistoryYear = currentYear;
    showAllHistoryMode = false;
    currentHistoryPage = 1;
}



// Фильтрация по месяцу и году
function filterHistoryByMonth() {
    const monthSelect = document.getElementById('history-month');
    const yearSelect = document.getElementById('history-year');
    
    if (!monthSelect || !yearSelect) return;
    
    currentHistoryMonth = parseInt(monthSelect.value);
    currentHistoryYear = parseInt(yearSelect.value);
    showAllHistoryMode = false;
    currentHistoryPage = 1;
    
    // Обновляем информацию
    updateHistoryInfo();
    
    // Перерисовываем таблицу
    renderTableWithMonthFilter();
}

// Показать все записи
function showAllHistory() {
    showAllHistoryMode = true;
    currentHistoryPage = 1;
    updateHistoryInfo();
    renderTableWithMonthFilter();
}

// Обновление информации
function updateHistoryInfo() {
    const infoDiv = document.getElementById('history-info');
    if (!infoDiv) return;
    
    const totalRecords = records.length;
    
    if (showAllHistoryMode) {
        infoDiv.textContent = 'Показаны все записи: ' + totalRecords + ' шт.';
    } else {
        const monthName = getMonthName(currentHistoryMonth);
        
        // Считаем количество записей за выбранный период
        const filteredCount = records.filter(function(r) {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        }).length;
        
        infoDiv.textContent = 'Показано: ' + filteredCount + ' записей за ' + monthName + ' ' + currentHistoryYear + ' г. (всего: ' + totalRecords + ')';
    }
}

// Название месяца
function getMonthName(month) {
    const months = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
    return months[month - 1] || '';
}

// Рендер таблицы с учётом фильтра
function renderTableWithMonthFilter() {
    const tbody = document.getElementById('records-body');
    if (!tbody) return;
    
    // Фильтруем записи
    let filteredRecords = [...records];
    
    if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
        filteredRecords = filteredRecords.filter(function(r) {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        });
    }
    
    // Сортируем по дате (новые сверху)
    filteredRecords.sort(function(a, b) {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (db || 0) - (da || 0);
    });
    
    // Применяем пагинацию
    const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);
    const startIndex = (currentHistoryPage - 1) * RECORDS_PER_PAGE;
    const endIndex = Math.min(startIndex + RECORDS_PER_PAGE, filteredRecords.length);
    const pageRecords = filteredRecords.slice(startIndex, endIndex);
    
    // Очищаем таблицу
    tbody.innerHTML = '';
    
    // Если нет записей
    if (pageRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="23" style="text-align: center; padding: 40px; color: var(--ios-text-tertiary);">' +
            '<ion-icon name="document-text-outline" style="font-size: 48px; display: block; margin: 0 auto 12px;"></ion-icon>' +
            'Нет записей за выбранный период</td></tr>';
        
        const paginationDiv = document.getElementById('history-pagination');
        if (paginationDiv) paginationDiv.innerHTML = '';
        return;
    }
    
    // Используем существующую функцию рендеринга с недельными итогами
    renderTableWithWeeklySummary(tbody, pageRecords);
    
    // Обновляем пагинацию
    renderPagination(totalPages);
}

// Пагинация
function renderPagination(totalPages) {
    const paginationDiv = document.getElementById('history-pagination');
    if (!paginationDiv) return;
    
    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Кнопка "Назад"
    if (currentHistoryPage > 1) {
        html += '<button class="btn btn-secondary btn-small" onclick="goToPage(' + (currentHistoryPage - 1) + ')">' +
                '<ion-icon name="chevron-back-outline"></ion-icon></button>';
    }
    
    // Номера страниц
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentHistoryPage) {
            html += '<button class="btn btn-primary btn-small" style="min-width: 40px;">' + i + '</button>';
        } else if (Math.abs(i - currentHistoryPage) <= 2 || i === 1 || i === totalPages) {
            html += '<button class="btn btn-secondary btn-small" onclick="goToPage(' + i + ')" style="min-width: 40px;">' + i + '</button>';
        } else if (Math.abs(i - currentHistoryPage) === 3) {
            html += '<span style="margin: 0 4px;">...</span>';
        }
    }
    
    // Кнопка "Вперёд"
    if (currentHistoryPage < totalPages) {
        html += '<button class="btn btn-secondary btn-small" onclick="goToPage(' + (currentHistoryPage + 1) + ')">' +
                '<ion-icon name="chevron-forward-outline"></ion-icon></button>';
    }
    
    // Информация о страницах
    html += '<span style="margin-left: 12px; font-size: 13px; color: var(--ios-text-tertiary); align-self: center;">' +
            'Стр. ' + currentHistoryPage + ' из ' + totalPages + '</span>';
    
    paginationDiv.innerHTML = html;
}

// Переход на страницу
function goToPage(page) {
    const filteredRecords = getFilteredRecords();
    const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);
    
    if (page < 1 || page > totalPages) return;
    
    currentHistoryPage = page;
    renderTableWithMonthFilter();
    
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
        tableContainer.scrollTop = 0;
    }
}

// Получить отфильтрованные записи
function getFilteredRecords() {
    let filteredRecords = [...records];
    
    if (!showAllHistoryMode && currentHistoryMonth && currentHistoryYear) {
        filteredRecords = filteredRecords.filter(function(r) {
            if (!r.date) return false;
            const d = parseLocalDate(r.date);
            if (!d) return false;
            return (d.getMonth() + 1) === currentHistoryMonth && d.getFullYear() === currentHistoryYear;
        });
    }
    
    filteredRecords.sort(function(a, b) {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (db || 0) - (da || 0);
    });
    
    return filteredRecords;
}



// Инициализация при загрузке
console.log('✅ Модуль фильтрации истории загружен');

// ============================================
// ИНДИКАТОР СТАТУСА ПОДКЛЮЧЕНИЯ
// ============================================

let connectionMode = 'checking'; // 'firebase', 'local', 'checking'
let firebaseErrorReason = '';

// Функция обновления индикатора
function updateConnectionIndicator() {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    const container = document.getElementById('connection-status');
    const wrapper = document.getElementById('connection-status-wrapper');
    
    if (!dot || !text || !container) {
        console.warn('⚠️ Элементы индикатора не найдены');
        return;
    }
    
    // Определяем, авторизован ли пользователь
    const isAuthenticated = document.body.classList.contains('authenticated');
    
    // Показываем/скрываем индикатор в зависимости от авторизации
    if (wrapper) {
        wrapper.style.display = isAuthenticated ? 'flex' : 'none';
    }
    
    // Настройки для разных состояний (ПОЛНЫЙ ТЕКСТ)
    let settings = {
        text: 'Проверка подключения...',
        dotColor: '#8E8E93',
        dotShadow: '0 0 8px rgba(142, 142, 147, 0.3)',
        bgColor: 'rgba(255,255,255,0.5)',
        borderColor: 'rgba(0,0,0,0.06)',
        textColor: '#3C3C43'
    };
    
    if (isAuthenticated) {
        switch (connectionMode) {
            case 'firebase':
                settings = {
                    text: '☁️ Firebase',
                    dotColor: '#34C759',
                    dotShadow: '0 0 12px rgba(52, 199, 89, 0.5)',
                    bgColor: 'rgba(52, 199, 89, 0.12)',
                    borderColor: 'rgba(52, 199, 89, 0.25)',
                    textColor: '#1a7f3a'
                };
                break;
                
            case 'local':
                settings = {
                    text: '💾 Локальный режим',
                    dotColor: '#FF9500',
                    dotShadow: '0 0 12px rgba(255, 149, 0, 0.5)',
                    bgColor: 'rgba(255, 149, 0, 0.12)',
                    borderColor: 'rgba(255, 149, 0, 0.25)',
                    textColor: '#8a4f00'
                };
                break;
                
            default:
                settings = {
                    text: '⏳ Проверка подключения к Firebase...',
                    dotColor: '#8E8E93',
                    dotShadow: '0 0 8px rgba(142, 142, 147, 0.3)',
                    bgColor: 'rgba(255,255,255,0.5)',
                    borderColor: 'rgba(0,0,0,0.06)',
                    textColor: '#3C3C43'
                };
        }
    } else {
        settings = {
            text: '🔒 Войдите в аккаунт для синхронизации с Firebase',
            dotColor: '#8E8E93',
            dotShadow: '0 0 8px rgba(142, 142, 147, 0.3)',
            bgColor: 'rgba(255,255,255,0.5)',
            borderColor: 'rgba(0,0,0,0.06)',
            textColor: '#3C3C43'
        };
    }
    
    // Применяем стили
    dot.style.background = settings.dotColor;
    dot.style.boxShadow = settings.dotShadow;
    text.textContent = settings.text;
    text.style.color = settings.textColor;
    container.style.background = settings.bgColor;
    container.style.borderColor = settings.borderColor;
    
    // Добавляем/убираем анимацию пульсации
    if (connectionMode === 'checking' || !isAuthenticated) {
        dot.classList.add('pulse');
    } else {
        dot.classList.remove('pulse');
    }
}

// Функция показа подробностей
function showConnectionDetails() {
    const isAuthenticated = document.body.classList.contains('authenticated');
    let message = '';
    
    if (!isAuthenticated) {
        message = '🔒 Не авторизован\n\n' +
            'Войдите в аккаунт для синхронизации данных.\n' +
            'Данные хранятся локально до входа.';
    } else if (connectionMode === 'firebase') {
        message = '✅ Подключено к Firebase\n\n' +
            '• Данные синхронизируются с облаком\n' +
            '• Доступны с любого устройства\n' +
            '• Пользователь: ' + (currentUser ? currentUser.email : 'Неизвестно');
    } else if (connectionMode === 'local') {
        message = '⚠️ Работа в локальном режиме\n\n' +
            '• Данные сохраняются только в браузере\n' +
            '• Не синхронизируются с облаком\n' +
            '• Доступны только на этом устройстве\n\n' +
            (firebaseErrorReason ? 'Причина: ' + firebaseErrorReason : 'Проверьте подключение к интернету');
    } else {
        message = '⏳ Проверка подключения к Firebase...\n\n' +
            'Пожалуйста, подождите...';
    }
    
    alert(message);
}

// Проверка подключения к Firebase
async function checkFirebaseConnection() {
    try {
        // Проверяем, что Firebase загружен
        if (typeof firebase === 'undefined') {
            connectionMode = 'local';
            firebaseErrorReason = 'Firebase SDK не загружен';
            updateConnectionIndicator();
            return;
        }
        
        // Проверяем, что пользователь авторизован
        if (!currentUser) {
            connectionMode = 'local';
            firebaseErrorReason = 'Войдите в аккаунт для синхронизации';
            updateConnectionIndicator();
            return;
        }
        
        // Проверяем, были ли загружены данные
        if (records.length > 0 || tariffs.length > 0) {
            connectionMode = 'firebase';
            firebaseErrorReason = '';
            updateConnectionIndicator();
            console.log('✅ Firebase активен, данные загружены');
        } else {
            // Пробуем загрузить хотя бы одну запись
            const testSnapshot = await db.collection('users')
                .doc(currentUser.uid)
                .collection('records')
                .limit(1)
                .get();
            
            connectionMode = 'firebase';
            firebaseErrorReason = '';
            updateConnectionIndicator();
            console.log('✅ Firebase доступен, записей:', testSnapshot.size);
        }
        
    } catch (error) {
        connectionMode = 'local';
        
        if (error.code === 'permission-denied') {
            firebaseErrorReason = 'Проверьте правила безопасности Firestore';
        } else if (!navigator.onLine) {
            firebaseErrorReason = 'Отсутствует интернет-соединение';
        } else {
            firebaseErrorReason = error.message;
        }
        
        updateConnectionIndicator();
        console.warn('⚠️ Firebase недоступен:', error.message);
    }
}


// ============================================
// ВКЛАДКА "ГЛАВНАЯ" - МОЙ ПРОФИЛЬ
// ============================================

// ===== ЕДИНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ВКЛАДКИ "ГЛАВНАЯ" =====
function updateHomeTab() {
    const homeTab = document.getElementById('tab-home');
    // Если вкладка не активна, не тратим ресурсы на обновление
    if (!homeTab || !homeTab.classList.contains('active')) return;

    console.log('🔄 Обновление вкладки "Главная"...');

    // 1. Информация о пользователе
    if (currentUser) {
        const nameEl = document.getElementById('profile-name');
        const emailEl = document.getElementById('profile-email');
        const syncEl = document.getElementById('profile-sync-status');
        
        let userName = currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Водитель');
        if (nameEl) nameEl.textContent = userName;
        if (emailEl) emailEl.textContent = currentUser.email || 'email@example.com';
        
        if (syncEl) {
            if (connectionMode === 'firebase') {
                syncEl.innerHTML = '<ion-icon name="cloud-done-outline"></ion-icon> Синхронизация активна';
                syncEl.style.color = 'var(--ios-success)';
            } else {
                syncEl.innerHTML = '<ion-icon name="cloud-offline-outline"></ion-icon> Локальный режим';
                syncEl.style.color = 'var(--ios-warning)';
            }
        }
    }

    // 2. Общая статистика
    const totalDays = new Set(records.filter(r => r.recordType === 'work' || r.hours > 0).map(r => r.date)).size;
    const totalProfit = records.reduce((sum, r) => sum + (r.netProfit || 0), 0);
    const totalIncome = records.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
    const totalOrders = records.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0);
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);
    
    const setEl = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setEl('profile-total-days', totalDays);
    setEl('profile-total-profit', formatMoney(totalProfit));
    setEl('profile-avg-per-day', totalDays > 0 ? formatMoney(totalProfit / totalDays) : '0 ₽');
    setEl('profile-efficiency', totalIncome > 0 ? ((totalProfit / totalIncome) * 100).toFixed(1) + '%' : '0%');
    setEl('profile-total-records', records.length);
    setEl('profile-total-km', records.reduce((sum, r) => sum + (r.distance || 0), 0).toFixed(1));
    setEl('profile-avg-check', totalOrders > 0 ? formatMoney(totalIncome / totalOrders) : '0 ₽');
    setEl('profile-total-hours', totalHours.toFixed(1));
    setEl('profile-total-orders', totalOrders);
    setEl('profile-per-hour', totalHours > 0 ? formatMoney(totalProfit / totalHours) : '0 ₽');

    // 3. Вызов всех вспомогательных функций обновления (теперь они гарантированно выполнятся)
    renderAchievements();
    loadProfileAvatar();
    
    updateBestDay();
    updateTrends();
    updateRecentRecords();

    console.log('✅ Вкладка "Главная" полностью обновлена');
}

// ============================================
// ОБНОВЛЕНИЕ ИМЕНИ ПОЛЬЗОВАТЕЛЯ
// ============================================

// Функция для обновления имени пользователя
async function updateUserName(newName) {
    if (!currentUser) {
        alert('❌ Пользователь не авторизован');
        return;
    }
    
    if (!newName || newName.trim() === '') {
        alert('❌ Имя не может быть пустым');
        return;
    }
    
    try {
        // Обновляем displayName в Firebase Auth
        await currentUser.updateProfile({
            displayName: newName.trim()
        });
        
        // Обновляем имя в Firestore
        if (typeof db !== 'undefined') {
            await db.collection('users')
                .doc(currentUser.uid)
                .set({
                    name: newName.trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
        }
        
        // Обновляем отображение
        const nameEl = document.getElementById('profile-name');
        if (nameEl) {
            nameEl.textContent = newName.trim();
        }
        
        showToast('✅ Имя обновлено!');
        
        // Перезагружаем данные пользователя
        await loadUserData();
        
    } catch (error) {
        console.error('❌ Ошибка обновления имени:', error);
        alert('❌ Ошибка при обновлении имени: ' + error.message);
    }
}

// Функция для показа диалога изменения имени
function showEditNameDialog() {
    const currentName = document.getElementById('profile-name')?.textContent || '';
    const newName = prompt('Введите ваше имя:', currentName);
    
    if (newName !== null && newName.trim() !== '') {
        updateUserName(newName);
    }
}


// Рендер достижений
function renderAchievements() {
    const container = document.getElementById('profile-achievements');
    if (!container) return;
    
    const totalIncome = records.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
    const totalOrders = records.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0);
    const totalDays = new Set(records.filter(r => r.recordType === 'work' || r.hours > 0).map(r => r.date)).size;
    const totalKm = records.reduce((sum, r) => sum + (r.distance || 0), 0);
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);
    
    const achievements = [];
    
    // Достижения по доходу
if (totalIncome >= 100000) {
    achievements.push({ icon: '<ion-icon name="trophy-outline"></ion-icon>', label: 'Золотой доход (100 000 ₽)', class: 'gold' });
} else if (totalIncome >= 50000) {
    achievements.push({ icon: '<ion-icon name="medal-outline"></ion-icon>', label: 'Серебряный доход (50 000 ₽)', class: 'silver' });
} else if (totalIncome >= 10000) {
    achievements.push({ icon: '<ion-icon name="star-outline"></ion-icon>', label: 'Бронзовый доход (10 000 ₽)', class: 'bronze' });
}

// Достижения по заказам
if (totalOrders >= 1000) {
    achievements.push({ icon: '<ion-icon name="cube-outline"></ion-icon>', label: '1000+ заказов', class: 'gold' });
} else if (totalOrders >= 500) {
    achievements.push({ icon: '<ion-icon name="cube-outline"></ion-icon>', label: '500+ заказов', class: 'silver' });
} else if (totalOrders >= 100) {
    achievements.push({ icon: '<ion-icon name="cube-outline"></ion-icon>', label: '100+ заказов', class: 'bronze' });
}

// Достижения по дням
if (totalDays >= 100) {
    achievements.push({ icon: '<ion-icon name="calendar-outline"></ion-icon>', label: '100+ рабочих дней', class: 'gold' });
} else if (totalDays >= 50) {
    achievements.push({ icon: '<ion-icon name="calendar-outline"></ion-icon>', label: '50+ рабочих дней', class: 'silver' });
} else if (totalDays >= 10) {
    achievements.push({ icon: '<ion-icon name="calendar-outline"></ion-icon>', label: '10+ рабочих дней', class: 'bronze' });
}

// Достижения по километрам
if (totalKm >= 10000) {
    achievements.push({ icon: '<ion-icon name="walk-outline"></ion-icon>', label: '10 000+ км', class: 'gold' });
} else if (totalKm >= 5000) {
    achievements.push({ icon: '<ion-icon name="walk-outline"></ion-icon>', label: '5 000+ км', class: 'silver' });
} else if (totalKm >= 1000) {
    achievements.push({ icon: '<ion-icon name="walk-outline"></ion-icon>', label: '1 000+ км', class: 'bronze' });
}

// Достижения по часам
if (totalHours >= 500) {
    achievements.push({ icon: '<ion-icon name="time-outline"></ion-icon>', label: '500+ часов', class: 'gold' });
} else if (totalHours >= 200) {
    achievements.push({ icon: '<ion-icon name="time-outline"></ion-icon>', label: '200+ часов', class: 'silver' });
} else if (totalHours >= 50) {
    achievements.push({ icon: '<ion-icon name="time-outline"></ion-icon>', label: '50+ часов', class: 'bronze' });
}
    
    // Первое достижение
    if (achievements.length === 0 && records.length > 0) {
        achievements.push({ icon: '🌟', label: 'Первая запись!', class: 'bronze' });
    }
    
    if (achievements.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--ios-text-tertiary); width: 100%;">
                <ion-icon name="trophy-outline" style="font-size: 36px; display: block; margin: 0 auto 8px;"></ion-icon>
                <span style="font-size: 14px;">Добавьте первые записи, чтобы получать достижения!</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = achievements.map(a => `
        <div class="achievement-badge ${a.class}">
            <span style="font-size: 18px;">${a.icon}</span>
            ${a.label}
        </div>
    `).join('');
}



// Обновляем при загрузке данных
function updateHomeOnLoad() {
    const homeTab = document.getElementById('tab-home');
    if (homeTab && homeTab.classList.contains('active')) {
        setTimeout(updateHomeTab, 200);
    }
}







// ============================================
// ЗАГРУЗКА ФОТО ПРОФИЛЯ
// ============================================

// Ключ для хранения аватара в localStorage
const AVATAR_STORAGE_KEY = 'driverProfileAvatar';

// Загрузка аватара при открытии профиля
function loadProfileAvatar() {
    const avatarImg = document.getElementById('avatar-image');
    const avatarIcon = document.getElementById('avatar-icon');
    const avatarContainer = document.getElementById('profile-avatar');
    
    if (!avatarImg || !avatarIcon) return;
    
    // Проверяем localStorage
    const savedAvatar = localStorage.getItem(AVATAR_STORAGE_KEY);
    
    if (savedAvatar) {
        try {
            // Показываем фото
            avatarImg.src = savedAvatar;
            avatarImg.style.display = 'block';
            avatarIcon.style.display = 'none';
            avatarContainer.style.background = 'none';
            avatarContainer.style.borderColor = 'var(--ios-success)';
            
            // Обновляем кнопку загрузки
            const uploadBtn = document.getElementById('avatar-upload-btn');
            if (uploadBtn) {
                uploadBtn.style.background = 'var(--ios-success)';
            }
        } catch (e) {
            console.error('❌ Ошибка загрузки аватара:', e);
        }
    } else {
        // Показываем иконку
        avatarImg.style.display = 'none';
        avatarIcon.style.display = 'block';
        avatarContainer.style.background = 'var(--ios-accent-light)';
        avatarContainer.style.borderColor = 'var(--ios-accent)';
        
        const uploadBtn = document.getElementById('avatar-upload-btn');
        if (uploadBtn) {
            uploadBtn.style.background = 'var(--ios-accent)';
        }
    }
}

// Загрузка фото через input
function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;

    // ИСПРАВЛЕНИЕ: Лимит Firestore составляет строго 1 МБ (1024 * 1024 байт)
    if (file.size > 1 * 1024 * 1024) {
        alert('❌ Файл слишком большой для облачной синхронизации!\nМаксимальный размер: 1 МБ.\nПожалуйста, выберите фото меньшего размера или сожмите его.');
        event.target.value = '';
        return;
    }

    if (!file.type.startsWith('image/')) {
        alert('❌ Пожалуйста, выберите изображение!');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const imageData = e.target.result;
        
        // 1. Сначала сохраняем локально для мгновенного отображения
        try {
            localStorage.setItem(AVATAR_STORAGE_KEY, imageData);
            console.log('✅ Аватар сохранён в localStorage');
        } catch (error) {
            console.error('❌ Ошибка сохранения аватара в localStorage:', error);
            alert('❌ Не удалось сохранить фото. Возможно, файл всё ещё слишком большой.');
            event.target.value = '';
            return;
        }

        // 2. Обновляем интерфейс
        const avatarImg = document.getElementById('avatar-image');
        const avatarIcon = document.getElementById('avatar-icon');
        const avatarContainer = document.getElementById('profile-avatar');
        if (avatarImg && avatarIcon) {
            avatarImg.src = imageData;
            avatarImg.style.display = 'block';
            avatarIcon.style.display = 'none';
            avatarContainer.style.background = 'none';
            avatarContainer.style.borderColor = 'var(--ios-success)';
            
            const uploadBtn = document.getElementById('avatar-upload-btn');
            if (uploadBtn) uploadBtn.style.background = 'var(--ios-success)';
        }

        // 3. Отправляем в Firebase
        if (currentUser && typeof db !== 'undefined') {
            saveAvatarToFirebase(imageData);
        }

        showToast('✅ Фото профиля обновлено!');
        event.target.value = '';
    };
    
    reader.onerror = function() {
        alert('❌ Ошибка чтения файла. Попробуйте ещё раз.');
        event.target.value = '';
    };
    reader.readAsDataURL(file);
}

// Сохранение аватара в Firebase
async function saveAvatarToFirebase(imageData) {
    if (!currentUser) return;
    
    try {
        // Сохраняем в Firestore (в поле avatar)
        await db.collection('users')
            .doc(currentUser.uid)
            .set({
                avatar: imageData,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        
        console.log('✅ Аватар сохранён в Firebase');
    } catch (error) {
        console.error('❌ Ошибка сохранения аватара в Firebase:', error);
    }
}

// Загрузка аватара из Firebase
async function loadAvatarFromFirebase() {
    if (!currentUser || typeof db === 'undefined') return;
    
    try {
        const doc = await db.collection('users')
            .doc(currentUser.uid)
            .get();
        
        if (doc.exists && doc.data().avatar) {
            const avatarData = doc.data().avatar;
            
            // Сохраняем в localStorage
            localStorage.setItem(AVATAR_STORAGE_KEY, avatarData);
            
            // Обновляем отображение
            const avatarImg = document.getElementById('avatar-image');
            const avatarIcon = document.getElementById('avatar-icon');
            const avatarContainer = document.getElementById('profile-avatar');
            
            if (avatarImg && avatarIcon) {
                avatarImg.src = avatarData;
                avatarImg.style.display = 'block';
                avatarIcon.style.display = 'none';
                avatarContainer.style.background = 'none';
                avatarContainer.style.borderColor = 'var(--ios-success)';
                
                const uploadBtn = document.getElementById('avatar-upload-btn');
                if (uploadBtn) {
                    uploadBtn.style.background = 'var(--ios-success)';
                }
            }
            
            console.log('✅ Аватар загружен из Firebase');
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки аватара из Firebase:', error);
    }
}

// Удаление аватара (контекстное меню или долгое нажатие)
function removeAvatar() {
    if (!confirm('Удалить фото профиля?')) return;
    
    // Удаляем из localStorage
    localStorage.removeItem(AVATAR_STORAGE_KEY);
    
    // Удаляем из Firebase
    if (currentUser && typeof db !== 'undefined') {
        db.collection('users')
            .doc(currentUser.uid)
            .update({
                avatar: firebase.firestore.FieldValue.delete()
            })
            .then(() => console.log('✅ Аватар удалён из Firebase'))
            .catch(err => console.error('❌ Ошибка удаления:', err));
    }
    
    // Обновляем отображение
    const avatarImg = document.getElementById('avatar-image');
    const avatarIcon = document.getElementById('avatar-icon');
    const avatarContainer = document.getElementById('profile-avatar');
    
    if (avatarImg && avatarIcon) {
        avatarImg.src = '';
        avatarImg.style.display = 'none';
        avatarIcon.style.display = 'block';
        avatarContainer.style.background = 'var(--ios-accent-light)';
        avatarContainer.style.borderColor = 'var(--ios-accent)';
        
        const uploadBtn = document.getElementById('avatar-upload-btn');
        if (uploadBtn) {
            uploadBtn.style.background = 'var(--ios-accent)';
        }
    }
    
    showToast('🗑️ Фото профиля удалено');
}



// Показываем уведомление (Toast)
function showToast(message) {
    // Проверяем, есть ли уже тост
    let toast = document.getElementById('custom-toast');
    if (toast) {
        toast.remove();
    }
    
    toast = document.createElement('div');
    toast.id = 'custom-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 120px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        color: white;
        padding: 12px 24px;
        border-radius: 14px;
        font-size: 15px;
        font-weight: 600;
        z-index: 99999;
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.32, 0.72, 0, 1);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        max-width: 90%;
        text-align: center;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Показываем
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    // Скрываем через 2.5 секунды
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 400);
    }, 2500);
}



// ============================================
// ПЛАВАЮЩАЯ КНОПКА "+" ДЛЯ ДОБАВЛЕНИЯ
// ============================================

// Функция открытия вкладки "Ввод"
function openEntryTab() {
    // Переключаемся на вкладку "Ввод"
    switchTab('entry');
    
    // Устанавливаем сегодняшнюю дату
    const dateInput = document.getElementById('date');
    if (dateInput) {
        dateInput.valueAsDate = new Date();
        // Обновляем день недели
        if (typeof onDateChange === 'function') {
            onDateChange();
        }
    }
    
    // Прокручиваем к форме
    setTimeout(() => {
        const form = document.getElementById('daily-form');
        if (form) {
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 300);
    
    // Анимируем кнопку
    const fab = document.getElementById('fab-add');
    if (fab) {
        fab.style.transform = 'scale(0.8) rotate(45deg)';
        setTimeout(() => {
            fab.style.transform = 'scale(1) rotate(0deg)';
        }, 300);
    }
}



// Убираем пульсацию после первого использования
let fabPulseRemoved = false;

function removeFabPulse() {
    if (fabPulseRemoved) return;
    const fab = document.getElementById('fab-add');
    if (fab) {
        fab.classList.remove('pulse');
        fabPulseRemoved = true;
    }
}

// Добавляем обработчик клика для удаления пульсации
document.addEventListener('click', function(e) {
    const fab = document.getElementById('fab-add');
    if (fab && fab.contains(e.target)) {
        removeFabPulse();
    }
});

// Убираем пульсацию через 10 секунд (если пользователь не нажал)
setTimeout(removeFabPulse, 10000);

// Быстрый доступ через клавишу "N" (New)
document.addEventListener('keydown', function(e) {
    // Ctrl+N или Cmd+N для открытия ввода
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        openEntryTab();
    }
    
    // Escape для закрытия, если нужно
    if (e.key === 'Escape' && document.getElementById('tab-entry')?.classList.contains('active')) {
        switchTab('home');
    }
});

// ============================================
// УПРАВЛЕНИЕ ЦЕЛЯМИ С СИНХРОНИЗАЦИЕЙ FIREBASE
// ============================================

// Ключ для хранения целей в localStorage
const GOALS_STORAGE_KEY = 'driverGoals';

// Получение целей (сначала из localStorage, потом из Firebase)
async function getGoals() {
    // Сначала проверяем localStorage
    let goals = null;
    try {
        const saved = localStorage.getItem(GOALS_STORAGE_KEY);
        if (saved) {
            goals = JSON.parse(saved);
            console.log('📊 Цели из localStorage:', goals);
        }
    } catch (e) {
        console.warn('⚠️ Ошибка чтения целей из localStorage:', e);
    }
    
    // Если в localStorage нет, пробуем загрузить из Firebase
    if (!goals && currentUser && typeof db !== 'undefined') {
        try {
            const doc = await db.collection('users')
                .doc(currentUser.uid)
                .get();
            
            if (doc.exists && doc.data().goals) {
                goals = doc.data().goals;
                // Сохраняем в localStorage для кэша
                localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
                console.log('✅ Цели загружены из Firebase:', goals);
                return goals;
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки целей из Firebase:', error);
        }
    }
    
    // Если ничего нет, создаем дефолтные
    if (!goals) {
        goals = { income: 100000, orders: 500, hours: 200 };
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
        console.log('📊 Созданы дефолтные цели:', goals);
        
        // Сохраняем в Firebase
        if (currentUser && typeof db !== 'undefined') {
            await saveGoalsToFirebase(goals);
        }
    }
    
    return goals;
}

// Сохранение целей в Firebase
async function saveGoalsToFirebase(goals) {
    if (!currentUser || typeof db === 'undefined') {
        console.log('⚠️ Firebase не доступен, цели сохранены только локально');
        return false;
    }
    
    try {
        await db.collection('users')
            .doc(currentUser.uid)
            .set({
                goals: goals,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        console.log('✅ Цели сохранены в Firebase');
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения целей в Firebase:', error);
        return false;
    }
}

// Показать диалог настройки целей
async function showGoalSettings() {
    console.log('⚙️ Открытие настроек целей');
    
    // Проверяем авторизацию
    if (!currentUser) {
        alert('❌ Пожалуйста, войдите в аккаунт для настройки целей');
        return;
    }
    
    // Загружаем текущие цели
    const goals = await getGoals();
    if (!goals) {
        alert('❌ Ошибка загрузки целей');
        return;
    }
    
    console.log('📊 Текущие цели:', goals);
    
    // Запрашиваем новые значения
    const incomeInput = prompt('💰 Цель по доходу за месяц (₽):', goals.income);
    if (incomeInput === null) {
        console.log('❌ Пользователь отменил ввод');
        return;
    }
    
    const income = parseFloat(incomeInput);
    if (isNaN(income) || income <= 0) {
        alert('❌ Введите корректное число для дохода (больше 0)');
        return;
    }
    
    const ordersInput = prompt('📦 Цель по заказам за месяц:', goals.orders);
    if (ordersInput === null) {
        console.log('❌ Пользователь отменил ввод');
        return;
    }
    
    const orders = parseInt(ordersInput);
    if (isNaN(orders) || orders <= 0) {
        alert('❌ Введите корректное число для заказов (больше 0)');
        return;
    }
    
    const hoursInput = prompt('⏱ Цель по часам за месяц:', goals.hours);
    if (hoursInput === null) {
        console.log('❌ Пользователь отменил ввод');
        return;
    }
    
    const hours = parseFloat(hoursInput);
    if (isNaN(hours) || hours <= 0) {
        alert('❌ Введите корректное число для часов (больше 0)');
        return;
    }
    
    // Обновляем цели
    const newGoals = { income, orders, hours };
    
    // Сохраняем в localStorage
    try {
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(newGoals));
        console.log('✅ Цели сохранены в localStorage:', newGoals);
    } catch (e) {
        console.error('❌ Ошибка сохранения в localStorage:', e);
        alert('❌ Ошибка сохранения целей');
        return;
    }
    
    // Сохраняем в Firebase
    const saved = await saveGoalsToFirebase(newGoals);
    
    // Обновляем отображение
    await updateGoals();
    
    if (saved) {
        showToast('✅ Цели обновлены и сохранены в облаке!');
    } else {
        showToast('⚠️ Цели сохранены локально (ошибка синхронизации)');
    }
}

// Обновление отображения целей
async function updateGoals() {
    console.log('🎯 Обновление отображения целей');
    
    // Проверяем наличие элементов
    const elements = {
        incomeCurrent: document.getElementById('goal-income-current'),
        incomeTarget: document.getElementById('goal-income-target'),
        incomeBar: document.getElementById('goal-income-bar'),
        ordersCurrent: document.getElementById('goal-orders-current'),
        ordersTarget: document.getElementById('goal-orders-target'),
        ordersBar: document.getElementById('goal-orders-bar'),
        hoursCurrent: document.getElementById('goal-hours-current'),
        hoursTarget: document.getElementById('goal-hours-target'),
        hoursBar: document.getElementById('goal-hours-bar')
    };
    
    // Проверяем, что все элементы существуют
    for (const [key, el] of Object.entries(elements)) {
        if (!el) {
            console.warn(`⚠️ Элемент ${key} не найден в DOM`);
            return;
        }
    }
    
    // Загружаем цели
    const goals = await getGoals();
    if (!goals) {
        console.error('❌ Не удалось загрузить цели');
        return;
    }
    
    console.log('📊 Загружены цели:', goals);
    
    // Данные за текущий месяц
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const monthRecords = records.filter(r => {
        if (!r.date) return false;
        const d = parseLocalDate(r.date);
        if (!d) return false;
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    
    const monthIncome = monthRecords.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
    const monthOrders = monthRecords.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0);
    const monthHours = monthRecords.reduce((sum, r) => sum + (r.hours || 0), 0);
    
    console.log('📊 Данные за месяц:', { monthIncome, monthOrders, monthHours });
    
    // Обновляем тексты
    elements.incomeCurrent.textContent = Math.round(monthIncome);
    elements.incomeTarget.textContent = goals.income;
    elements.ordersCurrent.textContent = monthOrders;
    elements.ordersTarget.textContent = goals.orders;
    elements.hoursCurrent.textContent = monthHours.toFixed(1);
    elements.hoursTarget.textContent = goals.hours;
    
    // Обновляем прогресс-бары
    const incomePercent = goals.income > 0 ? Math.min((monthIncome / goals.income) * 100, 100) : 0;
    const ordersPercent = goals.orders > 0 ? Math.min((monthOrders / goals.orders) * 100, 100) : 0;
    const hoursPercent = goals.hours > 0 ? Math.min((monthHours / goals.hours) * 100, 100) : 0;
    
    elements.incomeBar.style.width = incomePercent + '%';
    elements.ordersBar.style.width = ordersPercent + '%';
    elements.hoursBar.style.width = hoursPercent + '%';
    
    console.log('📊 Прогресс:', { incomePercent, ordersPercent, hoursPercent });
}

// ============================================
// ТРЕНДЫ
// ============================================

// Обновление трендов
function updateTrends() {
    console.log('📈 Обновление трендов');
    
    // Проверяем наличие всех элементов
    const elements = {
        income: document.getElementById('trend-income'),
        orders: document.getElementById('trend-orders'),
        hours: document.getElementById('trend-hours'),
        efficiency: document.getElementById('trend-efficiency')
    };
    
    // Проверяем, что все элементы существуют
    for (const [key, el] of Object.entries(elements)) {
        if (!el) {
            console.warn(`⚠️ Элемент trend-${key} не найден в DOM`);
            return;
        }
    }
    
    if (records.length === 0) {
        elements.income.textContent = '0%';
        elements.orders.textContent = '0%';
        elements.hours.textContent = '0%';
        elements.efficiency.textContent = '0%';
        return;
    }
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    // Фильтрация записей за текущий месяц
    const currentRecords = records.filter(r => {
        if (!r.date) return false;
        const d = parseLocalDate(r.date);
        if (!d) return false;
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    
    // Фильтрация записей за предыдущий месяц
    const prevRecords = records.filter(r => {
        if (!r.date) return false;
        const d = parseLocalDate(r.date);
        if (!d) return false;
        return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });
    
    const calc = (arr) => {
        const totalIncome = arr.reduce((sum, r) => sum + (r.totalIncome || 0), 0);
        const totalOrders = arr.reduce((sum, r) => sum + (r.ordersDelivery || 0), 0);
        const totalHours = arr.reduce((sum, r) => sum + (r.hours || 0), 0);
        const totalProfit = arr.reduce((sum, r) => sum + (r.netProfit || 0), 0);
        const efficiency = totalIncome > 0 ? (totalProfit / totalIncome) * 100 : 0;
        return { income: totalIncome, orders: totalOrders, hours: totalHours, efficiency };
    };
    
    const c = calc(currentRecords);
    const p = calc(prevRecords);
    
    const calcTrend = (current, prev) => {
        if (prev === 0) return current > 0 ? 100 : 0;
        return ((current - prev) / prev) * 100;
    };
    
    const formatTrend = (value) => {
        const sign = value > 0 ? '+' : '';
        return sign + value.toFixed(1) + '%';
    };
    
    elements.income.textContent = formatTrend(calcTrend(c.income, p.income));
    elements.orders.textContent = formatTrend(calcTrend(c.orders, p.orders));
    elements.hours.textContent = formatTrend(calcTrend(c.hours, p.hours));
    elements.efficiency.textContent = formatTrend(calcTrend(c.efficiency, p.efficiency));
    
    console.log('✅ Тренды обновлены');
}

// ============================================
// ПОСЛЕДНИЕ ЗАПИСИ
// ============================================

// Обновление последних записей
function updateRecentRecords() {
    const container = document.getElementById('recent-records-list');
    const countEl = document.getElementById('recent-count');
    
    if (!container) {
        console.warn('⚠️ Контейнер recent-records-list не найден');
        return;
    }
    
    console.log('📋 Обновление последних записей, всего:', records.length);
    
    // Сортировка с использованием parseLocalDate
    const sorted = [...records].sort((a, b) => {
        const da = parseLocalDate(a.date);
        const db = parseLocalDate(b.date);
        return (db || 0) - (da || 0);
    });
    const recent = sorted.slice(0, 5);
    
    if (countEl) countEl.textContent = sorted.length;
    
    if (recent.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--ios-text-tertiary);">
                <ion-icon name="document-text-outline" style="font-size: 48px; display: block; margin: 0 auto 12px;"></ion-icon>
                Нет записей. Начните вести журнал!
            </div>
        `;
        return;
    }
    
    container.innerHTML = recent.map((r, index) => {
        // Используем parseLocalDate для форматирования даты
        const d = parseLocalDate(r.date);
        const dateStr = d ? d.toLocaleDateString('ru-RU') : r.date || '-';
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; ${index < recent.length - 1 ? 'border-bottom: 1px solid var(--ios-border);' : ''}">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; font-size: 15px;">${dateStr}</div>
                    <div style="font-size: 13px; color: var(--ios-text-tertiary);">
                        ${r.weekday || ''} · <ion-icon name="cube-outline" style="vertical-align: middle; margin-right: 4px; font-size: 14px;"></ion-icon> ${r.ordersDelivery || 0} заказов · <ion-icon name="time-outline" style="vertical-align: middle; margin-right: 4px; font-size: 14px;"></ion-icon> ${r.hours || 0} ч
                    </div>
                </div>
                <div style="text-align: right; flex-shrink: 0; margin-left: 12px;">
                    <div style="font-weight: 700; font-size: 16px; color: ${r.netProfit >= 0 ? 'var(--ios-success)' : 'var(--ios-danger)'};">
                        ${formatMoney(r.netProfit)}
                    </div>
                    <div style="font-size: 12px; color: var(--ios-text-tertiary);">
                        доход ${formatMoney(r.totalIncome || 0)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    console.log('✅ Последние записи обновлены, показано:', recent.length);
}

// ============================================
// ЛУЧШИЙ ДЕНЬ
// ============================================

// Обновление лучшего дня
function updateBestDay() {
    console.log('📊 Обновление лучшего дня, записей:', records.length);
    
    const incomeEl = document.getElementById('best-day-income');
    const dateEl = document.getElementById('best-day-date');
    const ordersEl = document.getElementById('best-day-orders');
    const hoursEl = document.getElementById('best-day-hours');
    const efficiencyEl = document.getElementById('best-day-efficiency');
    
    if (!incomeEl || !dateEl || !ordersEl || !hoursEl || !efficiencyEl) {
        console.warn('⚠️ Элементы лучшего дня не найдены');
        return;
    }
    
    if (records.length === 0) {
        incomeEl.textContent = '0 ₽';
        dateEl.textContent = 'Нет данных';
        ordersEl.textContent = '0';
        hoursEl.textContent = '0';
        efficiencyEl.textContent = '0%';
        return;
    }
    
    const bestDay = records.reduce((best, r) => {
        if (!best || r.netProfit > best.netProfit) return r;
        return best;
    }, null);
    
    if (bestDay) {
        incomeEl.textContent = formatMoney(bestDay.netProfit);
        // Используем parseLocalDate для корректного форматирования даты
        const d = parseLocalDate(bestDay.date);
        const dateStr = d ? d.toLocaleDateString('ru-RU') : bestDay.date;
        dateEl.textContent = dateStr + ' (' + (bestDay.weekday || '') + ')';
        ordersEl.textContent = bestDay.ordersDelivery || 0;
        hoursEl.textContent = bestDay.hours || 0;
        const efficiency = bestDay.totalIncome > 0 ? ((bestDay.netProfit / bestDay.totalIncome) * 100) : 0;
        efficiencyEl.textContent = efficiency.toFixed(1) + '%';
        console.log('✅ Лучший день найден:', dateStr, bestDay.netProfit);
    }
}

// ============================================
// TOAST УВЕДОМЛЕНИЕ
// ============================================

function showToast(message) {
    let toast = document.getElementById('custom-toast');
    if (toast) toast.remove();
    
    toast = document.createElement('div');
    toast.id = 'custom-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 120px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        color: white;
        padding: 12px 24px;
        border-radius: 14px;
        font-size: 15px;
        font-weight: 600;
        z-index: 99999;
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.32, 0.72, 0, 1);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        max-width: 90%;
        text-align: center;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 400);
    }, 2500);
}



// ============================================
// ЕДИНСТВЕННЫЙ DOMContentLoaded - ВСЯ ИНИЦИАЛИЗАЦИЯ В ОДНОМ МЕСТЕ
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('📱 DOM загружен, инициализация приложения...');
    
    // Устанавливаем флаги
    window._homeTabInitialized = false;
    window._homeDataUpdated = false;
    
    // ========================================
    // 1. ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
    // ========================================
    (async function initApp() {
        console.log('🚀 Инициализация приложения...');
        
        await loadData();
        
        let fixed = false;
        records = records.map(r => {
            if (!r.recordType || r.recordType === '' || r.recordType === 'undefined') {
                fixed = true;
                r.recordType = (r.bonusPay || r.bonusPeriod) ? 'bonus' : 'work';
            }
            return normalizeRecord(r);
        });
        
        if (fixed) {
            console.log('✅ Исправлены некорректные recordType в localStorage');
            saveData();
        }
        
        const dateInput = document.getElementById('date');
        if (dateInput) {
            dateInput.addEventListener('change', onDateChange);
            dateInput.valueAsDate = new Date();
            onDateChange();
        }
        
        const dailyForm = document.getElementById('daily-form');
        if (dailyForm) {
            dailyForm.addEventListener('submit', saveRecord);
        }
        
        const tariffForm = document.getElementById('tariff-form');
        if (tariffForm) {
            tariffForm.addEventListener('submit', saveTariff);
        }
        
        const mainContainer = document.querySelector('.container');
        const bottomNav = document.querySelector('.bottom-nav');
        const authScreen = document.getElementById('auth-screen');
        
        if (mainContainer) mainContainer.style.display = 'none';
        if (bottomNav) bottomNav.style.display = 'none';
        if (authScreen) authScreen.classList.remove('hidden');
        
        addFormValidation();
        
        console.log('✅ Базовая инициализация завершена. Ожидание авторизации...');
    })();
    
    // ========================================
    // 2. ИНИЦИАЛИЗАЦИЯ ФИЛЬТРОВ ИСТОРИИ
    // ========================================
    initHistoryFilters();
    console.log('✅ Фильтры истории инициализированы');
    
    // ========================================
    // 3. ИНИЦИАЛИЗАЦИЯ ИНДИКАТОРА ПОДКЛЮЧЕНИЯ
    // ========================================
    updateConnectionIndicator();
    
    setTimeout(function() {
        checkFirebaseConnection();
    }, 3000);
    
    setInterval(function() {
        if (document.body.classList.contains('authenticated')) {
            checkFirebaseConnection();
        }
    }, 30000);
    console.log('✅ Индикатор подключения инициализирован');
    
    // ========================================
    // 4. ИНИЦИАЛИЗАЦИЯ ИМЕНИ ПОЛЬЗОВАТЕЛЯ
    // ========================================
    const nameEl = document.getElementById('profile-name');
    if (nameEl) {
        nameEl.addEventListener('dblclick', showEditNameDialog);
        nameEl.style.cursor = 'pointer';
        nameEl.title = 'Двойной клик для изменения имени';
    }
    console.log('✅ Имя пользователя инициализировано');
    
    // ========================================
    // 5. ИНИЦИАЛИЗАЦИЯ АВАТАРА
    // ========================================
    const avatarContainer = document.getElementById('profile-avatar-container');
    if (avatarContainer) {
        let pressTimer = null;
        
        avatarContainer.addEventListener('mousedown', function(e) {
            pressTimer = setTimeout(function() {
                removeAvatar();
            }, 1000);
        });
        
        avatarContainer.addEventListener('mouseup', function() {
            clearTimeout(pressTimer);
        });
        
        avatarContainer.addEventListener('mouseleave', function() {
            clearTimeout(pressTimer);
        });
        
        avatarContainer.addEventListener('touchstart', function(e) {
            pressTimer = setTimeout(function() {
                removeAvatar();
            }, 1000);
        });
        
        avatarContainer.addEventListener('touchend', function() {
            clearTimeout(pressTimer);
        });
        
        avatarContainer.addEventListener('touchmove', function() {
            clearTimeout(pressTimer);
        });
    }
    
    loadProfileAvatar();
    console.log('✅ Аватар инициализирован');
    
    // ========================================
    // 6. ИНИЦИАЛИЗАЦИЯ FAB КНОПКИ
    // ========================================
    const fab = document.getElementById('fab-add');
    const tooltip = document.getElementById('fab-tooltip');
    
    if (fab && tooltip) {
        fab.addEventListener('mouseenter', function() {
            tooltip.style.opacity = '1';
            tooltip.style.transform = 'translateX(0) scale(1)';
        });
        
        fab.addEventListener('mouseleave', function() {
            tooltip.style.opacity = '0';
            tooltip.style.transform = 'translateX(10px) scale(0.9)';
        });
        
        let tooltipShown = false;
        fab.addEventListener('touchstart', function() {
            if (!tooltipShown) {
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateX(0) scale(1)';
                tooltipShown = true;
                setTimeout(() => {
                    tooltip.style.opacity = '0';
                    tooltip.style.transform = 'translateX(10px) scale(0.9)';
                }, 2000);
            }
        });
    }
    console.log('✅ FAB кнопка инициализирована');
    
    // ========================================
    // 7. НЕ ВЫЗЫВАЕМ updateHomeTab() ЗДЕСЬ
    // ========================================
    // Главная вкладка обновится после входа пользователя
    console.log('✅ Вкладка "Главная" ожидает авторизации...');
    
    console.log('✅ ВСЯ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА!');
    
    // ========================================
// 8. ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ (ПОСЛЕДНЕЕ ДЕЙСТВИЕ!)
// ========================================
// Восстанавливаем последнюю активную вкладку после загрузки данных
setTimeout(() => {
    restoreState();
}, 500);
});




// ===== ГАРАНТИРОВАННАЯ ПРИВЯЗКА ФИЛЬТРОВ =====
document.addEventListener('DOMContentLoaded', function() {
    // Делаем все функции глобально доступными
    window.applyFilters = applyFilters;
    window.applySorting = applySorting;
    window.renderTable = renderTable;
    window.toggleFilter = toggleFilter;
    window.clearAllFilters = clearAllFilters;
    window.filterState = filterState;
    window.sortState = sortState;
    window.records = records;
    
    console.log('✅ Все функции и переменные экспортированы в window');
    
    // Проверяем, что строка фильтров существует
    const filterRow = document.getElementById('filter-row');
    if (filterRow) {
        console.log('✅ Строка фильтров найдена, display:', filterRow.style.display);
    } else {
        console.error('❌ Строка фильтров #filter-row НЕ НАЙДЕНА в HTML!');
    }
});

// Заполняет выпадающие списки автомобилей в формах топлива и ремонта
function updateFormVehicleSelects() {
    const vehicles = typeof window.getVehicles === 'function' ? window.getVehicles() : [{ id: 'default', name: 'Основной автомобиль', plate: 'Не указан' }];
    
    const optionsHTML = vehicles.map(v => `<option value="${v.id}">${v.name} (${v.plate})</option>`).join('');
    
    const fuelSelect = document.getElementById('fuel-vehicle-select');
    const repairSelect = document.getElementById('repair-vehicle-select');
    
    if (fuelSelect) fuelSelect.innerHTML = optionsHTML;
    if (repairSelect) repairSelect.innerHTML = optionsHTML;
}

// Вызываем эту функцию при загрузке страницы и при смене автомобиля
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateFormVehicleSelects, 500); // Небольшая задержка, чтобы модуль автомобилей успел загрузиться
});

// Переопределяем notifyVehicleChanged, чтобы обновлять формы при смене авто
const originalNotifyVehicleChanged = window.notifyVehicleChanged || function() {};
window.notifyVehicleChanged = function() {
    originalNotifyVehicleChanged();
    updateFormVehicleSelects();
};