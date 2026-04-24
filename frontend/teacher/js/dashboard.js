const TeacherDashboard = {
    user: null,
    classes: [],
    state: {
        classId: null,
        subject: "",
        assignmentId: "",
        page: 1,
    },
    dashboard: null,
};

function statusLabel(status) {
    if (status === "done") return "Выполнил";
    if (status === "in_progress") return "Начал";
    if (status === "overdue") return "Просрочил";
    if (!status) return "—";
    return "Не приступал";
}

function scoreLabel(score) {
    return score == null ? "—" : `${score.toFixed(1)}`;
}

function gradeLabel(grade) {
    return grade == null ? "—" : String(grade);
}

function setDashboardActionsDisabled(value) {
    [
        "copyLinkBtn",
        "gradeBtn",
        "openAssignmentsBtn",
        "createAssignmentBtn",
    ].forEach((id) => {
        const button = document.getElementById(id);
        if (button) button.disabled = value;
    });
}

async function loadClasses() {
    TeacherDashboard.classes = await VectorApp.fetchJSON(`${VectorApp.API}/api/classes`);
    if (!TeacherDashboard.classes.length) {
        document.getElementById("classSwitcher").innerHTML = '<div class="teacher-empty">Администратор еще не назначил вам классы.</div>';
        document.getElementById("studentsTable").innerHTML = '<div class="teacher-empty">Пока нет данных для дашборда.</div>';
        document.getElementById("subjectSelect").innerHTML = '<option value="">Нет предметов</option>';
        document.getElementById("assignmentSelect").innerHTML = '<option value="">Нет заданий</option>';
        document.getElementById("pagination").innerHTML = "";
        document.getElementById("completedCount").textContent = "0";
        document.getElementById("startedCount").textContent = "0";
        document.getElementById("pendingCount").textContent = "0";
        setDashboardActionsDisabled(true);
        return;
    }

    TeacherDashboard.state.classId = Number(VectorApp.getQueryParam("class_id")) || TeacherDashboard.classes[0].id;
    setDashboardActionsDisabled(false);
    renderClassSwitcher();
    await loadDashboard();
}

function renderClassSwitcher() {
    const container = document.getElementById("classSwitcher");
    container.innerHTML = TeacherDashboard.classes.map((item) => `
        <button class="class-pill${item.id === TeacherDashboard.state.classId ? " is-active" : ""}" data-id="${item.id}">
            ${VectorApp.escapeHtml(item.name)}
        </button>
    `).join("");

    container.querySelectorAll(".class-pill").forEach((button) => {
        button.addEventListener("click", async () => {
            TeacherDashboard.state.classId = Number(button.dataset.id);
            TeacherDashboard.state.subject = "";
            TeacherDashboard.state.assignmentId = "";
            TeacherDashboard.state.page = 1;
            renderClassSwitcher();
            await loadDashboard();
        });
    });
}

async function loadDashboard() {
    if (!TeacherDashboard.state.classId) return;

    const params = new URLSearchParams({
        class_id: String(TeacherDashboard.state.classId),
        page: String(TeacherDashboard.state.page),
        page_size: "10",
    });
    if (TeacherDashboard.state.subject) params.set("subject", TeacherDashboard.state.subject);
    if (TeacherDashboard.state.assignmentId) params.set("assignment_id", TeacherDashboard.state.assignmentId);

    TeacherDashboard.dashboard = await VectorApp.fetchJSON(`${VectorApp.API}/api/classes/dashboard?${params.toString()}`);
    renderFilters();
    renderStats();
    renderStudents();
    renderPagination();
}

function renderFilters() {
    const subjectSelect = document.getElementById("subjectSelect");
    const assignmentSelect = document.getElementById("assignmentSelect");
    const subjects = TeacherDashboard.dashboard.subjects || [];

    subjectSelect.innerHTML = ['<option value="">Все предметы</option>']
        .concat(subjects.map((subject) => `<option value="${VectorApp.escapeHtml(subject)}">${VectorApp.escapeHtml(subject)}</option>`))
        .join("");
    subjectSelect.value = TeacherDashboard.dashboard.selected_subject || "";

    assignmentSelect.innerHTML = TeacherDashboard.dashboard.assignments.length
        ? TeacherDashboard.dashboard.assignments.map((assignment) => `
            <option value="${assignment.id}">${VectorApp.escapeHtml(assignment.title)} · ${VectorApp.formatDate(assignment.deadline)}</option>
        `).join("")
        : '<option value="">Нет заданий</option>';
    assignmentSelect.value = TeacherDashboard.dashboard.selected_assignment_id ? String(TeacherDashboard.dashboard.selected_assignment_id) : "";

    subjectSelect.onchange = async () => {
        TeacherDashboard.state.subject = subjectSelect.value;
        TeacherDashboard.state.assignmentId = "";
        TeacherDashboard.state.page = 1;
        await loadDashboard();
    };

    assignmentSelect.onchange = async () => {
        TeacherDashboard.state.assignmentId = assignmentSelect.value;
        TeacherDashboard.state.page = 1;
        await loadDashboard();
    };
}

function renderStats() {
    document.getElementById("completedCount").textContent = TeacherDashboard.dashboard.statistics.completed;
    document.getElementById("startedCount").textContent = TeacherDashboard.dashboard.statistics.started;
    document.getElementById("pendingCount").textContent = TeacherDashboard.dashboard.statistics.not_started;
}

function renderStudents() {
    const container = document.getElementById("studentsTable");
    if (!TeacherDashboard.dashboard.selected_assignment_id) {
        container.innerHTML = '<div class="teacher-empty">Сначала выберите или создайте задание.</div>';
        return;
    }

    if (!TeacherDashboard.dashboard.students.length) {
        container.innerHTML = '<div class="teacher-empty">Нет учеников для выбранного задания.</div>';
        return;
    }

    const offset = (TeacherDashboard.dashboard.pagination.page - 1) * TeacherDashboard.dashboard.pagination.page_size;
    container.innerHTML = TeacherDashboard.dashboard.students.map((student, index) => `
        <div class="teacher-student-row">
            <div class="teacher-rank">${offset + index + 1}</div>
            <div>
                <div class="teacher-student-name">${VectorApp.escapeHtml(student.name)}</div>
                <div class="teacher-student-meta">${VectorApp.escapeHtml(student.email)}</div>
            </div>
            <div>
                <span class="status-pill ${student.status || "none"}">${statusLabel(student.status)}</span>
            </div>
            <div class="teacher-score">${scoreLabel(student.score)}</div>
            <div class="teacher-grade">${gradeLabel(student.grade)}</div>
        </div>
    `).join("");
}

function renderPagination() {
    const container = document.getElementById("pagination");
    const { page, total_pages: totalPages } = TeacherDashboard.dashboard.pagination;
    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }
    const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
    container.innerHTML = pages.map((value) => `
        <button class="teacher-page-link${value === page ? " is-active" : ""}" data-page="${value}">${value}</button>
    `).join("");
    container.querySelectorAll(".teacher-page-link").forEach((button) => {
        button.addEventListener("click", async () => {
            TeacherDashboard.state.page = Number(button.dataset.page);
            await loadDashboard();
        });
    });
}

async function openGradeModal() {
    const assignmentId = TeacherDashboard.dashboard?.selected_assignment_id;
    if (!assignmentId) {
        VectorApp.showToast("Сначала выберите задание.", "error");
        return;
    }

    const progress = await VectorApp.fetchJSON(`${VectorApp.API}/api/assignments/${assignmentId}/progress`);
    const body = document.getElementById("gradeModalBody");
    body.innerHTML = progress.students.map((student) => `
        <div class="teacher-modal-row">
            <div>
                <div>${VectorApp.escapeHtml(student.student_name)}</div>
                <div class="teacher-subtitle">${VectorApp.escapeHtml(student.email)} · ${statusLabel(student.status)}</div>
            </div>
            <select data-student-id="${student.student_id}">
                <option value="">—</option>
                <option value="2" ${student.grade === 2 ? "selected" : ""}>2</option>
                <option value="3" ${student.grade === 3 ? "selected" : ""}>3</option>
                <option value="4" ${student.grade === 4 ? "selected" : ""}>4</option>
                <option value="5" ${student.grade === 5 ? "selected" : ""}>5</option>
            </select>
        </div>
    `).join("");
    document.getElementById("gradeModal").classList.add("open");
}

async function saveGrades() {
    const assignmentId = TeacherDashboard.dashboard?.selected_assignment_id;
    if (!assignmentId) return;
    const assignment = TeacherDashboard.dashboard.assignments.find((item) => item.id === assignmentId);
    const selects = [...document.querySelectorAll("#gradeModalBody select")];
    const items = selects
        .filter((select) => select.value)
        .map((select) => ({
            student_id: Number(select.dataset.studentId),
            value: Number(select.value),
            comment: null,
        }));

    if (!items.length) {
        VectorApp.showToast("Выберите хотя бы одну отметку.", "error");
        return;
    }

    await VectorApp.fetchJSON(`${VectorApp.API}/api/grades/bulk`, {
        method: "POST",
        body: JSON.stringify({
            assignment_id: assignmentId,
            subject: assignment?.subject || TeacherDashboard.dashboard.selected_subject || TeacherDashboard.user?.teacher_subject || "Предмет",
            items,
        }),
    });

    document.getElementById("gradeModal").classList.remove("open");
    VectorApp.showToast("Отметки сохранены.");
    await loadDashboard();
}

function bindActions() {
    document.getElementById("copyLinkBtn").addEventListener("click", async () => {
        const classItem = TeacherDashboard.classes.find((item) => item.id === TeacherDashboard.state.classId);
        if (!classItem) return;
        await VectorApp.copyText(classItem.invite_code, "Инвайт-код класса скопирован");
    });

    document.getElementById("gradeBtn").addEventListener("click", openGradeModal);
    document.getElementById("openAssignmentsBtn").addEventListener("click", () => {
        window.location.href = `/teacher/assignments?class_id=${TeacherDashboard.state.classId}`;
    });
    document.getElementById("createAssignmentBtn").addEventListener("click", () => {
        window.location.href = `/teacher/assignments/new?class_id=${TeacherDashboard.state.classId}`;
    });
    document.getElementById("closeGradeModalBtn").addEventListener("click", () => {
        document.getElementById("gradeModal").classList.remove("open");
    });
    document.getElementById("saveGradesBtn").addEventListener("click", saveGrades);
    document.getElementById("gradeModal").addEventListener("click", (event) => {
        if (event.target.id === "gradeModal") {
            document.getElementById("gradeModal").classList.remove("open");
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        TeacherDashboard.user = await VectorApp.requireSession(["teacher"]);
        bindActions();
        await loadClasses();
    } catch (error) {
        console.error(error);
        VectorApp.showToast(error.message || "Не удалось загрузить дашборд", "error");
    }
});
