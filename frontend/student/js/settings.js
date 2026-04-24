const API = window.location.origin;
const TOKEN = localStorage.getItem('token');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const ROLE_ROUTES = {
    student: '/student/dashboard',
    teacher: '/teacher/dashboard',
    parent: '/parent/dashboard',
    admin: '/admin/dashboard',
};

if (!TOKEN) window.location.href = '/login';

let currentUser = null;

function dashboardByRole(role) {
    return ROLE_ROUTES[role] || '/student/dashboard';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setMessage(text, type = 'success') {
    const box = document.getElementById('settingsMessage');
    if (!box) return;
    box.textContent = text;
    box.className = `settings-message is-visible ${type === 'error' ? 'is-error' : 'is-success'}`;
}

function clearMessage() {
    const box = document.getElementById('settingsMessage');
    if (!box) return;
    box.textContent = '';
    box.className = 'settings-message';
}

function getInitials(user) {
    return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || '??';
}

function getRoleTitle(role) {
    return {
        student: 'Профиль ученика',
        teacher: 'Профиль учителя',
        parent: 'Профиль родителя',
        admin: 'Профиль администратора',
    }[role] || 'Профиль';
}

function updateAvatar(user) {
    const image = document.getElementById('profileAvatarImage');
    const fallback = document.getElementById('profileAvatarFallback');
    const topAvatar = document.getElementById('topAvatar');
    const initials = getInitials(user);

    if (topAvatar) {
        topAvatar.textContent = initials;
        topAvatar.style.backgroundImage = user.avatar_url ? `url("${user.avatar_url}")` : '';
        topAvatar.style.color = user.avatar_url ? 'transparent' : '#fff';
    }
    if (fallback) fallback.textContent = initials;

    if (image && user.avatar_url) {
        image.src = user.avatar_url;
        image.classList.add('is-visible');
        if (fallback) fallback.style.display = 'none';
    } else if (image) {
        image.removeAttribute('src');
        image.classList.remove('is-visible');
        if (fallback) fallback.style.display = 'flex';
    }
}

function applyRoleLayout(user) {
    const links = [...document.querySelectorAll('.sidebar .nav-item')];
    links.forEach((link) => {
        const label = link.querySelector('.nav-label');
        const href = link.getAttribute('href');
        if (!href || href === '/settings' || href === '/student/settings' || href === '/teacher/settings' || href === '/admin/settings') return;

        if (user.role === 'student') return;

        if (user.role === 'teacher') {
            if (href.startsWith('/teacher/')) return;
            if (href === '/student/dashboard') {
                link.href = '/teacher/dashboard';
                if (label) label.textContent = 'Главный экран';
            } else if (href === '/student/tasks') {
                link.href = '/teacher/assignments';
                if (label) label.textContent = 'Задания';
            } else if (href === '/student/calendar') {
                link.href = '/teacher/classes';
                if (label) label.textContent = 'Мои классы';
            } else {
                link.style.display = 'none';
            }
        } else if (user.role === 'admin') {
            if (href.startsWith('/admin/')) return;
            if (href === '/student/dashboard') {
                link.href = '/admin/dashboard';
                if (label) label.textContent = 'Админ-панель';
            } else {
                link.style.display = 'none';
            }
        } else if (user.role === 'parent') {
            if (href.startsWith('/parent/')) return;
            if (href === '/student/dashboard') {
                link.href = '/parent/dashboard';
                if (label) label.textContent = 'Главный экран';
            } else {
                link.style.display = 'none';
            }
        }
    });
}

function revealSettingsPage() {
    document.body.classList.remove('settings-loading');
    document.body.classList.add('settings-ready');
}

function fillProfile(user) {
    currentUser = user;

    const firstNameInput = document.getElementById('firstNameInput');
    const lastNameInput = document.getElementById('lastNameInput');
    const emailInput = document.getElementById('emailInput');
    const gradeStatus = document.getElementById('gradeStatus');
    const roleLabel = document.getElementById('settingsRoleLabel');
    const streakCount = document.getElementById('streakCount');
    const streakBadge = document.getElementById('settingsStreakBadge');
    const gradeCard = document.getElementById('gradeCard');

    if (firstNameInput) firstNameInput.value = user.first_name || '';
    if (lastNameInput) lastNameInput.value = user.last_name || '';
    if (emailInput) emailInput.value = user.email || '';
    if (roleLabel) roleLabel.textContent = getRoleTitle(user.role);
    if (gradeStatus) {
        gradeStatus.textContent = user.role === 'teacher'
            ? (user.teacher_subject || 'Не назначен')
            : (user.grade || 'Не выбран');
    }
    if (streakCount) streakCount.textContent = user.role === 'student' ? streakCount.textContent || '0' : '0';
    if (streakBadge) streakBadge.classList.toggle('is-hidden', user.role !== 'student');
    if (gradeCard) gradeCard.classList.toggle('is-hidden', user.role !== 'student');

    applyRoleLayout(user);
    updateAvatar(user);
    renderActionCards(user);
    renderGradeMenu();
    revealSettingsPage();
}

function renderActionCards(user) {
    const yandexStatus = document.getElementById('yandexStatus');
    const yandexBtn = document.getElementById('yandexBtn');
    const parentCard = document.getElementById('parentCard');
    const parentTitle = document.getElementById('parentCardTitle');
    const parentStatus = document.getElementById('parentStatus');
    const parentBtn = document.getElementById('parentBtn');
    const gradeTitle = document.querySelector('.settings-mini-icon--class')?.parentElement?.querySelector('.settings-mini-title');
    const gradeBtn = document.getElementById('gradeBtn');

    if (yandexStatus) yandexStatus.textContent = user.yandex_id ? 'Подключён' : 'Не подключён';
    if (yandexBtn) {
        yandexBtn.textContent = user.yandex_id ? 'Подключено' : 'Подключить';
        yandexBtn.classList.toggle('is-connected', Boolean(user.yandex_id));
    }

    if (parentCard && parentTitle && parentStatus && parentBtn) {
        if (user.role === 'student') {
            parentCard.style.display = 'flex';
            parentTitle.textContent = 'Добавить родителя';
            parentStatus.textContent = 'Сгенерировать код';
            parentBtn.textContent = 'Добавить';
        } else if (user.role === 'parent') {
            parentCard.style.display = 'flex';
            parentTitle.textContent = 'Привязать ученика';
            parentStatus.textContent = 'Ввести код ученика';
            parentBtn.textContent = 'Указать код';
        } else {
            parentCard.style.display = 'none';
        }
    }

    if (gradeTitle) {
        gradeTitle.textContent = user.role === 'teacher' ? 'Предмет' : 'Класс';
    }

    if (gradeBtn) {
        if (user.role === 'student') {
            gradeBtn.disabled = false;
            gradeBtn.textContent = 'Ввести код';
        } else {
            gradeBtn.disabled = true;
            gradeBtn.textContent = 'Недоступно';
        }
    }
}

function renderGradeMenu() {
    const menu = document.getElementById('gradeMenu');
    if (!menu) return;

    if (currentUser?.role !== 'student') {
        menu.innerHTML = '';
        return;
    }

    menu.innerHTML = `
        <button class="settings-class-option" type="button" onclick="promptClassInvite()">
            Ввести инвайт-код класса
        </button>
    `;
}

function toggleGradeMenu() {
    if (currentUser?.role !== 'student') return;
    const menu = document.getElementById('gradeMenu');
    if (!menu) return;
    menu.classList.toggle('is-open');
}

function closeGradeMenu() {
    document.getElementById('gradeMenu')?.classList.remove('is-open');
}

async function loadNotifications() {
    try {
        const res = await fetch(`${API}/api/notifications`, { headers: HEADERS });
        if (!res.ok) return;
        const notifications = await res.json();
        const unread = notifications.filter(item => !item.is_read);
        const badge = document.getElementById('notifCounter');

        if (badge) {
            badge.textContent = unread.length > 99 ? '99+' : unread.length;
            badge.style.display = unread.length > 0 ? 'flex' : 'none';
        }

        renderNotificationList(notifications);
    } catch (error) {
        console.error(error);
    }
}

function formatNotifTime(isoStr) {
    const date = new Date(isoStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Вчера, ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderNotificationList(notifications) {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (!notifications.length) {
        list.innerHTML = '<div style="color:rgba(255,255,255,.4);text-align:center;margin-top:40px;font-size:13px;">Уведомлений нет</div>';
        return;
    }

    list.innerHTML = notifications.map(notification => {
        const title = notification.title.length > 32 ? notification.title.slice(0, 32) + '…' : notification.title;
        return `
            <div class="notif-item${notification.is_read ? '' : ' notif-item--unread'}" onclick="markNotifRead(${notification.id}, this)">
                ${notification.is_read ? '' : '<span class="notif-unread-dot"></span>'}
                <div class="notif-author">Система</div>
                <div class="notif-time">${formatNotifTime(notification.created_at)}</div>
                <div class="notif-text" title="${escapeHtml(notification.title)}">${escapeHtml(title)}</div>
            </div>
        `;
    }).join('');
}

async function markNotifRead(id, el) {
    try {
        await fetch(`${API}/api/notifications/${id}/read`, { method: 'POST', headers: HEADERS });
        if (el) {
            el.classList.remove('notif-item--unread');
            const dot = el.querySelector('.notif-unread-dot');
            if (dot) dot.remove();
        }
        loadNotifications();
    } catch (error) {
        console.error(error);
    }
}

function toggleNotifications(event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('notifModal');
    if (!modal) return;
    const isOpen = modal.style.display === 'flex';
    modal.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) loadNotifications();
}

function goBack() {
    if (document.referrer && document.referrer.startsWith(window.location.origin)) {
        window.history.back();
        return;
    }
    window.location.href = dashboardByRole(currentUser?.role);
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    localStorage.removeItem('first_name');
    window.location.href = '/login';
}

async function saveProfile() {
    clearMessage();
    const body = {
        first_name: document.getElementById('firstNameInput')?.value.trim() || null,
        last_name: document.getElementById('lastNameInput')?.value.trim() || null,
    };

    try {
        const res = await fetch(`${API}/api/users/me`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Не удалось сохранить профиль');
        fillProfile(data);
        setMessage('Профиль сохранён.');
    } catch (error) {
        setMessage(error.message || 'Ошибка сохранения профиля.', 'error');
    }
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        image.src = dataUrl;
    });
}

async function resizeAvatarToDataUrl(file) {
    if (file.size > 5 * 1024 * 1024) {
        throw new Error('Фотография слишком большая. Максимум 5 МБ.');
    }

    const fileDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
    });

    const image = await loadImageFromDataUrl(fileDataUrl);
    if (image.width < 100 || image.height < 100) {
        throw new Error('Минимальный размер фотографии 100x100.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    const size = Math.min(image.width, image.height);
    const sx = (image.width - size) / 2;
    const sy = (image.height - size) / 2;
    ctx.drawImage(image, sx, sy, size, size, 0, 0, 100, 100);
    return canvas.toDataURL('image/jpeg', 0.9);
}

async function uploadAvatar(file) {
    if (!file) return;
    clearMessage();
    try {
        const avatarDataUrl = await resizeAvatarToDataUrl(file);
        const res = await fetch(`${API}/api/users/me`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify({ avatar_url: avatarDataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Не удалось обновить аватар');
        fillProfile(data);
        setMessage('Аватар обновлён.');
    } catch (error) {
        setMessage(error.message || 'Ошибка обновления аватара.', 'error');
    }
}

async function promptClassInvite() {
    if (currentUser?.role !== 'student') return;
    closeGradeMenu();
    clearMessage();

    const inviteCode = window.prompt('Введите инвайт-код класса');
    if (!inviteCode) return;

    try {
        const res = await fetch(`${API}/api/classes/join?invite_code=${encodeURIComponent(inviteCode.trim())}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Не удалось вступить в класс');

        const profileRes = await fetch(`${API}/api/users/me`, { headers: HEADERS });
        const profile = await profileRes.json();
        fillProfile(profile);
        setMessage(data.message || 'Класс подключен.');
    } catch (error) {
        setMessage(error.message || 'Ошибка подключения класса.', 'error');
    }
}

async function handleParentAction() {
    clearMessage();
    try {
        if (currentUser?.role === 'student') {
            const res = await fetch(`${API}/api/users/me/parent-link-token`, {
                method: 'POST',
                headers: HEADERS,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Не удалось создать код');
            document.getElementById('parentStatus').textContent = `Код: ${data.code}`;
            setMessage(`Код для родителя: ${data.code}`);
            return;
        }

        if (currentUser?.role === 'parent') {
            const code = window.prompt('Введите код ученика');
            if (!code) return;
            const res = await fetch(`${API}/api/users/me/link-parent?code=${encodeURIComponent(code)}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${TOKEN}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Не удалось привязать ученика');
            document.getElementById('parentStatus').textContent = data.student_name || 'Ученик привязан';
            setMessage(data.message || 'Ученик привязан.');
        }
    } catch (error) {
        setMessage(error.message || 'Ошибка действия.', 'error');
    }
}

async function init() {
    try {
        const profileRes = await fetch(`${API}/api/users/me`, { headers: HEADERS });
        if (!profileRes.ok) {
            window.location.href = '/login';
            return;
        }

        const profile = await profileRes.json();

        if (window.location.pathname.startsWith('/student/') && profile.role !== 'student') {
            window.location.replace(dashboardByRole(profile.role));
            return;
        }

        fillProfile(profile);

        if (profile.role === 'student') {
            const tasksRes = await fetch(`${API}/api/tasks`, { headers: HEADERS });
            const tasks = tasksRes.ok ? await tasksRes.json() : [];
            const streakCount = document.getElementById('streakCount');
            if (streakCount) {
                streakCount.textContent = String(tasks.filter(task => task.status === 'in_progress').length);
            }
        }

        loadNotifications();

        if (window.location.search.includes('event=yandex_linked')) {
            setMessage('Яндекс успешно подключён.');
        }
    } catch (error) {
        console.error(error);
        revealSettingsPage();
        setMessage('Не удалось загрузить настройки.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();

    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('href') === currentPath) link.classList.add('active');
    });

    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
    document.getElementById('gradeBtn')?.addEventListener('click', toggleGradeMenu);
    document.getElementById('changeEmailBtn')?.addEventListener('click', () => window.location.href = '/settings/change-email');
    document.getElementById('changeEmailIconBtn')?.addEventListener('click', () => window.location.href = '/settings/change-email');
    document.getElementById('changePasswordBtn')?.addEventListener('click', () => window.location.href = '/settings/change-password');
    document.getElementById('changeAvatarBtn')?.addEventListener('click', () => document.getElementById('avatarInput')?.click());
    document.getElementById('changeAvatarWideBtn')?.addEventListener('click', () => document.getElementById('avatarInput')?.click());
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    document.getElementById('avatarInput')?.addEventListener('change', event => uploadAvatar(event.target.files?.[0]));
    document.getElementById('parentBtn')?.addEventListener('click', handleParentAction);
    document.getElementById('yandexBtn')?.addEventListener('click', () => {
        if (currentUser?.yandex_id) return;
        window.location.href = `/api/auth/yandex/link?token=${encodeURIComponent(TOKEN)}`;
    });

    document.addEventListener('click', event => {
        const modal = document.getElementById('notifModal');
        const wrap = document.querySelector('.notif-wrap');
        if (modal && wrap && !wrap.contains(event.target)) modal.style.display = 'none';

        const gradeCard = document.getElementById('gradeBtn')?.closest('.settings-mini-card');
        if (gradeCard && !gradeCard.contains(event.target)) closeGradeMenu();
    });
});

window.goBack = goBack;
window.toggleNotifications = toggleNotifications;
window.markNotifRead = markNotifRead;
window.promptClassInvite = promptClassInvite;
