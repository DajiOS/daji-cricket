// Applies the saved colour theme before the desk paints (desk.html loads this in <head>). Copied to web/public/desk/theme.js by build.mjs.
try {
  var d = document.documentElement, t = localStorage.getItem('daji.desk.theme'), p = localStorage.getItem('daji.desk.pal');
  // the soft look (the default) is light unless this device chose dark
  if (t === 'dark') d.setAttribute('data-theme', 'dark');
  d.setAttribute('data-pal', /^(soft|club|field|forest|onyx|sand|navy|sage|plum|copper|pearl|burgundy|slate)$/.test(p) ? p : 'soft');
} catch (e) { /* storage blocked: the default theme stays */ }
