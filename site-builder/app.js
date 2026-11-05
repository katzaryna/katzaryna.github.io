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
  const homeGalleryDialog = document.querySelector("#home-gallery-editor");
  const homeGalleryBoard = document.querySelector("#home-gallery-board");
  const homeGalleryViewport = document.querySelector("#home-gallery-viewport");
  const homeGalleryCanvas = document.querySelector("#home-gallery-canvas");
  let homeGalleryGuides = document.querySelector("#home-gallery-guides");
  const homeGalleryControls = document.querySelector("#home-gallery-controls");
  const saveHomeGalleryButton = document.querySelector("#save-home-gallery");
  const homeGalleryZoomLevel = document.querySelector("#home-gallery-zoom-level");
  const HOME_GALLERY_SWAP_HOVER_MS = 250;
  const HOME_GALLERY_HISTORY_LIMIT = 50;
  let state;
  let selectedSlug = "";
  let configDirty = false;
  let projectDirty = false;
  let homeGalleryCovers = [];
  let selectedHomeCover = "";
  let homeGalleryPointerDrag = null;
  let homeGalleryResizeMode = "free";
  let homeGallerySnapEnabled = false;
  let homeGallerySnapStep = 20;
  let homeGalleryMagnetEnabled = true;
  let homeGalleryUndoStack = [];
  let homeGalleryRedoStack = [];
  let homeGalleryZoom = 1;
  let homeGalleryPanEnabled = false;
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
          return `<fieldset class="nested"><legend>${label}</legend>${renderFields(value, currentPath, excluded)}</fieldset>`;
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
    settingsFields.innerHTML = renderFields(state.config, [], new Set(["covers"]));
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
    const imageUrl = `/api/projects/${encodeURIComponent(selectedSlug)}/images/${encodeURIComponent(image.file)}`;

    return `<article class="image-card" data-image-index="${index}">
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
        <details><summary>Дополнительные параметры</summary><div class="extra-image-fields">${renderFields(customValues, ["metadata", "images", index])}</div></details>
        <div class="image-actions"><span class="field-help">${image.cover === true ? "Порядок, размер и кадрирование — в настройке главной." : "Файл останется в папке проекта."}</span><button type="button" class="remove-image" data-action="remove-image" data-index="${index}">Убрать из галереи</button></div>
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
          <div><p class="eyebrow">ИЗОБРАЖЕНИЯ</p><h2>Галерея проекта</h2><p>Выберите изображения, которые будут показаны на главной странице.</p></div>
        </div>
        <div class="image-toolbar">
          <input id="image-upload" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" multiple>
          <button class="button button-secondary" type="button" data-action="upload-images">Загрузить изображения</button>
          <p>JPG, PNG, WebP и GIF до 30 МБ автоматически сохраняются как WebP с сохранением встроенного цветового профиля; длинная сторона — не более 2560 px. Анимация GIF сохраняется.</p>
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

  async function saveProject() {
    const project = projectBySlug();
    if (!project) return;
    const result = await request(`/api/projects/${encodeURIComponent(selectedSlug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: project.metadata, content: project.content }),
    });
    state.config.home_gallery.covers = result.covers;
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
      const result = await request(url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      project.files.push(result.file);
      project.metadata.images.push({
        file: result.file,
        alt: result.file.replace(/\.[^.]+$/, "").replaceAll("-", " "),
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
    const covers = (project.metadata.images ?? []).filter(image => image.cover === true);
    previewCovers.innerHTML = covers.map(image => {
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

  function homeCoverId(cover) {
    return `${cover.project}/${cover.file}`;
  }

  function homeCoverLayout(cover) {
    const { x, y, width, height } = cover;
    return { x, y, width, height };
  }

  function homeGalleryRowCount() {
    return Math.max(12, ...homeGalleryCovers.map(cover => {
      const { y, height } = homeCoverLayout(cover);
      return Math.ceil(y + height);
    }));
  }

  function updateHomeGalleryHistoryButtons() {
    homeGalleryBoard.querySelector('[data-gallery-action="undo"]').disabled = homeGalleryUndoStack.length === 0;
    homeGalleryBoard.querySelector('[data-gallery-action="redo"]').disabled = homeGalleryRedoStack.length === 0;
  }

  function recordHomeGalleryChange(before) {
    if (JSON.stringify(before) === JSON.stringify(homeGalleryCovers)) return;
    homeGalleryUndoStack.push(before);
    if (homeGalleryUndoStack.length > HOME_GALLERY_HISTORY_LIMIT) homeGalleryUndoStack.shift();
    homeGalleryRedoStack = [];
    updateHomeGalleryHistoryButtons();
  }

  function restoreHomeGalleryHistory(from, to) {
    if (!from.length) return;
    to.push(structuredClone(homeGalleryCovers));
    homeGalleryCovers = from.pop();
    renderHomeGalleryEditor();
    updateHomeGalleryHistoryButtons();
  }

  function setHomeGalleryZoom(zoom, fit = false) {
    const minZoom = 0.25;
    const maxZoom = 2;
    const viewportWidth = homeGalleryViewport.clientWidth;
    const viewportHeight = homeGalleryViewport.clientHeight;
    if (!viewportWidth || !viewportHeight) return;
    const oldRect = homeGalleryCanvas.getBoundingClientRect();
    const oldWidth = oldRect.width;
    const oldHeight = oldRect.height;
    let nextZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    if (fit) {
      const rowCount = homeGalleryRowCount();
      nextZoom = Math.min(1, viewportHeight * 12 / (viewportWidth * rowCount));
      nextZoom = Math.max(minZoom, nextZoom);
    }
    const centerX = oldWidth ? (homeGalleryViewport.scrollLeft + viewportWidth / 2) / oldWidth : 0.5;
    const centerY = oldHeight ? (homeGalleryViewport.scrollTop + viewportHeight / 2) / oldHeight : 0.5;
    homeGalleryZoom = nextZoom;
    homeGalleryCanvas.style.width = `${viewportWidth * homeGalleryZoom}px`;
    homeGalleryCanvas.style.aspectRatio = `12 / ${homeGalleryRowCount()}`;
    homeGalleryZoomLevel.textContent = `${Math.round(homeGalleryZoom * 100)}%`;
    requestAnimationFrame(() => {
      const newRect = homeGalleryCanvas.getBoundingClientRect();
      homeGalleryViewport.scrollLeft = Math.max(0, centerX * newRect.width - viewportWidth / 2);
      homeGalleryViewport.scrollTop = Math.max(0, centerY * newRect.height - viewportHeight / 2);
    });
  }

  function updateHomeGalleryGuides(candidate, others) {
    if (!candidate || !others.length) {
      homeGalleryGuides.replaceChildren();
      return;
    }
    const rowCount = homeGalleryRowCount();
    const canvasWidth = homeGalleryCanvas.clientWidth;
    const canvasHeight = homeGalleryCanvas.clientHeight;
    const xScale = canvasWidth / 12;
    const yScale = canvasHeight / rowCount;
    const xLines = new Set();
    const yLines = new Set();
    const labels = [];
    const addLine = (lines, value) => {
      const rounded = Math.round(value * 10000) / 10000;
      lines.add(rounded);
    };
    for (const other of others) {
      const xPositions = [candidate.x, candidate.x + candidate.width, candidate.x + candidate.width / 2];
      const otherXPositions = [other.x, other.x + other.width, other.x + other.width / 2];
      for (const x of xPositions) {
        for (const otherX of otherXPositions) {
          if (Math.abs(x - otherX) * xScale <= 8) addLine(xLines, otherX);
        }
      }
      const yPositions = [candidate.y, candidate.y + candidate.height, candidate.y + candidate.height / 2];
      const otherYPositions = [other.y, other.y + other.height, other.y + other.height / 2];
      for (const y of yPositions) {
        for (const otherY of otherYPositions) {
          if (Math.abs(y - otherY) * yScale <= 8) addLine(yLines, otherY);
        }
      }
      const overlapTop = Math.max(candidate.y, other.y);
      const overlapBottom = Math.min(candidate.y + candidate.height, other.y + other.height);
      if (overlapBottom > overlapTop) {
        const horizontalGap = candidate.x + candidate.width <= other.x
          ? other.x - candidate.x - candidate.width
          : candidate.x >= other.x + other.width ? candidate.x - other.x - other.width : 0;
        if (horizontalGap > 0 && horizontalGap * xScale <= 100) {
          labels.push({
            x: (Math.max(candidate.x + candidate.width, other.x) - horizontalGap / 2) / 12 * 100,
            y: (overlapTop + overlapBottom) / 2 / rowCount * 100,
            text: `${Math.round(horizontalGap * xScale)} px`,
          });
        }
      }
      const overlapLeft = Math.max(candidate.x, other.x);
      const overlapRight = Math.min(candidate.x + candidate.width, other.x + other.width);
      if (overlapRight > overlapLeft) {
        const verticalGap = candidate.y + candidate.height <= other.y
          ? other.y - candidate.y - candidate.height
          : candidate.y >= other.y + other.height ? candidate.y - other.y - other.height : 0;
        if (verticalGap > 0 && verticalGap * yScale <= 100) {
          labels.push({
            x: (overlapLeft + overlapRight) / 2 / 12 * 100,
            y: (Math.max(candidate.y + candidate.height, other.y) - verticalGap / 2) / rowCount * 100,
            text: `${Math.round(verticalGap * yScale)} px`,
          });
        }
      }
    }
    homeGalleryGuides.innerHTML = [
      ...[...xLines].map(x => `<span class="home-gallery-guide-line is-vertical" style="left:${x / 12 * 100}%"></span>`),
      ...[...yLines].map(y => `<span class="home-gallery-guide-line is-horizontal" style="top:${y / rowCount * 100}%"></span>`),
      ...labels.map(label => `<span class="home-gallery-gap-label" style="left:${label.x}%;top:${label.y}%">${label.text}</span>`),
    ].join("");
  }

  function homeGalleryLayouts(excludedCover, secondExcludedCover) {
    return homeGalleryCovers.flatMap(cover => cover === excludedCover || cover === secondExcludedCover
      ? []
      : [homeCoverLayout(cover)]);
  }

  function homeGalleryOverlaps(layout, others) {
    return others.some(other => layout.x < other.x + other.width
      && layout.x + layout.width > other.x
      && layout.y < other.y + other.height
      && layout.y + layout.height > other.y);
  }

  function isHomeGalleryLayoutValid(layout, others) {
    return layout.x >= 0
      && layout.y >= 0
      && layout.x + layout.width <= 12
      && layout.y + layout.height <= 120
      && !homeGalleryOverlaps(layout, others);
  }

  function closestMagnet(value, targets, pixelsPerUnit, threshold = 12) {
    let best = value;
    let bestDistance = threshold;
    for (const target of targets) {
      const distance = Math.abs(target - value) * pixelsPerUnit;
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  function magnetizeHomeGalleryMove(candidate, others, canvasWidth, canvasHeight, rowCount) {
    const xTargets = [];
    const yTargets = [];
    for (const other of others) {
      xTargets.push(
        other.x,
        other.x + other.width,
        other.x - candidate.width,
        other.x + other.width - candidate.width,
      );
      yTargets.push(
        other.y,
        other.y + other.height,
        other.y - candidate.height,
        other.y + other.height - candidate.height,
      );
    }
    return {
      ...candidate,
      x: closestMagnet(candidate.x, xTargets, canvasWidth / 12),
      y: closestMagnet(candidate.y, yTargets, canvasHeight / rowCount),
    };
  }

  function magnetizeHomeGalleryResize(candidate, start, others, canvasWidth, canvasHeight, rowCount, aspectRatio) {
    const widthTargets = [];
    const heightTargets = [];
    for (const other of others) {
      widthTargets.push(other.width, other.x - start.x, other.x + other.width - start.x);
      heightTargets.push(other.height, other.y - start.y, other.y + other.height - start.y);
    }
    if (aspectRatio) {
      const minimumWidth = Math.max(0.5, 0.5 * aspectRatio);
      const maximumWidth = Math.min(12 - start.x, (120 - start.y) * aspectRatio);
      const proposedWidths = [
        ...widthTargets,
        ...heightTargets.map(height => height * aspectRatio),
      ];
      let width = candidate.width;
      let bestDistance = 12;
      for (const targetWidth of proposedWidths) {
        if (targetWidth < minimumWidth || targetWidth > maximumWidth) continue;
        const distance = Math.min(
          Math.abs(targetWidth - candidate.width) * canvasWidth / 12,
          Math.abs(targetWidth / aspectRatio - candidate.height) * canvasHeight / rowCount,
        );
        if (distance < bestDistance) {
          width = targetWidth;
          bestDistance = distance;
        }
      }
      return { ...candidate, width, height: width / aspectRatio };
    }
    return {
      ...candidate,
      width: closestMagnet(candidate.width, widthTargets, canvasWidth / 12),
      height: closestMagnet(candidate.height, heightTargets, canvasHeight / rowCount),
    };
  }

  function updateHomeGalleryCanvasLayout() {
    const rowCount = homeGalleryRowCount();
    homeGalleryCanvas.style.aspectRatio = `12 / ${rowCount}`;
    homeGalleryCovers.forEach(cover => {
      const id = homeCoverId(cover);
      const card = [...homeGalleryCanvas.querySelectorAll("[data-home-cover-id]")]
        .find(item => item.dataset.homeCoverId === id);
      if (!card) return;
      const { x, y, width, height } = homeCoverLayout(cover);
      card.style.setProperty("--home-cover-left", `${x / 12 * 100}%`);
      card.style.setProperty("--home-cover-top", `${y / rowCount * 100}%`);
      card.style.setProperty("--home-cover-width", `${width / 12 * 100}%`);
      card.style.setProperty("--home-cover-height", `${height / rowCount * 100}%`);
      card.classList.toggle("is-dragging", homeGalleryPointerDrag?.card === card);
      card.classList.toggle("is-swap-target", homeGalleryPointerDrag?.hoverTargetId === id);
      card.style.zIndex = homeGalleryPointerDrag?.card === card ? "3" : id === selectedHomeCover ? "1" : "0";
    });
  }

  function updateHomeCoverCropPosition(cover) {
    const position = `${cover.crop_x ?? 50}% ${cover.crop_y ?? 50}%`;
    const preview = homeGalleryControls.querySelector(".home-cover-crop-preview");
    const previewImage = preview?.querySelector("img");
    if (previewImage) previewImage.style.objectPosition = position;
    const boardCard = [...homeGalleryBoard.querySelectorAll("[data-home-cover-id]")]
      .find(card => card.dataset.homeCoverId === homeCoverId(cover));
    const boardImage = boardCard?.querySelector("img");
    if (boardImage) boardImage.style.objectPosition = position;
  }

  function homeCoverInfo(cover) {
    const project = projectBySlug(cover.project);
    const image = project?.metadata.images?.find(entry => entry.file === cover.file);
    return project && image ? { project, image } : null;
  }

  function renderHomeGalleryBoard() {
    homeGalleryCanvas.style.setProperty("--gallery-gap", state.config.home_gallery.gap ?? "5px");
    homeGalleryCanvas.innerHTML = homeGalleryCovers.map(cover => {
      const info = homeCoverInfo(cover);
      if (!info) return "";
      const id = homeCoverId(cover);
      const { x, y, width, height } = homeCoverLayout(cover);
      const position = `${cover.crop_x ?? 50}% ${cover.crop_y ?? 50}%`;
      return `<article class="home-gallery-card${cover.crop ? " is-cropped" : ""}${id === selectedHomeCover ? " is-selected" : ""}" data-home-cover-id="${escapeHtml(id)}" style="--home-cover-left: ${x / 12 * 100}%; --home-cover-top: ${y / homeGalleryRowCount() * 100}%; --home-cover-width: ${width / 12 * 100}%; --home-cover-height: ${height / homeGalleryRowCount() * 100}%; --home-cover-position: ${position}">
        <img src="/api/projects/${encodeURIComponent(cover.project)}/images/${encodeURIComponent(cover.file)}" alt="" draggable="false">
        <span>${escapeHtml(info.project.metadata.title ?? cover.file)}</span>
        <span class="home-gallery-resize-handle" data-resize-handle aria-label="Изменить размер"></span>
      </article>`;
    }).join("");
    homeGalleryCanvas.insertAdjacentHTML("beforeend", '<div id="home-gallery-guides" class="home-gallery-guides" aria-hidden="true"></div>');
    homeGalleryGuides = homeGalleryCanvas.querySelector("#home-gallery-guides");
    if (!homeGalleryCovers.length) {
      homeGalleryCanvas.insertAdjacentHTML("afterbegin", '<p class="field-help">Пока нет выбранных обложек. Включите «Использовать как обложку» у изображения проекта.</p>');
    }
    updateHomeGalleryCanvasLayout();
    homeGalleryCanvas.style.width = `${homeGalleryViewport.clientWidth * homeGalleryZoom}px`;
    homeGalleryGuides.replaceChildren();
  }

  function renderHomeGalleryControls() {
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === selectedHomeCover);
    const info = cover && homeCoverInfo(cover);
    saveHomeGalleryButton.disabled = homeGalleryCovers.length === 0;
    const resizeSettings = `
      <label class="field">
        <span>Изменение размера</span>
        <select data-home-resize-mode>
          <option value="free" ${homeGalleryResizeMode === "free" ? "selected" : ""}>Свободное</option>
          <option value="ratio" ${homeGalleryResizeMode === "ratio" ? "selected" : ""}>С сохранением пропорций</option>
        </select>
      </label>
      <label class="field-check"><input type="checkbox" data-home-snap ${homeGallerySnapEnabled ? "checked" : ""}><span>Привязать изменение размера к сетке</span></label>
      <label class="field">
        <span>Шаг сетки: <output data-home-snap-output>${homeGallerySnapStep} px</output></span>
        <input type="range" data-home-snap-step min="1" max="100" step="1" value="${homeGallerySnapStep}" ${homeGallerySnapEnabled ? "" : "disabled"}>
      </label>
      <label class="field-check"><input type="checkbox" data-home-magnet ${homeGalleryMagnetEnabled ? "checked" : ""}><span>Магнитное выравнивание</span></label>
      <p class="field-help">Подтягивает края и одинаковые размеры, когда они ближе 12 px.</p>`;
    if (!cover || !info) {
      homeGalleryControls.innerHTML = `${resizeSettings}<p class="field-help">Выберите обложку, чтобы настроить кадрирование.</p>`;
      return;
    }

    const position = `${cover.crop_x ?? 50}% ${cover.crop_y ?? 50}%`;
    const { width, height } = homeCoverLayout(cover);
    const previewWidth = 180 * width / height;
    const imageUrl = `/api/projects/${encodeURIComponent(cover.project)}/images/${encodeURIComponent(cover.file)}`;
    homeGalleryControls.innerHTML = `
      ${resizeSettings}
      <hr class="home-gallery-controls-divider">
      <h3>${escapeHtml(info.project.metadata.title ?? cover.project)}</h3>
      <p class="field-help">${escapeHtml(cover.file)}</p>
      <div class="home-cover-crop-preview${cover.crop ? " is-cropped" : ""}" style="width: min(100%, ${previewWidth}px); aspect-ratio: ${width} / ${height}; --home-cover-position: ${position}">
        <img src="${imageUrl}" alt="${escapeHtml(info.image.alt ?? "")}" style="object-position: ${position}">
      </div>
      ${cover.crop ? '<p class="field-help">Перетаскивайте изображение в рамке, чтобы изменить кадр.</p>' : ""}
      <label class="field-check"><input type="checkbox" data-home-crop ${cover.crop ? "checked" : ""}><span>Обрезать по размеру плитки</span></label>
      <p class="field-help">Перетаскивайте карточки на холсте. Потяните за угол карточки, чтобы изменить её размер.</p>`;
    homeGalleryControls.scrollTop = 0;
  }

  function renderHomeGalleryEditor() {
    renderHomeGalleryBoard();
    renderHomeGalleryControls();
    updateHomeGalleryHistoryButtons();
    homeGalleryViewport.classList.toggle("is-panning", homeGalleryPanEnabled);
    homeGalleryBoard.querySelector('[data-gallery-action="pan"]').setAttribute("aria-pressed", String(homeGalleryPanEnabled));
  }

  function openHomeGalleryEditor() {
    if (projectDirty) {
      showFlash("Сначала сохраните изменения проекта, затем настройте главную страницу.", true);
      return;
    }
    homeGalleryCovers = structuredClone(state.config.home_gallery.covers ?? []);
    selectedHomeCover = homeGalleryCovers[0] ? homeCoverId(homeGalleryCovers[0]) : "";
    homeGalleryUndoStack = [];
    homeGalleryRedoStack = [];
    renderHomeGalleryEditor();
    homeGalleryDialog.showModal();
    setHomeGalleryZoom(homeGalleryZoom, true);
  }

  async function saveHomeGallery() {
    saveHomeGalleryButton.disabled = true;
    try {
      const result = await request("/api/home-gallery", jsonOptions({ covers: homeGalleryCovers }));
      state.config.home_gallery.covers = result.covers;
      renderSettings();
      homeGalleryDialog.close();
      showFlash("Раскладка главной страницы сохранена.");
    } catch (error) {
      saveHomeGalleryButton.disabled = false;
      showFlash(error.message, true);
    }
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
  document.querySelector("#edit-home-gallery").addEventListener("click", openHomeGalleryEditor);
  document.querySelector("#close-home-gallery-editor").addEventListener("click", () => homeGalleryDialog.close());
  document.querySelector("#save-home-gallery").addEventListener("click", saveHomeGallery);
  homeGalleryDialog.addEventListener("click", event => {
    if (event.target === homeGalleryDialog) homeGalleryDialog.close();
  });
  homeGalleryCanvas.addEventListener("click", event => {
    if (homeGalleryPointerDrag) return;
    const card = event.target.closest("[data-home-cover-id]");
    if (!card) return;
    selectedHomeCover = card.dataset.homeCoverId;
    renderHomeGalleryEditor();
    homeGalleryCanvas.focus({ preventScroll: true });
  });
  function completeHomeGallerySwap(drag, targetId) {
    if (homeGalleryPointerDrag !== drag || drag.hoverTargetId !== targetId) return;
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === drag.card.dataset.homeCoverId);
    const targetIndex = homeGalleryCovers.findIndex(item => homeCoverId(item) === targetId);
    const target = homeGalleryCovers[targetIndex];
    if (!cover || !target || drag.mode !== "move") return;
    const canvasBounds = homeGalleryCanvas.getBoundingClientRect();
    const pointerX = (drag.lastClientX - canvasBounds.left) / drag.canvasWidth * 12;
    const pointerY = (drag.lastClientY - canvasBounds.top) / drag.canvasHeight * drag.rowCount;
    const targetLayout = homeCoverLayout(target);
    if (
      pointerX < targetLayout.x
      || pointerX > targetLayout.x + targetLayout.width
      || pointerY < targetLayout.y
      || pointerY > targetLayout.y + targetLayout.height
    ) return;
    const unaffected = homeGalleryLayouts(cover, target);
    const nextLayout = drag.lastValidLayout;
    if (
      !isHomeGalleryLayoutValid(targetLayout, unaffected)
      || !isHomeGalleryLayoutValid(nextLayout, unaffected)
      || homeGalleryOverlaps(targetLayout, [nextLayout])
    ) return;

    Object.assign(cover, targetLayout);
    Object.assign(target, nextLayout);
    drag.lastValidLayout = { ...targetLayout };
    drag.hoverTargetId = null;
    drag.swapTimer = null;
    updateHomeGalleryCanvasLayout();
  }

  homeGalleryCanvas.addEventListener("pointerdown", event => {
    if (event.button === 1) return;
    const card = event.target.closest("[data-home-cover-id]");
    if (!card || event.button !== 0) return;
    selectedHomeCover = card.dataset.homeCoverId;
    const coverIndex = homeGalleryCovers.findIndex(item => homeCoverId(item) === selectedHomeCover);
    const cover = homeGalleryCovers[coverIndex];
    if (!cover) return;
    const { x, y, width, height } = homeCoverLayout(cover);
    const canvasBounds = homeGalleryCanvas.getBoundingClientRect();
    const mode = event.target.closest("[data-resize-handle]") ? "resize" : "move";
    const image = card.querySelector("img");
    const imageAspectRatio = image?.naturalWidth && image.naturalHeight
      ? image.naturalWidth / image.naturalHeight
      : null;
    if (mode === "resize" && homeGalleryResizeMode === "ratio" && !imageAspectRatio) {
      showFlash("Изображение ещё загружается. Попробуйте изменить размер через секунду.", true);
      return;
    }
    homeGalleryPointerDrag = {
      pointerId: event.pointerId,
      card,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startLayout: { x, y, width, height },
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
      rowCount: homeGalleryRowCount(),
      imageAspectRatio,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastValidLayout: { x, y, width, height },
      historyBefore: structuredClone(homeGalleryCovers),
      hoverTargetId: null,
      swapTimer: null,
      moved: false,
    };
    card.setPointerCapture(event.pointerId);
    updateHomeGalleryCanvasLayout();
    homeGalleryCanvas.focus({ preventScroll: true });
    event.preventDefault();
  });
  homeGalleryCanvas.addEventListener("pointermove", event => {
    if (!homeGalleryPointerDrag || homeGalleryPointerDrag.mode === "pan" || event.pointerId !== homeGalleryPointerDrag.pointerId) return;
    const drag = homeGalleryPointerDrag;
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === drag.card.dataset.homeCoverId);
    if (!cover) return;
    const deltaX = (event.clientX - drag.lastClientX) / drag.canvasWidth * 12;
    const deltaY = (event.clientY - drag.lastClientY) / drag.canvasHeight * drag.rowCount;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 0.02) drag.moved = true;
    const start = homeCoverLayout(cover);
    const others = homeGalleryLayouts(cover);
    if (drag.mode === "move") {
      const canvasBounds = homeGalleryCanvas.getBoundingClientRect();
      const pointerX = (event.clientX - canvasBounds.left) / drag.canvasWidth * 12;
      const pointerY = (event.clientY - canvasBounds.top) / drag.canvasHeight * drag.rowCount;
      const targetIndex = homeGalleryCovers.findIndex(other => {
        if (other === cover) return false;
        const layout = homeCoverLayout(other);
        return pointerX >= layout.x
          && pointerX <= layout.x + layout.width
          && pointerY >= layout.y
          && pointerY <= layout.y + layout.height;
      });
      if (targetIndex >= 0) {
        const target = homeGalleryCovers[targetIndex];
        const targetId = homeCoverId(target);
        if (drag.hoverTargetId !== targetId) {
          window.clearTimeout(drag.swapTimer);
          drag.hoverTargetId = targetId;
          drag.swapTimer = window.setTimeout(
            () => completeHomeGallerySwap(drag, targetId),
            HOME_GALLERY_SWAP_HOVER_MS,
          );
          updateHomeGalleryCanvasLayout();
        }
      } else {
        window.clearTimeout(drag.swapTimer);
        drag.swapTimer = null;
        drag.hoverTargetId = null;
      }
    }
    let candidate;
    if (drag.mode === "move") {
      candidate = { ...start, x: start.x + deltaX, y: start.y + deltaY };
      candidate.x = Math.min(12 - start.width, Math.max(0, candidate.x));
      candidate.y = Math.min(120 - start.height, Math.max(0, candidate.y));
      if (homeGalleryMagnetEnabled) {
        candidate = magnetizeHomeGalleryMove(
          candidate,
          others,
          drag.canvasWidth,
          drag.canvasHeight,
          drag.rowCount,
        );
      }
    } else {
      if (homeGalleryResizeMode === "ratio") {
        const widthScale = (start.width + deltaX) / start.width;
        const heightScale = (start.height + deltaY) / start.height;
        let scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
        const aspectRatio = drag.imageAspectRatio;
        const minimumWidth = Math.max(0.5, 0.5 * aspectRatio);
        const maximumWidth = Math.min(12 - start.x, (120 - start.y) * aspectRatio);
        scale = Math.max(minimumWidth / start.width, Math.min(maximumWidth / start.width, scale));
        if (homeGallerySnapEnabled) {
          const snapUnit = homeGallerySnapStep * 12 / drag.canvasWidth;
          const snappedWidth = Math.round((start.x + start.width * scale) / snapUnit) * snapUnit - start.x;
          scale = Math.max(minimumWidth / start.width, Math.min(maximumWidth / start.width, snappedWidth / start.width));
        }
        candidate = {
          ...start,
          width: Math.round(start.width * scale * 10000) / 10000,
          height: Math.round(start.width * scale / aspectRatio * 10000) / 10000,
        };
      } else {
        let width = Math.max(0.5, Math.min(12 - start.x, start.width + deltaX));
        let height = Math.max(0.5, Math.min(120 - start.y, start.height + deltaY));
        if (homeGallerySnapEnabled) {
          const snapUnitX = homeGallerySnapStep * 12 / drag.canvasWidth;
          const snapUnitY = homeGallerySnapStep * drag.rowCount / drag.canvasHeight;
          width = Math.max(0.5, Math.min(12 - start.x, Math.round((start.x + width) / snapUnitX) * snapUnitX - start.x));
          height = Math.max(0.5, Math.min(120 - start.y, Math.round((start.y + height) / snapUnitY) * snapUnitY - start.y));
        }
        candidate = {
          ...start,
          width: Math.round(width * 10000) / 10000,
          height: Math.round(height * 10000) / 10000,
        };
      }
      if (homeGalleryMagnetEnabled) {
        candidate = magnetizeHomeGalleryResize(
          candidate,
          start,
          others,
          drag.canvasWidth,
          drag.canvasHeight,
          drag.rowCount,
          homeGalleryResizeMode === "ratio" ? drag.imageAspectRatio : null,
        );
      }
      candidate.width = Math.max(0.5, Math.min(12 - start.x, candidate.width));
      candidate.height = Math.max(0.5, Math.min(120 - start.y, candidate.height));
    }
    candidate.x = Math.round(candidate.x * 10000) / 10000;
    candidate.y = Math.round(candidate.y * 10000) / 10000;
    candidate.width = Math.round(candidate.width * 10000) / 10000;
    candidate.height = Math.round(candidate.height * 10000) / 10000;
    Object.assign(cover, candidate);
    if (isHomeGalleryLayoutValid(candidate, others)) {
      drag.lastValidLayout = { ...candidate };
    }
    updateHomeGalleryCanvasLayout();
    updateHomeGalleryGuides(candidate, others);
  });
  homeGalleryViewport.addEventListener("pointerdown", event => {
    if (event.button !== 1 && !(homeGalleryPanEnabled && event.button === 0)) return;
    if (event.button !== 1 && event.target.closest("[data-home-cover-id]")) return;
    homeGalleryPointerDrag = {
      pointerId: event.pointerId,
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: homeGalleryViewport.scrollLeft,
      scrollTop: homeGalleryViewport.scrollTop,
    };
    homeGalleryViewport.classList.add("is-dragging");
    homeGalleryViewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  homeGalleryViewport.addEventListener("pointermove", event => {
    const drag = homeGalleryPointerDrag;
    if (!drag || drag.mode !== "pan" || event.pointerId !== drag.pointerId) return;
    homeGalleryViewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    homeGalleryViewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  });
  homeGalleryViewport.addEventListener("pointerup", event => {
    if (!homeGalleryPointerDrag || homeGalleryPointerDrag.mode !== "pan" || event.pointerId !== homeGalleryPointerDrag.pointerId) return;
    homeGalleryPointerDrag = null;
    homeGalleryViewport.classList.remove("is-dragging");
  });
  function endHomeGalleryPointerDrag(event) {
    if (!homeGalleryPointerDrag || event.pointerId !== homeGalleryPointerDrag.pointerId) return;
    const drag = homeGalleryPointerDrag;
    if (drag.mode === "pan") return;
    window.clearTimeout(drag.swapTimer);
    const { card, moved } = drag;
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === card.dataset.homeCoverId);
    if (cover) {
      const current = homeCoverLayout(cover);
      const others = homeGalleryLayouts(cover);
      if (!isHomeGalleryLayoutValid(current, others)) {
        Object.assign(cover, drag.lastValidLayout);
      }
    }
    homeGalleryPointerDrag = null;
    updateHomeGalleryGuides(null, []);
    recordHomeGalleryChange(drag.historyBefore);
    if (moved) {
      renderHomeGalleryBoard();
      renderHomeGalleryControls();
    } else {
      selectedHomeCover = card.dataset.homeCoverId;
      renderHomeGalleryEditor();
    }
  }
  homeGalleryCanvas.addEventListener("pointerup", endHomeGalleryPointerDrag);
  homeGalleryCanvas.addEventListener("pointercancel", endHomeGalleryPointerDrag);
  homeGalleryControls.addEventListener("change", event => {
    const control = event.target;
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === selectedHomeCover);
    if (control.matches("[data-home-resize-mode]")) {
      homeGalleryResizeMode = control.value;
      return;
    }
    if (control.matches("[data-home-snap]")) {
      homeGallerySnapEnabled = control.checked;
      const step = homeGalleryControls.querySelector("[data-home-snap-step]");
      if (step) step.disabled = !homeGallerySnapEnabled;
      return;
    }
    if (control.matches("[data-home-magnet]")) {
      homeGalleryMagnetEnabled = control.checked;
      return;
    }
    if (!cover) return;
    if (control.matches("[data-home-crop]")) {
      const before = structuredClone(homeGalleryCovers);
      cover.crop = control.checked;
      recordHomeGalleryChange(before);
      renderHomeGalleryEditor();
    }
  });
  homeGalleryControls.addEventListener("input", event => {
    const control = event.target;
    if (!control.matches("[data-home-snap-step]")) return;
    homeGallerySnapStep = Number(control.value);
    const output = homeGalleryControls.querySelector("[data-home-snap-output]");
    if (output) output.value = `${homeGallerySnapStep} px`;
  });
  homeGalleryControls.addEventListener("pointerdown", event => {
    const preview = event.target.closest(".home-cover-crop-preview.is-cropped");
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === selectedHomeCover);
    if (!preview || !cover) return;
    const image = preview.querySelector("img");
    if (!image?.naturalWidth || !image.naturalHeight) return;
    const bounds = preview.getBoundingClientRect();
    const scale = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    const overflowX = image.naturalWidth * scale - bounds.width;
    const overflowY = image.naturalHeight * scale - bounds.height;
    if (overflowX <= 0 && overflowY <= 0) return;
    homeGalleryPointerDrag = {
      pointerId: event.pointerId,
      mode: "crop",
      startX: event.clientX,
      startY: event.clientY,
      startCropX: cover.crop_x ?? 50,
      startCropY: cover.crop_y ?? 50,
      overflowX,
      overflowY,
      card: preview,
      preview,
      historyBefore: structuredClone(homeGalleryCovers),
    };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add("is-dragging");
    event.preventDefault();
  });
  homeGalleryControls.addEventListener("pointermove", event => {
    if (!homeGalleryPointerDrag || homeGalleryPointerDrag.mode !== "crop" || event.pointerId !== homeGalleryPointerDrag.pointerId) return;
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === selectedHomeCover);
    if (!cover) return;
    const { startX, startY, startCropX, startCropY, overflowX, overflowY } = homeGalleryPointerDrag;
    if (overflowX > 0) cover.crop_x = Math.round(Math.max(0, Math.min(100, startCropX - ((event.clientX - startX) / overflowX) * 100)) * 100) / 100;
    if (overflowY > 0) cover.crop_y = Math.round(Math.max(0, Math.min(100, startCropY - ((event.clientY - startY) / overflowY) * 100)) * 100) / 100;
    updateHomeCoverCropPosition(cover);
  });
  function endHomeGalleryCropDrag(event) {
    if (!homeGalleryPointerDrag || homeGalleryPointerDrag.mode !== "crop" || event.pointerId !== homeGalleryPointerDrag.pointerId) return;
    homeGalleryPointerDrag.preview.classList.remove("is-dragging");
    recordHomeGalleryChange(homeGalleryPointerDrag.historyBefore);
    homeGalleryPointerDrag = null;
    renderHomeGalleryEditor();
  }
  homeGalleryControls.addEventListener("pointerup", endHomeGalleryCropDrag);
  homeGalleryControls.addEventListener("pointercancel", endHomeGalleryCropDrag);

  homeGalleryBoard.addEventListener("click", event => {
    const action = event.target.closest("[data-gallery-action]")?.dataset.galleryAction;
    if (!action) return;
    if (action === "undo") restoreHomeGalleryHistory(homeGalleryUndoStack, homeGalleryRedoStack);
    if (action === "redo") restoreHomeGalleryHistory(homeGalleryRedoStack, homeGalleryUndoStack);
    if (action === "zoom-in") setHomeGalleryZoom(homeGalleryZoom * 1.2);
    if (action === "zoom-out") setHomeGalleryZoom(homeGalleryZoom / 1.2);
    if (action === "zoom-fit") setHomeGalleryZoom(homeGalleryZoom, true);
    if (action === "pan") {
      homeGalleryPanEnabled = !homeGalleryPanEnabled;
      homeGalleryViewport.classList.toggle("is-panning", homeGalleryPanEnabled);
      homeGalleryBoard.querySelector('[data-gallery-action="pan"]').setAttribute("aria-pressed", String(homeGalleryPanEnabled));
    }
  });

  new ResizeObserver(() => {
    if (homeGalleryDialog.open && homeGalleryViewport.clientWidth) {
      setHomeGalleryZoom(homeGalleryZoom);
    }
  }).observe(homeGalleryViewport);

  homeGalleryDialog.addEventListener("keydown", event => {
    const target = event.target instanceof Element ? event.target : null;
    const editingText = target?.closest("input, textarea, select, [contenteditable='true']");
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !editingText) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        restoreHomeGalleryHistory(
          event.shiftKey ? homeGalleryRedoStack : homeGalleryUndoStack,
          event.shiftKey ? homeGalleryUndoStack : homeGalleryRedoStack,
        );
        return;
      }
      if (key === "y") {
        event.preventDefault();
        restoreHomeGalleryHistory(homeGalleryRedoStack, homeGalleryUndoStack);
        return;
      }
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      || target?.closest("button, input, textarea, select, [contenteditable='true']")
      || homeGalleryPointerDrag
    ) return;
    const cover = homeGalleryCovers.find(item => homeCoverId(item) === selectedHomeCover);
    if (!cover) return;
    event.preventDefault();
    const current = homeCoverLayout(cover);
    const canvasWidth = homeGalleryCanvas.clientWidth;
    const canvasHeight = homeGalleryCanvas.clientHeight;
    const rowCount = homeGalleryRowCount();
    const amount = event.shiftKey ? 10 : 1;
    const dx = (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0) * 12 / canvasWidth;
    const dy = (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0) * rowCount / canvasHeight;
    const others = homeGalleryLayouts(cover);
    let candidate = {
      ...current,
      x: Math.max(0, Math.min(12 - current.width, current.x + dx)),
      y: Math.max(0, Math.min(120 - current.height, current.y + dy)),
    };
    if (!isHomeGalleryLayoutValid(candidate, others)) return;
    const before = structuredClone(homeGalleryCovers);
    Object.assign(cover, candidate);
    updateHomeGalleryCanvasLayout();
    updateHomeGalleryGuides(candidate, others);
    recordHomeGalleryChange(before);
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
        state.config = freshState.config;
        state.projects = freshState.projects;
        projectDirty = false;
        renderProject();
        showFlash("Несохранённые изменения отменены.");
      } else if (button.dataset.action === "remove-image") {
        const index = Number(button.dataset.index);
        project.metadata.images.splice(index, 1);
        setProjectDirty();
        renderProject();
      } else if (button.dataset.action === "upload-images") {
        button.disabled = true;
        await uploadImages();
      }
    } catch (error) {
      showFlash(error.message, true);
      renderProject();
    }
  });

  loadState().catch(error => {
    showFlash(error.message, true);
    projectEditor.innerHTML = `<div class="empty-state"><h2>Не удалось загрузить сайт</h2><p>${escapeHtml(error.message)}</p></div>`;
  });
})();
