const API = window.location.origin;
const boxes = document.querySelectorAll('.code-box');
const email = localStorage.getItem('pending_email') || '';
if (email) document.getElementById('email-hint').textContent = 'Код отправлен на ' + email;

boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '');
        if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        if (getCode().length === 6) verify();
    });
    box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
    });
    box.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        text.split('').forEach((ch, idx) => { if (boxes[idx]) boxes[idx].value = ch; });
        if (text.length === 6) verify();
    });
});

function getCode() { return Array.from(boxes).map(b => b.value).join(''); }

function setError(msg) {
    const err = document.getElementById('err');
    err.textContent = msg; err.style.display = 'block';
    boxes.forEach(b => b.classList.add('error-box'));
    setTimeout(() => { err.style.display = 'none'; boxes.forEach(b => b.classList.remove('error-box')); }, 3000);
}

async function verify() {
    const code = getCode();
    if (code.length !== 6) return;
    try {
        const res = await fetch(API + '/api/users/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok) throw data.detail;
        localStorage.removeItem('pending_email');
        window.location.href = 'login';
    } catch (e) {
        setError(typeof e === 'string' ? e : 'Неверный или истёкший код');
        boxes.forEach(b => b.value = '');
        boxes[0].focus();
    }
}

let seconds = 60;
const timerEl = document.getElementById('timer');
const btn = document.getElementById('resendBtn');
const interval = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
        clearInterval(interval);
        btn.disabled = false;
        btn.textContent = 'Повторить отправку';
    } else {
        timerEl.textContent = seconds;
    }
}, 1000);

btn.addEventListener('click', async () => {
    if (!email) return;
    try {
        await fetch(API + `/api/users/resend-verification?email=${encodeURIComponent(email)}`, { method: 'POST' });
        btn.disabled = true;
        btn.textContent = 'Отправлено';
        setTimeout(() => { btn.textContent = 'Повторить отправку'; btn.disabled = false; }, 5000);
    } catch { }
});