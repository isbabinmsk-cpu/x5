// ============================================
// МОДУЛЬ АУТЕНТИФИКАЦИИ (auth-module.js) v4.5
// Загрузка держится до полной загрузки данных
// ============================================
(function () {
    'use strict';

    // ===== УТИЛИТА =====
    function $(id) {
        return document.getElementById(id);
    }

    // ===== ЭКРАН ЗАГРУЗКИ =====
    function hideLoadingScreen() {
        const el = $('auth-loading-screen');
        if (el) {
            el.classList.add('hidden');
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
        }
    }

    // ===== ФОРМА ВХОДА =====
    function showAuthScreen() {
        const el = $('auth-screen');
        if (el) {
            el.classList.remove('hidden');
            el.classList.add('show-login');
            el.style.setProperty('display', 'flex', 'important');
            el.style.setProperty('opacity', '1', 'important');
            el.style.setProperty('pointer-events', 'auto', 'important');
        }
    }

    function hideAuthScreen() {
        const el = $('auth-screen');
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('show-login');
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
        }
    }

    // ===== ОШИБКИ =====
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

    // ===== ТАБЫ =====
    function switchAuthTab(tab) {
        const loginForm = $('login-form');
        const registerForm = $('register-form');
        const tabs = document.querySelectorAll('.auth-tab');

        if (!loginForm || !registerForm) return;

        tabs.forEach(t => t.classList.remove('active'));

        if (tab === 'login') {
            loginForm.style.display = 'flex';
            registerForm.style.display = 'none';
            if (tabs[0]) tabs[0].classList.add('active');
        } else {
            loginForm.style.display = 'none';
            registerForm.style.display = 'flex';
            if (tabs[1]) tabs[1].classList.add('active');
        }

        const loginError = $('login-error');
        const registerError = $('register-error');
        if (loginError) loginError.textContent = '';
        if (registerError) registerError.textContent = '';
    }

    // ===== ФОРМЫ =====
    let formsBound = false;

    function initForms() {
        const loginForm = $('login-form');
        const registerForm = $('register-form');

        if (!loginForm || !registerForm) {
            setTimeout(initForms, 100);
            return;
        }

        if (formsBound) return;
        formsBound = true;

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('login-email').value;
            const password = $('login-password').value;
            const errorEl = $('login-error');

            try {
                errorEl.textContent = '';
                await auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                errorEl.textContent = getAuthErrorMessage(error.code);
            }
        });

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = $('register-name').value;
            const email = $('register-email').value;
            const password = $('register-password').value;
            const confirm = $('register-confirm').value;
            const errorEl = $('register-error');

            if (password !== confirm) {
                errorEl.textContent = 'Пароли не совпадают';
                return;
            }

            try {
                errorEl.textContent = '';
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);

                await userCredential.user.updateProfile({ displayName: name });

                await db.collection('users').doc(userCredential.user.uid).set({
                    name: name,
                    email: email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                errorEl.textContent = getAuthErrorMessage(error.code);
            }
        });

        console.log('✅ Обработчики форм привязаны');
    }

    // ============================================
    // МОДАЛКА ВЫХОДА
    // ============================================
    function showLogoutModal() {
        if ($('logout-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'logout-modal-overlay';
        overlay.className = 'logout-modal-overlay';
        overlay.innerHTML = `
            <div class="logout-modal" role="dialog" aria-modal="true">
                <div class="logout-modal-icon">
                    <ion-icon name="log-out-outline"></ion-icon>
                </div>
                <h3 class="logout-modal-title">Выйти из аккаунта?</h3>
                <p class="logout-modal-subtitle">
                    Ваши данные сохранены в облаке.<br>
                    Вы сможете войти снова с любого устройства.
                </p>
                <div class="logout-modal-actions">
                    <button class="logout-btn logout-btn-confirm" id="logout-confirm-btn">
                        <ion-icon name="log-out-outline"></ion-icon>
                        <span>Выйти</span>
                    </button>
                    <button class="logout-btn logout-btn-cancel" id="logout-cancel-btn">
                        Отмена
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add('visible'));

        const confirmBtn = overlay.querySelector('#logout-confirm-btn');
        const cancelBtn = overlay.querySelector('#logout-cancel-btn');

        const closeModal = () => {
            overlay.classList.remove('visible');
            document.removeEventListener('keydown', escHandler);
            setTimeout(() => overlay.remove(), 250);
        };

        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        const escHandler = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        document.addEventListener('keydown', escHandler);

        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            confirmBtn.innerHTML = '<span class="logout-spinner"></span><span>Выходим...</span>';
            try {
                await performLogout();
                closeModal();
            } catch (error) {
                console.error('❌ Ошибка при выходе:', error);
                if (typeof window.showToast === 'function') {
                    window.showToast('⚠️ Ошибка при выходе: ' + error.message);
                }
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.innerHTML = '<ion-icon name="log-out-outline"></ion-icon><span>Выйти</span>';
            }
        });
    }

    // ============================================
    // ВЫХОД
    // ============================================
    async function performLogout() {
        window._isLoggingOut = true;

        if (window._fbListeners && window._fbListeners.length > 0) {
            console.log(`🔕 Отписываемся от ${window._fbListeners.length} Firebase-слушателей...`);
            const toUnsub = [...window._fbListeners];
            toUnsub.forEach(unsub => { try { unsub(); } catch (e) {} });
            window._fbListeners = [];
            console.log('✅ Все слушатели отписаны');
        }

        ['unsubscribeRepairs', 'unsubscribeVehicles', 'unsubscribeFuel'].forEach(name => {
            if (typeof window[name] === 'function') {
                try { window[name](); } catch (e) {}
                window[name] = null;
            }
        });

        if (typeof window.closeAllMenus === 'function') window.closeAllMenus();
        if (typeof window.closeFabMenu === 'function') window.closeFabMenu();

        const container = document.querySelector('.container');
        const bottomNavWrap = document.querySelector('.bottom-nav-wrap');
        const bottomNav = document.querySelector('.bottom-nav');
        const logoutBtn = $('logout-btn');
        const statusWrapper = $('connection-status-wrapper');

        if (container) container.style.display = 'none';
        if (bottomNavWrap) bottomNavWrap.style.display = 'none';
        if (bottomNav) bottomNav.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (statusWrapper) statusWrapper.style.display = 'none';

        document.body.classList.remove('authenticated');

        showAuthScreen();

        localStorage.removeItem('driverAuthState');
        localStorage.removeItem('appState');

        if (typeof window.records !== 'undefined') window.records = [];
        if (typeof window.tariffs !== 'undefined') window.tariffs = [];
        if (typeof window.fuelLogs !== 'undefined') window.fuelLogs = [];
        if (typeof window.repairRecords !== 'undefined') window.repairRecords = [];
        if (typeof window.saveData === 'function') window.saveData();

        const loginForm = $('login-form');
        const registerForm = $('register-form');
        const loginError = $('login-error');
        const registerError = $('register-error');
        if (loginForm) loginForm.reset();
        if (registerForm) registerForm.reset();
        if (loginError) loginError.textContent = '';
        if (registerError) registerError.textContent = '';

        switchAuthTab('login');

        try {
            await auth.signOut();
            console.log('✅ Вы вышли из аккаунта');
        } catch (error) {
            console.error('Ошибка выхода:', error);
        }

        window.currentUser = null;
        if (typeof window.connectionMode !== 'undefined') window.connectionMode = 'local';
        if (typeof window.firebaseErrorReason !== 'undefined') window.firebaseErrorReason = '';
        if (typeof window.updateConnectionIndicator === 'function') window.updateConnectionIndicator();

        setTimeout(() => { window._isLoggingOut = false; }, 2000);

        if (typeof window.showToast === 'function') window.showToast('👋 Вы вышли из аккаунта');
    }

    // ============================================
    // ВХОД — КЛЮЧЕВАЯ ФУНКЦИЯ
    // ⚠️ Загрузка скрывается ТОЛЬКО после того, как загружены ВСЕ данные
    // ============================================
    async function handleUserLogin(user) {
        console.log('✅ Пользователь вошел:', user.email);
        console.log('⏳ Начинаем загрузку данных...');

        // 1. Сразу устанавливаем currentUser, чтобы loadUserData знала uid
        window.currentUser = user;
        localStorage.setItem('driverAuthState', 'true');

        // 2. НЕ скрываем загрузку, НЕ показываем интерфейс — спиннер крутится
        // НЕ добавляем body.authenticated

        // 3. Скрываем форму входа (чтобы её не было видно за спиннером)
        hideAuthScreen();

        // 4. Обновляем статус
        if (typeof window.connectionMode !== 'undefined') window.connectionMode = 'checking';
        if (typeof window.firebaseErrorReason !== 'undefined') window.firebaseErrorReason = '';
        if (typeof window.updateConnectionIndicator === 'function') window.updateConnectionIndicator();

        // 5. Загружаем ВСЕ данные, пока спиннер крутится
        try {
            if (typeof window.loadUserData === 'function') {
                await window.loadUserData();
                console.log('✅ loadUserData завершён');
            }

            if (typeof window.loadVehicles === 'function') {
                await window.loadVehicles();
                console.log('✅ loadVehicles завершён');
            }

            if (typeof window.loadFuelLogs === 'function') {
                await window.loadFuelLogs();
                console.log('✅ loadFuelLogs завершён');
            }

            if (typeof window.loadRepairRecords === 'function') {
                await window.loadRepairRecords();
                console.log('✅ loadRepairRecords завершён');
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            if (typeof window.connectionMode !== 'undefined') window.connectionMode = 'local';
            if (typeof window.firebaseErrorReason !== 'undefined') window.firebaseErrorReason = 'Ошибка загрузки данных: ' + error.message;
        }

        // 6. ✅ ТОЛЬКО ТЕПЕРЬ показываем интерфейс
        // Скрываем загрузку
        hideLoadingScreen();

        // Показываем интерфейс
        document.body.classList.add('authenticated');

        const logoutBtn = $('logout-btn');
        const container = document.querySelector('.container');
        const bottomNav = document.querySelector('.bottom-nav');
        const statusWrapper = $('connection-status-wrapper');

        if (container) container.style.display = 'block';
        if (bottomNav) bottomNav.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
        if (statusWrapper) statusWrapper.style.display = 'flex';

        // 7. Заполняем профиль
        const nameEl = $('profile-name');
        const emailEl = $('profile-email');
        const syncEl = $('profile-sync-status');

        const userName = user.displayName || (user.email ? user.email.split('@')[0] : 'Водитель');
        if (nameEl) nameEl.textContent = userName;
        if (emailEl) emailEl.textContent = user.email || '';
        if (syncEl) {
            syncEl.innerHTML = '<ion-icon name="checkmark-circle-outline" style="font-size: 16px;"></ion-icon> Синхронизировано';
            syncEl.style.color = 'var(--ios-success)';
        }

        // 8. Аватар
        const homeTab = $('tab-home');
        if (homeTab && homeTab.classList.contains('active')) {
            if (typeof window.loadProfileAvatar === 'function') window.loadProfileAvatar();
        }

        // 9. Проверка соединения
        setTimeout(() => {
            if (typeof window.checkFirebaseConnection === 'function') window.checkFirebaseConnection();
        }, 1000);

        console.log('✅ Интерфейс показан. Все данные загружены.');
    }

    // ============================================
    // ВЫХОД (автоматический)
    // ============================================
    function handleUserLogout() {
        hideLoadingScreen();

        if (window._fbListeners && window._fbListeners.length > 0) {
            window._isLoggingOut = true;
            const toUnsub = [...window._fbListeners];
            toUnsub.forEach(unsub => { try { unsub(); } catch(e){} });
            window._fbListeners = [];
            setTimeout(() => { window._isLoggingOut = false; }, 2000);
        }

        window.currentUser = null;
        localStorage.removeItem('driverAuthState');
        document.body.classList.remove('authenticated');

        const logoutBtn = $('logout-btn');
        const container = document.querySelector('.container');
        const bottomNav = document.querySelector('.bottom-nav');
        const statusWrapper = $('connection-status-wrapper');

        if (container) container.style.display = 'none';
        if (bottomNav) bottomNav.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (statusWrapper) statusWrapper.style.display = 'none';

        showAuthScreen();

        if (typeof window.records !== 'undefined') window.records = [];
        if (typeof window.tariffs !== 'undefined') window.tariffs = [];
        if (typeof window.saveData === 'function') window.saveData();

        if (typeof window.connectionMode !== 'undefined') window.connectionMode = 'local';
        if (typeof window.firebaseErrorReason !== 'undefined') window.firebaseErrorReason = 'Пользователь не авторизован';

        const loginForm = $('login-form');
        const registerForm = $('register-form');
        if (loginForm) loginForm.reset();
        if (registerForm) registerForm.reset();

        const loginError = $('login-error');
        const registerError = $('register-error');
        if (loginError) loginError.textContent = '';
        if (registerError) registerError.textContent = '';

        switchAuthTab('login');

        console.log('👤 Пользователь вышел, показан экран авторизации');
    }

    // ============================================
    // СЛУШАТЕЛЬ СОСТОЯНИЯ
    // ============================================
    function initAuthStateListener() {
        if (typeof auth === 'undefined' || !auth) {
            console.warn('⚠️ Firebase Auth не готов, повтор через 200мс');
            setTimeout(initAuthStateListener, 200);
            return;
        }

        console.log('🔐 Регистрируем onAuthStateChanged (загрузка держится до загрузки данных)');

        auth.onAuthStateChanged(async (user) => {
            try {
                if (user) {
                    await handleUserLogin(user);
                } else {
                    handleUserLogout();
                }
            } catch (error) {
                console.error('❌ Ошибка в onAuthStateChanged:', error);
                hideLoadingScreen();
            }
        });
    }

    // ====== КНОПКА ВЫЙТИ ======
    function initLogoutButton() {
        const _logoutBtn = $('logout-btn');
        if (!_logoutBtn) {
            setTimeout(initLogoutButton, 100);
            return;
        }
        _logoutBtn.replaceWith(_logoutBtn.cloneNode(true));
        $('logout-btn').addEventListener('click', showLogoutModal);
        console.log('✅ Кнопка выхода привязана');
    }

    // ===== ИНИЦИАЛИЗАЦИЯ =====
    function init() {
        initForms();
        initLogoutButton();
        console.log('✅ Модуль аутентификации v4.5 инициализирован');
    }

    // ===== ЭКСПОРТ =====
    window.switchAuthTab = switchAuthTab;
    window.showLogoutModal = showLogoutModal;
    window.performLogout = performLogout;
    window.getAuthErrorMessage = getAuthErrorMessage;
    window.hideLoadingScreen = hideLoadingScreen;
    window.showAuthScreen = showAuthScreen;
    window.hideAuthScreen = hideAuthScreen;

    // ===== СТАРТ =====
    initAuthStateListener();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();