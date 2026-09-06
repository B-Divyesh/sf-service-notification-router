import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseURL = "http://127.0.0.1:4179";
const productionOrigin = "https://service-notification-router.sociobot.in";
const setupProof = "claim-test-bootstrap-proof-123456789";

function signature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function claimDataDir(): string {
  return readdirSync("/tmp")
    .filter(name => name.startsWith("service-notification-router-claims."))
    .map(name => `/tmp/${name}`)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}

function claimDatabase(): string {
  const dir = claimDataDir();
  const files = readdirSync(dir);
  for (const name of ["router.storage.sqlite3", "router.sqlite3", "router.db"]) {
    if (files.includes(name) && statSync(join(dir, name)).size > 0) return join(dir, name);
  }
  throw new Error("The test runtime did not create a populated SQLite database.");
}

async function postSigned(api: APIRequestContext, secret: string, booking: Record<string, unknown>) {
  const body = JSON.stringify(booking);
  return api.post("/api/bookings", { data: body, headers: { "content-type": "application/json", "x-router-signature": signature(secret, body) } });
}

test("@claim:setup-protection a public visitor cannot claim an empty router", async ({ request }) => {
  const before = await request.get("/api/status");
  expect((await before.json()).initialized).toBe(false);
  const attempt = await request.post("/api/setup", { data: { business_name: "Takeover", password: "long public password", retention_hours: 72, setup_proof: "wrong-public-code-that-is-long" } });
  expect(attempt.status()).toBe(403);
  const after = await request.get("/api/status");
  expect((await after.json()).initialized).toBe(false);
});

test("@claim:job-and-audience the phone first screen states the job, audience, and first action", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Route each booking to its coordinator");
  await expect(page.getByText(/micro-clinics, studios/)).toBeVisible();
  const action = page.getByRole("link", { name: "Try it with sample data" });
  await expect(action).toBeVisible();
  expect((await action.boundingBox())!.y).toBeLessThan(844);
  await context.close();
});

test("@claim:demo-sample one click opens realistic populated results", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText("Demo — sample data, nothing is saved")).toBeVisible();
  await expect(page.getByText("Dental cleaning", { exact: true })).toBeVisible();
  await expect(page.getByText("Prenatal consultation", { exact: true })).toBeVisible();
  await expect(page.getByText("New patient assessment", { exact: true })).toBeVisible();
  await expect(page.getByText("Sofia Mendes", { exact: true }).first()).toBeVisible();
});

test("@claim:demo-isolation reset stays in the sample API namespace", async ({ page }) => {
  const apiPaths: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/")) apiPaths.push(new URL(request.url()).pathname); });
  await page.goto("/demo");
  await expect(page.getByText("Demo — sample data, nothing is saved")).toBeVisible();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("New patient assessment", { exact: true })).toBeVisible();
  expect(apiPaths.length).toBeGreaterThan(0);
  expect(apiPaths.every(path => path.startsWith("/api/demo"))).toBe(true);
  await page.getByRole("button", { name: "Start for real" }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  expect(apiPaths.some(path => /^\/api\/demo\/[^/]+$/.test(path))).toBe(true);
});

test("@claim:privacy-network landing and demo use no tracker or CDN requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()); });
  await page.goto("/");
  await page.getByRole("link", { name: "Try it with sample data" }).click();
  await expect(page.getByText("Demo — sample data, nothing is saved")).toBeVisible();
  expect(external).toEqual([]);
});

test("@claim:offline-recovery an offline reload shows a clear retry screen", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "The router is offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await context.close();
});

test("@claim:free-paid-limits the public price and free allowance are exact", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("$39 USD once after checkout registration")).toBeVisible();
  await expect(page.getByText("The free tier includes three recipients and three rules.", { exact: false })).toBeVisible();
});

test("@claim:scope-boundaries the demo exposes routing only", async ({ page }) => {
  const requests: string[] = []; page.on("request", request => requests.push(request.url()));
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Review routed booking notices" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sample routing rules" })).toBeVisible();
  expect(requests.some(url => /whatsapp|marketing|\/api\/appointments/.test(url))).toBe(false);
});

test("@claim:runtime-persistence a PORT-only process protects setup and keeps SQLite state after restart", async () => {
  const root = resolve(process.cwd(), ".."); const binary = join(root, "target/debug/service-notification-router");
  const work = mkdtempSync(join(tmpdir(), "snr-port-only-")); const serviceURL = "http://127.0.0.1:4182";
  let output = "";
  const start = (): ChildProcess => {
    const child = spawn(binary, [], { cwd: work, env: { PATH: process.env.PATH || "", PORT: "4182" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", chunk => { output += chunk.toString(); }); child.stderr?.on("data", chunk => { output += chunk.toString(); }); return child;
  };
  const waitForHealth = async () => { for (let attempt = 0; attempt < 60; attempt += 1) { try { if ((await fetch(`${serviceURL}/health`)).ok) return; } catch {} await new Promise(resolveWait => setTimeout(resolveWait, 100)); } throw new Error("PORT-only server did not start"); };
  let child = start();
  try {
    await waitForHealth(); const proofPath = join(work, "data/router.setup-code"); expect(statSync(proofPath).mode & 0o777).toBe(0o600);
    const proof = readFileSync(proofPath, "utf8").trim();
    const setup = await fetch(`${serviceURL}/api/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ business_name: "Persistent Clinic", password: "correct horse battery", retention_hours: 24, setup_proof: proof }) }); expect(setup.status).toBe(201);
    child.kill("SIGTERM"); await new Promise(resolveExit => child.once("exit", resolveExit));
    const database = join(work, "data/router.storage.sqlite3");
    const locker = spawn("python3", ["-u", "-c", "import sqlite3,sys,time; db=sqlite3.connect(sys.argv[1]); db.execute('BEGIN EXCLUSIVE'); print('locked', flush=True); time.sleep(3); db.commit()", database], { stdio: ["ignore", "pipe", "pipe"] });
    const lockerDone = new Promise(resolveExit => locker.once("exit", resolveExit));
    await new Promise<void>((resolveLock, rejectLock) => { locker.stdout?.once("data", () => resolveLock()); locker.once("error", rejectLock); });
    child = start(); await waitForHealth(); expect(locker.exitCode).toBeNull(); await lockerDone;
    expect((await (await fetch(`${serviceURL}/api/status`)).json()).initialized).toBe(true);
    expect((await fetch(`${serviceURL}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) })).status).toBe(200);
    expect(output).toContain("configuration ready"); expect(output).not.toContain(proof);
  } finally { child.kill("SIGTERM"); rmSync(work, { recursive: true, force: true }); }
});

test.describe.serial("real router claim outcomes", () => {
  let api: APIRequestContext;
  let auth = "";
  let secret = "";
  let firstRecipient = 0;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL });
    const setup = await api.post("/api/setup", { data: { business_name: "Harbor Clinic", password: "correct horse battery", retention_hours: 1, setup_proof: setupProof } });
    expect(setup.status()).toBe(201);
    const setupBody = await setup.json(); auth = `Bearer ${setupBody.token}`; secret = setupBody.webhook_secret;
    const headers = { authorization: auth };
    const r1 = await api.post("/api/recipients", { headers, data: { name: "Sofia Mendes", channel: "email", destination: "sofia@example.invalid", consent_confirmed: true } });
    const r2 = await api.post("/api/recipients", { headers, data: { name: "Clinic desk", channel: "email", destination: "desk@example.invalid", consent_confirmed: true } });
    const r3 = await api.post("/api/recipients", { headers, data: { name: "Amina Yusuf", channel: "webhook", destination: "http://127.0.0.1:4190/booking", consent_confirmed: true } });
    firstRecipient = (await r1.json()).id; const second = (await r2.json()).id; const third = (await r3.json()).id;
    await api.post("/api/rules", { headers, data: { match_field: "service", match_value: "Dental cleaning", recipient_id: firstRecipient, priority: 20 } });
    await api.post("/api/rules", { headers, data: { match_field: "service", match_value: "Dental cleaning", recipient_id: second, priority: 10 } });
    await api.post("/api/rules", { headers, data: { match_field: "provider", match_value: "Dr. Shah", recipient_id: third, priority: 30 } });
  });

  test.afterAll(async () => { await api.dispose(); });

  test("@claim:signed-intake changed or unsigned booking data is rejected", async () => {
    const booking = JSON.stringify({ external_id: "signed-1", service: "Dental cleaning" });
    const changed = await api.post("/api/bookings", { data: `${booking} `, headers: { "content-type": "application/json", "x-router-signature": signature(secret, booking) } });
    expect(changed.status()).toBe(401);
    expect((await api.post("/api/bookings", { data: booking, headers: { "content-type": "application/json" } })).status()).toBe(401);
  });

  test("@claim:routing-rules service rules use priority and provider rules reach one recipient", async () => {
    const service = await postSigned(api, secret, { external_id: "route-service-1", service: "Dental cleaning", provider: "Dr. Other", customer_name: "Taylor Patient" });
    expect(service.status()).toBe(202); expect((await service.json()).matched).toBe(true);
    const events = await (await api.get("/api/events", { headers: { authorization: auth } })).json();
    expect(events.events.find((item: EventItem) => item.service === "Dental cleaning")?.recipient_name).toBe("Clinic desk");

    let received: Buffer | undefined; let receivedSignature = ""; let resolveReceived: (() => void) | undefined;
    const receivedPromise = new Promise<void>(resolve => { resolveReceived = resolve; });
    const server: Server = createServer((request, response) => { const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(chunk)); request.on("end", () => { received = Buffer.concat(chunks); receivedSignature = String(request.headers["x-router-signature"] || ""); response.statusCode = 204; response.end(); resolveReceived?.(); }); });
    await new Promise<void>(resolve => server.listen(4190, "127.0.0.1", resolve));
    const provider = await postSigned(api, secret, { external_id: "route-provider-1", service: "General visit", provider: "Dr. Shah", customer_name: "Morgan Patient" });
    expect(provider.status()).toBe(202); await receivedPromise; await new Promise<void>(resolve => server.close(() => resolve()));
    const payload = JSON.parse(received!.toString());
    expect(payload.event).toBe("booking.routed"); expect(payload.recipient).toBe("Amina Yusuf"); expect(payload.booking.provider).toBe("Dr. Shah");
    expect(payload.acknowledgment_url).toMatch(/^https:\/\/service-notification-router\.sociobot\.in\/ack\//);
    expect(receivedSignature).toBe(signature(secret, received!.toString()));
  });

  test("@claim:delivery-ack each matched notice has a working acknowledgment", async () => {
    const response = await postSigned(api, secret, { external_id: "ack-1", service: "Dental cleaning", provider: "Dr. Rivera", starts_at: "2026-09-10T09:00:00Z" });
    const result = await response.json(); expect(result.acknowledgment_url).toMatch(new RegExp(`^${productionOrigin}/ack/`));
    const tokenPart = new URL(result.acknowledgment_url).pathname.split("/").pop()!;
    expect((await api.get(`/api/ack/${tokenPart}`)).status()).toBe(200);
    expect((await api.post(`/api/ack/${tokenPart}`)).status()).toBe(200);
    expect((await (await api.get(`/api/ack/${tokenPart}`)).json()).status).toBe("acknowledged");
  });

  test("@claim:delivery-retry an administrator can retry a failed notice", async () => {
    await postSigned(api, secret, { external_id: "retry-1", service: "Dental cleaning", customer_name: "Retry Patient" });
    let events = await (await api.get("/api/events", { headers: { authorization: auth } })).json();
    const item = events.events.find((entry: EventItem) => entry.booking_id && entry.service === "Dental cleaning" && entry.status === "failed");
    expect(item.attempt_count).toBeGreaterThanOrEqual(1);
    const retried = await api.post(`/api/events/${item.id}/retry`, { headers: { authorization: auth } });
    expect(retried.status()).toBe(200);
    events = await (await api.get("/api/events", { headers: { authorization: auth } })).json();
    expect(events.events.find((entry: EventItem) => entry.id === item.id).attempt_count).toBeGreaterThan(item.attempt_count);
  });

  test("@claim:encrypted-retention booking details are encrypted and can be purged", async () => {
    await postSigned(api, secret, { external_id: "private-1", service: "Dental cleaning", customer_name: "Unique Private Patient", customer_email: "private-person@example.invalid" });
    await new Promise(resolve => setTimeout(resolve, 100));
    const dir = claimDataDir();
    const database = claimDatabase();
    const bytes = [database, `${database}-wal`].map(name => { try { return readFileSync(name).toString("latin1"); } catch { return ""; } }).join("");
    expect(bytes).not.toContain("Unique Private Patient"); expect(bytes).not.toContain("private-person@example.invalid");
    expect(statSync(`${dir}/router.key`).mode & 0o777).toBe(0o600);
    const update = spawnSync("python3", ["-c", "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute(\"update bookings set received_at='2020-01-01T00:00:00Z' where external_id='private-1'\"); db.commit()", claimDatabase()]);
    expect(update.status).toBe(0);
    const purge = await api.post("/api/purge", { headers: { authorization: auth } }); expect((await purge.json()).purged).toBeGreaterThanOrEqual(1);
    const events = await (await api.get("/api/events", { headers: { authorization: auth } })).json();
    expect(events.events.some((entry: EventItem) => entry.purged_at)).toBe(true);
  });

  test("@claim:free-allowance the fourth recipient and fourth rule need a license", async () => {
    const headers = { authorization: auth };
    const recipient = await api.post("/api/recipients", { headers, data: { name: "Fourth", channel: "email", destination: "fourth@example.invalid", consent_confirmed: true } });
    expect(recipient.status()).toBe(402);
    const rule = await api.post("/api/rules", { headers, data: { match_field: "service", match_value: "Fourth service", recipient_id: firstRecipient, priority: 40 } });
    expect(rule.status()).toBe(402);
  });

  test("@claim:request-limits forwarded clients get independent 429 responses with Retry-After", async () => {
    const headers = { "x-forwarded-for": "198.51.100.55, 10.0.0.4" };
    for (let count = 0; count < 120; count += 1) expect((await api.get("/api/status", { headers })).status()).toBe(200);
    const blocked = await api.get("/api/status", { headers }); expect(blocked.status()).toBe(429); expect(blocked.headers()["retry-after"]).toBe("60");
    expect((await api.get("/api/status", { headers: { "x-forwarded-for": "198.51.100.56, 10.0.0.4" } })).status()).toBe(200);
  });

  test("@claim:license-recheck an invalid daily verdict removes paid limits", async () => {
    let valid = true;
    const billingRequests: Array<{ method?: string; url?: string }> = [];
    const billing = createServer((request, response) => { billingRequests.push({ method: request.method, url: request.url }); response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ valid, reason: valid ? "ok" : "revoked", expires_at: null })); });
    await new Promise<void>(resolve => billing.listen(4191, "127.0.0.1", resolve));
    const headers = { authorization: auth };
    const activated = await api.post("/api/license", { headers, data: { token: "test-license-token-123456789" } }); expect((await activated.json()).valid).toBe(true);
    const query = new URL(billingRequests[0]!.url!, "http://127.0.0.1:4191"); expect(billingRequests[0]!.method).toBe("GET"); expect([...query.searchParams.keys()]).toEqual(["license"]);
    expect((await (await api.get("/api/config", { headers })).json()).licensed).toBe(true);
    valid = false; const dir = claimDataDir();
    const update = spawnSync("python3", ["-c", "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute(\"update settings set license_checked_at='2020-01-01T00:00:00Z'\"); db.commit()", claimDatabase()]); expect(update.status).toBe(0);
    expect((await (await api.get("/api/config", { headers })).json()).licensed).toBe(false);
    await new Promise<void>(resolve => billing.close(() => resolve()));
  });

  test("@claim:health-build health returns the compiled build identity", async () => {
    const health = await (await api.get("/health")).json(); expect(health).toEqual({ status: "ok", build: "claim-test-build" });
  });
});

test("site routes have titles, focus, full-size mobile controls, and a designed 404", async ({ page }) => {
  for (const [path, title] of [["/privacy", "Privacy — Service Notification Router"], ["/terms", "Terms — Service Notification Router"], ["/demo", "Demo — Service Notification Router"]]) {
    await page.goto(path); await expect(page).toHaveTitle(title);
  }
  await page.goto("/"); await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Privacy" }).click(); await expect(page.locator("h1")).toBeFocused();
  await page.goBack(); await expect(page.locator("h1")).toBeFocused();
  await page.getByRole("link", { name: "Try it with sample data" }).click(); await expect(page.getByRole("heading", { name: "Review routed booking notices" })).toBeFocused();
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Route each booking to its coordinator" })).toBeVisible(); await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#main")).toBeFocused();
  const response = await page.goto("/definitely-missing"); expect(response?.status()).toBe(404); await expect(page.getByRole("heading", { name: "This route does not exist" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/demo", "/privacy", "/terms"]) {
    await page.goto(path);
    const controls = page.locator("a, button");
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox();
      expect(box, `${path} control ${index} needs a layout box`).not.toBeNull();
      expect(box!.width, `${path} control ${index} is too narrow`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${path} control ${index} is too short`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("accessibility has no serious or critical axe findings", async ({ page }) => {
  for (const path of ["/", "/demo", "/privacy", "/terms"]) {
    await page.goto(path); const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(item => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  }
});

test("reduced motion removes decorative transforms", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" }); const page = await context.newPage(); await page.goto("/");
  await expect(page.locator(".hero-art")).toHaveCSS("transform", "none"); await context.close();
});
