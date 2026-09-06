import "./styles.css";
import { escapeHtml, formatDate } from "./utils";

const app = document.querySelector<HTMLDivElement>("#app")!;
const slug = "service-notification-router";
const sessionKey = "router_admin_session";
const demoKey = "demo:service-notification-router:workspace";
let token = sessionStorage.getItem(sessionKey) || "";
let initialized = false;

type ApiError = Error & { status?: number };
type Recipient = { id: number; name: string; channel: "email" | "webhook"; destination: string; consent_confirmed: boolean; active: boolean };
type Rule = { id: number; match_field: "service" | "provider"; match_value: string; recipient_id: number; recipient_name: string; priority: number; active: boolean };
type EventItem = { id: number | null; booking_id?: string; service: string; provider?: string; starts_at?: string; recipient_name?: string; channel?: string; status: string; attempt_count: number; error?: string; acknowledged_at?: string; created_at?: string; purged_at?: string };
type Config = { business_name: string; retention_hours: number; licensed: boolean; webhook_secret_hint: string; smtp_configured: boolean; recipient_count: number; rule_count: number; public_base_url: string };
type DemoSample = { metrics: { received: number; delivered: number; acknowledged: number; unmatched: number }; events: EventItem[]; recipients: Array<{ name: string; channel: string; destination: string }>; rules: Array<{ match_field: string; match_value: string; recipient_name: string; priority: number }> };
type DemoResponse = { workspace_id: string; expires_in_seconds: number; sample: DemoSample };

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try { response = await fetch(path, { ...options, headers }); }
  catch { throw Object.assign(new Error("The router is offline. Check the server and try again."), { status: 0 }); }
  const body = response.status === 204 ? null : await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") { token = ""; sessionStorage.removeItem(sessionKey); }
    throw Object.assign(new Error(body?.error || `Request failed with HTTP ${response.status}.`), { status: response.status });
  }
  return body as T;
}

function setMetadata(title: string, description: string): void {
  document.title = title;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", description);
  document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute("content", title);
  document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute("content", description);
  document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')?.setAttribute("content", title);
  document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]')?.setAttribute("content", description);
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", `${location.origin}${location.pathname}`);
}

function finishRoute(title: string, description: string): void {
  setMetadata(title, description);
  bindInternalLinks();
  const heading = document.querySelector<HTMLElement>("h1");
  const live = document.querySelector<HTMLElement>("#route-status");
  if (live && heading) live.textContent = heading.textContent || "Page loaded";
  requestAnimationFrame(() => heading?.focus({ preventScroll: true }));
}

function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
  void route();
}

function publicHeader(action = "Sign in"): string {
  const actionPath = action === "Open router" ? "/dashboard" : "/login";
  return `<header class="topbar">
    <a class="brand" href="/" data-link><img src="/mark.svg" alt="" width="40" height="40"><span>Service Notification Router</span></a>
    <nav class="public-nav" aria-label="Main"><a href="/demo" data-link>Demo</a><a href="/privacy" data-link>Privacy</a><a class="button secondary" href="${actionPath}" data-link>${action}</a></nav>
  </header>`;
}

function footer(): string {
  return `<footer class="public-footer"><span>Route booking notices to the responsible coordinator.</span><span class="footer-links"><a href="/privacy" data-link>Privacy</a><a href="/terms" data-link>Terms</a><span>Built by Param Factory</span><span>Version 1.1.0</span></span></footer>`;
}

function publicShell(content: string, action?: string, title = "Service Notification Router — Route booking notices", description = "Route each booking notice to the coordinator responsible for its service or provider."): void {
  app.innerHTML = `<div class="site-shell">${publicHeader(action)}<main id="main" class="public-main" tabindex="-1">${content}</main>${footer()}</div><div id="route-status" class="sr-only" aria-live="polite"></div><div class="toast-region" aria-live="polite" aria-atomic="true"></div>`;
  finishRoute(title, description);
}

function appShell(title: string, intro: string, content: string, action = ""): void {
  const current = location.pathname.slice(1) || "dashboard";
  const nav = [
    ["dashboard", "⌂", "Delivery board"], ["rules", "↗", "Routing rules"], ["recipients", "◎", "Recipients"], ["test", "◇", "Send a test"], ["settings", "⚙", "Settings"]
  ].map(([id, glyph, label]) => `<a href="/${id}" data-link ${current === id ? 'aria-current="page"' : ""}><span class="nav-glyph" aria-hidden="true">${glyph}</span>${label}</a>`).join("");
  app.innerHTML = `<div class="site-shell">
    <header class="topbar"><a class="brand" href="/dashboard" data-link><img src="/mark.svg" alt="" width="40" height="40"><span>Notification Router</span></a><nav class="utility-nav" aria-label="Account"><button class="button quiet" id="logout">Sign out</button></nav></header>
    <div id="offline" class="offline-banner" role="status" ${navigator.onLine ? "hidden" : ""}>You are offline. Reconnect before changing the router.</div>
    <div class="app-layout"><aside class="side-nav"><nav aria-label="Router">${nav}</nav></aside><main id="main" class="app-main" tabindex="-1"><div class="page-head"><div><p class="eyebrow">Administrator</p><h1 tabindex="-1">${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p></div>${action}</div>${content}</main></div>
    ${footer()}</div><div id="route-status" class="sr-only" aria-live="polite"></div><div class="toast-region" aria-live="polite" aria-atomic="true"></div>`;
  document.querySelector("#logout")?.addEventListener("click", () => { token = ""; sessionStorage.removeItem(sessionKey); navigate("/login"); });
  finishRoute(`${title} — Service Notification Router`, intro);
}

function toast(message: string): void {
  const region = document.querySelector(".toast-region");
  if (!region) return;
  const item = document.createElement("div"); item.className = "toast"; item.textContent = message; region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function showFormError(form: HTMLFormElement, error: unknown): void {
  const slot = form.querySelector<HTMLElement>("[data-form-error]");
  if (slot) { slot.textContent = error instanceof Error ? error.message : "The request failed. Try again."; slot.hidden = false; slot.focus(); }
}

function setBusy(form: HTMLFormElement, busy: boolean): void {
  form.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = busy);
  form.setAttribute("aria-busy", String(busy));
}

function bindInternalLinks(): void {
  document.querySelectorAll<HTMLAnchorElement>("a[data-link]").forEach(link => link.addEventListener("click", event => {
    if (link.origin !== location.origin) return;
    event.preventDefault(); navigate(`${link.pathname}${link.search}`);
  }));
  document.querySelector<HTMLAnchorElement>(".skip-link")?.addEventListener("click", () => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#main")?.focus());
  });
}

function previewRows(events: EventItem[]): string {
  return events.map(event => `<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(event.service)}</p><p class="ticket-meta">${escapeHtml(event.provider || "No provider")} · ${formatDate(event.starts_at || event.created_at)}</p></div><div><strong>${escapeHtml(event.recipient_name || "No rule matched")}</strong><p class="ticket-meta">${escapeHtml(event.channel || "Needs a route")}</p></div><span class="status ${escapeHtml(event.status)}">${escapeHtml(event.status)}</span><span class="ticket-meta">${event.attempt_count} attempt${event.attempt_count === 1 ? "" : "s"}</span></div></li>`).join("");
}

function landing(): void {
  const sample: EventItem[] = [
    { id: 1, service: "Dental cleaning", provider: "Dr. Rivera", starts_at: "2026-09-08T09:30:00Z", recipient_name: "Sofia Mendes", channel: "email", status: "delivered", attempt_count: 1 },
    { id: 2, service: "Prenatal consultation", provider: "Dr. Shah", starts_at: "2026-09-08T11:00:00Z", recipient_name: "Amina Yusuf", channel: "webhook", status: "acknowledged", attempt_count: 1 }
  ];
  publicShell(`<section class="hero">
    <div class="hero-copy"><p class="eyebrow">Booking notification router</p><h1 tabindex="-1">Route each booking to its coordinator</h1><p class="lede">For micro-clinics, studios, and multi-service offices that need each booking sent only to its responsible coordinator.</p>
      <div class="hero-actions"><a class="button" href="/demo" data-link>Try it with sample data</a><a class="button secondary" href="${initialized ? "/login" : "/setup"}" data-link>${initialized ? "Open your router" : "Set up your router"}</a></div>
      <p class="action-note">The sample opens a populated board. It does not touch your router.</p>
      <ul class="trust-strip"><li>No trackers</li><li>Offline reload shows a retry screen</li><li>$39 USD once after checkout registration</li></ul>
    </div>
    <figure class="hero-art"><picture><source media="(max-width:600px)" srcset="/assets/hero-routing-room-mobile.webp"><img src="/assets/hero-routing-room.webp" width="1200" height="800" fetchpriority="high" decoding="async" alt="One paper booking follows a blue route to the correct coordinator tray."></picture></figure>
  </section>
  <section class="product-preview" aria-labelledby="preview-title"><div class="section-head"><div><p class="eyebrow">Product preview</p><h2 id="preview-title">See each handoff and its result</h2></div><a href="/demo" data-link>Open the full sample →</a></div><div class="metrics compact" aria-label="Sample totals"><div class="metric"><strong>3</strong><span>Bookings received</span></div><div class="metric"><strong>2</strong><span>Notices delivered</span></div><div class="metric"><strong>1</strong><span>Acknowledged</span></div><div class="metric"><strong>1</strong><span>Needs a route</span></div></div><ul class="ticket-list">${previewRows(sample)}</ul></section>
  <section class="how-section" id="how" aria-labelledby="how-title"><p class="eyebrow">How it works</p><h2 id="how-title">Route a booking in three steps</h2><ol class="intro-grid"><li><strong>1. Receive signed booking data</strong><p>Your scheduler posts a normalized booking to the intake endpoint.</p></li><li><strong>2. Match one routing rule</strong><p>The first service or provider match selects one recipient.</p></li><li><strong>3. Track the handoff</strong><p>The board records delivery and the recipient acknowledgment.</p></li></ol></section>
  <section class="plain-section" aria-labelledby="privacy-title"><p class="eyebrow">Privacy and limits</p><h2 id="privacy-title">Keep booking data on your server</h2><p>The router stores encrypted booking details in its SQLite data directory. It sends matched notices only to destinations you configure.</p><h3>What it does not do</h3><ul><li>It does not create booking pages.</li><li>It does not scrape WhatsApp.</li><li>It does not send marketing messages.</li><li>It does not manage staff schedules.</li></ul><a href="/privacy" data-link>Read the privacy policy →</a></section>
  <section class="price-section" aria-labelledby="price-title"><p class="eyebrow">One-time price</p><h2 id="price-title">Use three routes free</h2><p>The free tier includes three recipients and three rules. A $39 USD one-time purchase removes those limits after checkout registration.</p><a class="button secondary" href="${initialized ? "/settings" : "/setup"}" data-link>${initialized ? "View license options" : "Set up the free router"}</a></section>`);
}

async function demoPage(reset = false): Promise<void> {
  publicShell(`<section class="auth-sheet"><p class="eyebrow">Sample workspace</p><h1 tabindex="-1">Loading sample bookings</h1><p role="status">Preparing an isolated routing board.</p></section>`, "Sign in", "Demo — Service Notification Router", "Try a populated booking notification routing board without changing real data.");
  try {
    let workspace = sessionStorage.getItem(demoKey);
    let result: DemoResponse;
    if (reset && workspace) result = await api<DemoResponse>(`/api/demo/${encodeURIComponent(workspace)}/reset`, { method: "POST" });
    else if (workspace) {
      try { result = await api<DemoResponse>(`/api/demo/${encodeURIComponent(workspace)}`); }
      catch { result = await api<DemoResponse>("/api/demo", { method: "POST" }); }
    } else result = await api<DemoResponse>("/api/demo", { method: "POST" });
    workspace = result.workspace_id; sessionStorage.setItem(demoKey, workspace);
    const s = result.sample;
    publicShell(`<div class="demo-banner" role="status"><strong>Demo — sample data, nothing is saved</strong><span><button class="button secondary" id="reset-demo">Reset demo</button><button class="button quiet" id="start-real">Start for real</button></span></div>
      <section class="demo-head"><p class="eyebrow">Harbor Health sample</p><h1 tabindex="-1">Review routed booking notices</h1><p class="lede">This board shows two matched bookings and one booking that needs a rule.</p></section>
      <section class="metrics" aria-label="Sample routing totals"><div class="metric"><strong>${s.metrics.received}</strong><span>Bookings received</span></div><div class="metric"><strong>${s.metrics.delivered}</strong><span>Notices delivered</span></div><div class="metric"><strong>${s.metrics.acknowledged}</strong><span>Acknowledged</span></div><div class="metric"><strong>${s.metrics.unmatched}</strong><span>Needs a route</span></div></section>
      <section aria-labelledby="sample-handoffs"><div class="section-head"><h2 id="sample-handoffs">Sample handoffs</h2></div><ul class="ticket-list">${previewRows(s.events)}</ul></section>
      <div class="demo-columns"><section class="panel"><h2>Sample routing rules</h2><ol class="simple-list">${s.rules.map(rule => `<li><strong>${escapeHtml(rule.match_field)}: ${escapeHtml(rule.match_value)}</strong><span>Send to ${escapeHtml(rule.recipient_name)} · priority ${rule.priority}</span></li>`).join("")}</ol></section><section class="panel"><h2>Sample recipients</h2><ul class="simple-list">${s.recipients.map(recipient => `<li><strong>${escapeHtml(recipient.name)}</strong><span>${escapeHtml(recipient.channel)} · ${escapeHtml(recipient.destination)}</span></li>`).join("")}</ul></section></div>`, "Sign in", "Demo — Service Notification Router", "Try a populated booking notification routing board without changing real data.");
    document.querySelector("#reset-demo")?.addEventListener("click", () => void demoPage(true));
    document.querySelector("#start-real")?.addEventListener("click", () => { sessionStorage.removeItem(demoKey); navigate("/"); });
  } catch (error) {
    publicShell(`<div class="empty"><div class="stamp">!</div><h1 tabindex="-1">The sample could not load</h1><p>${escapeHtml(error instanceof Error ? error.message : "The demo service did not respond.")}</p><button class="button" id="demo-retry">Try the sample again</button></div>`, "Sign in", "Demo — Service Notification Router", "Try a populated booking notification routing board without changing real data.");
    document.querySelector("#demo-retry")?.addEventListener("click", () => void demoPage());
  }
}

function setupPage(): void {
  publicShell(`<div class="setup-layout"><section class="auth-sheet"><p class="eyebrow">First setup</p><h1 tabindex="-1">Set up the booking router</h1><p>Use the private code from <code>router.setup-code</code> on the server data mount.</p>
    <form id="setup-form"><div class="form-grid"><div class="field full"><label for="setup-proof">Private setup code</label><input id="setup-proof" name="setup_proof" type="password" required minlength="20" autocomplete="off" aria-describedby="proof-hint"><p class="hint" id="proof-hint">This code prevents a public visitor from claiming a new router.</p></div><div class="field full"><label for="business">Business name</label><input id="business" name="business_name" required maxlength="160" autocomplete="organization"></div><div class="field full"><label for="setup-password">Admin password</label><input id="setup-password" name="password" type="password" required minlength="12" autocomplete="new-password" aria-describedby="password-hint"><p class="hint" id="password-hint">Use at least 12 characters.</p></div><div class="field"><label for="retention">Delete payloads after</label><select id="retention" name="retention_hours"><option value="24">24 hours</option><option value="72" selected>3 days</option><option value="168">7 days</option><option value="720">30 days</option></select></div></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button" type="submit">Create your router</button></div></form>
  </section><aside class="setup-aside"><img src="/assets/hero-routing-room-mobile.webp" width="800" height="533" alt="One appointment follows a route to the correct service tray."><p class="hint">The database and encryption key stay in the server data directory.</p></aside></div>`, "Sign in", "Set up — Service Notification Router", "Create the protected administrator for this booking notification router.");
  document.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; setBusy(form, true); const data = Object.fromEntries(new FormData(form));
    try { const result = await api<{token:string;webhook_secret:string}>("/api/setup", { method:"POST", body:JSON.stringify({ ...data, retention_hours:Number(data.retention_hours) }) }); token=result.token; sessionStorage.setItem(sessionKey, token); initialized=true; sessionStorage.setItem("new_webhook_secret",result.webhook_secret); navigate("/settings"); toast("Router created. Copy the intake secret before connecting your scheduler."); }
    catch(error){ showFormError(form,error); } finally { setBusy(form,false); }
  });
}

function loginPage(): void {
  publicShell(`<div class="setup-layout"><section class="auth-sheet"><p class="eyebrow">Administrator</p><h1 tabindex="-1">Sign in to your router</h1><p>Review delivery, change assignments, or send a test booking.</p><form id="login-form"><div class="field"><label for="password">Admin password</label><input id="password" name="password" type="password" required autocomplete="current-password"></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button" type="submit">Sign in</button><a href="/" data-link>Back to overview</a></div></form></section><aside class="setup-aside"><img src="/assets/hero-routing-room-mobile.webp" width="800" height="533" alt="A paper route connects a booking to one coordinator tray."></aside></div>`, "Sign in", "Sign in — Service Notification Router", "Sign in to administer booking routes and delivery outcomes.");
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget as HTMLFormElement; setBusy(form,true); const password=String(new FormData(form).get("password")||""); try{const result=await api<{token:string}>("/api/login",{method:"POST",body:JSON.stringify({password})});token=result.token;sessionStorage.setItem(sessionKey,token);navigate("/dashboard");}catch(error){showFormError(form,error);}finally{setBusy(form,false);} });
}

function loadingPage(title: string, intro: string): void { appShell(title,intro,`<div class="empty" aria-busy="true"><div class="stamp">…</div><h2>Loading current data</h2><p>Reading the latest state from your router.</p></div>`); }

async function dashboardPage(): Promise<void> {
  loadingPage("Delivery board", "Review booking handoffs and outcomes that need attention.");
  try {
    const data = await api<{events:EventItem[];metrics:{received:number;delivered:number;acknowledged:number;unmatched:number}}>("/api/events"); const m=data.metrics;
    const rows=data.events.map(event => `<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(event.service)}</p><p class="ticket-meta">${escapeHtml(event.provider||"No provider")} · ${formatDate(event.starts_at||event.created_at)}${event.purged_at?" · details purged":""}</p></div><div><strong>${escapeHtml(event.recipient_name||"No rule matched")}</strong><p class="ticket-meta">${escapeHtml(event.channel||"Needs assignment")}</p></div><span class="status ${escapeHtml(event.status)}">${escapeHtml(event.status)}</span><div class="row-actions">${event.status==="failed"&&event.id?`<button class="icon-button" data-retry="${event.id}" aria-label="Retry ${escapeHtml(event.service)} notification">Retry</button>`:""}</div></div>${event.error?`<p class="error-text">${escapeHtml(event.error)}</p>`:""}</li>`).join("");
    appShell("Delivery board","Review booking handoffs and outcomes that need attention.",`<section class="metrics" aria-label="Routing totals"><div class="metric"><strong>${m.received}</strong><span>Bookings received</span></div><div class="metric"><strong>${m.delivered}</strong><span>Notices delivered</span></div><div class="metric"><strong>${m.acknowledged}</strong><span>Acknowledged</span></div><div class="metric"><strong>${m.unmatched}</strong><span>Needs a route</span></div></section><div class="section-head"><h2>Recent handoffs</h2><a href="/test" data-link>Send a test →</a></div>${rows?`<ul class="ticket-list">${rows}</ul>`:`<div class="empty"><div class="stamp">0</div><h2>No booking notices yet</h2><p>Add a recipient and rule, then send a test.</p><a class="button" href="/recipients" data-link>Add the first recipient</a></div>`}`);
    document.querySelectorAll<HTMLButtonElement>("[data-retry]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await api(`/api/events/${button.dataset.retry}/retry`,{method:"POST"});toast("Delivery retried.");await dashboardPage();}catch(error){toast(error instanceof Error?error.message:"Retry failed.");button.disabled=false;}}));
  } catch(error){ handlePageError(error,"Delivery board"); }
}

async function recipientsPage(): Promise<void> {
  loadingPage("Recipients","Manage people or systems allowed to receive booking notices.");
  try { const [recipients,config]=await Promise.all([api<Recipient[]>("/api/recipients"),api<Config>("/api/config")]);
    const list=recipients.map(r=>`<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(r.name)}</p><p class="ticket-meta">Consent confirmed</p></div><div><strong>${escapeHtml(r.channel)}</strong><p class="ticket-meta">${escapeHtml(r.destination)}</p></div><span class="status delivered">active</span><div class="row-actions"><button class="icon-button" data-delete-recipient="${r.id}" data-name="${escapeHtml(r.name)}">Delete</button></div></div></li>`).join("");
    appShell("Recipients","Manage people or systems allowed to receive booking notices.",`${!config.smtp_configured?`<div class="notice warning"><strong>Email needs SMTP.</strong> Saved email notices retry until the server has SMTP settings.</div>`:""}<section class="panel"><h2>Add a recipient</h2><form id="recipient-form"><div class="form-grid"><div class="field"><label for="recipient-name">Coordinator name</label><input id="recipient-name" name="name" required maxlength="160"></div><div class="field"><label for="channel">Channel</label><select id="channel" name="channel"><option value="email">Email</option><option value="webhook">Webhook</option></select></div><div class="field full"><label for="destination">Email address or webhook URL</label><input id="destination" name="destination" required aria-describedby="destination-hint"><p class="hint" id="destination-hint">Use a provider-approved operational channel.</p></div><div class="field full"><div class="check-row"><input id="consent" name="consent_confirmed" type="checkbox" required><label for="consent">This recipient agreed to receive operational booking notices.</label></div></div></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button" type="submit">Add recipient</button><span class="hint">${config.licensed?"Unlimited license active":`${recipients.length} of 3 free recipients used`}</span></div></form></section><div class="section-head"><h2>Current recipients</h2></div>${list?`<ul class="ticket-list">${list}</ul>`:`<div class="empty"><div class="stamp">◎</div><h2>No recipients yet</h2><p>Add the coordinator responsible for one appointment type.</p></div>`}`);
    bindRecipientActions();
  } catch(error){handlePageError(error,"Recipients");}
}

function bindRecipientActions(): void {
  document.querySelector<HTMLFormElement>("#recipient-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{await api("/api/recipients",{method:"POST",body:JSON.stringify({...data,consent_confirmed:data.consent_confirmed==="on"})});toast("Recipient added.");await recipientsPage();}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
  document.querySelectorAll<HTMLButtonElement>("[data-delete-recipient]").forEach(button=>button.addEventListener("click",async()=>{if(!confirm(`Delete ${button.dataset.name}? Linked rules will also be removed.`))return;try{await api(`/api/recipients/${button.dataset.deleteRecipient}`,{method:"DELETE"});toast("Recipient and linked rules deleted.");await recipientsPage();}catch(error){toast(error instanceof Error?error.message:"Delete failed.");}}));
}

async function rulesPage(): Promise<void> {
  loadingPage("Routing rules","Manage exact service and provider matches in priority order.");
  try{const [rules,recipients,config]=await Promise.all([api<Rule[]>("/api/rules"),api<Recipient[]>("/api/recipients"),api<Config>("/api/config")]);
    const options=recipients.map(r=>`<option value="${r.id}">${escapeHtml(r.name)} · ${escapeHtml(r.channel)}</option>`).join("");
    const list=rules.map(rule=>`<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(rule.match_value)}</p><p class="ticket-meta">Match ${escapeHtml(rule.match_field)} · priority ${rule.priority}</p></div><div class="route-map"><strong>${escapeHtml(rule.match_field)}</strong><span class="route-arrow" aria-hidden="true">→</span><strong>${escapeHtml(rule.recipient_name)}</strong></div><span class="status delivered">active</span><div class="row-actions"><button class="icon-button" data-delete-rule="${rule.id}" data-name="${escapeHtml(rule.match_value)}">Delete</button></div></div></li>`).join("");
    appShell("Routing rules","Manage exact service and provider matches in priority order.",`${recipients.length?`<section class="panel"><h2>Add a routing rule</h2><form id="rule-form"><div class="form-grid"><div class="field"><label for="match-field">When this field</label><select id="match-field" name="match_field"><option value="service">Service</option><option value="provider">Provider</option></select></div><div class="field"><label for="match-value">Exactly equals</label><input id="match-value" name="match_value" required maxlength="160"></div><div class="field"><label for="recipient-id">Send to</label><select id="recipient-id" name="recipient_id">${options}</select></div><div class="field"><label for="priority">Priority</label><input id="priority" name="priority" type="number" min="1" max="999" value="100"><p class="hint">Lower numbers run first.</p></div></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button" type="submit">Add routing rule</button><span class="hint">${config.licensed?"Unlimited license active":`${rules.length} of 3 free rules used`}</span></div></form></section>`:`<div class="notice warning"><strong>Add a recipient first.</strong> A routing rule needs a destination. <a href="/recipients" data-link>Add a recipient →</a></div>`}<div class="section-head"><h2>Evaluation order</h2></div>${list?`<ul class="ticket-list">${list}</ul>`:`<div class="empty"><div class="stamp">↗</div><h2>No routing rules yet</h2><p>Create an exact service or provider match.</p></div>`}`);
    document.querySelector<HTMLFormElement>("#rule-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{await api("/api/rules",{method:"POST",body:JSON.stringify({...data,recipient_id:Number(data.recipient_id),priority:Number(data.priority)})});toast("Routing rule added.");await rulesPage();}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
    document.querySelectorAll<HTMLButtonElement>("[data-delete-rule]").forEach(button=>button.addEventListener("click",async()=>{if(!confirm(`Delete the route for ${button.dataset.name}?`))return;try{await api(`/api/rules/${button.dataset.deleteRule}`,{method:"DELETE"});toast("Rule deleted.");await rulesPage();}catch(error){toast(error instanceof Error?error.message:"Delete failed.");}}));
  }catch(error){handlePageError(error,"Routing rules");}
}

async function testPage():Promise<void>{
  let rules:Rule[]=[];try{rules=await api<Rule[]>("/api/rules");}catch(error){handlePageError(error,"Send a test");return;}
  const example=rules[0]?.match_value||"Initial consultation";
  appShell("Send a test","Send a sample booking through the real matching and delivery path.",`<section class="panel"><h2>Normalized booking</h2>${rules.length?"":`<div class="notice warning"><strong>No rules are configured.</strong> This test will stay unmatched.</div>`}<form id="test-form"><div class="form-grid"><div class="field"><label for="external-id">External ID</label><input id="external-id" name="external_id" value="test-${Date.now()}" required></div><div class="field"><label for="service">Service</label><input id="service" name="service" value="${escapeHtml(example)}" required></div><div class="field"><label for="provider">Provider</label><input id="provider" name="provider" value="Dr. Rivera"></div><div class="field"><label for="starts-at">Start time</label><input id="starts-at" name="starts_at" type="datetime-local"></div><div class="field"><label for="customer-name">Customer name</label><input id="customer-name" name="customer_name" value="Test booking"></div><div class="field"><label for="customer-email">Customer email</label><input id="customer-email" name="customer_email" type="email" value="test@example.invalid"></div></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button" type="submit">Route this test</button></div></form><div id="test-result" aria-live="polite"></div></section>`);
  document.querySelector<HTMLFormElement>("#test-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{const result=await api<{matched:boolean;delivery_status:string}>("/api/bookings/test",{method:"POST",body:JSON.stringify({...data,metadata:{source:"console-test"}})});document.querySelector("#test-result")!.innerHTML=`<div class="notice ${result.matched?"success":"warning"}"><strong>${result.matched?"Route matched.":"No rule matched."}</strong> Delivery state: ${escapeHtml(result.delivery_status)}. <a href="/dashboard" data-link>View on board →</a></div>`;bindInternalLinks();}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
}

async function settingsPage():Promise<void>{
  loadingPage("Settings","Manage intake security, retention, and the one-time license.");
  try{const config=await api<Config>("/api/config");const fresh=sessionStorage.getItem("new_webhook_secret");
    appShell("Settings","Manage intake security, retention, and the one-time license.",`<section class="panel"><h2>Workspace settings</h2><form id="config-form"><div class="form-grid"><div class="field"><label for="business-name">Business name</label><input id="business-name" name="business_name" value="${escapeHtml(config.business_name)}" required maxlength="160"></div><div class="field"><label for="retention-hours">Payload retention</label><select id="retention-hours" name="retention_hours">${[24,72,168,720].map(v=>`<option value="${v}" ${config.retention_hours===v?"selected":""}>${v===24?"24 hours":v===72?"3 days":v===168?"7 days":"30 days"}</option>`).join("")}</select></div></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button" type="submit">Save settings</button><button class="button secondary" type="button" id="purge">Purge expired now</button></div></form></section>
    <section class="panel"><h2>Signed intake endpoint</h2><p>Post normalized booking JSON to <code>${escapeHtml(config.public_base_url)}/api/bookings</code>.</p><p>Sign the exact bytes with HMAC-SHA256 in <code>X-Router-Signature</code>.</p>${fresh?`<p><strong>Copy this secret now.</strong> It is shown only once.</p><div class="secret" id="fresh-secret">${escapeHtml(fresh)}</div><div class="form-actions"><button class="button secondary" id="copy-secret">Copy secret</button></div>`:`<p>Current secret: <code>${escapeHtml(config.webhook_secret_hint)}</code></p><button class="button danger" id="rotate-secret">Rotate intake secret</button>`}</section>
    <section class="panel"><p class="eyebrow">One-time purchase · $39 USD</p><h2>${config.licensed?"Unlimited routing is active":"Restore an unlimited license"}</h2><p>The free router includes three recipients and three rules. A one-time license removes both limits.</p>${config.licensed?`<div class="notice success"><strong>License active.</strong> Unlimited recipients and rules are available.</div>`:`<div class="notice warning"><strong>New checkout is not registered yet.</strong> The free router remains available while billing registration is pending.</div><form id="license-form"><div class="field"><label for="license">Have a license? Paste it</label><input id="license" name="license" autocomplete="off" required></div><p class="error-text" data-form-error tabindex="-1" role="alert" hidden></p><div class="form-actions"><button class="button secondary" type="submit">Verify and restore</button></div></form>`}<p class="hint">Sociobot/Dodo handles checkout and refunds after registration. <a href="/terms" data-link>Read the purchase terms</a>.</p></section>`);
    bindSettingsActions(config);
  }catch(error){handlePageError(error,"Settings");}
}

function bindSettingsActions(config:Config):void{
  document.querySelector<HTMLFormElement>("#config-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{await api("/api/config",{method:"PATCH",body:JSON.stringify({...data,retention_hours:Number(data.retention_hours)})});toast("Settings saved.");}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
  document.querySelector("#purge")?.addEventListener("click",async()=>{try{const result=await api<{purged:number}>("/api/purge",{method:"POST"});toast(`${result.purged} expired payload${result.purged===1?"":"s"} purged.`);}catch(error){toast(error instanceof Error?error.message:"Purge failed.");}});
  document.querySelector("#copy-secret")?.addEventListener("click",async()=>{const value=document.querySelector("#fresh-secret")?.textContent||"";await navigator.clipboard.writeText(value);sessionStorage.removeItem("new_webhook_secret");toast("Secret copied.");});
  document.querySelector("#rotate-secret")?.addEventListener("click",async()=>{if(!confirm("Rotate the intake secret? Update the sender before its next booking."))return;try{const result=await api<{webhook_secret:string}>("/api/secret/rotate",{method:"POST"});sessionStorage.setItem("new_webhook_secret",result.webhook_secret);await settingsPage();toast("Secret rotated. Update your sender now.");}catch(error){toast(error instanceof Error?error.message:"Rotation failed.");}});
  document.querySelector<HTMLFormElement>("#license-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const license=String(new FormData(form).get("license")||"").trim();try{localStorage.setItem(`sb_license:${slug}`,license);const result=await api<{valid:boolean;reason:string}>("/api/license",{method:"POST",body:JSON.stringify({token:license})});localStorage.setItem(`sb_license_verdict:${slug}`,JSON.stringify({valid:result.valid,reason:result.reason,timestamp:Date.now()}));if(!result.valid)throw new Error(`License not active: ${result.reason}.`);toast("License restored. Unlimited routing is active.");await settingsPage();}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
  void reconcileLicense(config.licensed);
}

async function reconcileLicense(licensed:boolean):Promise<void>{
  const license=localStorage.getItem(`sb_license:${slug}`);if(!license||!token)return;
  const cacheKey=`sb_license_verdict:${slug}`;const cached=JSON.parse(localStorage.getItem(cacheKey)||"null") as {valid:boolean;timestamp:number}|null;
  if(licensed&&cached?.valid&&Date.now()-cached.timestamp<86400000)return;
  try{const response=await fetch(`https://api.sociobot.in/api/v1/products/${slug}/verify?license=${encodeURIComponent(license)}`);const verdict=await response.json() as {valid:boolean;reason:string};localStorage.setItem(cacheKey,JSON.stringify({...verdict,timestamp:Date.now()}));await api("/api/license",{method:"POST",body:JSON.stringify({token:license})});}catch{ /* The free router remains available when billing is unreachable. */ }
}

function legalPage(kind:"privacy"|"terms"):void{
  const privacy=`<article class="legal"><p class="eyebrow">Privacy policy · 6 September 2026</p><h1 tabindex="-1">Privacy</h1><p class="lede">Service Notification Router stores booking data on the server operated by your organization.</p><h2>Data the router stores</h2><p>It stores recipient settings, routing rules, delivery outcomes, and encrypted booking details.</p><p>The SQLite database and separate encryption key live in the configured data directory.</p><h2>Where data goes</h2><p>A matched notice goes to the email server or webhook destination configured by the administrator.</p><p>License verification sends the pasted license token to Sociobot.</p><p>The product does not use analytics, advertising trackers, CDN scripts, or third-party fonts.</p><h2>Your responsibilities</h2><p>Add only recipients who consented to operational notices. Secure server access and backups.</p><p>Use Settings to choose retention or purge expired details immediately.</p><h2>Privacy requests</h2><p>Send access or deletion requests to the organization operating your installation.</p></article>`;
  const terms=`<article class="legal"><p class="eyebrow">Terms · 6 September 2026</p><h1 tabindex="-1">Terms of use</h1><p class="lede">This router handles booking notices you already receive.</p><h2>License and operation</h2><p>The software uses the MIT License. You are responsible for hosting, sender authentication, consent, backups, and provider rules.</p><p>Do not use it for unsolicited messages or safety-critical dispatch.</p><h2>One-time purchase</h2><p>After checkout registration, $39 USD buys unlimited recipients and routing rules for this product.</p><p>The free tier keeps three recipients and three rules.</p><p>Sociobot/Dodo handles checkout and refunds. A license marked invalid removes paid limits at the next verification.</p><p>A license changes only the recipient and routing-rule limits.</p><h2>No warranty</h2><p>The software is supplied “as is,” without warranty.</p><p>Test delivery providers and monitor failures before using the router for live operations.</p><h2>Acceptable use</h2><p>Follow privacy, messaging, anti-spam, and other applicable laws.</p><p>Do not present a delivery attempt as guaranteed receipt.</p></article>`;
  publicShell(kind==="privacy"?privacy:terms,token?"Open router":"Sign in",kind==="privacy"?"Privacy — Service Notification Router":"Terms — Service Notification Router",kind==="privacy"?"How Service Notification Router stores and sends booking data.":"Terms for operating Service Notification Router and buying its one-time license.");
}

async function ackPage(tokenPart:string):Promise<void>{
  publicShell(`<section class="auth-sheet"><p class="eyebrow">Booking acknowledgment</p><h1 tabindex="-1">Loading this booking notice</h1><p role="status">Checking the acknowledgment link.</p></section>`,"Sign in","Acknowledge booking — Service Notification Router","Acknowledge responsibility for one routed booking notice.");
  try{const info=await api<{service:string;starts_at?:string;status:string;acknowledged_at?:string}>(`/api/ack/${encodeURIComponent(tokenPart)}`);publicShell(`<section class="auth-sheet"><p class="eyebrow">Booking acknowledgment</p><h1 tabindex="-1">${info.status==="acknowledged"?"Booking already acknowledged":"Acknowledge this booking"}</h1><p class="lede"><strong>${escapeHtml(info.service)}</strong>${info.starts_at?` · ${formatDate(info.starts_at)}`:""}</p><p>This confirms responsibility for the notice. It does not change the appointment.</p>${info.status==="acknowledged"?`<div class="notice success"><strong>Acknowledged.</strong> ${formatDate(info.acknowledged_at)}.</div>`:`<button class="button" id="acknowledge">Acknowledge booking</button>`}</section>`,"Sign in","Acknowledge booking — Service Notification Router","Acknowledge responsibility for one routed booking notice.");document.querySelector("#acknowledge")?.addEventListener("click",async event=>{const button=event.currentTarget as HTMLButtonElement;button.disabled=true;try{await api(`/api/ack/${encodeURIComponent(tokenPart)}`,{method:"POST"});await ackPage(tokenPart);}catch(error){toast(error instanceof Error?error.message:"Acknowledgment failed.");button.disabled=false;}});}catch(error){publicShell(`<section class="auth-sheet"><p class="eyebrow">Booking acknowledgment</p><h1 tabindex="-1">This link is unavailable</h1><p class="error-text">${escapeHtml(error instanceof Error?error.message:"The acknowledgment link is invalid.")}</p><p>Ask the booking administrator to resend the notice.</p></section>`,"Sign in","Link unavailable — Service Notification Router","This booking acknowledgment link is invalid or expired.");}
}

function handlePageError(error:unknown,title:string):void{
  const apiError=error as ApiError;if(apiError.status===401){navigate("/login",true);return;}
  appShell(title,"The requested data could not load.",`<div class="empty"><div class="stamp">!</div><h2>Could not load this page</h2><p>${escapeHtml(error instanceof Error?error.message:"The router did not respond.")}</p><button class="button" id="try-again">Try again</button></div>`);document.querySelector("#try-again")?.addEventListener("click",()=>void route());
}

async function route():Promise<void>{
  const path=location.pathname;
  if(path==="/demo"){await demoPage();return;}
  if(path==="/privacy"){legalPage("privacy");return;}if(path==="/terms"){legalPage("terms");return;}
  const ack=path.match(/^\/ack\/([^/]+)$/);if(ack?.[1]){await ackPage(ack[1]);return;}
  if(path==="/"){landing();return;}
  if(path==="/setup"){if(initialized)navigate("/login",true);else setupPage();return;}
  if(path==="/login"){loginPage();return;}
  if(!token){loginPage();return;}
  if(path==="/dashboard")await dashboardPage();else if(path==="/recipients")await recipientsPage();else if(path==="/rules")await rulesPage();else if(path==="/test")await testPage();else if(path==="/settings")await settingsPage();else navigate("/dashboard",true);
}

async function boot():Promise<void>{
  const url=new URL(location.href);const purchased=url.searchParams.get("license");if(purchased){localStorage.setItem(`sb_license:${slug}`,purchased);url.searchParams.delete("license");history.replaceState({},"",`${url.pathname}${url.search}`);}
  if(location.pathname==="/demo"){await route();registerServiceWorker();return;}
  try{initialized=(await api<{initialized:boolean}>("/api/status")).initialized;}catch(error){publicShell(`<div class="empty"><div class="stamp">!</div><h1 tabindex="-1">The router is offline</h1><p>${escapeHtml(error instanceof Error?error.message:"The service could not be reached.")}</p><button class="button" id="boot-retry">Try again</button></div>`,"Sign in","Offline — Service Notification Router","Reconnect to load Service Notification Router.");document.querySelector("#boot-retry")?.addEventListener("click",()=>void boot());registerServiceWorker();return;}
  await route();registerServiceWorker();
}

function registerServiceWorker(): void { if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{}); }

window.addEventListener("popstate",()=>void route());
window.addEventListener("online",()=>{document.querySelector<HTMLElement>("#offline")?.setAttribute("hidden","");toast("Back online.");});
window.addEventListener("offline",()=>document.querySelector<HTMLElement>("#offline")?.removeAttribute("hidden"));
void boot();
