const API = window.location.origin;
const TOKEN = localStorage.getItem('token');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const ROLE_ROUTES = { student: '/student/dashboard', teacher: '/teacher/dashboard', parent: '/parent/dashboard', admin: '/admin/dashboard' };

if (!TOKEN) window.location.href = '/login';

const RING_COLORS = {
    excellent: { color: '#0A5902', progress: 1 },
    good: { color: '#A2FF00', progress: 0.72 },
    warning: { color: '#FFA600', progress: 0.52 },
    low: { color: '#DB0505', progress: 0.36 },
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMark(value) {
    if (value == null || Number.isNaN(Number(value))) return '-';
    const rounded = Number(value).toFixed(2);
    return rounded.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function getRingMeta(average) {
    if (average >= 4.6) return RING_COLORS.excellent;
    if (average >= 3.8) return RING_COLORS.good;
    if (average >= 3) return RING_COLORS.warning;
    return RING_COLORS.low;
}

function getAiTip(summary) {
    if (!summary.best_subjects.length) {
        return 'Пока оценок нет. Когда появятся первые отметки, здесь появится анализ сильных и слабых предметов.';
    }

    const best = summary.best_subjects[0];
    const weak = summary.weak_subjects[0];

    if (weak && weak.average < 4) {
        return `Сильнее всего сейчас идут ${best.subject} (${formatMark(best.average)}). Стоит подтянуть ${weak.subject}: удели ему 20-30 минут в день и начни с последних тем.`;
    }

    if ((summary.overall_average ?? 0) >= 4.5) {
        return `У тебя очень сильный средний балл ${formatMark(summary.overall_average)}. Держи темп и используй ${best.subject} как опору для стабильного результата по всем предметам.`;
    }

    return `Лучше всего сейчас выглядит ${best.subject} (${formatMark(best.average)}). Сохрани этот темп и попробуй выровнять остальные предметы до уровня не ниже 4.`;
}

function renderSubjectRing(subject, average) {
    const meta = getRingMeta(average);
    const name = escapeHtml(subject);
    const value = escapeHtml(formatMark(average));
    const progressPercent = Math.round(meta.progress * 100);

    return `
        <article class="subject-ring-card card-progress">
            <div class="progress-ring-wrap subject-progress-ring-wrap" data-progress="${meta.progress}" data-color="${meta.color}">
                <svg viewBox="0 0 200 200">
                    <circle class="progress-ring-bg" cx="100" cy="100" r="82"></circle>
                    <circle class="progress-ring-fill subject-progress-ring-fill" cx="100" cy="100" r="82"></circle>
                </svg>
                <div class="progress-center-text subject-progress-center-text">${value}</div>
                <div class="progress-dot subject-progress-dot"></div>
            </div>
            <div class="progress-label subject-name">${name}</div>
            <div class="progress-sublabel">Средний балл ${value} • ${progressPercent}%</div>
        </article>
    `;
}

function renderGrid(targetId, items) {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (!items.length) {
        target.innerHTML = `
            <article class="subject-ring-card subject-ring-card--empty">
                <div>Оценок пока нет. Как только преподаватели поставят первые отметки, здесь появится статистика.</div>
            </article>
        `;
        return;
    }

    target.innerHTML = items
        .map(item => renderSubjectRing(item.subject, item.average))
        .join('');

    positionProgressRings(target);
}

function positionProgressRings(scope = document) {
    scope.querySelectorAll('.subject-progress-ring-wrap').forEach(wrap => {
        const fill = wrap.querySelector('.subject-progress-ring-fill');
        const dot = wrap.querySelector('.subject-progress-dot');
        const progress = Number(wrap.dataset.progress || 0);
        const color = wrap.dataset.color || '#0A5902';
        const size = wrap.offsetWidth;

        if (fill) {
            const radius = 82;
            const circumference = 2 * Math.PI * radius;
            fill.style.strokeDasharray = `${circumference}`;
            fill.style.strokeDashoffset = `${circumference - progress * circumference}`;
            fill.style.stroke = color;
            fill.style.filter = `drop-shadow(0 0 8px ${color})`;
        }

        if (dot && size) {
            const dotSize = Math.max(10, size * 0.075);
            const center = size / 2;
            const radius = (82 / 200) * size;
            const angle = ((-90 + progress * 360) * Math.PI) / 180;
            const x = center + radius * Math.cos(angle) - dotSize / 2;
            const y = center + radius * Math.sin(angle) - dotSize / 2;

            dot.style.width = `${dotSize}px`;
            dot.style.height = `${dotSize}px`;
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;
        }
    });
}

function applySummary(summary) {
    const overallAverage = document.getElementById('overallAverage');
    const classRank = document.getElementById('classRank');
    const classRankHint = document.getElementById('classRankHint');
    const aiTip = document.getElementById('aiTip');

    if (overallAverage) overallAverage.textContent = formatMark(summary.overall_average);

    if (classRank) {
        classRank.textContent = summary.class_rank ? `ТОП-${summary.class_rank}` : '-';
    }

    if (classRankHint) {
        classRankHint.textContent = summary.class_rank && summary.class_size
            ? `Из ${summary.class_size} учеников`
            : 'Нет данных по классу';
    }

    if (aiTip) {
        aiTip.textContent = getAiTip(summary);
    }

    renderGrid('bestSubjectsGrid', summary.best_subjects);
}

function formatNotifTime(isoStr) {
    const date = new Date(isoStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Вчера, ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
            badge.style.display = unread.length ? 'flex' : 'none';
        }

        renderNotificationList(notifications);
    } catch (error) {
        console.error(error);
    }
}

function renderNotificationList(notifications) {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (!notifications.length) {
        list.innerHTML = '<div style="color:rgba(255,255,255,.4);text-align:center;margin-top:40px;font-size:13px;">Уведомлений нет</div>';
        return;
    }

    list.innerHTML = notifications.map(item => {
        const timeStr = formatNotifTime(item.created_at);
        const unreadDot = !item.is_read ? '<span class="notif-unread-dot"></span>' : '';
        return `
            <div class="notif-item${item.is_read ? '' : ' notif-item--unread'}" onclick="markNotifRead(${item.id}, this)">
                ${unreadDot}
                <div class="notif-author">${item.channel === 'email' ? '📧' : '🔔'} Система</div>
                <div class="notif-time">${timeStr}</div>
                <div class="notif-text" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            </div>
        `;
    }).join('');
}

async function markNotifRead(id, el) {
    try {
        await fetch(`${API}/api/notifications/${id}/read`, { method: 'POST', headers: HEADERS });
        el.classList.remove('notif-item--unread');
        const dot = el.querySelector('.notif-unread-dot');
        if (dot) dot.remove();
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

function openDetailView() {
    document.getElementById('progressOverview')?.classList.remove('progress-view--active');
    document.getElementById('progressDetail')?.classList.add('progress-view--active');
    requestAnimationFrame(() => positionProgressRings(document.getElementById('progressDetail') || document));
}

function openOverviewView() {
    document.getElementById('progressDetail')?.classList.remove('progress-view--active');
    document.getElementById('progressOverview')?.classList.add('progress-view--active');
    requestAnimationFrame(() => positionProgressRings(document.getElementById('progressOverview') || document));
}

async function init() {
    try {
        const [userRes, summaryRes, averagesRes] = await Promise.all([
            fetch(`${API}/api/users/me`, { headers: HEADERS }),
            fetch(`${API}/api/grades/my/summary`, { headers: HEADERS }),
            fetch(`${API}/api/grades/my/averages`, { headers: HEADERS }),
        ]);

        if (!userRes.ok) {
            window.location.href = '/login';
            return;
        }

        const user = await userRes.json();
        if (user.role !== 'student') {
            window.location.replace(ROLE_ROUTES[user.role] || '/login');
            return;
        }
        const summary = summaryRes.ok
            ? await summaryRes.json()
            : { overall_average: null, class_rank: null, class_size: null, best_subjects: [], weak_subjects: [] };
        const averages = averagesRes.ok ? await averagesRes.json() : [];

        const avatarEl = document.querySelector('.avatar');
        const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '');
        if (avatarEl) {
            avatarEl.textContent = initials.toUpperCase();
            avatarEl.style.backgroundImage = user.avatar_url ? `url("${user.avatar_url}")` : '';
            avatarEl.style.color = user.avatar_url ? 'transparent' : '#fff';
        }

        const streakCount = document.getElementById('streakCount');
        if (streakCount) {
            streakCount.textContent = String(averages.filter(item => Number(item.average) >= 4.5).length);
        }

        applySummary(summary);
        renderGrid('allSubjectsGrid', averages);
        loadNotifications();
        requestAnimationFrame(() => positionProgressRings(document));
    } catch (error) {
        console.error('Ошибка загрузки успеваемости:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();

    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('href') === currentPath) link.classList.add('active');
    });

    document.getElementById('openDetailButton')?.addEventListener('click', openDetailView);
    document.getElementById('backToOverviewButton')?.addEventListener('click', openOverviewView);
    window.addEventListener('resize', () => positionProgressRings(document));

    document.addEventListener('click', event => {
        const modal = document.getElementById('notifModal');
        const wrap = document.querySelector('.notif-wrap');
        if (modal && wrap && !wrap.contains(event.target)) {
            modal.style.display = 'none';
        }
    });

    document.getElementById('notifModal')?.addEventListener('click', event => event.stopPropagation());
});
