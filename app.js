
(() => {
  "use strict";

  const DB_NAME = "dayflow-local";
  const DB_VERSION = 1;

  const STORES = [
    "tasks",
    "money",
    "fitness",
    "water",
    "study",
    "habits",
    "habitChecks",
    "focus",
    "journal"
  ];

  const state = {
    db: null,
    page: "overview",
    filter: "all",
    search: "",
    editingTask: null,
    editingRecord: null,
    timer: null,
    seconds: 25 * 60,
    timerRunning: false,
    timerMode: "focus"
  };

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "id" });
          }
        });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestStore(store, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(store, mode);
      const request = operation(tx.objectStore(store));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const getAll = store =>
    requestStore(store, "readonly", objectStore =>
      objectStore.getAll()
    );

  const save = (store, record) =>
    requestStore(store, "readwrite", objectStore =>
      objectStore.put(record)
    );

  const remove = (store, id) =>
    requestStore(store, "readwrite", objectStore =>
      objectStore.delete(id)
    );

  const makeId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  const today = () =>
    new Date().toISOString().slice(0, 10);

  const moneyFormat = amount =>
    new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency: "LKR",
      maximumFractionDigits: 0
    }).format(Number(amount) || 0);

  function toast(message) {
    const element = $("#toast");

    if (!element) {
      console.log(message);
      return;
    }

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(
      () => element.classList.remove("show"),
      2600
    );
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function getPreference(key, fallback = "") {
    return localStorage.getItem(`dayflow-${key}`) ?? fallback;
  }

  function setPreference(key, value) {
    localStorage.setItem(`dayflow-${key}`, value);
  }

  function setTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    setPreference("theme", theme);

    const button = $("#theme-toggle");
    if (button) {
      button.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      );
    }
  }

  function formatDate(date) {
    if (!date) return "";

    return new Date(`${date}T00:00:00`).toLocaleDateString(
      undefined,
      { day: "numeric", month: "short" }
    );
  }

  async function getTasks() {
    return getAll("tasks");
  }

  async function addTask(data) {
    await save("tasks", {
      id: makeId(),
      title: data.title.trim(),
      category: data.category || "Personal",
      priority: data.priority || "medium",
      dueDate: data.dueDate || "",
      notes: data.notes || "",
      completed: false,
      createdAt: new Date().toISOString()
    });

    toast("Task created successfully");
    await refresh();
  }

  async function updateTask(id, changes) {
    const tasks = await getTasks();
    const task = tasks.find(item => item.id === id);

    if (!task) return;

    await save("tasks", { ...task, ...changes });
    toast("Task updated");
    await refresh();
  }

  async function deleteTask(id) {
    if (!confirm("Delete this task?")) return;

    await remove("tasks", id);
    toast("Task deleted");
    await refresh();
  }

  function taskElement(task) {
    const item = document.createElement("article");
    item.className = `task-item ${task.completed ? "is-completed" : ""}`;

    const content = document.createElement("div");
    content.className = "task-content";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", "Complete task");

    checkbox.addEventListener("change", () =>
      updateTask(task.id, { completed: checkbox.checked })
    );

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = [
      task.category,
      task.dueDate ? formatDate(task.dueDate) : "",
      task.priority
    ].filter(Boolean).join(" · ");

    content.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const edit = document.createElement("button");
    edit.className = "task-action-button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openTaskModal(task));

    const del = document.createElement("button");
    del.className = "task-action-button";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteTask(task.id));

    actions.append(edit, del);
    item.append(checkbox, content, actions);

    return item;
  }

  function renderTaskList(tasks, selector) {
    const container = $(selector);
    if (!container) return;

    container.replaceChildren();

    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nothing here yet. Add your first task!";
      container.append(empty);
      return;
    }

    tasks.forEach(task =>
      container.append(taskElement(task))
    );
  }

  async function renderTasks() {
    let tasks = await getTasks();

    if (state.filter === "todo") {
      tasks = tasks.filter(task => !task.completed);
    }

    if (state.filter === "done") {
      tasks = tasks.filter(task => task.completed);
    }

    if (state.search) {
      tasks = tasks.filter(task =>
        task.title.toLowerCase().includes(state.search)
      );
    }

    tasks.sort((a, b) =>
      Number(a.completed) - Number(b.completed)
    );

    renderTaskList(tasks, "#task-list");

    const all = await getTasks();
    const completed = all.filter(task => task.completed).length;

    setText(
      "#task-summary-text",
      `${all.length} tasks`
    );

    setText(
      "#task-completion-text",
      `${completed} completed`
    );

    setText(
      "#sidebar-task-count",
      String(all.filter(task => !task.completed).length)
    );
  }

  async function renderDashboard() {
    const tasks = await getTasks();
    const completed = tasks.filter(task => task.completed).length;
    const pending = tasks.length - completed;

    setText("#stat-tasks", String(pending));
    setText("#stat-tasks-description", `${completed} completed`);

    const progress = $("#task-progress-bar");

    if (progress) {
      progress.style.width = tasks.length
        ? `${completed / tasks.length * 100}%`
        : "0%";
    }

    const greeting = $("#greeting");

    if (greeting) {
      const hour = new Date().getHours();
      greeting.textContent =
        hour < 12 ? "Good morning" :
        hour < 18 ? "Good afternoon" :
        "Good evening";
    }

    renderTaskList(
      tasks.filter(task => !task.completed).slice(0, 5),
      "#dashboard-task-list"
    );
  }

  function openTaskModal(task = null) {
    state.editingTask = task;

    const modal = $("#task-modal");
    if (!modal) return;

    setText(
      "#task-modal-title",
      task ? "Edit task" : "Create a task"
    );

    $("#task-title").value = task?.title || "";
    $("#task-category").value = task?.category || "Personal";
    $("#task-priority").value = task?.priority || "medium";
    $("#task-due-date").value = task?.dueDate || "";
    $("#task-notes").value = task?.notes || "";

    modal.showModal();
    $("#task-title").focus();
  }

  function closeTaskModal() {
    const modal = $("#task-modal");

    if (modal?.open) modal.close();

    state.editingTask = null;
    $("#task-form")?.reset();
  }

  async function handleTaskSubmit(event) {
    event.preventDefault();

    const data = {
      title: $("#task-title").value.trim(),
      category: $("#task-category").value,
      priority: $("#task-priority").value,
      dueDate: $("#task-due-date").value,
      notes: $("#task-notes").value.trim()
    };

    if (!data.title) return;

    if (state.editingTask) {
      await updateTask(state.editingTask.id, data);
    } else {
      await addTask(data);
    }

    closeTaskModal();
  }

  const MODULES = {
    money: {
      title: "Money",
      description: "Keep track of your income and expenses.",
      store: "money",
      fields: [
        ["type", "Type", "select", ["expense", "income"]],
        ["amount", "Amount (LKR)", "number"],
        ["category", "Category", "text"],
        ["description", "Description", "text"],
        ["date", "Date", "date"]
      ]
    },
    fitness: {
      title: "Fitness",
      description: "Record your activities and progress.",
      store: "fitness",
      fields: [
        ["activity", "Activity", "text"],
        ["duration", "Duration (minutes)", "number"],
        ["distance", "Distance (km)", "number"],
        ["date", "Date", "date"],
        ["notes", "Notes", "textarea"]
      ]
    },
    hydration: {
      title: "Hydration",
      description: "Track your daily water intake.",
      store: "water",
      fields: [
        ["amount", "Water (ml)", "number"]
      ]
    },
    study: {
      title: "Study",
      description: "Track your learning sessions.",
      store: "study",
      fields: [
        ["subject", "Subject", "text"],
        ["duration", "Duration (minutes)", "number"],
        ["topic", "Topic", "text"],
        ["date", "Date", "date"]
      ]
    },
    habits: {
      title: "Habits",
      description: "Build consistent daily habits.",
      store: "habits",
      fields: [
        ["name", "Habit name", "text"]
      ]
    },
    journal: {
      title: "Journal",
      description: "A private space for your thoughts.",
      store: "journal",
      fields: [
        ["title", "Title", "text"],
        ["mood", "Mood", "select", ["Good", "Okay", "Low", "Focused"]],
        ["date", "Date", "date"],
        ["content", "Your entry", "textarea"]
      ]
    }
  };

  function moduleField(field) {
    const [name, label, type, options] = field;
    const id = `module-${name}`;

    let control = "";

    if (type === "select") {
      control = `<select id="${id}" name="${name}">
        ${options.map(option =>
          `<option value="${escapeHTML(option)}">${escapeHTML(option)}</option>`
        ).join("")}
      </select>`;
    } else if (type === "textarea") {
      control = `<textarea id="${id}" name="${name}" rows="3"></textarea>`;
    } else {
      control = `<input id="${id}" name="${name}" type="${type}"
        ${type === "number" ? 'min="0" step="any"' : ""}
        ${type === "date" ? `value="${today()}"` : ""}
        ${name === "amount" || name === "duration" ? "required" : ""}>`;
    }

    return `<label class="field">
      <span>${escapeHTML(label)}</span>
      ${control}
    </label>`;
  }

  async function renderModule(page) {
    const root = $("#module-root");
    const config = MODULES[page];

    if (!root || !config) return;

    const records = await getAll(config.store);

    let extra = "";

    if (page === "money") {
      const income = records
        .filter(item => item.type === "income")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      const expenses = records
        .filter(item => item.type === "expense")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      extra = `<div class="module-grid">
        <article class="module-card">
          <span>Income</span><h3>${moneyFormat(income)}</h3>
        </article>
        <article class="module-card">
          <span>Expenses</span><h3>${moneyFormat(expenses)}</h3>
        </article>
        <article class="module-card">
          <span>Balance</span><h3>${moneyFormat(income - expenses)}</h3>
        </article>
      </div>`;
    }

    if (page === "hydration") {
      const goal = Number(getPreference("water-goal", "2000"));
      const intake = records
        .filter(item => item.date === today())
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      extra = `<div class="module-card">
        <h3>${intake} / ${goal} ml</h3>
        <p>Today's water intake</p>
        <button class="primary-button" data-water="250">+250 ml</button>
        <button class="secondary-button" data-water="500">+500 ml</button>
        <label class="field">Daily goal (ml)
          <input id="water-goal" type="number" min="250" value="${goal}">
        </label>
        <button class="secondary-button" id="save-water-goal">Save goal</button>
      </div>`;
    }

    if (page === "habits") {
      extra = `<div class="module-card">
        <p>Check a habit when you've completed it today.</p>
      </div>`;
    }

    const formFields = config.fields.map(moduleField).join("");

    root.innerHTML = `
      <div class="module-header">
        <div>
          <h2>${escapeHTML(config.title)}</h2>
          <p>${escapeHTML(config.description)}</p>
        </div>
      </div>
      ${extra}
      <form class="module-form" id="module-form">
        ${formFields}
        <button class="primary-button" type="submit">Save record</button>
      </form>
      <div class="module-list">
        <h3>Recent records</h3>
        ${records.slice().reverse().slice(0, 30).map(record =>
          `<article class="module-row">
            <div>
              <strong>${escapeHTML(
                record.title ||
                record.name ||
                record.activity ||
                record.subject ||
                record.description ||
                record.category ||
                record.amount + " ml" ||
                "Record"
              )}</strong>
              <p>${escapeHTML(record.date || "")}</p>
            </div>
            <button class="task-action-button"
              data-delete-record="${escapeHTML(record.id)}">Delete</button>
          </article>`
        ).join("") || "<p>No records yet.</p>"}
      </div>`;

    $("#module-form")?.addEventListener("submit", async event => {
      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.currentTarget).entries()
      );

      if (page === "money" || page === "fitness" || page === "study") {
        ["amount", "duration", "distance"].forEach(key => {
          if (data[key] !== undefined) data[key] = Number(data[key]);
        });
      }

      if (page === "hydration") {
        data.date = today();
      }

      if (page === "habits") {
        data.name = data.name.trim();
      }

      await save(config.store, {
        id: makeId(),
        ...data,
        date: data.date || today(),
        createdAt: new Date().toISOString()
      });

      toast("Saved successfully");
      await renderModule(page);
    });

    $$("[data-delete-record]", root).forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Delete this record?")) return;
        await remove(config.store, button.dataset.deleteRecord);
        await renderModule(page);
      });
    });

    $$("[data-water]", root).forEach(button => {
      button.addEventListener("click", async () => {
        await save("water", {
          id: makeId(),
          amount: Number(button.dataset.water),
          date: today()
        });
        await renderModule(page);
      });
    });

    $("#save-water-goal")?.addEventListener("click", () => {
      const goal = Number($("#water-goal").value);

      if (goal < 250) {
        toast("Choose a goal of at least 250 ml");
        return;
      }

      setPreference("water-goal", goal);
      renderModule(page);
      toast("Water goal updated");
    });
  }

  function navigate(page) {
    state.page = page;

    const modulePage = MODULES[page] ? "module" : page;

    $$("[data-page-content]").forEach(element => {
      element.classList.toggle(
        "active",
        element.dataset.pageContent === modulePage
      );
    });

    $$("[data-page]").forEach(link => {
      link.classList.toggle(
        "active",
        link.dataset.page === page
      );
    });

    setText(
      "#breadcrumb-current",
      MODULES[page]?.title ||
      page.charAt(0).toUpperCase() + page.slice(1)
    );

    if (MODULES[page]) {
      renderModule(page);
    } else if (page === "tasks") {
      renderTasks();
    } else if (page === "overview") {
      renderDashboard();
    }

    $("#sidebar")?.classList.remove("open");
    $("#sidebar-overlay")?.classList.remove("visible");
  }

  async function refresh() {
    await renderDashboard();
    await renderTasks();

    if (MODULES[state.page]) {
      await renderModule(state.page);
    }
  }

  async function exportBackup() {
    const backup = {
      app: "DAYFLOW",
      version: 1,
      exportedAt: new Date().toISOString(),
      preferences: {
        theme: getPreference("theme", "light"),
        profileName: getPreference("profile-name", ""),
        waterGoal: getPreference("water-goal", "2000")
      },
      data: {}
    };

    for (const store of STORES) {
      backup.data[store] = await getAll(store);
    }

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `dayflow-backup-${today()}.json`;
    anchor.click();

    URL.revokeObjectURL(url);
    toast("Backup exported");
  }

  async function importBackup(file) {
    try {
      const backup = JSON.parse(await file.text());

      if (
        backup.app !== "DAYFLOW" ||
        !backup.data ||
        typeof backup.data !== "object"
      ) {
        throw new Error("Invalid DAYFLOW backup");
      }

      for (const store of STORES) {
        if (!Array.isArray(backup.data[store])) {
          backup.data[store] = [];
        }

        if (backup.data[store].some(item =>
          !item || typeof item.id !== "string"
        )) {
          throw new Error("Backup contains invalid records");
        }
      }

      const replace = confirm(
        "OK = Replace all existing data\nCancel = Merge backup data"
      );

      if (replace) {
        for (const store of STORES) {
          await requestStore(store, "readwrite", objectStore =>
            objectStore.clear()
          );
        }
      }

      for (const store of STORES) {
        const existing = await getAll(store);
        const ids = new Set(existing.map(item => item.id));

        for (const item of backup.data[store]) {
          if (!ids.has(item.id)) {
            await save(store, item);
          }
        }
      }

      if (backup.preferences) {
        for (const [key, value] of Object.entries(backup.preferences)) {
          if (["theme", "profileName", "waterGoal"].includes(key)) {
            setPreference(
              key === "profileName" ? "profile-name" :
              key === "waterGoal" ? "water-goal" : key,
              String(value)
            );
          }
        }
      }

      setTheme(getPreference("theme", "light"));
      await refresh();
      toast("Backup imported successfully");
    } catch (error) {
      console.error(error);
      toast("Import failed: " + error.message);
    }
  }

  function setupEvents() {
    $$("[data-page]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        navigate(link.dataset.page);
      });
    });

    $("#task-form")?.addEventListener("submit", handleTaskSubmit);

    $("#dashboard-add-task")?.addEventListener("click", () =>
      openTaskModal()
    );

    $("#add-task-button")?.addEventListener("click", () =>
      openTaskModal()
    );

    $("#close-task-modal")?.addEventListener("click", closeTaskModal);
    $("#cancel-task-button")?.addEventListener("click", closeTaskModal);

    $$("[data-filter]").forEach(button => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;

        $$("[data-filter]").forEach(item =>
          item.classList.toggle("active", item === button)
        );

        renderTasks();
      });
    });

    $("#task-search")?.addEventListener("input", event => {
      state.search = event.target.value.toLowerCase().trim();
      renderTasks();
    });

    $("#theme-toggle")?.addEventListener("click", () => {
      setTheme(
        document.body.classList.contains("dark") ? "light" : "dark"
      );
    });

    $("#settings-theme-toggle")?.addEventListener("click", () => {
      setTheme(
        document.body.classList.contains("dark") ? "light" : "dark"
      );
    });

    $("#mobile-menu-button")?.addEventListener("click", () => {
      $("#sidebar")?.classList.toggle("open");
      $("#sidebar-overlay")?.classList.toggle("visible");
    });

    $("#sidebar-overlay")?.addEventListener("click", () => {
      $("#sidebar")?.classList.remove("open");
      $("#sidebar-overlay")?.classList.remove("visible");
    });

    $("#export-data-button")?.addEventListener("click", exportBackup);

    $("#import-data-button")?.addEventListener("click", () =>
      $("#import-file-input")?.click()
    );

    $("#import-file-input")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (file) importBackup(file);
      event.target.value = "";
    });

    $("#save-profile-button")?.addEventListener("click", () => {
      const name = $("#profile-name")?.value.trim() || "";
      setPreference("profile-name", name);
      setText("#sidebar-profile-name", name);
      toast("Profile saved");
    });
  }

  async function initialize() {
    try {
      state.db = await openDatabase();

      setTheme(getPreference("theme", "light"));

      const name = getPreference("profile-name", "");
      if ($("#profile-name")) $("#profile-name").value = name;

      setText("#sidebar-profile-name", name);

      const date = $("#current-date");
      if (date) {
        date.textContent = new Date().toLocaleDateString(
          undefined,
          { weekday: "long", day: "numeric", month: "long" }
        );
      }

      setupEvents();
      await refresh();

      console.log("DAYFLOW initialized successfully");
    } catch (error) {
      console.error("DAYFLOW initialization failed:", error);
      toast("Could not start DAYFLOW. Check the browser console.");
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
