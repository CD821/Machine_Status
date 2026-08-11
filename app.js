import { remoteStore } from "./db.js";

const state = {
  data: null,
  page: document.body.dataset.page || "dashboard",
  selectedMachineId: new URLSearchParams(location.search).get("machine") || "saber-jet-xp",
  orderFilter: "all",
  scheduleView: "week",
  scheduleFilters: {
    machineId: "all",
    technician: "all",
    status: "all",
    priority: "all",
  },
  search: "",
  localLogs: JSON.parse(localStorage.getItem("tts-maintenance-local-logs") || "[]"),
  machineOverrides: JSON.parse(localStorage.getItem("tts-machine-overrides") || "{}"),
  workOrderOverrides: JSON.parse(localStorage.getItem("tts-work-order-overrides") || "{}"),
  settingsOverrides: JSON.parse(localStorage.getItem("tts-settings") || "{}"),
  savedAssets: JSON.parse(localStorage.getItem("tts-assets") || "null"),
  machineCardOrder: JSON.parse(localStorage.getItem("tts-machine-card-order") || "[]"),
  draggedMachineId: "",
  machineCardDragStarted: false,
  machineCardClickGuard: false,
  pmSchedule: null,
  remoteEnabled: false,
  actualRole: "admin",
  accessUsers: [],
  rolePreview: localStorage.getItem("tts-role-preview") || "admin",
  scheduleMonth: localDateValue(new Date()).slice(0, 7),
  downtimeStart: "",
  downtimeEnd: "",
};

const roles = {
  admin: {
    label: "Admin",
    description: "Full access to assets, settings, tickets, schedules, and logs.",
    permissions: ["viewAlerts", "viewSettings", "manageSettings", "manageAssets", "manageWorkOrders", "closeWorkOrders", "deleteWorkOrders", "addLogs", "schedulePm"],
  },
  supervisor: {
    label: "Supervisor",
    description: "Runs daily shop workflow, schedules PM, and manages tickets.",
    permissions: ["viewAlerts", "manageWorkOrders", "closeWorkOrders", "addLogs", "schedulePm"],
  },
  technician: {
    label: "Technician",
    description: "Creates tickets, edits assets, adds maintenance logs, and marks machines down/up.",
    permissions: ["viewAlerts", "manageAssets", "manageWorkOrders", "closeWorkOrders", "addLogs"],
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access for the live status dashboard.",
    permissions: ["dashboardOnly"],
  },
};

const statusLabels = {
  operational: "Operational",
  down: "Down",
  maintenance: "PM Due",
  inactive: "Inactive",
  unknown: "Unknown",
  urgent: "Urgent Repair",
  scheduled: "Scheduled",
  open: "Open",
  completed: "Completed",
  overdue: "Overdue",
  "due-soon": "Due Soon",
};

const machineIcons = {
  "saber-jet-s": "SJ",
  "saber-jet-xp": "XP",
  "voyager-1": "V1",
  "voyager-2": "V2",
  fastback: "FB",
  "warehouse-compressor": "CP",
  "shop-compressor": "CP",
  "air-dryer": "AD",
  "saber-jet-1-crane": "CR",
  "saber-jet-2-crane": "CR",
  "water-recycling-system": "WR",
  "crosscut-xp": "CX",
  "overhead-crane": "OC",
};

const machineImages = {
  "saber-jet-s": "./assets/machines/saber-jet.png",
  "saber-jet-xp": "./assets/machines/saber-jet.png",
  "voyager-1": "./assets/machines/voyager.png",
  "voyager-2": "./assets/machines/voyager.png",
  fastback: "./assets/machines/fastback.png",
  "water-recycling-system": "./assets/machines/water-recycling.png",
  "warehouse-compressor": "./assets/machines/warehouse-compressor.png",
  "shop-compressor": "./assets/machines/warehouse-compressor.png",
  "saber-jet-1-crane": "./assets/machines/saber-jet-crane.png",
  "saber-jet-2-crane": "./assets/machines/saber-jet-crane.png",
  "overhead-crane": "./assets/machines/overhead-crane.png",
  forklift: "./assets/machines/forklift.png",
  "power-grip": "./assets/machines/Power Grip.jpg",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const logStatusKeys = ["operational", "maintenance", "down", "urgent"];
const maintenanceLogStatusKeys = ["operational", "down", "inactive"];
const workOrderStatusKeys = ["open", "scheduled", "completed"];
const shiftStartHour = 5;
const shiftEndHour = 18;
const shiftMinutesPerDay = (shiftEndHour - shiftStartHour) * 60;

async function init() {
  initializeDowntimeRange();
  const response = await fetch("./data/equipment-data.json");
  state.data = await response.json();
  state.remoteEnabled = remoteStore.isEnabled();
  if (state.remoteEnabled && !(await remoteStore.isSignedIn())) {
    location.href = "./login.html";
    return;
  }
  if (state.remoteEnabled) {
    const user = await remoteStore.currentUser().catch(() => ({ role: "viewer" }));
    state.actualRole = roles[user.role] ? user.role : "viewer";
  }
  state.data = await remoteStore.loadData(state.data);
  state.data.userRoles = state.data.userRoles && typeof state.data.userRoles === "object" ? state.data.userRoles : {};
  if (state.page === "settings" && state.remoteEnabled && can("manageSettings")) {
    state.accessUsers = await remoteStore.listUsers().catch(() => []);
  }
  if (state.data.statusLabels) Object.assign(statusLabels, state.data.statusLabels);
  clearLegacyDemoStorage();
  if (!state.remoteEnabled) {
    applySettingsOverrides();
    applySavedAssets();
  }
  state.pmSchedule = state.remoteEnabled ? state.data.pmSchedule : JSON.parse(localStorage.getItem("tts-pm-schedule") || "null") || state.data.pmSchedule;
  if (!Array.isArray(state.pmSchedule)) state.pmSchedule = [];
  if (!Array.isArray(state.data.workOrders)) state.data.workOrders = [];
  state.data.pmSchedule = state.pmSchedule;
  applyMachineOverrides();
  applyWorkOrderOverrides();
  if (!state.data.machines.some((machine) => machine.id === state.selectedMachineId)) {
    state.selectedMachineId = state.data.machines[0]?.id;
  }
  bindSharedEvents();
  hydrateSidebarCounts();
  hydrateFormOptions();
  hydrateScheduleFilters();
  renderPage();
  applyRolePreview();
  exposeDebugHelpers();
  const editOrderId = new URLSearchParams(location.search).get("edit");
  if (editOrderId) openWorkOrderForm(editOrderId);
}

function bindSharedEvents() {
  bindSidebarControls();
  bindAccountMenu();

  const search = $("#searchInput");
  if (search) {
    search.addEventListener("input", (event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderPage();
    });
  }

  $$("[data-order-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orderFilter = button.dataset.orderFilter;
      $$("[data-order-filter]").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderWorkOrders();
    });
  });

  $$("[data-schedule-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.scheduleView = button.dataset.scheduleView;
      $$("[data-schedule-view]").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
      renderSchedule();
    });
  });
  const scheduleMonthPicker = $("#scheduleMonthPicker");
  if (scheduleMonthPicker) {
    scheduleMonthPicker.value = state.scheduleMonth;
    scheduleMonthPicker.addEventListener("change", () => {
      state.scheduleMonth = scheduleMonthPicker.value || localDateValue(new Date()).slice(0, 7);
      state.scheduleView = "month";
      $$("[data-schedule-view]").forEach((tab) => tab.classList.toggle("active", tab.dataset.scheduleView === "month"));
      renderSchedule();
    });
  }

  $$("[data-schedule-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      state.scheduleFilters[select.dataset.scheduleFilter] = select.value || "all";
      renderSchedule();
      renderWorkOrders();
    });
  });

  $$("[data-machine-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setMachineTab(button.dataset.machineTab);
    });
  });

  const logForm = $("#logForm");
  if (logForm) {
    logForm.addEventListener("submit", handleLogSubmit);
  }
  $("#addMaintenanceLog")?.addEventListener("click", openLogForm);
  $("#cancelLog")?.addEventListener("click", closeLogForm);

  const recurringForm = $("#recurringForm");
  if (recurringForm) {
    hydrateRecurringFormOptions();
    recurringForm.addEventListener("submit", handleRecurringSubmit);
  }
  $("#addRecurringPm")?.addEventListener("click", () => openRecurringForm());
  $("#cancelRecurringPm")?.addEventListener("click", closeRecurringForm);

  const workOrderForm = $("#workOrderForm");
  if (workOrderForm) {
    hydrateWorkOrderFormOptions();
    workOrderForm.addEventListener("submit", handleWorkOrderSubmit);
  }
  $("#createWorkOrder")?.addEventListener("click", () => openWorkOrderForm());
  $("#cancelWorkOrder")?.addEventListener("click", closeWorkOrderForm);
  $$("[data-cancel-work-order]").forEach((button) => {
    button.addEventListener("click", closeWorkOrderForm);
  });

  const assetForm = $("#assetForm");
  if (assetForm) {
    hydrateAssetFormOptions();
    setupAssetImagePicker();
    assetForm.addEventListener("submit", handleAssetSubmit);
  }
  $("#addAsset")?.addEventListener("click", () => openAssetForm());
  $("#cancelAsset")?.addEventListener("click", closeAssetForm);
  $$("[data-cancel-asset]").forEach((button) => {
    button.addEventListener("click", closeAssetForm);
  });

  const settingsAddForm = $("#settingsAddForm");
  if (settingsAddForm) settingsAddForm.addEventListener("submit", handleSettingsAdd);
  const userRoleForm = $("#userRoleForm");
  if (userRoleForm) userRoleForm.addEventListener("submit", handleUserRoleSubmit);
  const downtimeStart = $("#downtimeStart");
  const downtimeEnd = $("#downtimeEnd");
  if (downtimeStart && downtimeEnd) {
    downtimeStart.value = state.downtimeStart;
    downtimeEnd.value = state.downtimeEnd;
    [downtimeStart, downtimeEnd].forEach((input) => {
      input.addEventListener("change", () => {
        state.downtimeStart = downtimeStart.value;
        state.downtimeEnd = downtimeEnd.value;
        renderMachineDetail();
      });
    });
  }
  const roleSelect = $("#rolePreview");
  if (roleSelect) {
    roleSelect.value = effectiveRole();
    roleSelect.addEventListener("change", (event) => {
      if (state.remoteEnabled) return;
      state.rolePreview = event.target.value;
      localStorage.setItem("tts-role-preview", state.rolePreview);
      renderPage();
      applyRolePreview();
    });
  }

  document.addEventListener("click", (event) => {
    const machineCard = event.target.closest("[data-machine-card]");
    if (machineCard && state.machineCardClickGuard) {
      event.preventDefault();
      state.machineCardClickGuard = false;
      return;
    }
    if (event.target.matches(".modal-backdrop")) {
      closeWorkOrderForm();
      closeAssetForm();
      closeLogForm();
    }
    const closeButton = event.target.closest("[data-close-order]");
    if (closeButton) {
      closeWorkOrder(closeButton.dataset.closeOrder);
    }
    const editPmButton = event.target.closest("[data-edit-pm]");
    if (editPmButton) {
      openRecurringForm(editPmButton.dataset.editPm);
    }
    const deletePmButton = event.target.closest("[data-delete-pm]");
    if (deletePmButton) {
      deleteRecurringPm(deletePmButton.dataset.deletePm);
    }
    const editOrderButton = event.target.closest("[data-edit-order]");
    if (editOrderButton) {
      openWorkOrderForm(editOrderButton.dataset.editOrder);
    }
    const deleteOrderButton = event.target.closest("[data-delete-order]");
    if (deleteOrderButton) {
      deleteWorkOrder(deleteOrderButton.dataset.deleteOrder);
    }
    const editAssetButton = event.target.closest("[data-edit-asset]");
    if (editAssetButton) {
      openAssetForm(editAssetButton.dataset.editAsset);
    }
    const editSettingButton = event.target.closest("[data-edit-setting]");
    if (editSettingButton) {
      editSetting(editSettingButton.dataset.settingGroup, editSettingButton.dataset.settingKey);
    }
    const deleteSettingButton = event.target.closest("[data-delete-setting]");
    if (deleteSettingButton) {
      deleteSetting(deleteSettingButton.dataset.settingGroup, deleteSettingButton.dataset.settingKey);
    }
    const roleSelect = event.target.closest("[data-user-role-select]");
    if (roleSelect) {
      updateUserRole(roleSelect.dataset.userRoleKey, roleSelect.value);
    }
    const removeUserRoleButton = event.target.closest("[data-remove-user-role]");
    if (removeUserRoleButton) {
      removeUserRole(removeUserRoleButton.dataset.removeUserRole);
    }
    const accountButton = event.target.closest("[data-account-button]");
    const accountMenu = $("#accountMenu");
    if (accountButton && accountMenu) {
      const isOpen = !accountMenu.hidden;
      accountMenu.hidden = isOpen;
      accountButton.setAttribute("aria-expanded", String(!isOpen));
      return;
    }
    const signOutButton = event.target.closest("[data-account-signout]");
    if (signOutButton) {
      signOutButton.disabled = true;
      signOutButton.textContent = "Signing out...";
      remoteStore.signOut().finally(() => {
        location.href = "./login.html";
      });
      return;
    }
    if (accountMenu && !event.target.closest(".account-menu-wrap")) {
      accountMenu.hidden = true;
      $("[data-account-button]")?.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-machine-card]");
    if (!card) return;
    state.draggedMachineId = card.dataset.machineCard;
    state.machineCardDragStarted = true;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggedMachineId);
  });

  document.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-machine-card]");
    if (!card || !state.draggedMachineId || card.dataset.machineCard === state.draggedMachineId) return;
    event.preventDefault();
    card.classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
  });

  document.addEventListener("dragleave", (event) => {
    const card = event.target.closest("[data-machine-card]");
    if (card) card.classList.remove("drag-over");
  });

  document.addEventListener("drop", (event) => {
    const card = event.target.closest("[data-machine-card]");
    if (!card || !state.draggedMachineId || card.dataset.machineCard === state.draggedMachineId) return;
    event.preventDefault();
    reorderMachineCards(state.draggedMachineId, card.dataset.machineCard);
  });

  document.addEventListener("dragend", () => {
    if (state.machineCardDragStarted) {
      state.machineCardClickGuard = true;
      window.setTimeout(() => {
        state.machineCardClickGuard = false;
      }, 0);
    }
    state.draggedMachineId = "";
    state.machineCardDragStarted = false;
    $$(".machine-card.dragging, .machine-card.drag-over").forEach((card) => {
      card.classList.remove("dragging", "drag-over");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWorkOrderForm();
      closeAssetForm();
      closeLogForm();
    }
  });
}

function bindSidebarControls() {
  const shell = $(".app-shell");
  const sidebar = $(".sidebar");
  const toggles = $$(".hamburger");
  if (!shell || !sidebar || toggles.length === 0) return;

  const savedCollapsed = localStorage.getItem("tts-sidebar-collapsed") === "true";
  shell.classList.toggle("sidebar-collapsed", savedCollapsed);

  toggles.forEach((toggle) => {
    toggle.setAttribute("role", toggle.tagName === "BUTTON" ? "button" : "button");
    toggle.setAttribute("tabindex", "0");
    toggle.setAttribute("aria-label", "Toggle navigation");
    toggle.setAttribute("aria-expanded", String(!savedCollapsed));
    toggle.addEventListener("click", toggleSidebar);
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSidebar();
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      shell.classList.remove("sidebar-open");
      syncSidebarState();
    }
  });

  document.addEventListener("click", (event) => {
    const clickedSidebar = sidebar.contains(event.target);
    const clickedToggle = toggles.some((toggle) => toggle.contains(event.target));
    if (!clickedSidebar && !clickedToggle) {
      shell.classList.remove("sidebar-open");
      syncSidebarState();
    }
  });
}

function toggleSidebar() {
  const shell = $(".app-shell");
  if (!shell) return;
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  if (isMobile) {
    shell.classList.toggle("sidebar-open");
  } else {
    shell.classList.toggle("sidebar-collapsed");
    localStorage.setItem("tts-sidebar-collapsed", String(shell.classList.contains("sidebar-collapsed")));
  }
  syncSidebarState();
}

function syncSidebarState() {
  const shell = $(".app-shell");
  if (!shell) return;
  const expanded = window.matchMedia("(max-width: 860px)").matches
    ? shell.classList.contains("sidebar-open")
    : !shell.classList.contains("sidebar-collapsed");
  $$(".hamburger").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", String(expanded));
  });
}

function renderPage() {
  if (state.page === "dashboard") {
    renderSummary();
    renderMachineGrid();
    renderRightRail();
  }
  if (state.page === "machines") {
    renderMachineDetail();
    renderMachineIssues();
    renderMachinePm();
    setMachineTab("overview");
  }
  if (state.page === "schedule") {
    renderSchedule();
    renderWorkOrders();
  }
  if (state.page === "workorders") {
    renderWorkOrders();
  }
  if (state.page === "logs") {
    renderLogs();
  }
  if (state.page === "settings") {
    renderSettings();
  }
  enforcePageAccess();
  applyRolePreview();
}

function can(permission) {
  return roles[effectiveRole()]?.permissions.includes(permission);
}

function effectiveRole() {
  return state.remoteEnabled ? state.actualRole : state.rolePreview;
}

function enforcePageAccess() {
  const viewerBlockedPages = ["machines", "schedule", "workorders", "logs", "settings"];
  if (can("dashboardOnly") && viewerBlockedPages.includes(state.page)) {
    $(".main").innerHTML = `
      <header class="topbar">
        <button class="hamburger" type="button" aria-label="Toggle menu">☰</button>
      </header>
      <section class="panel empty-state">Viewer access is limited to Live Status.</section>
    `;
  }
}

function applyRolePreview() {
  const role = effectiveRole();
  document.body.dataset.role = role;
  const activeRole = roles[role] || roles.viewer;
  setText("#activeRoleLabel", activeRole.label);
  setText("#activeRoleDescription", activeRole.description);
  const roleSelect = $("#rolePreview");
  if (roleSelect) {
    roleSelect.value = role;
    roleSelect.disabled = state.remoteEnabled;
    roleSelect.title = state.remoteEnabled ? "Role is controlled by Clerk metadata." : "";
  }
  $$("[data-viewer-hidden]").forEach((element) => {
    element.hidden = can("dashboardOnly");
  });
  $$("[data-permission]").forEach((element) => {
    const permission = element.dataset.permission;
    const allowed = can(permission);
    element.hidden = !allowed;
    if ("disabled" in element) element.disabled = !allowed;
  });
  $$("[data-disable-permission]").forEach((element) => {
    const permission = element.dataset.disablePermission;
    const allowed = can(permission);
    element.disabled = !allowed;
    element.classList.toggle("disabled-preview", !allowed);
    element.title = allowed ? "" : `Hidden or disabled for ${activeRole.label}`;
  });
}

function hydrateSidebarCounts() {
  const orders = activeWorkOrders();
  setText("#sidebarWorkOrders", orders.length);
  setText("#urgentCount", orders.filter((order) => order.priority === "urgent").length);
  setText("#highCount", orders.filter((order) => order.priority === "high").length);
  setText("#mediumCount", orders.filter((order) => order.priority === "medium").length);
}

function hydrateFormOptions() {
  if (!$("#formMachine")) return;
  $("#formMachine").innerHTML = state.data.machines
    .map((machine) => `<option value="${machine.id}">${escapeHtml(machine.name)}</option>`)
    .join("");
  $("#issueType").innerHTML = state.data.issueTypes
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join("");
  $("#technician").innerHTML = state.data.technicians
    .map((tech) => `<option value="${escapeHtml(tech)}">${escapeHtml(tech)}</option>`)
    .join("");
  const logStatus = $("#logStatus");
  if (logStatus) {
    logStatus.innerHTML = statusOptionsHtml(maintenanceLogStatusKeys);
  }
  $("#formMachine").value = state.selectedMachineId;
}

function hydrateScheduleFilters() {
  const machineFilter = $("#scheduleMachineFilter");
  const technicianFilter = $("#scheduleTechnicianFilter");
  const statusFilter = $("#scheduleStatusFilter");
  const priorityFilter = $("#schedulePriorityFilter");
  if (!machineFilter && !technicianFilter && !statusFilter && !priorityFilter) return;

  if (machineFilter) {
    machineFilter.innerHTML = `<option value="all">All Machines</option>${state.data.machines
      .map((machine) => `<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.name)}</option>`)
      .join("")}`;
    machineFilter.value = state.scheduleFilters.machineId;
  }
  if (technicianFilter) {
    technicianFilter.innerHTML = `<option value="all">All Technicians</option>${state.data.technicians
      .map((tech) => `<option value="${escapeHtml(tech)}">${escapeHtml(tech)}</option>`)
      .join("")}`;
    technicianFilter.value = state.scheduleFilters.technician;
  }
  if (statusFilter) {
    const statuses = ["open", "scheduled", "completed", "overdue", "due-soon", "maintenance"];
    statusFilter.innerHTML = `<option value="all">All Statuses</option>${statuses
      .map((status) => `<option value="${status}">${escapeHtml(statusLabels[status] || status)}</option>`)
      .join("")}`;
    statusFilter.value = state.scheduleFilters.status;
  }
  if (priorityFilter) {
    priorityFilter.innerHTML = `
      <option value="all">All Priorities</option>
      <option value="urgent">Urgent</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    `;
    priorityFilter.value = state.scheduleFilters.priority;
  }
}

function renderSummary() {
  const counts = state.data.machines.reduce(
    (acc, machine) => {
      acc[machine.currentStatus] = (acc[machine.currentStatus] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { operational: 0, down: 0, maintenance: 0, total: 0 },
  );
  const urgent = activeWorkOrders().filter((order) => order.priority === "urgent").length;
  const cards = [
    ["✓", "Operational", counts.operational || 0, "operational"],
    ["×", "Down", counts.down || 0, "down"],
    ["◷", "PM Due", counts.maintenance || 0, "maintenance"],
    ["⌘", "Urgent Repair", urgent, "urgent"],
    ["▦", "Total Assets", counts.total, "unknown"],
  ];
  $("#summaryRow").innerHTML = [
    ["OK", "Operational", counts.operational || 0, "operational"],
    ["!", "Down", counts.down || 0, "down"],
    ["PM", "PM Due", counts.maintenance || 0, "maintenance"],
    ["!", "Urgent Repair", urgent, "urgent"],
    ["EQ", "Total Assets", counts.total, "unknown"],
  ]
    .map(
      ([icon, label, value, status]) => `
        <article class="summary-card">
          <span class="summary-icon status-${status}">${icon}</span>
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `,
    )
    .join("");
  setText("#lastUpdated", new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
}

function renderMachineGrid() {
  const machines = orderedMachines(state.data.machines).filter((machine) => {
    const term = state.search;
    return !term || `${machine.name} ${machine.location} ${machine.latestNote}`.toLowerCase().includes(term);
  });
  $("#machineGrid").innerHTML = machines
    .map((machine) => {
      const status = normalizeStatus(machine.currentStatus);
      const downtime = downtimeToday(machine);
      return `
        <a class="machine-card status-${status}" href="./machines.html?machine=${encodeURIComponent(machine.id)}" aria-label="Open ${escapeHtml(machine.name)} detail" draggable="true" data-machine-card="${escapeHtml(machine.id)}">
          <div class="machine-top">
            <span class="round-status status-${status}">${status === "down" ? "×" : status === "maintenance" ? "◷" : "✓"}</span>
            ${machineArt(machine)}
            <div class="machine-heading">
              <h3>${escapeHtml(machine.name)}</h3>
              <span class="status-chip status-${status}">${statusLabels[status] || status}</span>
            </div>
          </div>
          <div class="machine-metrics">
            <div class="metric"><span>Downtime</span><strong>${formatDuration(downtime.minutes)}</strong></div>
            <div class="metric"><span>Down %</span><strong>${downtime.percent}%</strong></div>
          </div>
          <p class="machine-footer">${footerCopy(machine)}</p>
        </a>
      `;
    })
    .join("");
}

function orderedMachines(machines) {
  const savedIds = state.machineCardOrder.filter((id) => machines.some((machine) => machine.id === id));
  const missingIds = machines.map((machine) => machine.id).filter((id) => !savedIds.includes(id));
  const order = [...savedIds, ...missingIds];
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return [...machines].sort((a, b) => (orderIndex.get(a.id) ?? 9999) - (orderIndex.get(b.id) ?? 9999));
}

function reorderMachineCards(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const currentOrder = orderedMachines(state.data.machines).map((machine) => machine.id);
  const fromIndex = currentOrder.indexOf(sourceId);
  const toIndex = currentOrder.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0) return;
  currentOrder.splice(toIndex, 0, currentOrder.splice(fromIndex, 1)[0]);
  state.machineCardOrder = currentOrder;
  localStorage.setItem("tts-machine-card-order", JSON.stringify(currentOrder));
  renderMachineGrid();
}

function renderRightRail() {
  const urgentOrders = activeWorkOrders().filter((order) => order.priority === "urgent" || order.status === "open");
  const weekEvents = scheduledEventsForWeek();
  setText("#urgentBadge", urgentOrders.length);
  setText("#pmBadge", weekEvents.length);
  $("#urgentRepairList").innerHTML = urgentOrders.map(renderRailOrder).join("") || emptyMessage("No urgent repairs.");
  $("#pmDueList").innerHTML = weekEvents.slice(0, 4).map(renderScheduleRail).join("") || emptyMessage("Nothing scheduled this week.");
  $("#todayUpdates").innerHTML = latestUpdates(7).map(renderTimelineItem).join("");
}

function renderRailOrder(order) {
  return `
    <div class="rail-card alert-card">
      <span class="rail-icon status-urgent">⌘</span>
      <div>
        <div class="rail-line"><strong>${escapeHtml(order.machine)}</strong><span class="alert-time">Since 7:15 AM</span></div>
        <p>${escapeHtml(order.issue)}</p>
        <span class="subtle">${order.id} · Priority: ${escapeHtml(order.priority)}</span>
      </div>
    </div>
  `;
}

function renderPmRail(pm) {
  const calculated = pmWithLogDueDates().find((item) => item.id === pm.id) || pm;
  return `
    <div class="rail-card">
      <div class="mini-machine">${machineIcons[pm.machineId] || "PM"}</div>
      <div>
        <div class="rail-line"><strong>${escapeHtml(pm.machine)}</strong><span class="pm-time">${formatDueInDays(calculated.dueInDays)}</span></div>
        <p>${escapeHtml(pm.task)}</p>
        <span class="subtle">${pm.id} - Last completed: ${calculated.lastCompleted ? formatDate(calculated.lastCompleted) : "No matching log"}</span>
      </div>
    </div>
  `;
}

function renderScheduleRail(event) {
  return `
    <div class="rail-card">
      <div class="mini-machine">${event.type}</div>
      <div>
        <div class="rail-line"><strong>${escapeHtml(event.machine)}</strong><span class="pm-time">${formatDate(event.date).replace(", 2026", "")}</span></div>
        <p>${escapeHtml(event.title)}</p>
        <span class="subtle">${escapeHtml(event.type)} - ${escapeHtml(event.technician)}</span>
      </div>
    </div>
  `;
}

function renderMachineDetail() {
  const machine = selectedMachine();
  if (!machine) {
    $("#machineDetail").innerHTML = emptyMessage("No assets are available yet.");
    setText("#machineTimeline", "");
    setText("#recentMachineLogs", "");
    setText("#downtimeChart", "");
    return;
  }
  document.title = `${machine.name} | TTS Maintenance`;
  const status = normalizeStatus(machine.currentStatus);
  $("#machineDetail").innerHTML = `
      <div class="machine-photo ${String(machine.category || "asset").toLowerCase()}">
      ${machinePhoto(machine)}
    </div>
    <div class="detail-summary">
      <h1>${escapeHtml(machine.name)}</h1>
      <div class="detail-facts inline">
        <div><span>Status</span><strong class="status-chip status-${status}">${statusLabels[status] || status}</strong></div>
        <div><span>Location</span><strong>${escapeHtml(machine.location)}</strong></div>
        <div><span>Serial Number</span><strong>${escapeHtml(machine.serialNumber)}</strong></div>
        <div><span>Model</span><strong>${escapeHtml(machine.model)}</strong></div>
      </div>
      <button class="outline-button detail-edit" data-edit-asset="${escapeHtml(machine.id)}" data-permission="manageAssets" type="button">Edit Asset</button>
    </div>
  `;
  const visibleMachineUpdates = machineUpdates(machine.id).filter((update) => !isImportedHistoryNote(update));
  $("#machineTimeline").innerHTML = visibleMachineUpdates.slice(-5).reverse().map(renderTimelineItem).join("");
  $("#recentMachineLogs").innerHTML = visibleMachineUpdates.slice(-6).reverse().map(renderRecentLog).join("");
  renderDowntimeChart(machine);
  if ($("#formMachine")) $("#formMachine").value = machine.id;
}

function renderRecentLog(update) {
  const status = normalizeStatus(update.status);
  return `
    <div class="recent-log status-${status}">
      <span></span>
      <div>
        <a href="./logs.html">${escapeHtml(titleFromNote(update.note))}</a>
        <p>${formatDate(update.date)}</p>
      </div>
      <strong class="status-chip status-${status}">${statusLabels[status] || status}</strong>
    </div>
  `;
}

function renderMachineIssues() {
  const machine = selectedMachine();
  if (!machine) {
    setText("#issueBadge", "0");
    $("#machineIssues").innerHTML = emptyMessage("No open issues for this machine.");
    return;
  }
  const issues = activeWorkOrders().filter((order) => order.machineId === machine.id);
  setText("#issueBadge", issues.length);
  $("#machineIssues").innerHTML = issues.map(renderIssueCard).join("") || emptyMessage("No open issues for this machine.");
}

function renderMachinePm() {
  if (!$("#machinePmTable")) return;
  const machine = selectedMachine();
  if (!machine) {
    $("#machinePmTable").innerHTML = `<tbody><tr><td>No PM schedule is set yet.</td></tr></tbody>`;
    return;
  }
  const rows = pmWithLogDueDates().filter((pm) => pm.machineId === machine.id);
  $("#machinePmTable").innerHTML = rows.length
    ? table(
        ["PM Task", "Last Completed", "Frequency", "Next Due", "Due In", "Assigned To", "Status", "Action"],
        rows.map((pm) => [
          pm.task,
          pm.lastCompleted ? formatDate(pm.lastCompleted) : "No matching log",
          pm.frequency,
          formatDate(pm.dueDate),
          formatDueInDays(pm.dueInDays),
          pm.technician,
          `<span class="status-chip status-${pm.status}">${statusLabels[pm.status]}</span>`,
          `<button class="outline-button" data-permission="schedulePm" type="button">Schedule</button>`,
        ]),
      )
    : `<tbody><tr><td>No PM schedule is set for ${escapeHtml(machine.name)} yet.</td></tr></tbody>`;
}

function setMachineTab(tabName) {
  const requestedTab = $(`[data-machine-tab="${CSS.escape(tabName)}"]`) ? tabName : "overview";
  $$("[data-machine-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.machineTab === requestedTab);
  });
  $$("[data-tab-panel]").forEach((panel) => {
    const tabs = panel.dataset.tabPanel.split(" ");
    panel.classList.toggle("hidden-panel", !tabs.includes(requestedTab));
  });
}

function renderIssueCard(issue) {
  return `
    <div class="issue-card">
      <strong>${escapeHtml(issue.issue)}</strong>
      <span>${escapeHtml(issue.machine)} · Opened ${formatDate(issue.opened)}</span>
      <b class="priority-chip priority-${issue.priority}">${issue.priority}</b>
    </div>
  `;
}

function renderDowntimeChart(machine) {
  if (!$("#downtimeChart")) return;
  const rows = downtimeChartRows(machine);
  if (rows.every((row) => row.minutes === 0)) {
    $("#downtimeChart").innerHTML = `<div class="empty-state">No downtime recorded in this date range.</div>`;
    return;
  }
  $("#downtimeChart").innerHTML = rows
    .map(
      ({ label, minutes, percent }) => `
        <div class="bar-row">
          <span>${label}</span>
          <div class="bar-track"><div class="bar-fill" style="height:${Math.max(6, percent)}%"></div></div>
          <strong>${formatDuration(minutes)}</strong>
        </div>
      `,
    )
    .join("");
}

function downtimeChartRows(machine) {
  return datesInRange(state.downtimeStart, state.downtimeEnd).map((dateString) => {
    const minutes = downtimeMinutesForDate(machine, dateString);
    return {
      label: formatDate(dateString).replace(", 2026", ""),
      minutes,
      percent: Math.round((minutes / shiftMinutesPerDay) * 1000) / 10,
    };
  });
}

function renderSchedule() {
  if (!$("#pmCalendar")) return;
  const schedule = $("#pmCalendar");
  const title = $("#scheduleTitle");
  const monthPicker = $("#scheduleMonthPicker");
  schedule.className = `calendar schedule-${state.scheduleView}`;
  if (title) {
    title.textContent = state.scheduleView === "month" ? monthTitle(state.scheduleMonth) : state.scheduleView === "list" ? "Schedule List" : "This Week";
  }
  if (monthPicker) {
    monthPicker.value = state.scheduleMonth;
    monthPicker.hidden = state.scheduleView !== "month";
  }
  updateScheduleRangeLabel();
  if (state.scheduleView === "month") {
    renderMonthSchedule(schedule);
  } else if (state.scheduleView === "list") {
    renderListSchedule(schedule);
  } else {
    renderWeekSchedule(schedule);
  }
  if ($("#dueByHoursTable")) {
    const calculatedPm = pmWithLogDueDates();
    $("#dueByHoursTable").innerHTML = table(
      ["Machine", "PM Task", "Last Completed", "Frequency", "Next Due", "Due In", "Status", "Action"],
      calculatedPm.map((pm) => [
        linkMachine(pm.machineId, pm.machine),
        pm.task,
        pm.lastCompleted ? formatDate(pm.lastCompleted) : "No matching log",
        pm.frequency,
        formatDate(pm.dueDate),
        formatDueInDays(pm.dueInDays),
        `<span class="status-chip status-${pm.status}">${statusLabels[pm.status]}</span>`,
        `<button class="outline-button" data-permission="schedulePm" type="button">Schedule</button>`,
      ]),
    );
  }
  if ($("#recurringTable")) {
    $("#recurringTable").innerHTML = table(
      ["Machine", "PM Task", "Frequency", "Next Due", "Assigned To", "Status", "Actions"],
      pmWithLogDueDates().map((pm) => [
        linkMachine(pm.machineId, pm.machine),
        pm.task,
        pm.frequency,
        formatDate(pm.dueDate),
        pm.technician,
        `<span class="status-chip status-${pm.status}">${statusLabels[pm.status]}</span>`,
        `<div class="row-actions"><button class="outline-button" data-edit-pm="${escapeHtml(pm.id)}" data-permission="schedulePm" type="button">Edit</button><button class="danger-action" data-delete-pm="${escapeHtml(pm.id)}" data-permission="schedulePm" type="button">Remove</button></div>`,
      ]),
    );
  }
}

function currentWeekDays(baseDate = new Date()) {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: localDateValue(date),
      label: date.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }),
    };
  });
}

function monthTitle(monthValue) {
  const [year, month] = String(monthValue || localDateValue(new Date()).slice(0, 7)).split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function updateScheduleRangeLabel() {
  const label = $("#scheduleRangeLabel");
  if (!label) return;
  if (state.scheduleView === "month") {
    label.textContent = monthTitle(state.scheduleMonth);
    return;
  }
  const days = currentWeekDays();
  label.textContent = `${shortRangeDate(days[0].date)} - ${formatDate(days[6].date)}`;
}

function shortRangeDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderWeekSchedule(container) {
  const days = currentWeekDays();
  const scheduledEvents = scheduleEvents();
  const weekDates = days.map((day) => day.date);
  const hasEvents = scheduledEvents.some((event) => weekDates.includes(event.date));
  container.innerHTML = days
    .map((day) => {
      const events = scheduledEvents.filter((event) => event.date === day.date);
      return `
        <div class="day">
          <strong>${escapeHtml(day.label)}</strong>
          ${events.map(renderCalendarEvent).join("")}
        </div>
      `;
    })
    .join("") + (hasEvents ? "" : `<div class="calendar-empty">No PM or tickets scheduled this week.</div>`);
}

function renderMonthSchedule(container) {
  const [year, month] = state.scheduleMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekdayOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells = [];
  const scheduledEvents = scheduleEvents();
  for (let i = 0; i < firstWeekdayOffset; i += 1) cells.push({ blank: true });
  for (let day = 1; day <= daysInMonth; day += 1) cells.push({ day });
  container.innerHTML = cells
    .map((cell) => {
      if (cell.blank) return `<div class="month-day muted-day"></div>`;
      const date = `${state.scheduleMonth}-${String(cell.day).padStart(2, "0")}`;
      const events = scheduledEvents.filter((event) => event.date === date);
      return `
        <div class="month-day">
          <strong>${cell.day}</strong>
          ${events.map((event) => `<a class="month-event status-${event.status}" href="${event.href}">${escapeHtml(event.machine)}</a>`).join("")}
        </div>
      `;
    })
    .join("");
}

function renderListSchedule(container) {
  const scheduledEvents = scheduleEvents();
  if (scheduledEvents.length === 0) {
    container.innerHTML = `<div class="empty-state">No PM or tickets scheduled yet.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="schedule-list-wrap">
      <table>
        ${table(
          ["Date", "Type", "Machine", "Task", "Technician", "Status"],
          scheduledEvents.map((event) => [
            formatDate(event.date),
            event.type,
            linkMachine(event.machineId, event.machine),
            event.title,
            event.technician,
            `<span class="status-chip status-${event.status}">${statusLabels[event.status] || event.status}</span>`,
          ]),
        )}
      </table>
    </div>
  `;
}

function scheduleEvents() {
  const pmEvents = state.data.pmSchedule.map((pm) => ({
    type: "PM",
    date: pm.dueDate,
    machineId: pm.machineId,
    machine: pm.machine,
    title: pm.task,
    technician: pm.technician,
    status: pm.status,
    sourceStatus: pm.status,
    priority: "",
    href: `./machines.html?machine=${encodeURIComponent(pm.machineId)}`,
  }));
  const workOrderEvents = visibleWorkOrders()
    .filter((order) => order.status === "scheduled" && (order.scheduledDate || order.opened))
    .map((order) => ({
      type: "Ticket",
      date: order.scheduledDate || order.opened,
      machineId: order.machineId,
      machine: order.machine,
      title: `${order.id}: ${order.issue}`,
      technician: order.technician,
      status: order.priority === "urgent" || order.priority === "high" ? "overdue" : "scheduled",
      sourceStatus: order.status,
      priority: order.priority,
      href: `./workorders.html?edit=${encodeURIComponent(order.id)}`,
    }));
  return applyScheduleDateRange(applyScheduleFilters([...pmEvents, ...workOrderEvents])).sort((a, b) => a.date.localeCompare(b.date));
}

function applyScheduleFilters(events) {
  const filters = state.scheduleFilters;
  return events.filter((event) => {
    if (filters.machineId !== "all" && event.machineId !== filters.machineId) return false;
    if (filters.technician !== "all" && event.technician !== filters.technician) return false;
    if (filters.status !== "all" && event.status !== filters.status && event.sourceStatus !== filters.status) return false;
    if (filters.priority !== "all" && event.priority !== filters.priority) return false;
    return true;
  });
}

function applyScheduleDateRange(events) {
  if (state.page !== "schedule") return events;
  const range = currentScheduleRange();
  if (!range) return events;
  return events.filter((event) => event.date >= range.start && event.date <= range.end);
}

function currentScheduleRange() {
  if (state.scheduleView === "month") {
    const [year, month] = state.scheduleMonth.split("-").map(Number);
    if (!year || !month) return null;
    return {
      start: `${state.scheduleMonth}-01`,
      end: `${state.scheduleMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
    };
  }
  const days = currentWeekDays();
  return { start: days[0].date, end: days[6].date };
}

function scheduledEventsForWeek() {
  const weekDates = currentWeekDays().map((day) => day.date);
  return scheduleEvents().filter((event) => weekDates.includes(event.date));
}

function renderCalendarEvent(event) {
  return `
    <a class="calendar-event status-${event.status}" href="${event.href}">
      <b>${escapeHtml(event.machine)}</b>
      <span>${escapeHtml(event.title)}</span>
      <small>${escapeHtml(event.type)} · ${escapeHtml(event.technician)}</small>
    </a>
  `;
}

function renderWorkOrders() {
  if (!$("#workOrdersTable")) return;
  let orders = visibleWorkOrders().filter((order) => state.orderFilter === "all" || order.status === state.orderFilter);
  if (state.page === "schedule") {
    orders = applyScheduleFiltersToWorkOrders(orders);
  }
  if (state.search) {
    orders = orders.filter((order) => `${order.id} ${order.machine} ${order.issue}`.toLowerCase().includes(state.search));
  }
  if (orders.length === 0) {
    $("#workOrdersTable").innerHTML = emptyTable(["Priority", "Ticket", "Machine", "Issue", "Assign Technician", "Parts Needed", "Status", "Actions"], "No tickets yet.");
    return;
  }
  $("#workOrdersTable").innerHTML = table(
    ["Priority", "Ticket", "Machine", "Issue", "Assign Technician", "Parts Needed", "Status", "Actions"],
    orders.map((order) => [
      `<span class="priority-chip priority-${order.priority}">${order.priority}</span>`,
      `${order.id}<br><span class="subtle">${formatDate(order.opened)}</span>`,
      linkMachine(order.machineId, order.machine),
      order.issue,
      `<select aria-label="Assign technician for ${order.id}">${state.data.technicians.map((tech) => `<option ${tech === order.technician ? "selected" : ""}>${escapeHtml(tech)}</option>`).join("")}</select>`,
      Array.isArray(order.partsNeeded) && order.partsNeeded.length ? order.partsNeeded.join(", ") : "-",
      `<span class="status-chip status-${order.status}">${statusLabels[order.status] || order.status}</span>`,
      renderWorkOrderActions(order),
    ]),
  );
}

function applyScheduleFiltersToWorkOrders(orders) {
  const filters = state.scheduleFilters;
  return orders.filter((order) => {
    const displayStatus = scheduleOrderDisplayStatus(order);
    if (filters.machineId !== "all" && order.machineId !== filters.machineId) return false;
    if (filters.technician !== "all" && order.technician !== filters.technician) return false;
    if (filters.status !== "all" && order.status !== filters.status && displayStatus !== filters.status) return false;
    if (filters.priority !== "all" && order.priority !== filters.priority) return false;
    return true;
  });
}

function scheduleOrderDisplayStatus(order) {
  return order.priority === "urgent" || order.priority === "high" ? "overdue" : order.status;
}

function renderWorkOrderActions(order) {
  const closeAction = order.status === "completed"
    ? `<span class="subtle">Closed ${formatDate(order.completedAt)}</span>`
    : `<button class="outline-button close-order" data-close-order="${escapeHtml(order.id)}" data-permission="closeWorkOrders" type="button">Close</button>`;
  return `
    <div class="row-actions">
      <button class="outline-button" data-edit-order="${escapeHtml(order.id)}" data-permission="manageWorkOrders" type="button">Edit</button>
      ${closeAction}
      <button class="danger-action" data-delete-order="${escapeHtml(order.id)}" data-permission="deleteWorkOrders" type="button">Delete</button>
    </div>
  `;
}

function renderLogs() {
  if (!$("#allLogs")) return;
  const logs = [...state.localLogs, ...state.data.updates]
    .filter((log) => !isImportedHistoryNote(log))
    .filter((log) => !state.search || `${log.machine} ${log.note} ${log.status}`.toLowerCase().includes(state.search))
    .slice(-220)
    .reverse();
  $("#allLogs").innerHTML = logs.map(renderTimelineItem).join("");
}

async function handleLogSubmit(event) {
  event.preventDefault();
  if (!can("addLogs")) return;
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const machine = state.data.machines.find((item) => item.id === form.get("machineId"));
  const action = event.submitter?.value || "log";
  const downAt = String(form.get("downAt") || "");
  const upAt = String(form.get("upAt") || "");
  const status = statusFromEvent(action, form.get("status"));
  const eventDateTime = action === "operational" ? upAt : downAt || upAt;
  const eventDate = eventDateTime ? eventDateTime.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const durationMinutes = calculateDurationMinutes(downAt, upAt);
  const timingNote = buildTimingNote(action, downAt, upAt, durationMinutes);
  const log = {
    id: `local-${Date.now()}`,
    machineId: machine.id,
    machine: machine.name,
    date: eventDate,
    status,
    downAt,
    upAt,
    durationMinutes,
    issueType: String(form.get("issueType") || ""),
    technician: String(form.get("technician") || ""),
    note: `${form.get("issueType")}: ${form.get("notes") || "No notes entered."} ${timingNote} Technician: ${form.get("technician")}.`,
    source: state.remoteEnabled ? "App" : "Local draft",
  };
  state.localLogs.push(log);
  localStorage.setItem("tts-maintenance-local-logs", JSON.stringify(state.localLogs));
  updateMachineStatus(machine.id, status, log.note, eventDate);
  await saveRemoteLog(log, machine);
  state.selectedMachineId = machine.id;
  const savedMessage = action === "log" ? "Maintenance note recorded." : `Machine marked ${statusLabels[status] || status}. Log recorded.`;
  setText("#saveState", state.remoteEnabled ? "Saved" : "Saved locally");
  formElement.reset();
  closeLogForm();
  showPageToast(savedMessage, "success");
  hydrateFormOptions();
  renderMachineDetail();
  renderMachineIssues();
  renderMachinePm();
}

function showPageToast(message, tone = "success") {
  const toast = $("#pageToast");
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  window.clearTimeout(showPageToast.timer);
  showPageToast.timer = window.setTimeout(() => {
    toast.hidden = true;
    toast.textContent = "";
  }, 3200);
}

function hydrateRecurringFormOptions() {
  $("#recurringMachine").innerHTML = state.data.machines
    .map((machine) => `<option value="${machine.id}">${escapeHtml(machine.name)}</option>`)
    .join("");
  $("#recurringTechnician").innerHTML = state.data.technicians
    .map((tech) => `<option value="${escapeHtml(tech)}">${escapeHtml(tech)}</option>`)
    .join("");
}

function openRecurringForm(pmId = null) {
  if (!can("schedulePm")) return;
  const form = $("#recurringForm");
  if (!form) return;
  form.hidden = false;
  form.reset();
  form.elements.id.value = "";
  if (pmId) {
    const pm = state.data.pmSchedule.find((item) => item.id === pmId);
    if (!pm) return;
    form.elements.id.value = pm.id;
    form.elements.machineId.value = pm.machineId;
    form.elements.task.value = pm.task;
    form.elements.frequency.value = pm.frequency;
    form.elements.dueDate.value = pm.dueDate;
    form.elements.technician.value = pm.technician;
    form.elements.status.value = pm.status;
  }
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeRecurringForm() {
  const form = $("#recurringForm");
  if (!form) return;
  form.hidden = true;
  form.reset();
}

function handleRecurringSubmit(event) {
  event.preventDefault();
  if (!can("schedulePm")) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const machine = state.data.machines.find((item) => item.id === data.get("machineId"));
  const existingId = String(data.get("id") || "");
  const record = {
    id: existingId || `PM-${Date.now()}`,
    machineId: machine.id,
    machine: machine.name,
    task: String(data.get("task")),
    frequency: String(data.get("frequency")),
    dueDate: String(data.get("dueDate")),
    dueInHours: 0,
    technician: String(data.get("technician")),
    status: String(data.get("status")),
  };
  const index = state.data.pmSchedule.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    state.data.pmSchedule[index] = record;
  } else {
    state.data.pmSchedule.push(record);
  }
  persistPmSchedule();
  closeRecurringForm();
  renderSchedule();
}

function deleteRecurringPm(pmId) {
  state.data.pmSchedule = state.data.pmSchedule.filter((pm) => pm.id !== pmId);
  persistPmSchedule();
  renderSchedule();
}

function persistPmSchedule() {
  state.pmSchedule = state.data.pmSchedule;
  localStorage.setItem("tts-pm-schedule", JSON.stringify(state.pmSchedule));
}

function pmWithLogDueDates() {
  return state.data.pmSchedule.map((pm) => {
    const lastCompleted = findLastPmLog(pm);
    const intervalDays = frequencyToDays(pm.frequency);
    const dueDate = lastCompleted && intervalDays ? addDays(lastCompleted, intervalDays) : pm.dueDate;
    const dueInDays = daysUntil(dueDate);
    const status = pmStatusFromDueIn(dueInDays);
    return {
      ...pm,
      lastCompleted,
      dueDate,
      dueInDays,
      status,
    };
  });
}

function findLastPmLog(pm) {
  const taskWords = normalizeWords(pm.task);
  const logs = machineUpdates(pm.machineId)
    .filter((log) => {
      const text = `${log.note || ""} ${log.status || ""}`.toLowerCase();
      const looksLikePm = text.includes("pm") || text.includes("preventive") || text.includes("maintenance") || text.includes("service");
      const taskMatch = taskWords.length === 0 || taskWords.some((word) => text.includes(word));
      return looksLikePm && taskMatch;
    })
    .map((log) => log.date)
    .filter(Boolean)
    .sort();
  return logs.at(-1) || null;
}

function normalizeWords(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !["full", "service", "maintenance"].includes(word));
}

function frequencyToDays(frequency) {
  const text = String(frequency || "").toLowerCase();
  const number = Number.parseInt(text.match(/\d+/)?.[0] || "", 10);
  if (!Number.isFinite(number)) return null;
  if (text.includes("day")) return number;
  if (text.includes("week")) return number * 7;
  if (text.includes("month")) return number * 30;
  if (text.includes("quarter")) return number * 90;
  if (text.includes("year") || text.includes("annual")) return number * 365;
  if (text.includes("hr")) return Math.max(1, Math.round(number / 8));
  return number;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysUntil(dateValue) {
  const today = new Date();
  const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const due = new Date(`${dateValue}T12:00:00`);
  return Math.ceil((due - todayNoon) / 86400000);
}

function pmStatusFromDueIn(days) {
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return "scheduled";
}

function formatDueInDays(days) {
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function applyMachineOverrides() {
  state.data.machines.forEach((machine) => {
    const override = state.machineOverrides[machine.id];
    if (!override) return;
    machine.currentStatus = override.currentStatus;
    machine.latestNote = override.latestNote;
    machine.lastUpdated = override.lastUpdated;
  });
}

function applySavedAssets() {
  if (Array.isArray(state.savedAssets) && state.savedAssets.length > 0) {
    state.data.machines = state.savedAssets;
  }
}

async function persistAssets(machine = null) {
  localStorage.setItem("tts-assets", JSON.stringify(state.data.machines));
  state.savedAssets = state.data.machines;
  if (state.remoteEnabled && machine) await remoteStore.saveMachine(machine);
}

function applySettingsOverrides() {
  if (Array.isArray(state.settingsOverrides.technicians)) {
    state.data.technicians = state.settingsOverrides.technicians;
  }
  if (Array.isArray(state.settingsOverrides.issueTypes)) {
    state.data.issueTypes = state.settingsOverrides.issueTypes;
  }
  if (state.settingsOverrides.statusLabels && typeof state.settingsOverrides.statusLabels === "object") {
    Object.assign(statusLabels, state.settingsOverrides.statusLabels);
  }
  if (state.settingsOverrides.userRoles && typeof state.settingsOverrides.userRoles === "object") {
    state.data.userRoles = state.settingsOverrides.userRoles;
  }
}

async function persistSettings() {
  state.settingsOverrides = {
    technicians: state.data.technicians,
    issueTypes: state.data.issueTypes,
    statusLabels: { ...statusLabels },
    userRoles: { ...(state.data.userRoles || {}) },
  };
  localStorage.setItem("tts-settings", JSON.stringify(state.settingsOverrides));
  if (state.remoteEnabled) await remoteStore.saveSettings(state.settingsOverrides);
}

async function bindAccountMenu() {
  const dot = $(".user-dot");
  const actions = dot?.closest(".topbar-actions");
  if (!dot || !actions || actions.querySelector(".account-menu-wrap")) return;

  const user = await remoteStore.currentUser().catch(() => ({
    name: "Shop User",
    email: "",
    imageUrl: "",
    initials: "U",
  }));
  let label = actions.querySelector(".shop-user");
  if (!label) {
    label = document.createElement("span");
    label.className = "shop-user";
    dot.after(label);
  }
  label.textContent = user.name || "Shop User";

  dot.textContent = user.initials || "U";
  dot.setAttribute("role", "button");
  dot.setAttribute("tabindex", "0");
  dot.setAttribute("aria-label", "Account menu");
  dot.setAttribute("aria-haspopup", "menu");
  dot.setAttribute("aria-expanded", "false");
  dot.dataset.accountButton = "true";
  dot.classList.add("account-button");
  dot.style.backgroundImage = "";

  const wrap = document.createElement("div");
  wrap.className = "account-menu-wrap";
  dot.before(wrap);
  wrap.append(dot);
  wrap.insertAdjacentHTML(
    "beforeend",
    `
      <div class="account-menu" id="accountMenu" role="menu" hidden>
        <div class="account-menu-user">
          <strong>${escapeHtml(user.name || "Shop User")}</strong>
          <span>${escapeHtml(user.email || "Signed in")}</span>
        </div>
        <button class="outline-button account-signout" data-account-signout type="button" role="menuitem">Sign out</button>
      </div>
    `,
  );

  dot.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dot.click();
    }
  });
}

function setSettingsSaveStatus(message = "", tone = "neutral") {
  const target = $("#settingsSaveStatus");
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}

function setAssetSaveStatus(message = "", tone = "neutral") {
  const target = $("#assetSaveStatus");
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}

function settingsSaveErrorMessage(error) {
  const raw = String(error?.message || "Unknown error");
  const match = raw.match(/"error"\s*:\s*"([^"]+)"/);
  const detail = match?.[1] || raw;
  return `Could not save: ${detail}`;
}

function applyWorkOrderOverrides() {
  Object.entries(state.workOrderOverrides).forEach(([orderId, override]) => {
    if (!override || typeof override !== "object" || !override.id) return;
    const order = state.data.workOrders.find((item) => item.id === orderId);
    if (order) {
      Object.assign(order, override);
    } else if (override.status !== "deleted") {
      state.data.workOrders.push(override);
    }
  });
}

function clearLegacyDemoStorage() {
  const storedPm = JSON.parse(localStorage.getItem("tts-pm-schedule") || "null");
  if (storedPm?.some?.((pm) => String(pm.id || "").startsWith("PM-300"))) {
    localStorage.removeItem("tts-pm-schedule");
  }
  const storedOrders = JSON.parse(localStorage.getItem("tts-work-order-overrides") || "{}");
  const cleanedOrders = Object.fromEntries(
    Object.entries(storedOrders).filter(([id, order]) => {
      const isDemo = ["WO-10242", "WO-10243", "WO-10244", "WO-10245"].includes(id);
      const isValidUserOrder = order && typeof order === "object" && order.id && order.machineId && order.issue;
      return !isDemo && isValidUserOrder;
    }),
  );
  if (Object.keys(cleanedOrders).length !== Object.keys(storedOrders).length) {
    localStorage.setItem("tts-work-order-overrides", JSON.stringify(cleanedOrders));
    state.workOrderOverrides = cleanedOrders;
  }
}

async function closeWorkOrder(orderId) {
  if (!can("closeWorkOrders")) return;
  const order = state.data.workOrders.find((item) => item.id === orderId);
  if (!order) return;
  const completedAt = new Date().toISOString().slice(0, 10);
  const override = {
    status: "completed",
    completedAt,
  };
  Object.assign(order, override);
  state.workOrderOverrides[orderId] = override;
  localStorage.setItem("tts-work-order-overrides", JSON.stringify(state.workOrderOverrides));
  if (state.remoteEnabled) await remoteStore.saveWorkOrder(order);
  hydrateSidebarCounts();
  renderPage();
}

function hydrateWorkOrderFormOptions() {
  if (!$("#workOrderMachine") || !$("#workOrderTechnician")) return;
  $("#workOrderMachine").innerHTML = state.data.machines
    .map((machine) => `<option value="${machine.id}">${escapeHtml(machine.name)}</option>`)
    .join("");
  $("#workOrderTechnician").innerHTML = state.data.technicians
    .map((tech) => `<option value="${escapeHtml(tech)}">${escapeHtml(tech)}</option>`)
    .join("");
  const statusSelect = $("#workOrderStatus");
  if (statusSelect) {
    statusSelect.innerHTML = workOrderStatusKeys
      .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(statusLabels[key] || key)}</option>`)
      .join("");
  }
}

function hydrateAssetFormOptions() {
  const statusSelect = $("#assetStatus");
  if (!statusSelect) return;
  statusSelect.innerHTML = statusOptionsHtml();
}

function openWorkOrderForm(orderId = null) {
  if (!can("manageWorkOrders")) return;
  const form = $("#workOrderForm");
  const panel = $("#workOrderFormPanel");
  if (!form || !panel) {
    if (orderId) location.href = `./workorders.html?edit=${encodeURIComponent(orderId)}`;
    return;
  }
  panel.hidden = false;
  document.body.classList.add("modal-open");
  form.reset();
  setAssetSaveStatus("");
  form.elements.id.value = "";
  setText("#workOrderFormTitle", "Create Ticket");
  if (form.elements.opened) form.elements.opened.value = new Date().toISOString().slice(0, 10);
  if (orderId) {
    const order = state.data.workOrders.find((item) => item.id === orderId);
    if (!order) return;
    setText("#workOrderFormTitle", `Edit ${order.id}`);
    form.elements.id.value = order.id;
    form.elements.machineId.value = order.machineId;
    form.elements.priority.value = order.priority;
    form.elements.status.value = order.status;
    form.elements.technician.value = order.technician;
    form.elements.issue.value = order.issue;
    if (form.elements.opened) form.elements.opened.value = order.scheduledDate || order.opened || new Date().toISOString().slice(0, 10);
    form.elements.partsNeeded.value = Array.isArray(order.partsNeeded) ? order.partsNeeded.join(", ") : "";
  }
  form.elements.issue?.focus();
}

function closeWorkOrderForm() {
  const form = $("#workOrderForm");
  const panel = $("#workOrderFormPanel");
  if (!form || !panel) return;
  form.reset();
  panel.hidden = true;
  document.body.classList.remove("modal-open");
}

function openAssetForm(machineId = null) {
  if (!can("manageAssets")) return;
  const form = $("#assetForm");
  const panel = $("#assetFormPanel");
  if (!form || !panel) return;
  hydrateAssetFormOptions();
  panel.hidden = false;
  document.body.classList.add("modal-open");
  form.reset();
  form.elements.id.value = "";
  setText("#assetFormTitle", "Add Asset");
  form.elements.status.value = "operational";
  form.elements.oee.value = "100";
  setAssetImagePreview("");
  if (machineId) {
    const machine = state.data.machines.find((item) => item.id === machineId);
    if (!machine) return;
    setText("#assetFormTitle", `Edit ${machine.name}`);
    form.elements.id.value = machine.id;
    form.elements.name.value = machine.name;
    form.elements.category.value = machine.category;
    form.elements.location.value = machine.location;
    form.elements.model.value = machine.model;
    form.elements.serialNumber.value = machine.serialNumber;
    form.elements.status.value = machine.currentStatus;
    form.elements.oee.value = machine.oee ?? 100;
    form.elements.imageUrl.value = machine.imageUrl || machineImages[machine.id] || "";
    setAssetImagePreview(form.elements.imageUrl.value);
    form.elements.latestNote.value = machine.latestNote || "";
  }
  form.elements.name.focus();
}

function closeAssetForm() {
  const form = $("#assetForm");
  const panel = $("#assetFormPanel");
  if (!form || !panel) return;
  form.reset();
  setAssetSaveStatus("");
  setAssetImagePreview("");
  panel.hidden = true;
  document.body.classList.remove("modal-open");
}

function setupAssetImagePicker() {
  const form = $("#assetForm");
  const dropZone = $("#assetDropZone");
  const fileInput = $("#assetImageFile");
  const chooseButton = $("#chooseAssetImage");
  const removeButton = $("#removeAssetImage");
  if (!form || !dropZone || !fileInput || !chooseButton || !removeButton) return;

  chooseButton.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", (event) => {
    if (!event.target.closest("button")) fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleAssetImageFile(file);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleAssetImageFile(file);
  });

  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  removeButton.addEventListener("click", () => {
    form.elements.imageUrl.value = "";
    setAssetImagePreview("");
  });
}

async function handleAssetImageFile(file) {
  const form = $("#assetForm");
  if (!form || !file.type.startsWith("image/")) return;
  setAssetSaveStatus("Preparing image...", "neutral");
  try {
    const imageUrl = await compressedImageDataUrl(file);
    form.elements.imageUrl.value = imageUrl;
    setAssetImagePreview(imageUrl);
    setAssetSaveStatus("Image ready.", "success");
  } catch (error) {
    setAssetSaveStatus(`Could not use image: ${error.message || "unsupported file"}`, "error");
  }
}

function compressedImageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("file could not be read")));
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", () => reject(new Error("image could not be loaded")));
      image.addEventListener("load", () => {
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      });
      image.src = String(reader.result || "");
    });
    reader.readAsDataURL(file);
  });
}

function setAssetImagePreview(src) {
  const preview = $("#assetImagePreview");
  const removeButton = $("#removeAssetImage");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="Asset preview" />` : "IMG";
  preview.classList.toggle("has-image", Boolean(src));
  if (removeButton) removeButton.hidden = !src;
}

function openLogForm() {
  if (!can("addLogs")) return;
  const form = $("#logForm");
  const panel = $("#logFormPanel");
  if (!form || !panel) return;
  hydrateFormOptions();
  panel.hidden = false;
  document.body.classList.add("modal-open");
  if (form.elements.machineId) form.elements.machineId.value = state.selectedMachineId;
  form.elements.issueType?.focus();
}

function closeLogForm() {
  const form = $("#logForm");
  const panel = $("#logFormPanel");
  if (!form || !panel) return;
  form.reset();
  panel.hidden = true;
  document.body.classList.remove("modal-open");
  setText("#saveState", "Ready");
}

async function handleAssetSubmit(event) {
  event.preventDefault();
  if (!can("manageAssets")) return;
  const form = event.currentTarget;
  setAssetSaveStatus("Saving asset...", "neutral");
  const data = new FormData(form);
  const existingId = String(data.get("id") || "");
  const id = existingId || uniqueMachineId(String(data.get("name")));
  const existing = state.data.machines.find((machine) => machine.id === id);
  const machine = {
    ...(existing || {}),
    id,
    name: String(data.get("name") || "New Asset").trim(),
    category: String(data.get("category") || "Production").trim(),
    location: String(data.get("location") || "").trim(),
    model: String(data.get("model") || "").trim(),
    serialNumber: String(data.get("serialNumber") || "").trim(),
    currentStatus: String(data.get("status") || "operational"),
    lastUpdated: new Date().toISOString().slice(0, 10),
    latestNote: String(data.get("latestNote") || "Asset updated.").trim(),
    runtimeTodayHours: existing?.runtimeTodayHours || 0,
    utilization: existing?.utilization ?? 0,
    oee: clampNumber(data.get("oee"), 0, 100, 100),
    statusCounts: existing?.statusCounts || {},
    imageUrl: String(data.get("imageUrl") || "").trim(),
  };
  const index = state.data.machines.findIndex((item) => item.id === id);
  const previousMachines = [...state.data.machines];
  const previousSelectedMachineId = state.selectedMachineId;
  if (index >= 0) {
    state.data.machines[index] = machine;
  } else {
    state.data.machines.push(machine);
  }
  state.selectedMachineId = id;
  try {
    await persistAssets(machine);
    hydrateFormOptions();
    hydrateWorkOrderFormOptions();
    closeAssetForm();
    renderPage();
  } catch (error) {
    state.data.machines = previousMachines;
    state.selectedMachineId = previousSelectedMachineId;
    setAssetSaveStatus(settingsSaveErrorMessage(error), "error");
  }
}

async function handleWorkOrderSubmit(event) {
  event.preventDefault();
  if (!can("manageWorkOrders")) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const machine = state.data.machines.find((item) => item.id === data.get("machineId"));
  const existingId = String(data.get("id") || "");
  const existingOrder = existingId ? state.data.workOrders.find((item) => item.id === existingId) : null;
  const orderDate = String(data.get("opened") || existingOrder?.scheduledDate || existingOrder?.opened || new Date().toISOString().slice(0, 10));
  const order = {
    id: existingId || nextWorkOrderId(),
    machineId: machine.id,
    machine: machine.name,
    issue: String(data.get("issue")),
    priority: String(data.get("priority")),
    status: String(data.get("status")),
    technician: String(data.get("technician")),
    opened: orderDate,
    scheduledDate: orderDate,
    partsNeeded: String(data.get("partsNeeded") || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  };
  if (order.status === "completed") {
    order.completedAt = new Date().toISOString().slice(0, 10);
  }
  const index = state.data.workOrders.findIndex((item) => item.id === order.id);
  if (index >= 0) {
    state.data.workOrders[index] = { ...state.data.workOrders[index], ...order };
  } else {
    state.data.workOrders.push(order);
  }
  state.workOrderOverrides[order.id] = { ...state.workOrderOverrides[order.id], ...order };
  localStorage.setItem("tts-work-order-overrides", JSON.stringify(state.workOrderOverrides));
  if (state.remoteEnabled) await remoteStore.saveWorkOrder(order);
  closeWorkOrderForm();
  hydrateSidebarCounts();
  renderPage();
}

function renderSettings() {
  if (!$("#settingsLists")) return;
  renderUserAccess();
  $("#settingsLists").innerHTML = [
    renderSettingsGroup("technicians", "Technicians", state.data.technicians),
    renderSettingsGroup("issueTypes", "Issue Types", state.data.issueTypes),
    renderSettingsGroup("statuses", "Statuses", Object.entries(statusLabels).map(([key, label]) => ({ key, label: `${key}: ${label}` }))),
  ].join("");
}

function renderUserAccess() {
  const target = $("#userAccessList");
  if (!target) return;
  const assignments = state.data.userRoles || {};
  const clerkRows = (state.accessUsers || []).map((user) => {
    const email = String(user.email || "").toLowerCase();
    const assignedRole = assignments[user.id] || assignments[email] || normalizeRoleKey(user.role) || "viewer";
    return renderUserAccessRow({
      key: user.id,
      name: user.name || user.email || "User",
      email: user.email || "No email",
      role: assignedRole,
      source: assignments[user.id] || assignments[email] ? "Custom access" : "Clerk/default",
      removable: Boolean(assignments[user.id] || assignments[email]),
    });
  });
  const clerkKeys = new Set((state.accessUsers || []).flatMap((user) => [user.id, String(user.email || "").toLowerCase()]));
  const manualRows = Object.entries(assignments)
    .filter(([key]) => !clerkKeys.has(key))
    .map(([key, role]) =>
      renderUserAccessRow({
        key,
        name: key.includes("@") ? key : "Assigned User",
        email: key.includes("@") ? key : "Clerk user ID",
        role,
        source: "Manual access",
        removable: true,
      }),
    );
  const rows = [...clerkRows, ...manualRows];
  target.innerHTML = rows.length
    ? rows.join("")
    : `<div class="empty-state compact-empty">No users found yet. Add someone by email above.</div>`;
}

function renderUserAccessRow(user) {
  return `
    <div class="user-access-row">
      <div class="user-access-person">
        <span class="user-access-avatar">${escapeHtml(initialsFromName(user.name || user.email))}</span>
        <span>
          <strong>${escapeHtml(user.name)}</strong>
          <small>${escapeHtml(user.email)} · ${escapeHtml(user.source)}</small>
        </span>
      </div>
      <div class="user-access-controls">
        <select data-user-role-select data-user-role-key="${escapeHtml(user.key)}" aria-label="Role for ${escapeHtml(user.name)}">
          ${roleOptionsHtml(user.role)}
        </select>
        <button class="outline-button" data-remove-user-role="${escapeHtml(user.key)}" ${user.removable ? "" : "disabled"} type="button">Remove</button>
      </div>
    </div>
  `;
}

function roleOptionsHtml(selectedRole) {
  return Object.entries(roles)
    .map(([key, role]) => `<option value="${key}" ${key === selectedRole ? "selected" : ""}>${escapeHtml(role.label)}</option>`)
    .join("");
}

function normalizeRoleKey(value) {
  const role = String(value || "").trim().toLowerCase();
  return roles[role] ? role : "";
}

function initialsFromName(value) {
  const parts = String(value || "User")
    .replace(/@.*/, "")
    .split(/\s+|[._-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] || "U").toUpperCase();
}

function renderSettingsGroup(group, title, items) {
  const protectedStatusKeys = new Set([...logStatusKeys, ...workOrderStatusKeys]);
  return `
    <section class="panel settings-card">
      <div class="panel-title"><h2>${escapeHtml(title)}</h2></div>
      <div class="settings-list">
        ${items
          .map(
            (item) => {
              const key = typeof item === "object" ? item.key : item;
              const label = typeof item === "object" ? item.label : item;
              const isProtected = group === "statuses" && protectedStatusKeys.has(key);
              return `
              <div class="settings-row">
                <span>${escapeHtml(label)}</span>
                <div class="row-actions">
                  <button class="outline-button" data-edit-setting data-setting-key="${escapeHtml(key)}" data-setting-group="${group}" data-permission="manageSettings" type="button">Edit</button>
                  <button class="danger-action" data-delete-setting data-setting-key="${escapeHtml(key)}" data-setting-group="${group}" data-permission="manageSettings" ${isProtected ? "disabled title=\"System status cannot be removed\"" : ""} type="button">Remove</button>
                </div>
              </div>
            `;
            },
          )
          .join("")}
      </div>
    </section>
  `;
}

async function handleSettingsAdd(event) {
  event.preventDefault();
  if (!can("manageSettings")) return;
  setSettingsSaveStatus("Saving...", "neutral");
  const form = event.currentTarget;
  const data = new FormData(form);
  const group = String(data.get("group"));
  const value = String(data.get("value") || "").trim();
  if (!value) return;
  const snapshot = snapshotSettings();
  if (group === "statuses") {
    const key = slugify(value);
    statusLabels[key] = value;
  } else {
    const list = state.data[group];
    if (Array.isArray(list) && !list.includes(value)) list.push(value);
  }
  try {
    await persistSettings();
    form.reset();
    hydrateFormOptions();
    hydrateWorkOrderFormOptions();
    renderSettings();
    setSettingsSaveStatus("Saved.", "success");
  } catch (error) {
    restoreSettings(snapshot);
    renderSettings();
    setSettingsSaveStatus(settingsSaveErrorMessage(error), "error");
  }
}

async function editSetting(group, key) {
  if (!can("manageSettings")) return;
  const current = settingValue(group, key);
  if (!current) return;
  const next = window.prompt(`Edit ${settingTitle(group)}`, current);
  if (!next || !next.trim()) return;
  const snapshot = snapshotSettings();
  setSettingsSaveStatus("Saving...", "neutral");
  if (group === "statuses") {
    if (key) statusLabels[key] = next.trim();
  } else if (Array.isArray(state.data[group])) {
    const index = state.data[group].indexOf(key);
    if (index < 0) return;
    state.data[group][index] = next.trim();
  }
  try {
    await persistSettings();
    hydrateFormOptions();
    hydrateWorkOrderFormOptions();
    renderSettings();
    renderPage();
    setSettingsSaveStatus("Saved.", "success");
  } catch (error) {
    restoreSettings(snapshot);
    renderSettings();
    setSettingsSaveStatus(settingsSaveErrorMessage(error), "error");
  }
}

async function deleteSetting(group, key) {
  if (!can("manageSettings")) return;
  const snapshot = snapshotSettings();
  setSettingsSaveStatus("Saving...", "neutral");
  if (group === "statuses") {
    if (key && ![...logStatusKeys, ...workOrderStatusKeys].includes(key)) delete statusLabels[key];
  } else if (Array.isArray(state.data[group])) {
    const index = state.data[group].indexOf(key);
    if (index < 0) return;
    state.data[group].splice(index, 1);
  }
  try {
    await persistSettings();
    hydrateFormOptions();
    hydrateWorkOrderFormOptions();
    renderSettings();
    setSettingsSaveStatus("Saved.", "success");
  } catch (error) {
    restoreSettings(snapshot);
    renderSettings();
    setSettingsSaveStatus(settingsSaveErrorMessage(error), "error");
  }
}

async function handleUserRoleSubmit(event) {
  event.preventDefault();
  if (!can("manageSettings")) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim().toLowerCase();
  const role = normalizeRoleKey(data.get("role"));
  if (!email || !role) return;
  await updateUserRole(email, role, { resetForm: form });
}

async function updateUserRole(key, role, options = {}) {
  if (!can("manageSettings")) return;
  const cleanKey = String(key || "").trim();
  const cleanRole = normalizeRoleKey(role);
  if (!cleanKey || !cleanRole) return;
  const snapshot = snapshotSettings();
  setSettingsSaveStatus("Saving access...", "neutral");
  state.data.userRoles = { ...(state.data.userRoles || {}), [cleanKey]: cleanRole };
  try {
    await persistSettings();
    options.resetForm?.reset();
    renderSettings();
    setSettingsSaveStatus("Access updated.", "success");
  } catch (error) {
    restoreSettings(snapshot);
    renderSettings();
    setSettingsSaveStatus(settingsSaveErrorMessage(error), "error");
  }
}

async function removeUserRole(key) {
  if (!can("manageSettings")) return;
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return;
  const snapshot = snapshotSettings();
  setSettingsSaveStatus("Saving access...", "neutral");
  state.data.userRoles = { ...(state.data.userRoles || {}) };
  delete state.data.userRoles[cleanKey];
  try {
    await persistSettings();
    renderSettings();
    setSettingsSaveStatus("Access removed.", "success");
  } catch (error) {
    restoreSettings(snapshot);
    renderSettings();
    setSettingsSaveStatus(settingsSaveErrorMessage(error), "error");
  }
}

function snapshotSettings() {
  return {
    technicians: [...state.data.technicians],
    issueTypes: [...state.data.issueTypes],
    statusLabels: { ...statusLabels },
    userRoles: { ...(state.data.userRoles || {}) },
  };
}

function restoreSettings(snapshot) {
  state.data.technicians = [...snapshot.technicians];
  state.data.issueTypes = [...snapshot.issueTypes];
  Object.keys(statusLabels).forEach((key) => delete statusLabels[key]);
  Object.assign(statusLabels, snapshot.statusLabels);
  state.data.userRoles = { ...snapshot.userRoles };
}

function settingValue(group, key) {
  if (group === "statuses") {
    return statusLabels[key] || "";
  }
  return Array.isArray(state.data[group]) ? state.data[group].find((item) => item === key) || "" : "";
}

function settingTitle(group) {
  if (group === "issueTypes") return "issue type";
  if (group === "statuses") return "status label";
  return "technician";
}

function statusOptionsHtml(keys = Object.keys(statusLabels)) {
  return keys
    .filter((key) => statusLabels[key])
    .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(statusLabels[key])}</option>`)
    .join("");
}

async function deleteWorkOrder(orderId) {
  if (!can("deleteWorkOrders")) return;
  const order = state.data.workOrders.find((item) => item.id === orderId);
  if (!order) return;
  order.status = "deleted";
  state.workOrderOverrides[orderId] = { ...state.workOrderOverrides[orderId], status: "deleted" };
  localStorage.setItem("tts-work-order-overrides", JSON.stringify(state.workOrderOverrides));
  if (state.remoteEnabled) await remoteStore.deleteWorkOrder(orderId);
  hydrateSidebarCounts();
  renderPage();
}

function nextWorkOrderId() {
  const maxId = state.data.workOrders.reduce((max, order) => {
    const number = Number.parseInt(String(order.id).replace(/\D/g, ""), 10);
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 10245);
  return `WO-${maxId + 1}`;
}

function uniqueMachineId(name) {
  const base = slugify(name) || `asset-${Date.now()}`;
  let id = base;
  let count = 2;
  while (state.data.machines.some((machine) => machine.id === id)) {
    id = `${base}-${count}`;
    count += 1;
  }
  return id;
}

function activeWorkOrders() {
  return visibleWorkOrders().filter((order) => order.status !== "completed" && order.status !== "cancelled");
}

function visibleWorkOrders() {
  return state.data.workOrders.filter((order) => order.status !== "deleted");
}

function updateMachineStatus(machineId, status, latestNote, lastUpdated) {
  const machine = state.data.machines.find((item) => item.id === machineId);
  if (!machine) return;
  machine.currentStatus = status;
  machine.latestNote = latestNote;
  machine.lastUpdated = lastUpdated;
  state.machineOverrides[machineId] = {
    currentStatus: status,
    latestNote,
    lastUpdated,
  };
  localStorage.setItem("tts-machine-overrides", JSON.stringify(state.machineOverrides));
}

async function saveRemoteLog(log, machine) {
  if (!state.remoteEnabled) return;
  await remoteStore.saveMachine(machine);
  await remoteStore.saveLog(log);
}

function statusFromEvent(action, selectedStatus) {
  if (action === "down") return "down";
  if (action === "operational") return "operational";
  return selectedStatus === "urgent" ? "down" : selectedStatus;
}

function calculateDurationMinutes(downAt, upAt) {
  if (!downAt || !upAt) return null;
  const down = new Date(downAt);
  const up = new Date(upAt);
  if (Number.isNaN(down.getTime()) || Number.isNaN(up.getTime()) || up <= down) return null;
  return Math.round((up - down) / 60000);
}

function buildTimingNote(action, downAt, upAt, durationMinutes) {
  const parts = [];
  if (action === "down") parts.push("Machine marked down.");
  if (action === "operational") parts.push("Machine marked operational.");
  if (downAt) parts.push(`Down time: ${formatDateTime(downAt)}.`);
  if (upAt) parts.push(`Up time: ${formatDateTime(upAt)}.`);
  if (durationMinutes !== null) parts.push(`Calculated downtime: ${formatDuration(durationMinutes)}.`);
  return parts.join(" ");
}

function selectedMachine() {
  return state.data.machines.find((machine) => machine.id === state.selectedMachineId) || state.data.machines[0];
}

function machineUpdates(machineOrId) {
  const machine = typeof machineOrId === "object" ? machineOrId : state.data.machines.find((item) => item.id === machineOrId);
  const machineId = typeof machineOrId === "object" ? machineOrId.id : machineOrId;
  const machineName = normalizeText(machine?.name || "");
  return [...state.localLogs, ...state.data.updates].filter((update) => {
    if (update.machineId === machineId) return true;
    return machineName && normalizeText(update.machine || "") === machineName;
  });
}

function latestUpdates(count) {
  return [...state.localLogs, ...state.data.updates].slice(-count).reverse();
}

function downtimeToday(machine) {
  const today = new Date().toISOString().slice(0, 10);
  const minutes = downtimeMinutesForDate(machine, today);
  return {
    minutes,
    percent: Math.round((minutes / shiftMinutesPerDay) * 1000) / 10,
  };
}

function initializeDowntimeRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 4);
  state.downtimeStart = localDateValue(start);
  state.downtimeEnd = localDateValue(end);
}

function datesInRange(startValue, endValue) {
  const start = new Date(`${startValue}T12:00:00`);
  const end = new Date(`${endValue}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return lastShiftDates(5);
  }
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(localDateValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function lastShiftDates(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (count - 1 - index));
    return localDateValue(date);
  });
}

function downtimeMinutesForDate(machine, dateString) {
  const shiftStart = new Date(`${dateString}T${String(shiftStartHour).padStart(2, "0")}:00:00`);
  const shiftEnd = new Date(`${dateString}T${String(shiftEndHour).padStart(2, "0")}:00:00`);
  const totalMs = mergedDowntimeIntervals(machine).reduce((total, interval) => {
    const start = new Date(interval.downAt);
    const end = interval.upAt ? new Date(interval.upAt) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return total;
    const overlapStart = Math.max(start.getTime(), shiftStart.getTime());
    const overlapEnd = Math.min(end.getTime(), shiftEnd.getTime());
    return overlapEnd > overlapStart ? total + (overlapEnd - overlapStart) : total;
  }, 0);
  return Math.min(shiftMinutesPerDay, Math.max(0, Math.round(totalMs / 60000)));
}

function downtimeIntervals(machine) {
  const intervals = [];
  const openIntervals = [];
  const updates = machineUpdates(machine)
    .map((update) => {
      const times = logTimes(update);
      return {
        ...update,
        downAt: times.downAt,
        upAt: times.upAt,
        eventTime: times.downAt || times.upAt || (update.date ? `${update.date}T12:00:00` : ""),
      };
    })
    .filter((update) => update.eventTime)
    .sort((a, b) => new Date(a.eventTime) - new Date(b.eventTime));

  updates.forEach((update) => {
    const status = normalizeStatus(update.status);
    if (update.downAt && update.upAt) {
      intervals.push({ downAt: update.downAt, upAt: update.upAt });
      return;
    }
    if (status === "down" && update.downAt) {
      openIntervals.push({ downAt: update.downAt, upAt: "" });
      return;
    }
    if (status === "operational" && openIntervals.length) {
      const upAt = update.upAt || update.eventTime;
      openIntervals.splice(0).forEach((interval) => {
        interval.upAt = upAt;
        intervals.push(interval);
      });
    }
  });

  return [...intervals, ...openIntervals];
}

function mergedDowntimeIntervals(machine) {
  const sorted = downtimeIntervals(machine)
    .map((interval) => ({
      downAt: interval.downAt,
      upAt: interval.upAt,
      start: new Date(interval.downAt).getTime(),
      end: interval.upAt ? new Date(interval.upAt).getTime() : new Date().getTime(),
    }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  return sorted.reduce((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
      return merged;
    }
    previous.end = Math.max(previous.end, interval.end);
    previous.upAt = localDateTimeValue(new Date(previous.end));
    return merged;
  }, []);
}

function logTimes(update) {
  const status = normalizeStatus(update.status);
  return {
    downAt: update.downAt || timestampFromNote(update.note, ["Down time", "Downtime", "Down at"]) || (status === "down" ? firstTimestampFromNote(update.note) : ""),
    upAt: update.upAt || timestampFromNote(update.note, ["Up time", "Uptime", "Up at", "Back up"]) || (status === "operational" ? firstTimestampFromNote(update.note) : ""),
  };
}

function timestampFromNote(note, labels) {
  const text = String(note || "");
  const labelList = Array.isArray(labels) ? labels : [labels];
  const labelPattern = labelList.map(escapeRegExp).join("|");
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*(.*?)(?:\\.\\s*(?:Technician|Parts|$)|\\s+Technician:|$)`, "i"));
  if (!match) return "";
  const rawValue = match[1].trim().replace(/\s+/g, " ");
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return "";
  return localDateTimeValue(parsed);
}

function firstTimestampFromNote(note) {
  const text = String(note || "");
  const match = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i);
  if (!match) return "";
  const parsed = new Date(match[0]);
  if (Number.isNaN(parsed.getTime())) return "";
  return localDateTimeValue(parsed);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exposeDebugHelpers() {
  window.ttsDebugDowntime = (machineNameOrId) => {
    const machine = state.data.machines.find((item) => item.id === machineNameOrId || normalizeText(item.name) === normalizeText(machineNameOrId));
    if (!machine) return { error: "Machine not found" };
    return {
      machine,
      updates: machineUpdates(machine).map((update) => ({ id: update.id, machineId: update.machineId, machine: update.machine, date: update.date, status: update.status, downAt: update.downAt, upAt: update.upAt, parsed: logTimes(update), note: update.note })),
      intervals: downtimeIntervals(machine),
      mergedIntervals: mergedDowntimeIntervals(machine),
      today: downtimeToday(machine),
    };
  };
}

function localDateTimeValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function localDateValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function renderTimelineItem(update) {
  const status = normalizeStatus(update.status);
  return `
    <div class="timeline-item status-${status}">
      <strong>${escapeHtml(update.machine || "Machine")}</strong>
      <span class="subtle">${formatDate(update.date)} · ${statusLabels[status] || status}</span>
      <p>${escapeHtml(update.note || "")}</p>
    </div>
  `;
}

function isImportedHistoryNote(update) {
  return /history\s+imported\s+from\s+excel/i.test(String(update?.note || ""));
}

function table(headers, rows) {
  return `
    <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
  `;
}

function emptyTable(headers, message) {
  return `
    <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
    <tbody><tr><td colspan="${headers.length}"><div class="empty-state">${escapeHtml(message)}</div></td></tr></tbody>
  `;
}

function linkMachine(id, name) {
  return `<a class="table-link" href="./machines.html?machine=${encodeURIComponent(id)}">${escapeHtml(name)}</a>`;
}

function machineArt(machine) {
  const src = machineImageSrc(machine);
  if (src) {
    return `<img class="machine-art photo-art" src="${src}" alt="${escapeHtml(machine.name)}" />`;
  }
  return `<div class="machine-art ${machine.category.toLowerCase()}">${machineIcons[machine.id] || "EQ"}</div>`;
}

function machinePhoto(machine) {
  const src = machineImageSrc(machine);
  if (src) {
    return `<img class="photo-machine real-photo" src="${src}" alt="${escapeHtml(machine.name)}" />`;
  }
  return `<div class="photo-machine">${machineIcons[machine.id] || "EQ"}</div>`;
}

function machineImageSrc(machine) {
  if (machine.imageUrl) return machine.imageUrl;
  if (machineImages[machine.id]) return machineImages[machine.id];
  const text = `${machine.name || ""} ${machine.category || ""} ${machine.model || ""}`.toLowerCase();
  if (text.includes("forklift") || text.includes("fork lift") || text.includes("toyota lp") || text.includes("8fgu") || text.includes("25lc")) {
    return machineImages.forklift;
  }
  if (text.includes("power grip")) {
    return machineImages["power-grip"];
  }
  return "";
}

function footerCopy(machine) {
  if (machine.currentStatus === "down") return `Down since ${downSinceLabel(machine)}`;
  if (machine.currentStatus === "maintenance") return "PM due in 2 days";
  return `Last run: ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function downSinceLabel(machine) {
  const downEvent = [...machineUpdates(machine.id)]
    .reverse()
    .find((update) => normalizeStatus(update.status) === "down");
  const value = downEvent?.downAt || downEvent?.date || machine.lastUpdated;
  if (!value) return "unknown";
  return formatDownSince(value);
}

function formatDownSince(value) {
  const raw = String(value);
  const hasTime = raw.includes("T");
  const date = new Date(hasTime ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  const today = new Date().toISOString().slice(0, 10);
  const eventDay = hasTime ? raw.slice(0, 10) : raw;
  if (eventDay === today) {
    return hasTime ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "today";
  }
  return hasTime
    ? date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : formatDate(raw);
}

function shortLocation(location) {
  return String(location || "").replace("Shop Floor - ", "");
}

function titleFromNote(note) {
  const clean = String(note || "Maintenance log").split(".")[0].trim();
  return clean.length > 34 ? `${clean.slice(0, 34)}...` : clean;
}

function normalizeStatus(status) {
  return String(status || "unknown").toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function emptyMessage(message) {
  return `<p class="subtle">${message}</p>`;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  document.body.innerHTML = `<main class="main"><h1>Unable to load app data</h1><p>${escapeHtml(error.message)}</p></main>`;
});
