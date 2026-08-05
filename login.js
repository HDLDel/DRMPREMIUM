(function () {
    var t = localStorage.getItem('drm-theme');
    if (t !== 'light' && t !== 'dark') {
        t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', t);
})();

function toggleTheme() {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', current);
    try {
        localStorage.setItem('drm-theme', current);
    } catch (err) { /* storage indisponível */ }
}

async function doLogin() {
    const userEl = document.getElementById('user');
    const passEl = document.getElementById('pass');
    const errEl = document.getElementById('error-msg');
    
    if (!userEl || !passEl) return;
    const user = userEl.value;
    const pass = passEl.value;

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });

        if (res.ok) {
            window.location.href = '/';
        } else {
            if (errEl) errEl.classList.add('visible');
        }
    } catch (err) {
        if (errEl) errEl.classList.add('visible');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.querySelector('.btn-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }

    const loginBtn = document.querySelector('.login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', doLogin);
    }

    const userEl = document.getElementById('user');
    const passEl = document.getElementById('pass');

    if (userEl) {
        userEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && passEl) passEl.focus();
        });
    }

    if (passEl) {
        passEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') doLogin();
        });
    }
});
