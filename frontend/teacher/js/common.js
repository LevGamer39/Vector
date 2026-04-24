(function () {
    const API = window.location.origin;
    const token = localStorage.getItem("token");

    if (!token) {
        window.location.href = "/login";
        return;
    }

    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };

    function setActiveNav() {
        const currentPath = window.location.pathname;
        document.querySelectorAll(".nav-item").forEach((link) => {
            if (link.getAttribute("href") === currentPath) {
                link.classList.add("active");
            }
        });
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            let message = "Request failed";
            try {
                const data = await response.json();
                message = data.detail || data.message || message;
            } catch (_) {
                message = response.statusText || message;
            }
            throw new Error(message);
        }

        if (response.status === 204) {
            return null;
        }
        return response.json();
    }

    async function requireSession(roles) {
        const user = await fetchJSON(`${API}/api/users/me`);
        if (roles?.length && !roles.includes(user.role)) {
            const fallback = user.role === "student"
                ? "/student/dashboard"
                : user.role === "admin"
                    ? "/admin/dashboard"
                    : user.role === "parent"
                        ? "/parent/dashboard"
                        : "/teacher/dashboard";
            window.location.href = fallback;
            throw new Error("Access denied");
        }

        document.querySelectorAll(".avatar").forEach((avatar) => {
            const initials = `${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase();
            avatar.textContent = initials || "V";
            if (user.avatar_url) {
                avatar.style.backgroundImage = `url("${user.avatar_url}")`;
                avatar.style.color = "transparent";
            }
        });

        const userName = document.getElementById("userName");
        if (userName) {
            userName.textContent = `${user.first_name} ${user.last_name}`;
        }

        return user;
    }

    function showToast(message, type = "success") {
        const current = document.querySelector(".teacher-toast");
        if (current) current.remove();
        const toast = document.createElement("div");
        toast.className = `teacher-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => toast.remove(), 3200);
    }

    function formatDate(value) {
        if (!value) return "Без даты";
        return new Date(value).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }

    function formatDateTime(value) {
        if (!value) return "Без даты";
        return new Date(value).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    async function loadNotifications() {
        try {
            const notifications = await fetchJSON(`${API}/api/notifications`);
            const list = document.getElementById("notifList");
            const counter = document.getElementById("notifCounter");
            if (!list || !counter) return;

            const unread = notifications.filter((item) => !item.is_read);
            counter.style.display = unread.length ? "flex" : "none";
            counter.textContent = unread.length > 99 ? "99+" : String(unread.length);

            if (!notifications.length) {
                list.innerHTML = '<div class="teacher-empty">Уведомлений пока нет.</div>';
                return;
            }

            list.innerHTML = notifications.map((item) => `
                <div class="notif-item${item.is_read ? "" : " notif-item--unread"}" data-id="${item.id}">
                    ${item.is_read ? "" : '<span class="notif-unread-dot"></span>'}
                    <div class="notif-author">Система</div>
                    <div class="notif-time">${formatDateTime(item.created_at)}</div>
                    <div class="notif-text">${escapeHtml(item.title)}</div>
                </div>
            `).join("");

            list.querySelectorAll(".notif-item").forEach((element) => {
                element.addEventListener("click", async () => {
                    const id = element.getAttribute("data-id");
                    await fetchJSON(`${API}/api/notifications/${id}/read`, { method: "POST" });
                    loadNotifications();
                });
            });
        } catch (error) {
            console.error(error);
        }
    }

    function toggleNotifications(event) {
        if (event) event.stopPropagation();
        const modal = document.getElementById("notifModal");
        if (!modal) return;
        const open = modal.style.display === "flex";
        modal.style.display = open ? "none" : "flex";
        if (!open) loadNotifications();
    }

    async function copyText(text, successMessage = "Скопировано") {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                throw new Error("Clipboard API unavailable");
            }
        } catch (_) {
            const input = document.createElement("textarea");
            input.value = text;
            input.setAttribute("readonly", "readonly");
            input.style.position = "fixed";
            input.style.opacity = "0";
            document.body.appendChild(input);
            input.focus();
            input.select();
            document.execCommand("copy");
            document.body.removeChild(input);
        }
        showToast(successMessage);
    }

    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    document.addEventListener("DOMContentLoaded", () => {
        setActiveNav();
        document.addEventListener("click", (event) => {
            const modal = document.getElementById("notifModal");
            const wrap = document.querySelector(".notif-wrap");
            if (modal && wrap && !wrap.contains(event.target)) {
                modal.style.display = "none";
            }
        });
    });

    window.VectorApp = {
        API,
        headers,
        fetchJSON,
        requireSession,
        showToast,
        formatDate,
        formatDateTime,
        toggleNotifications,
        copyText,
        getQueryParam,
        escapeHtml,
    };

    window.toggleNotifications = toggleNotifications;
})();
