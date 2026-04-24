const AssignmentFormPage = {
    classes: [],
    classDetails: new Map(),
    user: null,
};

async function loadClassesForForm() {
    AssignmentFormPage.classes = await VectorApp.fetchJSON(`${VectorApp.API}/api/classes`);
    const classInput = document.getElementById("classInput");
    const subjectInput = document.getElementById("subjectInput");

    if (!AssignmentFormPage.classes.length) {
        classInput.innerHTML = '<option value="">Нет назначенных классов</option>';
        document.querySelector("#assignmentForm button[type='submit']").disabled = true;
        document.getElementById("studentsCheckboxes").innerHTML = '<div class="teacher-empty">Нет доступных классов.</div>';
        subjectInput.value = AssignmentFormPage.user?.teacher_subject || "";
        subjectInput.readOnly = true;
        return;
    }

    classInput.innerHTML = AssignmentFormPage.classes.map((item) => `
        <option value="${item.id}">${VectorApp.escapeHtml(item.name)}</option>
    `).join("");

    const queryClassId = VectorApp.getQueryParam("class_id");
    if (queryClassId && AssignmentFormPage.classes.some((item) => String(item.id) === queryClassId)) {
        classInput.value = queryClassId;
    }

    syncSubjectWithClass();
    await renderStudentsCheckboxes();
}

function syncSubjectWithClass() {
    const subjectInput = document.getElementById("subjectInput");
    if (!subjectInput) return;
    subjectInput.value = AssignmentFormPage.user?.teacher_subject || "";
    subjectInput.readOnly = true;
}

async function getClassDetails(classId) {
    if (!AssignmentFormPage.classDetails.has(classId)) {
        const detail = await VectorApp.fetchJSON(`${VectorApp.API}/api/classes/${classId}`);
        AssignmentFormPage.classDetails.set(classId, detail);
    }
    return AssignmentFormPage.classDetails.get(classId);
}

async function renderStudentsCheckboxes() {
    const classId = document.getElementById("classInput").value;
    if (!classId) return;
    syncSubjectWithClass();
    const detail = await getClassDetails(classId);
    const container = document.getElementById("studentsCheckboxes");
    container.innerHTML = detail.students.length ? detail.students.map((student) => `
        <label class="teacher-checkbox">
            <input type="checkbox" value="${student.id}">
            <span>${VectorApp.escapeHtml(student.name)} · ${VectorApp.escapeHtml(student.email)}</span>
        </label>
    `).join("") : '<div class="teacher-empty">В этом классе пока нет учеников.</div>';
}

function toggleStudentsField() {
    const mode = document.getElementById("assignModeInput").value;
    document.getElementById("studentsField").style.display = mode === "selected" ? "flex" : "none";
}

async function submitAssignment(event) {
    event.preventDefault();
    const mode = document.getElementById("assignModeInput").value;
    const selectedStudents = [...document.querySelectorAll("#studentsCheckboxes input:checked")].map((input) => Number(input.value));

    const payload = {
        title: document.getElementById("titleInput").value.trim(),
        subject: document.getElementById("subjectInput").value.trim(),
        description: document.getElementById("descriptionInput").value.trim() || null,
        deadline: new Date(document.getElementById("deadlineInput").value).toISOString(),
        class_id: Number(document.getElementById("classInput").value),
        priority: document.getElementById("priorityInput").value,
        student_ids: mode === "selected" ? selectedStudents : null,
    };

    if (!payload.title || !payload.subject || !document.getElementById("deadlineInput").value) {
        VectorApp.showToast("Заполните обязательные поля.", "error");
        return;
    }

    if (mode === "selected" && !selectedStudents.length) {
        VectorApp.showToast("Выберите хотя бы одного ученика.", "error");
        return;
    }

    await VectorApp.fetchJSON(`${VectorApp.API}/api/assignments`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    VectorApp.showToast("Задание опубликовано.");
    window.location.href = `/teacher/assignments?class_id=${payload.class_id}`;
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        AssignmentFormPage.user = await VectorApp.requireSession(["teacher"]);
        if (!AssignmentFormPage.user?.teacher_subject) {
            VectorApp.showToast("Администратор должен назначить вам предмет перед созданием задания.", "error");
        }
        await loadClassesForForm();
        toggleStudentsField();
        document.getElementById("assignmentForm").addEventListener("submit", submitAssignment);
        document.getElementById("assignModeInput").addEventListener("change", toggleStudentsField);
        document.getElementById("classInput").addEventListener("change", renderStudentsCheckboxes);
        document.getElementById("cancelBtn").addEventListener("click", () => {
            window.history.back();
        });
    } catch (error) {
        console.error(error);
        VectorApp.showToast(error.message || "Не удалось открыть форму задания", "error");
    }
});
