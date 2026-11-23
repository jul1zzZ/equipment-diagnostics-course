import {
  balanceAttempt,
  buildSpectrum,
  clampLabNumber,
  evaluateSensorPlacement,
  isInteractionId,
  machineNyquistHz,
  machineSignal,
  machineWindowSeconds,
  resonanceControls,
  resonanceResponse,
  samplingControls,
  samplingModel,
  samplingWindowSeconds,
  sensorChoices,
  sensorSelection,
  wrapBalanceAngle,
} from "./interaction-logic.js";

export const interactionRenderers = new Map();

const unavailablePractice = '<section class="practice-bench"><p>Упражнение пока недоступно.</p></section>';
const savedFeedback = Symbol("practice feedback");

export function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function getRenderer(definition) {
  if (!isInteractionId(definition?.id) || !hasText(definition.title) || !hasText(definition.prompt)) return;
  const { config } = definition;
  if (!config || typeof config !== "object" || Array.isArray(config)) return;
  const renderer = interactionRenderers.get(definition.type);
  if (renderer && (!renderer.validateConfig || renderer.validateConfig(config))) return renderer;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validNumberSettings(config, keys) {
  return keys.every((key) => !Object.hasOwn(config, key) || Number.isFinite(config[key]));
}

function renderFeedback(values) {
  return `<p class="practice-feedback" data-interaction-feedback aria-live="polite" aria-atomic="true">${escapeHtml(values[savedFeedback] ?? "")}</p>`;
}

function renderInteractionBody(renderer, definition, values) {
  const { controls, afterFeedback = "", display } = renderer.render(definition, values);
  const feedback = renderFeedback(values);
  return [
    controls && `<div class="practice-controls">${controls}${feedback}${afterFeedback}</div>`,
    display && `<div class="practice-display">${display}${controls ? "" : feedback}</div>`,
  ].join("");
}

const completedLabel = "Практика выполнена";
const pendingLabel = "Практика пока не выполнена";

export function renderInteraction(definition, { values = {}, completed = false } = {}) {
  const renderer = getRenderer(definition);
  if (!renderer) return unavailablePractice;
  const id = escapeHtml(definition.id);
  return `<section class="practice-bench" data-interaction="${id}" aria-labelledby="practice-title-${id}">
    <header class="practice-heading">
      <span class="practice-completion" data-interaction-completion>${completed ? completedLabel : pendingLabel}</span>
      <h2 id="practice-title-${id}">${escapeHtml(definition.title)}</h2>
      <p>${escapeHtml(definition.prompt)}</p>
    </header>
    <div class="practice-grid" data-interaction-body>${renderInteractionBody(renderer, definition, values)}</div>
    <footer class="practice-footer">
      <button class="practice-reset" type="button" data-interaction-action="reset">Сбросить</button>
    </footer>
  </section>`;
}

export function interactionDefinitions(module) {
  const { interactions } = module;
  if (interactions == null) return [];
  return Array.isArray(interactions) ? interactions : [null];
}

export function renderLessonSections(module, renderSection, renderPractice) {
  const practicesBySection = module.sections.map(() => []);
  const unplacedPractices = [];
  for (const definition of interactionDefinitions(module)) {
    const index = definition?.afterSection;
    if (Number.isInteger(index) && practicesBySection[index]) {
      practicesBySection[index].push(renderPractice(definition));
    } else {
      unplacedPractices.push(unavailablePractice);
    }
  }
  return module.sections.map((section, index) => {
    return renderSection(section) + practicesBySection[index].join("");
  }).join("") + unplacedPractices.join("");
}

export function handleInteractionEvent(event, { definitions, valuesById, onComplete }) {
  const control = event.target.closest?.("[data-interaction-action]");
  const panel = control?.closest("[data-interaction]");
  if (!panel) return;

  if (!Array.isArray(definitions)) return;
  const definition = definitions.find((entry) => entry?.id === panel.dataset.interaction);
  const renderer = getRenderer(definition);
  if (!renderer) return;

  if (control.dataset.interactionAction === "reset") {
    if (event.type !== "click") return;
    valuesById.delete(definition.id);
    panel.querySelector("[data-interaction-body]").innerHTML = renderInteractionBody(renderer, definition, {});
    panel.querySelector("[data-interaction-feedback]").textContent = "Начальное состояние восстановлено.";
    return;
  }

  if (!renderer.handleEvent) return;
  if (!valuesById.has(definition.id)) valuesById.set(definition.id, {});
  const values = valuesById.get(definition.id);
  const feedback = (message) => {
    values[savedFeedback] = message;
    panel.querySelector("[data-interaction-feedback]").textContent = message;
  };
  const complete = () => {
    onComplete(definition.id);
    panel.querySelector("[data-interaction-completion]").textContent = completedLabel;
  };
  renderer.handleEvent(event, { control, panel, definition, values, complete, feedback });
}

const labNumber = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function choiceButtons(action, options, selected) {
  return Array.from(options, ([value, label]) =>
    `<button class="practice-choice" type="button" data-interaction-action="${action}"
      data-choice="${value}" aria-pressed="${selected instanceof Set ? selected.has(value) : value === selected}">${label}</button>`
  ).join("");
}

function updatePressedChoices(panel, action, choice) {
  for (const button of panel.querySelectorAll(`button[data-interaction-action="${action}"]`)) {
    button.setAttribute("aria-pressed", String(button.dataset.choice === choice));
  }
}

export function evaluateMicroTask(definition, answer) {
  const option = Number.isInteger(answer) ? definition?.config?.options?.[answer] : undefined;
  if (!hasText(option?.explanation)) return { correct: false, explanation: "Выберите один из предложенных ответов." };
  return { correct: answer === definition.config.answer, explanation: option.explanation };
}

interactionRenderers.set("micro-task", {
  validateConfig({ question, options, answer }) {
    if (!hasText(question) || !Array.isArray(options) || options.length < 2 || options.length > 4 ||
        !Number.isInteger(answer) || answer < 0 || answer >= options.length) return false;
    const choices = Array.from(options);
    return choices.every((choice) => hasText(choice?.label) && hasText(choice?.explanation)) &&
      new Set(choices.map(({ label }) => label.trim())).size === choices.length;
  },

  render(definition, values) {
    const { question, options } = definition.config;
    return {
      controls: `<fieldset class="practice-fieldset practice-micro-task">
        <legend>${escapeHtml(question)}</legend>
        ${choiceButtons("micro-answer", options.map(({ label }, index) => [String(index), escapeHtml(label)]), values.microAnswer)}
      </fieldset>`,
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    if (event.type !== "click" || control.dataset.interactionAction !== "micro-answer") return;
    const { choice } = control.dataset;
    const { correct, explanation } = evaluateMicroTask(definition, Number(choice));
    values.microAnswer = choice;
    updatePressedChoices(panel, "micro-answer", choice);
    feedback(`${correct ? "Верно." : "Попробуйте ещё раз."} ${explanation}`);
    if (correct) complete();
  },
});

const resonancePredictions = new Map([
  ["decrease", "Пик уменьшится"],
  ["same", "Пик останется прежним"],
  ["increase", "Пик вырастет"],
]);

function resonanceSettings(definition, values) {
  return Object.fromEntries(resonanceControls.map((control) => {
    const initial = clampLabNumber(definition.config?.[control.configKey], control);
    return [control.key, clampLabNumber(values[control.key], { ...control, initial })];
  }));
}

function resonanceDisplayState({ excitation, mass, stiffness, damping }) {
  const frequencyRatio = excitation / Math.sqrt(stiffness / mass);
  const { amplitudeRatio, explanation } = resonanceResponse({ frequencyRatio, damping });
  const height = 38 * Math.sqrt(amplitudeRatio / 25);
  const points = Array.from({ length: 121 }, (_, index) => {
    const time = index / 120;
    const y = 60 - height * Math.sin(time * Math.PI * 6 * excitation);
    return `${(92 + 178 * time).toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return {
    ratio: labNumber.format(frequencyRatio),
    amplitude: labNumber.format(amplitudeRatio),
    explanation,
    points,
    motion: `--practice-travel:${(height * 0.7).toFixed(2)}px;--practice-period:${(1.2 / excitation).toFixed(2)}s`,
  };
}

function renderResonanceDisplay(readoutId, { ratio, amplitude, explanation, points, motion }) {
  return `<figure class="practice-figure">
      <svg class="practice-diagram" viewBox="0 0 282 120" role="img" aria-label="Колеблющаяся масса и график смещения во времени" aria-describedby="${readoutId}">
        <rect x="7" y="16" width="70" height="88" rx="5" fill="#15364c" stroke="#83a3b2"/>
        <path d="M7 60H77 M92 60H272" stroke="#83a3b2" stroke-dasharray="4 4"/>
        <path d="M92 16V104H272 M136 16V104 M181 16V104 M225 16V104 M270 16V104" fill="none" stroke="#486677"/>
        <g class="practice-resonance-mass" data-resonance-mass style="${motion}">
          <rect x="20" y="47" width="44" height="26" rx="3" fill="#f4a261"/>
          <path d="M32 57H52 M32 63H52" stroke="#15364c" stroke-width="2"/>
        </g>
        <polyline data-resonance-wave points="${points}" fill="none" stroke="#a5e0d6" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </svg>
      <figcaption>Смещение во времени. Масштаб по высоте сжат для наглядности.</figcaption>
    </figure>
    <dl id="${readoutId}" class="practice-readouts">
      <div><dt>Отношение частот <var>f</var>/<var>f</var><sub>0</sub></dt><dd data-resonance-ratio>${ratio}</dd></div>
      <div><dt>Относительная амплитуда</dt><dd data-resonance-amplitude>${amplitude}</dd></div>
    </dl>
    <p data-resonance-explanation>${explanation}</p>
    <p class="practice-instructions">Учебная модель показывает только относительные величины. Для расчёта реального агрегата нужны его параметры и отдельная инженерная модель.</p>`;
}

interactionRenderers.set("resonance", {
  validateConfig(config) {
    return validNumberSettings(config, resonanceControls.map(({ configKey }) => configKey));
  },

  render(definition, values) {
    const settings = resonanceSettings(definition, values);
    const sliders = resonanceControls.map(({ key, label, min, max, step }) => {
      const id = `practice-${escapeHtml(definition.id)}-${key}`;
      return `<div class="practice-slider">
        <div class="practice-slider-label">
          <label for="${id}">${label}</label>
          <span data-resonance-value="${key}" aria-hidden="true">${labNumber.format(settings[key])}</span>
        </div>
        <input id="${id}" type="range" data-interaction-action="${key}"
          min="${min}" max="${max}" step="${step}" value="${settings[key]}">
      </div>`;
    }).join("");
    return {
      controls: `<fieldset class="practice-fieldset">
          <legend>Что произойдёт с пиком при усилении демпфирования?</legend>
          ${choiceButtons("resonance-prediction", resonancePredictions, values.prediction)}
        </fieldset>`,
      afterFeedback: `<p class="practice-instructions">Выставьте отношение частот около 1 и сравните амплитуды при слабом и сильном демпфировании.</p>
        ${sliders}`,
      display: renderResonanceDisplay(`practice-${escapeHtml(definition.id)}-readouts`, resonanceDisplayState(settings)),
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    const action = control.dataset.interactionAction;
    if (event.type === "click" && action === "resonance-prediction") {
      const choice = control.dataset.choice;
      if (!resonancePredictions.has(choice)) return;
      values.prediction = choice;
      updatePressedChoices(panel, action, choice);
      if (choice === "decrease") {
        feedback("Верно. Усиление демпфирования понижает пик амплитуды.");
        complete();
      } else {
        feedback("Демпфирование рассеивает энергию. При его усилении пик снижается. Сравните амплитуды на модели.");
      }
      return;
    }

    if (!["input", "change"].includes(event.type) || !resonanceControls.some(({ key }) => key === action)) return;
    values[action] = control.valueAsNumber;
    const settings = resonanceSettings(definition, values);
    const { ratio, amplitude, explanation, points, motion } = resonanceDisplayState(settings);
    panel.querySelector(`[data-resonance-value="${action}"]`).textContent = labNumber.format(settings[action]);
    panel.querySelector("[data-resonance-ratio]").textContent = ratio;
    panel.querySelector("[data-resonance-amplitude]").textContent = amplitude;
    panel.querySelector("[data-resonance-explanation]").textContent = explanation;
    panel.querySelector("[data-resonance-wave]").setAttribute("points", points);
    panel.querySelector("[data-resonance-mass]").setAttribute("style", motion);
    if (event.type === "change") feedback(`Отношение частот ${ratio}. Относительная амплитуда ${amplitude}. ${explanation}`);
  },
});

const sensorLocations = { bearing: 99, coupling: 150, "second-bearing": 221 };
const sensorQuality = { good: "Подходящее измерение", limited: "Признак виден частично", poor: "Слабая чувствительность к признаку" };
const sensorFieldLabels = { scenario: "Предполагаемый дефект", location: "Точка измерения", direction: "Направление" };

function renderSensorDisplay(selection, { quality, sees, misses, explanation }) {
  const { location, direction } = selection;
  const sensorX = sensorLocations[location];
  const arrow = direction === "radial" ? "M0 -11V-34 M-5 -28L0 -34L5 -28" : "M10 0H35 M29 -5L35 0L29 5";
  const position = sensorChoices.location.get(location);
  const axis = sensorChoices.direction.get(direction);
  return `<figure class="practice-figure">
      <svg class="practice-diagram" viewBox="0 0 300 152" role="img"
        aria-label="Двигатель, муфта и две опоры. Датчик: ${position}, ${axis.toLowerCase()}">
        <path d="M14 130H288" stroke="#83a3b2" stroke-width="2"/>
        <path d="M64 85H248" stroke="#a5e0d6" stroke-width="8"/>
        <rect x="18" y="61" width="67" height="57" rx="10" fill="#15364c" stroke="#83a3b2" stroke-width="2"/>
        <path d="M33 75H70 M33 84H70 M33 93H70 M33 102H70 M33 118V130 M70 118V130"
          fill="none" stroke="#83a3b2" stroke-width="2"/>
        <path d="M232 110V71L246 58H275L284 72V110Z M250 110V130 M273 110V130" fill="#15364c" stroke="#83a3b2" stroke-width="2"/>
        <path d="M88 130V75H110V130 M210 130V75H232V130 M126 100V68H174V100Z"
          fill="#15364c" stroke="#a5e0d6" stroke-width="2"/>
        <path d="M139 76V94 M161 76V94" stroke="#83a3b2" stroke-width="3"/>
        <path d="M99 58V75 M150 58V68 M221 58V75" stroke="#83a3b2" stroke-width="2"/>
        <circle cx="99" cy="58" r="4" fill="#a5e0d6"/><circle cx="150" cy="58" r="4" fill="#a5e0d6"/>
        <circle cx="221" cy="58" r="4" fill="#a5e0d6"/>
        <g transform="translate(${sensorX} 58)" fill="none" stroke="#f4a261" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="-7" y="-7" width="14" height="14" rx="3" fill="#f4a261"/>
          <path d="${arrow}"/>
        </g>
      </svg>
      <figcaption><strong>${position}, ${axis.toLowerCase()}.</strong> Датчик ставят на неподвижный корпус.</figcaption>
    </figure>
    <p class="practice-result">${sensorQuality[quality]}</p>
    <dl class="practice-readouts">
      <div><dt>Что видно</dt><dd>${sees}</dd></div>
      <div><dt>Что можно пропустить</dt><dd>${misses}</dd></div>
    </dl>
    <p>${explanation}</p>`;
}

interactionRenderers.set("sensor-placement", {
  validateConfig(config) {
    return Object.entries(sensorChoices).every(([key, choices]) => !Object.hasOwn(config, key) || choices.has(config[key]));
  },

  render(definition, values) {
    const selection = sensorSelection(values, definition.config);
    const controls = Object.entries(sensorChoices).map(([key, choices]) =>
      `<fieldset class="practice-fieldset">
        <legend>${sensorFieldLabels[key]}</legend>
        ${choiceButtons(key, choices, selection[key])}
      </fieldset>`
    ).join("");
    return {
      controls: `${controls}<button class="practice-choice" type="button" data-interaction-action="sensor-check">Проверить измерение</button>`,
      display: renderSensorDisplay(selection, evaluateSensorPlacement(selection)),
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    const action = control.dataset.interactionAction;
    const choice = control.dataset.choice;
    if (event.type !== "click") return;
    if (action === "sensor-check") {
      const result = evaluateSensorPlacement(sensorSelection(values, definition.config));
      const correct = result.quality === "good";
      feedback(`${correct ? "Верно." : "Попробуйте другую точку или направление."} ${result.explanation}`);
      if (correct) complete();
      return;
    }
    if (!Object.hasOwn(sensorChoices, action) || !sensorChoices[action].has(choice)) return;
    values[action] = choice;
    const selection = sensorSelection(values, definition.config);
    const result = evaluateSensorPlacement(selection);
    updatePressedChoices(panel, action, choice);
    panel.querySelector(".practice-display").innerHTML = renderSensorDisplay(selection, result);
    feedback(`${sensorQuality[result.quality]}. ${result.sees} Можно пропустить ${result.misses[0].toLowerCase()}${result.misses.slice(1)}`);
  },
});

const chartNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function formatHz(value) {
  return `${chartNumber.format(value)} Гц`;
}

function samplingSettings(definition, values) {
  return Object.fromEntries(samplingControls.map((control) => {
    const initial = clampLabNumber(definition.config?.[control.key], control);
    return [control.key, Math.round(clampLabNumber(values[control.key], { ...control, initial }))];
  }));
}

function nyquistOptions(signalHz) {
  return new Map([1, 2, 4].map((factor) => [String(factor), formatHz(factor * signalHz)]));
}

function samplingStatus({ signalHz, sampleHz }, { aliases, apparentHz }) {
  if (aliases) return `Алиасинг. По отсчётам сигнал выглядит как ${formatHz(apparentHz)}.`;
  if (sampleHz === 2 * signalHz) return "Ровно на границе условия Найквиста. В этой модели частота совпадает с исходной, но на границе результат зависит от фазы сигнала.";
  return "Условие Найквиста выполнено. Кажущаяся частота совпадает с исходной.";
}

const samplingX = (seconds) => 50 + 232 * seconds / samplingWindowSeconds;
const samplingY = (amplitude) => 83 - 47 * amplitude;

function samplingWavePoints(frequency) {
  return Array.from({ length: 161 }, (_, index) => {
    const time = samplingWindowSeconds * index / 160;
    const amplitude = Math.cos(2 * Math.PI * frequency * time);
    return `${samplingX(time).toFixed(2)},${samplingY(amplitude).toFixed(2)}`;
  }).join(" ");
}

function renderSamplingDisplay(settings, readoutId) {
  const { signalHz, sampleHz } = settings;
  const model = samplingModel(settings);
  const { samples, apparentHz, aliases } = model;
  const dots = samples.map(({ time, amplitude }) =>
    `<circle data-sampling-point cx="${samplingX(time).toFixed(2)}" cy="${samplingY(amplitude).toFixed(2)}" r="2.8"/>`
  ).join("");
  return `<figure class="practice-figure practice-chart-figure">
      <svg class="practice-diagram practice-chart" viewBox="0 -8 300 240" role="img"
        aria-label="График исходной волны, отсчётов и кажущейся волны" aria-describedby="${readoutId}">
        <path class="practice-chart-grid" d="M50 36H282 M50 83H282 M50 130H282 M282 36V138"/>
        <path class="practice-chart-grid practice-chart-detail" d="M166 36V138"/>
        <path class="practice-chart-axis" d="M50 36V138H288 M47 36H50 M47 83H50 M47 130H50"/>
        <g class="practice-chart-text">
          <text class="practice-chart-detail" x="50" y="28">Амплитуда, отн. ед.</text>
          <text class="practice-chart-compact" x="50" y="28">Ампл., отн. ед.</text>
          <text x="45" y="36" text-anchor="end" dominant-baseline="middle">1</text>
          <text x="45" y="83" text-anchor="end" dominant-baseline="middle">0</text>
          <text x="45" y="130" text-anchor="end" dominant-baseline="middle">−1</text>
          <text x="50" y="169">0</text>
          <text class="practice-chart-detail" x="166" y="169" text-anchor="middle">0,25</text>
          <text x="282" y="169" text-anchor="end">0,5</text>
          <text x="282" y="216" text-anchor="end">Время, с</text>
        </g>
        <polyline class="practice-sampling-original" data-sampling-original points="${samplingWavePoints(signalHz)}"/>
        <polyline class="practice-sampling-apparent" data-sampling-apparent points="${samplingWavePoints(apparentHz)}"/>
        <g class="practice-sampling-points">${dots}</g>
      </svg>
      <figcaption class="practice-chart-legend">
        <span class="practice-key-original">Исходная волна</span>
        <span class="practice-key-samples">Отсчёты</span>
        <span class="practice-key-apparent">Кажущаяся волна</span>
      </figcaption>
    </figure>
    <div id="${readoutId}">
      <p class="practice-result" data-sampling-status="${model.status}">${samplingStatus(settings, model)}</p>
      <dl class="practice-readouts">
        <div><dt>Исходная частота</dt><dd>${formatHz(signalHz)}</dd></div>
        <div><dt>Кажущаяся частота</dt><dd>${formatHz(apparentHz)}${apparentHz === 0 ? " (постоянный уровень)" : ""}</dd></div>
        <div><dt>Частота Найквиста (половина частоты отсчётов)</dt><dd>${formatHz(sampleHz / 2)}</dd></div>
      </dl>
      ${aliases ? "<p>Разные исходные волны могут давать одинаковые отсчёты.</p>" : ""}
    </div>`;
}

const samplingReadoutId = (definition) => `practice-${escapeHtml(definition.id)}-sampling-readouts`;

interactionRenderers.set("sampling", {
  validateConfig(config) {
    return validNumberSettings(config, samplingControls.map(({ key }) => key));
  },

  render(definition, values) {
    const settings = samplingSettings(definition, values);
    const sliders = samplingControls.map(({ key, label, min, max, step }) => {
      const id = `practice-${escapeHtml(definition.id)}-${key}`;
      return `<div class="practice-slider">
        <div class="practice-slider-label">
          <label for="${id}">${label}</label>
          <span data-sampling-value="${key}" aria-hidden="true">${formatHz(settings[key])}</span>
        </div>
        <input id="${id}" type="range" data-interaction-action="${key}"
          min="${min}" max="${max}" step="${step}" value="${settings[key]}">
      </div>`;
    }).join("");
    return {
      controls: `${sliders}
        <fieldset class="practice-fieldset">
          <legend>Минимальная частота дискретизации для сигнала ${formatHz(settings.signalHz)}</legend>
          ${choiceButtons("sampling-answer", nyquistOptions(settings.signalHz), values.samplingAnswer)}
        </fieldset>`,
      display: renderSamplingDisplay(settings, samplingReadoutId(definition)),
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    const action = control.dataset.interactionAction;
    const { signalHz } = samplingSettings(definition, values);
    if (event.type === "click" && action === "sampling-answer") {
      const choice = control.dataset.choice;
      if (!nyquistOptions(signalHz).has(choice)) return;
      values.samplingAnswer = choice;
      updatePressedChoices(panel, action, choice);
      if (choice === "2") {
        feedback(`Верно. Теоретический минимум для ${formatHz(signalHz)} составляет ${formatHz(2 * signalHz)}. Для измерений частоту выбирают с запасом.`);
        complete();
      } else if (choice === "1") {
        feedback(`Частота отсчётов ниже границы ${formatHz(2 * signalHz)}. Возникает алиасинг, и в записи появляется ложная частота.`);
      } else {
        feedback(`Эта частота подходит. Теоретический минимум ниже и равен ${formatHz(2 * signalHz)}.`);
      }
      return;
    }

    if (!["input", "change"].includes(event.type) || !samplingControls.some(({ key }) => key === action)) return;
    values[action] = control.valueAsNumber;
    const settings = samplingSettings(definition, values);
    if (settings.signalHz !== signalHz) {
      delete values.samplingAnswer;
      const options = nyquistOptions(settings.signalHz);
      const fieldset = panel.querySelector(".practice-fieldset");
      fieldset.querySelector("legend").textContent = `Минимальная частота дискретизации для сигнала ${formatHz(settings.signalHz)}`;
      for (const button of fieldset.querySelectorAll("button")) {
        button.textContent = options.get(button.dataset.choice);
        button.setAttribute("aria-pressed", "false");
      }
    }
    panel.querySelector(`[data-sampling-value="${action}"]`).textContent = formatHz(settings[action]);
    panel.querySelector(".practice-display").innerHTML = renderSamplingDisplay(settings, samplingReadoutId(definition));
    if (event.type === "change") feedback(samplingStatus(settings, samplingModel(settings)));
  },
});

const spectrumComponents = new Map([
  ["1x", "1× частота вращения"],
  ["2x", "2× частота вращения"],
  ["harmonics", "Высшие гармоники (3× и 4×)"],
  ["sub-synchronous", "Субсинхронная составляющая (0,5×)"],
  ["high-frequency", "Высокочастотная составляющая (8×)"],
]);

function spectrumSelection(definition, values) {
  const configured = Array.isArray(definition.config?.activeComponents) ? definition.config.activeComponents : ["1x"];
  const selected = Array.isArray(values.activeComponents) ? values.activeComponents : configured;
  return new Set(selected.filter((component) => spectrumComponents.has(component)));
}

function renderSpectrumDisplay(peaks, readoutId) {
  const bars = peaks.map(({ frequencyOrder, amplitude }) => {
    const x = 50 + 29 * frequencyOrder;
    const top = 138 - 102 * amplitude;
    return `<path class="practice-spectrum-peak" d="M${x} 138V${top}" data-spectrum-order="${frequencyOrder}"/>`;
  }).join("");
  const readouts = peaks.map(({ label, amplitude }) =>
    `<div><dt>${label}</dt><dd>${chartNumber.format(amplitude)} отн. ед.</dd></div>`
  ).join("");
  return `<figure class="practice-figure practice-chart-figure">
      <svg class="practice-diagram practice-chart" viewBox="0 -8 300 240" role="img"
        aria-label="Амплитудный спектр по порядкам частоты вращения" aria-describedby="${readoutId}">
        <path class="practice-chart-grid" d="M50 36H282 M50 87H282 M166 36V138 M282 36V138"/>
        <path class="practice-chart-grid practice-chart-detail" d="M108 36V138 M224 36V138"/>
        <path class="practice-chart-axis" d="M50 36V138H288 M47 36H50 M47 87H50"/>
        <g class="practice-chart-text">
          <text class="practice-chart-detail" x="50" y="28">Амплитуда, отн. ед.</text>
          <text class="practice-chart-compact" x="50" y="28">Ампл., отн. ед.</text>
          <text x="45" y="36" text-anchor="end" dominant-baseline="middle">1</text>
          <text x="45" y="87" text-anchor="end" dominant-baseline="middle">0,5</text>
          <text x="50" y="169">0</text>
          <text class="practice-chart-detail" x="108" y="169" text-anchor="middle">2×</text>
          <text x="166" y="169" text-anchor="middle">4×</text>
          <text class="practice-chart-detail" x="224" y="169" text-anchor="middle">6×</text>
          <text x="282" y="169" text-anchor="end">8×</text>
          <text x="282" y="216" text-anchor="end">Порядок частоты</text>
        </g>
        ${bars}
      </svg>
      <figcaption>Порядок показывает, во сколько раз частота пика выше или ниже частоты вращения. 1× соответствует частоте вращения.</figcaption>
    </figure>
    <div id="${readoutId}">
      ${readouts ? `<dl class="practice-readouts practice-spectrum-readouts">${readouts}</dl>` : "<p>Спектр пуст. Включите составляющие, чтобы увидеть пики.</p>"}
    </div>
    <p class="practice-instructions">По одному спектральному признаку диагноз не ставят. Сопоставьте его с режимом работы, направлением измерения и дополнительными проверками.</p>`;
}

const spectrumReadoutId = (definition) => `practice-${escapeHtml(definition.id)}-spectrum-readouts`;

interactionRenderers.set("spectrum", {
  validateConfig(config) {
    if (!Object.hasOwn(config, "activeComponents")) return true;
    return Array.isArray(config.activeComponents) &&
      Array.from(config.activeComponents).every((component) => spectrumComponents.has(component));
  },

  render(definition, values) {
    const active = spectrumSelection(definition, values);
    return {
      controls: `<fieldset class="practice-fieldset">
          <legend>Составляющие спектра</legend>
          ${choiceButtons("spectrum-toggle", spectrumComponents, active)}
        </fieldset>
        <fieldset class="practice-fieldset">
          <legend>К какой составляющей относится самый высокий пик?</legend>
          ${choiceButtons("spectrum-answer", spectrumComponents, values.spectrumAnswer)}
        </fieldset>`,
      display: renderSpectrumDisplay(buildSpectrum([...active]), spectrumReadoutId(definition)),
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    const action = control.dataset.interactionAction;
    const choice = control.dataset.choice;
    if (event.type !== "click" || !spectrumComponents.has(choice)) return;
    const active = spectrumSelection(definition, values);
    if (action === "spectrum-toggle") {
      const enabled = !active.delete(choice);
      if (enabled) active.add(choice);
      values.activeComponents = [...active];
      delete values.spectrumAnswer;
      const peaks = buildSpectrum(values.activeComponents);
      control.setAttribute("aria-pressed", String(enabled));
      updatePressedChoices(panel, "spectrum-answer", undefined);
      panel.querySelector(".practice-display").innerHTML = renderSpectrumDisplay(peaks, spectrumReadoutId(definition));
      const peakSummary = peaks.map(({ label, amplitude }) => `${label}: ${chartNumber.format(amplitude)}`).join("; ");
      feedback(peaks.length ? `Амплитуды пиков в относительных единицах. ${peakSummary}.` : "Спектр пуст. Включите составляющие, чтобы увидеть пики.");
    } else if (action === "spectrum-answer") {
      if (active.size < 2) {
        feedback("Включите хотя бы две составляющие, чтобы сравнить высоты пиков.");
        return;
      }
      const peaks = buildSpectrum([...active]);
      const dominant = peaks.reduce((highest, peak) => peak.amplitude > highest.amplitude ? peak : highest);
      values.spectrumAnswer = choice;
      updatePressedChoices(panel, action, choice);
      if (choice === dominant.category) {
        feedback(`Верно. Пик ${dominant.label} самый высокий. По одному спектральному признаку диагноз не ставят.`);
        complete();
      } else {
        const reason = active.has(choice)
          ? "Пики выбранной составляющей ниже самого высокого."
          : "Выбранная составляющая выключена, поэтому её пиков на графике нет.";
        feedback(`${reason} Сравните высоты включённых пиков.`);
      }
    }
  },
});

const balanceTarget = 0.35;
const balanceLimit = 4;
const balanceCenter = 128;
const balanceTargetLabel = `${chartNumber.format(balanceTarget)} отн. ед.`;

function formatAngle(angle) {
  return `${wrapBalanceAngle(Math.round(angle))}°`;
}

function balanceSettings(definition, values) {
  return {
    heavyAngle: wrapBalanceAngle(definition.config?.heavyAngle),
    trialAngle: wrapBalanceAngle(Math.round(wrapBalanceAngle(values.trialAngle, definition.config?.trialAngle))),
    trialMagnitude: clampLabNumber(definition.config?.trialMagnitude, { min: 0, max: Number.MAX_VALUE, initial: 1 }),
  };
}

function balanceVector(style, angle, length) {
  const radians = angle * Math.PI / 180;
  const x = balanceCenter + length * Math.cos(radians);
  const y = balanceCenter - length * Math.sin(radians);
  const tip = style === "after"
    ? `<rect x="${(x - 4).toFixed(2)}" y="${(y - 4).toFixed(2)}" width="8" height="8"/>`
    : `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4"/>`;
  return `<g class="practice-balance-${style}">
    <line x1="${balanceCenter}" y1="${balanceCenter}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>
    ${tip}
  </g>`;
}

function renderBalanceDisplay(definition, values) {
  const { heavyAngle, trialAngle, trialMagnitude } = balanceSettings(definition, values);
  const { lastBalance, balanceAttempts = 0 } = values;
  const greatestLength = 1 + trialMagnitude;
  const radius = 83;
  const readoutId = `practice-${escapeHtml(definition.id)}-balance-readouts`;
  const residual = lastBalance
    ? `${chartNumber.format(lastBalance.amplitude)} отн. ед., ${lastBalance.amplitude === 0 ? "фаза не определяется" : `фаза ${formatAngle(lastBalance.phase)}`}`
    : "Выполните первую пробу.";
  return `<figure class="practice-figure">
    <div class="practice-balance-dial">
      <svg class="practice-diagram" viewBox="0 0 256 256" role="img" aria-label="Круговая схема векторов 1×"
        aria-describedby="${readoutId}" data-interaction-action="balance-dial">
        <g class="practice-balance-grid">
          <circle cx="128" cy="128" r="42"/>
          <circle cx="128" cy="128" r="86"/>
          <path d="M34 128H222 M128 34V222"/>
        </g>
        ${balanceVector("before", heavyAngle, radius / greatestLength)}
        ${lastBalance ? balanceVector("after", lastBalance.phase, lastBalance.amplitude / greatestLength * radius) : ""}
        ${balanceVector("trial", trialAngle, trialMagnitude / greatestLength * radius)}
      </svg>
      <div class="practice-balance-degrees" aria-hidden="true">
        <span>90°</span><span>180°</span><span>0°</span><span>270°</span>
      </div>
    </div>
    <figcaption>Длина вектора показывает амплитуду, направление показывает фазу.</figcaption>
  </figure>
  <dl class="practice-readouts" id="${readoutId}">
    <div><dt class="practice-balance-key practice-balance-before">До пробы</dt><dd>1 отн. ед., фаза ${formatAngle(heavyAngle)}</dd></div>
    <div><dt class="practice-balance-key practice-balance-trial">Выбранный пробный угол</dt><dd>${formatAngle(trialAngle)}</dd></div>
    <div><dt class="practice-balance-key practice-balance-after">После последней пробы</dt><dd data-balance-residual>${residual}</dd>
      ${lastBalance ? `<dd>Пробный угол ${formatAngle(lastBalance.trialAngle)}</dd>` : ""}
    </div>
    <div><dt>Попытки</dt><dd data-balance-attempts>${balanceAttempts} / ${balanceLimit}</dd></div>
  </dl>`;
}

interactionRenderers.set("balancing", {
  validateConfig(config) {
    if (!validNumberSettings(config, ["heavyAngle", "trialAngle", "trialMagnitude"])) return false;
    const settings = balanceSettings({ config }, {});
    // The minimum lies at a whole-degree angle nearest the opposing direction.
    const opposite = settings.heavyAngle + 180;
    return [Math.floor(opposite), Math.ceil(opposite)].some((trialAngle) =>
      balanceAttempt({ ...settings, trialAngle }).amplitude <= balanceTarget);
  },

  render(definition, values) {
    const { trialAngle, trialMagnitude } = balanceSettings(definition, values);
    const angleId = `practice-${escapeHtml(definition.id)}-balance-angle`;
    return {
      controls: `<p class="practice-instructions">Снизьте амплитуду 1× до ${balanceTargetLabel} или ниже за ${balanceLimit} пробы.
          Угол можно выбрать на круге, ползунком или кнопками.</p>
        <div class="practice-slider">
          <div class="practice-slider-label">
            <label for="${angleId}">Пробный угол</label>
            <span data-balance-angle aria-hidden="true">${formatAngle(trialAngle)}</span>
          </div>
          <input id="${angleId}" type="range" min="0" max="359" step="1" value="${trialAngle}"
            aria-valuetext="${formatAngle(trialAngle)}" data-interaction-action="balance-angle">
        </div>
        <div class="practice-balance-actions">
          <button class="practice-choice" type="button" data-interaction-action="balance-step" data-choice="-15"
            aria-label="Уменьшить угол на 15 градусов">−15°</button>
          <button class="practice-choice" type="button" data-interaction-action="balance-step" data-choice="15"
            aria-label="Увеличить угол на 15 градусов">+15°</button>
        </div>
        <button class="practice-choice practice-balance-apply" type="button" data-interaction-action="balance-apply"
          aria-disabled="${values.balanceAttempts >= balanceLimit}">Выполнить пробу</button>
        <p class="practice-instructions">Длина пробного вектора ${chartNumber.format(trialMagnitude)} отн. ед.
          Учебная модель складывает два вектора в одной плоскости. Для реальной балансировки используют измерения и расчёт по ним.</p>`,
      display: renderBalanceDisplay(definition, values),
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    const action = control.dataset.interactionAction;
    const settings = balanceSettings(definition, values);
    if (event.type === "click" && action === "balance-apply") {
      if ((values.balanceAttempts ?? 0) >= balanceLimit) return;
      const result = balanceAttempt(settings);
      values.lastBalance = { amplitude: result.amplitude, phase: result.phase, trialAngle: settings.trialAngle };
      values.balanceAttempts = (values.balanceAttempts ?? 0) + 1;
      const reachedTarget = result.amplitude <= balanceTarget;
      const reason = reachedTarget
        ? "Цель достигнута. Векторы направлены почти навстречу друг другу и ослабляют суммарное колебание."
        : result.improved
          ? "Амплитуда снизилась. Попробуйте направить пробный вектор ближе к противоположному."
          : "Амплитуда не снизилась. Чем ближе направления векторов, тем сильнее они складываются.";
      const limit = !reachedTarget && values.balanceAttempts === balanceLimit ? " Сбросьте упражнение, чтобы начать заново." : "";
      feedback(`Амплитуда ${chartNumber.format(result.amplitude)} отн. ед. ${reason}${limit}`);
      control.setAttribute("aria-disabled", String(values.balanceAttempts === balanceLimit));
      if (reachedTarget) complete();
    } else {
      let angle;
      if (event.type === "click" && action === "balance-dial") {
        const transform = control.getScreenCTM();
        if (!transform) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
        const x = point.x - balanceCenter;
        const y = balanceCenter - point.y;
        if (Math.hypot(x, y) < 12) return;
        angle = Math.atan2(y, x) * 180 / Math.PI;
      } else if (event.type === "click" && action === "balance-step") {
        angle = settings.trialAngle + Number(control.dataset.choice);
      } else if (["input", "change"].includes(event.type) && action === "balance-angle") {
        angle = control.valueAsNumber;
      } else return;
      values.trialAngle = wrapBalanceAngle(Math.round(angle));
      const slider = panel.querySelector('[data-interaction-action="balance-angle"]');
      slider.value = values.trialAngle;
      slider.setAttribute("aria-valuetext", formatAngle(values.trialAngle));
      panel.querySelector("[data-balance-angle]").textContent = formatAngle(values.trialAngle);
      if (action !== "balance-angle" || event.type === "change") feedback(`Выбран пробный угол ${formatAngle(values.trialAngle)}.`);
    }
    panel.querySelector(".practice-display").innerHTML = renderBalanceDisplay(definition, values);
  },
});

const machineModes = new Map([
  ["normal", "Норма"],
  ["bearing", "Дефект подшипника"],
  ["gear", "Повреждение зуба"],
]);

const signalViews = new Map([
  ["waveform", "Временной сигнал"],
  ["spectrum", "Спектр"],
  ["envelope", "Огибающая"],
]);
const waveformPatterns = {
  normal: "Четыре одинаковых цикла за секунду. Поверх плавной волны видны мелкие быстрые колебания.",
  bearing: "Серии быстрых колебаний повторяются каждые 0,125 с на фоне плавной волны.",
  gear: "Быстрые колебания усиливаются и затихают с периодом 0,25 с.",
};
const machineNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

function machineMode(definition, values) {
  if (machineModes.has(values.machineMode)) return values.machineMode;
  const configured = definition.config?.mode;
  return machineModes.has(configured) ? configured : "normal";
}

const machineQuestion = (mode) => mode === "normal"
  ? "Где лучше видно устойчивое колебание?"
  : "В каком представлении дефект виден лучше?";

function machinePlot(id, name, mode, { marks, end, min, max, summary }) {
  return `<figure class="practice-figure practice-signal-figure">
    <figcaption><strong>${name}</strong></figcaption>
    <div class="practice-signal-plot">
      <div class="practice-signal-axis practice-signal-axis-y" aria-hidden="true">
        <span>${chartNumber.format(max)}</span><span>${chartNumber.format(min)}</span>
      </div>
      <svg class="practice-diagram practice-signal-chart" viewBox="0 0 300 90" preserveAspectRatio="none" role="img"
        aria-label="${name}. ${machineModes.get(mode)}" aria-describedby="${id}">
        <path class="practice-chart-grid" d="M4 2H296 M4 45H296 M4 88H296 M77 2V88 M150 2V88 M223 2V88 M296 2V88"/>
        <path class="practice-chart-axis" d="M4 2V88H296"/>
        ${marks}
      </svg>
      <div class="practice-signal-axis practice-signal-axis-x" aria-hidden="true">
        <span>0</span><span>${end}</span>
      </div>
    </div>
    <p id="${id}">${summary}</p>
  </figure>`;
}

function formatSignalRange(points) {
  const amplitudes = points.map(({ amplitude }) => amplitude);
  return `от ${machineNumber.format(Math.min(...amplitudes))} до ${machineNumber.format(Math.max(...amplitudes))} отн. ед.`;
}

function renderMachineDisplay(definition, mode, signal) {
  const prefix = `practice-${escapeHtml(definition.id)}-machine`;
  const end = `${chartNumber.format(machineWindowSeconds)} с`;
  const timeX = (time) => 4 + 292 * time / machineWindowSeconds;
  const sampleLine = (data, type, toY) => `<polyline class="practice-signal-trace practice-signal-${type}" data-machine-view="${type}"
    points="${data.map(({ time, amplitude }) => `${timeX(time).toFixed(2)},${toY(amplitude).toFixed(2)}`).join(" ")}"/>`;
  const waveform = machinePlot(`${prefix}-waveform`, signalViews.get("waveform"), mode, {
    marks: sampleLine(signal.waveform, "waveform", (amplitude) => 45 - 43 * amplitude),
    end,
    min: -1,
    max: 1,
    summary: `${waveformPatterns[mode]} Значения сигнала за ${end} ${formatSignalRange(signal.waveform)}`,
  });
  const peaks = signal.spectrum.map(({ frequencyHz, amplitude }) =>
    `${formatHz(frequencyHz)} (${machineNumber.format(amplitude)} отн. ед.)`);
  const spectrum = machinePlot(`${prefix}-spectrum`, signalViews.get("spectrum"), mode, {
    marks: signal.spectrum.map(({ frequencyHz, amplitude }) => {
      const x = (4 + 292 * frequencyHz / machineNyquistHz).toFixed(2);
      return `<path class="practice-signal-trace practice-signal-peak" data-machine-frequency="${frequencyHz}" d="M${x} 88V${(88 - 172 * amplitude).toFixed(2)}"/>`;
    }).join(""),
    end: formatHz(machineNyquistHz),
    min: 0,
    max: 0.5,
    summary: `Пики ${peaks.join(", ")}.`,
  });
  const bursts = signal.envelope.filter(({ amplitude }, index, samples) =>
    amplitude > samples.at(index - 1).amplitude && amplitude >= samples[(index + 1) % samples.length].amplitude).length;
  const envelope = machinePlot(`${prefix}-envelope`, signalViews.get("envelope"), mode, {
    marks: sampleLine(signal.envelope, "envelope", (amplitude) => 88 - 172 * amplitude),
    end,
    min: 0,
    max: 0.5,
    summary: bursts ? `В высокочастотной полосе ${bursts} всплесков за ${end}. Амплитуда ${formatSignalRange(signal.envelope)}`
      : `Амплитуда высокочастотной полосы постоянна (${machineNumber.format(signal.envelope[0].amplitude)} отн. ед.).`,
  });
  return `<p class="practice-machine-mode"><strong>${machineModes.get(mode)}</strong></p>
    ${waveform}${spectrum}${envelope}
    <p class="practice-instructions">Условные сигналы для сравнения. На оборудовании диагноз подтверждают измерениями и дополнительными проверками.</p>`;
}

function machineAnswerStatus(mode, choice, bestView) {
  if (choice !== bestView) return `Сравните с представлением «${signalViews.get(bestView)}».`;
  if (mode === "normal") return "Верно. Выберите режим с дефектом, чтобы выполнить практику.";
  return "Верно.";
}

interactionRenderers.set("bearing-gear", {

  validateConfig(config) {
    return !Object.hasOwn(config, "mode") || machineModes.has(config.mode);
  },

  render(definition, values) {
    const mode = machineMode(definition, values);
    const signal = machineSignal(mode);
    return {
      controls: `<fieldset class="practice-fieldset">
          <legend>Состояние машины</legend>
          ${choiceButtons("machine-mode", machineModes, mode)}
        </fieldset>
        <fieldset class="practice-fieldset">
          <legend data-machine-question>${machineQuestion(mode)}</legend>
          ${choiceButtons("machine-answer", signalViews, values.machineAnswer)}
        </fieldset>`,
      display: renderMachineDisplay(definition, mode, signal),
    };
  },

  handleEvent(event, { control, panel, definition, values, complete, feedback }) {
    if (event.type !== "click") return;
    const { interactionAction: action, choice } = control.dataset;
    if (action === "machine-mode" && machineModes.has(choice)) {
      if (machineMode(definition, values) === choice) return;
      values.machineMode = choice;
      delete values.machineAnswer;
      updatePressedChoices(panel, action, choice);
      updatePressedChoices(panel, "machine-answer", undefined);
      panel.querySelector("[data-machine-question]").textContent = machineQuestion(choice);
      panel.querySelector(".practice-display").innerHTML = renderMachineDisplay(definition, choice, machineSignal(choice));
      feedback(`Открыт режим «${machineModes.get(choice)}». Все три графика обновлены.`);
    } else if (action === "machine-answer" && signalViews.has(choice)) {
      const mode = machineMode(definition, values);
      const signal = machineSignal(mode);
      values.machineAnswer = choice;
      updatePressedChoices(panel, action, choice);
      feedback(`${machineAnswerStatus(mode, choice, signal.bestView)} ${signal.explanation}`);
      if (choice === signal.bestView && mode !== "normal") complete();
    }
  },
});
