function statusBadge(status, grade) {
    if (grade != null) return `Оценка: ${grade}`;
    if (status === "done") return "Сдано";
    if (status === "in_progress") return "В работе";
    if (status === "overdue") return "Просрочено";
    return "—";
}

async function removeStudent(classId, studentId) {
    if (!window.confirm("Исключить ученика из класса?")) return;
    await VectorApp.fetchJSON(`${VectorApp.API}/api/classes/${classId}/students/${studentId}`, {
        method: "DELETE",
    });
    VectorApp.showToast("Ученик исключён.");
    await loadClassPage();
}

async function loadClassPage() {
    const classId = window.location.pathname.split("/").pop();
    const [detail, overview] = await Promise.all([
        VectorApp.fetchJSON(`${VectorApp.API}/api/classes/${classId}`),
        VectorApp.fetchJSON(`${VectorApp.API}/api/classes/${classId}/overview`),
    ]);

    document.getElementById("classTitle").textContent = detail.name;
    document.getElementById("classMeta").textContent = `Учеников: ${detail.student_count} · Инвайт-код: ${detail.invite_code}`;

    const studentsList = document.getElementById("studentsList");
    studentsList.innerHTML = detail.students.length ? detail.students.map((student) => `
        <div class="teacher-list-row students">
            <div>${VectorApp.escapeHtml(student.name)}</div>
            <div class="muted">${VectorApp.escapeHtml(student.email)}</div>
            <div>${VectorApp.escapeHtml(detail.name)}</div>
            <div>${student.email ? "Активен" : "Без email"}</div>
            <div><button class="teacher-chip" data-remove="${student.id}">Исключить</button></div>
        </div>
    `).join("") : '<div class="teacher-empty">В классе пока нет учеников.</div>';

    studentsList.querySelectorAll("[data-remove]").forEach((button) => {
        button.addEventListener("click", () => removeStudent(classId, button.dataset.remove));
    });

    const wrap = document.getElementById("progressMatrixWrap");
    if (!overview.assignments.length) {
        wrap.innerHTML = '<div class="teacher-empty">У класса пока нет заданий.</div>';
    } else {
        wrap.innerHTML = `
            <div class="teacher-matrix" style="--assignment-count:${overview.assignments.length}">
                <div class="teacher-matrix-head">
                    <div>Ученик</div>
                    ${overview.assignments.map((assignment) => `
                        <div>${VectorApp.escapeHtml(assignment.title)}<br><span class="muted">${VectorApp.formatDate(assignment.deadline)}</span></div>
                    `).join("")}
                </div>
                ${overview.students.map((student) => `
                    <div class="teacher-matrix-row">
                        <div>
                            <strong>${VectorApp.escapeHtml(student.name)}</strong><br>
                            <span class="muted">${VectorApp.escapeHtml(student.email)}</span>
                        </div>
                        ${student.assignments.map((cell) => `
                            <div class="teacher-matrix-status ${cell.status || "none"}">${statusBadge(cell.status, cell.grade)}</div>
                        `).join("")}
                    </div>
                `).join("")}
            </div>
        `;
    }

    document.getElementById("copyInviteBtn").onclick = () => VectorApp.copyText(detail.invite_code, "Инвайт-код скопирован");
    document.getElementById("createAssignmentBtn").onclick = () => {
        window.location.href = `/teacher/assignments/new?class_id=${classId}`;
    };
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await VectorApp.requireSession(["teacher"]);
        await loadClassPage();
    } catch (error) {
        console.error(error);
        VectorApp.showToast(error.message || "Не удалось загрузить класс", "error");
    }
});
