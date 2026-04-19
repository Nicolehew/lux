// Shared auth check — included on every protected page
(async function () {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (!data.authenticated) window.location.href = '/login.html';
})();

function logout() {
  fetch('/api/logout', { method: 'POST' }).then(() => {
    window.location.href = '/login.html';
  });
}
