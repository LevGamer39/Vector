const API = window.location.origin;
const TOKEN = localStorage.getItem('token');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const ROLE_ROUTES = { student: '/student/dashboard', teacher: '/teacher/dashboard', parent: '/parent/dashboard', admin: '/admin/dashboard' };

if (!TOKEN) window.location.href = '/login';

const MONTHS = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
];

const PRIORITY_ACCENT = {
    low: 'green',
    medium: 'yellow',
    high: 'red',
    critical: 'red',
    holiday: 'flag',
};

const PRIORITY_LABEL = {
    low: 'обычное',
    medium: 'важное',
    high: 'критически важное',
    critical: 'критически важное',
    holiday: 'государственный праздник',
};

const HOLIDAYS = {
    '2026-05-01': [
        {
            id: 'holiday-2026-05-01',
            title: 'День Весны\nи Труда (1 мая)',
            shortTitle: 'День Весны...',
            description: 'Официальный государственный праздник в Российской Федерации, нерабочий день',
            notes: '',
            priority: 'holiday',
            startLabel: '—',
            isHoliday: true,
        },
    ],
    '2026-05-09': [
        {
            id: 'holiday-2026-05-09',
            title: 'День Победы',
            shortTitle: 'День Победы',
            description: 'Памятная дата и официальный нерабочий день',
            notes: '',
            priority: 'holiday',
            startLabel: '—',
            isHoliday: true,
        },
    ],
};

let allTasks = [];
let currentMonthDate = new Date();
let selectedDateKey = '';
let selectedEventIndex = 0;
let detailMode = 'closed';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateInputValue(dateKey) {
    return `${dateKey}T12:00`;
}

function formatWeekNumber(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
    return 1 + Math.round((target - firstThursday) / 604800000);
}

function formatTimeRange(task) {
    if (!task.deadline) return '—';
    const start = new Date(task.deadline);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return `${start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function buildCalendarEvents() {
    const mapped = {};

    allTasks.forEach(task => {
        if (!task.deadline || task.parent_task_id) return;
        const date = new Date(task.deadline);
        const key = formatDateKey(date);
        if (!mapped[key]) mapped[key] = [];

        mapped[key].push({
            id: `task-${task.id}`,
            taskId: task.id,
            title: task.title,
            shortTitle: task.title,
            description: task.subject || '',
            notes: task.description || '',
            priority: task.priority || 'low',
            startLabel: formatTimeRange(task),
            isHoliday: false,
            rawTask: task,
        });
    });

    Object.entries(HOLIDAYS).forEach(([key, events]) => {
        if (!mapped[key]) mapped[key] = [];
        mapped[key].push(...events);
    });

    Object.values(mapped).forEach(events => {
        events.sort((a, b) => {
            if (a.isHoliday && !b.isHoliday) return 1;
            if (!a.isHoliday && b.isHoliday) return -1;
            return 0;
        });
    });

    return mapped;
}

function getMonthContext() {
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startDay = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startDay);
    return { year, month, gridStart };
}

function getEventsForDate(dateKey) {
    const eventsMap = buildCalendarEvents();
    return eventsMap[dateKey] || [];
}

function getSelectedEvent() {
    const events = getEventsForDate(selectedDateKey);
    return events[selectedEventIndex] || null;
}

function updateMonthHeader() {
    const currentMonthLabel = document.getElementById('currentMonthLabel');
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    if (!currentMonthLabel || !prevMonthBtn || !nextMonthBtn) return;

    const prev = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);
    const next = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1);

    currentMonthLabel.textContent = `${MONTHS[currentMonthDate.getMonth()]} ${currentMonthDate.getFullYear()}`;
    prevMonthBtn.textContent = MONTHS[prev.getMonth()];
    nextMonthBtn.textContent = MONTHS[next.getMonth()];
}

function renderCalendar() {
    updateMonthHeader();

    const grid = document.getElementById('calendarGrid');
    const weeks = document.getElementById('calendarWeeks');
    if (!grid || !weeks) return;

    const { month, gridStart } = getMonthContext();
    const eventsMap = buildCalendarEvents();
    const todayKey = formatDateKey(new Date());
    const cells = [];
    const weekLabels = [];

    for (let weekIndex = 0; weekIndex < 5; weekIndex += 1) {
        const weekDate = new Date(gridStart);
        weekDate.setDate(gridStart.getDate() + weekIndex * 7);
        weekLabels.push(`<div class="calendar-week-label">${formatWeekNumber(weekDate)} неделя</div>`);

        for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
            const cellDate = new Date(weekDate);
            cellDate.setDate(weekDate.getDate() + dayIndex);
            const dateKey = formatDateKey(cellDate);
            const events = eventsMap[dateKey] || [];
            const primaryEvent = events[0];
            const classes = [
                'calendar-day',
                cellDate.getMonth() !== month ? 'calendar-day--muted' : '',
                dateKey === todayKey ? 'calendar-day--today' : '',
                dateKey === selectedDateKey ? 'calendar-day--selected' : '',
                events.length ? 'calendar-day--has-event' : '',
                events[selectedEventIndex] && dateKey === selectedDateKey && detailMode === 'view' ? 'calendar-day--focused' : '',
            ].filter(Boolean).join(' ');

            const marker = primaryEvent
                ? primaryEvent.isHoliday
                    ? '<span class="calendar-day__flag"></span><span class="calendar-day__moon"></span>'
                    : `<span class="calendar-day__dot ${PRIORITY_ACCENT[primaryEvent.priority] || 'green'}"></span>`
                : '';

            const eventTitles = events.slice(0, 2)
                .map(event => `<div class="calendar-day__event">${escapeHtml(event.shortTitle)}</div>`)
                .join('');

            cells.push(`
                <button class="${classes}" type="button" onclick="handleDayClick('${dateKey}')">
                    <div class="calendar-day__number">${cellDate.getDate()}</div>
                    ${marker}
                    <div class="calendar-day__events">${eventTitles}</div>
                </button>
            `);
        }
    }

    grid.innerHTML = cells.join('');
    weeks.innerHTML = weekLabels.join('');
}

function renderDetail() {
    const detail = document.getElementById('calendarDetail');
    if (!detail) return;

    if (!selectedDateKey || detailMode === 'closed') {
        detail.classList.remove('calendar-detail--open');
        detail.innerHTML = '';
        return;
    }

    detail.classList.add('calendar-detail--open');
    if (detailMode === 'create') {
        detail.innerHTML = renderCreateDetail();
        return;
    }

    if (detailMode === 'edit') {
        detail.innerHTML = renderEditDetail();
        return;
    }

    detail.innerHTML = renderEventDetail();
}

function renderEventDetail() {
    const events = getEventsForDate(selectedDateKey);
    const event = events[selectedEventIndex] || null;
    if (!event) {
        detailMode = 'create';
        return renderCreateDetail();
    }

    const legendItems = event.isHoliday
        ? `<div class="calendar-detail__legend-item"><span class="calendar-detail__legend-dot flag"></span><span>${PRIORITY_LABEL.holiday}</span></div>`
        : `
            <div class="calendar-detail__legend-item"><span class="calendar-detail__legend-dot yellow"></span><span>${PRIORITY_LABEL.medium}</span></div>
            <div class="calendar-detail__legend-item"><span class="calendar-detail__legend-dot red"></span><span>${PRIORITY_LABEL.high}</span></div>
            <div class="calendar-detail__legend-item"><span class="calendar-detail__legend-dot green"></span><span>${PRIORITY_LABEL.low}</span></div>
        `;

    const notes = event.notes?.trim() || '';
    const arrows = events.length > 1 ? `
        <div class="calendar-detail__nav">
            <button class="calendar-detail__arrow" type="button" onclick="prevDetailItem()">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
            </button>
            <span class="calendar-detail__nav-label">${selectedEventIndex + 1}/${events.length}</span>
            <button class="calendar-detail__arrow" type="button" onclick="nextDetailItem()">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
            </button>
        </div>
    ` : '';

    const addButton = `
        <button class="calendar-detail__ghost-btn" type="button" onclick="openCreateForm('${selectedDateKey}')">
            Добавить задачу
        </button>
    `;

    const editButton = !event.isHoliday
        ? `
            <button class="calendar-detail__icon-btn" type="button" onclick="openEditForm(${event.taskId})" title="Изменить задачу">
                <svg class="calendar-detail__edit" viewBox="0 0 24 24" fill="none">
                    <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                    <path d="M13.96 5.19l3.75 3.75 2.09-2.09a1.5 1.5 0 0 0 0-2.12l-1.63-1.63a1.5 1.5 0 0 0-2.12 0l-2.09 2.09z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                </svg>
            </button>
        `
        : '';

    const noteControl = event.isHoliday
        ? `<div class="calendar-detail__notes-box${notes ? '' : ' calendar-detail__notes-box--placeholder'}">${escapeHtml(notes || 'Напишите заметку...')}</div>`
        : `
            <textarea
                id="eventNotesInput"
                class="calendar-detail__textarea calendar-detail__textarea--compact"
                placeholder="Напишите заметку..."
            >${escapeHtml(notes)}</textarea>
        `;

    const noteSaveButton = !event.isHoliday
        ? `
            <button class="calendar-detail__secondary-btn" type="button" onclick="saveTaskNotes(${event.taskId})">
                Сохранить заметку
            </button>
        `
        : '';

    return `
        <div class="calendar-detail__title-row">
            <div class="calendar-detail__title">${escapeHtml(event.title)}</div>
            <div class="calendar-detail__title-actions">
                ${arrows}
                ${editButton}
            </div>
        </div>

        <div class="calendar-detail__legend">
            ${legendItems}
        </div>

        ${event.description ? `<div class="calendar-detail__text">${escapeHtml(event.description)}</div>` : ''}

        <div class="calendar-detail__meta">
            <div class="calendar-detail__meta-row">
                <div class="calendar-detail__meta-label">Время:</div>
                <div>${escapeHtml(event.startLabel)}</div>
            </div>
            <div class="calendar-detail__meta-row">
                <div class="calendar-detail__meta-label">Заметки:</div>
            </div>
        </div>

        ${noteControl}

        <div class="calendar-detail__footer">
            <button class="calendar-detail__close" type="button" onclick="clearSelection()">закрыть</button>
            <div class="calendar-detail__footer-actions">
                ${noteSaveButton}
                ${addButton}
            </div>
        </div>
    `;
}

function renderEditDetail() {
    const event = getSelectedEvent();
    if (!event || event.isHoliday || !event.rawTask) {
        detailMode = 'view';
        return renderEventDetail();
    }

    const task = event.rawTask;
    const deadlineValue = task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : formatDateInputValue(selectedDateKey);

    return `
        <div class="calendar-detail__title-row">
            <div class="calendar-detail__title">Изменить задачу</div>
            <div class="calendar-detail__date-badge">${escapeHtml(new Date(`${selectedDateKey}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }))}</div>
        </div>

        <div class="calendar-detail__form">
            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Название</span>
                <input id="editTaskTitle" class="calendar-detail__input" type="text" value="${escapeHtml(task.title)}">
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Предмет</span>
                <input id="editTaskSubject" class="calendar-detail__input" type="text" value="${escapeHtml(task.subject || '')}">
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Время</span>
                <input id="editTaskDeadline" class="calendar-detail__input" type="datetime-local" value="${deadlineValue}">
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Приоритет</span>
                <select id="editTaskPriority" class="calendar-detail__input calendar-detail__select">
                    <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Обычное</option>
                    <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Важное</option>
                    <option value="high" ${task.priority === 'high' ? 'selected' : ''}>Критичное</option>
                    <option value="critical" ${task.priority === 'critical' ? 'selected' : ''}>Критичное (макс)</option>
                </select>
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Заметки</span>
                <textarea id="editTaskNotes" class="calendar-detail__textarea" placeholder="Напишите заметку...">${escapeHtml(task.description || '')}</textarea>
            </label>
        </div>

        <div class="calendar-detail__footer">
            <button class="calendar-detail__close" type="button" onclick="detailMode='view'; renderDetail();">отмена</button>
            <button class="calendar-detail__primary-btn" type="button" onclick="saveEditedTask(${task.id})">Сохранить</button>
        </div>
    `;
}

function renderCreateDetail() {
    const dateLabel = selectedDateKey
        ? new Date(`${selectedDateKey}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
        : '';

    return `
        <div class="calendar-detail__title-row">
            <div class="calendar-detail__title">Новая задача</div>
            <div class="calendar-detail__date-badge">${escapeHtml(dateLabel)}</div>
        </div>

        <div class="calendar-detail__form">
            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Название</span>
                <input id="newTaskTitle" class="calendar-detail__input" type="text" placeholder="Например, подготовить доклад">
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Предмет</span>
                <input id="newTaskSubject" class="calendar-detail__input" type="text" placeholder="Например, Computer Science">
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Время</span>
                <input id="newTaskDeadline" class="calendar-detail__input" type="datetime-local" value="${selectedDateKey ? formatDateInputValue(selectedDateKey) : ''}">
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Приоритет</span>
                <select id="newTaskPriority" class="calendar-detail__input calendar-detail__select">
                    <option value="low">Обычное</option>
                    <option value="medium" selected>Важное</option>
                    <option value="high">Критичное</option>
                    <option value="critical">Критичное (макс)</option>
                </select>
            </label>

            <label class="calendar-detail__field">
                <span class="calendar-detail__field-label">Заметки</span>
                <textarea id="newTaskNotes" class="calendar-detail__textarea" placeholder="Напишите заметку..."></textarea>
            </label>
        </div>

        <div class="calendar-detail__footer">
            <button class="calendar-detail__close" type="button" onclick="clearSelection()">закрыть</button>
            <button class="calendar-detail__primary-btn" type="button" onclick="createTaskForSelectedDate()">Создать</button>
        </div>
    `;
}

function selectDate(dateKey, eventIndex = 0) {
    selectedDateKey = dateKey;
    selectedEventIndex = eventIndex;
    detailMode = 'view';
    renderCalendar();
    renderDetail();
}

function openCreateForm(dateKey = selectedDateKey) {
    selectedDateKey = dateKey;
    selectedEventIndex = 0;
    detailMode = 'create';
    renderCalendar();
    renderDetail();
}

function openEditForm(taskId) {
    const task = allTasks.find(item => item.id === taskId);
    if (!task) return;
    selectedDateKey = task.deadline ? formatDateKey(new Date(task.deadline)) : selectedDateKey;
    detailMode = 'edit';
    renderCalendar();
    renderDetail();
}

function handleDayClick(dateKey) {
    const events = getEventsForDate(dateKey);
    if (events.length) {
        selectDate(dateKey, 0);
        return;
    }

    openCreateForm(dateKey);
}

function prevDetailItem() {
    const events = getEventsForDate(selectedDateKey);
    if (events.length < 2) return;
    selectedEventIndex = (selectedEventIndex - 1 + events.length) % events.length;
    renderCalendar();
    renderDetail();
}

function nextDetailItem() {
    const events = getEventsForDate(selectedDateKey);
    if (events.length < 2) return;
    selectedEventIndex = (selectedEventIndex + 1) % events.length;
    renderCalendar();
    renderDetail();
}

function clearSelection() {
    selectedDateKey = '';
    selectedEventIndex = 0;
    detailMode = 'closed';
    renderCalendar();
    renderDetail();
}

async function createTaskForSelectedDate() {
    const title = document.getElementById('newTaskTitle')?.value.trim();
    const subject = document.getElementById('newTaskSubject')?.value.trim();
    const deadline = document.getElementById('newTaskDeadline')?.value;
    const priority = document.getElementById('newTaskPriority')?.value || 'medium';
    const description = document.getElementById('newTaskNotes')?.value.trim();

    if (!title) {
        alert('Название задачи не может быть пустым');
        return;
    }

    try {
        const body = {
            title,
            priority,
            subject: subject || null,
            description: description || null,
            deadline: deadline ? new Date(deadline).toISOString() : null,
        };

        const res = await fetch(`${API}/api/tasks`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            alert('Не удалось создать задачу');
            return;
        }

        const createdTask = await res.json();
        allTasks.push(createdTask);
        const createdDateKey = createdTask.deadline ? formatDateKey(new Date(createdTask.deadline)) : selectedDateKey;
        const createdEvents = getEventsForDate(createdDateKey);
        const createdIndex = Math.max(0, createdEvents.findIndex(event => event.taskId === createdTask.id));
        selectedDateKey = createdDateKey;
        selectedEventIndex = createdIndex;
        detailMode = 'view';
        renderCalendar();
        renderDetail();
    } catch (error) {
        console.error(error);
        alert('Ошибка создания задачи');
    }
}

async function saveEditedTask(taskId) {
    const title = document.getElementById('editTaskTitle')?.value.trim();
    const subject = document.getElementById('editTaskSubject')?.value.trim();
    const deadline = document.getElementById('editTaskDeadline')?.value;
    const priority = document.getElementById('editTaskPriority')?.value || 'medium';
    const description = document.getElementById('editTaskNotes')?.value.trim();

    if (!title) {
        alert('Название задачи не может быть пустым');
        return;
    }

    try {
        const res = await fetch(`${API}/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify({
                title,
                subject: subject || null,
                description: description || null,
                priority,
                deadline: deadline ? new Date(deadline).toISOString() : null,
            }),
        });

        if (!res.ok) {
            alert('Не удалось сохранить задачу');
            return;
        }

        const updated = await res.json();
        const index = allTasks.findIndex(task => task.id === taskId);
        if (index !== -1) allTasks[index] = updated;

        selectedDateKey = updated.deadline ? formatDateKey(new Date(updated.deadline)) : selectedDateKey;
        const updatedEvents = getEventsForDate(selectedDateKey);
        selectedEventIndex = Math.max(0, updatedEvents.findIndex(event => event.taskId === updated.id));
        detailMode = 'view';
        renderCalendar();
        renderDetail();
    } catch (error) {
        console.error(error);
        alert('Ошибка сохранения задачи');
    }
}

async function saveTaskNotes(taskId) {
    const notes = document.getElementById('eventNotesInput')?.value ?? '';

    try {
        const res = await fetch(`${API}/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify({ description: notes.trim() || null }),
        });

        if (!res.ok) {
            alert('Не удалось сохранить заметку');
            return;
        }

        const updated = await res.json();
        const index = allTasks.findIndex(task => task.id === taskId);
        if (index !== -1) allTasks[index] = updated;

        renderCalendar();
        renderDetail();
    } catch (error) {
        console.error(error);
        alert('Ошибка сохранения заметки');
    }
}

function openFirstEventInMonth() {
    const { gridStart } = getMonthContext();
    const eventsMap = buildCalendarEvents();

    for (let weekIndex = 0; weekIndex < 5; weekIndex += 1) {
        for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
            const date = new Date(gridStart);
            date.setDate(gridStart.getDate() + weekIndex * 7 + dayIndex);
            const key = formatDateKey(date);
            if (eventsMap[key]?.length) {
                selectDate(key, 0);
                return;
            }
        }
    }

    clearSelection();
}

function shiftMonth(offset) {
    currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + offset, 1);
    openFirstEventInMonth();
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

    list.innerHTML = notifications.map(notification => {
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
        if (user.role !== 'student') {
            window.location.replace(ROLE_ROUTES[user.role] || '/login');
            return;
        }
        allTasks = await taskRes.json();

        const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '');
        const avatarEl = document.querySelector('.avatar');
        if (avatarEl) {
            avatarEl.textContent = initials.toUpperCase();
            avatarEl.style.backgroundImage = user.avatar_url ? `url("${user.avatar_url}")` : '';
            avatarEl.style.color = user.avatar_url ? 'transparent' : '#fff';
        }

        const streakCount = document.getElementById('streakCount');
        if (streakCount) {
            const inProgressCount = allTasks.filter(task => task.status === 'in_progress').length;
            streakCount.textContent = String(inProgressCount);
        }

        const today = new Date();
        currentMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
        openFirstEventInMonth();
        loadNotifications();
    } catch (error) {
        console.error('Ошибка инициализации календаря:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();

    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('href') === currentPath) link.classList.add('active');
    });

    document.getElementById('prevMonthBtn')?.addEventListener('click', () => shiftMonth(-1));
    document.getElementById('nextMonthBtn')?.addEventListener('click', () => shiftMonth(1));
    document.getElementById('currentMonthBtn')?.addEventListener('click', () => {
        const now = new Date();
        currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        openFirstEventInMonth();
    });

    document.addEventListener('click', event => {
        const modal = document.getElementById('notifModal');
        const wrap = document.querySelector('.notif-wrap');
        if (modal && wrap && !wrap.contains(event.target)) modal.style.display = 'none';
    });

    const modal = document.getElementById('notifModal');
    if (modal) modal.addEventListener('click', event => event.stopPropagation());
});
