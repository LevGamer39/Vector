const API = window.location.origin;
const TOKEN = localStorage.getItem('token');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

if (!TOKEN) window.location.href = '/login';

const COLOR_MAP = { critical: 'red', high: 'red', medium: 'yellow', low: 'green' };
const LABEL_MAP = { critical: 'Критично', high: 'Критично', medium: 'Важно', low: 'Обычное' };

const STATUS_LABEL = {
    pending: 'Не начато',
    in_progress: 'В работе',
    done: 'Завершено',
    overdue: 'Просрочено',
};

const STATUS_DOT = {
    pending: '#9ca3af',
    in_progress: '#FFC96B',
    done: '#83FFB7',
    overdue: '#ff6b6b',
};

const PRIORITY_VIEW = {
    low: { index: 0, label: 'Обычный', className: 'green' },
    medium: { index: 1, label: 'Важный', className: 'yellow' },
    high: { index: 2, label: 'Критичный', className: 'red' },
    critical: { index: 2, label: 'Критичный', className: 'red' },
};

let allTasks = [];
let selectedId = null;
let filterStatus = 'all';
let statusMenuTaskId = null;
let statusMenuAnchor = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDeadline(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const isToday = d.toDateString() === now.toDateString();
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return `Сегодня, ${time}`;
    if (isTomorrow) return `Завтра, ${time}`;

    const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dayName = weekdays[d.getDay()];
    const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const diffDays = Math.round((d - now) / 86400000);

    if (diffDays > 0 && diffDays < 7) return `${dayName}, ${time}`;
    return `${dateStr}, ${time}`;
}

function formatFullDateTime(iso) {
    if (!iso) return 'Не указано';
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatNotifTime(isoStr) {
    const date = new Date(isoStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Вчера, ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getSelectedTask() {
    return allTasks.find(task => task.id === selectedId) || null;
}

function getPriorityView(priority) {
    return PRIORITY_VIEW[priority] || PRIORITY_VIEW.low;
}

function renderPriorityDots(priority) {
    const current = getPriorityView(priority);
    const dots = [
        { className: 'green', title: 'Обычный' },
        { className: 'yellow', title: 'Важный' },
        { className: 'red', title: 'Критичный' },
    ];

    return `
        <div class="detail-priority-selector" aria-label="Приоритет задачи">
            ${dots
                .map((dot, index) => `
                    <span
                        class="priority-dot ${dot.className}${index === current.index ? ' active' : ''}"
                        title="${dot.title}"
                        aria-hidden="true"
                    ></span>
                `)
                .join('')}
        </div>
    `;
}

async function init() {
    try {
        const [userRes, taskRes] = await Promise.all([
            fetch(`${API}/api/users/me`, { headers: HEADERS }),
            fetch(`${API}/api/tasks`, { headers: HEADERS }),
        ]);

        if (!userRes.ok) {
            window.location.href = '/login';
            return;
        }

        const user = await userRes.json();
        allTasks = await taskRes.json();

        const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '');
        const avatarEl = document.querySelector('.avatar');
        if (avatarEl) {
            avatarEl.textContent = initials.toUpperCase();
            avatarEl.style.backgroundImage = user.avatar_url ? `url("${user.avatar_url}")` : '';
            avatarEl.style.color = user.avatar_url ? 'transparent' : '#fff';
        }

        renderList();
        loadNotifications();
    } catch (err) {
        console.error('Ошибка инициализации:', err);
    }
}

function renderList() {
    const container = document.getElementById('tasksList');
    if (!container) return;

    let tasks = allTasks.filter(task => !task.parent_task_id);
    if (filterStatus !== 'all') tasks = tasks.filter(task => task.status === filterStatus);

    tasks.sort((a, b) => {
        const aOver = a.status === 'overdue' ? 0 : 1;
        const bOver = b.status === 'overdue' ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
    });

    if (!tasks.length) {
        container.innerHTML = `
            <div class="tasks-empty">
                <div class="tasks-empty-icon">🎉</div>
                <div class="tasks-empty-text">Задач нет</div>
                <div class="tasks-empty-sub">Все дела выполнены или добавь новые</div>
            </div>
        `;
        closeDetail();
        return;
    }

    container.innerHTML = tasks.map(buildTaskRow).join('');

    if (selectedId) {
        const row = container.querySelector(`[data-id="${selectedId}"]`);
        if (row) row.classList.add('task-row--active');
    }
}

function buildTaskRow(task) {
    const color = COLOR_MAP[task.priority] || 'green';
    const label = LABEL_MAP[task.priority] || 'Обычное';
    const deadline = formatDeadline(task.deadline);
    const dotColor = STATUS_DOT[task.status] || '#9ca3af';
    const statusLabel = STATUS_LABEL[task.status] || 'Не начато';
    const isActive = task.id === selectedId ? ' task-row--active' : '';
    const isDone = task.status === 'done' ? ' task-row--done' : '';

    return `
        <div class="task-row${isActive}${isDone}" data-id="${task.id}" onclick="selectTask(${task.id})">
            <div class="task-row-stripe ${color}"></div>
            <div class="task-row-body">
                <span class="task-row-badge ${color}">${label}</span>
                <div class="task-row-title">${escapeHtml(task.title)}</div>
                <div class="task-row-time">
                    <svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="flex-shrink:0">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"></circle>
                        <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                    </svg>
                    ${deadline}
                </div>
            </div>
            <div class="task-row-status">
                <span class="task-row-dot" style="background:${dotColor}"></span>
                <span class="task-row-status-label">${statusLabel}</span>
            </div>
        </div>
    `;
}

function selectTask(id) {
    selectedId = id;

    document.querySelectorAll('.task-row').forEach(row => row.classList.remove('task-row--active'));
    const row = document.querySelector(`[data-id="${id}"]`);
    if (row) row.classList.add('task-row--active');

    const task = getSelectedTask();
    if (!task) return;

    openDetail(task);
}

function buildMetaCards(task) {
    const statusLabel = STATUS_LABEL[task.status] || 'Не начато';
    const priority = getPriorityView(task.priority);

    const cards = [
        { label: 'Время', value: formatFullDateTime(task.deadline), accent: '' },
        { label: 'Статус', value: statusLabel, accent: 'status' },
        { label: 'Приоритет', value: priority.label, accent: priority.className },
    ];

    if (task.ai_suggested_time) {
        cards.push({ label: 'Совет ИИ', value: task.ai_suggested_time, accent: 'ai' });
    }

    if (task.subject) {
        cards.push({ label: 'Предмет', value: task.subject, accent: '' });
    }

    if (task.created_at) {
        cards.push({ label: 'Создано', value: formatFullDateTime(task.created_at), accent: '' });
    }

    if (task.completed_at) {
        cards.push({ label: 'Завершено', value: formatFullDateTime(task.completed_at), accent: 'done' });
    }

    return cards
        .map(card => `
            <div class="detail-info-card${card.accent ? ` detail-info-card--${card.accent}` : ''}">
                <div class="detail-info-label">${card.label}</div>
                <div class="detail-info-value">${escapeHtml(card.value)}</div>
            </div>
        `)
        .join('');
}

function buildActionButtons(task) {
    const actions = [];

    if (task.status !== 'in_progress' && task.status !== 'done') {
        actions.push(`
            <button class="detail-action-btn detail-action-primary" onclick="updateTaskStatus('in_progress')">
                Взять в работу
            </button>
        `);
    }

    if (task.status !== 'done') {
        actions.push(`
            <button
                class="detail-action-btn detail-action-secondary"
                onclick="changeStatus(${task.id}, this, event)"
            >
                Изменить статус
            </button>
        `);

        actions.push(`
            <button
                class="detail-action-btn detail-action-ai"
                onclick="generateSubtasks(${task.id}, this)"
            >
                Разбить на подзадачи
            </button>
        `);
    } else {
        actions.push(`
            <button class="detail-action-btn detail-action-done" disabled>
                Выполнено
            </button>
        `);
    }

    if (task.is_personal) {
        actions.push(`
            <button class="detail-action-btn detail-action-danger" onclick="deleteTask(${task.id})">
                Удалить задачу
            </button>
        `);
    }

    return actions.join('');
}

function openDetail(task) {
    const panel = document.getElementById('detailPanel');
    if (!panel) return;

    const statusLabel = STATUS_LABEL[task.status] || 'Не начато';
    const statusDot = STATUS_DOT[task.status] || '#9ca3af';
    const noteText = task.description?.trim() || 'Заметок пока нет';
    const subjectText = task.subject ? `<span class="detail-subject-pill">${escapeHtml(task.subject)}</span>` : '';

    panel.innerHTML = `
        <div class="detail-card">
            <div class="detail-topbar">
                <div class="detail-priority-wrap">
                    ${renderPriorityDots(task.priority)}
                    <span class="detail-priority-label">${escapeHtml(getPriorityView(task.priority).label)}</span>
                </div>
                <button class="detail-edit-btn" onclick="editTask(${task.id})" title="Редактировать">
                    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                    </svg>
                </button>
            </div>

            <div class="detail-title-block">
                ${subjectText}
                <div class="detail-title">${escapeHtml(task.title)}</div>
                <div class="detail-status-inline">
                    <span class="detail-status-dot" style="background:${statusDot}"></span>
                    <span>${statusLabel}</span>
                </div>
            </div>

            <div class="detail-info-grid">
                ${buildMetaCards(task)}
            </div>

            <div class="detail-notes-block">
                <div class="detail-section-label">Заметки</div>
                <div class="detail-notes-modern">${escapeHtml(noteText)}</div>
            </div>

            <div class="detail-actions modern-actions">
                ${buildActionButtons(task)}
            </div>

            <div id="subtasksList" class="detail-subtasks"></div>
        </div>
    `;

    panel.classList.add('detail-panel--open');
    statusMenuTaskId = task.id;
    statusMenuAnchor = null;

    loadSubtasks(task.id);
}

function closeDetail() {
    selectedId = null;
    statusMenuTaskId = null;
    statusMenuAnchor = null;

    const panel = document.getElementById('detailPanel');
    if (panel) {
        panel.classList.remove('detail-panel--open');
        panel.innerHTML = '';
    }

    document.querySelectorAll('.task-row').forEach(row => row.classList.remove('task-row--active'));
}

async function loadSubtasks(taskId) {
    try {
        const res = await fetch(`${API}/api/tasks/${taskId}/subtasks`, { headers: HEADERS });
        if (!res.ok) return;
        const subtasks = await res.json();
        renderSubtasks(subtasks);
    } catch (error) {
        console.error(error);
    }
}

function renderSubtasks(subtasks) {
    const el = document.getElementById('subtasksList');
    if (!el) return;

    if (!subtasks.length) {
        el.innerHTML = `
            <div class="detail-subtasks-head">
                <div class="detail-section-label">Подзадачи</div>
                <div class="detail-subtasks-count">Пока пусто</div>
            </div>
        `;
        return;
    }

    el.innerHTML = `
        <div class="detail-subtasks-head">
            <div class="detail-section-label">Подзадачи</div>
            <div class="detail-subtasks-count">${subtasks.length}</div>
        </div>
        <div class="detail-subtasks-list">
            ${subtasks
                .map(
                    subtask => `
                        <div
                            class="detail-subtask-item ${subtask.status === 'done' ? 'subtask--done' : ''}"
                            onclick="toggleSubtask(${subtask.id})"
                        >
                            <span class="subtask-checkbox ${subtask.status === 'done' ? 'subtask-checkbox--checked' : ''}">
                                ${subtask.status === 'done' ? '✓' : ''}
                            </span>
                            <span class="subtask-title">${escapeHtml(subtask.title)}</span>
                        </div>
                    `
                )
                .join('')}
        </div>
    `;
}

async function toggleSubtask(id) {
    try {
        await fetch(`${API}/api/tasks/${id}/complete`, { method: 'POST', headers: HEADERS });

        const selectedTask = getSelectedTask();
        if (selectedTask) await loadSubtasks(selectedTask.id);
    } catch (error) {
        console.error(error);
    }
}

function changeStatus(taskId, anchorEl, event) {
    if (event) event.stopPropagation();
    statusMenuTaskId = taskId;
    statusMenuAnchor = anchorEl || null;

    const menu = document.getElementById('statusMenu');
    if (!menu) return;

    const isAlreadyOpen = menu.style.display === 'flex' && statusMenuTaskId === taskId;
    if (isAlreadyOpen) {
        closeStatusMenu();
        return;
    }

    const target = anchorEl || document.querySelector('.detail-action-primary') || document.querySelector('.detail-status-inline');
    if (target) {
        const rect = target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 8 + window.scrollY}px`;
        menu.style.left = `${rect.left + window.scrollX}px`;
    }

    menu.style.display = 'flex';
}

function closeStatusMenu() {
    const menu = document.getElementById('statusMenu');
    if (menu) menu.style.display = 'none';
}

async function updateTaskStatus(newStatus) {
    closeStatusMenu();
    if (!statusMenuTaskId) return;

    const apiStatus = { todo: 'pending', in_progress: 'in_progress', done: 'done' }[newStatus] || newStatus;

    try {
        const res = await fetch(`${API}/api/tasks/${statusMenuTaskId}`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify({ status: apiStatus }),
        });
        if (!res.ok) return;

        const updated = await res.json();
        const index = allTasks.findIndex(task => task.id === statusMenuTaskId);
        if (index !== -1) allTasks[index] = updated;

        renderList();
        if (selectedId === statusMenuTaskId) openDetail(updated);
    } catch (error) {
        console.error(error);
    }
}

async function deleteTask(id) {
    if (!confirm('Удалить задачу?')) return;

    try {
        const res = await fetch(`${API}/api/tasks/${id}`, { method: 'DELETE', headers: HEADERS });
        if (res.ok || res.status === 204) {
            allTasks = allTasks.filter(task => task.id !== id);
            closeDetail();
            renderList();
        }
    } catch (error) {
        console.error(error);
    }
}

function editTask(id) {
    const task = allTasks.find(item => item.id === id);
    if (!task) return;

    const panel = document.getElementById('detailPanel');
    if (!panel) return;

    const deadlineVal = task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : '';

    panel.innerHTML = `
        <div class="detail-card">
            <div class="detail-header">
                <div class="detail-title" style="font-size:20px">Редактировать</div>
            </div>
            <div class="edit-form">
                <label class="edit-label">Название</label>
                <input class="edit-input" id="editTitle" value="${escapeHtml(task.title)}">

                <label class="edit-label">Предмет</label>
                <input class="edit-input" id="editSubject" value="${escapeHtml(task.subject || '')}">

                <label class="edit-label">Дедлайн</label>
                <input class="edit-input" type="datetime-local" id="editDeadline" value="${deadlineVal}">

                <label class="edit-label">Приоритет</label>
                <select class="edit-input edit-select" id="editPriority">
                    <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Обычное</option>
                    <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Важно</option>
                    <option value="high" ${task.priority === 'high' ? 'selected' : ''}>Критично</option>
                    <option value="critical" ${task.priority === 'critical' ? 'selected' : ''}>Критично (макс)</option>
                </select>

                <label class="edit-label">Заметки</label>
                <textarea class="edit-input edit-textarea" id="editDesc">${escapeHtml(task.description || '')}</textarea>

                <div class="edit-btns">
                    <button class="detail-action-btn detail-action-primary" onclick="saveEdit(${task.id})">Сохранить</button>
                    <button class="detail-action-btn detail-action-secondary" onclick="selectTask(${task.id})">Отмена</button>
                </div>
            </div>
        </div>
    `;
}

async function saveEdit(id) {
    const title = document.getElementById('editTitle')?.value.trim();
    const subject = document.getElementById('editSubject')?.value.trim();
    const deadline = document.getElementById('editDeadline')?.value;
    const priority = document.getElementById('editPriority')?.value;
    const desc = document.getElementById('editDesc')?.value.trim();

    if (!title) {
        alert('Название не может быть пустым');
        return;
    }

    try {
        const body = { title, priority, subject: subject || null, deadline: deadline ? new Date(deadline).toISOString() : null, description: desc || null };

        const res = await fetch(`${API}/api/tasks/${id}`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify(body),
        });
        if (!res.ok) return;

        const updated = await res.json();
        const index = allTasks.findIndex(task => task.id === id);
        if (index !== -1) allTasks[index] = updated;

        renderList();
        selectTask(id);
    } catch (error) {
        console.error(error);
    }
}

async function generateSubtasks(taskId, buttonEl) {
    const btn = buttonEl || document.querySelector('.detail-action-ai');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Генерирую...';
    }

    try {
        const res = await fetch(`${API}/api/ai/subtasks/${taskId}`, {
            method: 'POST',
            headers: HEADERS,
        });

        if (!res.ok) throw new Error('AI error');

        const data = await res.json();
        await loadSubtasks(taskId);

        if (btn) {
            btn.disabled = false;
            btn.textContent = `Готово (${data.created})`;
        }
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Разбить на подзадачи';
        }
        alert('ИИ временно недоступен. Попробуй позже.');
        console.error(error);
    }
}

function setFilter(status) {
    filterStatus = status;
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('filter-tab--active'));
    const activeTab = document.querySelector(`[data-filter="${status}"]`);
    if (activeTab) activeTab.classList.add('filter-tab--active');
    closeDetail();
    renderList();
}

async function loadNotifications() {
    try {
        const res = await fetch(`${API}/api/notifications`, { headers: HEADERS });
        if (!res.ok) return;

        const notifications = await res.json();
        const unread = notifications.filter(notification => !notification.is_read);
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

function renderNotificationList(notifications) {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (!notifications.length) {
        list.innerHTML = '<div style="color:rgba(255,255,255,.4);text-align:center;margin-top:40px;font-size:13px;">Уведомлений нет</div>';
        return;
    }

    list.innerHTML = notifications
        .map(notification => {
            const timeStr = formatNotifTime(notification.created_at);
            const title = notification.title.length > 32 ? notification.title.slice(0, 32) + '…' : notification.title;
            const unreadDot = !notification.is_read ? '<span class="notif-unread-dot"></span>' : '';

            return `
                <div class="notif-item${notification.is_read ? '' : ' notif-item--unread'}" onclick="markNotifRead(${notification.id}, this)">
                    ${unreadDot}
                    <div class="notif-author">${notification.channel === 'email' ? '📧' : '🔔'} Система</div>
                    <div class="notif-time">${timeStr}</div>
                    <div class="notif-text" title="${escapeHtml(notification.title)}">${escapeHtml(title)}</div>
                </div>
            `;
        })
        .join('');
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

document.addEventListener('DOMContentLoaded', () => {
    init();

    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('href') === currentPath) link.classList.add('active');
    });

    document.addEventListener('click', event => {
        const modal = document.getElementById('notifModal');
        const wrap = document.querySelector('.notif-wrap');
        if (modal && wrap && !wrap.contains(event.target)) modal.style.display = 'none';
    });

    const modal = document.getElementById('notifModal');
    if (modal) modal.addEventListener('click', event => event.stopPropagation());

    document.addEventListener('click', event => {
        const menu = document.getElementById('statusMenu');
        if (menu && !menu.contains(event.target)) menu.style.display = 'none';
    });
});
