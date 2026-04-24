const API = window.location.origin;
const ROUTES = { student: '/student/dashboard', teacher: '/teacher/dashboard', parent: '/parent/dashboard', admin: '/admin/dashboard' };

document.getElementById('btn').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

async function login() {
	const email = document.getElementById('email').value.trim();
	const password = document.getElementById('password').value;
	const btn = document.getElementById('btn');
	const err = document.getElementById('err');
	err.style.display = 'none';

	if (!email || !password) { err.textContent = 'Заполните все поля'; err.style.display = 'block'; return; }

	btn.disabled = true; btn.textContent = 'Вхожу...';
	try {
		const res = await fetch(API + '/api/users/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ username: email, password }),
		});
		const data = await res.json();
		if (!res.ok) throw data.detail || 'Ошибка входа';
		localStorage.setItem('token', data.access_token);
		localStorage.setItem('user', JSON.stringify({ role: data.role, name: data.name }));
		window.location.href = ROUTES[data.role] || '/student/dashboard';
	} catch (e) {
		err.textContent = typeof e === 'string' ? e : 'Неверный email или пароль';
		err.style.display = 'block';
		btn.disabled = false; btn.textContent = 'Войти';
	}
}
document.getElementById('btn-yandex').onclick = async () => {
    const res = await fetch('/api/auth/yandex/login-url');
    const data = await res.json();
    window.location.href = data.url;
};
