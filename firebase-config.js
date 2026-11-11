// Конфигурация Firebase
const firebaseConfig = {
    apiKey: "AIzaSyD93OqstVAnohtNuGZkAxKtr9m1Q3FImlk",
    authDomain: "driver-journal-f6b84.firebaseapp.com",
    projectId: "driver-journal-f6b84",
    storageBucket: "driver-journal-f6b84.firebasestorage.app",
    messagingSenderId: "858380884983",
    appId: "1:858380884983:web:3c109af8e6c81c6910acf2"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

// ✅ ВАЖНО: положить в window
window.db = db;
window.auth = auth;

// ✅ Начальное значение connectionMode
window.connectionMode = 'checking';
window.currentUser = null;

console.log('✅ Firebase инициализирован');