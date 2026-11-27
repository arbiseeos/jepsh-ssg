// Minimal client-rendered "SPA", shaped like a Vite production build (single ES module).
const root = document.getElementById("root");
const route = location.pathname.replace(/\/$/, "") || "/";
const pages = { "/": "Home page", "/about": "About page" };
const user = route.match(/^\/users\/(\d+)$/);
const title = user ? "User " + user[1] : pages[route] || "Not found";
root.innerHTML = "<main><h1>" + title + "</h1></main>";
