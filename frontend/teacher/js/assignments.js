const AssignmentPage = {
    classes: [],
};

async function loadFilters() {
    AssignmentPage.classes = await VectorApp.fetchJSON(`${VectorApp.API}/api/classes`);
    const classFilter = document.getElementById("classFilter");
    classFilter.innerHTML = ['<option value="">Все классы</option>']
        .concat(AssignmentPage.classes.map((item) => `<option value="${item.id}">${VectorApp.escapeHtml(item.name)}</option>`))
        .join("");
    const queryClassId = VectorApp.getQueryParam("class_id");
    if (queryClassId) classFilter.value = queryClassId;
}

async function loadAssignments() {
    const params = new URLSearchParams();
    const classId = document.getElementById("classFilter").value;
    const subject = document.getElementById("subjectFilter").value.trim();
    const dateFrom = document.getElementById("dateFromFilter").value;
    const dateTo = document.getElementById("dateToFilter").value;

    if (classId) params.set("class_id", classId);
    if (subject) params.set("subject", subject);
    if (dateFrom) params.set("date_from", `${dateFrom}T00:00:00`);
    if (dateTo) params.set("date_to", `${dateTo}T23:59:59`);

    const assignments = await VectorApp.fetchJSON(`${VectorApp.API}/api/assignments?${params.toString()}`);
    const container = document.getElementById("assignmentsList");

    if (!assignments.length) {
        container.innerHTML = '<div class="teacher-empty">По выбранным фильтрам заданий нет.</div>';
        return;
    }

    container.innerHTML = assignments.map((assignment) => {
        const progress = assignment.total_count ? Math.round((assignment.submitted_count / assignment.total_count) * 100) : 0;
        return `
            <article class="assignment-card">
                <div class="teacher-header-row">
                    <div>
                        <div class="assignment-card-title">${VectorApp.escapeHtml(assignment.title)}</div>
                        <div class="teacher-inline-actions">
                            <span class="teacher-tag">${VectorApp.escapeHtml(assignment.class_name || "Класс")}</span>
                            <span class="teacher-tag">${VectorApp.escapeHtml(assignment.subject)}</span>
                            <span class="teacher-tag">До ${VectorApp.formatDateTime(assignment.deadline)}</span>
                        </div>
                    </div>
                    <button class="teacher-button" data-delete="${assignment.id}">Удалить</button>
                </div>
                <div class="muted">${VectorApp.escapeHtml(assignment.description || "Без описания")}</div>
                <div class="teacher-progress-bar"><span style="width:${progress}%"></span></div>
                <div>Прогресс: ${assignment.submitted_count} из ${assignment.total_count} сдали</div>
                <div class="teacher-inline-actions">
                    <button class="teacher-button primary" data-open-class="${assignment.class_id}">Открыть класс</button>
                    <button class="teacher-button" data-open-dashboard="${assignment.class_id}">Открыть в дашборде</button>
                </div>
            </article>
        `;
    }).join("");

    container.querySelectorAll("[data-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
            if (!window.confirm("Удалить задание?")) return;
            await VectorApp.fetchJSON(`${VectorApp.API}/api/assignments/${button.dataset.delete}`, { method: "DELETE" });
            VectorApp.showToast("Задание удалено.");
            await loadAssignments();
        });
    });

    container.querySelectorAll("[data-open-class]").forEach((button) => {
        button.addEventListener("click", () => {
            window.location.href = `/teacher/classes/${button.dataset.openClass}`;
        });
    });

    container.querySelectorAll("[data-open-dashboard]").forEach((button) => {
        button.addEventListener("click", () => {
            window.location.href = `/teacher/dashboard?class_id=${button.dataset.openDashboard}`;
        });
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await VectorApp.requireSession(["teacher"]);
        await loadFilters();
        await loadAssignments();
        ["classFilter", "subjectFilter", "dateFromFilter", "dateToFilter"].forEach((id) => {
            document.getElementById(id).addEventListener("change", loadAssignments);
        });
        document.getElementById("createAssignmentBtn").addEventListener("click", () => {
            const classId = document.getElementById("classFilter").value;
            window.location.href = classId ? `/teacher/assignments/new?class_id=${classId}` : "/teacher/assignments/new";
        });
    } catch (error) {
        console.error(error);
        VectorApp.showToast(error.message || "Не удалось загрузить задания", "error");
    }
});
