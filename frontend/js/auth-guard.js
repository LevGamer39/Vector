(function () {
  const API = window.location.origin;

  function dashboardByRole(role) {
    if (role === 'admin') return '/admin/dashboard';
    if (role === 'teacher') return '/teacher/dashboard';
    if (role === 'parent') return '/parent/dashboard';
    return '/student/dashboard';
  }

  async function redirectIfAuthenticated() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(API + '/api/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        localStorage.removeItem('token');
        return;
      }

      const user = await res.json();
      window.location.replace(dashboardByRole(user.role));
    } catch (_) {
      localStorage.removeItem('token');
    }
  }

  window.AuthGuard = { redirectIfAuthenticated };
})();
