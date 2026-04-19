// Apply saved theme immediately (prevents FOUC — called inline in <head>)
(function () {
  var t = localStorage.getItem('lux-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('lux-theme', next);
  _updateThemeBtn(next);
}

function _updateThemeBtn(theme) {
  var btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Update button icon once DOM is ready
document.addEventListener('DOMContentLoaded', function () {
  var t = document.documentElement.getAttribute('data-theme') || 'dark';
  _updateThemeBtn(t);
});
