// Sets light/dark before the app loads so the page doesn't flash the wrong theme.
try {
  var t = localStorage.getItem("fc_theme"); t = t ? JSON.parse(t) : "system";
  var d = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = d ? "dark" : "light";
} catch (e) {}
