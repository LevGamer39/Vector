async function renderClasses() {
    const classes = await VectorApp.fetchJSON(`${VectorApp.API}/api/classes`);
    const grid = document.getElementById("classesGrid");

    if (!classes.length) {
        grid.innerHTML = '<div class="teacher-empty">У вас пока нет назначенных классов. Их добавляет администратор.</div>';
        return;
    }

    grid.innerHTML = classes.map((item) => `
        <article class="class-card">
            <div class="class-card-title">${VectorApp.escapeHtml(item.name)}</div>
            <div class="teacher-tag">Учеников: ${item.student_count}</div>
            <div class="muted">Инвайт-код: <strong>${VectorApp.escapeHtml(item.invite_code)}</strong></div>
            <div class="teacher-inline-actions">
                <button class="teacher-button" data-copy="${item.invite_code}">Скопировать код</button>
                <button class="teacher-button primary" data-open="${item.id}">Открыть класс</button>
                <button class="teacher-button" data-dashboard="${item.id}">В дашборд</button>
            </div>
        </article>
    `).join("");

    grid.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", async () => {
            await VectorApp.copyText(button.dataset.copy, "Инвайт-код скопирован");
        });
    });

    grid.querySelectorAll("[data-open]").forEach((button) => {
        button.addEventListener("click", () => {
            window.location.href = `/teacher/classes/${button.dataset.open}`;
        });
    });

    grid.querySelectorAll("[data-dashboard]").forEach((button) => {
        button.addEventListener("click", () => {
            window.location.href = `/teacher/dashboard?class_id=${button.dataset.dashboard}`;
        });
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await VectorApp.requireSession(["teacher"]);
        await renderClasses();
    } catch (error) {
        console.error(error);
        VectorApp.showToast(error.message || "Не удалось загрузить классы", "error");
    }
});
