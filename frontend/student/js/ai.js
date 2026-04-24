const API = window.location.origin;
const TOKEN = localStorage.getItem('token');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

if (!TOKEN) window.location.href = '/login';

let quickPrompts = [];
let currentUser = null;
let lastUserMessage = '';
let toastTimer = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMessage(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function showToast(message) {
    const toast = document.getElementById('aiToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function setAvatar(user) {
    const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || '??';
    const topAvatar = document.getElementById('topAvatar');
    if (!topAvatar) return;
    topAvatar.textContent = initials;
    topAvatar.style.backgroundImage = user?.avatar_url ? `url("${user.avatar_url}")` : '';
    topAvatar.style.color = user?.avatar_url ? 'transparent' : '#fff';
}

function setStreak(tasks) {
    const streak = document.getElementById('streakCount');
    if (streak) streak.textContent = String(tasks.filter(task => task.status === 'in_progress').length);
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
            badge.style.display = unread.length > 0 ? 'flex' : 'none';
        }

        renderNotificationList(notifications);
    } catch (_) {}
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
                <div class="notif-author">${notification.channel === 'email' ? '📧' : '🔔'} Система</div>
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
    } catch (_) {}
}

function toggleNotifications(event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('notifModal');
    if (!modal) return;
    const isOpen = modal.style.display === 'flex';
    modal.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) loadNotifications();
}

function renderQuickPrompts() {
    const wrap = document.getElementById('quickPrompts');
    if (!wrap) return;
    wrap.innerHTML = quickPrompts.map(prompt => `
        <button class="ai-quick-btn" type="button" onclick="useQuickPrompt('${escapeHtml(prompt)}')">${escapeHtml(prompt)}</button>
    `).join('');
}

function useQuickPrompt(prompt) {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.value = prompt;
    autoResizeInput();
    input.focus();
}

function autoResizeInput() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.style.height = '52px';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
}

function scrollChatToBottom() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

function renderEmptyState() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = `
        <div class="ai-empty">
            <div class="ai-empty-title">ИИ-ассистент готов</div>
            <div class="ai-empty-sub">Спроси про задачи, дедлайны, приоритеты или попроси разбить большое задание на шаги.</div>
        </div>
    `;
}

function assistantActions(text, prompt, index) {
    return `
        <div class="ai-message-actions">
            <button class="ai-action-btn" type="button" title="Переделать ответ" onclick="regenerateReply('${escapeHtml(prompt)}', ${index})">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 11a8 8 0 0 1 13.66-5.66L20 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M20 4v4h-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M20 13a8 8 0 0 1-13.66 5.66L4 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M4 20v-4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <button class="ai-action-btn" type="button" title="Копировать" onclick="copyReply('${escapeHtml(text)}')">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="9" y="7" width="10" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8"/>
                </svg>
            </button>
            <button class="ai-action-btn" type="button" title="Поделиться" onclick="shareReply('${escapeHtml(text)}')">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="1.8"/>
                    <circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                    <circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M8.6 10.7 15.4 6.3" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M8.6 13.3 15.4 17.7" stroke="currentColor" stroke-width="1.8"/>
                </svg>
            </button>
        </div>
    `;
}

function renderMessages(history) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (!history.length) {
        renderEmptyState();
        return;
    }

    let assistantIndex = 0;
    container.innerHTML = history.map((message, idx) => {
        if (message.role === 'user') {
            return `
                <div class="ai-message-row ai-message-row--user">
                    <div class="ai-message-block">
                        <div class="ai-message-main">
                            <div class="ai-bubble">${formatMessage(message.content)}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        const prompt = idx > 0 && history[idx - 1]?.role === 'user' ? history[idx - 1].content : lastUserMessage;
        const html = `
            <div class="ai-message-row ai-message-row--assistant" data-assistant-index="${assistantIndex}">
                <div class="ai-message-block">
                    <div class="ai-message-main">
                        <div class="ai-bot-badge">
                            <img src="/static/student/images/ai.svg" alt="">
                        </div>
                        <div class="ai-bubble">${formatMessage(message.content)}</div>
                    </div>
                    ${assistantActions(message.content, prompt || '', assistantIndex)}
                </div>
            </div>
        `;
        assistantIndex += 1;
        return html;
    }).join('');

    scrollChatToBottom();
}

function addTypingBubble() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const empty = container.querySelector('.ai-empty');
    if (empty) empty.remove();
    container.insertAdjacentHTML('beforeend', `
        <div class="ai-message-row ai-message-row--assistant ai-message-row--typing" id="typingRow">
            <div class="ai-message-block">
                <div class="ai-message-main">
                    <div class="ai-bot-badge">
                        <img src="/static/student/images/ai.svg" alt="">
                    </div>
                    <div class="ai-bubble">Думаю над ответом...</div>
                </div>
            </div>
        </div>
    `);
    scrollChatToBottom();
}

function removeTypingBubble() {
    document.getElementById('typingRow')?.remove();
}

async function loadHistory() {
    const res = await fetch(`${API}/api/ai/history`, { headers: HEADERS });
    if (!res.ok) throw new Error('Не удалось загрузить историю');
    const history = await res.json();
    if (history.length) {
        const lastUser = [...history].reverse().find(item => item.role === 'user');
        lastUserMessage = lastUser?.content || '';
    }
    renderMessages(history);
}

async function sendMessage(message, options = {}) {
    const { regenerate = false, targetIndex = null } = options;
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const container = document.getElementById('chatMessages');

    if (!message?.trim()) return;

    if (!regenerate && container?.querySelector('.ai-empty')) {
        container.innerHTML = '';
    }

    if (!regenerate) {
        const current = container.innerHTML;
        container.innerHTML = current + `
            <div class="ai-message-row ai-message-row--user">
                <div class="ai-message-block">
                    <div class="ai-message-main">
                        <div class="ai-bubble">${formatMessage(message)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    lastUserMessage = message;
    if (input && !regenerate) {
        input.value = '';
        autoResizeInput();
    }

    if (sendBtn) sendBtn.disabled = true;
    addTypingBubble();

    try {
        const res = await fetch(`${API}/api/ai/chat`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ message }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Не удалось получить ответ ИИ');

        removeTypingBubble();
        if (data.action === 'task_created' && data.data?.title) {
            showToast(`Задача добавлена: ${data.data.title}`);
        }

        if (regenerate && targetIndex !== null) {
            const row = document.querySelector(`.ai-message-row--assistant[data-assistant-index="${targetIndex}"]`);
            if (row) {
                row.outerHTML = `
                    <div class="ai-message-row ai-message-row--assistant" data-assistant-index="${targetIndex}">
                        <div class="ai-message-block">
                            <div class="ai-message-main">
                                <div class="ai-bot-badge">
                                    <img src="/static/student/images/ai.svg" alt="">
                                </div>
                                <div class="ai-bubble">${formatMessage(data.reply)}</div>
                            </div>
                            ${assistantActions(data.reply, message, targetIndex)}
                        </div>
                    </div>
                `;
            }
        } else {
            container.insertAdjacentHTML('beforeend', `
                <div class="ai-message-row ai-message-row--assistant" data-assistant-index="${document.querySelectorAll('.ai-message-row--assistant').length}">
                    <div class="ai-message-block">
                        <div class="ai-message-main">
                            <div class="ai-bot-badge">
                                <img src="/static/student/images/ai.svg" alt="">
                            </div>
                            <div class="ai-bubble">${formatMessage(data.reply)}</div>
                        </div>
                        ${assistantActions(data.reply, message, document.querySelectorAll('.ai-message-row--assistant').length)}
                    </div>
                </div>
            `);
        }

        scrollChatToBottom();
    } catch (error) {
        removeTypingBubble();
        showToast(error.message || 'Ошибка ИИ');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

async function copyReply(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Ответ скопирован');
    } catch (_) {
        showToast('Не удалось скопировать');
    }
}

async function shareReply(text) {
    try {
        if (navigator.share) {
            await navigator.share({ text });
            return;
        }
        await navigator.clipboard.writeText(text);
        showToast('Ответ скопирован для отправки');
    } catch (_) {
        showToast('Не удалось поделиться');
    }
}

async function regenerateReply(prompt, targetIndex) {
    if (!prompt) {
        showToast('Не нашёл исходный запрос');
        return;
    }
    showToast('Переделываю ответ...');
    await sendMessage(prompt, { regenerate: true, targetIndex });
}

async function loadQuickPrompts() {
    try {
        const res = await fetch(`${API}/api/ai/quick-prompts`, { headers: HEADERS });
        if (!res.ok) return;
        const data = await res.json();
        quickPrompts = Array.isArray(data.prompts) ? data.prompts : [];
        renderQuickPrompts();
    } catch (_) {}
}

async function init() {
    try {
        const [userRes, tasksRes] = await Promise.all([
            fetch(`${API}/api/users/me`, { headers: HEADERS }),
            fetch(`${API}/api/tasks`, { headers: HEADERS }),
        ]);

        if (!userRes.ok) {
            window.location.href = '/login';
            return;
        }

        currentUser = await userRes.json();
        const tasks = tasksRes.ok ? await tasksRes.json() : [];

        setAvatar(currentUser);
        setStreak(tasks);
        await Promise.all([loadQuickPrompts(), loadHistory(), loadNotifications()]);
    } catch (error) {
        renderEmptyState();
        showToast('Не удалось загрузить чат');
        console.error(error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();

    const input = document.getElementById('chatInput');
    input?.addEventListener('input', autoResizeInput);
    input?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage(input.value);
        }
    });

    document.getElementById('sendBtn')?.addEventListener('click', () => sendMessage(input?.value || ''));
    document.getElementById('fileSoonBtn')?.addEventListener('click', () => showToast('Загрузка файлов скоро появится'));
    document.getElementById('voiceSoonBtn')?.addEventListener('click', () => showToast('Голосовой ввод скоро появится'));

    document.addEventListener('click', event => {
        const modal = document.getElementById('notifModal');
        const wrap = document.querySelector('.notif-wrap');
        if (modal && wrap && !wrap.contains(event.target)) modal.style.display = 'none';
    });
});

window.toggleNotifications = toggleNotifications;
window.markNotifRead = markNotifRead;
window.useQuickPrompt = useQuickPrompt;
window.copyReply = copyReply;
window.shareReply = shareReply;
window.regenerateReply = regenerateReply;
