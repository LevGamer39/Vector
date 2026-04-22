const API = window.location.origin;
let role = 'student';

document.querySelectorAll('.role-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        role = tab.dataset.role;
        document.getElementById('invite-wrap').classList.toggle('show', role === 'teacher');
    });
});

document.getElementById('btn').addEventListener('click', async () => {
    const first = document.getElementById('first_name').value.trim();
    const last = document.getElementById('last_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const invite = document.getElementById('invite_code').value.trim();
    const btn = document.getElementById('btn');
    const err = document.getElementById('err');
    err.style.display = 'none';

    if (!first || !last || !email || !password) {
        err.textContent = 'Заполните все поля'; err.style.display = 'block'; return;
    }
    if (password.length < 8) {
        err.textContent = 'Пароль минимум 8 символов'; err.style.display = 'block'; return;
    }
    if (role === 'teacher' && !invite) {
        err.textContent = 'Введите инвайт-код учителя'; err.style.display = 'block'; return;
    }

    btn.disabled = true; btn.textContent = 'Регистрация...';
    try {
        const body = { email, password, first_name: first, last_name: last, role };
        if (role === 'teacher') body.invite_code = invite;

        const res = await fetch(API + '/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw data.detail || 'Ошибка регистрации';

        localStorage.setItem('pending_email', email);
        window.location.href = 'verify';
    } catch (e) {
        err.textContent = typeof e === 'string' ? e : 'Ошибка регистрации';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Зарегистрироваться';
    }
});