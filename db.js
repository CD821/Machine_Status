const config = window.TTS_CONFIG || {};

const backendApiBase = String(config.BACKEND_API_URL || "").replace(/\/$/, "");
const clerkPublishableKey = String(config.CLERK_PUBLISHABLE_KEY || "");
const backendEnabled = Boolean(backendApiBase || clerkPublishableKey);

const supabaseEnabled = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
const supabaseSessionKey = "tts-supabase-session";
const clerkSignedInKey = "tts-clerk-signed-in";

let clerkInstancePromise = null;

function currentSupabaseSession() {
  try {
    return JSON.parse(localStorage.getItem(supabaseSessionKey) || "null");
  } catch {
    return null;
  }
}

function supabaseAuthToken() {
  return currentSupabaseSession()?.access_token || config.SUPABASE_ANON_KEY;
}

async function supabaseRest(path, options = {}) {
  if (!supabaseEnabled) return null;
  const response = await fetch(`${config.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAuthToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function supabaseAuthRequest(path, body) {
  const response = await fetch(`${config.SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Sign in failed");
  }
  return response.json();
}

async function loadClerkScript() {
  if (window.Clerk) return window.Clerk;
  const clerkDomain = clerkPublishableKey ? atob(clerkPublishableKey.split("_")[2] || "").slice(0, -1) : "";
  if (!clerkDomain) {
    throw new Error("Missing Clerk publishable key domain.");
  }
  await loadBrowserScript(`https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`, "tts-clerk-ui");
  await loadBrowserScript(`https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, "tts-clerk", {
    "data-clerk-publishable-key": clerkPublishableKey,
  });
  if (!window.Clerk) throw new Error("Clerk failed to load.");
  return window.Clerk;
}

async function loadBrowserScript(source, marker, attributes = {}) {
  const existing = document.querySelector(`script[data-${marker}]`);
  if (existing) {
    await new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      if (existing.dataset.loaded === "true") resolve();
    });
    return;
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset[marker.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = "true";
    Object.entries(attributes).forEach(([name, value]) => script.setAttribute(name, value));
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
}

async function clerk() {
  if (!backendEnabled || !clerkPublishableKey) return null;
  if (!clerkInstancePromise) {
    clerkInstancePromise = (async () => {
      const ClerkGlobal = await loadClerkScript();
      let instance = typeof ClerkGlobal === "function" ? new ClerkGlobal(clerkPublishableKey) : ClerkGlobal;
      const load = instance?.load || window.Clerk?.load;
      if (typeof load !== "function") {
        throw new Error("Clerk loaded without a load() API.");
      }
      await load.call(instance, {
        publishableKey: clerkPublishableKey,
        ui: { ClerkUI: window.__internal_ClerkUICtor },
      });
      instance = window.Clerk || instance;
      localStorage.setItem(clerkSignedInKey, instance?.user ? "true" : "");
      return instance;
    })();
  }
  return clerkInstancePromise;
}

async function clerkRedirectToSignIn() {
  const instance = await clerk();
  if (!instance) throw new Error("Clerk is not configured.");
  const redirectUrl = new URL("./index.html", window.location.href).href;
  const signInOptions = {
    redirectUrl,
    afterSignInUrl: redirectUrl,
    afterSignUpUrl: redirectUrl,
  };
  if (typeof instance.redirectToSignIn === "function") {
    await instance.redirectToSignIn(signInOptions);
    return;
  }
  if (typeof instance.openSignIn === "function") {
    await instance.openSignIn(signInOptions);
    return;
  }
  throw new Error("Clerk sign-in is unavailable.");
}

async function clerkToken() {
  const instance = await clerk();
  const token = await instance?.session?.getToken?.();
  if (!token) throw new Error("Not signed in");
  return token;
}

async function api(path, options = {}) {
  const token = await clerkToken();
  const response = await fetch(`${backendApiBase || ""}/api/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function signIn(email, password) {
  if (backendEnabled) {
    await clerkRedirectToSignIn();
    return null;
  }
  const session = await supabaseAuthRequest("token?grant_type=password", { email, password });
  localStorage.setItem(supabaseSessionKey, JSON.stringify(session));
  return session;
}

function signOut() {
  if (backendEnabled) {
    clerk().then((instance) => instance?.signOut?.()).catch(() => {});
    localStorage.removeItem(clerkSignedInKey);
    return;
  }
  localStorage.removeItem(supabaseSessionKey);
}

function machineFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location || "",
    model: row.model || "",
    serialNumber: row.serial_number || "",
    currentStatus: row.current_status || "unknown",
    lastUpdated: (row.last_updated || row.created_at || "").slice(0, 10),
    latestNote: row.latest_note || "",
    runtimeTodayHours: row.runtime_today_hours || 0,
    utilization: row.utilization || 0,
    oee: row.oee || 0,
    imageUrl: row.image_url || "",
    statusCounts: row.status_counts || {},
  };
}

function machineToDb(machine) {
  return {
    id: machine.id,
    name: machine.name,
    category: machine.category || "Production",
    location: machine.location || null,
    model: machine.model || null,
    serial_number: machine.serialNumber || null,
    current_status: machine.currentStatus || "unknown",
    latest_note: machine.latestNote || null,
    last_updated: machine.lastUpdated ? new Date(`${machine.lastUpdated}T12:00:00`).toISOString() : new Date().toISOString(),
    runtime_today_hours: machine.runtimeTodayHours || 0,
    utilization: machine.utilization || 0,
    oee: machine.oee || 0,
    image_url: machine.imageUrl || null,
    status_counts: machine.statusCounts || {},
  };
}

function logFromDb(row, machineMap) {
  const machine = machineMap.get(row.machine_id);
  const dateSource = row.down_at || row.up_at || row.logged_at;
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    date: String(dateSource || "").slice(0, 10),
    status: row.status,
    downAt: row.down_at ? row.down_at.slice(0, 16) : "",
    upAt: row.up_at ? row.up_at.slice(0, 16) : "",
    durationMinutes: row.duration_minutes,
    note: row.notes || "",
    source: row.source || "Database",
  };
}

function logToDb(log) {
  return {
    machine_id: log.machineId,
    status: log.status,
    issue_type: log.issueType || null,
    notes: log.note || "",
    technician: log.technician || null,
    down_at: log.downAt ? new Date(log.downAt).toISOString() : null,
    up_at: log.upAt ? new Date(log.upAt).toISOString() : null,
    duration_minutes: log.durationMinutes,
    source: log.source || "App",
  };
}

function workOrderFromDb(row, machineMap) {
  const machine = machineMap.get(row.machine_id);
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    issue: row.issue,
    priority: row.priority,
    status: row.status,
    technician: row.assigned_to || "",
    opened: String(row.opened_at || "").slice(0, 10),
    scheduledDate: String(row.scheduled_date || row.opened_at || "").slice(0, 10),
    completedAt: row.completed_at ? row.completed_at.slice(0, 10) : "",
    partsNeeded: row.parts_needed || [],
  };
}

function workOrderToDb(order) {
  return {
    id: order.id,
    machine_id: order.machineId,
    issue: order.issue,
    priority: order.priority || "medium",
    status: order.status || "open",
    assigned_to: order.technician || null,
    parts_needed: order.partsNeeded || [],
    opened_at: order.opened ? new Date(`${order.opened}T12:00:00`).toISOString() : new Date().toISOString(),
    scheduled_date: order.scheduledDate || order.opened || null,
    completed_at: order.completedAt ? new Date(`${order.completedAt}T12:00:00`).toISOString() : null,
  };
}

function pmFromDb(row, machineMap) {
  const machine = machineMap.get(row.machine_id);
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    task: row.task,
    frequency: row.frequency,
    dueDate: row.due_date,
    dueInHours: row.due_in_hours || 0,
    technician: row.assigned_to || "",
    status: row.status || "scheduled",
    lastCompleted: row.last_completed_at ? row.last_completed_at.slice(0, 10) : "",
  };
}

async function loadData(seedData) {
  if (backendEnabled) {
    return api("data");
  }
  if (!supabaseEnabled) return seedData;
  const [machineRows, logRows, orderRows, pmRows, settingsRows] = await Promise.all([
    supabaseRest("machines?select=*&order=name.asc"),
    supabaseRest("maintenance_logs?select=*&order=logged_at.asc"),
    supabaseRest("work_orders?select=*&order=opened_at.desc"),
    supabaseRest("pm_schedules?select=*&order=due_date.asc"),
    supabaseRest("app_settings?select=key,value"),
  ]);
  if (!machineRows?.length) return seedData;
  const machines = machineRows.map(machineFromDb);
  const machineMap = new Map(machines.map((machine) => [machine.id, machine]));
  const settings = Object.fromEntries((settingsRows || []).map((row) => [row.key, row.value]));
  return {
    ...seedData,
    machines,
    updates: (logRows || []).map((row) => logFromDb(row, machineMap)),
    workOrders: (orderRows || []).map((row) => workOrderFromDb(row, machineMap)),
    pmSchedule: (pmRows || []).map((row) => pmFromDb(row, machineMap)),
    technicians: settings.technicians || seedData.technicians,
    issueTypes: settings.issueTypes || seedData.issueTypes,
    statusLabels: settings.statusLabels || {},
  };
}

async function saveMachine(machine) {
  if (backendEnabled) return api("machines", { method: "POST", body: JSON.stringify(machineToDb(machine)) });
  return supabaseRest("machines?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(machineToDb(machine)),
  });
}

async function saveLog(log) {
  if (backendEnabled) return api("logs", { method: "POST", body: JSON.stringify(logToDb(log)) });
  return supabaseRest("maintenance_logs", {
    method: "POST",
    body: JSON.stringify(logToDb(log)),
  });
}

async function saveWorkOrder(order) {
  if (backendEnabled) return api("work-orders", { method: "POST", body: JSON.stringify(workOrderToDb(order)) });
  return supabaseRest("work_orders?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(workOrderToDb(order)),
  });
}

async function deleteWorkOrder(orderId) {
  if (backendEnabled) return api(`work-orders?id=${encodeURIComponent(orderId)}`, { method: "DELETE" });
  return supabaseRest(`work_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function saveSettings(settings) {
  if (backendEnabled) return api("settings", { method: "POST", body: JSON.stringify(settings) });
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  return supabaseRest("app_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
}

async function isSignedIn() {
  if (backendEnabled) {
    const instance = await clerk();
    const signedIn = Boolean(instance?.user);
    localStorage.setItem(clerkSignedInKey, signedIn ? "true" : "");
    return signedIn;
  }
  return Boolean(currentSupabaseSession()?.access_token);
}

export const remoteStore = {
  provider: backendEnabled ? "clerk" : supabaseEnabled ? "supabase" : "local",
  isEnabled: () => backendEnabled || supabaseEnabled,
  isSignedIn,
  signIn,
  signOut,
  loadData,
  saveMachine,
  saveLog,
  saveWorkOrder,
  deleteWorkOrder,
  saveSettings,
};
