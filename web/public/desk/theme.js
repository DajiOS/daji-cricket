// Applies the saved colour theme before the desk paints (desk.html loads this in <head>). Copied to web/public/desk/theme.js by build.mjs.
try {
  var d = document.documentElement, t = localStorage.getItem('daji.desk.theme'), p = localStorage.getItem('daji.desk.pal');
  // the club look is dark unless this device chose light
  if (t === 'dark' || (!t && !p)) d.setAttribute('data-theme', 'dark');
  d.setAttribute('data-pal', /^(club|field|forest|onyx|sand|navy|sage|plum|copper|pearl|burgundy|slate)$/.test(p) ? p : 'club');
} catch (e) { /* storage blocked: the default theme stays */ }
