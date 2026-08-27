import "./styles.css";
import { escapeHtml, formatDate } from "./utils";

const app = document.querySelector<HTMLDivElement>("#app")!;
const slug = "service-notification-router";
const sessionKey = "router_admin_session";
let token = sessionStorage.getItem(sessionKey) || "";
let initialized = false;

type ApiError = Error & { status?: number };
type Recipient = { id: number; name: string; channel: "email" | "webhook"; destination: string; consent_confirmed: boolean; active: boolean };
type Rule = { id: number; match_field: "service" | "provider"; match_value: string; recipient_id: number; recipient_name: string; priority: number; active: boolean };
type EventItem = { id: number | null; booking_id: string; service: string; provider?: string; starts_at?: string; recipient_name?: string; channel?: string; status: string; attempt_count: number; error?: string; acknowledged_at?: string; created_at: string; purged_at?: string };
type Config = { business_name: string; retention_hours: number; licensed: boolean; webhook_secret_hint: string; smtp_configured: boolean; recipient_count: number; rule_count: number; public_base_url: string };

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

function publicHeader(action = "Sign in"): string {
  return `<header class="topbar">
    <a class="brand" href="/" data-link><img src="/mark.svg" alt="" width="40" height="40"><span>Service Notification Router</span></a>
    <nav class="public-nav" aria-label="Utility"><a href="/privacy" data-link>Privacy</a><a class="button secondary" href="${action === "Open router" ? "#/dashboard" : "#/login"}">${action}</a></nav>
  </header>`;
}

function footer(): string {
  return `<footer class="public-footer"><span>Self-hosted. No trackers. Hero artwork generated originally for this product.</span><span class="footer-links"><a href="/privacy" data-link>Privacy</a><a href="/terms" data-link>Terms</a><a href="https://github.com/B-Divyesh/sf-service-notification-router">Source</a></span></footer>`;
}

function publicShell(content: string, action?: string): void {
  app.innerHTML = `<div class="site-shell">${publicHeader(action)}<main id="main" class="public-main">${content}</main>${footer()}</div><div class="toast-region" aria-live="polite" aria-atomic="true"></div>`;
  bindLinks();
}

function appShell(title: string, intro: string, content: string, action = ""): void {
  const current = (location.hash.slice(2) || "dashboard").split("/")[0];
  const nav = [
    ["dashboard", "⌂", "Delivery board"], ["rules", "↗", "Routing rules"], ["recipients", "◎", "Recipients"], ["test", "◇", "Send a test"], ["settings", "⚙", "Settings"]
  ].map(([id, glyph, label]) => `<a href="#/${id}" ${current === id ? 'aria-current="page"' : ""}><span class="nav-glyph" aria-hidden="true">${glyph}</span>${label}</a>`).join("");
  app.innerHTML = `<div class="site-shell">
    <header class="topbar"><a class="brand" href="#/dashboard"><img src="/mark.svg" alt="" width="40" height="40"><span>Notification Router</span></a><nav class="utility-nav" aria-label="Account"><button class="button quiet" id="logout">Sign out</button></nav></header>
    <div id="offline" class="offline-banner" role="status" ${navigator.onLine ? "hidden" : ""}>You’re offline. Existing details remain visible; changes will wait until you reconnect.</div>
    <div class="app-layout"><aside class="side-nav"><nav aria-label="Router">${nav}</nav></aside><main id="main" class="app-main"><div class="page-head"><div><p class="eyebrow">Routing room</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p></div>${action}</div>${content}</main></div>
    ${footer()}</div><div class="toast-region" aria-live="polite" aria-atomic="true"></div>`;
  document.querySelector("#logout")?.addEventListener("click", () => { token = ""; sessionStorage.removeItem(sessionKey); location.hash = "/login"; route(); });
  bindLinks();
}

function toast(message: string): void {
  const region = document.querySelector(".toast-region");
  if (!region) return;
  const item = document.createElement("div"); item.className = "toast"; item.textContent = message; region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function showFormError(form: HTMLFormElement, error: unknown): void {
  const slot = form.querySelector<HTMLElement>("[data-form-error]");
  if (slot) { slot.textContent = error instanceof Error ? error.message : "Something went wrong."; slot.hidden = false; slot.focus(); }
}

function setBusy(form: HTMLFormElement, busy: boolean): void {
  form.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = busy);
}

function bindLinks(): void {
  document.querySelectorAll<HTMLAnchorElement>("a[data-link]").forEach(link => link.addEventListener("click", event => {
    if (link.origin !== location.origin) return;
    event.preventDefault(); history.pushState({}, "", link.pathname); route();
  }));
}

function landing(): void {
  publicShell(`<section class="hero">
    <div><p class="eyebrow">Private by assignment</p><h1>Every booking, to the right person.</h1><p class="lede">Route existing booking notices by service or provider. Coordinators see only what they own, every delivery can be acknowledged, and retained details expire automatically.</p>
      <div class="hero-actions"><a class="button" href="${initialized ? "#/login" : "#/setup"}">${initialized ? "Open the routing room" : "Set up your router"}</a><a class="button secondary" href="#how">See how it routes</a></div>
      <ul class="trust-strip"><li>Signed intake</li><li>Encrypted payloads</li><li>No per-task fee</li></ul>
    </div>
    <figure class="hero-art"><picture><source media="(max-width:600px)" srcset="/assets/hero-routing-room-mobile.webp"><img src="/assets/hero-routing-room.webp" width="1200" height="800" fetchpriority="high" decoding="async" alt="A tactile paper booking slip follows a blue cord into only the scissors coordinator tray while a green acknowledgment stamp returns."></picture></figure>
  </section>
  <section class="intro-grid" id="how" aria-label="How it works"><article><p class="eyebrow">01 / Receive</p><h2>Verify at the door</h2><p>Your scheduler sends normalized JSON. HMAC verification rejects altered or unauthenticated notices.</p></article><article><p class="eyebrow">02 / Match</p><h2>Assign one owner</h2><p>Exact service or provider rules select the first responsible coordinator by priority.</p></article><article><p class="eyebrow">03 / Close the loop</p><h2>See delivery and acknowledgment</h2><p>Failed notices retry automatically. An acknowledgment link confirms the handoff.</p></article></section>`);
}

function setupPage(): void {
  publicShell(`<div class="setup-layout"><section class="auth-sheet"><p class="eyebrow">First run</p><h1>Open your routing room.</h1><p>Create the local administrator and choose how quickly appointment details disappear.</p>
    <form id="setup-form"><div class="form-grid"><div class="field full"><label for="business">Business name</label><input id="business" name="business_name" required maxlength="160" autocomplete="organization"></div><div class="field full"><label for="setup-password">Admin password</label><input id="setup-password" name="password" type="password" required minlength="12" autocomplete="new-password" aria-describedby="password-hint"><p class="hint" id="password-hint">At least 12 characters. Stored as a one-way Argon2 hash.</p></div><div class="field"><label for="retention">Delete payloads after</label><select id="retention" name="retention_hours"><option value="24">24 hours</option><option value="72" selected>3 days</option><option value="168">7 days</option><option value="720">30 days</option></select></div></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button" type="submit">Create the router</button></div></form>
  </section><aside class="setup-aside"><picture><source media="(max-width:600px)" srcset="/assets/hero-routing-room-mobile.webp"><img src="/assets/hero-routing-room.webp" width="1200" height="800" alt="One appointment slip routed along a blue cord to the correct service tray."></picture><p class="hint">The SQLite database and its separate encryption key stay on this server.</p></aside></div>`);
  document.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; setBusy(form, true);
    const data = Object.fromEntries(new FormData(form));
    try { const result = await api<{token:string;webhook_secret:string}>("/api/setup", { method:"POST", body:JSON.stringify({ ...data, retention_hours:Number(data.retention_hours) }) }); token=result.token; sessionStorage.setItem(sessionKey, token); initialized=true; sessionStorage.setItem("new_webhook_secret",result.webhook_secret); location.hash="/settings"; await route(); toast("Router created. Copy the intake secret before connecting your scheduler."); }
    catch(error){ showFormError(form,error); } finally { setBusy(form,false); }
  });
}

function loginPage(): void {
  publicShell(`<div class="setup-layout"><section class="auth-sheet"><p class="eyebrow">Administrator</p><h1>Return to the routing room.</h1><p>Sign in to review delivery, change assignments, or send a test booking.</p><form id="login-form"><div class="field"><label for="password">Admin password</label><input id="password" name="password" type="password" required autocomplete="current-password"></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button" type="submit">Sign in</button><a href="/" data-link>Back to overview</a></div></form></section><aside class="setup-aside"><img src="/assets/hero-routing-room-mobile.webp" width="800" height="533" alt="A paper route connects a booking to one coordinator tray."></aside></div>`);
  bindLinks();
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget as HTMLFormElement; setBusy(form,true); const password=String(new FormData(form).get("password")||""); try{const result=await api<{token:string}>("/api/login",{method:"POST",body:JSON.stringify({password})});token=result.token;sessionStorage.setItem(sessionKey,token);location.hash="/dashboard";await route();}catch(error){showFormError(form,error);}finally{setBusy(form,false);} });
}

function loadingPage(title: string, intro: string): void { appShell(title,intro,`<div class="empty" aria-busy="true"><div class="stamp">…</div><h2>Checking the board</h2><p>Reading the latest state from your router.</p></div>`); }

async function dashboardPage(): Promise<void> {
  loadingPage("Delivery board", "The latest handoffs and the outcomes that need attention.");
  try {
    const data = await api<{events:EventItem[];metrics:{received:number;delivered:number;acknowledged:number;unmatched:number}}>("/api/events");
    const m=data.metrics;
    const rows=data.events.map(event => `<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(event.service)}</p><p class="ticket-meta">${escapeHtml(event.provider||"No provider")} · ${formatDate(event.starts_at||event.created_at)}${event.purged_at?" · details purged":""}</p></div><div><strong>${escapeHtml(event.recipient_name||"No rule matched")}</strong><p class="ticket-meta">${escapeHtml(event.channel||"Needs assignment")}</p></div><span class="status ${escapeHtml(event.status)}">${escapeHtml(event.status)}</span><div class="row-actions">${event.status==="failed"&&event.id?`<button class="icon-button" data-retry="${event.id}" aria-label="Retry ${escapeHtml(event.service)} notification">Retry</button>`:""}</div></div>${event.error?`<p class="error-text">${escapeHtml(event.error)}</p>`:""}</li>`).join("");
    appShell("Delivery board","The latest handoffs and the outcomes that need attention.",`<section class="metrics" aria-label="Routing totals"><div class="metric"><strong>${m.received}</strong><span>Bookings received</span></div><div class="metric"><strong>${m.delivered}</strong><span>Notices delivered</span></div><div class="metric"><strong>${m.acknowledged}</strong><span>Acknowledged</span></div><div class="metric"><strong>${m.unmatched}</strong><span>Need a route</span></div></section><div class="section-head"><h2>Recent handoffs</h2><a href="#/test">Send a test →</a></div>${rows?`<ul class="ticket-list">${rows}</ul>`:`<div class="empty"><div class="stamp">0</div><h2>No booking notices yet</h2><p>Add a recipient and rule, then send a test. The result will appear here immediately.</p><a class="button" href="#/recipients">Add the first recipient</a></div>`}`);
    document.querySelectorAll<HTMLButtonElement>("[data-retry]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await api(`/api/events/${button.dataset.retry}/retry`,{method:"POST"});toast("Delivery retried.");await dashboardPage();}catch(error){toast(error instanceof Error?error.message:"Retry failed.");button.disabled=false;}}));
  } catch(error){ handlePageError(error,"Delivery board"); }
}

async function recipientsPage(): Promise<void> {
  loadingPage("Recipients","People or systems allowed to receive assigned booking notices.");
  try { const [recipients,config]=await Promise.all([api<Recipient[]>("/api/recipients"),api<Config>("/api/config")]);
    const list=recipients.map(r=>`<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(r.name)}</p><p class="ticket-meta">Consent confirmed</p></div><div><strong>${escapeHtml(r.channel)}</strong><p class="ticket-meta">${escapeHtml(r.destination)}</p></div><span class="status delivered">active</span><div class="row-actions"><button class="icon-button" data-delete-recipient="${r.id}" data-name="${escapeHtml(r.name)}">Delete</button></div></div></li>`).join("");
    appShell("Recipients","People or systems allowed to receive assigned booking notices.",`${!config.smtp_configured?`<div class="notice warning"><strong>Email needs SMTP.</strong> Email recipients can be saved now, but delivery will retry until SMTP_HOST and SMTP_FROM are configured on the server.</div>`:""}<section class="panel"><h2>Add a recipient</h2><form id="recipient-form"><div class="form-grid"><div class="field"><label for="recipient-name">Coordinator name</label><input id="recipient-name" name="name" required maxlength="160"></div><div class="field"><label for="channel">Channel</label><select id="channel" name="channel"><option value="email">Email</option><option value="webhook">Webhook</option></select></div><div class="field full"><label for="destination">Email address or webhook URL</label><input id="destination" name="destination" required aria-describedby="destination-hint"><p class="hint" id="destination-hint">Use a provider-approved operational channel. Webhooks may target your own SMS or messaging gateway.</p></div><div class="field full"><div class="check-row"><input id="consent" name="consent_confirmed" type="checkbox" required><label for="consent">This recipient agreed to receive operational booking notices.</label></div></div></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button" type="submit">Add recipient</button><span class="hint">${config.licensed?"Unlimited license active":`${recipients.length} of 3 free recipients used`}</span></div></form></section><div class="section-head"><h2>Current recipients</h2></div>${list?`<ul class="ticket-list">${list}</ul>`:`<div class="empty"><div class="stamp">◎</div><h2>No recipients yet</h2><p>Add the coordinator who should own one type of appointment.</p></div>`}`);
    bindRecipientActions();
  } catch(error){handlePageError(error,"Recipients");}
}

function bindRecipientActions(): void {
  document.querySelector<HTMLFormElement>("#recipient-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{await api("/api/recipients",{method:"POST",body:JSON.stringify({...data,consent_confirmed:data.consent_confirmed==="on"})});toast("Recipient added.");await recipientsPage();}catch(error){if((error as ApiError).status===402)toast("The free allowance is full. A one-time license unlocks unlimited recipients.");showFormError(form,error);}finally{setBusy(form,false);}});
  document.querySelectorAll<HTMLButtonElement>("[data-delete-recipient]").forEach(button=>button.addEventListener("click",async()=>{if(!confirm(`Delete ${button.dataset.name}? Any rules pointing to this recipient will also be removed.`))return;try{await api(`/api/recipients/${button.dataset.deleteRecipient}`,{method:"DELETE"});toast("Recipient and linked rules deleted.");await recipientsPage();}catch(error){toast(error instanceof Error?error.message:"Delete failed.");}}));
}

async function rulesPage(): Promise<void> {
  loadingPage("Routing rules","Exact service and provider matches, evaluated by priority.");
  try{const [rules,recipients,config]=await Promise.all([api<Rule[]>("/api/rules"),api<Recipient[]>("/api/recipients"),api<Config>("/api/config")]);
    const options=recipients.map(r=>`<option value="${r.id}">${escapeHtml(r.name)} · ${escapeHtml(r.channel)}</option>`).join("");
    const list=rules.map(rule=>`<li class="ticket"><div class="ticket-row"><div><p class="ticket-title">${escapeHtml(rule.match_value)}</p><p class="ticket-meta">Match ${escapeHtml(rule.match_field)} · priority ${rule.priority}</p></div><div class="route-map"><strong>${escapeHtml(rule.match_field)}</strong><span class="route-arrow" aria-hidden="true">→</span><strong>${escapeHtml(rule.recipient_name)}</strong></div><span class="status delivered">active</span><div class="row-actions"><button class="icon-button" data-delete-rule="${rule.id}" data-name="${escapeHtml(rule.match_value)}">Delete</button></div></div></li>`).join("");
    appShell("Routing rules","Exact service and provider matches, evaluated by priority.",`${recipients.length?`<section class="panel"><h2>Add a route</h2><form id="rule-form"><div class="form-grid"><div class="field"><label for="match-field">When this field</label><select id="match-field" name="match_field"><option value="service">Service</option><option value="provider">Provider</option></select></div><div class="field"><label for="match-value">Exactly equals</label><input id="match-value" name="match_value" required maxlength="160" placeholder="e.g. Dental cleaning"></div><div class="field"><label for="recipient-id">Send to</label><select id="recipient-id" name="recipient_id">${options}</select></div><div class="field"><label for="priority">Priority</label><input id="priority" name="priority" type="number" min="1" max="999" value="100"><p class="hint">Lower numbers run first.</p></div></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button" type="submit">Add routing rule</button><span class="hint">${config.licensed?"Unlimited license active":`${rules.length} of 3 free rules used`}</span></div></form></section>`:`<div class="notice warning"><strong>Add a recipient first.</strong> A route needs somewhere to deliver its notice. <a href="#/recipients">Add recipient →</a></div>`}<div class="section-head"><h2>Evaluation order</h2></div>${list?`<ul class="ticket-list">${list}</ul>`:`<div class="empty"><div class="stamp">↗</div><h2>No routes yet</h2><p>Create an exact service or provider match. Unmatched bookings stay visible on the delivery board without notifying a shared group.</p></div>`}`);
    document.querySelector<HTMLFormElement>("#rule-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{await api("/api/rules",{method:"POST",body:JSON.stringify({...data,recipient_id:Number(data.recipient_id),priority:Number(data.priority)})});toast("Routing rule added.");await rulesPage();}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
    document.querySelectorAll<HTMLButtonElement>("[data-delete-rule]").forEach(button=>button.addEventListener("click",async()=>{if(!confirm(`Delete the route for ${button.dataset.name}? Future matching bookings will be left unmatched.`))return;try{await api(`/api/rules/${button.dataset.deleteRule}`,{method:"DELETE"});toast("Rule deleted.");await rulesPage();}catch(error){toast(error instanceof Error?error.message:"Delete failed.");}}));
  }catch(error){handlePageError(error,"Routing rules");}
}

async function testPage():Promise<void>{
  let rules:Rule[]=[];try{rules=await api<Rule[]>("/api/rules");}catch(error){handlePageError(error,"Send a test");return;}
  const example=rules[0]?.match_value||"Initial consultation";
  appShell("Send a test","Exercise the same match, encrypted storage, delivery and acknowledgment path as a real booking.",`<section class="panel"><h2>Normalized booking</h2>${rules.length?"":`<div class="notice warning"><strong>No rules are configured.</strong> This test will be accepted as unmatched.</div>`}<form id="test-form"><div class="form-grid"><div class="field"><label for="external-id">External ID</label><input id="external-id" name="external_id" value="test-${Date.now()}" required></div><div class="field"><label for="service">Service</label><input id="service" name="service" value="${escapeHtml(example)}" required></div><div class="field"><label for="provider">Provider</label><input id="provider" name="provider" value="Dr. Rivera"></div><div class="field"><label for="starts-at">Start time</label><input id="starts-at" name="starts_at" type="datetime-local"></div><div class="field"><label for="customer-name">Customer name</label><input id="customer-name" name="customer_name" value="Test booking"></div><div class="field"><label for="customer-email">Customer email</label><input id="customer-email" name="customer_email" type="email" value="test@example.invalid"></div></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button" type="submit">Route this test</button></div></form><div id="test-result" aria-live="polite"></div></section>`);
  document.querySelector<HTMLFormElement>("#test-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{const result=await api<{matched:boolean;delivery_status:string;booking_id:string}>("/api/bookings/test",{method:"POST",body:JSON.stringify({...data,metadata:{source:"console-test"}})});document.querySelector("#test-result")!.innerHTML=`<div class="notice ${result.matched?"success":"warning"}"><strong>${result.matched?"Route matched.":"No rule matched."}</strong> Delivery state: ${escapeHtml(result.delivery_status)}. <a href="#/dashboard">View on board →</a></div>`;}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
}

async function settingsPage():Promise<void>{
  loadingPage("Settings","Intake security, retention and the one-time unlimited unlock.");
  try{const config=await api<Config>("/api/config");const fresh=sessionStorage.getItem("new_webhook_secret");
    appShell("Settings","Intake security, retention and the one-time unlimited unlock.",`<section class="panel"><h2>Workspace</h2><form id="config-form"><div class="form-grid"><div class="field"><label for="business-name">Business name</label><input id="business-name" name="business_name" value="${escapeHtml(config.business_name)}" required maxlength="160"></div><div class="field"><label for="retention-hours">Payload retention</label><select id="retention-hours" name="retention_hours">${[24,72,168,720].map(v=>`<option value="${v}" ${config.retention_hours===v?"selected":""}>${v===24?"24 hours":v===72?"3 days":v===168?"7 days":"30 days"}</option>`).join("")}</select></div></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button" type="submit">Save settings</button><button class="button secondary" type="button" id="purge">Purge expired now</button></div></form></section>
    <section class="panel"><h2>Signed intake endpoint</h2><p>POST normalized booking JSON to <code>${escapeHtml(config.public_base_url)}/api/bookings</code>. Sign the exact request bytes with HMAC-SHA256 and send <code>X-Router-Signature: sha256=&lt;hex&gt;</code>.</p>${fresh?`<p><strong>Copy this secret now.</strong> It is shown only once.</p><div class="secret" id="fresh-secret">${escapeHtml(fresh)}</div><div class="form-actions"><button class="button secondary" id="copy-secret">Copy secret</button></div>`:`<p>Current secret: <code>${escapeHtml(config.webhook_secret_hint)}</code></p><button class="button danger" id="rotate-secret">Rotate intake secret</button>`}<details><summary>Example payload</summary><pre class="code">{
  "external_id": "apt_1048",
  "service": "Dental cleaning",
  "provider": "Dr. Rivera",
  "starts_at": "2026-08-28T09:30:00Z",
  "customer_name": "A. Patient",
  "customer_email": "patient@example.com",
  "metadata": { "source": "scheduler" }
}</pre></details></section>
    <section class="panel"><p class="eyebrow">One-time purchase · $39 USD</p><h2>${config.licensed?"Unlimited routing is active":"Unlock unlimited routing"}</h2><p>The free router includes three recipients and three rules, signed intake, delivery retries, acknowledgments, export-safe operations and automatic purging. A one-time license removes the routing limits on this installation.</p>${config.licensed?`<div class="notice success"><strong>License active.</strong> Unlimited recipients and rules are available.</div>`:`<div class="form-actions"><a class="button" href="https://api.sociobot.in/api/v1/products/${slug}/checkout">Buy once for $39</a></div><hr class="divider"><form id="license-form"><div class="field"><label for="license">Have a license? Paste it</label><input id="license" name="license" autocomplete="off" required></div><p class="error-text" data-form-error tabindex="-1" hidden></p><div class="form-actions"><button class="button secondary" type="submit">Verify and restore</button></div></form>`}<p class="hint">Sociobot/Dodo is the merchant of record. Refunds are handled there and revoke the license automatically. <a href="/terms" data-link>Purchase terms</a>.</p></section>`);
    bindLinks();bindSettingsActions(config);
  }catch(error){handlePageError(error,"Settings");}
}

function bindSettingsActions(config:Config):void{
  document.querySelector<HTMLFormElement>("#config-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const data=Object.fromEntries(new FormData(form));try{await api("/api/config",{method:"PATCH",body:JSON.stringify({...data,retention_hours:Number(data.retention_hours)})});toast("Settings saved.");}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
  document.querySelector("#purge")?.addEventListener("click",async()=>{try{const result=await api<{purged:number}>("/api/purge",{method:"POST"});toast(`${result.purged} expired payload${result.purged===1?"":"s"} purged.`);}catch(error){toast(error instanceof Error?error.message:"Purge failed.");}});
  document.querySelector("#copy-secret")?.addEventListener("click",async()=>{const value=document.querySelector("#fresh-secret")?.textContent||"";await navigator.clipboard.writeText(value);sessionStorage.removeItem("new_webhook_secret");toast("Secret copied.");});
  document.querySelector("#rotate-secret")?.addEventListener("click",async()=>{if(!confirm("Rotate the intake secret? The current sender will fail until you update it with the new secret."))return;try{const result=await api<{webhook_secret:string}>("/api/secret/rotate",{method:"POST"});sessionStorage.setItem("new_webhook_secret",result.webhook_secret);await settingsPage();toast("Secret rotated. Update your sender now.");}catch(error){toast(error instanceof Error?error.message:"Rotation failed.");}});
  document.querySelector<HTMLFormElement>("#license-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;setBusy(form,true);const license=String(new FormData(form).get("license")||"").trim();try{localStorage.setItem(`sb_license:${slug}`,license);const result=await api<{valid:boolean;reason:string}>("/api/license",{method:"POST",body:JSON.stringify({token:license})});localStorage.setItem(`sb_license_verdict:${slug}`,JSON.stringify({valid:result.valid,reason:result.reason,timestamp:Date.now()}));if(!result.valid)throw new Error(`License not active: ${result.reason}.`);toast("License restored. Unlimited routing is active.");await settingsPage();}catch(error){showFormError(form,error);}finally{setBusy(form,false);}});
  if(!config.licensed)void reconcileLicense();
}

async function reconcileLicense():Promise<void>{
  const license=localStorage.getItem(`sb_license:${slug}`);if(!license||!token)return;
  const cacheKey=`sb_license_verdict:${slug}`;const cached=JSON.parse(localStorage.getItem(cacheKey)||"null") as {valid:boolean;timestamp:number}|null;
  if(cached?.valid&&Date.now()-cached.timestamp<86400000){try{await api("/api/license",{method:"POST",body:JSON.stringify({token:license})});}catch{}return;}
  try{const response=await fetch(`https://api.sociobot.in/api/v1/products/${slug}/verify?license=${encodeURIComponent(license)}`);const verdict=await response.json() as {valid:boolean;reason:string};localStorage.setItem(cacheKey,JSON.stringify({...verdict,timestamp:Date.now()}));if(verdict.valid)await api("/api/license",{method:"POST",body:JSON.stringify({token:license})});}catch{ /* Free experience remains available offline. */ }
}

function legalPage(kind:"privacy"|"terms"):void{
  const privacy=`<article class="legal"><p class="eyebrow">Plain-language policy · 27 August 2026</p><h1>Privacy, kept close.</h1><p class="lede">Service Notification Router is self-hosted. Booking data goes to the server you operate, not to a Param Factory analytics account.</p><h2>What the router stores</h2><p>It stores the administrator password as a one-way Argon2 hash, recipient routing settings, delivery outcomes, and an encrypted booking payload until your configured retention period expires. The separate encryption key and SQLite database live in your configured data directory.</p><h2>Where data goes</h2><p>A matched notice goes only to the email server or webhook destination you configure. License verification sends only the pasted license token to Sociobot. The product has no analytics, advertising trackers, CDN scripts, or third-party fonts.</p><h2>Your responsibilities</h2><p>Only add recipients who consented to operational notices. Configure retention appropriately, secure server access and backups, and follow your email, SMS, or messaging provider policies. Purge is available at any time in Settings.</p><h2>Operator requests</h2><p>This software does not give the project maintainer access to your installation. Data access or deletion requests must be handled by the organization operating that installation.</p></article>`;
  const terms=`<article class="legal"><p class="eyebrow">Terms · 27 August 2026</p><h1>Terms of use.</h1><p class="lede">This is a narrow operational router for bookings you already receive. It is not a scheduler, marketing platform, or emergency notification system.</p><h2>License and operation</h2><p>The software is provided under the MIT License. You are responsible for hosting, sender authentication, recipients, channel consent, backups and compliance with provider rules. Do not use it for unsolicited messages or safety-critical dispatch.</p><h2>One-time unlimited unlock</h2><p>The $39 USD purchase unlocks unlimited recipients and routing rules for this product. The free tier remains useful with three of each. Sociobot/Dodo is merchant of record and handles checkout and refunds. A refunded, expired, wrong-product or revoked license no longer unlocks paid features. Core data access, purging and accessibility are never paywalled.</p><h2>No warranty</h2><p>The software is supplied “as is,” without warranty. Test your delivery providers and monitor failures before relying on the router in live operations. Liability is limited to the fullest extent permitted by law.</p><h2>Acceptable use</h2><p>You may not use the router to violate privacy, messaging, anti-spam or other applicable laws. You may not present a delivery attempt as guaranteed receipt.</p></article>`;
  publicShell(kind==="privacy"?privacy:terms,token?"Open router":"Sign in");
}

async function ackPage(tokenPart:string):Promise<void>{
  publicShell(`<section class="auth-sheet"><p class="eyebrow">Booking handoff</p><h1>Loading acknowledgment…</h1><p role="status">Checking this private handoff link.</p></section>`);
  try{const info=await api<{service:string;starts_at?:string;status:string;acknowledged_at?:string}>(`/api/ack/${encodeURIComponent(tokenPart)}`);publicShell(`<section class="auth-sheet"><p class="eyebrow">Booking handoff</p><h1>${info.status==="acknowledged"?"Already acknowledged.":"Confirm you have it."}</h1><p class="lede"><strong>${escapeHtml(info.service)}</strong>${info.starts_at?` · ${formatDate(info.starts_at)}`:""}</p><p>This confirms responsibility for the notice. It does not change or cancel the appointment.</p>${info.status==="acknowledged"?`<div class="notice success"><strong>Handoff closed.</strong> Acknowledged ${formatDate(info.acknowledged_at)}.</div>`:`<button class="button" id="acknowledge">Acknowledge this booking</button>`}</section>`);document.querySelector("#acknowledge")?.addEventListener("click",async event=>{const button=event.currentTarget as HTMLButtonElement;button.disabled=true;try{await api(`/api/ack/${encodeURIComponent(tokenPart)}`,{method:"POST"});await ackPage(tokenPart);}catch(error){toast(error instanceof Error?error.message:"Acknowledgment failed.");button.disabled=false;}});}catch(error){publicShell(`<section class="auth-sheet"><p class="eyebrow">Link unavailable</p><h1>We couldn’t open this handoff.</h1><p class="error-text">${escapeHtml(error instanceof Error?error.message:"The acknowledgment link is invalid.")}</p><p>Ask the booking administrator to resend the notice.</p></section>`);}
}

function handlePageError(error:unknown,title:string):void{
  const apiError=error as ApiError;if(apiError.status===401){location.hash="/login";void route();return;}
  appShell(title,"The requested state could not be loaded.",`<div class="empty"><div class="stamp">!</div><h2>Something blocked the route</h2><p>${escapeHtml(error instanceof Error?error.message:"The router could not load this page.")}</p><button class="button" id="try-again">Try again</button></div>`);document.querySelector("#try-again")?.addEventListener("click",()=>route());
}

async function route():Promise<void>{
  const path=location.pathname;
  if(path==="/privacy"){legalPage("privacy");return;}if(path==="/terms"){legalPage("terms");return;}
  const ack=path.match(/^\/ack\/([^/]+)$/);if(ack?.[1]){await ackPage(ack[1]);return;}
  const page=location.hash.replace(/^#\/?/,"")||"home";
  if(page==="home"){landing();return;}if(page==="setup"&&!initialized){setupPage();return;}if(page==="login"||!token){loginPage();return;}
  if(page==="dashboard")await dashboardPage();else if(page==="recipients")await recipientsPage();else if(page==="rules")await rulesPage();else if(page==="test")await testPage();else if(page==="settings")await settingsPage();else{location.hash="/dashboard";}
}

async function boot():Promise<void>{
  const url=new URL(location.href);const purchased=url.searchParams.get("license");if(purchased){localStorage.setItem(`sb_license:${slug}`,purchased);url.searchParams.delete("license");history.replaceState({},"",url.pathname+url.search+url.hash);}
  try{initialized=(await api<{initialized:boolean}>("/api/status")).initialized;}catch(error){publicShell(`<div class="empty"><div class="stamp">!</div><h1>The router is offline.</h1><p>${escapeHtml(error instanceof Error?error.message:"The service could not be reached.")}</p><button class="button" id="boot-retry">Try again</button></div>`);document.querySelector("#boot-retry")?.addEventListener("click",()=>boot());return;}
  await route();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
}

window.addEventListener("hashchange",()=>route());window.addEventListener("popstate",()=>route());
window.addEventListener("online",()=>{document.querySelector<HTMLElement>("#offline")?.setAttribute("hidden","");toast("Back online.");});window.addEventListener("offline",()=>document.querySelector<HTMLElement>("#offline")?.removeAttribute("hidden"));
void boot();
