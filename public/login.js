/**
 * Sign-in / sign-up page.
 *
 * Stands alone from the dashboard app: a successful sign-in is a real browser
 * navigation to the app, not a DOM swap, so the user lands on a fresh page with
 * its own URL and a working back button.
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const toast = (message) => { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 3600); };

let authMode = "login";
let authorities = [];

// Where to land after signing in — set by the server when it bounced a deep link.
const nextUrl = () => {
  const next = new URLSearchParams(location.search).get("next");
  // Only same-origin paths, so ?next= can't be used to bounce people off-site.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
};

async function api(url, options) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// The same stroke-icon language as the app, kept small since this page only
// needs four of them.
const ICONS = {
  text: '<path d="M5.5 3.5h9l5 5v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z"/><path d="M14 3.5v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 4.8-4.3a1.5 1.5 0 0 1 2 0L16 17.5"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  video: '<rect x="2.5" y="5.5" width="13" height="13" rx="2"/><path d="m15.5 10 6-3.2v10.4l-6-3.2Z"/>',
};

const icon = (name, size = 18) =>
  `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

const DEMO_LOGINS = [
  { label: "Citizen", email: "citizen@demo.pk" },
  { label: "KW&SC", email: "kwsc@demo.pk" },
  { label: "SSWMB", email: "sswmb@demo.pk" },
  { label: "KMC", email: "kmc@demo.pk" },
  { label: "K-Electric", email: "kelectric@demo.pk" },
  { label: "Admin", email: "admin@demo.pk" },
];

function render() {
  const signup = authMode === "signup";

  $("#auth-screen").innerHTML = `
  <div class="auth-panel">
    <aside class="auth-aside">
      <div class="brand"><div class="brand-mark">K</div><div><strong>The City</strong><span>Around You</span></div></div>
      <h1>Karachi, reported by the people who live in it.</h1>
      <p>Report a problem by text, photo, voice or video. AI works out what it is and sends it to the authority that owns it.</p>
      <ul class="auth-points">
        <li><b>${icon("text")}</b> Write it in English, Urdu or Roman Urdu</li>
        <li><b>${icon("image")}</b> Photograph it — the AI reads the picture</li>
        <li><b>${icon("mic")}</b> Say it — the AI listens and transcribes</li>
        <li><b>${icon("video")}</b> Film it — the AI watches the clip</li>
      </ul>
    </aside>

    <div class="auth-form-wrap">
      <div class="auth-tabs">
        <button class="auth-tab ${signup ? "" : "active"}" data-auth-mode="login">Sign in</button>
        <button class="auth-tab ${signup ? "active" : ""}" data-auth-mode="signup">Create account</button>
      </div>

      <form id="auth-form" class="auth-form" novalidate>
        <div id="auth-error" class="auth-error" hidden></div>

        ${signup ? `
        <div class="field">
          <label for="auth-name">Full name</label>
          <input id="auth-name" name="name" autocomplete="name" placeholder="Ayesha Khan" required />
        </div>

        <div class="field">
          <label>I am registering as</label>
          <div class="account-type">
            <label class="type-option"><input type="radio" name="role" value="citizen" checked /><span><strong>A citizen</strong><small>Report problems in my area</small></span></label>
            <label class="type-option"><input type="radio" name="role" value="authority" /><span><strong>Authority staff</strong><small>Receive and resolve cases</small></span></label>
          </div>
        </div>

        <div class="field" id="authority-field" hidden>
          <label for="auth-authority">Which authority do you work for?</label>
          <select id="auth-authority" name="authorityId">
            <option value="">Select your organisation…</option>
            ${authorities.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} — ${escapeHtml(a.fullName)}</option>`).join("")}
          </select>
          <div class="input-note">You will only see cases routed to this organisation.</div>
        </div>

        <div class="field" id="job-field" hidden>
          <label for="auth-job">Job title <span class="label-optional">(optional)</span></label>
          <input id="auth-job" name="jobTitle" placeholder="Operations lead" />
        </div>

        <div class="field">
          <label for="auth-phone">Contact number <span class="label-optional">(optional)</span></label>
          <input id="auth-phone" name="phone" type="tel" autocomplete="tel" placeholder="0300 1234567" />
          <div class="input-note" id="phone-note">Shared with the authority handling your report so they can call before a visit.</div>
        </div>
        ` : ""}

        <div class="field">
          <label for="auth-email">Email</label>
          <input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
        </div>

        <div class="field">
          <label for="auth-password">Password</label>
          <input id="auth-password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "At least 8 characters" : "Your password"}" required />
        </div>

        <button class="primary-btn" type="submit" id="auth-submit" style="width:100%">${signup ? "Create account" : "Sign in"} →</button>
      </form>

      <div class="demo-logins">
        <small>Demo accounts — password <code>demo1234</code></small>
        <div class="demo-login-row">${DEMO_LOGINS.map((d) => `<button class="ghost-btn" data-demo-email="${d.email}">${escapeHtml(d.label)}</button>`).join("")}</div>
      </div>
    </div>
  </div>`;

  bindEvents();
}

function bindEvents() {
  $$("[data-auth-mode]").forEach((el) => el.addEventListener("click", () => { authMode = el.dataset.authMode; render(); }));

  // Authority staff must say which organisation they belong to.
  $$("input[name='role']").forEach((el) => el.addEventListener("change", () => {
    const isAuthority = el.value === "authority" && el.checked;
    if ($("#authority-field")) $("#authority-field").hidden = !isAuthority;
    if ($("#job-field")) $("#job-field").hidden = !isAuthority;
    // The number means something different on each side of the case.
    if ($("#phone-note")) {
      $("#phone-note").textContent = isAuthority
        ? "Shown to citizens whose cases you are assigned to, so they can reach you."
        : "Shared with the authority handling your report so they can call before a visit.";
    }
  }));

  $$("[data-demo-email]").forEach((el) => el.addEventListener("click", () => {
    authMode = "login";
    render();
    $("#auth-email").value = el.dataset.demoEmail;
    $("#auth-password").value = "demo1234";
    $("#auth-form").requestSubmit();
  }));

  $("#auth-form").addEventListener("submit", submit);
}

async function submit(event) {
  event.preventDefault();
  const signup = authMode === "signup";
  const button = $("#auth-submit");
  const errorBox = $("#auth-error");

  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = signup ? "Creating account…" : "Signing in…";

  try {
    const payload = Object.fromEntries(new FormData(event.target).entries());
    await api(signup ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    // A full navigation, so the app loads fresh with its own URL and history entry.
    location.assign(nextUrl());
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    button.disabled = false;
    button.textContent = `${signup ? "Create account" : "Sign in"} →`;
  }
}

(async function boot() {
  try {
    const config = await api("/api/config");
    authorities = config.authorities || [];
  } catch {
    // The signup form still works without the authority list; it just can't
    // offer the dropdown, and the server rejects an authority signup anyway.
  }
  render();
})();
