const AdminPage = {
    dashboard: null,
    activeTab: "overview",
};

function teacherName(teacher) {
    return `${teacher.first_name} ${teacher.last_name}`.trim();
}

function renderStats() {
    const stats = document.getElementById("adminStats");
    stats.innerHTML = `
        <span class="teacher-tag">Учителей: ${AdminPage.dashboard.teachers_count}</span>
        <span class="teacher-tag">Учеников: ${AdminPage.dashboard.students_count}</span>
        <span class="teacher-tag">Классов: ${AdminPage.dashboard.classes_count}</span>
        <span class="teacher-tag">Инвайт-кодов: ${AdminPage.dashboard.invite_codes_count}</span>
    `;
}

function renderTeacherOptions() {
    const select = document.getElementById("teacherSelect");
    if (!AdminPage.dashboard.teachers.length) {
        select.innerHTML = '<option value="">Нет учителей</option>';
        return;
    }
    select.innerHTML = AdminPage.dashboard.teachers.map((teacher) => `
        <option value="${teacher.id}">
            ${VectorApp.escapeHtml(teacherName(teacher))}${teacher.teacher_subject ? ` · ${VectorApp.escapeHtml(teacher.teacher_subject)}` : ""}
        </option>
    `).join("");
}

function renderClasses() {
    const container = document.getElementById("adminClassesList");
    if (!AdminPage.dashboard.classes.length) {
        container.innerHTML = '<div class="teacher-empty">Классов пока нет.</div>';
        return;
    }

    container.innerHTML = AdminPage.dashboard.classes.map((item) => `
        <div class="teacher-list-row admin-classes">
            <div>${VectorApp.escapeHtml(item.name)}</div>
            <div>${VectorApp.escapeHtml(item.teacher_name)}</div>
            <div>${item.student_count}</div>
            <div><button class="teacher-chip" data-copy="${item.invite_code}">${item.invite_code}</button></div>
            <div><span class="teacher-chip">${item.created_at ? VectorApp.formatDate(item.created_at) : "Создан"}</span></div>
        </div>
    `).join("");

    container.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", () => VectorApp.copyText(button.dataset.copy, "Инвайт-код класса скопирован"));
    });
}

function renderStudents() {
    const container = document.getElementById("adminStudentsList");
    const classOptions = ['<option value="">Без класса</option>']
        .concat(AdminPage.dashboard.classes.map((item) => `<option value="${item.id}">${VectorApp.escapeHtml(item.name)}</option>`))
        .join("");

    if (!AdminPage.dashboard.students.length) {
        container.innerHTML = '<div class="teacher-empty">Учеников пока нет.</div>';
        return;
    }

    container.innerHTML = AdminPage.dashboard.students.map((student) => `
        <div class="teacher-list-row accounts">
            <div>
                <strong>${VectorApp.escapeHtml(`${student.first_name} ${student.last_name}`)}</strong><br>
                <span class="muted">${VectorApp.escapeHtml(student.email)}</span>
            </div>
            <div>${VectorApp.escapeHtml(student.class_name || "Не назначен")}</div>
            <div>
                <select class="teacher-inline-select" data-active="${student.id}">
                    <option value="true" ${student.is_active ? "selected" : ""}>Активен</option>
                    <option value="false" ${!student.is_active ? "selected" : ""}>Отключен</option>
                </select>
            </div>
            <div>
                <select class="teacher-inline-select" data-class="${student.id}">${classOptions}</select>
            </div>
            <div><button class="teacher-chip" data-save="${student.id}">Сохранить</button></div>
        </div>
    `).join("");

    AdminPage.dashboard.students.forEach((student) => {
        const classSelect = container.querySelector(`[data-class="${student.id}"]`);
        if (classSelect) classSelect.value = student.class_id || "";
    });

    container.querySelectorAll("[data-save]").forEach((button) => {
        button.addEventListener("click", async () => {
            const studentId = Number(button.dataset.save);
            const active = container.querySelector(`[data-active="${studentId}"]`).value === "true";
            const classId = container.querySelector(`[data-class="${studentId}"]`).value;
            const student = AdminPage.dashboard.students.find((item) => item.id === studentId);

            await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/users/${studentId}`, {
                method: "PATCH",
                body: JSON.stringify({ is_active: active }),
            });

            if (classId) {
                await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/classes/${classId}/students`, {
                    method: "POST",
                    body: JSON.stringify({ student_id: studentId }),
                });
            } else if (student?.class_id) {
                await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/classes/${student.class_id}/students/${studentId}`, {
                    method: "DELETE",
                });
            }

            VectorApp.showToast("Данные ученика обновлены.");
            await loadAdminDashboard();
        });
    });
}

function renderTeachers() {
    const container = document.getElementById("adminTeachersList");
    if (!AdminPage.dashboard.teachers.length) {
        container.innerHTML = '<div class="teacher-empty">Учителей пока нет.</div>';
        return;
    }

    container.innerHTML = AdminPage.dashboard.teachers.map((teacher) => `
        <div class="teacher-list-row teachers">
            <div>
                <strong>${VectorApp.escapeHtml(teacherName(teacher))}</strong><br>
                <span class="muted">${VectorApp.escapeHtml(teacher.email)}</span>
            </div>
            <div>
                <input class="teacher-input" data-subject="${teacher.id}" value="${VectorApp.escapeHtml(teacher.teacher_subject || "")}" placeholder="Например, Алгебра">
            </div>
            <div>${teacher.class_count} кл.</div>
            <div><button class="teacher-chip" data-save-subject="${teacher.id}">Сохранить</button></div>
        </div>
    `).join("");

    container.querySelectorAll("[data-save-subject]").forEach((button) => {
        button.addEventListener("click", async () => {
            const teacherId = Number(button.dataset.saveSubject);
            const subject = container.querySelector(`[data-subject="${teacherId}"]`)?.value.trim() || "";
            await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/users/${teacherId}`, {
                method: "PATCH",
                body: JSON.stringify({ teacher_subject: subject }),
            });
            VectorApp.showToast("Предмет учителя обновлен.");
            await loadAdminDashboard();
        });
    });
}

async function renderInviteCodes() {
    const container = document.getElementById("inviteCodesList");
    const codes = await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/invite-codes`);
    container.innerHTML = codes.length ? codes.map((item) => `
        <div class="teacher-list-row invite-codes">
            <div>${item.code}</div>
            <div>${item.is_used ? "Использован" : "Свободен"}</div>
            <div>${VectorApp.formatDate(item.created_at)}</div>
            <div><button class="teacher-chip" data-copy-code="${item.code}">Копировать</button></div>
            <div>${item.is_used ? "—" : `<button class="teacher-chip" data-delete-code="${item.id}">Удалить</button>`}</div>
        </div>
    `).join("") : '<div class="teacher-empty">Пока нет инвайт-кодов.</div>';

    container.querySelectorAll("[data-copy-code]").forEach((button) => {
        button.addEventListener("click", () => VectorApp.copyText(button.dataset.copyCode, "Код скопирован"));
    });
    container.querySelectorAll("[data-delete-code]").forEach((button) => {
        button.addEventListener("click", async () => {
            await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/invite-codes/${button.dataset.deleteCode}`, {
                method: "DELETE",
            });
            VectorApp.showToast("Код удален.");
            await loadAdminDashboard();
        });
    });
}

function setActiveTab(tab) {
    AdminPage.activeTab = tab;
    document.querySelectorAll(".teacher-tab").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.tab === tab);
    });
    document.querySelectorAll(".teacher-tab-panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === tab);
    });
}

async function loadAdminDashboard() {
    AdminPage.dashboard = await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/dashboard`);
    renderStats();
    renderTeacherOptions();
    renderClasses();
    renderStudents();
    renderTeachers();
    await renderInviteCodes();
}

async function createClass() {
    const name = document.getElementById("newClassName").value.trim();
    const teacherId = Number(document.getElementById("teacherSelect").value);
    if (!name || !teacherId) {
        VectorApp.showToast("Заполните название и учителя.", "error");
        return;
    }

    await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/classes`, {
        method: "POST",
        body: JSON.stringify({
            name,
            teacher_id: teacherId,
            student_ids: [],
        }),
    });

    document.getElementById("newClassName").value = "";
    VectorApp.showToast("Класс создан.");
    await loadAdminDashboard();
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await VectorApp.requireSession(["admin"]);
        document.querySelectorAll(".teacher-tab").forEach((button) => {
            button.addEventListener("click", () => setActiveTab(button.dataset.tab));
        });
        await loadAdminDashboard();
        document.getElementById("createAdminClassBtn").addEventListener("click", createClass);
        document.getElementById("newInviteCodeBtn").addEventListener("click", async () => {
            await VectorApp.fetchJSON(`${VectorApp.API}/api/admin/invite-codes`, { method: "POST" });
            VectorApp.showToast("Инвайт-код создан.");
            await loadAdminDashboard();
        });
    } catch (error) {
        console.error(error);
        VectorApp.showToast(error.message || "Не удалось открыть админ-панель", "error");
    }
});
