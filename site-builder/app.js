(() => {
  // ---------------------------------------------------------------------------
  // Elements and state
  // ---------------------------------------------------------------------------
  const views = {
    home: document.querySelector("#home-view"),
    projects: document.querySelector("#projects-view"),
    settings: document.querySelector("#settings-view"),
    advanced: document.querySelector("#advanced-view"),
    publish: document.querySelector("#publish-view"),
    text: document.querySelector("#text-view"),
    health: document.querySelector("#health-view"),
  };
  const homeView = views.home;
  const settingsForm = document.querySelector("#settings-form");
  const advancedForm = document.querySelector("#advanced-form");
  const appMain = document.querySelector("main");
  const clientsContent = document.querySelector("#clients-content");
  const projectList = document.querySelector("#project-list");
  const projectEditor = document.querySelector("#project-editor");
  const imageInspector = document.querySelector("#image-inspector");
  const saveBar = document.querySelector("#save-bar");
  const saveBarSummary = document.querySelector("#save-bar-summary");
  const saveButton = document.querySelector("#save-changes");
  const discardButton = document.querySelector("#discard-changes");
  const previewButton = document.querySelector("#preview-site");
  const toasts = document.querySelector("#toasts");
  const newProjectDialog = document.querySelector("#new-project-dialog");
  const newProjectForm = document.querySelector("#new-project-form");
  const confirmDialog = document.querySelector("#confirm-dialog");
  const homeGalleryBoard = document.querySelector("#home-gallery-board");
  const homeGalleryViewport = document.querySelector("#home-gallery-viewport");
  const homeGalleryCanvas = document.querySelector("#home-gallery-canvas");
  let homeGalleryGuides = document.querySelector("#home-gallery-guides");
  const homeGalleryControls = document.querySelector("#home-gallery-controls");
  const homeGalleryZoomLevel = document.querySelector("#home-gallery-zoom-level");
  const HOME_GALLERY_SWAP_HOVER_MS = 250;
  const HOME_GALLERY_HISTORY_LIMIT = 50;
  const ACCEPTED_IMAGES = ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif";

  let saved = null; // last state confirmed by the server
  let work = null; // what the user is editing
  let currentView = "home";
  let selectedSlug = "";
  let selectedImageIndex = -1;
  let saving = false;
  let homeGalleryCovers = [];
  let selectedHomeCover = "";
  let homeGallerySnapEnabled = false;
  let homeGalleryMagnetEnabled = true;
  let homeGalleryUndoStack = [];
  let homeGalleryRedoStack = [];
  let homeGalleryNeedsFit = true;
  let imageDrag = null;
  let adoptRefreshTimer = 0;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function toast(message, isError = false) {
    const item = document.createElement("div");
    item.className = `toast${isError ? " is-error" : ""}`;
    item.textContent = message;
    toasts.append(item);
    window.setTimeout(() => item.remove(), isError ? 8000 : 3500);
  }

  function plural(count, one, few, many) {
    const form = new Intl.PluralRules("ru").select(count);
    return `${count} ${form === "one" ? one : form === "few" ? few : many}`;
  }

  const TRANSLIT = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    і: "i", ў: "u",
  };

  function slugify(text) {
    return [...String(text).toLowerCase()]
      .map(character => TRANSLIT[character] ?? character)
      .join("")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");
  }

  /** Upload target, or with a width a cached preview (160, 480 or 1200 px) that the browser may keep. */
  function imageUrl(slug, file, width) {
    const base = `/api/projects/${encodeURIComponent(slug)}/images/${encodeURIComponent(file)}`;
    if (!width) return base;
    const version = work?.projects.find(project => project.slug === slug)?.versions?.[file] ?? Date.now();
    return `${base}?w=${width}&v=${version}`;
  }

  function siteImageUrl(path) {
    return `/api/site-image?path=${encodeURIComponent(path ?? "")}`;
  }

  function getPath(object, path) {
    return path.reduce((current, key) => current?.[key], object);
  }

  function setPath(object, path, value) {
    let current = object;
    path.slice(0, -1).forEach(key => {
      if (current[key] === undefined || current[key] === null) current[key] = {};
      current = current[key];
    });
    current[path.at(-1)] = value;
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error(`Конструктор не отвечает. Откройте его снова иконкой «Сайт» — правки на этой странице не пропадут. (${error.message})`);
    }
    const responseType = response.headers.get("content-type") ?? "";
    const result = responseType.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(result?.error ?? `Ошибка запроса (${response.status}).`);
    return result;
  }

  function postJson(url, body) {
    return request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function confirmAction({ title, message, accept, danger = false }) {
    confirmDialog.querySelector("#confirm-title").textContent = title;
    confirmDialog.querySelector("#confirm-message").textContent = message;
    const acceptButton = confirmDialog.querySelector("#confirm-accept");
    acceptButton.textContent = accept;
    acceptButton.className = `button ${danger ? "button-danger" : "button-primary"}`;
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
    return new Promise(resolve => {
      confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "ok"), { once: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Working copy, dirty tracking, saving
  // ---------------------------------------------------------------------------
  function projectBySlug(slug = selectedSlug) {
    return work?.projects.find(project => project.slug === slug);
  }

  function savedProject(slug) {
    return saved?.projects.find(project => project.slug === slug);
  }

  function syncCoversIntoWork() {
    work.config.home_gallery.covers = homeGalleryCovers;
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function projectIsDirty(project) {
    const original = savedProject(project.slug);
    return !original
      || stableJson(original.metadata) !== stableJson(project.metadata)
      || original.content !== project.content;
  }

  function changes() {
    if (!work) return { config: false, home: false, projects: [] };
    syncCoversIntoWork();
    const { home_gallery: workHome, ...workRest } = work.config;
    const { home_gallery: savedHome, ...savedRest } = saved.config;
    const differs = key => stableJson(work.config[key]) !== stableJson(saved.config[key]);
    const artistDiffers = key => (work.config.artist?.[key] ?? "") !== (saved.config.artist?.[key] ?? "");
    const appearance = differs("colors") || differs("text_styles")
      || artistDiffers("wordmark_image") || artistDiffers("portrait") || artistDiffers("portrait_alt");
    return {
      config: stableJson(workRest) !== stableJson(savedRest),
      home: stableJson(workHome) !== stableJson(savedHome),
      projects: work.projects.filter(projectIsDirty),
      // Which builder tabs the settings changes belong to, for the save bar.
      clients: differs("clients") || differs("clients_tab"),
      appearance,
    };
  }

  function isDirty() {
    const pending = changes();
    return pending.config || pending.home || pending.projects.length > 0;
  }

  function refreshDirty() {
    const pending = changes();
    const parts = [];
    if (pending.home) parts.push("главная");
    if (pending.projects.length === 1) parts.push(`проект «${pending.projects[0].metadata.title}»`);
    if (pending.projects.length > 1) parts.push(plural(pending.projects.length, "проект", "проекта", "проектов"));
    if (pending.clients) parts.push("клиенты");
    if (pending.appearance) parts.push("оформление");
    if (pending.config && settingsTabChanged("settings")) parts.push("об авторе");
    if (pending.config && settingsTabChanged("advanced")) parts.push("поиск и статистика");
    saveBar.hidden = parts.length === 0;
    saveBarSummary.textContent = parts.length ? `Не сохранено: ${parts.join(", ")}` : "";
    projectList.querySelectorAll("[data-project-slug]").forEach(item => {
      const project = projectBySlug(item.dataset.projectSlug);
      item.querySelector(".unsaved-dot").hidden = !project || !projectIsDirty(project);
    });
  }

  function adoptState(state) {
    saved = structuredClone(state);
    work = structuredClone(state);
    homeGalleryCovers = work.config.home_gallery.covers;
    if (selectedSlug && !projectBySlug()) selectedSlug = "";
    homeSelection = new Set([...homeSelection].filter(id => coverById(id)));
    if (!coverById(selectedHomeCover)) selectedHomeCover = "";
    // Files on disk changed: the list of unpublished changes did too.
    window.clearTimeout(adoptRefreshTimer);
    adoptRefreshTimer = window.setTimeout(() => refreshPublishStatus(), 600);
  }

  function validateBeforeSave() {
    syncCoversIntoWork();
    homeGalleryCovers = homeGalleryCovers.map(cover => (cover.parked ? cover : roundLayout(cover)));
    const issue = layoutIssue(homeGalleryCovers);
    if (issue) {
      homeSelection = new Set(issue.ids);
      navigate("home");
      throw new Error(`На главной: ${issue.message} Раздвиньте выделенные обложки.`);
    }
    if (!advancedForm.checkValidity()) {
      navigate("advanced");
      advancedForm.reportValidity();
      throw new Error("Проверьте выделенные поля во вкладке «Поиск и статистика».");
    }
    if (!settingsForm.checkValidity()) {
      navigate("settings");
      settingsForm.reportValidity();
      throw new Error("Проверьте выделенные поля в настройках.");
    }
    for (const project of changes().projects) {
      const missing = (project.metadata.images ?? []).findIndex(image => !String(image.alt ?? "").trim());
      if (missing >= 0) {
        navigate("projects", project.slug, missing);
        throw new Error(`В проекте «${project.metadata.title}» у изображения нет alt-текста.`);
      }
      if (!String(project.metadata.title ?? "").trim()) {
        navigate("projects", project.slug);
        throw new Error("У проекта должно быть название.");
      }
    }
  }

  async function saveAll() {
    if (saving || !isDirty()) return true;
    try {
      validateBeforeSave();
    } catch (error) {
      toast(error.message, true);
      return false;
    }
    saving = true;
    saveButton.disabled = true;
    try {
      const pending = changes();
      const state = await postJson("/api/save", {
        config: work.config,
        projects: pending.projects.map(({ slug, metadata, content }) => ({ slug, metadata, content })),
      });
      adoptState(state);
      renderAll();
      toast("Изменения сохранены.");
      return true;
    } catch (error) {
      toast(`Не удалось сохранить: ${error.message}`, true);
      return false;
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }

  async function discardAll() {
    const accepted = await confirmAction({
      title: "Отменить изменения?",
      message: "Все несохранённые правки на главной, в проектах и настройках будут потеряны.",
      accept: "Отменить правки",
      danger: true,
    });
    if (!accepted) return;
    adoptState(saved);
    homeGalleryUndoStack = [];
    homeGalleryRedoStack = [];
    renderAll();
    toast("Несохранённые изменения отменены.");
  }

  async function previewSite() {
    if (isDirty()) {
      const accepted = await confirmAction({
        title: "Сохранить перед предпросмотром?",
        message: "Предпросмотр собирается из сохранённых файлов.",
        accept: "Сохранить и собрать",
      });
      if (!accepted || !(await saveAll())) return;
    }
    const previewWindow = window.open("", "_blank");
    previewWindow?.document.write("<p style=\"font:16px system-ui;padding:24px\">Собираю предпросмотр…</p>");
    const label = previewButton.querySelector("[data-label]");
    previewButton.disabled = true;
    label.textContent = "Собираю…";
    try {
      const result = await postJson("/api/build", {});
      const target = selectedSlug && currentView === "projects"
        ? new URL(projectBySlug()?.metadata.permalink ?? "/", result.preview_url).href
        : result.preview_url;
      if (previewWindow) previewWindow.location.href = target;
      else window.open(target, "_blank", "noopener");
    } catch (error) {
      previewWindow?.close();
      toast(`Сборка не удалась: ${error.message}`, true);
    } finally {
      previewButton.disabled = false;
      label.textContent = "Предпросмотр сайта";
    }
  }

  let staleWarningShown = false;
  async function checkServerFreshness() {
    try {
      const status = await request("/api/status");
      if (!status.outdated) return;
      // The builder's own code changed: restart it as soon as nothing unsaved would be lost.
      if (!isDirty() && !saving && !publishing) {
        await restartBuilder();
      } else if (!staleWarningShown) {
        staleWarningShown = true;
        toast("Конструктор обновился. Сохраните правки — он перезапустится сам.");
      }
    } catch {
      // A stopped builder is reported when the user next saves.
    }
  }

  async function restartBuilder() {
    try {
      await postJson("/api/restart", {});
    } catch {
      return;
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => { window.setTimeout(resolve, 500); });
      try {
        const status = await request("/api/status");
        if (!status.outdated) {
          location.reload();
          return;
        }
      } catch {
        // Still restarting.
      }
    }
    toast("Конструктор не перезапустился. Закройте вкладку и откройте его снова иконкой «Сайт».", true);
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  function navigate(view, slug = "", imageIndex = -1) {
    const hash = view === "projects" && slug ? `#projects/${slug}` : `#${view}`;
    if (location.hash !== hash) history.pushState(null, "", hash);
    showView(view, slug, imageIndex);
  }

  function showView(view, slug = "", imageIndex = -1) {
    // Clients used to be its own tab; old #clients links land on «Об авторе».
    if (view === "clients") view = "settings";
    currentView = views[view] ? view : "home";
    Object.entries(views).forEach(([name, element]) => { element.hidden = name !== currentView; });
    document.querySelectorAll(".tab").forEach(tab => {
      if (tab.dataset.view === currentView) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    updateTabMenu();
    if (currentView === "projects") {
      if (slug !== selectedSlug) selectedImageIndex = -1;
      selectedSlug = slug && projectBySlug(slug) ? slug : (selectedSlug || work?.projects[0]?.slug || "");
      if (imageIndex >= 0) selectedImageIndex = imageIndex;
      renderProjects();
    }
    if (currentView === "publish") renderPublishView();
    if (currentView === "text") renderTextView();
    if (currentView === "health") {
      renderHealthView();
      loadHealth();
    }
    if (currentView === "settings") renderClientsView();
    if (currentView === "home") {
      renderHomeGalleryEditor();
      if (homeGalleryNeedsFit && homeGalleryViewport.clientWidth) {
        homeGalleryNeedsFit = false;
        requestAnimationFrame(fitHome);
      }
    }
  }

  function routeFromHash() {
    const [view, slug] = location.hash.replace(/^#/, "").split("/");
    showView(view || "home", slug ? decodeURIComponent(slug) : "");
  }

  function renderAll() {
    renderSettings();
    showView(currentView, selectedSlug);
    refreshDirty();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const SETTINGS_SECTIONS = [
    {
      title: "Об авторе",
      tab: "settings",
      fields: [
        { path: ["artist", "name"], label: "Имя на сайте", help: "Крупная надпись в шапке.", required: true },
        { path: ["artist", "full_name"], label: "Полное имя", half: true },
        { path: ["artist", "description"], label: "Профессия", half: true },
        { path: ["artist", "bio"], label: "Биография", type: "textarea", tall: true, help: "Открывается во вкладке «About» в шапке сайта." },
      ],
    },
    {
      title: "Контакты",
      tab: "settings",
      fields: [
        { path: ["artist", "email"], label: "Email", type: "email", required: true },
        { path: ["artist", "instagram_url"], label: "Instagram", type: "url", half: true, placeholder: "https://www.instagram.com/…" },
        { path: ["artist", "linkedin_url"], label: "LinkedIn", type: "url", half: true, placeholder: "https://www.linkedin.com/in/…" },
      ],
    },
    {
      title: "Сайт",
      tab: "advanced",
      fields: [
        { path: ["title"], label: "Название во вкладке браузера", required: true },
        { path: ["description"], label: "Описание для поисковиков и превью ссылок", type: "textarea" },
      ],
    },
    {
      title: "Google: аналитика и поиск",
      tab: "advanced",
      // Trusted, fixed HTML: the only place settings help carries links.
      intro: `
        <p><strong>Google Analytics</strong> считает посетителей: сколько их, откуда они пришли, какие проекты смотрят. На сайте включается только после согласия посетителя в баннере внизу. ID — в <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer">Google Analytics</a> → Администратор → Потоки данных.</p>
        <p><strong>Google Search Console</strong> показывает, как сайт виден в поиске Google: по каким запросам его находят, какие страницы попали в поиск и есть ли ошибки. Код подтверждения доказывает Google, что сайт ваш. Где взять: <a href="https://search.google.com/search-console/welcome" target="_blank" rel="noopener noreferrer">Search Console</a> → «Префикс URL» → <code>https://katzaryna.github.io/</code> → «HTML-тег». После публикации нажмите там «Подтвердить», а в разделе «Файлы Sitemap» отправьте <code>sitemap.xml</code>.</p>`,
      fields: [
        {
          path: ["analytics", "measurement_id"],
          label: "Google Analytics ID",
          placeholder: "G-XXXXXXXXXX",
          pattern: "G-[A-Z0-9]+",
          help: "Оставьте пустым, чтобы отключить аналитику и баннер согласия.",
        },
        {
          path: ["search_console", "verification"],
          label: "Код подтверждения Google Search Console",
          placeholder: "<meta name=\"google-site-verification\" content=\"…\"> или только код",
          help: "Можно вставить весь тег — сохранится только код. Посетителям не виден.",
        },
      ],
    },
  ];

  function renderField(field, source) {
    const id = `field-${field.path.join("-")}`;
    const value = getPath(source, field.path) ?? "";
    const attributes = [
      `id="${id}"`,
      `data-config-path='${escapeHtml(JSON.stringify(field.path))}'`,
      field.required ? "required" : "",
      field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
      field.pattern ? `pattern="${escapeHtml(field.pattern)}"` : "",
      field.min !== undefined ? `min="${field.min}"` : "",
      field.max !== undefined ? `max="${field.max}"` : "",
    ].join(" ");
    const control = field.type === "textarea"
      ? `<textarea ${attributes}${field.tall ? ' class="is-tall"' : ""}>${escapeHtml(value)}</textarea>`
      : `<input ${attributes} type="${field.type ?? "text"}" value="${escapeHtml(value)}">`;
    return `<label class="field" for="${id}"><span>${escapeHtml(field.label)}</span>${control}${field.help ? `<small class="field-help">${escapeHtml(field.help)}</small>` : ""}</label>`;
  }

  function renderFieldGroup(fields, source) {
    const html = [];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (field.half && fields[index + 1]?.half) {
        html.push(`<div class="field-row">${renderField(field, source)}${renderField(fields[index + 1], source)}</div>`);
        index += 1;
      } else {
        html.push(renderField(field, source));
      }
    }
    return html.join("");
  }

  function renderSettings() {
    if (!work) return;
    const render = tab => SETTINGS_SECTIONS.filter(section => section.tab === tab).map(section => `
      <section class="card">
        <div class="card-heading"><h2>${escapeHtml(section.title)}</h2></div>
        ${section.intro ? `<div class="settings-intro">${section.intro}</div>` : ""}
        ${renderFieldGroup(section.fields, work.config)}
      </section>`).join("");
    settingsForm.innerHTML = render("settings");
    advancedForm.innerHTML = render("advanced");
  }

  /** Whether a settings tab ("settings" or "advanced") has unsaved edits. */
  function settingsTabChanged(tab) {
    return SETTINGS_SECTIONS.filter(section => section.tab === tab).some(section => section.fields.some(field => (
      stableJson(getPath(work.config, field.path) ?? "") !== stableJson(getPath(saved.config, field.path) ?? "")
    )));
  }

  function renderClientsView() {
    if (!work) return;
    clientsContent.innerHTML = renderClientsCard();
  }

  function renderHeaderCard() {
    const wordmark = work.config.artist?.wordmark_image;
    const preview = wordmark
      ? `<img src="${siteImageUrl(wordmark)}" alt="">`
      : `<span class="wordmark-text">${escapeHtml(work.config.artist?.name ?? "")}</span>`;
    return `
      <section class="card">
        <div class="card-heading"><div><h2>Шапка: надпись и портрет</h2><p>Надпись стоит слева от портрета. Лучше всего PNG с прозрачным фоном; без картинки показывается имя текстом.</p></div></div>
        <div class="portrait-field">
          <img src="${siteImageUrl(work.config.artist?.portrait)}" alt="">
          <div class="field">
            <span>Портрет</span>
            <div><button class="button button-secondary button-small" type="button" data-action="replace-portrait">Заменить…</button></div>
            <input type="file" accept="${ACCEPTED_IMAGES}" data-portrait-input hidden>
            <small class="field-help">Также значок вкладки браузера и превью ссылок.</small>
          </div>
        </div>
        ${renderField({ path: ["artist", "portrait_alt"], label: "Описание портрета (alt)", help: "Для незрячих посетителей и поисковиков." }, work.config)}
        <div class="field"><span>Надпись</span></div>
        <div class="wordmark-field">
          <div class="wordmark-preview">${preview}</div>
          <div class="field-actions">
            <button class="button button-secondary button-small" type="button" data-action="upload-wordmark">${wordmark ? "Заменить картинку…" : "Загрузить картинку…"}</button>
            ${wordmark ? '<button class="button button-ghost button-small" type="button" data-action="remove-wordmark">Убрать и показывать текстом</button>' : ""}
          </div>
          <input type="file" accept="${ACCEPTED_IMAGES}" data-upload-input="wordmark" hidden>
        </div>
      </section>`;
  }

  function renderClientsCard() {
    const clients = work.config.clients ?? [];
    const rows = clients.map((client, index) => `
      <li class="client-row">
        <img class="client-row-logo" src="${siteImageUrl(client.logo)}" alt="">
        <label class="field">
          <span>Подпись <small class="field-help">— необязательно</small></span>
          <input value="${escapeHtml(client.name ?? "")}" data-client-name="${index}" maxlength="80" autocomplete="off" placeholder="Например, Kneipp">
        </label>
        <div class="client-row-actions">
          <button class="icon-button" type="button" data-client-move="${index}:-1" ${index === 0 ? "disabled" : ""} aria-label="Выше" title="Выше">↑</button>
          <button class="icon-button" type="button" data-client-move="${index}:1" ${index === clients.length - 1 ? "disabled" : ""} aria-label="Ниже" title="Ниже">↓</button>
          <button class="text-button" type="button" data-client-replace="${index}" title="Загрузить другой логотип">Заменить</button>
          <button class="text-button is-danger" type="button" data-client-remove="${index}">Удалить</button>
        </div>
      </li>`).join("");
    const tabShown = work.config.clients_tab !== false;
    return `
      <section class="card">
        <div class="card-heading"><div><h2>Клиенты</h2><p>Логотипы для вкладки Clients в шапке сайта, в этом порядке. Подпись под логотипом необязательна.</p></div></div>
        <label class="switch clients-switch"><input type="checkbox" data-clients-tab ${tabShown ? "checked" : ""}><span><strong>Вкладка Clients на сайте</strong><small>${tabShown ? "Показывается в шапке, если есть хотя бы один логотип." : "Скрыта. Логотипы сохраняются — включите, чтобы показать снова."}</small></span></label>
        ${clients.length ? `<ol class="client-rows">${rows}</ol>` : ""}
        <button class="button button-secondary" type="button" data-action="add-clients">+ Добавить логотипы…</button>
        <input type="file" accept="${ACCEPTED_IMAGES}" multiple data-upload-input="clients" hidden>
        <input type="file" accept="${ACCEPTED_IMAGES}" data-upload-input="client-replace" hidden>
      </section>`;
  }

  let replacingClient = -1;

  async function uploadSiteImage(kind, file) {
    const result = await request(`/api/site-images/${kind}/${encodeURIComponent(file.name)}`, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    return result.path;
  }

  function changeClients(update) {
    const clients = structuredClone(work.config.clients ?? []);
    update(clients);
    if (clients.length) work.config.clients = clients;
    else delete work.config.clients;
    renderAll();
    refreshDirty();
  }

  appMain.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target || target.closest(".settings-form")) return;
    if (target.dataset.action === "upload-wordmark") appMain.querySelector('[data-upload-input="wordmark"]').click();
    if (target.dataset.action === "remove-wordmark") {
      delete work.config.artist.wordmark_image;
      renderAll();
      refreshDirty();
    }
    if (target.dataset.action === "add-clients") appMain.querySelector('[data-upload-input="clients"]').click();
    if (target.dataset.clientReplace !== undefined) {
      replacingClient = Number(target.dataset.clientReplace);
      appMain.querySelector('[data-upload-input="client-replace"]').click();
    }
    if (target.dataset.clientRemove !== undefined) {
      changeClients(clients => clients.splice(Number(target.dataset.clientRemove), 1));
    }
    if (target.dataset.clientMove) {
      const [index, step] = target.dataset.clientMove.split(":").map(Number);
      changeClients(clients => {
        const [moved] = clients.splice(index, 1);
        clients.splice(index + step, 0, moved);
      });
    }
  });

  appMain.addEventListener("input", event => {
    const input = event.target.closest("[data-client-name]");
    if (!input) return;
    const client = work.config.clients?.[Number(input.dataset.clientName)];
    if (!client) return;
    if (input.value.trim()) client.name = input.value;
    else delete client.name;
    refreshDirty();
  });

  appMain.addEventListener("change", async event => {
    if (event.target.matches("[data-clients-tab]")) {
      // Only switching the tab off is stored; on is the default.
      if (event.target.checked) delete work.config.clients_tab;
      else work.config.clients_tab = false;
      renderClientsView();
      refreshDirty();
      return;
    }
    const input = event.target.closest("[data-upload-input]");
    if (!input?.files?.length) return;
    const files = [...input.files];
    const purpose = input.dataset.uploadInput;
    input.value = "";
    try {
      if (purpose === "wordmark") {
        setPath(work.config, ["artist", "wordmark_image"], await uploadSiteImage("wordmark", files[0]));
        toast("Надпись загружена. Сохраните изменения, чтобы она появилась на сайте.");
      } else if (purpose === "client-replace" && replacingClient >= 0) {
        const logo = await uploadSiteImage("client", files[0]);
        const index = replacingClient;
        changeClients(clients => { if (clients[index]) clients[index].logo = logo; });
      } else if (purpose === "clients") {
        const logos = [];
        for (const file of files) logos.push(await uploadSiteImage("client", file));
        changeClients(clients => clients.push(...logos.map(logo => ({ logo }))));
        toast(`${plural(logos.length, "логотип добавлен", "логотипа добавлено", "логотипов добавлено")}. Подписи можно добавить рядом с каждым.`);
      }
      renderAll();
      refreshDirty();
    } catch (error) {
      toast(`Не удалось загрузить картинку: ${error.message}`, true);
    }
  });

  appMain.addEventListener("input", event => {
    const input = event.target.closest("[data-config-path]");
    if (!input) return;
    const path = JSON.parse(input.dataset.configPath);
    let value = input.value;
    if (input.type === "number") value = input.value === "" ? "" : Number(input.value);
    setPath(work.config, path, value);
    refreshDirty();
  });

  appMain.addEventListener("click", event => {
    if (event.target.closest('[data-action="replace-portrait"]')) {
      appMain.querySelector("[data-portrait-input]").click();
    }
  });

  appMain.addEventListener("change", async event => {
    const input = event.target.closest("[data-portrait-input]");
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const result = await request(`/api/portrait/${encodeURIComponent(file.name)}`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      setPath(work.config, ["artist", "portrait"], result.portrait);
      renderAll();
      refreshDirty();
      toast("Новый портрет загружен. Сохраните изменения, чтобы он появился на сайте.");
    } catch (error) {
      toast(`Не удалось загрузить портрет: ${error.message}`, true);
    }
  });

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  function isOnHome(project) {
    return (project.metadata.images ?? []).some(image => image.cover === true);
  }

  function projectThumb(project) {
    const images = project.metadata.images ?? [];
    const image = images.find(item => item.cover === true) ?? images[0];
    return image
      ? `<img class="project-thumb" src="${imageUrl(project.slug, image.file, 160)}" alt="" loading="lazy">`
      : '<span class="project-thumb"></span>';
  }

  function renderProjectList() {
    const projects = [...work.projects].sort((left, right) => (left.metadata.title ?? "").localeCompare(right.metadata.title ?? ""));
    projectList.innerHTML = projects.map(project => {
      const count = (project.metadata.images ?? []).length;
      const current = project.slug === selectedSlug ? ' aria-current="page"' : "";
      return `<a class="project-item" role="listitem" href="#projects/${encodeURIComponent(project.slug)}" data-project-slug="${escapeHtml(project.slug)}"${current}>
        ${projectThumb(project)}
        <span><strong>${escapeHtml(project.metadata.title || project.slug)}</strong>
        <small>${plural(count, "изображение", "изображения", "изображений")}</small></span>
        <span>${isOnHome(project) ? '<span class="badge is-home" title="Есть обложка на главной">★</span>' : '<span class="badge" title="Доступен только по прямой ссылке">ссылка</span>'}
        <span class="unsaved-dot" title="Есть несохранённые изменения" hidden></span></span>
      </a>`;
    }).join("") || '<p class="field-help" style="padding:8px">Проектов пока нет.</p>';
    refreshDirty();
  }

  function galleryColumns(project) {
    return Number(project.metadata.gallery_columns) || 0;
  }

  function renderImageTile(project, image, index) {
    const selected = index === selectedImageIndex ? " is-selected" : "";
    const span = galleryColumns(project) && Number(image.span_columns) > 1 ? `<span class="tile-span">×${Number(image.span_columns)}</span>` : "";
    const missingAlt = !String(image.alt ?? "").trim() ? '<span class="tile-warning" title="Нет alt-текста">alt</span>' : "";
    return `<div class="image-tile${selected}" role="listitem" draggable="true" data-image-index="${index}" tabindex="0" aria-label="${escapeHtml(image.file)}">
      ${project.files.includes(image.file) ? `<img src="${imageUrl(project.slug, image.file, 480)}" alt="" loading="lazy">` : '<span class="field-help" style="display:grid;place-items:center">Файл не найден</span>'}
      <span class="image-tile-name">${escapeHtml(image.file)}</span>
      <button class="tile-star" type="button" data-action="toggle-cover" aria-pressed="${image.cover === true}" title="${image.cover === true ? "Убрать с главной" : "Показать на главной"}">★</button>
      ${missingAlt}${span}
    </div>`;
  }

  function renderProjectEditor() {
    const project = projectBySlug();
    if (!project) {
      projectEditor.innerHTML = `<div class="empty-state"><h2>Проектов пока нет</h2><p>Создайте первый проект кнопкой «+ Новый».</p></div>`;
      return;
    }
    const images = project.metadata.images ?? [];
    const columns = galleryColumns(project);
    projectEditor.innerHTML = `
      <div class="project-header">
        <div>
          <h2>${escapeHtml(project.metadata.title || "Без названия")}</h2>
          <div class="project-header-meta">
            <code>${escapeHtml(project.metadata.permalink ?? `/projects/${project.slug}/`)}</code>
            ${isOnHome(project) ? '<span class="badge is-home">★ на главной</span>' : '<span class="badge">только по ссылке</span>'}
          </div>
        </div>
        <button class="button button-danger button-small" type="button" data-action="delete-project">Удалить проект</button>
      </div>
      <section class="card">
        <label class="field"><span>Название</span><input data-project-field="title" value="${escapeHtml(project.metadata.title)}" required maxlength="160"></label>
        <label class="field"><span>Короткое описание</span><input data-project-field="description" value="${escapeHtml(project.metadata.description ?? "")}" maxlength="300"><small class="field-help">Для поисковиков и превью ссылки в мессенджерах.</small></label>
        <label class="field"><span>Текст на странице проекта</span><textarea data-project-content placeholder="Необязательно. Поддерживается Markdown.">${escapeHtml(project.content)}</textarea></label>
      </section>
      <section class="card image-card" data-drop-zone>
        <div class="card-heading">
          <div><h2>Изображения <span class="badge">${images.length}</span></h2>
          <p>Перетаскивайте, чтобы поменять порядок. ★ — показать на главной.</p></div>
          <div class="image-toolbar">
            <label class="field"><span>Раскладка</span>
              <select data-project-columns>
                <option value="0" ${columns ? "" : "selected"}>Мозаика</option>
                ${[...new Set([2, 3, 4, 5, 6, 8, 12, columns].filter(Boolean))].sort((a, b) => a - b).map(count => `<option value="${count}" ${columns === count ? "selected" : ""}>Сетка · ${plural(count, "колонка", "колонки", "колонок")}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
        <div class="image-grid" role="list">
          ${images.map((image, index) => renderImageTile(project, image, index)).join("")}
          <button class="drop-tile" type="button" data-action="add-images"><strong>+</strong><span>Добавить изображения</span><small>или перетащите файлы сюда</small></button>
        </div>
        <input type="file" accept="${ACCEPTED_IMAGES}" multiple data-image-input hidden>
        <p class="upload-progress" data-upload-progress hidden></p>
      </section>
      <div data-unlisted-slot>${renderUnlistedFiles(project)}</div>`;
  }

  // Files in the project folder that the project does not list: they are not on the site.
  function unlistedFiles(project) {
    const listed = new Set((project.metadata.images ?? []).map(image => image.file));
    return (project.files ?? []).filter(file => !listed.has(file));
  }

  function renderUnlistedFiles(project) {
    const files = unlistedFiles(project);
    if (!files.length) return "";
    return `
      <section class="card unlisted-card">
        <div class="card-heading"><div>
          <h2>Не на сайте <span class="badge">${files.length}</span></h2>
          <p>Эти файлы лежат в папке проекта, но не добавлены в него, поэтому на сайт не попадают — например, старый файл после «Заменить файл…».</p>
        </div></div>
        <ul class="unlisted-files">
          ${files.map(file => `
            <li class="unlisted-file">
              <img src="${imageUrl(project.slug, file, 160)}" alt="" loading="lazy">
              <span class="unlisted-name" title="${escapeHtml(file)}">${escapeHtml(file)}</span>
              <span class="unlisted-actions">
                <button class="button button-secondary button-small" type="button" data-unlisted-add="${escapeHtml(file)}">Добавить в проект</button>
                <button class="button button-ghost button-small" type="button" data-unlisted-delete="${escapeHtml(file)}">Удалить…</button>
              </span>
            </li>`).join("")}
        </ul>
      </section>`;
  }

  function addUnlistedFile(file) {
    const project = projectBySlug();
    if (!project || !unlistedFiles(project).includes(file)) return;
    project.metadata.images = project.metadata.images ?? [];
    project.metadata.images.push({ file, alt: "" });
    selectedImageIndex = project.metadata.images.length - 1;
    rerenderImages();
    refreshDirty();
    toast("Изображение добавлено в проект. Заполните alt-текст и сохраните.");
  }

  async function deleteUnlistedFile(file) {
    const project = projectBySlug();
    if (!project || !unlistedFiles(project).includes(file)) return;
    const accepted = await confirmAction({
      title: `Удалить ${file}?`,
      message: "Файл уберётся из папки проекта в .builder-trash на этом компьютере — оттуда его можно вернуть вручную. После публикации он исчезнет и из репозитория, но останется в его истории.",
      accept: "Удалить файл",
      danger: true,
    });
    if (!accepted) return;
    try {
      await request(imageUrl(project.slug, file), { method: "DELETE" });
      for (const copy of [project, savedProject(project.slug)]) {
        if (!copy) continue;
        copy.files = (copy.files ?? []).filter(name => name !== file);
        if (copy.versions) delete copy.versions[file];
      }
      rerenderImages();
      toast("Файл удалён из проекта.");
    } catch (error) {
      toast(error.message.includes("still") ? "Файл ещё используется. Сначала сохраните или отмените изменения." : `Не удалось удалить: ${error.message}`, true);
    }
  }

  function renderInspector() {
    const project = projectBySlug();
    const image = project?.metadata.images?.[selectedImageIndex];
    if (!project || !image) {
      imageInspector.innerHTML = '<div class="inspector-empty">Выберите изображение,<br>чтобы изменить alt, подпись<br>и размер в сетке.</div>';
      return;
    }
    const columns = galleryColumns(project);
    const rows = [...new Set((project.metadata.images ?? []).map(item => item.row).filter(Boolean))];
    const count = project.metadata.images.length;
    imageInspector.innerHTML = `
      <h2>Изображение ${selectedImageIndex + 1} из ${count}</h2>
      <div class="inspector-preview"><img src="${imageUrl(project.slug, image.file, 480)}" alt=""></div>
      <div class="inspector-file" title="${escapeHtml(image.file)}">${escapeHtml(image.file)}</div>
      <div class="inspector-replace">
        <button class="button button-secondary button-small" type="button" data-action="replace-image" title="Подписи, обложка и место на главной сохранятся">Заменить файл…</button>
        <input type="file" accept="${ACCEPTED_IMAGES}" data-replace-input hidden>
      </div>
      <label class="field"><span>Alt-текст</span><textarea data-image-field="alt" required placeholder="Что изображено">${escapeHtml(image.alt ?? "")}</textarea><small class="field-help">Обязателен: для незрячих посетителей и поисковиков.</small></label>
      <label class="field"><span>Название иллюстрации</span><input data-image-field="caption" value="${escapeHtml(image.caption ?? "")}" placeholder="Необязательно"><small class="field-help">В просмотре обложки на главной и под картинкой на странице проекта.</small></label>
      <label class="field"><span>Описание иллюстрации</span><textarea data-image-field="description" placeholder="Необязательно">${escapeHtml(image.description ?? "")}</textarea><small class="field-help">В просмотре обложки на главной, справа от картинки.</small></label>
      <label class="switch" style="margin-top:14px"><input type="checkbox" data-image-cover ${image.cover === true ? "checked" : ""}><span><strong>Обложка на главной</strong><small>Положение и размер — во вкладке «Главная».</small></span></label>
      ${columns ? `
        <div class="field-row" style="margin-top:14px">
          <label class="field"><span>Ширина</span>
            <select data-image-span>${Array.from({ length: columns }, (_, index) => index + 1).map(span => `<option value="${span}" ${Number(image.span_columns ?? 1) === span ? "selected" : ""}>${plural(span, "колонка", "колонки", "колонок")}</option>`).join("")}</select>
          </label>
          <label class="field"><span>Ряд</span><input data-image-field="row" value="${escapeHtml(image.row ?? "")}" list="row-names" placeholder="—"></label>
        </div>
        <datalist id="row-names">${rows.map(row => `<option value="${escapeHtml(row)}">`).join("")}</datalist>
        <small class="field-help">Изображения с одинаковым рядом стоят в одну линию.</small>` : ""}
      <div class="inspector-actions">
        <button class="button button-secondary button-small" type="button" data-action="move-image" data-step="-1" ${selectedImageIndex === 0 ? "disabled" : ""}>← Раньше</button>
        <button class="button button-secondary button-small" type="button" data-action="move-image" data-step="1" ${selectedImageIndex === count - 1 ? "disabled" : ""}>Позже →</button>
        <button class="button button-ghost button-small" type="button" data-action="remove-image" title="Файл останется в папке проекта">Убрать из проекта</button>
      </div>`;
  }

  function renderProjects() {
    if (!work) return;
    renderProjectList();
    renderProjectTrash();
    renderProjectEditor();
    renderInspector();
  }

  function rerenderImages() {
    const project = projectBySlug();
    const grid = projectEditor.querySelector(".image-grid");
    if (!project || !grid) return;
    const images = project.metadata.images ?? [];
    grid.querySelectorAll(".image-tile").forEach(tile => tile.remove());
    grid.insertAdjacentHTML("afterbegin", images.map((image, index) => renderImageTile(project, image, index)).join(""));
    const counter = projectEditor.querySelector(".image-card .card-heading .badge");
    if (counter) counter.textContent = String(images.length);
    renderInspector();
    renderProjectList();
    const slot = projectEditor.querySelector("[data-unlisted-slot]");
    if (slot) slot.innerHTML = renderUnlistedFiles(project);
  }

  function syncProjectCovers(slug) {
    const project = projectBySlug(slug);
    const selected = new Set((project?.metadata.images ?? []).filter(image => image.cover === true).map(image => image.file));
    homeGalleryCovers = homeGalleryCovers.filter(cover => cover.project !== slug || selected.has(cover.file));
    for (const file of selected) {
      if (homeGalleryCovers.some(cover => cover.project === slug && cover.file === file)) continue;
      const bottom = Math.max(0, ...homeGalleryCovers.filter(cover => !cover.parked).map(cover => cover.y + cover.height));
      homeGalleryCovers.push({ project: slug, file, x: 0, y: bottom, width: 6, height: 4, crop: false, crop_x: 50, crop_y: 50 });
    }
    homeGalleryNeedsFit = true;
  }

  function toggleCover(index) {
    const project = projectBySlug();
    const image = project?.metadata.images?.[index];
    if (!image) return;
    if (image.cover === true) delete image.cover;
    else image.cover = true;
    syncProjectCovers(project.slug);
    rerenderImages();
    const header = projectEditor.querySelector(".project-header-meta .badge");
    if (header) header.outerHTML = isOnHome(project) ? '<span class="badge is-home">★ на главной</span>' : '<span class="badge">только по ссылке</span>';
    refreshDirty();
  }

  function moveImage(from, to) {
    const project = projectBySlug();
    const images = project?.metadata.images;
    if (!images || from === to || to < 0 || to >= images.length) return;
    const [image] = images.splice(from, 1);
    images.splice(to, 0, image);
    selectedImageIndex = to;
    rerenderImages();
    refreshDirty();
  }

  /** Stores a file in the project folder (as WebP) and returns its new file name. */
  async function uploadProjectFile(project, file) {
    const result = await request(imageUrl(project.slug, file.name), {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    project.files.push(result.file);
    project.versions = { ...project.versions, [result.file]: result.version };
    const original = savedProject(project.slug);
    if (original) {
      original.files.push(result.file);
      original.versions = { ...original.versions, [result.file]: result.version };
    }
    return result.file;
  }

  // Swaps the file behind an image and keeps everything else: alt text, title,
  // description, cover mark, grid width and row, and the cover's place and size
  // on the home page. The old file stays in the project folder.
  async function replaceImageFile(index, file) {
    const project = projectBySlug();
    const image = project?.metadata.images?.[index];
    if (!image || !file) return;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
      toast("Подходят только JPG, PNG, WebP и GIF.", true);
      return;
    }
    try {
      const previous = image.file;
      const replacement = await uploadProjectFile(project, file);
      image.file = replacement;
      homeGalleryCovers.forEach(cover => {
        if (cover.project === project.slug && cover.file === previous) cover.file = replacement;
      });
      const [previousId, replacementId] = [`${project.slug}/${previous}`, `${project.slug}/${replacement}`];
      if (homeSelection.delete(previousId)) homeSelection.add(replacementId);
      if (selectedHomeCover === previousId) selectedHomeCover = replacementId;
      rerenderImages();
      refreshDirty();
      toast("Файл заменён, подписи и настройки сохранены. Сохраните изменения, чтобы он появился на сайте.");
    } catch (error) {
      toast(`${file.name}: ${error.message}`, true);
    }
  }

  async function uploadImages(files) {
    const project = projectBySlug();
    const accepted = [...files].filter(file => /\.(jpe?g|png|webp|gif)$/i.test(file.name));
    if (!project || !accepted.length) {
      if (files.length) toast("Подходят только JPG, PNG, WebP и GIF.", true);
      return;
    }
    const progress = projectEditor.querySelector("[data-upload-progress]");
    let done = 0;
    for (const file of accepted) {
      if (progress) {
        progress.hidden = false;
        progress.textContent = `Загрузка ${done + 1} из ${accepted.length}: ${file.name}…`;
      }
      try {
        const stored = await uploadProjectFile(project, file);
        project.metadata.images = project.metadata.images ?? [];
        project.metadata.images.push({ file: stored, alt: "" });
        done += 1;
      } catch (error) {
        toast(`${file.name}: ${error.message}`, true);
      }
    }
    if (progress) progress.hidden = true;
    if (done) {
      selectedImageIndex = project.metadata.images.length - done;
      rerenderImages();
      refreshDirty();
      toast(`${plural(done, "изображение добавлено", "изображения добавлены", "изображений добавлено")}. Заполните alt-текст и сохраните.`);
    }
  }

  async function deleteProject() {
    const project = projectBySlug();
    if (!project) return;
    if (isDirty()) {
      toast("Сначала сохраните или отмените текущие изменения.", true);
      return;
    }
    const accepted = await confirmAction({
      title: `Удалить «${project.metadata.title}»?`,
      message: "Проект исчезнет с сайта, его обложки уберутся с главной. Папка с файлами переместится в .builder-trash — её можно вернуть вручную.",
      accept: "Удалить проект",
      danger: true,
    });
    if (!accepted) return;
    try {
      const state = await request(`/api/projects/${encodeURIComponent(project.slug)}`, { method: "DELETE" });
      trashItems = null;
      selectedSlug = "";
      adoptState(state);
      navigate("projects");
      renderAll();
      toast("Проект удалён.");
    } catch (error) {
      toast(`Не удалось удалить: ${error.message}`, true);
    }
  }

  projectList.addEventListener("click", event => {
    const item = event.target.closest("[data-project-slug]");
    if (!item) return;
    event.preventDefault();
    selectedImageIndex = -1;
    navigate("projects", item.dataset.projectSlug);
  });

  projectEditor.addEventListener("input", event => {
    const project = projectBySlug();
    if (!project) return;
    const field = event.target.closest("[data-project-field]");
    if (field) {
      project.metadata[field.dataset.projectField] = field.value;
      if (field.dataset.projectField === "title") {
        projectEditor.querySelector(".project-header h2").textContent = field.value || "Без названия";
        const listTitle = projectList.querySelector(`[data-project-slug="${CSS.escape(project.slug)}"] strong`);
        if (listTitle) listTitle.textContent = field.value || project.slug;
      }
    }
    if (event.target.matches("[data-project-content]")) project.content = event.target.value;
    refreshDirty();
  });

  projectEditor.addEventListener("change", event => {
    const project = projectBySlug();
    if (!project) return;
    if (event.target.matches("[data-project-columns]")) {
      const columns = Number(event.target.value);
      if (columns) project.metadata.gallery_columns = columns;
      else delete project.metadata.gallery_columns;
      rerenderImages();
      refreshDirty();
    }
    if (event.target.matches("[data-image-input]")) {
      uploadImages(event.target.files);
      event.target.value = "";
    }
  });

  projectEditor.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const tile = event.target.closest("[data-image-index]");
    if (action === "toggle-cover" && tile) {
      toggleCover(Number(tile.dataset.imageIndex));
      return;
    }
    if (action === "add-images") projectEditor.querySelector("[data-image-input]").click();
    if (action === "delete-project") deleteProject();
    const unlistedAdd = event.target.closest("[data-unlisted-add]")?.dataset.unlistedAdd;
    if (unlistedAdd) addUnlistedFile(unlistedAdd);
    const unlistedDelete = event.target.closest("[data-unlisted-delete]")?.dataset.unlistedDelete;
    if (unlistedDelete) deleteUnlistedFile(unlistedDelete);
    if (tile && !action) {
      selectedImageIndex = Number(tile.dataset.imageIndex);
      projectEditor.querySelectorAll(".image-tile").forEach(item => item.classList.toggle("is-selected", item === tile));
      renderInspector();
    }
  });

  projectEditor.addEventListener("keydown", event => {
    const tile = event.target.closest?.("[data-image-index]");
    if (!tile) return;
    const index = Number(tile.dataset.imageIndex);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      tile.click();
    }
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      moveImage(index, index + (event.key === "ArrowLeft" ? -1 : 1));
      projectEditor.querySelector(`[data-image-index="${selectedImageIndex}"]`)?.focus();
    }
  });

  // Reordering tiles and dropping files share the drag events.
  projectEditor.addEventListener("dragstart", event => {
    const tile = event.target.closest("[data-image-index]");
    if (!tile) return;
    imageDrag = { from: Number(tile.dataset.imageIndex) };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tile.dataset.imageIndex);
    requestAnimationFrame(() => tile.classList.add("is-dragging"));
  });

  function clearDropMarkers() {
    projectEditor.querySelectorAll(".is-drop-before, .is-drop-after").forEach(item => item.classList.remove("is-drop-before", "is-drop-after"));
  }

  projectEditor.addEventListener("dragover", event => {
    const zone = event.target.closest("[data-drop-zone]");
    if (!zone) return;
    if (imageDrag) {
      const tile = event.target.closest("[data-image-index]");
      event.preventDefault();
      clearDropMarkers();
      if (!tile) return;
      const bounds = tile.getBoundingClientRect();
      const after = event.clientX > bounds.left + bounds.width / 2;
      tile.classList.add(after ? "is-drop-after" : "is-drop-before");
      imageDrag.to = Number(tile.dataset.imageIndex) + (after ? 1 : 0);
    } else if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      zone.classList.add("is-drop-active");
    }
  });

  projectEditor.addEventListener("dragleave", event => {
    const zone = event.target.closest("[data-drop-zone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-drop-active");
  });

  projectEditor.addEventListener("drop", event => {
    const zone = event.target.closest("[data-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-drop-active");
    if (imageDrag) {
      const { from, to } = imageDrag;
      imageDrag = null;
      clearDropMarkers();
      if (to !== undefined) moveImage(from, to > from ? to - 1 : to);
    } else if (event.dataTransfer.files.length) {
      uploadImages(event.dataTransfer.files);
    }
  });

  projectEditor.addEventListener("dragend", () => {
    imageDrag = null;
    clearDropMarkers();
    projectEditor.querySelectorAll(".is-dragging").forEach(item => item.classList.remove("is-dragging"));
  });

  imageInspector.addEventListener("input", event => {
    const image = projectBySlug()?.metadata.images?.[selectedImageIndex];
    const field = event.target.closest("[data-image-field]");
    if (!image || !field) return;
    const value = field.value;
    if (value.trim() || field.dataset.imageField === "alt") image[field.dataset.imageField] = value;
    else delete image[field.dataset.imageField];
    if (field.dataset.imageField === "alt") {
      const tile = projectEditor.querySelector(`[data-image-index="${selectedImageIndex}"]`);
      const warning = tile?.querySelector(".tile-warning");
      if (value.trim()) warning?.remove();
      else if (tile && !warning) tile.insertAdjacentHTML("beforeend", '<span class="tile-warning" title="Нет alt-текста">alt</span>');
    }
    refreshDirty();
  });

  imageInspector.addEventListener("change", event => {
    const project = projectBySlug();
    const image = project?.metadata.images?.[selectedImageIndex];
    if (!image) return;
    if (event.target.matches("[data-replace-input]")) {
      const [file] = event.target.files;
      event.target.value = "";
      replaceImageFile(selectedImageIndex, file);
      return;
    }
    if (event.target.matches("[data-image-cover]")) toggleCover(selectedImageIndex);
    if (event.target.matches("[data-image-span]")) {
      const span = Number(event.target.value);
      if (span > 1) image.span_columns = span;
      else delete image.span_columns;
      rerenderImages();
      refreshDirty();
    }
  });

  imageInspector.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    const project = projectBySlug();
    if (!button || !project) return;
    if (button.dataset.action === "move-image") moveImage(selectedImageIndex, selectedImageIndex + Number(button.dataset.step));
    if (button.dataset.action === "replace-image") imageInspector.querySelector("[data-replace-input]")?.click();
    if (button.dataset.action === "remove-image") {
      project.metadata.images.splice(selectedImageIndex, 1);
      syncProjectCovers(project.slug);
      selectedImageIndex = Math.min(selectedImageIndex, project.metadata.images.length - 1);
      rerenderImages();
      refreshDirty();
      toast("Изображение убрано из проекта. Файл остался в папке.");
    }
  });

  document.querySelector("#new-project").addEventListener("click", () => {
    newProjectForm.reset();
    newProjectForm.slug.dataset.edited = "";
    newProjectDialog.showModal();
  });

  newProjectForm.title.addEventListener("input", () => {
    if (!newProjectForm.slug.dataset.edited) newProjectForm.slug.value = slugify(newProjectForm.title.value);
  });
  newProjectForm.slug.addEventListener("input", () => { newProjectForm.slug.dataset.edited = "1"; });
  newProjectDialog.querySelector("[data-close-dialog]").addEventListener("click", () => newProjectDialog.close());

  newProjectForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!newProjectForm.reportValidity()) return;
    try {
      const project = await postJson("/api/projects", {
        title: newProjectForm.title.value,
        slug: newProjectForm.slug.value,
      });
      saved.projects.push(structuredClone(project));
      work.projects.push(project);
      newProjectDialog.close();
      selectedImageIndex = -1;
      navigate("projects", project.slug);
      toast("Проект создан. Добавьте изображения.");
    } catch (error) {
      toast(error.message.includes("already exists") ? "Проект с таким адресом уже есть." : error.message, true);
    }
  });

  // ---------------------------------------------------------------------------
  // Home page canvas
  //
  // Coordinates are in "units": the site's home gallery is 12 units wide and a
  // unit is square. The artboard (what visitors see) spans x 0..12 and grows
  // downward. Around it lies a pasteboard where covers can be parked: parked
  // covers are saved but not shown on the site, and they may overlap.
  // ---------------------------------------------------------------------------
  const SIDE = 6; // pasteboard width on each side, in units (the server allows up to 6)
  const TOP = 2; // pasteboard above the artboard, in units
  const BOTTOM = 4; // extra room below the lowest cover, in units
  const MIN_ROWS = 12;
  const SITE_UNIT_PX = 1394 / 12; // gallery width / 12 on a 1440px-wide browser window
  const FOLD_UNITS = (900 - 138) / SITE_UNIT_PX; // first screen of a 1440×900 window
  const SNAP_PX = 8;
  const GRID_STEP = 0.25;
  const EPSILON = 5e-4; // same tolerance as the server; about 0.06 px on the site

  const ALIGN_ICONS = {
    left: '<path d="M3 2v16M6 5h9v4H6zM6 11h6v4H6z"/>',
    centerX: '<path d="M10 2v16M5 5h10v4H5zM7 11h6v4H7z"/>',
    right: '<path d="M17 2v16M5 5h9v4H5zM8 11h6v4H8z"/>',
    top: '<path d="M2 3h16M5 6v9h4V6zM11 6v6h4V6z"/>',
    centerY: '<path d="M2 10h16M5 5v10h4V5zM11 7v6h4V7z"/>',
    bottom: '<path d="M2 17h16M5 5v9h4V5zM11 8v6h4V8z"/>',
    distributeX: '<path d="M2 3v14M18 3v14M7 6h6v8H7z"/>',
    distributeY: '<path d="M3 2h14M3 18h14M6 7h8v6H6z"/>',
  };

  let homeUnit = 40; // pixels per unit at the current zoom
  let homeSelection = new Set();
  let homeMode = "desktop";
  let homeDrag = null;
  let homeSpaceDown = false;
  let homeAutoScroll = null;
  let phoneZoom = 1;
  const imageRatios = new Map();

  function homeCoverId(cover) {
    return `${cover.project}/${cover.file}`;
  }

  function coverById(id) {
    return homeGalleryCovers.find(cover => homeCoverId(cover) === id);
  }

  function homeCoverInfo(cover) {
    const project = projectBySlug(cover.project);
    const image = project?.metadata.images?.find(entry => entry.file === cover.file);
    return project && image ? { project, image } : null;
  }

  function selectedCovers() {
    return homeGalleryCovers.filter(cover => homeSelection.has(homeCoverId(cover)));
  }

  function siteGapUnits() {
    return gapPixels() / SITE_UNIT_PX;
  }

  function gapPixels() {
    return Number.parseInt(work.config.home_gallery.gap ?? "5", 10) || 0;
  }

  function artboardRows() {
    return Math.max(MIN_ROWS, ...homeGalleryCovers.filter(cover => !cover.parked).map(cover => Math.ceil(cover.y + cover.height - EPSILON)));
  }

  function stageRows() {
    const lowest = Math.max(0, ...homeGalleryCovers.map(cover => cover.y + cover.height));
    return TOP + Math.max(artboardRows() + BOTTOM, Math.ceil(lowest) + 2);
  }

  function overlaps(a, b) {
    return a.x < b.x + b.width - EPSILON
      && a.x + a.width > b.x + EPSILON
      && a.y < b.y + b.height - EPSILON
      && a.y + a.height > b.y + EPSILON;
  }

  function centerIsOutside(layout) {
    const centerX = layout.x + layout.width / 2;
    const centerY = layout.y + layout.height / 2;
    return centerX < 0 || centerX > 12 || centerY < 0;
  }

  function insideArtboard(layout) {
    return layout.x >= -EPSILON && layout.y >= -EPSILON && layout.x + layout.width <= 12 + EPSILON && layout.y + layout.height <= 120;
  }

  function onPasteboard(layout) {
    return layout.x >= -SIDE - EPSILON && layout.x + layout.width <= 12 + SIDE + EPSILON && layout.y >= -TOP - EPSILON;
  }

  /** Check a full set of covers; returns null when valid, or { message, ids }. */
  function layoutIssue(covers) {
    const placed = [];
    const title = cover => homeCoverInfo(cover)?.project.metadata.title ?? cover.file;
    for (const cover of covers) {
      if (cover.parked) {
        if (!onPasteboard(cover)) return { message: `«${title(cover)}» вышла за пределы рабочего поля.`, ids: [homeCoverId(cover)] };
        continue;
      }
      if (!insideArtboard(cover)) return { message: `«${title(cover)}» выходит за край страницы.`, ids: [homeCoverId(cover)] };
      const other = placed.find(item => overlaps(cover, item));
      if (other) return { message: `«${title(cover)}» и «${title(other)}» перекрываются.`, ids: [homeCoverId(cover), homeCoverId(other)] };
      placed.push(cover);
    }
    return null;
  }

  function layoutProblem(covers) {
    return layoutIssue(covers)?.message ?? null;
  }

  /** Round edges (not sizes) to 4 decimals, like the server, so touching covers stay touching. */
  function roundLayout(layout) {
    const round = value => Math.round(value * 10000) / 10000;
    const left = round(layout.x);
    const top = round(layout.y);
    return { ...layout, x: left, y: top, width: round(round(layout.x + layout.width) - left), height: round(round(layout.y + layout.height) - top) };
  }

  function imageRatio(cover) {
    return imageRatios.get(homeCoverId(cover));
  }

  // --- History (covers plus the ★ flags, so removing a cover can be undone) ---
  function homeSnapshot() {
    return {
      covers: structuredClone(homeGalleryCovers),
      flags: Object.fromEntries(work.projects.map(project => [
        project.slug,
        (project.metadata.images ?? []).filter(image => image.cover === true).map(image => image.file),
      ])),
    };
  }

  function restoreHomeSnapshot(snapshot) {
    homeGalleryCovers = snapshot.covers;
    for (const project of work.projects) {
      const flagged = new Set(snapshot.flags[project.slug] ?? []);
      for (const image of project.metadata.images ?? []) {
        if (flagged.has(image.file) && image.cover !== true) image.cover = true;
        if (!flagged.has(image.file) && image.cover === true) delete image.cover;
      }
    }
    homeSelection = new Set([...homeSelection].filter(id => coverById(id)));
  }

  function recordHomeGalleryChange(before) {
    if (JSON.stringify(before) === JSON.stringify(homeSnapshot())) return;
    homeGalleryUndoStack.push(before);
    if (homeGalleryUndoStack.length > HOME_GALLERY_HISTORY_LIMIT) homeGalleryUndoStack.shift();
    homeGalleryRedoStack = [];
    updateHomeGalleryHistoryButtons();
    refreshDirty();
  }

  function restoreHomeGalleryHistory(from, to) {
    if (!from.length) return;
    to.push(homeSnapshot());
    restoreHomeSnapshot(from.pop());
    renderHomeGalleryEditor();
    refreshDirty();
  }

  function updateHomeGalleryHistoryButtons() {
    homeGalleryBoard.querySelector('[data-gallery-action="undo"]').disabled = homeGalleryUndoStack.length === 0;
    homeGalleryBoard.querySelector('[data-gallery-action="redo"]').disabled = homeGalleryRedoStack.length === 0;
    const compactButton = homeGalleryBoard.querySelector('[data-gallery-action="compact"]');
    const gaps = canCompact();
    compactButton.disabled = !gaps;
    compactButton.title = gaps ? "Подтянуть все обложки вверх и убрать пустоты" : "Пустот нет — уплотнять нечего";
  }

  /** Whether «Уплотнить» would move any cover up: tried on a copy. */
  function canCompact() {
    const trial = structuredClone(homeGalleryCovers);
    HOME_COMMANDS.compact(trial);
    return trial.some((cover, index) => !cover.parked && homeGalleryCovers[index].y - cover.y > EPSILON);
  }

  /** Apply a layout change to a copy, validate it, then commit with undo. */
  function applyHomeChange(mutate, { pushDown = null } = {}) {
    const before = homeSnapshot();
    const next = structuredClone(homeGalleryCovers);
    const result = mutate(next);
    if (result === false) return false;
    if (pushDown) pushCoversDown(next, pushDown);
    const problem = layoutProblem(next);
    if (problem) {
      toast(`Не получилось: ${problem}`, true);
      return false;
    }
    homeGalleryCovers = next.map(cover => (cover.parked ? cover : roundLayout(cover)));
    recordHomeGalleryChange(before);
    renderHomeGalleryEditor();
    return true;
  }

  /** Move covers that are not in `fixedIds` down until nothing on the artboard overlaps. */
  function pushCoversDown(covers, fixedIds) {
    const placed = covers.filter(cover => !cover.parked && fixedIds.has(homeCoverId(cover)));
    const movable = covers
      .filter(cover => !cover.parked && !fixedIds.has(homeCoverId(cover)))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const cover of movable) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const other of placed) {
          if (overlaps(cover, other)) {
            cover.y = other.y + other.height;
            moved = true;
          }
        }
      }
      placed.push(cover);
    }
  }

  // --- Rendering ---
  function renderHomeGalleryEditor() {
    if (!work) return;
    homeGalleryBoard.dataset.mode = homeMode;
    homeGalleryBoard.querySelectorAll("[data-home-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.homeMode === homeMode)));
    if (homeMode === "phone") renderPhoneOrder();
    else renderHomeStage();
    updatePhoneSortButton();
    renderHomeGalleryControls();
    updateHomeGalleryHistoryButtons();
  }

  function renderHomeStage() {
    const rows = artboardRows();
    homeGalleryCanvas.innerHTML = `
      <div class="home-artboard" style="--rows:${rows}">
        <div class="home-fold" style="--fold:${FOLD_UNITS}" title="Видно без прокрутки на экране 1440×900"><span>Первый экран · 1440×900</span></div>
      </div>
      <span class="pasteboard-label is-left">Парковка — не видно на сайте</span>
      <span class="pasteboard-label is-right">Парковка — не видно на сайте</span>
      ${homeGalleryCovers.map(cover => {
        const info = homeCoverInfo(cover);
        if (!info) return "";
        const id = homeCoverId(cover);
        const classes = ["cover-card", cover.crop ? "is-cropped" : "", cover.parked ? "is-parked" : "", homeSelection.has(id) ? "is-selected" : ""].join(" ");
        return `<article class="${classes}" data-cover-id="${escapeHtml(id)}">
          <img src="${imageUrl(cover.project, cover.file, 1200)}" alt="" draggable="false">
          <span class="cover-label">${escapeHtml(info.project.metadata.title ?? cover.file)}</span>
          ${cover.parked ? '<span class="cover-parked-badge">не на сайте</span>' : ""}
          <span class="cover-resize" data-resize-handle title="Размер (Shift — с сохранением пропорций)"></span>
        </article>`;
      }).join("")}
      <div class="home-marquee" hidden></div>
      <div id="home-gallery-guides" class="home-guides" aria-hidden="true"></div>
      ${homeGalleryCovers.length ? "" : '<div class="home-canvas-empty"><strong>На главной пока нет обложек</strong><span>Отметьте ★ у изображений во вкладке «Проекты».</span></div>'}`;
    homeGalleryGuides = homeGalleryCanvas.querySelector("#home-gallery-guides");
    homeGalleryCanvas.querySelectorAll(".cover-card img").forEach(image => {
      const id = image.closest("[data-cover-id]").dataset.coverId;
      const remember = () => {
        if (image.naturalWidth && image.naturalHeight) imageRatios.set(id, image.naturalWidth / image.naturalHeight);
      };
      if (image.complete) remember();
      else image.addEventListener("load", remember, { once: true });
    });
    homeGalleryCovers.forEach(cover => positionCoverCard(cover));
    updateStageSize();
  }

  function cardFor(cover) {
    return homeGalleryCanvas.querySelector(`[data-cover-id="${CSS.escape(homeCoverId(cover))}"]`);
  }

  function positionCoverCard(cover, layout = cover) {
    const card = cardFor(cover);
    if (!card) return;
    card.style.setProperty("--x", layout.x);
    card.style.setProperty("--y", layout.y);
    card.style.setProperty("--w", layout.width);
    card.style.setProperty("--h", layout.height);
    card.style.setProperty("--crop", `${cover.crop_x ?? 50}% ${cover.crop_y ?? 50}%`);
  }

  function updateStageSize() {
    homeGalleryCanvas.style.setProperty("--u", `${homeUnit}px`);
    homeGalleryCanvas.style.setProperty("--side", SIDE);
    homeGalleryCanvas.style.setProperty("--top", TOP);
    homeGalleryCanvas.style.setProperty("--gap", `${gapPixels() * homeUnit / SITE_UNIT_PX}px`);
    homeGalleryCanvas.style.width = `${(12 + SIDE * 2) * homeUnit}px`;
    homeGalleryCanvas.style.height = `${stageRows() * homeUnit}px`;
    homeGalleryCanvas.querySelector(".home-artboard")?.style.setProperty("--rows", artboardRows());
    homeGalleryCanvas.classList.toggle("is-detailed", homeUnit >= 60);
    homeGalleryZoomLevel.textContent = `${Math.round(homeUnit / SITE_UNIT_PX * 100)}%`;
  }

  function setHomeZoom(unit, anchor) {
    const viewport = homeGalleryViewport.getBoundingClientRect();
    const point = anchor ?? { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
    const stageX = (homeGalleryViewport.scrollLeft + point.x - viewport.left) / homeUnit;
    const stageY = (homeGalleryViewport.scrollTop + point.y - viewport.top) / homeUnit;
    homeUnit = Math.max(8, Math.min(240, unit));
    updateStageSize();
    homeGalleryViewport.scrollLeft = stageX * homeUnit - (point.x - viewport.left);
    homeGalleryViewport.scrollTop = stageY * homeUnit - (point.y - viewport.top);
  }

  function setPhoneZoom(zoom) {
    phoneZoom = Math.max(0.15, Math.min(1.5, zoom));
    const frame = homeGalleryCanvas.querySelector(".phone-frame");
    if (frame) frame.style.zoom = phoneZoom;
    homeGalleryZoomLevel.textContent = `${Math.round(phoneZoom * 100)}%`;
  }

  function fitPhone() {
    const frame = homeGalleryCanvas.querySelector(".phone-frame");
    if (!frame) return;
    frame.style.zoom = 1;
    setPhoneZoom((homeGalleryViewport.clientHeight - 48) / frame.offsetHeight);
  }

  function fitHome() {
    if (homeMode === "phone") {
      fitPhone();
      return;
    }
    const width = homeGalleryViewport.clientWidth;
    const height = homeGalleryViewport.clientHeight;
    if (!width || !height) return;
    homeUnit = Math.max(8, Math.min(width / (12 + SIDE * 2), height / stageRows()));
    updateStageSize();
    homeGalleryViewport.scrollLeft = 0;
    homeGalleryViewport.scrollTop = 0;
  }

  // --- Phone order ---
  function renderPhoneOrder() {
    const visible = homeGalleryCovers.filter(cover => !cover.parked && homeCoverInfo(cover));
    homeGalleryCanvas.style.width = "";
    homeGalleryCanvas.style.height = "";
    homeGalleryCanvas.innerHTML = `
      <div class="phone-frame">
        <p class="phone-hint">На телефоне обложки идут одной колонкой в этом порядке. Перетаскивайте, чтобы изменить. Первая загружается раньше всех и попадает в превью ссылок.</p>
        <ol class="phone-list">${visible.map((cover, index) => `
          <li class="phone-item${homeSelection.has(homeCoverId(cover)) ? " is-selected" : ""}" draggable="true" data-phone-id="${escapeHtml(homeCoverId(cover))}">
            <span class="phone-index">${index + 1}</span>
            <img src="${imageUrl(cover.project, cover.file, 480)}" alt="" draggable="false" loading="lazy">
          </li>`).join("")}
        </ol>
      </div>`;
    setPhoneZoom(phoneZoom);
  }

  /** Visible covers top to bottom, left to right, as they stand on the canvas. */
  function canvasOrder() {
    return homeGalleryCovers.filter(cover => !cover.parked).sort((a, b) => a.y - b.y || a.x - b.x).map(homeCoverId);
  }

  function updatePhoneSortButton() {
    const button = homeGalleryBoard.querySelector("[data-phone-sort]");
    if (!button) return;
    const current = homeGalleryCovers.filter(cover => !cover.parked).map(homeCoverId);
    const same = current.join("\n") === canvasOrder().join("\n");
    button.disabled = same;
    button.title = same
      ? "Порядок на телефоне уже совпадает с холстом"
      : "Расставить обложки на телефоне сверху вниз, слева направо — как они стоят на холсте";
  }

  function reorderCovers(ids) {
    const before = homeSnapshot();
    const byId = new Map(homeGalleryCovers.map(cover => [homeCoverId(cover), cover]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    const rest = homeGalleryCovers.filter(cover => !ids.includes(homeCoverId(cover)));
    homeGalleryCovers = [...ordered, ...rest];
    recordHomeGalleryChange(before);
    renderHomeGalleryEditor();
  }

  homeGalleryCanvas.addEventListener("dragstart", event => {
    const item = event.target.closest("[data-phone-id]");
    if (!item) return;
    homeDrag = { type: "phone", id: item.dataset.phoneId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.dataset.phoneId);
    requestAnimationFrame(() => item.classList.add("is-dragging"));
  });

  homeGalleryCanvas.addEventListener("dragover", event => {
    if (homeDrag?.type !== "phone") return;
    const item = event.target.closest("[data-phone-id]");
    if (!item || item.dataset.phoneId === homeDrag.id) return;
    event.preventDefault();
    const list = item.parentElement;
    const dragged = list.querySelector(`[data-phone-id="${CSS.escape(homeDrag.id)}"]`);
    const bounds = item.getBoundingClientRect();
    list.insertBefore(dragged, event.clientY > bounds.top + bounds.height / 2 ? item.nextSibling : item);
  });

  homeGalleryCanvas.addEventListener("dragend", () => {
    if (homeDrag?.type !== "phone") return;
    homeDrag = null;
    reorderCovers([...homeGalleryCanvas.querySelectorAll("[data-phone-id]")].map(item => item.dataset.phoneId));
  });

  // --- Pointer interaction on the stage ---
  function stagePoint(event) {
    const bounds = homeGalleryCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / homeUnit - SIDE,
      y: (event.clientY - bounds.top) / homeUnit - TOP,
    };
  }

  function snapTargets(excludedIds) {
    const xs = [0, 6, 12];
    const ys = [0];
    for (const cover of homeGalleryCovers) {
      if (excludedIds.has(homeCoverId(cover)) || cover.parked) continue;
      xs.push(cover.x, cover.x + cover.width);
      ys.push(cover.y, cover.y + cover.height);
    }
    return { xs, ys };
  }

  function nearest(values, targets) {
    let best = null;
    for (const value of values) {
      for (const target of targets) {
        const distance = Math.abs(target - value) * homeUnit;
        if (distance <= SNAP_PX && (!best || distance < best.distance)) best = { delta: target - value, distance, target };
      }
    }
    return best;
  }

  function snapEnabled(event) {
    return homeGalleryMagnetEnabled && !event.altKey;
  }

  function gridEnabled(event) {
    return homeGallerySnapEnabled && !event.altKey;
  }

  function showGuides(lines) {
    if (!homeGalleryGuides) return;
    homeGalleryGuides.innerHTML = [
      ...lines.xs.map(x => `<span class="home-guide is-vertical" style="--pos:${x}"></span>`),
      ...lines.ys.map(y => `<span class="home-guide is-horizontal" style="--pos:${y}"></span>`),
    ].join("");
  }

  function startMove(event, ids) {
    const covers = homeGalleryCovers.filter(cover => ids.has(homeCoverId(cover)));
    homeDrag = {
      type: "move",
      pointerId: event.pointerId,
      start: stagePoint(event),
      starts: new Map(covers.map(cover => [homeCoverId(cover), { x: cover.x, y: cover.y, width: cover.width, height: cover.height, parked: cover.parked === true }])),
      before: homeSnapshot(),
      proposal: null,
      valid: true,
      moved: false,
      hoverId: null,
      swapTimer: null,
      lastEvent: event,
    };
  }

  function updateMove(event) {
    const drag = homeDrag;
    drag.lastEvent = event;
    const point = stagePoint(event);
    let dx = point.x - drag.start.x;
    let dy = point.y - drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 2 / homeUnit) drag.moved = true;
    if (!drag.moved) return;
    const starts = [...drag.starts.values()];
    const box = {
      left: Math.min(...starts.map(item => item.x)) + dx,
      top: Math.min(...starts.map(item => item.y)) + dy,
      right: Math.max(...starts.map(item => item.x + item.width)) + dx,
      bottom: Math.max(...starts.map(item => item.y + item.height)) + dy,
    };
    const guides = { xs: [], ys: [] };
    if (gridEnabled(event)) {
      dx += Math.round(box.left / GRID_STEP) * GRID_STEP - box.left;
      dy += Math.round(box.top / GRID_STEP) * GRID_STEP - box.top;
    } else if (snapEnabled(event)) {
      const targets = snapTargets(new Set(drag.starts.keys()));
      const snapX = nearest([box.left, box.right, (box.left + box.right) / 2], targets.xs);
      const snapY = nearest([box.top, box.bottom], targets.ys);
      if (snapX) { dx += snapX.delta; guides.xs.push(snapX.target); }
      if (snapY) { dy += snapY.delta; guides.ys.push(snapY.target); }
    }
    showGuides(guides);
    const proposal = new Map();
    for (const [id, start] of drag.starts) {
      const layout = { x: start.x + dx, y: start.y + dy, width: start.width, height: start.height };
      layout.parked = centerIsOutside(layout);
      if (layout.parked) {
        layout.x = Math.max(-SIDE, Math.min(12 + SIDE - layout.width, layout.x));
        layout.y = Math.max(-TOP, layout.y);
      }
      proposal.set(id, layout);
    }
    const next = homeGalleryCovers.map(cover => {
      const layout = proposal.get(homeCoverId(cover));
      return layout ? { ...cover, ...layout } : cover;
    });
    drag.proposal = proposal;
    drag.valid = !layoutProblem(next);
    for (const cover of homeGalleryCovers) {
      const layout = proposal.get(homeCoverId(cover));
      if (!layout) continue;
      positionCoverCard(cover, layout);
      const card = cardFor(cover);
      card.classList.add("is-dragging");
      card.classList.toggle("is-invalid", !drag.valid);
      card.classList.toggle("is-parked", layout.parked);
    }
    updateSwapTarget(event);
    autoScroll(event);
  }

  function updateSwapTarget(event) {
    const drag = homeDrag;
    if (drag.starts.size !== 1) return;
    const [movingId] = drag.starts.keys();
    const point = stagePoint(event);
    const target = homeGalleryCovers.find(cover => homeCoverId(cover) !== movingId && !cover.parked
      && point.x >= cover.x && point.x <= cover.x + cover.width && point.y >= cover.y && point.y <= cover.y + cover.height);
    const targetId = target ? homeCoverId(target) : null;
    if (targetId === drag.hoverId) return;
    window.clearTimeout(drag.swapTimer);
    homeGalleryCanvas.querySelector(".is-swap-target")?.classList.remove("is-swap-target");
    drag.hoverId = targetId;
    if (!target) return;
    cardFor(target)?.classList.add("is-swap-target");
    drag.swapTimer = window.setTimeout(() => {
      if (homeDrag !== drag || drag.hoverId !== targetId) return;
      const moving = coverById(movingId);
      const start = drag.starts.get(movingId);
      if (start.parked) return;
      const targetLayout = { x: target.x, y: target.y, width: target.width, height: target.height };
      Object.assign(target, { x: start.x, y: start.y, width: start.width, height: start.height });
      Object.assign(moving, targetLayout, { parked: false });
      drag.swapped = true;
      finishDrag(true);
    }, HOME_GALLERY_SWAP_HOVER_MS);
  }

  function finishDrag(committed) {
    const drag = homeDrag;
    if (!drag) return;
    window.clearTimeout(drag.swapTimer);
    stopAutoScroll();
    homeDrag = null;
    showGuides({ xs: [], ys: [] });
    if (drag.type === "move" && !drag.swapped && committed && drag.moved && drag.valid && drag.proposal) {
      for (const cover of homeGalleryCovers) {
        const layout = drag.proposal.get(homeCoverId(cover));
        if (!layout) continue;
        Object.assign(cover, layout.parked ? layout : roundLayout(layout));
        if (!layout.parked) delete cover.parked;
      }
    }
    if (drag.type === "move" && drag.moved && !drag.valid && !drag.swapped) {
      toast("Сюда нельзя: обложки перекрылись бы или вышли за край страницы.", true);
    }
    if (drag.type === "resize" && committed && drag.valid && drag.proposal) {
      Object.assign(coverById(drag.id), roundLayout(drag.proposal));
    }
    if (drag.before) recordHomeGalleryChange(drag.before);
    renderHomeGalleryEditor();
  }

  function startResize(event, id) {
    const cover = coverById(id);
    homeDrag = {
      type: "resize",
      id,
      pointerId: event.pointerId,
      start: stagePoint(event),
      layout: { x: cover.x, y: cover.y, width: cover.width, height: cover.height },
      before: homeSnapshot(),
      valid: true,
      proposal: null,
    };
  }

  function updateResize(event) {
    const drag = homeDrag;
    const cover = coverById(drag.id);
    const point = stagePoint(event);
    const start = drag.layout;
    let width = Math.max(0.5, start.width + point.x - drag.start.x);
    let height = Math.max(0.5, start.height + point.y - drag.start.y);
    const guides = { xs: [], ys: [] };
    const ratio = event.shiftKey ? (imageRatio(cover) ?? start.width / start.height) : null;
    if (gridEnabled(event)) {
      width = Math.max(GRID_STEP, Math.round((start.x + width) / GRID_STEP) * GRID_STEP - start.x);
      height = Math.max(GRID_STEP, Math.round((start.y + height) / GRID_STEP) * GRID_STEP - start.y);
    } else if (snapEnabled(event)) {
      const targets = snapTargets(new Set([drag.id]));
      const snapX = nearest([start.x + width], targets.xs);
      const snapY = nearest([start.y + height], targets.ys);
      if (snapX) { width += snapX.delta; guides.xs.push(snapX.target); }
      if (snapY && !ratio) { height += snapY.delta; guides.ys.push(snapY.target); }
    }
    if (ratio) {
      const gap = siteGapUnits();
      height = Math.max(0.5, (width - gap) / ratio + gap);
    }
    showGuides(guides);
    const proposal = { ...start, width, height };
    const next = homeGalleryCovers.map(item => (item === cover ? { ...item, ...proposal } : item));
    drag.valid = !layoutProblem(next);
    drag.proposal = proposal;
    positionCoverCard(cover, proposal);
    cardFor(cover)?.classList.toggle("is-invalid", !drag.valid);
    autoScroll(event);
  }

  function startMarquee(event, additive) {
    homeDrag = {
      type: "marquee",
      pointerId: event.pointerId,
      start: stagePoint(event),
      base: additive ? new Set(homeSelection) : new Set(),
    };
  }

  function updateMarquee(event) {
    const drag = homeDrag;
    const point = stagePoint(event);
    const rect = {
      x: Math.min(point.x, drag.start.x),
      y: Math.min(point.y, drag.start.y),
      width: Math.abs(point.x - drag.start.x),
      height: Math.abs(point.y - drag.start.y),
    };
    const marquee = homeGalleryCanvas.querySelector(".home-marquee");
    marquee.hidden = false;
    marquee.style.setProperty("--x", rect.x);
    marquee.style.setProperty("--y", rect.y);
    marquee.style.setProperty("--w", rect.width);
    marquee.style.setProperty("--h", rect.height);
    homeSelection = new Set(drag.base);
    for (const cover of homeGalleryCovers) {
      if (overlaps(cover, rect)) homeSelection.add(homeCoverId(cover));
    }
    homeGalleryCanvas.querySelectorAll("[data-cover-id]").forEach(card => card.classList.toggle("is-selected", homeSelection.has(card.dataset.coverId)));
    autoScroll(event);
  }

  function autoScroll(event) {
    const bounds = homeGalleryViewport.getBoundingClientRect();
    const edge = 36;
    const speedX = event.clientX < bounds.left + edge ? -12 : event.clientX > bounds.right - edge ? 12 : 0;
    const speedY = event.clientY < bounds.top + edge ? -12 : event.clientY > bounds.bottom - edge ? 12 : 0;
    if (!speedX && !speedY) {
      stopAutoScroll();
      return;
    }
    homeAutoScroll = { speedX, speedY, event };
    if (homeAutoScroll.frame) return;
    const tick = () => {
      if (!homeAutoScroll || !homeDrag) return;
      homeGalleryViewport.scrollLeft += homeAutoScroll.speedX;
      homeGalleryViewport.scrollTop += homeAutoScroll.speedY;
      if (homeDrag.type === "move") updateMove(homeAutoScroll.event);
      if (homeDrag?.type === "resize") updateResize(homeAutoScroll.event);
      if (homeDrag?.type === "marquee") updateMarquee(homeAutoScroll.event);
      if (homeAutoScroll) homeAutoScroll.frame = requestAnimationFrame(tick);
    };
    homeAutoScroll.frame = requestAnimationFrame(tick);
  }

  function stopAutoScroll() {
    if (homeAutoScroll?.frame) cancelAnimationFrame(homeAutoScroll.frame);
    homeAutoScroll = null;
  }

  homeGalleryViewport.addEventListener("pointerdown", event => {
    if (homeMode !== "desktop" || event.target.closest(".home-toolbar")) return;
    if (event.button === 1 || (event.button === 0 && homeSpaceDown)) {
      homeDrag = { type: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: homeGalleryViewport.scrollLeft, top: homeGalleryViewport.scrollTop };
      homeGalleryViewport.classList.add("is-panning");
      homeGalleryViewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const card = event.target.closest("[data-cover-id]");
    homeGalleryCanvas.focus({ preventScroll: true });
    if (!card) {
      if (event.target.closest(".home-canvas")) {
        startMarquee(event, event.shiftKey || event.metaKey);
        homeGalleryViewport.setPointerCapture(event.pointerId);
        if (!event.shiftKey && !event.metaKey) {
          homeSelection.clear();
          renderHomeGalleryControls();
        }
      }
      return;
    }
    const id = card.dataset.coverId;
    if (event.target.closest("[data-resize-handle]")) {
      homeSelection = new Set([id]);
      selectedHomeCover = id;
      startResize(event, id);
    } else {
      if (event.shiftKey || event.metaKey) {
        if (homeSelection.has(id)) homeSelection.delete(id);
        else homeSelection.add(id);
      } else if (!homeSelection.has(id)) {
        homeSelection = new Set([id]);
      }
      if (homeSelection.has(id)) selectedHomeCover = id;
      homeGalleryCanvas.querySelectorAll("[data-cover-id]").forEach(item => item.classList.toggle("is-selected", homeSelection.has(item.dataset.coverId)));
      renderHomeGalleryControls();
      if (!homeSelection.has(id)) return;
      startMove(event, homeSelection);
    }
    homeGalleryViewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  homeGalleryViewport.addEventListener("pointermove", event => {
    if (!homeDrag || event.pointerId !== homeDrag.pointerId) return;
    if (homeDrag.type === "pan") {
      homeGalleryViewport.scrollLeft = homeDrag.left - (event.clientX - homeDrag.x);
      homeGalleryViewport.scrollTop = homeDrag.top - (event.clientY - homeDrag.y);
    }
    if (homeDrag.type === "move") updateMove(event);
    if (homeDrag?.type === "resize") updateResize(event);
    if (homeDrag?.type === "marquee") updateMarquee(event);
  });

  function endPointer(event) {
    if (!homeDrag || event.pointerId !== homeDrag.pointerId) return;
    if (homeDrag.type === "pan") {
      homeDrag = null;
      homeGalleryViewport.classList.remove("is-panning");
      return;
    }
    if (homeDrag.type === "marquee") {
      homeDrag = null;
      stopAutoScroll();
      homeGalleryCanvas.querySelector(".home-marquee").hidden = true;
      if (homeSelection.size === 1) [selectedHomeCover] = homeSelection;
      renderHomeGalleryControls();
      return;
    }
    finishDrag(event.type === "pointerup");
  }
  homeGalleryViewport.addEventListener("pointerup", endPointer);
  homeGalleryViewport.addEventListener("pointercancel", endPointer);

  homeGalleryViewport.addEventListener("dblclick", event => {
    const card = event.target.closest("[data-cover-id]");
    if (card) openCoverProject(coverById(card.dataset.coverId));
  });

  homeGalleryViewport.addEventListener("wheel", event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (homeMode === "phone") setPhoneZoom(phoneZoom * Math.exp(-event.deltaY * 0.01));
    else setHomeZoom(homeUnit * Math.exp(-event.deltaY * 0.01), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  // --- Keyboard ---
  /** How far the selection can move in a direction, up to `step`: it stops at neighbours and page edges. */
  function arrowDistance(dx, dy, step) {
    let limit = step;
    const moving = selectedCovers();
    const obstacles = homeGalleryCovers.filter(cover => !cover.parked && !homeSelection.has(homeCoverId(cover)));
    for (const cover of moving) {
      const left = cover.parked ? -SIDE : 0;
      const right = cover.parked ? 12 + SIDE : 12;
      const top = cover.parked ? -TOP : 0;
      if (dx > 0) limit = Math.min(limit, right - cover.x - cover.width);
      if (dx < 0) limit = Math.min(limit, cover.x - left);
      if (dy < 0) limit = Math.min(limit, cover.y - top);
      if (dy > 0 && !cover.parked) limit = Math.min(limit, 120 - cover.y - cover.height);
      if (cover.parked) continue;
      for (const other of obstacles) {
        const sharesRow = cover.y < other.y + other.height - EPSILON && cover.y + cover.height > other.y + EPSILON;
        const sharesColumn = cover.x < other.x + other.width - EPSILON && cover.x + cover.width > other.x + EPSILON;
        if (dx > 0 && sharesRow && other.x >= cover.x + cover.width - EPSILON) limit = Math.min(limit, other.x - cover.x - cover.width);
        if (dx < 0 && sharesRow && other.x + other.width <= cover.x + EPSILON) limit = Math.min(limit, cover.x - other.x - other.width);
        if (dy > 0 && sharesColumn && other.y >= cover.y + cover.height - EPSILON) limit = Math.min(limit, other.y - cover.y - cover.height);
        if (dy < 0 && sharesColumn && other.y + other.height <= cover.y + EPSILON) limit = Math.min(limit, cover.y - other.y - other.height);
      }
    }
    return Math.max(0, limit);
  }

  function isTyping(target) {
    return target?.closest?.("input, textarea, select, [contenteditable='true']");
  }

  homeView.addEventListener("keydown", event => {
    if (isTyping(event.target)) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (command && key === "z") {
      event.preventDefault();
      if (event.shiftKey) restoreHomeGalleryHistory(homeGalleryRedoStack, homeGalleryUndoStack);
      else restoreHomeGalleryHistory(homeGalleryUndoStack, homeGalleryRedoStack);
      return;
    }
    if (command && key === "y") {
      event.preventDefault();
      restoreHomeGalleryHistory(homeGalleryRedoStack, homeGalleryUndoStack);
      return;
    }
    if (command && key === "a") {
      event.preventDefault();
      homeSelection = new Set(homeGalleryCovers.map(homeCoverId));
      renderHomeGalleryEditor();
      return;
    }
    if (event.key === "Escape") {
      homeSelection.clear();
      renderHomeGalleryEditor();
      return;
    }
    if (event.shiftKey && event.key === "!") {
      fitHome();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && homeSelection.size) {
      event.preventDefault();
      removeSelectedFromHome();
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key] && homeSelection.size && homeMode === "desktop") {
      event.preventDefault();
      const [dx, dy] = arrows[event.key];
      const distance = arrowDistance(dx, dy, (event.shiftKey ? 10 : 1) / homeUnit);
      if (distance <= 1e-9) return;
      applyHomeChange(covers => {
        for (const cover of covers) {
          if (!homeSelection.has(homeCoverId(cover))) continue;
          cover.x += dx * distance;
          cover.y += dy * distance;
        }
      });
    }
  });

  window.addEventListener("keydown", event => {
    if (event.code === "Space" && currentView === "home" && !isTyping(event.target) && !homeSpaceDown) {
      homeSpaceDown = true;
      homeGalleryViewport.classList.add("can-pan");
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", event => {
    if (event.code === "Space") {
      homeSpaceDown = false;
      homeGalleryViewport.classList.remove("can-pan");
    }
  });

  // --- Commands ---
  function removeSelectedFromHome() {
    const covers = selectedCovers();
    if (!covers.length) return;
    const before = homeSnapshot();
    for (const cover of covers) {
      const image = homeCoverInfo(cover)?.image;
      if (image) delete image.cover;
    }
    homeGalleryCovers = homeGalleryCovers.filter(cover => !homeSelection.has(homeCoverId(cover)));
    homeSelection.clear();
    recordHomeGalleryChange(before);
    renderHomeGalleryEditor();
    toast(`${plural(covers.length, "обложка убрана", "обложки убраны", "обложек убрано")} с главной. ⌘Z — вернуть.`);
  }

  function openCoverProject(cover) {
    const project = cover && projectBySlug(cover.project);
    if (!project) return;
    navigate("projects", cover.project, project.metadata.images.findIndex(image => image.file === cover.file));
  }

  function selectionIn(covers) {
    return covers.filter(cover => homeSelection.has(homeCoverId(cover)));
  }

  function bounds(covers) {
    return {
      left: Math.min(...covers.map(cover => cover.x)),
      top: Math.min(...covers.map(cover => cover.y)),
      right: Math.max(...covers.map(cover => cover.x + cover.width)),
      bottom: Math.max(...covers.map(cover => cover.y + cover.height)),
    };
  }

  function requireRatios(covers) {
    const missing = covers.filter(cover => !imageRatio(cover));
    if (missing.length) {
      toast("Изображения ещё загружаются — попробуйте через секунду.", true);
      return false;
    }
    return true;
  }

  const HOME_COMMANDS = {
    left: covers => { const box = bounds(selectionIn(covers)); selectionIn(covers).forEach(cover => { cover.x = box.left; }); },
    right: covers => { const box = bounds(selectionIn(covers)); selectionIn(covers).forEach(cover => { cover.x = box.right - cover.width; }); },
    centerX: covers => { const box = bounds(selectionIn(covers)); selectionIn(covers).forEach(cover => { cover.x = (box.left + box.right - cover.width) / 2; }); },
    top: covers => { const box = bounds(selectionIn(covers)); selectionIn(covers).forEach(cover => { cover.y = box.top; }); },
    bottom: covers => { const box = bounds(selectionIn(covers)); selectionIn(covers).forEach(cover => { cover.y = box.bottom - cover.height; }); },
    centerY: covers => { const box = bounds(selectionIn(covers)); selectionIn(covers).forEach(cover => { cover.y = (box.top + box.bottom - cover.height) / 2; }); },
    distributeX: covers => {
      const items = selectionIn(covers).sort((a, b) => a.x - b.x);
      const box = bounds(items);
      const space = (box.right - box.left - items.reduce((sum, cover) => sum + cover.width, 0)) / (items.length - 1);
      let x = box.left;
      for (const cover of items) { cover.x = x; x += cover.width + space; }
    },
    distributeY: covers => {
      const items = selectionIn(covers).sort((a, b) => a.y - b.y);
      const box = bounds(items);
      const space = (box.bottom - box.top - items.reduce((sum, cover) => sum + cover.height, 0)) / (items.length - 1);
      let y = box.top;
      for (const cover of items) { cover.y = y; y += cover.height + space; }
    },
    sameHeight: covers => {
      const items = selectionIn(covers).sort((a, b) => a.x - b.x);
      if (!requireRatios(items)) return false;
      const gap = siteGapUnits();
      const anchor = covers.find(cover => homeCoverId(cover) === selectedHomeCover) ?? items[0];
      const height = anchor.height;
      const box = bounds(items);
      let x = box.left;
      for (const cover of items) {
        cover.height = height;
        if (!cover.crop) cover.width = imageRatio(cover) * (height - gap) + gap;
        cover.x = x;
        cover.y = box.top;
        x += cover.width;
      }
      if (x > 12 + EPSILON) {
        toast("Ряд не помещается по ширине. Уменьшите высоту одной обложки или нажмите «Во всю ширину».", true);
        return false;
      }
    },
    fillRow: covers => {
      const items = selectionIn(covers).sort((a, b) => a.x - b.x);
      if (!requireRatios(items)) return false;
      const gap = siteGapUnits();
      const ratios = items.map(cover => (cover.crop ? (cover.width - gap) / (cover.height - gap) : imageRatio(cover)));
      const height = gap + (12 - items.length * gap) / ratios.reduce((sum, ratio) => sum + ratio, 0);
      const top = bounds(items).top;
      let x = 0;
      items.forEach((cover, index) => {
        cover.width = index === items.length - 1 ? 12 - x : ratios[index] * (height - gap) + gap;
        cover.height = height;
        cover.x = x;
        cover.y = top;
        x += cover.width;
      });
    },
    fitRatio: covers => {
      const items = selectionIn(covers);
      if (!requireRatios(items)) return false;
      const gap = siteGapUnits();
      for (const cover of items) {
        cover.height = Math.max(0.5, (cover.width - gap) / imageRatio(cover) + gap);
        cover.crop = false;
      }
    },
    compact: covers => {
      const placed = [];
      for (const cover of covers.filter(item => !item.parked).sort((a, b) => a.y - b.y || a.x - b.x)) {
        cover.y = Math.max(0, ...placed.filter(other => cover.x < other.x + other.width - EPSILON && cover.x + cover.width > other.x + EPSILON).map(other => other.y + other.height));
        placed.push(cover);
      }
    },
    unpark: covers => {
      const bottom = Math.max(0, ...covers.filter(cover => !cover.parked).map(cover => cover.y + cover.height));
      let x = 0;
      let y = bottom;
      let rowHeight = 0;
      for (const cover of selectionIn(covers).filter(item => item.parked)) {
        if (x + cover.width > 12 + EPSILON) { x = 0; y += rowHeight; rowHeight = 0; }
        cover.x = x;
        cover.y = y;
        delete cover.parked;
        x += cover.width;
        rowHeight = Math.max(rowHeight, cover.height);
      }
    },
  };

  function runHomeCommand(name) {
    const pushDown = ["sameHeight", "fillRow", "fitRatio", "unpark"].includes(name) ? new Set(homeSelection) : null;
    if (applyHomeChange(HOME_COMMANDS[name], { pushDown }) && name === "compact") toast("Пустоты убраны.");
  }

  // --- Side panel ---
  function renderHomeGalleryControls() {
    const home = work.config.home_gallery;
    const covers = selectedCovers();
    let selectionSection;
    if (!covers.length) {
      selectionSection = `
        <h2>Ничего не выбрано</h2>
        <p class="field-help" style="margin-bottom:10px">Нажмите на обложку или обведите несколько рамкой.</p>
        <ul class="shortcut-list">
          <li><span>Добавить к выделению</span><span><kbd>Shift</kbd> + клик</span></li>
          <li><span>Двигать холст</span><span><kbd>Пробел</kbd> + тянуть</span></li>
          <li><span>Масштаб</span><span><kbd>⌘</kbd> + колесо</span></li>
          <li><span>Точный сдвиг</span><span>стрелки, <kbd>Shift</kbd> ×10</span></li>
          <li><span>Без прилипания</span><span>держать <kbd>Alt</kbd></span></li>
          <li><span>Размер с пропорциями</span><span>угол + <kbd>Shift</kbd></span></li>
          <li><span>Убрать с главной</span><span><kbd>Delete</kbd></span></li>
          <li><span>Показать всё</span><span><kbd>Shift</kbd> + 1</span></li>
        </ul>`;
    } else if (covers.length === 1) {
      const [cover] = covers;
      const info = homeCoverInfo(cover);
      const position = `${cover.crop_x ?? 50}% ${cover.crop_y ?? 50}%`;
      selectionSection = `
        <h2>${escapeHtml(info?.project.metadata.title ?? cover.project)}</h2>
        <p class="field-help">${escapeHtml(cover.file)}${cover.parked ? ' · <span class="badge">на парковке, не видно на сайте</span>' : ""}</p>
        <div class="home-cover-crop-preview${cover.crop ? " is-cropped" : ""}" style="aspect-ratio: ${cover.width} / ${cover.height}; --home-cover-position: ${position}">
          <img src="${imageUrl(cover.project, cover.file, 480)}" alt="" style="object-position: ${position}" draggable="false">
        </div>
        <label class="switch"><input type="checkbox" data-home-crop ${cover.crop ? "checked" : ""}><span><strong>Заполнить плитку</strong><small>${cover.crop ? "Перетащите изображение выше, чтобы выбрать кадр." : "Иначе изображение вписывается целиком."}</small></span></label>
        <div class="command-grid">
          <button class="button button-secondary button-small" type="button" data-home-command="fitRatio" title="Высота плитки по пропорциям изображения — без пустых полей">Плитка по пропорциям</button>
          ${cover.parked ? '<button class="button button-secondary button-small" type="button" data-home-command="unpark">Вернуть на страницу</button>' : ""}
          <button class="button button-ghost button-small" type="button" data-open-cover-project>Открыть проект →</button>
          <button class="button button-ghost button-small" type="button" data-home-remove>Убрать с главной</button>
        </div>`;
    } else {
      const anyParked = covers.some(cover => cover.parked);
      const iconButton = (name, title, disabled = false) => `<button class="icon-button" type="button" data-home-command="${name}" title="${title}" aria-label="${title}" ${disabled ? "disabled" : ""}><svg viewBox="0 0 20 20" aria-hidden="true">${ALIGN_ICONS[name]}</svg></button>`;
      selectionSection = `
        <h2>Выделено ${plural(covers.length, "обложка", "обложки", "обложек")}</h2>
        <p class="field-help">Перетаскивайте их вместе или двигайте стрелками.</p>
        <div class="field"><span>Выровнять</span>
          <div class="align-bar">
            ${iconButton("left", "По левому краю")}${iconButton("centerX", "По центру по горизонтали")}${iconButton("right", "По правому краю")}
            <span class="toolbar-divider"></span>
            ${iconButton("top", "По верху")}${iconButton("centerY", "По центру по вертикали")}${iconButton("bottom", "По низу")}
          </div>
        </div>
        <div class="field"><span>Распределить</span>
          <div class="align-bar">
            ${iconButton("distributeX", "Равные промежутки по горизонтали", covers.length < 3)}${iconButton("distributeY", "Равные промежутки по вертикали", covers.length < 3)}
            ${covers.length < 3 ? '<small class="field-help">от 3 обложек</small>' : ""}
          </div>
        </div>
        <div class="field"><span>Ряд</span>
          <div class="command-grid">
            <button class="button button-secondary button-small" type="button" data-home-command="sameHeight" title="Высота как у последней выбранной; ширина — по пропорциям; встают в ряд вплотную">Одинаковая высота</button>
            <button class="button button-secondary button-small" type="button" data-home-command="fillRow" title="Одинаковая высота и ряд ровно на всю ширину страницы">Во всю ширину</button>
            <button class="button button-secondary button-small" type="button" data-home-command="fitRatio" title="Высота каждой плитки по пропорциям изображения">Плитки по пропорциям</button>
            ${anyParked ? '<button class="button button-secondary button-small" type="button" data-home-command="unpark">Вернуть на страницу</button>' : ""}
          </div>
          <small class="field-help">Обложки ниже ряда сдвинутся вниз, если не хватит места.</small>
        </div>
        <button class="button button-ghost button-small" type="button" data-home-remove>Убрать с главной</button>`;
    }
    homeGalleryControls.innerHTML = `
      <section class="panel-section">${selectionSection}</section>
      <section class="panel-section">
        <h2>Главная страница</h2>
        <div class="field"><span>Клик по обложке</span>
          <div class="choice-group">
            <label class="choice"><input type="radio" name="home-click" value="single" ${home.single_page ? "checked" : ""}><span><strong>Открывает изображение</strong><small>Одностраничный сайт; страницы проектов доступны по ссылке.</small></span></label>
            <label class="choice"><input type="radio" name="home-click" value="projects" ${home.single_page ? "" : "checked"}><span><strong>Ведёт на страницу проекта</strong></span></label>
          </div>
        </div>
        <div class="field"><span>Отступ между обложками</span>
          <div class="range-row"><input type="range" min="0" max="60" step="1" value="${gapPixels()}" data-home-gap><output data-home-gap-output>${gapPixels()} px</output></div>
        </div>
        <label class="switch"><input type="checkbox" data-home-compact ${home.compact ? "checked" : ""}><span><strong>Компактный старт</strong><small>Главная открывается уменьшенной целиком, чтобы все обложки поместились в первый экран, и с первой прокруткой вырастает до полного размера. На телефоне не действует.</small></span></label>
      </section>
      <section class="panel-section">
        <h2>Прилипание</h2>
        <label class="switch"><input type="checkbox" data-home-magnet ${homeGalleryMagnetEnabled ? "checked" : ""}><span><strong>К краям соседних обложек</strong><small>Удерживайте Alt, чтобы временно отключить.</small></span></label>
        <label class="switch"><input type="checkbox" data-home-snap ${homeGallerySnapEnabled ? "checked" : ""}><span><strong>К сетке</strong><small>Шаг — четверть колонки.</small></span></label>
      </section>`;
  }

  homeGalleryControls.addEventListener("change", event => {
    const control = event.target;
    const home = work.config.home_gallery;
    if (control.name === "home-click") home.single_page = control.value === "single";
    if (control.matches("[data-home-compact]")) home.compact = control.checked;
    if (control.matches("[data-home-magnet]")) homeGalleryMagnetEnabled = control.checked;
    if (control.matches("[data-home-snap]")) homeGallerySnapEnabled = control.checked;
    if (control.matches("[data-home-crop]")) {
      applyHomeChange(covers => {
        selectionIn(covers).forEach(cover => { cover.crop = control.checked; });
      });
    }
    refreshDirty();
  });

  homeGalleryControls.addEventListener("input", event => {
    if (!event.target.matches("[data-home-gap]")) return;
    work.config.home_gallery.gap = `${event.target.value}px`;
    homeGalleryControls.querySelector("[data-home-gap-output]").value = `${event.target.value} px`;
    updateStageSize();
    refreshDirty();
  });

  homeGalleryControls.addEventListener("click", event => {
    const command = event.target.closest("[data-home-command]")?.dataset.homeCommand;
    if (command) runHomeCommand(command);
    if (event.target.closest("[data-home-remove]")) removeSelectedFromHome();
    if (event.target.closest("[data-open-cover-project]")) openCoverProject(selectedCovers()[0]);
  });

  // Cropping inside the preview of the selected cover.
  homeGalleryControls.addEventListener("pointerdown", event => {
    const preview = event.target.closest(".home-cover-crop-preview.is-cropped");
    const [cover] = selectedCovers();
    if (!preview || !cover) return;
    const image = preview.querySelector("img");
    if (!image?.naturalWidth) return;
    const box = preview.getBoundingClientRect();
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    homeDrag = {
      type: "crop",
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cropX: cover.crop_x ?? 50,
      cropY: cover.crop_y ?? 50,
      overflowX: image.naturalWidth * scale - box.width,
      overflowY: image.naturalHeight * scale - box.height,
      before: homeSnapshot(),
      cover,
      image,
    };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add("is-dragging");
    event.preventDefault();
  });

  homeGalleryControls.addEventListener("pointermove", event => {
    const drag = homeDrag;
    if (drag?.type !== "crop" || event.pointerId !== drag.pointerId) return;
    if (drag.overflowX > 0) drag.cover.crop_x = Math.round(Math.max(0, Math.min(100, drag.cropX - (event.clientX - drag.x) / drag.overflowX * 100)) * 100) / 100;
    if (drag.overflowY > 0) drag.cover.crop_y = Math.round(Math.max(0, Math.min(100, drag.cropY - (event.clientY - drag.y) / drag.overflowY * 100)) * 100) / 100;
    const position = `${drag.cover.crop_x}% ${drag.cover.crop_y}%`;
    drag.image.style.objectPosition = position;
    positionCoverCard(drag.cover);
  });

  function endCrop(event) {
    if (homeDrag?.type !== "crop" || event.pointerId !== homeDrag.pointerId) return;
    const { before } = homeDrag;
    homeDrag = null;
    recordHomeGalleryChange(before);
    renderHomeGalleryEditor();
  }
  homeGalleryControls.addEventListener("pointerup", endCrop);
  homeGalleryControls.addEventListener("pointercancel", endCrop);

  // --- Toolbar ---
  homeGalleryBoard.addEventListener("click", event => {
    const action = event.target.closest("[data-gallery-action]")?.dataset.galleryAction;
    const mode = event.target.closest("[data-home-mode]")?.dataset.homeMode;
    if (mode && mode !== homeMode) {
      homeMode = mode;
      renderHomeGalleryEditor();
      requestAnimationFrame(fitHome);
    }
    if (event.target.closest("[data-phone-sort]")) {
      reorderCovers(canvasOrder());
      toast("Порядок на телефоне теперь как на холсте: сверху вниз, слева направо.");
    }
    if (!action) return;
    if (action === "undo") restoreHomeGalleryHistory(homeGalleryUndoStack, homeGalleryRedoStack);
    if (action === "redo") restoreHomeGalleryHistory(homeGalleryRedoStack, homeGalleryUndoStack);
    const zoomBy = factor => (homeMode === "phone" ? setPhoneZoom(phoneZoom * factor) : setHomeZoom(homeUnit * factor));
    if (action === "zoom-in") zoomBy(1.25);
    if (action === "zoom-out") zoomBy(1 / 1.25);
    if (action === "zoom-fit") fitHome();
    if (action === "zoom-real") {
      if (homeMode === "phone") setPhoneZoom(1);
      else setHomeZoom(SITE_UNIT_PX);
    }
    if (action === "compact") runHomeCommand("compact");
  });

  new ResizeObserver(() => {
    if (currentView === "home" && homeGalleryNeedsFit && homeGalleryViewport.clientWidth) {
      homeGalleryNeedsFit = false;
      fitHome();
    }
  }).observe(homeGalleryViewport);

  // ---------------------------------------------------------------------------
  // Text: fonts, sizes and alignment per place on the site
  // ---------------------------------------------------------------------------
  const textContent = document.querySelector("#text-content");
  const ALIGN_LABELS = { left: "Слева", center: "По центру", right: "Справа" };
  let fontCatalog = null;
  let fontCatalogState = "";
  const previewFonts = new Set();
  let installingFont = "";

  let fontCatalogPromise = null;
  function loadFontCatalog() {
    fontCatalogPromise ??= fetchFontCatalog();
    return fontCatalogPromise;
  }

  async function fetchFontCatalog() {
    fontCatalogState = "loading";
    try {
      fontCatalog = (await request("/api/fonts/catalog")).families;
      fontCatalogState = "";
    } catch (error) {
      fontCatalogState = error.message;
      fontCatalogPromise = null; // try again next time
    }
    // An open picker refreshes itself; re-rendering would close it.
    if (currentView === "text" && !picker) renderTextView();
  }

  /** Show a Google font in the builder's previews; the site itself uses the downloaded copy. */
  function usePreviewFont(family) {
    if (!family || previewFonts.has(family)) return;
    previewFonts.add(family);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
    document.head.append(link);
  }

  function textPlaces() {
    return work?.text_places ?? [];
  }

  function textStyle(placeId) {
    return work.config.text_styles?.[placeId] ?? {};
  }

  function setTextStyle(placeId, key, value) {
    const styles = structuredClone(work.config.text_styles ?? {});
    const style = { ...(styles[placeId] ?? {}) };
    if (value === undefined || value === null || value === "") delete style[key];
    else style[key] = value;
    if (Object.keys(style).length) styles[placeId] = style;
    else delete styles[placeId];
    if (Object.keys(styles).length) work.config.text_styles = styles;
    else delete work.config.text_styles;
    refreshDirty();
  }

  function sampleText(place) {
    const sample = String(place.sample ?? "");
    if (/^[a-z_]+(\.[a-z_]+)+$/.test(sample)) {
      const value = getPath(work.config, sample.split("."));
      if (typeof value === "string" && value.trim()) return value;
    }
    return sample || place.label;
  }

  function previewStyle(place) {
    const style = textStyle(place.id);
    const family = style.font || place.font;
    usePreviewFont(family);
    const size = style.font_size || place.font_size;
    const align = place.align ? (style.align || place.align) : "left";
    const familyCss = family ? `'${family.replace(/'/g, "")}', ` : "";
    return `font-family: ${familyCss}Arial, sans-serif; font-size: ${Math.min(size, 90)}px; text-align: ${align};`;
  }

  function renderTextPlace(place) {
    const style = textStyle(place.id);
    const changed = Object.keys(style).length > 0;
    const currentAlign = style.align || place.align;
    const alignControl = place.align ? `
      <div class="field">
        <span>Выравнивание</span>
        <div class="segmented" role="group" aria-label="Выравнивание">
          ${Object.entries(ALIGN_LABELS).map(([value, label]) => `
            <button type="button" data-text-align="${value}" aria-pressed="${currentAlign === value}">${label}</button>`).join("")}
        </div>
      </div>` : "";
    const installing = installingFont && installingFont === style.font ? " — скачиваю…" : "";
    return `
      <div class="text-place${changed ? " is-changed" : ""}" data-place="${escapeHtml(place.id)}">
        <div class="text-place-head">
          <strong>${escapeHtml(place.label)}</strong>
          ${changed ? '<button class="text-button" type="button" data-text-reset>Как было</button>' : ""}
        </div>
        <div class="text-place-preview" style="${previewStyle(place)}">${escapeHtml(sampleText(place))}</div>
        <div class="text-place-controls">
          <div class="field font-picker">
            <span>Шрифт${installing}</span>
            <input data-text-font role="combobox" aria-autocomplete="list" aria-expanded="false" value="${escapeHtml(style.font ?? "")}" placeholder="${escapeHtml(place.font || "Arial (системный)")} — по умолчанию" autocomplete="off" spellcheck="false" aria-label="Шрифт: ${escapeHtml(place.label)}">
          </div>
          <label class="field">
            <span>Размер, px</span>
            <input type="number" min="8" max="200" step="1" data-text-size value="${style.font_size ?? ""}" placeholder="${place.font_size}">
          </label>
          ${alignControl}
        </div>
      </div>`;
  }

  function renderTextView() {
    if (!work) return;
    loadFontCatalog();
    const groups = [];
    for (const place of textPlaces()) {
      let group = groups.find(item => item.name === place.group);
      if (!group) {
        group = { name: place.group, places: [] };
        groups.push(group);
      }
      group.places.push(place);
    }
    const focused = textContent.contains(document.activeElement) ? document.activeElement : null;
    const focusPlace = focused?.closest("[data-place]")?.dataset.place;
    const focusField = focused?.matches("[data-text-font]") ? "font" : "size";
    const catalogProblem = fontCatalogState && fontCatalogState !== "loading"
      ? `<p class="publish-error">Список шрифтов Google не загрузился: ${escapeHtml(fontCatalogState)}</p>`
      : "";
    textContent.innerHTML = catalogProblem + renderHeaderCard() + renderColorsCard() + groups.map(group => `
      <section class="card">
        <div class="card-heading"><h2>${escapeHtml(group.name)}</h2></div>
        ${group.places.map(renderTextPlace).join("")}
      </section>`).join("");
    if (focusPlace) textContent.querySelector(`[data-place="${focusPlace}"] [data-text-${focusField}]`)?.focus();
  }


  // --- Colours ---
  function colorSettings() {
    return work?.color_settings ?? [];
  }

  function chosenColor(setting) {
    const chosen = work.config.colors?.[setting.id] ?? {};
    return {
      color: chosen.color ?? setting.color,
      opacity: setting.opacity === undefined ? undefined : (chosen.opacity ?? setting.opacity),
      changed: Object.keys(chosen).length > 0,
    };
  }

  /** Store a colour value; one equal to the default is not a change. */
  function setColor(setting, key, value) {
    const colors = structuredClone(work.config.colors ?? {});
    const entry = { ...(colors[setting.id] ?? {}) };
    const isDefault = key === "color" ? String(value).toLowerCase() === setting.color.toLowerCase() : value === setting.opacity;
    if (isDefault) delete entry[key];
    else entry[key] = value;
    if (Object.keys(entry).length) colors[setting.id] = entry;
    else delete colors[setting.id];
    if (Object.keys(colors).length) work.config.colors = colors;
    else delete work.config.colors;
    refreshDirty();
  }

  function swatchStyle(setting) {
    const { color, opacity } = chosenColor(setting);
    return opacity === undefined ? `background: ${color}` : `background: color-mix(in srgb, ${color} ${opacity}%, transparent)`;
  }

  function renderColorRow(setting) {
    const { color, opacity, changed } = chosenColor(setting);
    return `
      <div class="color-row${changed ? " is-changed" : ""}" data-color="${escapeHtml(setting.id)}">
        <span class="color-swatch" aria-hidden="true"><span style="${swatchStyle(setting)}"></span></span>
        <div class="color-label">
          <strong>${escapeHtml(setting.label)}</strong>
          ${setting.help ? `<small>${escapeHtml(setting.help)}</small>` : ""}
        </div>
        <div class="color-controls">
          <input type="color" data-color-value value="${escapeHtml(color)}" aria-label="${escapeHtml(setting.label)}">
          <input class="color-hex" data-color-hex value="${escapeHtml(color)}" maxlength="7" spellcheck="false" aria-label="Код цвета">
          ${opacity === undefined ? "" : `
            <label class="color-opacity" title="Непрозрачность">
              <input type="range" min="0" max="100" step="1" data-color-opacity value="${opacity}" aria-label="Непрозрачность">
              <output>${opacity}%</output>
            </label>`}
          ${changed ? '<button class="text-button" type="button" data-color-reset>Как было</button>' : ""}
        </div>
      </div>`;
  }

  function renderColorsCard() {
    const settings = colorSettings();
    if (!settings.length) return "";
    return `
      <section class="card">
        <div class="card-heading"><div><h2>Цвета</h2><p>Для полупрозрачных — ползунок непрозрачности: 0% — не видно, 100% — сплошной цвет.</p></div></div>
        ${settings.map(renderColorRow).join("")}
      </section>`;
  }

  function refreshColorRow(row, setting) {
    const { color, opacity } = chosenColor(setting);
    row.querySelector(".color-swatch span").setAttribute("style", swatchStyle(setting));
    if (document.activeElement !== row.querySelector("[data-color-hex]")) row.querySelector("[data-color-hex]").value = color;
    row.querySelector("[data-color-value]").value = color;
    const output = row.querySelector(".color-opacity output");
    if (output) output.textContent = `${opacity}%`;
  }

  textContent.addEventListener("input", event => {
    const row = event.target.closest("[data-color]");
    if (!row) return;
    const setting = colorSettings().find(item => item.id === row.dataset.color);
    if (!setting) return;
    if (event.target.matches("[data-color-value]")) setColor(setting, "color", event.target.value.toLowerCase());
    if (event.target.matches("[data-color-hex]")) {
      const value = event.target.value.trim();
      if (!/^#[0-9a-f]{6}$/i.test(value)) return;
      setColor(setting, "color", value.toLowerCase());
    }
    if (event.target.matches("[data-color-opacity]")) setColor(setting, "opacity", Number(event.target.value));
    refreshColorRow(row, setting);
  });

  textContent.addEventListener("change", event => {
    // Show or hide «Как было» once a colour has been picked.
    if (event.target.closest("[data-color]")) renderTextView();
  });

  textContent.addEventListener("click", event => {
    const row = event.target.closest("[data-color]");
    if (!row || !event.target.closest("[data-color-reset]")) return;
    const colors = structuredClone(work.config.colors ?? {});
    delete colors[row.dataset.color];
    if (Object.keys(colors).length) work.config.colors = colors;
    else delete work.config.colors;
    refreshDirty();
    renderTextView();
  });

  async function chooseFont(placeId, value) {
    const typed = value.trim();
    if (!typed) {
      setTextStyle(placeId, "font", "");
      renderTextView();
      return;
    }
    const match = fontCatalog?.find(item => item.family.toLowerCase() === typed.toLowerCase());
    if (!match) {
      toast(fontCatalog ? `Шрифта «${typed}» нет в Google Fonts — выберите из списка.` : "Список шрифтов ещё загружается, попробуйте через секунду.", true);
      renderTextView();
      return;
    }
    setTextStyle(placeId, "font", match.family);
    if (!(work.fonts ?? []).includes(match.family)) {
      installingFont = match.family;
      renderTextView();
      try {
        work.fonts = (await postJson("/api/fonts/install", { family: match.family })).fonts;
        toast(`Шрифт «${match.family}» скачан. Сохраните, чтобы он появился на сайте.`);
      } catch (error) {
        setTextStyle(placeId, "font", "");
        toast(error.message, true);
      } finally {
        installingFont = "";
      }
    }
    renderTextView();
  }

  // --- Font picker: each name drawn in its own font, tried on the preview before choosing ---
  const FONT_MENU_LIMIT = 200;
  const CATEGORY_FALLBACK = { "Serif": "serif", "Sans Serif": "sans-serif", "Display": "sans-serif", "Handwriting": "cursive", "Monospace": "monospace" };
  const nameFonts = new Map(); // family -> promise of a FontFace with just the glyphs of its name
  let picker = null; // { placeId, input, menu, items, active, observer }

  /** Load a tiny face containing only the letters of the family's name, under its own alias. */
  function loadNameFont(family) {
    if (nameFonts.has(family)) return nameFonts.get(family);
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&text=${encodeURIComponent(family)}`;
    const promise = fetch(url)
      .then(response => (response.ok ? response.text() : ""))
      .then(css => {
        const source = css.match(/url\((https:[^)]+)\)/)?.[1];
        if (!source) return null;
        const face = new FontFace(`picker-${family}`, `url(${source})`);
        document.fonts.add(face);
        return face.load();
      })
      .catch(() => null);
    nameFonts.set(family, promise);
    return promise;
  }

  function previewElement(placeId) {
    return textContent.querySelector(`[data-place="${placeId}"] .text-place-preview`);
  }

  /** Show a family on the place's preview without choosing it; null puts the saved choice back. */
  function tryFontOnPreview(placeId, family) {
    const place = textPlaces().find(item => item.id === placeId);
    const preview = previewElement(placeId);
    if (!place || !preview) return;
    preview.setAttribute("style", previewStyle(place));
    if (family === null) return;
    const shown = family || place.font;
    usePreviewFont(shown);
    preview.style.fontFamily = shown ? `'${shown.replace(/'/g, "")}', Arial, sans-serif` : "Arial, sans-serif";
  }

  function pickerMatches(query) {
    const text = query.trim().toLowerCase();
    if (!fontCatalog) return [];
    if (!text) return fontCatalog.slice(0, FONT_MENU_LIMIT);
    const starts = [];
    const contains = [];
    for (const item of fontCatalog) {
      const name = item.family.toLowerCase();
      if (name.startsWith(text)) starts.push(item);
      else if (name.includes(text)) contains.push(item);
      if (starts.length >= FONT_MENU_LIMIT) break;
    }
    return [...starts, ...contains].slice(0, FONT_MENU_LIMIT);
  }

  function setPickerActive(index, { scroll = true, tryIt = true } = {}) {
    if (!picker) return;
    const options = [...picker.menu.querySelectorAll("[data-family]")];
    if (!options.length) return;
    picker.active = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option, position) => option.setAttribute("aria-selected", String(position === picker.active)));
    const option = options[picker.active];
    picker.input.setAttribute("aria-activedescendant", option.id);
    if (scroll) option.scrollIntoView({ block: "nearest" });
    if (tryIt) tryFontOnPreview(picker.placeId, option.dataset.family);
  }

  function renderPickerMenu() {
    if (!picker) return;
    const place = textPlaces().find(item => item.id === picker.placeId);
    const matches = pickerMatches(picker.input.value);
    const defaultLabel = `По умолчанию — ${place?.font || "Arial (системный)"}`;
    const showDefault = !picker.input.value.trim();
    picker.items = [...(showDefault ? [{ family: "", category: "" }] : []), ...matches];
    picker.observer?.disconnect();
    picker.menu.innerHTML = picker.items.length
      ? picker.items.map((item, index) => {
        const fallback = CATEGORY_FALLBACK[item.category] ?? "sans-serif";
        const family = item.family;
        const style = family ? `font-family: 'picker-${escapeHtml(family)}', ${fallback};` : "";
        return `<li role="option" id="font-option-${index}" data-family="${escapeHtml(family)}" style="${style}" aria-selected="false">${escapeHtml(family || defaultLabel)}</li>`;
      }).join("")
      : `<li class="font-menu-empty">${fontCatalog ? "Ничего не нашлось" : "Загружаю список шрифтов…"}</li>`;
    picker.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const family = entry.target.dataset.family;
        if (entry.isIntersecting && family) {
          loadNameFont(family);
          picker?.observer.unobserve(entry.target);
        }
      }
    }, { root: picker.menu, rootMargin: "120px" });
    picker.menu.querySelectorAll("[data-family]").forEach(option => picker.observer.observe(option));
    const current = textStyle(picker.placeId).font ?? "";
    const typed = picker.input.value.trim().toLowerCase();
    const start = typed ? 0 : Math.max(0, picker.items.findIndex(item => item.family === current));
    if (picker.items.length) setPickerActive(start, { tryIt: Boolean(typed) });
  }

  function openPicker(input) {
    const placeId = input.closest("[data-place]").dataset.place;
    if (picker?.input === input) return;
    closePicker(false);
    const menu = document.createElement("ul");
    menu.className = "font-menu";
    menu.setAttribute("role", "listbox");
    menu.id = `font-menu-${placeId}`;
    input.setAttribute("aria-controls", menu.id);
    input.setAttribute("aria-expanded", "true");
    input.after(menu);
    picker = { placeId, input, menu, items: [], active: 0, observer: null };
    // Keep focus in the input while the mouse works in the menu.
    menu.addEventListener("mousedown", event => event.preventDefault());
    menu.addEventListener("mousemove", event => {
      const option = event.target.closest("[data-family]");
      if (!option) return;
      const index = [...menu.querySelectorAll("[data-family]")].indexOf(option);
      if (index !== picker.active) setPickerActive(index, { scroll: false });
    });
    menu.addEventListener("click", event => {
      const option = event.target.closest("[data-family]");
      if (option) commitPicker(option.dataset.family);
    });
    menu.addEventListener("mouseleave", () => tryFontOnPreview(placeId, null));
    loadFontCatalog().then(() => { if (picker?.menu === menu) renderPickerMenu(); });
    renderPickerMenu();
  }

  function closePicker(restore = true) {
    if (!picker) return;
    const { placeId, input, menu, observer } = picker;
    observer?.disconnect();
    menu.remove();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    picker = null;
    if (restore) {
      input.value = textStyle(placeId).font ?? "";
      tryFontOnPreview(placeId, null);
    }
  }

  function commitPicker(family) {
    if (!picker) return;
    const { placeId, input } = picker;
    closePicker(false);
    input.blur();
    chooseFont(placeId, family);
  }

  textContent.addEventListener("focusin", event => {
    const input = event.target.closest("[data-text-font]");
    if (input) {
      openPicker(input);
      input.select();
    }
  });

  textContent.addEventListener("focusout", event => {
    if (picker && event.target === picker.input) closePicker(true);
  });

  textContent.addEventListener("keydown", event => {
    if (!picker || event.target !== picker.input) return;
    const page = 8;
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (event.key in moves) {
      event.preventDefault();
      setPickerActive(picker.active + moves[event.key]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = picker.items[picker.active];
      if (item) commitPicker(item.family);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePicker(true);
      event.target.blur();
    }
  });

  textContent.addEventListener("input", event => {
    if (picker && event.target === picker.input) {
      renderPickerMenu();
      if (!picker.input.value.trim()) tryFontOnPreview(picker.placeId, null);
    }
  });

  textContent.addEventListener("input", event => {
    const input = event.target.closest("[data-text-size]");
    if (!input) return;
    const placeElement = input.closest("[data-place]");
    const place = textPlaces().find(item => item.id === placeElement.dataset.place);
    const value = input.value === "" ? "" : Number(input.value);
    if (value !== "" && (!Number.isFinite(value) || value < 8 || value > 200)) return;
    // The default size is not a change: keep only sizes that differ from it.
    setTextStyle(placeElement.dataset.place, "font_size", value === place?.font_size ? "" : value);
    if (place) placeElement.querySelector(".text-place-preview").setAttribute("style", previewStyle(place));
  });

  // An empty size field would step from the minimum (8): start from the default instead.
  textContent.addEventListener("focusin", event => {
    const input = event.target.closest("[data-text-size]");
    if (!input || input.value !== "") return;
    const place = textPlaces().find(item => item.id === input.closest("[data-place]").dataset.place);
    if (place?.font_size) input.value = place.font_size;
  });

  textContent.addEventListener("focusout", event => {
    const input = event.target.closest("[data-text-size]");
    if (!input) return;
    const placeId = input.closest("[data-place]").dataset.place;
    if (textStyle(placeId).font_size === undefined) input.value = "";
    // Show or hide «изменено» and «Как было» once editing ends.
    window.setTimeout(() => {
      if (!textContent.contains(document.activeElement)) renderTextView();
    }, 0);
  });

  textContent.addEventListener("click", event => {
    const placeId = event.target.closest("[data-place]")?.dataset.place;
    if (!placeId) return;
    const alignButton = event.target.closest("[data-text-align]");
    if (alignButton) {
      const place = textPlaces().find(item => item.id === placeId);
      const value = alignButton.dataset.textAlign;
      setTextStyle(placeId, "align", value === place?.align ? "" : value);
      renderTextView();
    }
    if (event.target.closest("[data-text-reset]")) {
      const styles = structuredClone(work.config.text_styles ?? {});
      delete styles[placeId];
      if (Object.keys(styles).length) work.config.text_styles = styles;
      else delete work.config.text_styles;
      refreshDirty();
      renderTextView();
    }
  });

  // ---------------------------------------------------------------------------
  // Publishing: status, publish, history, undo, trash, help
  // ---------------------------------------------------------------------------
  const publishPill = document.querySelector("#publish-pill");
  const publishPillText = document.querySelector("#publish-pill-text");
  const publishContent = document.querySelector("#publish-content");
  const FETCH_EVERY_MS = 3 * 60 * 1000;
  let publishStatus = null;
  let publishHistory = null;
  let publishing = false;
  let publishNote = "";
  let publishPollTimer = 0;
  let lastFetchAt = 0;
  let helpReport = "";
  let tokenDraft = "";
  let tokenSaving = false;
  let tokenFormOpen = false;

  const dateFormat = new Intl.DateTimeFormat("ru", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
  }

  function hasUnpublished(status = publishStatus) {
    return Boolean(status && !status.error && (status.change_count > 0 || status.ahead > 0));
  }

  /** One sentence about the site, plus a tone for the dot. */
  function publishSummary() {
    const status = publishStatus;
    if (publishing) return { tone: "info", short: "Публикую…", title: "Отправляю правки на сайт…" };
    if (!status) return { tone: "muted", short: "Проверяю сайт…", title: "Проверяю сайт…" };
    if (status.error) return { tone: "danger", short: "Конструктор не отвечает", title: "Конструктор не отвечает", text: status.error };
    if (status.busy || status.branch !== "main") {
      return {
        tone: "danger",
        short: "Нужна помощь",
        title: "Сайт на этом компьютере в необычном состоянии",
        text: "Ничего не потеряно, но публиковать сейчас нельзя. Нажмите «Скопировать отчёт» внизу и отправьте его тому, кто помогает с сайтом.",
      };
    }
    const token = status.token?.state;
    if (token === "missing" || token === "invalid") {
      return {
        tone: "danger",
        short: "Нет доступа к GitHub",
        title: token === "missing" ? "Этот компьютер ещё не подключён к GitHub" : "Ключ доступа к GitHub не работает",
        text: "Править сайт можно, но публиковать — нет. Вставьте новый ключ в разделе «Доступ к GitHub» ниже.",
      };
    }
    if (hasUnpublished(status)) {
      const count = status.changes.length || status.change_count;
      return {
        tone: "warning",
        short: count ? `Не опубликовано: ${count}` : "Не отправлено",
        title: count ? "Эти правки ещё не на сайте" : "Правки ещё не дошли до сайта",
        text: status.online === false
          ? "Нет связи с GitHub. Правки сохранены на этом компьютере — опубликуйте их, когда появится интернет."
          : "Посетители видят прежнюю версию, пока вы не нажмёте «Опубликовать».",
      };
    }
    const deployment = status.deployment?.state;
    if (deployment === "deploying" || deployment === "pending") {
      return {
        tone: "info",
        short: "Сайт обновляется…",
        title: "Сайт обновляется",
        text: "Обычно это занимает 2–4 минуты. Можно продолжать работать или закрыть конструктор.",
      };
    }
    if (deployment === "failed") {
      return {
        tone: "danger",
        short: "Сайт не обновился",
        title: "Последняя публикация не попала на сайт",
        text: "Проверка на GitHub нашла ошибку, поэтому посетители по-прежнему видят прошлую версию. Скопируйте отчёт внизу и отправьте его тому, кто помогает с сайтом — или отмените последнюю публикацию в истории.",
      };
    }
    return {
      tone: "ok",
      short: "Всё на сайте",
      title: "Всё опубликовано",
      text: status.online === false ? "Нет связи с GitHub, поэтому новости с других компьютеров сейчас не проверить." : "Сайт показывает последнюю версию.",
    };
  }

  function renderPublishPill() {
    const summary = publishSummary();
    publishPill.dataset.tone = summary.tone;
    publishPillText.textContent = summary.short;
    publishPill.title = summary.text ?? summary.title;
  }

  function schedulePublishPoll() {
    window.clearTimeout(publishPollTimer);
    const deployment = publishStatus?.deployment?.state;
    const busy = deployment === "deploying" || deployment === "pending";
    publishPollTimer = window.setTimeout(() => refreshPublishStatus({ fetch: Date.now() - lastFetchAt > FETCH_EVERY_MS }), busy ? 8000 : 60000);
  }

  async function refreshPublishStatus({ fetch = false } = {}) {
    try {
      if (fetch) lastFetchAt = Date.now();
      publishStatus = await request(`/api/publish/status${fetch ? "?fetch=1" : ""}`);
      if (fetch) await bringInRemoteChanges();
    } catch (error) {
      publishStatus = { error: error.message };
    }
    renderPublishPill();
    if (currentView === "publish") renderPublishView();
    if (currentView === "health") renderHealthView();
    schedulePublishPoll();
  }

  /** Apply changes published from another computer, when nothing local is in the way. */
  async function bringInRemoteChanges() {
    if (!publishStatus?.behind || publishStatus.ahead || publishing || saving || isDirty()) return;
    const result = await postJson("/api/publish/sync", {});
    if (result.result !== "updated") return;
    if (result.code_changed) {
      toast("Загружено обновление конструктора — перезапускаю…");
      await restartBuilder();
      return;
    }
    adoptState(await request("/api/state"));
    renderAll();
    publishStatus = await request("/api/publish/status");
    toast("Загружены правки, сделанные на другом компьютере.");
  }

  async function loadPublishHistory() {
    try {
      publishHistory = await request("/api/publish/history");
    } catch (error) {
      publishHistory = { error: error.message };
    }
    if (currentView === "publish") renderPublishView();
  }

  function renderPublishView() {
    if (!publishHistory) loadPublishHistory();
    const focused = publishContent.contains(document.activeElement) && document.activeElement.id
      ? { id: document.activeElement.id, caret: document.activeElement.selectionStart }
      : null;
    const summary = publishSummary();
    const status = publishStatus;
    const pending = hasUnpublished(status);
    const dirty = work ? isDirty() : false;
    const changesList = pending && status.changes.length
      ? `<ul class="change-list">${status.changes.map(group => `
          <li>
            <strong>${escapeHtml(group.title)}</strong>
            ${group.details.length ? `<ul>${group.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}
          </li>`).join("")}</ul>`
      : "";
    const siteLink = status?.site_url
      ? `<a class="button button-secondary" href="${escapeHtml(status.site_url)}" target="_blank" rel="noopener">Открыть сайт ↗</a>`
      : "";
    const deploymentLink = status?.deployment?.url && summary.tone === "danger"
      ? `<a class="button button-ghost" href="${escapeHtml(status.deployment.url)}" target="_blank" rel="noopener">Подробности на GitHub</a>`
      : "";
    const publishForm = pending || dirty ? `
      ${dirty ? `<p class="publish-note">Есть несохранённые правки — они сохранятся и тоже будут опубликованы.</p>` : ""}
      <label class="field">
        <span>Что изменилось <small class="field-help">— необязательно, для истории</small></span>
        <input id="publish-message" maxlength="200" autocomplete="off" placeholder="Например: добавила новый проект с книгами" value="${escapeHtml(publishNote)}">
      </label>
      ${status?.last_error && !publishing ? `<p class="publish-error">${escapeHtml(status.last_error)}</p>` : ""}
      <div class="publish-actions">
        <button class="button button-primary button-large" type="button" data-publish-action="publish" ${publishing ? "disabled" : ""}>${publishing ? "Публикую…" : "Опубликовать на сайт"}</button>
        ${pending && status.change_count ? `<button class="button button-ghost" type="button" data-publish-action="discard" ${publishing ? "disabled" : ""}>Отменить неопубликованные правки…</button>` : ""}
      </div>` : "";

    publishContent.innerHTML = `
      <section class="card publish-status" data-tone="${summary.tone}">
        <div class="publish-status-heading">
          <span class="publish-status-dot" aria-hidden="true"></span>
          <div>
            <h2>${escapeHtml(summary.title)}</h2>
            ${summary.text ? `<p>${escapeHtml(summary.text)}</p>` : ""}
          </div>
        </div>
        ${changesList}
        ${publishForm}
        ${!pending && !dirty ? `<div class="publish-actions">${siteLink}${deploymentLink}<button class="button button-ghost" type="button" data-publish-action="refresh">Проверить ещё раз</button></div>` : ""}
      </section>
      ${renderHistoryCard()}
      ${renderTokenCard()}
      <section class="card">
        <div class="card-heading"><div><h2>Что-то пошло не так?</h2><p>Скопируйте отчёт и отправьте его тому, кто помогает с сайтом. В нём нет паролей.</p></div></div>
        <div class="publish-actions">
          <button class="button button-secondary" type="button" data-publish-action="help">Скопировать отчёт</button>
        </div>
        ${helpReport ? `<label class="field help-report"><span>Отчёт (если не скопировался — выделите и скопируйте вручную)</span><textarea readonly class="is-tall">${escapeHtml(helpReport)}</textarea></label>` : ""}
      </section>`;
    const refocus = focused && publishContent.querySelector(`#${focused.id}`);
    if (refocus) {
      refocus.focus();
      if (typeof focused.caret === "number") refocus.setSelectionRange?.(focused.caret, focused.caret);
    }
  }

  function renderHistoryCard() {
    const items = publishHistory?.history;
    let body;
    if (publishHistory?.error) body = `<p class="field-error">${escapeHtml(publishHistory.error)}</p>`;
    else if (!items) body = `<p class="field-help">Загружаю…</p>`;
    else if (!items.length) body = `<p class="field-help">Публикаций пока нет.</p>`;
    else {
      body = `<ol class="history-list">${items.slice(0, 25).map(item => `
        <li class="history-item">
          <div>
            <strong>${escapeHtml(item.subject)}</strong>
            <small>${escapeHtml(formatDate(item.date))} · ${item.mine ? "вы" : escapeHtml(item.author)}${item.technical ? " · техническое обновление" : ""}${item.published ? "" : " · ещё не на сайте"}</small>
          </div>
          ${item.can_undo ? `<button class="button button-ghost button-small" type="button" data-publish-action="undo" data-sha="${escapeHtml(item.sha)}">Отменить</button>` : ""}
        </li>`).join("")}</ol>`;
    }
    return `
      <section class="card">
        <div class="card-heading"><div><h2>История</h2><p>Каждую публикацию можно отменить — сайт вернётся к виду до неё. Саму отмену тоже можно отменить.</p></div></div>
        ${body}
      </section>`;
  }

  // Deleted projects, under the project list: they can be brought back.
  const projectTrash = document.querySelector("#project-trash");
  let trashItems = null;

  async function loadTrash() {
    try {
      trashItems = (await request("/api/trash")).trash;
    } catch {
      trashItems = [];
    }
    renderProjectTrash();
  }

  function renderProjectTrash() {
    if (!projectTrash) return;
    if (trashItems === null) {
      loadTrash();
      return;
    }
    projectTrash.innerHTML = trashItems.length ? `
      <details class="trash-list">
        <summary>Удалённые проекты <span class="badge">${trashItems.length}</span></summary>
        <p class="field-help">Можно вернуть. Обложки для главной потом нужно отметить ★ заново.</p>
        <ol>${trashItems.map(item => `
          <li>
            <div><strong>${escapeHtml(item.title)}</strong><small>удалён ${escapeHtml(formatDate(item.deleted))}</small></div>
            <button class="button button-secondary button-small" type="button" data-trash-restore="${escapeHtml(item.name)}">Вернуть</button>
          </li>`).join("")}</ol>
      </details>` : "";
  }

  projectTrash?.addEventListener("click", event => {
    const name = event.target.closest("[data-trash-restore]")?.dataset.trashRestore;
    if (name) restoreProject(name);
  });

  function renderTokenCard() {
    const token = publishStatus?.token ?? { state: "unknown" };
    const expires = token.expires ? new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" }).format(new Date(token.expires)) : "";
    const texts = {
      ok: expires ? `Ключ работает до ${expires}.` : "Ключ работает.",
      expiring: `Ключ перестанет работать ${expires} (осталось ${plural(token.days_left ?? 0, "день", "дня", "дней")}). Попросите новый у того, кто помогает с сайтом.`,
      invalid: "Ключ не подходит или истёк. Попросите новый у того, кто помогает с сайтом, и вставьте его сюда.",
      missing: "Компьютер не подключён к GitHub. Вставьте ключ доступа, который вам дали.",
      unknown: "Не удалось проверить ключ — возможно, нет интернета.",
    };
    const needsKey = ["expiring", "invalid", "missing"].includes(token.state);
    const form = `
      <div class="token-form">
        <label class="field">
          <span>Новый ключ</span>
          <input id="token-input" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" value="${escapeHtml(tokenDraft)}">
        </label>
        <button class="button button-primary" type="button" data-publish-action="token" ${tokenSaving ? "disabled" : ""}>${tokenSaving ? "Проверяю…" : "Сохранить ключ"}</button>
      </div>`;
    return `
      <section class="card token-card" data-tone="${needsKey ? (token.state === "expiring" ? "warning" : "danger") : "ok"}">
        <div class="card-heading"><div><h2>Доступ к GitHub</h2><p>${escapeHtml(texts[token.state] ?? texts.unknown)}</p></div></div>
        ${needsKey ? form : `<details data-token-details ${tokenFormOpen ? "open" : ""}><summary>Заменить ключ</summary>${form}</details>`}
      </section>`;
  }

  async function saveToken() {
    if (tokenSaving || !tokenDraft.trim()) return;
    tokenSaving = true;
    renderPublishView();
    try {
      publishStatus = await postJson("/api/publish/token", { token: tokenDraft });
      tokenDraft = "";
      tokenFormOpen = false;
      toast("Ключ сохранён — можно публиковать.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      tokenSaving = false;
      renderPublishPill();
      renderPublishView();
    }
  }

  async function reloadSiteState() {
    adoptState(await request("/api/state"));
    homeGalleryUndoStack = [];
    homeGalleryRedoStack = [];
    renderAll();
  }

  async function publishNow() {
    if (publishing) return;
    if (isDirty() && !(await saveAll())) return;
    publishing = true;
    renderPublishPill();
    renderPublishView();
    try {
      publishStatus = await postJson("/api/publish", { message: publishNote });
      publishNote = "";
      publishHistory = null;
      toast("Отправлено! Сайт обновится через 2–4 минуты.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      publishing = false;
      await refreshPublishStatus();
    }
  }

  async function undoPublication(sha) {
    const item = publishHistory?.history?.find(entry => entry.sha === sha);
    if (!item) return;
    if (isDirty() || publishStatus?.change_count) {
      toast("Сначала опубликуйте или отмените текущие правки.", true);
      return;
    }
    const accepted = await confirmAction({
      title: "Отменить публикацию?",
      message: `«${item.subject}» будет убрано с сайта: он вернётся к виду до этой публикации. Это сразу опубликуется.`,
      accept: "Отменить публикацию",
      danger: true,
    });
    if (!accepted) return;
    publishing = true;
    renderPublishView();
    try {
      publishStatus = await postJson("/api/publish/undo", { sha });
      await reloadSiteState();
      toast("Публикация отменена. Сайт обновится через 2–4 минуты.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      publishing = false;
      publishHistory = null;
      await refreshPublishStatus();
    }
  }

  async function discardUnpublished() {
    const accepted = await confirmAction({
      title: "Отменить неопубликованные правки?",
      message: "Конструктор вернётся к тому, что сейчас на сайте. На всякий случай копия правок останется на компьютере.",
      accept: "Отменить правки",
      danger: true,
    });
    if (!accepted) return;
    try {
      publishStatus = await postJson("/api/publish/discard", {});
      await reloadSiteState();
      toast("Неопубликованные правки отменены.");
    } catch (error) {
      toast(error.message, true);
    }
    await refreshPublishStatus();
  }

  async function restoreProject(name) {
    if (isDirty() && !(await saveAll())) return;
    try {
      adoptState(await postJson("/api/trash/restore", { name }));
      trashItems = null;
      renderAll();
      publishHistory = null;
      toast("Проект возвращён. Не забудьте опубликовать.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function copyHelpReport() {
    try {
      helpReport = (await request("/api/help-report")).report;
    } catch (error) {
      helpReport = `Не удалось собрать отчёт: ${error.message}`;
    }
    try {
      await navigator.clipboard.writeText(helpReport);
      toast("Отчёт скопирован — вставьте его в сообщение.");
    } catch {
      toast("Не получилось скопировать автоматически — скопируйте текст отчёта вручную.", true);
    }
    renderPublishView();
  }

  publishContent.addEventListener("input", event => {
    if (event.target.id === "publish-message") publishNote = event.target.value;
    if (event.target.id === "token-input") tokenDraft = event.target.value;
  });
  publishContent.addEventListener("toggle", event => {
    if (event.target.matches("[data-token-details]")) tokenFormOpen = event.target.open;
  }, true);
  publishContent.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.id === "token-input") saveToken();
  });
  publishContent.addEventListener("click", event => {
    const button = event.target.closest("[data-publish-action]");
    if (!button) return;
    const action = button.dataset.publishAction;
    if (action === "publish") publishNow();
    if (action === "discard") discardUnpublished();
    if (action === "undo") undoPublication(button.dataset.sha);
    if (action === "help") copyHelpReport();
    if (action === "token") saveToken();
    if (action === "refresh") {
      publishHistory = null;
      refreshPublishStatus({ fetch: true });
    }
  });
  window.addEventListener("focus", () => {
    if (Date.now() - lastFetchAt > 30000) refreshPublishStatus({ fetch: true });
  });

  // ---------------------------------------------------------------------------
  // Site health («Состояние сайта»): content checks from this computer, the
  // last publication on GitHub, and the live site (scripts/site_health.py).
  // ---------------------------------------------------------------------------
  const healthContent = document.querySelector("#health-content");
  const healthBadge = document.querySelector("#health-badge");
  let health = null;
  let liveChecking = false;
  let liveError = "";

  async function loadHealth() {
    try {
      health = await request("/api/health");
    } catch (error) {
      health = { error: error.message };
    }
    const warnings = health?.content?.warnings ?? 0;
    healthBadge.hidden = !warnings;
    healthBadge.textContent = String(warnings);
    updateTabMenu();
    if (currentView === "health") renderHealthView();
  }

  async function runLiveCheck() {
    liveChecking = true;
    liveError = "";
    renderHealthView();
    try {
      const live = await postJson("/api/health/live", {});
      health = { ...(health ?? {}), live };
    } catch (error) {
      liveError = error.message;
    }
    liveChecking = false;
    renderHealthView();
  }

  const HEALTH_MARKS = { ok: "✓", warning: "!", info: "i", danger: "✕" };

  function healthRow(level, title, text, extra = "") {
    return `<li class="health-row" data-level="${level}">
      <span class="health-mark" aria-hidden="true">${HEALTH_MARKS[level] ?? "•"}</span>
      <div><strong>${escapeHtml(title)}</strong>${text ? `<p>${escapeHtml(text)}</p>` : ""}${extra}</div>
    </li>`;
  }

  function renderContentCard() {
    const content = health?.content;
    let body;
    if (health?.error) body = `<p class="field-error">${escapeHtml(health.error)}</p>`;
    else if (!content) body = `<p class="field-help">Проверяю…</p>`;
    else {
      body = `<ul class="health-list">${content.checks.map(check => healthRow(check.level, check.title, check.summary,
        check.items.length ? `<ul class="health-items">${check.items.map(item => `
          <li><span>${escapeHtml(item.text)}</span>${item.slug || item.view
            ? `<button class="text-button" type="button" data-health-open="${escapeHtml(JSON.stringify({ slug: item.slug ?? "", view: item.view ?? "", anchor: item.anchor ?? "" }))}">Открыть</button>`
            : ""}</li>`).join("")}</ul>` : "")).join("")}</ul>`;
    }
    return `
      <section class="card">
        <div class="card-heading"><div><h2>Содержимое</h2><p>Проверяется то, что сохранено на этом компьютере. Несохранённые правки сначала сохраните.</p></div>
          <button class="button button-ghost button-small" type="button" data-health-action="reload">Проверить ещё раз</button></div>
        ${body}
      </section>`;
  }

  function renderPublicationCard() {
    const status = publishStatus;
    const deployment = status?.deployment ?? { state: "unknown" };
    const when = deployment.started ? ` (${formatDate(deployment.started)})` : "";
    const deployments = {
      live: ["ok", "Сайт обновлён", `Последняя публикация проверена и выложена${when}.`],
      deploying: ["info", "Идёт сборка", "GitHub проверяет и выкладывает последнюю публикацию — обычно пара минут."],
      pending: ["info", "Публикация отправлена", "GitHub вот-вот начнёт сборку."],
      failed: ["danger", "Последняя сборка не прошла", `Сайт показывает предыдущую версию${when}. Подробности — на GitHub; отчёт для помощи — на вкладке «Публикация».`],
      unknown: ["info", "Нет данных о сборке", "Нет связи с GitHub с этого компьютера (нужны интернет и GitHub CLI)."],
    };
    const [level, title, text] = deployments[deployment.state] ?? deployments.unknown;
    const token = status?.token ?? { state: "unknown" };
    const tokens = {
      ok: ["ok", token.days_left !== undefined ? `Ключ доступа действует ещё ${plural(token.days_left, "день", "дня", "дней")}` : "Ключ доступа работает"],
      expiring: ["warning", `Ключ доступа скоро истечёт: осталось ${plural(token.days_left ?? 0, "день", "дня", "дней")}`],
      invalid: ["danger", "Ключ доступа не подходит или истёк"],
      missing: ["danger", "Компьютер не подключён к GitHub"],
      unknown: ["info", "Ключ доступа проверить не удалось"],
    };
    const [tokenLevel, tokenTitle] = tokens[token.state] ?? tokens.unknown;
    const link = deployment.url ? `<a class="button button-ghost button-small" href="${escapeHtml(deployment.url)}" target="_blank" rel="noopener">Подробности на GitHub ↗</a>` : "";
    return `
      <section class="card">
        <div class="card-heading"><div><h2>Публикация</h2><p>Каждая публикация проходит на GitHub автоматическую проверку: тесты, проверку оформления и сборку сайта.</p></div>
          <button class="button button-ghost button-small" type="button" data-health-action="publish-status">Обновить</button></div>
        <ul class="health-list">
          ${healthRow(level, title, text, link ? `<div class="health-actions">${link}</div>` : "")}
          ${healthRow(tokenLevel, tokenTitle, tokenLevel === "ok" ? "" : "Новый ключ вставляется на вкладке «Публикация».")}
        </ul>
      </section>`;
  }

  function scoreChip(value) {
    if (value === null || value === undefined) return `<span class="score-chip">—</span>`;
    const tone = value >= 90 ? "ok" : value >= 50 ? "warning" : "danger";
    return `<span class="score-chip" data-tone="${tone}">${value}</span>`;
  }

  function renderLiveCard() {
    const live = health?.live;
    const siteUrl = live?.site_url ?? publishStatus?.site_url ?? "";
    let body = "";
    if (live) {
      const speedRows = [["mobile", "Телефон"], ["desktop", "Компьютер"]].map(([key, label]) => {
        const speed = live.speed?.[key] ?? {};
        if (speed.error) return `<tr><th scope="row">${label}</th><td colspan="5" class="field-error">${escapeHtml(speed.error)}</td></tr>`;
        return `<tr><th scope="row">${label}</th><td>${scoreChip(speed.performance)}</td><td>${scoreChip(speed.accessibility)}</td><td>${scoreChip(speed.best_practices)}</td><td>${scoreChip(speed.seo)}</td><td>${escapeHtml([speed.lcp, speed.cls].filter(Boolean).join(" · "))}</td></tr>`;
      }).join("");
      body = `
        <table class="speed-table">
          <thead><tr><th></th><th>Скорость</th><th>Доступность</th><th>Практики</th><th>SEO</th><th>Первая картинка · сдвиги</th></tr></thead>
          <tbody>${speedRows}</tbody>
        </table>
        <p class="field-help">Оценки Google от 0 до 100: зелёные — от 90. SEO 92 — это строка Content-Signal в robots.txt, запрет обучения ИИ; на поиск она не влияет. <a href="${escapeHtml(live.report_url)}" target="_blank" rel="noopener">Подробный отчёт Google ↗</a></p>
        <ul class="health-list">${(live.addresses ?? []).map(item => healthRow(item.ok ? "ok" : "danger", item.title, item.detail,
          `<div class="health-actions"><a class="text-button" href="${escapeHtml(live.site_url + item.path)}" target="_blank" rel="noopener">Открыть ↗</a></div>`)).join("")}</ul>
        <p class="field-help">Проверено ${escapeHtml(formatDate(live.checked_at))}.</p>`;
    } else if (!liveChecking) {
      body = `<p class="field-help">Ещё не проверялся с этого компьютера.</p>`;
    }
    return `
      <section class="card">
        <div class="card-heading"><div><h2>Живой сайт</h2><p>Скорость и SEO по оценке Google PageSpeed для телефона и компьютера, и главные адреса опубликованного сайта.</p></div>
          <button class="button button-secondary button-small" type="button" data-health-action="live" ${liveChecking ? "disabled" : ""}>${liveChecking ? "Проверяю… около минуты" : "Проверить сейчас"}</button></div>
        ${liveError ? `<p class="publish-error">${escapeHtml(liveError)}</p>` : ""}
        ${body}
        ${renderPageSpeedKey(live)}
      </section>
      <section class="card">
        <div class="card-heading"><div><h2>Подробнее у Google и Bing</h2><p>Здесь нужен вход в аккаунт, поэтому эти данные смотрятся на их сайтах.</p></div></div>
        <ul class="health-links">
          <li><a href="https://search.google.com/search-console?resource_id=${encodeURIComponent(siteUrl)}" target="_blank" rel="noopener">Google Search Console ↗</a> — по каким запросам находят сайт, какие страницы в поиске, ошибки.</li>
          <li><a href="https://analytics.google.com/" target="_blank" rel="noopener">Google Analytics ↗</a> — сколько посетителей, откуда они и что смотрят.</li>
          <li><a href="https://www.bing.com/webmasters" target="_blank" rel="noopener">Bing Webmaster Tools ↗</a> — то же для Bing, DuckDuckGo и поиска ChatGPT.</li>
        </ul>
      </section>`;
  }

  function renderPageSpeedKey(live) {
    const hasKey = Boolean(health?.has_pagespeed_key);
    const quotaHit = Object.values(live?.speed ?? {}).some(speed => speed?.quota);
    return `
      <details class="pagespeed-key" ${quotaHit && !hasKey ? "open" : ""}>
        <summary>Ключ Google PageSpeed — ${hasKey ? "добавлен" : "необязательно"}</summary>
        <p class="field-help">Без ключа проверка идёт через общий бесплатный лимит Google, и он часто заканчивается. Свой ключ бесплатный: <a href="https://developers.google.com/speed/docs/insights/v5/get-started#APIKey" target="_blank" rel="noopener">получить ключ ↗</a> (кнопка «Get a Key», нужен Google-аккаунт). Ключ хранится только на этом компьютере и на сайт не попадает.</p>
        <div class="token-form">
          <label class="field"><span>Ключ</span><input id="pagespeed-key" type="password" autocomplete="off" spellcheck="false" placeholder="${hasKey ? "Сохранён — вставьте новый, чтобы заменить" : "AIza…"}"></label>
          <div class="publish-actions">
            <button class="button button-secondary button-small" type="button" data-health-action="save-key">Сохранить ключ</button>
            ${hasKey ? `<button class="button button-ghost button-small" type="button" data-health-action="remove-key">Удалить ключ</button>` : ""}
          </div>
        </div>
      </details>`;
  }

  async function savePageSpeedKey(key) {
    try {
      const result = await postJson("/api/health/key", { key });
      health = { ...(health ?? {}), has_pagespeed_key: result.has_pagespeed_key };
      toast(result.has_pagespeed_key ? "Ключ сохранён. Нажмите «Проверить сейчас»." : "Ключ удалён.");
      renderHealthView();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderHealthView() {
    if (!healthContent) return;
    healthContent.innerHTML = renderContentCard() + renderPublicationCard() + renderLiveCard();
  }

  healthContent?.addEventListener("click", event => {
    const action = event.target.closest("[data-health-action]")?.dataset.healthAction;
    if (action === "reload") loadHealth();
    if (action === "publish-status") refreshPublishStatus({ fetch: true });
    if (action === "live") runLiveCheck();
    if (action === "save-key") savePageSpeedKey(healthContent.querySelector("#pagespeed-key")?.value ?? "");
    if (action === "remove-key") savePageSpeedKey("");
    const target = event.target.closest("[data-health-open]");
    if (!target) return;
    const { slug, view, anchor } = JSON.parse(target.dataset.healthOpen);
    if (slug) {
      selectedImageIndex = -1;
      navigate("projects", slug);
      if (anchor === "unlisted") requestAnimationFrame(() => projectEditor.querySelector(".unlisted-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (view) {
      navigate(view);
    }
  });

  // ---------------------------------------------------------------------------
  // Tabs that do not fit fold into the «Меню» button
  // ---------------------------------------------------------------------------
  const topbar = document.querySelector(".topbar");
  const tabsNav = topbar.querySelector(".tabs");
  const tabMenuButton = document.querySelector("#tab-menu-button");
  const tabMenuList = document.querySelector("#tab-menu-list");

  function fitTabs() {
    // Measure with the tabs shown; nothing is painted in between.
    topbar.classList.remove("tabs-collapsed");
    const collapse = topbar.scrollWidth > topbar.clientWidth + 1;
    topbar.classList.toggle("tabs-collapsed", collapse);
    if (!collapse) closeTabMenu();
  }

  function updateTabMenu() {
    const current = tabsNav.querySelector(".tab[aria-current]");
    tabMenuButton.querySelector(".tab-menu-current").textContent = current?.firstChild?.textContent.trim() ?? "";
    tabMenuButton.querySelector(".tab-menu-dot").hidden = healthBadge?.hidden ?? true;
    if (!tabMenuList.hidden) tabMenuList.innerHTML = tabsNav.innerHTML.replace(/ id="health-badge"/, "");
  }

  function openTabMenu() {
    tabMenuList.innerHTML = tabsNav.innerHTML.replace(/ id="health-badge"/, "");
    tabMenuList.hidden = false;
    tabMenuButton.setAttribute("aria-expanded", "true");
    tabMenuList.querySelector(".tab[aria-current]")?.focus();
  }

  function closeTabMenu() {
    if (tabMenuList.hidden) return;
    tabMenuList.hidden = true;
    tabMenuButton.setAttribute("aria-expanded", "false");
  }

  tabMenuButton.addEventListener("click", () => (tabMenuList.hidden ? openTabMenu() : closeTabMenu()));
  tabMenuList.addEventListener("click", event => {
    if (event.target.closest(".tab")) closeTabMenu();
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".tab-menu")) closeTabMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !tabMenuList.hidden) {
      closeTabMenu();
      tabMenuButton.focus();
    }
  });
  // The bar's contents change width (the status pill, the badge), so watch them all.
  const tabsObserver = new ResizeObserver(() => fitTabs());
  [topbar, publishPill, tabsNav].forEach(element => tabsObserver.observe(element));
  fitTabs();

  // ---------------------------------------------------------------------------
  // Global wiring
  // ---------------------------------------------------------------------------
  window.addEventListener("hashchange", routeFromHash);
  window.addEventListener("popstate", routeFromHash);
  saveButton.addEventListener("click", saveAll);
  discardButton.addEventListener("click", discardAll);
  previewButton.addEventListener("click", previewSite);

  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveAll();
    }
  });

  window.addEventListener("beforeunload", event => {
    if (work && isDirty()) event.preventDefault();
  });

  request("/api/state")
    .then(state => {
      if (!state?.config || !Array.isArray(state.projects)) throw new Error("Сервер вернул неполные данные сайта.");
      adoptState(state);
      renderSettings();
      routeFromHash();
      refreshDirty();
      window.setInterval(checkServerFreshness, 5000);
      refreshPublishStatus({ fetch: true });
      loadHealth();
    })
    .catch(error => {
      toast(error.message, true);
      projectEditor.innerHTML = `<div class="empty-state"><h2>Не удалось загрузить сайт</h2><p>${escapeHtml(error.message)}</p></div>`;
      views.projects.hidden = false;
    });
})();
