(() => {
  const flash = document.querySelector("#flash");
  const settingsFields = document.querySelector("#settings-fields");
  const projectList = document.querySelector("#project-list");
  const projectEditor = document.querySelector("#project-editor");
  const projectCount = document.querySelector("#project-count");
  const saveSettingsButton = document.querySelector("#save-settings");
  const buildPreviewButton = document.querySelector("#build-preview");
  const openPreviewLink = document.querySelector("#open-preview");
  const coverPreview = document.querySelector("#cover-preview");
  const previewTitle = document.querySelector("#preview-title");
  const previewCovers = document.querySelector("#preview-covers");
  let state;
  let selectedSlug = "";
  let configDirty = false;
  let projectDirty = false;
  let dragSource = null;
  let flashTimer;

  const friendlyNames = {
    analytics: "Аналитика",
    artist: "Информация об авторе",
    bio: "Биография",
    copyright_year: "Год копирайта",
    description: "Описание",
    email: "Электронная почта",
    full_name: "Полное имя",
    gap: "Расстояние между изображениями",
    home_gallery: "Главная галерея",
    measurement_id: "ID Google Analytics",
    name: "Имя автора",
    portrait: "Портрет",
    portrait_alt: "Alt-текст портрета",
    single_page: "Одностраничный режим",
    compact: "Компактная раскладка обложек",
    title: "Заголовок сайта",
    linkedin_url: "Ссылка на LinkedIn",
    instagram_url: "Ссылка на Instagram",
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function labelFor(key) {
    return friendlyNames[key] ?? key.replaceAll("_", " ").replace(/^\w/, letter => letter.toUpperCase());
  }

  function showFlash(message, isError = false) {
    window.clearTimeout(flashTimer);
    flash.textContent = message;
    flash.hidden = false;
    flash.classList.toggle("is-error", isError);
    flashTimer = window.setTimeout(() => {
      flash.hidden = true;
    }, isError ? 7000 : 4000);
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error(`Не удалось связаться с локальным конструктором: ${error.message}`);
    }

    const responseType = response.headers.get("content-type") ?? "";
    const result = responseType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      throw new Error(result?.error ?? `Ошибка запроса (${response.status}).`);
    }
    return result;
  }

  function jsonOptions(body) {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  function renderFields(object, path, excluded = new Set()) {
    return Object.entries(object)
      .filter(([key]) => !excluded.has(key))
      .map(([key, value]) => {
        const currentPath = [...path, key];
        const pathAttribute = `data-path="${escapeHtml(JSON.stringify(currentPath))}"`;
        const label = escapeHtml(labelFor(key));

        if (value && typeof value === "object" && !Array.isArray(value)) {
          return `<fieldset class="nested"><legend>${label}</legend>${renderFields(value, currentPath)}</fieldset>`;
        }
        if (typeof value === "boolean") {
          return `<label class="field-check"><input type="checkbox" ${pathAttribute} ${value ? "checked" : ""}><span>${label}</span></label>`;
        }
        if (Array.isArray(value)) {
          return `<label class="field"><span>${label} <small class="field-help">JSON</small></span><textarea ${pathAttribute} data-kind="json" spellcheck="false">${escapeHtml(JSON.stringify(value, null, 2))}</textarea></label>`;
        }
        const fieldValue = value === null || value === undefined ? "" : String(value);
        const multiline = ["bio", "description"].includes(key) || fieldValue.includes("\n");
        const field = multiline
          ? `<textarea ${pathAttribute}>${escapeHtml(fieldValue)}</textarea>`
          : `<input ${pathAttribute} type="${typeof value === "number" ? "number" : "text"}" value="${escapeHtml(fieldValue)}">`;
        return `<label class="field"><span>${label}</span>${field}</label>`;
      })
      .join("");
  }

  function updatePath(object, path, value) {
    const parent = path.slice(0, -1).reduce((current, key) => current[key], object);
    parent[path.at(-1)] = value;
  }

  function fieldValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.dataset.kind === "json") {
      try {
        return JSON.parse(input.value);
      } catch {
        throw new Error("Проверьте синтаксис JSON в поле со списком.");
      }
    }
    if (input.type === "number") {
      const number = Number(input.value);
      if (!Number.isFinite(number)) throw new Error("Укажите корректное число.");
      return number;
    }
    return input.value;
  }

  function renderSettings() {
    settingsFields.innerHTML = renderFields(state.config, []);
    saveSettingsButton.disabled = !configDirty;
  }

  function renderProjectList() {
    projectCount.textContent = String(state.projects.length);
    projectList.innerHTML = state.projects.map(project => {
      const isSelected = project.slug === selectedSlug;
      const coverCount = (project.metadata.images ?? []).filter(image => image.cover === true).length;
      const coverForms = {
        one: "обложка",
        few: "обложки",
        many: "обложек",
        other: "обложки",
      };
      const coverLabel = coverForms[new Intl.PluralRules("ru").select(coverCount)];
      return `<button type="button" class="project-choice${isSelected ? " is-selected" : ""}" data-select-project="${escapeHtml(project.slug)}">
        <strong>${escapeHtml(project.metadata.title ?? project.slug)}</strong>
        <small>${coverCount} ${coverLabel} · /projects/${escapeHtml(project.slug)}/</small>
      </button>`;
    }).join("");
  }

  function projectBySlug(slug = selectedSlug) {
    return state.projects.find(project => project.slug === slug);
  }

  function sortedCoverEntries(project) {
    return project.metadata.images
      .map((image, index) => ({ image, index }))
      .filter(entry => entry.image.cover === true)
      .sort((left, right) => {
        const leftOrder = Number(left.image.gallery_order) || 0;
        const rightOrder = Number(right.image.gallery_order) || 0;
        return rightOrder - leftOrder || left.index - right.index;
      });
  }

  function normalizeCoverOrders(project) {
    const covers = sortedCoverEntries(project);
    covers.forEach(({ image }, index) => {
      image.gallery_order = covers.length - index;
    });
  }

  function renderImageCard(project, image, index) {
    const customValues = Object.fromEntries(
      Object.entries(image).filter(([key]) => ![
        "file",
        "alt",
        "caption",
        "cover",
        "gallery_order",
      ].includes(key)),
    );
    const coverEntries = sortedCoverEntries(project);
    const coverPosition = coverEntries.findIndex(entry => entry.index === index);
    const imageUrl = `/api/projects/${encodeURIComponent(selectedSlug)}/images/${encodeURIComponent(image.file)}`;
    const dragAttributes = image.cover === true
      ? 'draggable="true" data-draggable-cover="true"'
      : "";

    return `<article class="image-card" data-image-index="${index}" ${dragAttributes}>
      <div class="image-preview">${project.files.includes(image.file)
        ? `<img src="${imageUrl}" alt="" loading="lazy">`
        : `<span>Файл не найден</span>`}</div>
      <div class="image-card-body">
        <div class="image-card-title">
          <strong title="${escapeHtml(image.file)}">${escapeHtml(image.file)}</strong>
          ${image.cover === true ? '<span class="cover-pill">ОБЛОЖКА</span>' : ""}
        </div>
        <label class="field"><span>Alt-текст</span><textarea data-path="${escapeHtml(JSON.stringify(["metadata", "images", index, "alt"]))}">${escapeHtml(image.alt ?? "")}</textarea></label>
        <label class="field"><span>Подпись</span><textarea data-path="${escapeHtml(JSON.stringify(["metadata", "images", index, "caption"]))}">${escapeHtml(image.caption ?? "")}</textarea></label>
        <label class="field-check"><input type="checkbox" data-path="${escapeHtml(JSON.stringify(["metadata", "images", index, "cover"]))}" ${image.cover === true ? "checked" : ""}><span>Использовать как обложку</span></label>
        ${image.cover === true ? `<div class="cover-controls">
          <label class="field"><span>Порядок</span><input type="number" min="1" step="1" data-path="${escapeHtml(JSON.stringify(["metadata", "images", index, "gallery_order"]))}" value="${escapeHtml(image.gallery_order ?? coverEntries.length - coverPosition)}"></label>
          <button type="button" class="move-cover" data-action="move-cover-up" data-index="${index}" aria-label="Переместить выше" title="Переместить выше" ${coverPosition === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="move-cover" data-action="move-cover-down" data-index="${index}" aria-label="Переместить ниже" title="Переместить ниже" ${coverPosition === coverEntries.length - 1 ? "disabled" : ""}>↓</button>
        </div>` : ""}
        <details><summary>Дополнительные параметры</summary><div class="extra-image-fields">${renderFields(customValues, ["metadata", "images", index])}</div></details>
        <div class="image-actions"><span class="field-help">${image.cover === true ? "Можно перетаскивать обложки для изменения порядка." : "Файл останется в папке проекта."}</span><button type="button" class="remove-image" data-action="remove-image" data-index="${index}">Убрать из галереи</button></div>
      </div>
    </article>`;
  }

  function renderProject() {
    const project = projectBySlug();
    if (!project) {
      projectEditor.innerHTML = `<div class="empty-state"><span class="empty-icon">✳</span><h2>Выберите проект</h2><p>Или создайте новый — он появится в списке слева.</p></div>`;
      renderProjectList();
      return;
    }

    const metadata = { ...project.metadata };
    delete metadata.images;
    delete metadata.layout;
    const images = project.metadata.images ?? [];
    projectEditor.innerHTML = `
      <section class="editor-section">
        <div class="editor-section-heading">
          <div><p class="eyebrow">ПРОЕКТ</p><h2>${escapeHtml(project.metadata.title)}</h2></div>
          <span class="field-help">${escapeHtml(project.metadata.permalink ?? `/projects/${project.slug}/`)}</span>
        </div>
        <div class="editor-fields">${renderFields(metadata, ["metadata"])}</div>
        <label class="field content-field"><span>Описание проекта · Markdown</span><textarea data-content="true" placeholder="Текст под заголовком проекта">${escapeHtml(project.content)}</textarea></label>
      </section>
      <section class="editor-section">
        <div class="editor-section-heading">
          <div><p class="eyebrow">ИЗОБРАЖЕНИЯ</p><h2>Галерея проекта</h2><p>Перетаскивайте карточки-обложки или используйте стрелки, чтобы изменить порядок на главной.</p></div>
        </div>
        <div class="image-toolbar">
          <input id="image-upload" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" multiple>
          <button class="button button-secondary" type="button" data-action="upload-images">Загрузить изображения</button>
          <p>Поддерживаются JPG, PNG, WebP и GIF, до 30 МБ на изображение. Загруженные оригиналы сохраняются в папке проекта.</p>
        </div>
        <div class="image-grid">${images.map((image, index) => renderImageCard(project, image, index)).join("") || '<p class="field-help">Пока нет изображений. Загрузите файлы, чтобы добавить их в галерею.</p>'}</div>
      </section>
      <footer class="editor-footer">
        <button class="button button-quiet" type="button" data-action="preview-covers">Предпросмотр обложек</button>
        <button class="button button-quiet" type="button" data-action="reload-project">Отменить несохранённые изменения</button>
        <button class="button button-primary" type="button" data-action="save-project" ${projectDirty ? "" : "disabled"}>Сохранить проект</button>
      </footer>`;
    renderProjectList();
  }

  function setProjectDirty() {
    projectDirty = true;
    const saveButton = projectEditor.querySelector('[data-action="save-project"]');
    if (saveButton) saveButton.disabled = false;
  }

  function reorderCovers(sourceIndex, targetIndex) {
    const project = projectBySlug();
    const covers = sortedCoverEntries(project);
    const sourcePosition = covers.findIndex(entry => entry.index === sourceIndex);
    const targetPosition = covers.findIndex(entry => entry.index === targetIndex);
    if (sourcePosition < 0 || targetPosition < 0 || sourcePosition === targetPosition) return;
    const [moved] = covers.splice(sourcePosition, 1);
    covers.splice(targetPosition, 0, moved);
    covers.forEach(({ image }, index) => {
      image.gallery_order = covers.length - index;
    });
    setProjectDirty();
    renderProject();
  }

  async function saveProject() {
    const project = projectBySlug();
    if (!project) return;
    normalizeCoverOrders(project);
    await request(`/api/projects/${encodeURIComponent(selectedSlug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: project.metadata, content: project.content }),
    });
    projectDirty = false;
    renderProject();
    showFlash("Проект сохранён.");
  }

  async function uploadImages() {
    const project = projectBySlug();
    const input = projectEditor.querySelector("#image-upload");
    const files = [...(input?.files ?? [])];
    if (!project || !files.length) {
      showFlash("Сначала выберите изображения для загрузки.", true);
      return;
    }

    for (const file of files) {
      const url = `/api/projects/${encodeURIComponent(selectedSlug)}/images/${encodeURIComponent(file.name)}`;
      await request(url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      project.files.push(file.name);
      project.metadata.images.push({
        file: file.name,
        alt: file.name.replace(/\.[^.]+$/, "").replaceAll("-", " "),
      });
      setProjectDirty();
    }
    await saveProject();
    showFlash(`Загружено изображений: ${files.length}.`);
  }

  function showCoverPreview() {
    const project = projectBySlug();
    if (!project) return;
    previewTitle.textContent = project.metadata.title;
    const covers = sortedCoverEntries(project);
    previewCovers.innerHTML = covers.map(({ image }) => {
      const imageUrl = `/api/projects/${encodeURIComponent(selectedSlug)}/images/${encodeURIComponent(image.file)}`;
      const caption = image.caption || project.metadata.title;
      return `<article class="preview-cover">
        <img src="${imageUrl}" alt="${escapeHtml(image.alt ?? "")}">
        <p>${escapeHtml(caption)}</p>
        <small>${escapeHtml(image.file)}</small>
      </article>`;
    }).join("") || '<p class="field-help">Отметьте хотя бы одно изображение как обложку.</p>';
    coverPreview.showModal();
  }

  async function buildPreview() {
    if (configDirty || projectDirty) {
      showFlash("Сначала сохраните изменённые настройки и проект.", true);
      return;
    }

    buildPreviewButton.disabled = true;
    buildPreviewButton.textContent = "Собираю сайт…";
    openPreviewLink.hidden = true;
    try {
      const result = await request("/api/build", jsonOptions({}));
      openPreviewLink.dataset.url = result.preview_url;
      openPreviewLink.hidden = false;
      showFlash("Предпросмотр собран. Откройте его по кнопке вверху.");
    } catch (error) {
      showFlash(error.message, true);
    } finally {
      buildPreviewButton.disabled = false;
      buildPreviewButton.textContent = "Собрать предпросмотр";
    }
  }

  async function loadState() {
    state = await request("/api/state");
    if (!state.config || !Array.isArray(state.projects)) {
      throw new Error("Сервер вернул неполные данные сайта.");
    }
    renderSettings();
    renderProject();
  }

  document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("is-active", tab === button));
      document.querySelector("#settings-view").hidden = button.dataset.view !== "settings";
      document.querySelector("#projects-view").hidden = button.dataset.view !== "projects";
    });
  });

  settingsFields.addEventListener("change", event => {
    const input = event.target.closest("[data-path]");
    if (!input) return;
    try {
      updatePath(state.config, JSON.parse(input.dataset.path), fieldValue(input));
      configDirty = true;
      saveSettingsButton.disabled = false;
    } catch (error) {
      showFlash(error.message, true);
    }
  });

  saveSettingsButton.addEventListener("click", async () => {
    saveSettingsButton.disabled = true;
    try {
      await request("/api/config", jsonOptions({ config: state.config }));
      configDirty = false;
      renderSettings();
      showFlash("Настройки сохранены в _config.yml.");
    } catch (error) {
      saveSettingsButton.disabled = false;
      showFlash(error.message, true);
    }
  });

  buildPreviewButton.addEventListener("click", buildPreview);
  openPreviewLink.addEventListener("click", () => {
    window.open(openPreviewLink.dataset.url, "_blank", "noopener");
  });
  document.querySelector("#close-cover-preview").addEventListener("click", () => coverPreview.close());
  coverPreview.addEventListener("click", event => {
    if (event.target === coverPreview) coverPreview.close();
  });

  projectList.addEventListener("click", event => {
    const button = event.target.closest("[data-select-project]");
    if (!button || button.dataset.selectProject === selectedSlug) return;
    if (projectDirty && !window.confirm("В проекте есть несохранённые изменения. Переключиться без сохранения?")) return;
    selectedSlug = button.dataset.selectProject;
    projectDirty = false;
    renderProject();
  });

  document.querySelector("#new-project-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const project = await request("/api/projects", jsonOptions({
        title: formData.get("title"),
        slug: formData.get("slug"),
      }));
      state.projects.push(project);
      state.projects.sort((left, right) => left.metadata.title.localeCompare(right.metadata.title));
      selectedSlug = project.slug;
      projectDirty = false;
      form.reset();
      renderProject();
      showFlash("Проект создан. Добавьте изображения и сохраните его.");
    } catch (error) {
      showFlash(error.message, true);
    }
  });

  projectEditor.addEventListener("change", event => {
    const input = event.target.closest("[data-path]");
    const project = projectBySlug();
    if (!input || !project) return;

    try {
      const path = JSON.parse(input.dataset.path);
      updatePath(project, path, fieldValue(input));
      setProjectDirty();
      renderProjectList();
      if (path.at(-1) === "title") {
        const heading = projectEditor.querySelector(".editor-section-heading h2");
        if (heading) heading.textContent = project.metadata.title;
      }
      if (path.at(-1) === "cover") renderProject();
    } catch (error) {
      showFlash(error.message, true);
    }
  });

  projectEditor.addEventListener("input", event => {
    const input = event.target.closest("[data-content]");
    const project = projectBySlug();
    if (!input || !project) return;
    project.content = input.value;
    setProjectDirty();
  });

  projectEditor.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const project = projectBySlug();
    if (!project) return;

    try {
      if (button.dataset.action === "preview-covers") {
        showCoverPreview();
      } else if (button.dataset.action === "save-project") {
        button.disabled = true;
        await saveProject();
      } else if (button.dataset.action === "reload-project") {
        if (!window.confirm("Отменить все несохранённые изменения проекта?")) return;
        const freshState = await request("/api/state");
        state.projects = freshState.projects;
        projectDirty = false;
        renderProject();
        showFlash("Несохранённые изменения отменены.");
      } else if (button.dataset.action === "remove-image") {
        const index = Number(button.dataset.index);
        project.metadata.images.splice(index, 1);
        setProjectDirty();
        renderProject();
      } else if (button.dataset.action === "move-cover-up" || button.dataset.action === "move-cover-down") {
        const covers = sortedCoverEntries(project);
        const index = Number(button.dataset.index);
        const position = covers.findIndex(entry => entry.index === index);
        const nextPosition = position + (button.dataset.action === "move-cover-up" ? -1 : 1);
        if (covers[nextPosition]) reorderCovers(index, covers[nextPosition].index);
      } else if (button.dataset.action === "upload-images") {
        button.disabled = true;
        await uploadImages();
      }
    } catch (error) {
      showFlash(error.message, true);
      renderProject();
    }
  });

  projectEditor.addEventListener("dragstart", event => {
    const card = event.target.closest('[data-draggable-cover="true"]');
    if (!card) return;
    dragSource = Number(card.dataset.imageIndex);
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(dragSource));
  });
  projectEditor.addEventListener("dragend", event => {
    event.target.closest(".image-card")?.classList.remove("is-dragging");
    projectEditor.querySelectorAll(".is-drop-target").forEach(card => card.classList.remove("is-drop-target"));
    dragSource = null;
  });
  projectEditor.addEventListener("dragover", event => {
    const card = event.target.closest('[data-draggable-cover="true"]');
    if (!card || dragSource === null) return;
    event.preventDefault();
    card.classList.add("is-drop-target");
  });
  projectEditor.addEventListener("dragleave", event => {
    event.target.closest(".image-card")?.classList.remove("is-drop-target");
  });
  projectEditor.addEventListener("drop", event => {
    const card = event.target.closest('[data-draggable-cover="true"]');
    if (!card || dragSource === null) return;
    event.preventDefault();
    reorderCovers(dragSource, Number(card.dataset.imageIndex));
  });

  loadState().catch(error => {
    showFlash(error.message, true);
    projectEditor.innerHTML = `<div class="empty-state"><h2>Не удалось загрузить сайт</h2><p>${escapeHtml(error.message)}</p></div>`;
  });
})();
