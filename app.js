import { rotationalFrequency, bladePassFrequency, meshFrequency, vibrationVelocity, diagnose, safeProgress, groupBlocks, formatFormula } from "./logic.js";
import { completeInteraction, isInteractionComplete, isInteractionId } from "./interaction-logic.js";
import { escapeHtml, handleInteractionEvent, interactionDefinitions, renderInteraction, renderLessonSections } from "./interactions.js";

const content = await fetch("./content.json").then((response) => response.json());
const storageKey = "equipment-diagnostics-progress-v1";
const chaptersById = new Map(content.modules.map((module) => [module.id, module]));
const practiceIds = new Set(content.modules.flatMap(interactionDefinitions)
  .map((definition) => definition?.id).filter(isInteractionId));
const practiceValues = new Map();
let progress;
try {
  progress = restoreProgress();
} catch {
  progress = safeProgress(null);
}
const pendingChanges = [];
const applyChange = (state, change) => change(state);
let currentModule = chaptersById.get(progress.current);
let currentSymptom = "1x";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function restoreProgress() {
  const restored = safeProgress(localStorage.getItem(storageKey));
  restored.completed = restored.completed.filter((id) => chaptersById.has(id));
  restored.mistakes = restored.mistakes.filter((id) => chaptersById.has(id));
  if (!chaptersById.has(restored.current)) restored.current = content.modules[0].id;
  return restored;
}

async function saveProgress(change, message) {
  pendingChanges.push(change);
  try {
    progress = pendingChanges.reduce(applyChange, restoreProgress());
  } catch {
    progress = change(progress);
  }
  updateProgress();
  if (message) $("#live-status").textContent = message;

  const write = () => {
    // Include earlier unsaved actions, and keep later clicks visible while they wait.
    const count = pendingChanges.indexOf(change) + 1;
    if (!count) return;
    try {
      const stored = restoreProgress();
      const updated = pendingChanges.slice(0, count).reduce(applyChange, stored);
      if (updated !== stored) localStorage.setItem(storageKey, JSON.stringify(updated));
      pendingChanges.splice(0, count);
      progress = pendingChanges.reduce(applyChange, updated);
      updateProgress();
    } catch {
      $("#live-status").textContent = "Не удалось сохранить прогресс.";
    }
  };
  // Web Locks serialize the read and write across tabs on HTTPS and localhost.
  try {
    const locks = globalThis.navigator?.locks;
    if (locks) {
      await locks.request(storageKey, write);
      return;
    }
  } catch (error) {
    if (error.name !== "SecurityError") throw error;
  }
  write();
}

function updateProgress() {
  const percent = Math.round((progress.completed.length / content.modules.length) * 100);
  $("#header-progress-value").textContent = `${percent}%`;
  $("#header-progress-bar").style.width = `${percent}%`;
  const completedPractices = progress.interactionsCompleted.filter((id) => practiceIds.has(id)).length;
  $("#practice-progress-value").textContent = `${completedPractices} / ${practiceIds.size}`;
  const continueButton = $("#continue-button");
  continueButton.textContent = percent || progress.current !== content.modules[0].id
    ? "Продолжить обучение"
    : "Начать с первой главы";
}

function showView(name, moduleId) {
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === name));
  $$('[data-view]').forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  if (name === "course") openLesson(moduleId);
  if (name === "trainer") renderDiagnostic();
  if (name === "glossary") renderGlossary();
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function renderModuleList(filter = "") {
  const query = filter.trim().toLowerCase();
  const modules = content.modules.filter((module) => `${module.title} ${module.summary}`.toLowerCase().includes(query));
  $("#module-list").innerHTML = modules.map((module) => `<button class="module-button ${module.id === currentModule.id ? "active" : ""} ${progress.completed.includes(module.id) ? "done" : ""}" data-module="${module.id}"><span>${module.number}</span><small>${escapeHtml(module.title)}</small></button>`).join("") || '<p class="empty">Ничего не найдено. Попробуйте другое слово.</p>';
}

function renderBlocks(blocks) {
  return groupBlocks(blocks).map((block) => {
    if (block.type === "step-list") return `<ol>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
    if (block.type === "bullet-list") return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    if (block.type === "subheading") return `<h3 class="lesson-subheading">${escapeHtml(block.text)}</h3>`;
    const text = escapeHtml(block.text);
    if (block.type === "formula") return `<div class="formula" role="math">${formatFormula(block.text)}</div>`;
    return `<p>${text}</p>`;
  }).join("");
}

function openLesson(moduleId, completedId) {
  const next = chaptersById.get(moduleId) || currentModule;
  saveProgress((state) => ({
    ...state,
    current: next.id,
    completed: completedId && !state.completed.includes(completedId) ? [...state.completed, completedId] : state.completed,
  }), completedId ? "Глава отмечена как изученная" : "Открыта глава");
  currentModule = next;
  renderLesson();
}

function renderLesson() {
  renderModuleList($("#module-search")?.value || "");
  const sections = renderLessonSections(
    currentModule,
    (section) => `<section><h2>${escapeHtml(section.title)}</h2>${renderBlocks(section.blocks)}</section>`,
    (definition) => renderInteraction(definition, {
      values: practiceValues.get(definition.id),
      completed: isInteractionComplete(progress, definition.id),
    }),
  );
  $("#lesson-content").innerHTML = `<p class="signal-label">Глава ${currentModule.number} из 17</p><h1>${escapeHtml(currentModule.title)}</h1><p class="lesson-summary">${escapeHtml(currentModule.summary)}</p>${sections}`;
  const quiz = currentModule.quiz;
  $("#lesson-rail").innerHTML = `<div class="quiz-card"><p class="signal-label">Проверьте себя</p><h2>${escapeHtml(quiz.question)}</h2><div>${quiz.options.map((option, index) => `<button class="quiz-option" data-answer="${index}">${escapeHtml(option)}</button>`).join("")}</div><p id="quiz-feedback" aria-live="polite"></p></div><button class="primary complete-button">${progress.completed.includes(currentModule.id) ? "Глава изучена" : "Отметить как изученную"}</button><p class="rail-note">Правильный ответ — это проверка понимания, а не оценка. Ошибки можно повторить позже.</p>`;
  $("#lesson-content").focus({ preventScroll: true });
}

function answerQuiz(index, button) {
  const correct = currentModule.quiz.answer;
  const chapterId = currentModule.id;
  $$(".quiz-option").forEach((item) => item.disabled = true);
  button.classList.add(index === correct ? "correct" : "wrong");
  if (index !== correct) {
    $$(".quiz-option")[correct].classList.add("correct");
    $("#quiz-feedback").textContent = "Пока нет. Правильный вариант подсвечен — вернитесь к объяснению слева.";
  } else {
    $("#quiz-feedback").textContent = "Верно. Вы связали признак с правильным принципом.";
  }
  saveProgress((state) => {
    const mistakes = state.mistakes.filter((id) => id !== chapterId);
    if (index !== correct) mistakes.push(chapterId);
    return { ...state, mistakes };
  }, "Ответ сохранён");
}

function completeModule() {
  const next = content.modules[currentModule.number] || currentModule;
  openLesson(next.id, currentModule.id);
}

function renderDiagnostic() {
  const result = diagnose(currentSymptom);
  $$('[data-symptom]').forEach((button) => {
    const active = button.dataset.symptom === currentSymptom;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#diagnostic-result").innerHTML = `<p class="step-kicker">Шаги 2 и 3</p><h2>${escapeHtml(result.title)}</h2><p class="result-lead">Не выбирайте причину только по одному признаку. Сначала составьте список версий, затем отделите их измерениями.</p><div class="diagnostic-columns"><section class="diagnostic-card causes-card"><span class="card-number">02</span><h3>Что может быть причиной</h3><ul>${result.causes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section><section class="diagnostic-card checks-card"><span class="card-number">03</span><h3>Что проверить</h3><ol>${result.checks.map((item, index) => `<li class="${index === 0 ? "priority-check" : ""}">${index === 0 ? '<strong>Начните с этого:</strong> ' : ""}${escapeHtml(item)}</li>`).join("")}</ol></section><p class="caution"><strong>Ограничение:</strong> ${escapeHtml(result.caution)}</p></div>`;
}

function setupCalculators() {
  const forms = [
    ["#rotation-form", (data) => rotationalFrequency(data.get("rpm")), "Гц"],
    ["#blade-form", (data) => bladePassFrequency(data.get("rpm"), data.get("count")), "Гц"],
    ["#mesh-form", (data) => meshFrequency(data.get("rpm"), data.get("count")), "Гц"],
    ["#velocity-form", (data) => vibrationVelocity(data.get("frequency"), data.get("displacement")), "мм/с"],
  ];
  forms.forEach(([selector, calculator, unit]) => $(selector).addEventListener("submit", (event) => {
    event.preventDefault();
    const value = calculator(new FormData(event.currentTarget));
    $("output", event.currentTarget).textContent = value === null ? "Проверьте введённые значения" : `${value.toFixed(2)} ${unit}`;
  }));
}

function renderGlossary(query = "") {
  const term = query.trim().toLowerCase();
  const items = content.glossary.filter((item) => `${item.term} ${item.english} ${item.definition}`.toLowerCase().includes(term));
  $("#glossary-list").innerHTML = items.map((item) => `<button class="glossary-item"><strong>${escapeHtml(item.term)}</strong><span>${escapeHtml(item.english)}</span><small>${escapeHtml(item.definition)}</small></button>`).join("") || '<p class="empty">Термин не найден. Попробуйте часть слова.</p>';
}

function setupOrbit() {
  const canvas = $("#orbit-canvas");
  const context = canvas.getContext("2d");
  const speed = $("#speed-control");
  const damping = $("#damping-control");
  let phase = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function draw() {
    const rpm = Number(speed.value);
    const damp = Number(damping.value);
    const resonance = Math.exp(-Math.pow((rpm - 5200) / 1500, 2));
    const amplitude = 24 + resonance * (155 / damp) * 5;
    const xRadius = Math.min(180, amplitude * 1.25);
    const yRadius = Math.min(150, amplitude * .78);
    phase += reduced ? 0 : .016 + rpm / 700000;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(126,199,188,.18)"; context.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 40) { context.beginPath(); context.moveTo(x,0); context.lineTo(x,canvas.height); context.stroke(); }
    for (let y = 0; y <= canvas.height; y += 40) { context.beginPath(); context.moveTo(0,y); context.lineTo(canvas.width,y); context.stroke(); }
    const cx = canvas.width / 2, cy = canvas.height / 2;
    context.strokeStyle = "#2a9d8f"; context.lineWidth = 4; context.beginPath(); context.ellipse(cx, cy, xRadius, yRadius, -.28, 0, Math.PI * 2); context.stroke();
    const px = cx + Math.cos(phase) * xRadius * Math.cos(.28) + Math.sin(phase) * yRadius * Math.sin(.28);
    const py = cy - Math.cos(phase) * xRadius * Math.sin(.28) + Math.sin(phase) * yRadius * Math.cos(.28);
    context.fillStyle = "#f4a261"; context.beginPath(); context.arc(px, py, 12, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "rgba(255,255,255,.4)"; context.beginPath(); context.moveTo(cx-18,cy); context.lineTo(cx+18,cy); context.moveTo(cx,cy-18); context.lineTo(cx,cy+18); context.stroke();
    $("#speed-value").textContent = rpm;
    $("#damping-value").textContent = damp <= 3 ? "малое" : damp <= 7 ? "среднее" : "высокое";
    $("#orbit-status").textContent = resonance > .65 && damp < 5 ? "Опасное усиление около резонанса" : resonance > .35 ? "Амплитуда растёт" : "Устойчивое движение";
    if (!reduced) requestAnimationFrame(draw);
  }
  speed.addEventListener("input", draw); damping.addEventListener("input", draw); draw();
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) showView(viewButton.dataset.view);
  const moduleButton = event.target.closest("[data-module]");
  if (moduleButton) showView("course", moduleButton.dataset.module);
  const answer = event.target.closest("[data-answer]");
  if (answer) answerQuiz(Number(answer.dataset.answer), answer);
  if (event.target.closest(".complete-button")) completeModule();
});
const lessonContent = $("#lesson-content");
for (const type of ["click", "input", "change"]) {
  lessonContent.addEventListener(type, (event) => handleInteractionEvent(event, {
    definitions: interactionDefinitions(currentModule),
    valuesById: practiceValues,
    onComplete(id) {
      saveProgress((state) => completeInteraction(state, id));
    },
  }));
}

$("#continue-button").addEventListener("click", () => showView("course"));
$("#module-search").addEventListener("input", (event) => renderModuleList(event.target.value));
document.addEventListener("click", (event) => {
  const symptom = event.target.closest("[data-symptom]");
  if (!symptom) return;
  currentSymptom = symptom.dataset.symptom;
  renderDiagnostic();
});
$("#glossary-search").addEventListener("input", (event) => renderGlossary(event.target.value));
setupCalculators(); setupOrbit(); renderModuleList(); renderDiagnostic(); renderGlossary(); updateProgress();
