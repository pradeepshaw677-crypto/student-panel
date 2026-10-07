        window.toggleAiAssistant = function() {
            const modal = document.getElementById('ai-assistant-modal');
            const iframe = document.getElementById('ai-iframe');
            if (!modal) return;
            if (modal.style.display === 'none' || !modal.style.display) {
                if (iframe && !iframe.src && iframe.dataset.src) {
                    iframe.src = iframe.dataset.src;
                }
                modal.style.display = 'flex';
            } else {
                modal.style.display = 'none';
            }
        };

// ═══════════════════════════════════════════════════════════════
        //  STATE
        // ═══════════════════════════════════════════════════════════════
        let currentStudent = null;
        let studentDocId = null;
        let todayStr = formatDateKey(new Date());
        let unsubStudent = null;
        let pendingPayReminderOriginalIndex = null; // Store the ORIGINAL index in reminderLog

        // ═══════════════════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════════════════
        function formatDateKey(d) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        function formatDisplay(ds) {
            if (!ds) return '—';
            const d = new Date(ds);
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        }
        function formatDateTime(ds) {
            if (!ds) return '—';
            const d = new Date(ds);
            return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
        function showToast(msg, type = '') {
            const el = document.getElementById('toast');
            el.textContent = msg;
            el.className = 'toast show ' + type;
            clearTimeout(el._timer);
            el._timer = setTimeout(() => el.classList.remove('show'), 4000);
        }
        function getPatternDays(pattern) {
            switch (pattern) {
                case 'daily': return [1, 2, 3, 4, 5, 6];
                case 'mon_wed_fri': return [1, 3, 5];
                case 'tue_thu_sat': return [2, 4, 6];
                default: return [1, 2, 3, 4, 5, 6];
            }
        }
        function getSafeLog(student) {
            const log = student?.reminderLog;
            return Array.isArray(log) ? log : [];
        }
        function getSafeSyllabus(student) {
            const syl = student?.syllabus;
            return Array.isArray(syl) ? syl : [];
        }
        function isEligibleDate(dateStr, startDateStr, durationMonths, pattern) {
            const date = new Date(dateStr);
            const start = new Date(startDateStr);
            const end = new Date(start);
            end.setMonth(end.getMonth() + (durationMonths || 0));
            if (date < start || date >= end) return false;
            if (date.getDay() === 0) return false;
            const days = getPatternDays(pattern);
            return days.includes(date.getDay());
        }
        function isCourseCompleted(student) {
            if (!student?.admissionDate || !student?.duration) return false;
            const start = new Date(student.admissionDate);
            const end = new Date(start);
            end.setMonth(end.getMonth() + student.duration);
            const now = new Date();
            const log = getSafeLog(student);
            const hasCompletion = log.some(r => r?.type === 'complete' && r?.status === 'completed');
            return now >= end || hasCompletion;
        }
        function getSyllabusProgress(syllabus) {
            const syl = Array.isArray(syllabus) ? syllabus : [];
            if (syl.length === 0) return { total: 0, done: 0, pct: 0 };
            const total = syl.length;
            const done = syl.filter(t => t && t.completed === true).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return { total, done, pct };
        }
        function getPatternLabel(pattern) {
            const map = { daily: 'Daily (Mon-Sat)', mon_wed_fri: 'Mon/Wed/Fri', tue_thu_sat: 'Tue/Thu/Sat' };
            return map[pattern] || pattern;
        }

        // ─── SECURITY HELPERS ───
        function esc(v) {
            return String(v == null ? '' : v).replace(/[&<>"']/g, c => (
                { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
            ));
        }
        function safeMediaUrl(url) {
            const s = String(url || '').trim();
            return /^(https?:|blob:)/i.test(s) ? s : '';
        }
        // ═══════════════════════════════════════════════════════════════
        //  AUTH - STUDENT LOGIN (Firebase Auth)
        //  Student wahi username+password daalta hai jo admin ne diya.
        //  Password Firebase Auth (Google server) me verify hota hai — kabhi
        //  browser/Firestore me expose nahi hota. Email sirf internal label hai.
        // ═══════════════════════════════════════════════════════════════
        const STUDENT_AUTH_DOMAIN = 'sm-panel.app';
        function studentEmail(username) {
            return String(username || '').trim().toLowerCase() + '@' + STUDENT_AUTH_DOMAIN;
        }

        async function loginStudent(username, password) {
            if (!auth || !db) { document.getElementById('loginError').textContent = '❌ Firebase not ready.'; return; }
            document.getElementById('loginError').textContent = '';
            try {
                // onAuthStateChanged dashboard load karega sign-in hote hi.
                await auth.signInWithEmailAndPassword(studentEmail(username), password);
            } catch (err) {
                const code = err && err.code;
                let msg = '❌ Invalid username or password.';
                if (code === 'auth/too-many-requests') msg = '❌ Bahut baar galat try. Thodi der baad koshish karo.';
                else if (code === 'auth/invalid-email') msg = '❌ Invalid username.';
                else if (code === 'auth/network-request-failed') msg = '❌ Network error. Internet check karo.';
                else if (code && code !== 'auth/user-not-found' && code !== 'auth/wrong-password' && code !== 'auth/invalid-credential') {
                    msg = '❌ ' + (err.message || 'Login failed');
                }
                document.getElementById('loginError').textContent = msg;
            }
        }

        async function loadStudentByUid(uid) {
            const snap = await db.collection('students').where('authUid', '==', uid).limit(1).get();
            if (snap.empty) return null;
            const doc = snap.docs[0];
            return { id: doc.id, data: doc.data() };
        }

        function showLoginScreen() {
            if (unsubStudent) { unsubStudent(); unsubStudent = null; }
            currentStudent = null;
            studentDocId = null;
            localStorage.removeItem('studentSession');
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('dashboard').classList.remove('show');
        }

        function logoutStudent() {
            showLoginScreen();
            document.getElementById('loginError').textContent = '';
            const u = document.getElementById('loginUsername'); if (u) u.value = '';
            const p = document.getElementById('loginPassword'); if (p) p.value = '';
            if (auth) auth.signOut().catch(() => {});
            showToast('Logged out', 'success');
        }

        // Firebase auth state observe karo — page reload pe bhi session bana rehta
        // hai, aur login/logout pe dashboard apne aap switch hota hai.
        function checkSession() {
            if (!auth) return;
            auth.onAuthStateChanged(async (user) => {
                if (!user) { showLoginScreen(); return; }
                try {
                    const rec = await loadStudentByUid(user.uid);
                    if (!rec) {
                        document.getElementById('loginError').textContent = '❌ Account kisi student se linked nahi hai. Admin se contact karo.';
                        await auth.signOut();
                        return;
                    }
                    studentDocId = rec.id;
                    currentStudent = { ...rec.data, id: rec.id };
                    localStorage.setItem('studentSession', JSON.stringify({ docId: rec.id, uid: user.uid }));
                    document.getElementById('loginScreen').style.display = 'none';
                    document.getElementById('dashboard').classList.add('show');
                    document.getElementById('loginError').textContent = '';
                    listenStudentData(rec.id);
                    showToast(`Welcome, ${rec.data.name || rec.data.username}!`, 'success');
                } catch (e) {
                    document.getElementById('loginError').textContent = '❌ Error: ' + (e.message || e);
                }
            });
        }

        // ═══════════════════════════════════════════════════════════════
        //  FIRESTORE: LISTEN STUDENT DATA
        // ═══════════════════════════════════════════════════════════════
        function listenStudentData(docId) {
            if (unsubStudent) unsubStudent();
            if (!db) return;
            unsubStudent = db.collection('students').doc(docId).onSnapshot((snapshot) => {
                if (snapshot.exists) {
                    const data = snapshot.data();
                    currentStudent = { ...data, id: docId };
                    renderAll();
                } else {
                    showToast('Your account data was removed.', 'error');
                    logoutStudent();
                }
            }, (error) => {
                showToast('Error loading data: ' + error.message, 'error');
            });
        }

        // ═══════════════════════════════════════════════════════════════
        //  RENDER ALL
        // ═══════════════════════════════════════════════════════════════
        function renderAll() {
            if (!currentStudent) return;
            renderProfile();
            renderSyllabus();
            renderAttendance();
            renderReminders();
            renderAttendanceHistory();
            renderReminderHistory();
            renderCourseVideos();
            updateMenuBadges();
        }

        // ─── PROFILE ───
        function renderProfile() {
            const s = currentStudent;
            document.getElementById('studentName').textContent = s.name || s.username || '—';
            document.getElementById('studentFullName').textContent = s.name || '—';
            document.getElementById('studentMobile').textContent = s.mobile || '—';
            document.getElementById('studentCourse').textContent = s.course || '—';
            document.getElementById('studentSlot').textContent = s.slot || '—';
            document.getElementById('studentAdmission').textContent = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
            const feeDisplay = s.feeType === 'monthly' ? `₹${s.fee}/month` : s.feeType === 'yearly' ? `₹${s.fee}/year` : 'Fixed';
            document.getElementById('studentFee').textContent = feeDisplay || '—';
            document.getElementById('studentPackage').textContent = s.package || '—';
            document.getElementById('studentDuration').textContent = s.duration ? `${s.duration} months` : '—';
            if (s.photo && s.photo.length > 100) {
                document.getElementById('studentAvatar').src = s.photo;
            }
            const att = s.attendance || {};
            const totalDays = Object.keys(att).length;
            const present = Object.values(att).filter(v => v === 'present').length;
            const absent = Object.values(att).filter(v => v === 'absent').length;
            const prog = getSyllabusProgress(s.syllabus);
            document.getElementById('statTotalDays').textContent = totalDays;
            document.getElementById('statPresent').textContent = present;
            document.getElementById('statAbsent').textContent = absent;
            document.getElementById('statSylProgress').textContent = prog.pct + '%';
        }

        // ─── SYLLABUS ───
        function renderSyllabus() {
            const list = document.getElementById('syllabusList');
            const syllabus = getSafeSyllabus(currentStudent);
            const prog = getSyllabusProgress(syllabus);
            document.getElementById('sylProgressBadge').textContent = prog.pct + '%';
            document.getElementById('sylProgressFill').style.width = prog.pct + '%';
            document.getElementById('menuSylBadge').textContent = prog.pct + '%';
            if (!syllabus.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-book-open"></i>No syllabus added yet.</div>';
                return;
            }
            let html = '';
            syllabus.forEach((topic, idx) => {
                const isDone = topic && topic.completed === true;
                const topicName = topic && topic.topic ? topic.topic : (typeof topic === 'string' ? topic : 'Untitled');
                html += `
                    <div class="syl-item" data-idx="${idx}" style="cursor:pointer;">
                        <span class="syl-check ${isDone ? 'done' : ''}">${isDone ? '✓' : ''}</span>
                        <span class="syl-name ${isDone ? 'done' : ''}">${esc(topicName)}</span>
                        <span class="syl-status ${isDone ? 'done' : ''}">${isDone ? '✅ Done' : '⏳ Pending'}</span>
                    </div>
                `;
            });
            list.innerHTML = html;
            list.querySelectorAll('.syl-item').forEach(el => {
                el.addEventListener('click', function() {
                    const idx = parseInt(this.dataset.idx);
                    toggleSyllabus(idx);
                });
            });
        }

        // FIXED: Replace entire array instead of dot notation
        async function toggleSyllabus(idx) {
            const syllabus = getSafeSyllabus(currentStudent);
            if (idx < 0 || idx >= syllabus.length) {
                showToast('Invalid syllabus topic.', 'error');
                return;
            }
            const newVal = !(syllabus[idx]?.completed === true);
            const updatedSyllabus = [...syllabus];
            updatedSyllabus[idx] = { ...syllabus[idx], completed: newVal };
            try {
                await db.collection('students').doc(studentDocId).update({ syllabus: updatedSyllabus });
                currentStudent.syllabus = updatedSyllabus;
                renderAll();
                showToast(`Topic ${newVal ? 'completed' : 'reopened'}!`, 'success');
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // ─── ATTENDANCE ───
        function renderAttendance() {
            const s = currentStudent;
            const today = new Date();
            const todayStr2 = formatDateKey(today);
            document.getElementById('attTodayDate').textContent = today.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            const att = s.attendance || {};
            const totalDays = Object.keys(att).length;
            const present = Object.values(att).filter(v => v === 'present').length;
            const absent = Object.values(att).filter(v => v === 'absent').length;
            document.getElementById('attTotalDays').textContent = totalDays;
            document.getElementById('attPresentCount').textContent = present;
            document.getElementById('attAbsentCount').textContent = absent;
            const todayStatus = att[todayStr2] || 'pending';
            const statusEl = document.getElementById('attStatusLabel');
            const markBtn = document.getElementById('markAttendanceBtn');
            const eligNote = document.getElementById('eligNote');
            const isCompleted = isCourseCompleted(s);
            const isEligible = isEligibleDate(todayStr2, s.admissionDate, s.duration, s.schedulePattern || 'daily');
            let canMark = false;
            let noteMsg = '';
            let noteClass = '';
            const adminMarked = (todayStatus === 'present' || todayStatus === 'absent');
            if (isCompleted) {
                statusEl.className = 'status-big completed';
                statusEl.textContent = '🎓 Course Completed';
                markBtn.disabled = true;
                noteMsg = 'You have completed this course.';
                noteClass = '';
            } else if (adminMarked) {
                if (todayStatus === 'present') {
                    statusEl.className = 'status-big present';
                    statusEl.textContent = '✅ Present';
                    markBtn.disabled = true;
                    noteMsg = 'Attendance marked by admin.';
                    noteClass = 'ok';
                } else {
                    statusEl.className = 'status-big absent';
                    statusEl.textContent = '❌ Absent';
                    markBtn.disabled = true;
                    noteMsg = 'Attendance marked by admin.';
                    noteClass = 'err';
                }
            } else if (!isEligible) {
                statusEl.className = 'status-big pending';
                statusEl.textContent = '⛔ Not Eligible';
                markBtn.disabled = true;
                noteMsg = `You are not eligible today (${getPatternLabel(s.schedulePattern || 'daily')}).`;
                noteClass = 'err';
            } else {
                statusEl.className = 'status-big pending';
                statusEl.textContent = '⏳ Pending';
                markBtn.disabled = false;
                canMark = true;
                noteMsg = 'You can mark your attendance now.';
                noteClass = 'ok';
            }
            eligNote.textContent = noteMsg;
            eligNote.className = 'elig-note ' + noteClass;
            markBtn.onclick = function() {
                if (!canMark) { showToast('You are not eligible to mark attendance today.', 'error'); return; }
                if (todayStr2 !== formatDateKey(new Date())) { showToast('You can only mark attendance for today.', 'error'); return; }
                const currentAtt = currentStudent.attendance || {};
                if (currentAtt[todayStr2] === 'present' || currentAtt[todayStr2] === 'absent') { showToast('Attendance already marked for today.', 'error'); return; }
                markAttendance();
            };
        }

        async function markAttendance() {
            const today = formatDateKey(new Date());
            const currentAtt = currentStudent.attendance || {};
            if (currentAtt[today] === 'present' || currentAtt[today] === 'absent') {
                showToast('Attendance already marked for today.', 'error');
                return;
            }
            const updates = {};
            updates[`attendance.${today}`] = 'present';
            updates['totalPresent'] = (currentStudent.totalPresent || 0) + 1;
            updates['totalAbsent'] = currentStudent.totalAbsent || 0;
            try {
                await db.collection('students').doc(studentDocId).update(updates);
                currentStudent.attendance = { ...currentAtt, [today]: 'present' };
                currentStudent.totalPresent = (currentStudent.totalPresent || 0) + 1;
                showToast('✅ Attendance marked as Present!', 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // ─── ATTENDANCE HISTORY ───
        function renderAttendanceHistory() {
            const list = document.getElementById('attendanceHistoryList');
            const att = currentStudent.attendance || {};
            const dates = Object.keys(att).sort((a, b) => new Date(b) - new Date(a));
            document.getElementById('attHistoryBadge').textContent = dates.length + ' records';
            document.getElementById('menuAttHistBadge').textContent = dates.length;
            if (!dates.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-clipboard-list"></i>No attendance records yet.</div>';
                return;
            }
            let html = '';
            dates.forEach(d => {
                const status = att[d];
                const statusClass = status === 'present' ? 'present' : 'absent';
                const label = status === 'present' ? '✅ Present' : '❌ Absent';
                html += `
                    <div class="h-item">
                        <span class="h-date">${esc(formatDisplay(d))} (${esc(new Date(d).toLocaleDateString('en-IN', { weekday: 'short' }))})</span>
                        <span class="h-status ${statusClass}">${label}</span>
                    </div>
                `;
            });
            list.innerHTML = html;
        }

        // ─── REMINDERS ─── FIXED INDEX MAPPING
        function renderReminders() {
            const list = document.getElementById('reminderList');
            const log = getSafeLog(currentStudent);
            const feeReminders = log.filter(r => r?.type !== 'complete');
            const pendingCount = feeReminders.filter(r => (r.paid === false || r.paid === undefined) && r.paymentRequested !== true).length;
            document.getElementById('remBadge').textContent = pendingCount + ' pending';
            document.getElementById('menuRemBadge').textContent = pendingCount;
            if (!feeReminders.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i>No reminders yet.</div>';
                return;
            }
            let html = '';
            feeReminders.slice().reverse().forEach((rem, displayIdx) => {
                const isPaid = rem.paid === true;
                const isPendingRequest = rem.paymentRequested === true && !isPaid;
                const statusClass = isPaid ? 'paid' : (isPendingRequest ? 'pending' : 'unpaid');
                const statusLabel = isPaid ? '✅ Paid' : (isPendingRequest ? '⏳ Pending Approval' : '⏳ Unpaid');
                const msg = rem.message || 'Fee reminder';
                const dateStr = rem.date ? formatDateTime(rem.date) : '—';
                const showPayBtn = !isPaid && !isPendingRequest;
                // Store the ORIGINAL index in the log array
                const originalIdx = log.indexOf(rem);
                html += `
                    <div class="rem-item" style="border-left-color: ${isPaid ? '#0ea5e9' : isPendingRequest ? '#b08020' : '#b04040'};">
                        <div class="rem-info">
                            <div class="rem-msg">${esc(msg)}</div>
                            <div class="rem-date"><i class="far fa-calendar-alt"></i> ${esc(dateStr)}</div>
                        </div>
                        <span class="rem-status ${statusClass}">${statusLabel}</span>
                        <div class="rem-action">
                            ${showPayBtn ? `<button class="btn-sm pay-btn" data-original-idx="${originalIdx}"><i class="fas fa-credit-card"></i> Pay</button>` : ''}
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
            list.querySelectorAll('.pay-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const originalIdx = parseInt(this.dataset.originalIdx);
                    openPayModal(originalIdx);
                });
            });
        }

        // ─── REMINDER HISTORY ───
        function renderReminderHistory() {
            const list = document.getElementById('reminderHistoryList');
            const log = getSafeLog(currentStudent);
            const allReminders = log.filter(r => r?.type !== 'complete');
            document.getElementById('remHistoryBadge').textContent = allReminders.length + ' reminders';
            document.getElementById('menuRemHistBadge').textContent = allReminders.length;
            if (!allReminders.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i>No reminders yet.</div>';
                return;
            }
            let html = '';
            allReminders.slice().reverse().forEach(rem => {
                const isPaid = rem.paid === true;
                const isPendingRequest = rem.paymentRequested === true && !isPaid;
                let statusClass = 'unpaid';
                let statusLabel = '⏳ Unpaid';
                if (isPaid) { statusClass = 'paid'; statusLabel = '✅ Success'; }
                else if (isPendingRequest) { statusClass = 'pending'; statusLabel = '⏳ Pending'; }
                const icon = rem.type === 'auto' ? '🤖' : '📨';
                const msg = rem.message || 'Reminder';
                const dateStr = rem.date ? formatDateTime(rem.date) : '—';
                html += `
                    <div class="h-item">
                        <span class="h-date">${esc(dateStr)}</span>
                        <span class="h-type">${icon} ${esc(rem.type || 'manual')}</span>
                        <span class="h-msg">${esc(msg)}</span>
                        <span class="h-status ${statusClass}">${statusLabel}</span>
                    </div>
                `;
            });
            list.innerHTML = html;
        }

        // ─── COURSE VIDEOS ───
        function renderCourseVideos() {
            const list = document.getElementById('courseList');
            const videos = currentStudent.courseVideos || [];
            document.getElementById('courseBadge').textContent = videos.length + ' videos';
            document.getElementById('menuCourseBadge').textContent = videos.length;
            if (!videos.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-film"></i>No course videos added by admin yet.</div>';
                return;
            }
            let html = '';
            videos.forEach((video, idx) => {
                const title = video.title || `Video ${idx + 1}`;
                const desc = video.description || '';
                const url = video.url || '#';
                html += `
                    <div class="course-item">
                        <div class="course-info">
                            <div class="course-title"><i class="fas fa-play-circle" style="color:#0ea5e9;"></i> ${esc(title)}</div>
                            ${desc ? `<div class="course-desc">${esc(desc)}</div>` : ''}
                        </div>
                        <div class="course-action">
                            <button class="btn-sm play-video-btn" data-url="${esc(url)}" data-title="${esc(title)}"><i class="fas fa-play"></i> Play</button>
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
            list.querySelectorAll('.play-video-btn').forEach(btn => {
                btn.addEventListener('click', function() { playVideo(this.dataset.url, this.dataset.title); });
            });
        }

        // ─── VIDEO PLAYER ───
        function playVideo(url, title) {
            const overlay = document.getElementById('videoPlayerOverlay');
            const body = document.getElementById('videoPlayerBody');
            const titleEl = document.getElementById('videoPlayerTitle');
            titleEl.innerHTML = `<i class="fas fa-play-circle" style="color:#0ea5e9;"></i> ${esc(title || 'Video')}`;
            let html = '';
            const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
            const isVimeo = url && url.includes('vimeo.com');
            if (isYouTube || isVimeo) {
                let embedUrl = url;
                if (isYouTube) {
                    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]+)/);
                    if (videoId && videoId[1]) embedUrl = `https://www.youtube.com/embed/${videoId[1]}?autoplay=1&rel=0`;
                }
                html = `<iframe src="${esc(safeMediaUrl(embedUrl))}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%; aspect-ratio:16/9; border:none; border-radius:12px; background:#0a0e1a;"></iframe>`;
            } else if (url) {
                html = `
                    <video id="inlinePlayer" controls style="width:100%; max-height:450px; border-radius:12px; background:#0a0e1a;">
                        <source src="${esc(safeMediaUrl(url))}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                    <div class="video-controls">
                        <button onclick="togglePlay()" id="playPauseBtn"><i class="fas fa-play"></i></button>
                        <input type="range" id="progressBar" min="0" max="100" value="0" />
                        <span id="timeDisplay" class="time-display">0:00 / 0:00</span>
                        <button onclick="toggleMute()" id="muteBtn"><i class="fas fa-volume-up"></i></button>
                        <button onclick="changeSpeed()" id="speedBtn" class="speed-control">1.0x</button>
                        <button onclick="toggleFullscreen()"><i class="fas fa-expand"></i></button>
                    </div>
                `;
            } else {
                html = '<div style="text-align:center;color:#64748b;padding:40px 0;">Invalid video URL.</div>';
            }
            body.innerHTML = html;
            overlay.classList.add('open');
            setTimeout(() => {
                const video = document.getElementById('inlinePlayer');
                if (video) setupVideoControls(video);
            }, 100);
        }
        window.playVideo = playVideo;

        function closeVideoPlayer() {
            document.getElementById('videoPlayerOverlay').classList.remove('open');
            document.getElementById('videoPlayerBody').innerHTML = '<div style="text-align:center;color:#64748b;padding:40px 0;">Loading video...</div>';
        }
        window.closeVideoPlayer = closeVideoPlayer;

        let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        let speedIndex = 2;
        function setupVideoControls(video) {
            const playBtn = document.getElementById('playPauseBtn');
            const progressBar = document.getElementById('progressBar');
            const timeDisplay = document.getElementById('timeDisplay');
            const muteBtn = document.getElementById('muteBtn');
            const speedBtn = document.getElementById('speedBtn');
            if (!video || !playBtn) return;
            video.addEventListener('loadedmetadata', function() { timeDisplay.textContent = formatTime(0) + ' / ' + formatTime(video.duration); });
            video.addEventListener('timeupdate', function() {
                const pct = (video.currentTime / video.duration) * 100;
                progressBar.value = pct;
                timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
            });
            playBtn.addEventListener('click', function() {
                if (video.paused) { video.play(); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; }
                else { video.pause(); playBtn.innerHTML = '<i class="fas fa-play"></i>'; }
            });
            video.addEventListener('play', function() { playBtn.innerHTML = '<i class="fas fa-pause"></i>'; });
            video.addEventListener('pause', function() { playBtn.innerHTML = '<i class="fas fa-play"></i>'; });
            progressBar.addEventListener('input', function() {
                const pct = parseFloat(this.value) / 100;
                video.currentTime = pct * video.duration;
            });
            muteBtn.addEventListener('click', function() {
                video.muted = !video.muted;
                muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
            });
            window.changeSpeed = function() {
                speedIndex = (speedIndex + 1) % speeds.length;
                video.playbackRate = speeds[speedIndex];
                speedBtn.textContent = speeds[speedIndex].toFixed(2) + 'x';
            };
            window.togglePlay = function() {
                if (video.paused) video.play(); else video.pause();
            };
            window.toggleMute = function() {
                video.muted = !video.muted;
                muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
            };
            window.toggleFullscreen = function() {
                const container = video.closest('.video-player-body') || video.parentElement;
                if (container.requestFullscreen) container.requestFullscreen();
                else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
            };
        }
        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return mins + ':' + String(secs).padStart(2, '0');
        }

        // ─── PAY MODAL ─── FIXED: Use original index directly
        function openPayModal(originalIdx) {
            pendingPayReminderOriginalIndex = originalIdx;
            document.getElementById('confirmSub').textContent = 'Are you sure you want to request payment for this reminder? Admin will approve it.';
            document.getElementById('confirmModal').classList.add('open');
        }

        document.getElementById('confirmPayBtn').addEventListener('click', async function() {
            if (pendingPayReminderOriginalIndex === null) return;
            const log = getSafeLog(currentStudent);
            const idx = pendingPayReminderOriginalIndex;
            if (idx < 0 || idx >= log.length) {
                showToast('Invalid reminder.', 'error');
                document.getElementById('confirmModal').classList.remove('open');
                pendingPayReminderOriginalIndex = null;
                return;
            }
            const reminder = log[idx];
            if (reminder.paid === true) {
                showToast('This reminder is already paid.', 'error');
                document.getElementById('confirmModal').classList.remove('open');
                pendingPayReminderOriginalIndex = null;
                return;
            }
            if (reminder.paymentRequested === true) {
                showToast('Payment already requested.', 'error');
                document.getElementById('confirmModal').classList.remove('open');
                pendingPayReminderOriginalIndex = null;
                return;
            }
            // FIXED: Replace entire reminderLog array instead of dot notation
            const updatedLog = [...log];
            updatedLog[idx] = {
                ...updatedLog[idx],
                paymentRequested: true,
                paymentRequestDate: new Date().toISOString()
            };
            try {
                await db.collection('students').doc(studentDocId).update({ reminderLog: updatedLog });
                currentStudent.reminderLog = updatedLog;
                showToast('✅ Payment request sent to admin!', 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
            document.getElementById('confirmModal').classList.remove('open');
            pendingPayReminderOriginalIndex = null;
        });

        document.getElementById('confirmCancelBtn').addEventListener('click', function() {
            document.getElementById('confirmModal').classList.remove('open');
            pendingPayReminderOriginalIndex = null;
        });
        document.getElementById('confirmModal').addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('open');
                pendingPayReminderOriginalIndex = null;
            }
        });

        // ─── MENU BADGES ───
        function updateMenuBadges() {
            // Badges already updated in individual render functions
        }

        // ─── SIDEBAR NAV ───
        function openSidebar() {
            document.getElementById('sidebar').classList.add('open');
            document.getElementById('sidebarOverlay').classList.add('open');
        }
        function closeSidebar() {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('open');
        }
        document.getElementById('hamburgerBtn').addEventListener('click', openSidebar);
        document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
        document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
        document.querySelectorAll('.menu-item[data-page]').forEach(item => {
            item.addEventListener('click', function() {
                const pageId = this.dataset.page;
                navigateTo(pageId);
            });
        });

        // ─── NAVIGATION ───
        function navigateTo(pageId) {
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');
            document.querySelectorAll('.menu-item[data-page]').forEach(m => m.classList.remove('active'));
            const menuItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
            if (menuItem) menuItem.classList.add('active');
            closeSidebar();
            if (pageId === 'page-syllabus') renderSyllabus();
            if (pageId === 'page-reminders') renderReminders();
            if (pageId === 'page-reminder-history') renderReminderHistory();
            if (pageId === 'page-attendance-history') renderAttendanceHistory();
            if (pageId === 'page-course') renderCourseVideos();
        }
        window.navigateTo = navigateTo;

        // ─── LOGIN UI ───
        document.getElementById('loginBtn').addEventListener('click', () => {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value.trim();
            if (!username || !password) { document.getElementById('loginError').textContent = '⚠️ Please fill both fields.'; return; }
            loginStudent(username, password);
        });
        document.getElementById('loginPassword').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });
        document.getElementById('loginUsername').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });
        document.getElementById('dashLogoutBtn').addEventListener('click', logoutStudent);
        document.getElementById('sidebarLogout').addEventListener('click', logoutStudent);

        // ─── INIT ───
        checkSession();
        console.log('🎓 Student Panel v3.0 loaded - All bugs fixed.');
    