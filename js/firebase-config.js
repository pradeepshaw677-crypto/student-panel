        // ═══════════════════════════════════════════════════════════════
        //  FIREBASE CONFIG
        // ═══════════════════════════════════════════════════════════════
        const firebaseConfig = {
            apiKey: "AIzaSyAtgUOiAnQOUPtGc7C4iuwmGUSjqU_8TE0",
            authDomain: "students-manager-b5a76.firebaseapp.com",
            projectId: "students-manager-b5a76",
            storageBucket: "students-manager-b5a76.firebasestorage.app",
            messagingSenderId: "768567956050",
            appId: "1:768567956050:web:655ddc2ebb7b7cc2bf858b",
            measurementId: "G-RMX5056C3P"
        };
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth ? firebase.auth() : null;
        const db = firebase.firestore ? firebase.firestore() : null;
