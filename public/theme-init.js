// Sets the theme before the app loads so the page doesn't flash. Light unless dark mode is on in Settings.
try {
  var t = localStorage.getItem("fc_theme"); t = t ? JSON.parse(t) : "light";
  var d = t === "dark";
  document.documentElement.dataset.theme = d ? "dark" : "light";
  if (d) { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", "#0e1318"); }
} catch (e) { document.documentElement.dataset.theme = "light"; }
