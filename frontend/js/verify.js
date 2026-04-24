const API = window.location.origin;
const boxes = document.querySelectorAll('.code-box');
const email = localStorage.getItem('pending_email') || '';
const emailHint = document.getElementById('email-hint');

if (emailHint && email) {
    emailHint.textContent = 'Код отправлен на ' + email;
}

localStorage.removeItem('pending_verification_code');

boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '');
        if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        if (getCode().length === 6) verify();
    });

    box.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
    });

    box.addEventListener('paste', event => {
        event.preventDefault();
        const text = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        text.split('').forEach((char, index) => {
            if (boxes[index]) boxes[index].value = char;
        });
        if (text.length === 6) verify();
    });
});

function getCode() {
    return Array.from(boxes).map(box => box.value).join('');
}

function setError(message) {
    const err = document.getElementById('err');
    err.textContent = message;
    err.style.display = 'block';
    boxes.forEach(box => box.classList.add('error-box'));
    setTimeout(() => {
        err.style.display = 'none';
        boxes.forEach(box => box.classList.remove('error-box'));
    }, 3000);
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
        if (!res.ok) throw new Error(data.detail || 'Неверный или истёкший код');

        localStorage.removeItem('pending_email');
        localStorage.removeItem('pending_verification_code');
        window.location.href = 'login';
    } catch (error) {
        setError(error.message || 'Неверный или истёкший код');
        boxes.forEach(box => { box.value = ''; });
        boxes[0]?.focus();
    }
}

let seconds = 60;
const timerEl = document.getElementById('timer');
const btn = document.getElementById('resendBtn');
const interval = setInterval(() => {
    seconds -= 1;
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
        const res = await fetch(API + `/api/users/resend-verification?email=${encodeURIComponent(email)}`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Не удалось повторно отправить код');

        if (emailHint) {
            emailHint.textContent = 'Код отправлен на ' + email;
        }

        btn.disabled = true;
        btn.textContent = 'Отправлено';
        setTimeout(() => {
            btn.textContent = 'Повторить отправку';
            btn.disabled = false;
        }, 5000);
    } catch (_) {}
});
