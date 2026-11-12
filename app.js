
/* =========================================================
   DAYFLOW — Application Core
   Vanilla JavaScript | IndexedDB | Local-first
   ========================================================= */

(() => {
  "use strict";

  /* -------------------- CONFIG -------------------- */

  const DB_NAME = "dayflow-local";
  const DB_VERSION = 1;
  const STORE_NAME = "tasks";
  const BACKUP_VERSION = 1;

  const PAGE_NAMES = {
    overview: "Overview",
    tasks: "My tasks",
    settings: "Settings",
    comingSoon: "Coming soon"
  };

  const state = {
    db: null,
    tasks: [],
    filter: "all",
    search: "",
    editingTaskId: null,
    currentPage: "overview"
  };

  const $ = (selector, parent = document) =>
    parent.querySelector(selector);

  const $$ = (selector, parent = document) =>
    [...parent.querySelectorAll(selector)];

  /* -------------------- HELPERS -------------------- */

  function createId() {
    if (window.crypto?.randomUUID) {
      return crypto.randomUUID();
    }

    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function todayString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset)
      .toISOString()
      .slice(0, 10);
  }

  function formatDate(dateString) {
    if (!dateString) return "";

    const date = new Date(`${dateString}T00:00:00`);

    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatToday() {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date());
  }

  function escapeText(value) {
    return String(value ?? "");
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(showToast.timeout);

    showToast.timeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setTheme(theme) {
    const isDark = theme === "dark";

    document.body.classList.toggle("dark", isDark);

    const themeButton = $("#theme-toggle");
    const settingsButton = $("#settings-theme-toggle");

    if (themeButton) {
      themeButton.setAttribute(
        "aria-label",
        isDark ? "Switch to light theme" : "Switch to dark theme"
      );
    }

    if (settingsButton) {
      settingsButton.textContent = isDark
        ? "Switch to light mode"
        : "Switch to dark mode";
    }

    try {
      localStorage.setItem("dayflow-theme", isDark ? "dark" : "light");
    } catch (error) {
      console.warn("Theme preference could not be saved.", error);
    }
  }

  function loadTheme() {
    try {
      const savedTheme = localStorage.getItem("dayflow-theme");
      setTheme(savedTheme === "dark" ? "dark" : "light");
    } catch {
      setTheme("light");
    }
  }

  /* -------------------- DATABASE -------------------- */

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Your browser does not support local storage."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: "id"
          });
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          showToast("Please refresh DAYFLOW to update its storage.");
        };

        resolve(db);
      };

      request.onerror = () => {
        reject(request.error || new Error("Database could not open."));
      };

      request.onblocked = () => {
        showToast("Close other DAYFLOW tabs and refresh.");
      };
    });
  }

  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error("Storage operation failed."));
      transaction.onabort = () =>
        reject(transaction.error || new Error("Storage operation cancelled."));
    });
  }

  async function getAllTasks() {
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const request = transaction.objectStore(STORE_NAME).getAll();

    const tasks = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    await completion;
    return tasks;
  }

  async function saveTaskToDB(task) {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);

    transaction.objectStore(STORE_NAME).put(task);

    await completion;
  }

  async function deleteTaskFromDB(id) {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);

    transaction.objectStore(STORE_NAME).delete(id);

    await completion;
  }

  async function replaceAllTasks(tasks) {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);

    store.clear();

    tasks.forEach(task => {
      store.put(task);
    });

    await completion;
  }

  /* -------------------- TASK DATA -------------------- */

  function normalizeTask(task) {
    return {
      id: String(task.id || createId()),
      title: escapeText(task.title).trim(),
      category: escapeText(task.category || "Personal"),
      priority: ["high", "medium", "low"].includes(task.priority)
        ? task.priority
        : "medium",
      completed: Boolean(task.completed),
      dueDate: typeof task.dueDate === "string" ? task.dueDate : "",
      notes: escapeText(task.notes),
      createdAt: Number(task.createdAt) || Date.now(),
      updatedAt: Number(task.updatedAt) || Date.now()
    };
  }

  async function refreshTasks() {
    state.tasks = (await getAllTasks()).map(normalizeTask);

    renderTasks();
    renderDashboard();
    updateSidebarCount();
  }

  async function createTask(data) {
    const now = Date.now();

    const task = normalizeTask({
      id: createId(),
      ...data,
      completed: false,
      createdAt: now,
      updatedAt: now
    });

    await saveTaskToDB(task);
    await refreshTasks();

    showToast("Task created successfully.");
  }

  async function updateTask(id, data) {
    const existing = state.tasks.find(task => task.id === id);
    if (!existing) return;

    const updated = normalizeTask({
      ...existing,
      ...data,
      id,
      updatedAt: Date.now()
    });

    await saveTaskToDB(updated);
    await refreshTasks();

    showToast("Task updated.");
  }

  async function toggleTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;

    await updateTask(id, {
      completed: !task.completed
    });
  }

  async function deleteTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;

    if (!window.confirm(`Delete "${task.title}"?`)) return;

    await deleteTaskFromDB(id);
    await refreshTasks();

    showToast("Task deleted.");
  }

  /* -------------------- TASK MODAL -------------------- */

  const taskModal = $("#task-modal");
  const taskForm = $("#task-form");

  function openTaskModal(task = null) {
    if (!taskModal || !taskForm) return;

    state.editingTaskId = task ? task.id : null;

    taskForm.reset();

    setText(
      "task-modal-title",
      task ? "Edit task" : "Create a task"
    );

    if (task) {
      $("#task-title").value = task.title;
      $("#task-category").value = task.category;
      $("#task-priority").value = task.priority;
      $("#task-due-date").value = task.dueDate || "";
      $("#task-notes").value = task.notes || "";
    } else {
      $("#task-priority").value = "medium";
    }

    const submitButton = $("#save-task-button");
    if (submitButton) {
      submitButton.textContent = task ? "Save changes" : "Create task";
    }

    if (typeof taskModal.showModal === "function") {
      taskModal.showModal();
      $("#task-title")?.focus();
    }
  }

  function closeTaskModal() {
    if (taskModal?.open) {
      taskModal.close();
    }

    state.editingTaskId = null;
  }

  async function handleTaskSubmit(event) {
    event.preventDefault();

    const title = $("#task-title")?.value.trim();

    if (!title) {
      $("#task-title")?.focus();
      showToast("Please enter a task title.");
      return;
    }

    const data = {
      title,
      category: $("#task-category")?.value || "Personal",
      priority: $("#task-priority")?.value || "medium",
      dueDate: $("#task-due-date")?.value || "",
      notes: $("#task-notes")?.value.trim() || ""
    };

    const submitButton = $("#save-task-button");
    if (submitButton) submitButton.disabled = true;

    try {
      if (state.editingTaskId) {
        await updateTask(state.editingTaskId, data);
      } else {
        await createTask(data);
      }

      closeTaskModal();
      taskForm.reset();
    } catch (error) {
      console.error(error);
      showToast("Could not save your task. Please try again.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  /* -------------------- TASK RENDERING -------------------- */

  function createTaskElement(task) {
    const item = document.createElement("article");
    item.className = "task-item";

    if (task.completed) {
      item.classList.add("is-completed");
    }

    const checkbox = document.createElement("button");
    checkbox.type = "button";
    checkbox.className = "task-checkbox";
    checkbox.classList.toggle("completed", task.completed);
    checkbox.setAttribute(
      "aria-label",
      task.completed ? "Mark task as incomplete" : "Mark task as complete"
    );
    checkbox.setAttribute("aria-pressed", String(task.completed));
    checkbox.textContent = task.completed ? "✓" : "";

    checkbox.addEventListener("click", () => {
      toggleTask(task.id).catch(handleStorageError);
    });

    const content = document.createElement("div");
    content.className = "task-content";

    const title = document.createElement("p");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const category = document.createElement("span");
    category.textContent = task.category;

    const priority = document.createElement("span");
    priority.className = `priority priority-${task.priority}`;
    priority.textContent =
      task.priority.charAt(0).toUpperCase() + task.priority.slice(1);

    meta.append(category, priority);

    if (task.dueDate) {
      const dueDate = document.createElement("span");
      dueDate.className = "task-due-date";
      dueDate.textContent = formatDate(task.dueDate);
      meta.append(dueDate);
    }

    content.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "task-action-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => openTaskModal(task));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "task-action-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      deleteTask(task.id).catch(handleStorageError);
    });

    actions.append(editButton, deleteButton);
    item.append(checkbox, content, actions);

    return item;
  }

  function createEmptyMessage(message) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const text = document.createElement("p");
    text.textContent = message;

    empty.append(text);
    return empty;
  }

  function getFilteredTasks() {
    let tasks = [...state.tasks];

    if (state.filter === "todo") {
      tasks = tasks.filter(task => !task.completed);
    } else if (state.filter === "done") {
      tasks = tasks.filter(task => task.completed);
    }

    if (state.search) {
      const query = state.search.toLowerCase();

      tasks = tasks.filter(task =>
        `${task.title} ${task.category} ${task.notes}`
          .toLowerCase()
          .includes(query)
      );
    }

    return tasks.sort((a, b) => {
      if (a.completed !== b.completed) {
        return Number(a.completed) - Number(b.completed);
      }

      const priorityOrder = {
        high: 0,
        medium: 1,
        low: 2
      };

      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }

      return b.createdAt - a.createdAt;
    });
  }

  function renderTasks() {
    const list = $("#task-list");
    if (!list) return;

    list.replaceChildren();

    const tasks = getFilteredTasks();

    if (tasks.length === 0) {
      list.append(
        createEmptyMessage(
          state.search
            ? "No tasks match your search."
            : "Nothing here yet. Add your first task!"
        )
      );
    } else {
      tasks.forEach(task => {
        list.append(createTaskElement(task));
      });
    }

    const total = state.tasks.length;
    const completed = state.tasks.filter(task => task.completed).length;

    setText(
      "task-summary-text",
      `${total} ${total === 1 ? "task" : "tasks"} in total`
    );

    setText(
      "task-completion-text",
      `${completed} of ${total} completed`
    );
  }

  /* -------------------- DASHBOARD -------------------- */

  function renderDashboard() {
    const total = state.tasks.length;
    const completed = state.tasks.filter(task => task.completed).length;
    const remaining = total - completed;

    const percentage = total > 0
      ? Math.round((completed / total) * 100)
      : 0;

    setText("stat-tasks", String(remaining));

    setText(
      "stat-tasks-description",
      total === 0
        ? "Start by adding your first task"
        : `${completed} completed out of ${total}`
    );

    setText("task-completion-text", `${completed} of ${total} completed`);

    const progress = $("#task-progress-bar");

    if (progress) {
      progress.style.width = `${percentage}%`;
      progress.setAttribute("aria-valuenow", String(percentage));
    }

    const dashboardList = $("#dashboard-task-list");

    if (dashboardList) {
      dashboardList.replaceChildren();

      const today = todayString();

      const dashboardTasks = state.tasks
        .filter(task => !task.completed)
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) {
            return a.dueDate.localeCompare(b.dueDate);
          }

          if (a.dueDate) return -1;
          if (b.dueDate) return 1;

          return b.createdAt - a.createdAt;
        })
        .slice(0, 5);

      if (dashboardTasks.length === 0) {
        dashboardList.append(
          createEmptyMessage("You're all caught up. Enjoy your day!")
        );
      } else {
        dashboardTasks.forEach(task => {
          dashboardList.append(createTaskElement(task));
        });
      }

      const overdueCount = state.tasks.filter(task =>
        !task.completed &&
        task.dueDate &&
        task.dueDate < today
      ).length;

      if (overdueCount > 0) {
        setText(
          "stat-tasks-description",
          `${overdueCount} overdue · ${completed} completed`
        );
      }
    }
  }

  function updateSidebarCount() {
    const remaining = state.tasks.filter(task => !task.completed).length;
    setText("sidebar-task-count", String(remaining));
  }

  /* -------------------- NAVIGATION -------------------- */

  function closeMobileSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebar-overlay")?.classList.remove("visible");
  }

  function navigateTo(page) {
    const availablePages = ["overview", "tasks", "settings"];
    const isAvailable = availablePages.includes(page);

    const targetPage = isAvailable ? page : "coming-soon";

    state.currentPage = targetPage;

    $$("[data-page-content]").forEach(section => {
      section.classList.toggle(
        "active",
        section.dataset.pageContent === targetPage
      );
    });

    $$("[data-page]").forEach(link => {
      const active = link.dataset.page === page;
      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    setText(
      "breadcrumb-current",
      PAGE_NAMES[targetPage] || PAGE_NAMES.comingSoon
    );

    if (!isAvailable) {
      setText("coming-soon-title", page.charAt(0).toUpperCase() + page.slice(1));
      setText(
        "coming-soon-description",
        "This section is part of the DAYFLOW roadmap and will be available in a future update."
      );
    }

    closeMobileSidebar();

    if (targetPage === "tasks") {
      renderTasks();
    }

    if (targetPage === "overview") {
      renderDashboard();
    }
  }

  /* -------------------- PROFILE -------------------- */

  function loadProfile() {
    const profileInput = $("#profile-name");
    const avatar = $("#profile-avatar");

    let savedName = "Your name";

    try {
      savedName = localStorage.getItem("dayflow-profile-name") || "Your name";
    } catch {
      // Continue with default name.
    }

    if (profileInput) {
      profileInput.value = savedName;
    }

    if (avatar) {
      avatar.textContent = savedName.trim().charAt(0).toUpperCase() || "D";
    }

    const greeting = $("#greeting");

    if (greeting) {
      const hour = new Date().getHours();

      const timeGreeting = hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";

      greeting.textContent = `${timeGreeting}, ${savedName}`;
    }
  }

  function saveProfile() {
    const profileInput = $("#profile-name");
    if (!profileInput) return;

    const name = profileInput.value.trim() || "Your name";

    try {
      localStorage.setItem("dayflow-profile-name", name);
      profileInput.value = name;
      loadProfile();
      showToast("Profile updated.");
    } catch {
      showToast("Could not save your profile preference.");
    }
  }

  /* -------------------- BACKUP / RESTORE -------------------- */

  function exportBackup() {
    const backup = {
      app: "DAYFLOW",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      tasks: state.tasks.map(normalizeTask)
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `dayflow-backup-${todayString()}.json`;

    document.body.append(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    showToast("Your backup is ready.");
  }

  function validateBackup(data) {
    if (
      !data ||
      data.app !== "DAYFLOW" ||
      !Array.isArray(data.tasks)
    ) {
      throw new Error("This file is not a valid DAYFLOW backup.");
    }

    if (data.version !== BACKUP_VERSION) {
      throw new Error("This backup version is not supported.");
    }

    if (data.tasks.length > 10000) {
      throw new Error("This backup contains too many tasks.");
    }

    const ids = new Set();

    return data.tasks.map(item => {
      if (
        !item ||
        typeof item.title !== "string" ||
        !item.title.trim()
      ) {
        throw new Error("The backup contains an invalid task.");
      }

      const task = normalizeTask(item);

      if (ids.has(task.id)) {
        throw new Error("The backup contains duplicate task IDs.");
      }

      ids.add(task.id);
      return task;
    });
  }

  async function importBackup(file) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Backup file is too large.");
    }

    const content = await file.text();
    const parsed = JSON.parse(content);
    const importedTasks = validateBackup(parsed);

    const shouldReplace = window.confirm(
      `This backup contains ${importedTasks.length} tasks.\n\n` +
      "OK = Replace your current tasks\n" +
      "Cancel = Keep your current tasks and merge"
    );

    let finalTasks;

    if (shouldReplace) {
      finalTasks = importedTasks;
    } else {
      const existing = [...state.tasks];
      const existingIds = new Set(existing.map(task => task.id));

      const newTasks = importedTasks.filter(
        task => !existingIds.has(task.id)
      );

      finalTasks = [...existing, ...newTasks];
    }

    await replaceAllTasks(finalTasks);
    await refreshTasks();

    showToast("Backup imported successfully.");
  }

  /* -------------------- STORAGE STATUS -------------------- */

  async function updateStorageStatus() {
    const status = $("#storage-status");
    if (!status) return;

    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();

        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;

        const usageMB = (usage / (1024 * 1024)).toFixed(2);
        const quotaMB = quota
          ? (quota / (1024 * 1024)).toFixed(0)
          : "Unknown";

        status.textContent = `Local storage · ${usageMB} MB used`;
        status.title = `Estimated browser storage quota: ${quotaMB} MB`;
        return;
      } catch {
        // Fall through to default status.
      }
    }

    status.textContent = "Data stored locally in this browser";
  }

  /* -------------------- ERROR HANDLING -------------------- */

  function handleStorageError(error) {
    console.error("DAYFLOW storage error:", error);
    showToast("Something went wrong. Please try again.");
  }

  /* -------------------- EVENT LISTENERS -------------------- */

  function bindEvents() {
    // Navigation
    $$("[data-page]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        navigateTo(link.dataset.page);
      });
    });

    // Add task buttons
    $("#add-task-button")?.addEventListener("click", () => {
      openTaskModal();
    });

    $("#dashboard-add-task")?.addEventListener("click", () => {
      openTaskModal();
    });

    // Modal controls
    $("#close-task-modal")?.addEventListener("click", closeTaskModal);
    $("#cancel-task-button")?.addEventListener("click", closeTaskModal);

    taskForm?.addEventListener("submit", event => {
      handleTaskSubmit(event).catch(handleStorageError);
    });

    taskModal?.addEventListener("click", event => {
      if (event.target === taskModal) {
        closeTaskModal();
      }
    });

    // Task filters
    $$("[data-filter]").forEach(button => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;

        $$("[data-filter]").forEach(filterButton => {
          const active = filterButton === button;
          filterButton.classList.toggle("active", active);
          filterButton.setAttribute("aria-pressed", String(active));
        });

        renderTasks();
      });
    });

    // Task search
    $("#task-search")?.addEventListener("input", event => {
      state.search = event.target.value.trim();
      renderTasks();
    });

    // Theme
    $("#theme-toggle")?.addEventListener("click", () => {
      const nextTheme = document.body.classList.contains("dark")
        ? "light"
        : "dark";

      setTheme(nextTheme);
    });

    $("#settings-theme-toggle")?.addEventListener("click", () => {
      const nextTheme = document.body.classList.contains("dark")
        ? "light"
        : "dark";

      setTheme(nextTheme);
    });

    // Mobile navigation
    $("#mobile-menu-button")?.addEventListener("click", () => {
      $("#sidebar")?.classList.add("open");
      $("#sidebar-overlay")?.classList.add("visible");
    });

    $("#sidebar-overlay")?.addEventListener("click", closeMobileSidebar);

    // Profile
    $("#profile-name")?.addEventListener("change", saveProfile);

    $("#profile-button")?.addEventListener("click", () => {
      navigateTo("settings");
    });

    // Backup
    $("#export-data-button")?.addEventListener("click", exportBackup);

    $("#import-data-button")?.addEventListener("click", () => {
      $("#import-file-input")?.click();
    });

    $("#import-file-input")?.addEventListener("change", async event => {
      const file = event.target.files?.[0];

      try {
        await importBackup(file);
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not import backup.");
      } finally {
        event.target.value = "";
      }
    });

    // Escape key
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeMobileSidebar();
      }
    });
  }

  /* -------------------- INITIALIZATION -------------------- */

  async function init() {
    setText("current-date", formatToday());

    loadTheme();
    loadProfile();
    bindEvents();

    try {
      state.db = await openDatabase();

      await refreshTasks();
      await updateStorageStatus();

      document.documentElement.classList.add("app-ready");

      console.info("DAYFLOW initialized successfully.");
    } catch (error) {
      console.error("DAYFLOW initialization failed:", error);

      showToast(
        "DAYFLOW could not open local storage. Try refreshing the page."
      );

      setText(
        "storage-status",
        "Local storage unavailable"
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();
