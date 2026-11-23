export function rotationalFrequency(rpm) {
  const value = Number(rpm);
  return Number.isFinite(value) && value >= 0 ? value / 60 : null;
}

export function bladePassFrequency(rpm, blades) {
  const frequency = rotationalFrequency(rpm);
  const count = Number(blades);
  return frequency !== null && Number.isFinite(count) && count > 0 ? frequency * count : null;
}

export function meshFrequency(rpm, teeth) {
  return bladePassFrequency(rpm, teeth);
}

export function vibrationVelocity(frequencyHz, displacementPeakMm) {
  const frequency = Number(frequencyHz);
  const displacement = Number(displacementPeakMm);
  if (!Number.isFinite(frequency) || !Number.isFinite(displacement) || frequency < 0 || displacement < 0 || frequencyHz === "") return null;
  return 2 * Math.PI * frequency * displacement;
}

const DIAGNOSTICS = {
  "1x": {
    title: "Сильная составляющая 1X",
    causes: ["Дисбаланс", "Несоосность", "Прогиб ротора", "Ослабление крепления", "Резонанс", "Технологическая сила"],
    checks: ["Сравнить фазу на обеих опорах", "Проверить осевую вибрацию и центровку", "Посмотреть изменение при разгоне, выбеге и прогреве", "Проверить биение и крепления"],
    caution: "Одна компонента 1X не является диагнозом. Причину подтверждают независимой проверкой.",
  },
  "2x": {
    title: "Сильная составляющая 2X",
    causes: ["Несоосность", "Ослабление", "Нелинейная жёсткость", "Эллиптичность", "Контакт деталей"],
    checks: ["Измерить осевую вибрацию", "Сравнить фазы по обе стороны муфты", "Проверить мягкую лапу и крепления"],
    caution: "2X часто встречается при несоосности, но сама по себе её не доказывает.",
  },
  sub: {
    title: "Субсинхронная вибрация ниже 1X",
    causes: ["Масляный вихрь", "Масляный хлыст", "Аэродинамическая неустойчивость", "Вращающийся срыв", "Задевание"],
    checks: ["Определить направление прецессии", "Сравнить частоту со скоростью вращения", "Проверить давление газа, температуру и вязкость масла", "Записать разгон и выбег"],
    caution: "Нужно отделить влияние подшипника, потока и контакта по зависимости от режима.",
  },
  pressure: {
    title: "Низкочастотные колебания давления и расхода",
    causes: ["Помпаж", "Неустойчивая сеть", "Работа регулирующего клапана", "Пульсации поршневой машины"],
    checks: ["Сопоставить рабочую точку с картой компрессора", "Проверить последовательность давления, расхода и положения клапана", "Оценить возможный обратный поток"],
    caution: "Помпаж относится ко всей системе компрессор–сеть, поэтому одной вибрации недостаточно.",
  },
  impact: {
    title: "Удары и высокочастотная вибрация",
    causes: ["Дефект подшипника качения", "Задевание", "Ослабление", "Повреждение зуба", "Недостаток смазки"],
    checks: ["Посмотреть временную форму", "Выполнить анализ огибающей", "Проверить масло и фильтр", "Осмотреть крепления и зазоры"],
    caution: "Общий уровень скорости может оставаться нормальным на ранней стадии дефекта.",
  },
};

export function diagnose(symptom) {
  return DIAGNOSTICS[symptom] || DIAGNOSTICS["1x"];
}

function uniqueStringIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string"))] : [];
}

export function safeProgress(raw) {
  const fallback = { completed: [], mistakes: [], current: "chapter-1", interactionsCompleted: [] };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      completed: uniqueStringIds(parsed.completed),
      mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.filter((item) => typeof item === "string") : [],
      current: typeof parsed.current === "string" ? parsed.current : "chapter-1",
      interactionsCompleted: uniqueStringIds(parsed.interactionsCompleted),
    };
  } catch {
    return fallback;
  }
}

export function groupBlocks(blocks) {
  const groups = [];
  for (const block of blocks) {
    if (block.type === "text" && /^###\s+/.test(block.text)) {
      groups.push({ type: "subheading", text: block.text.replace(/^###\s+/, "") });
      continue;
    }
    const listType = block.type === "step" ? "step-list" : block.type === "bullet" ? "bullet-list" : null;
    const previous = groups[groups.length - 1];
    if (listType && previous?.type === listType) {
      previous.items.push(block.text);
    } else if (listType) {
      groups.push({ type: listType, items: [block.text] });
    } else {
      groups.push({ ...block });
    }
  }
  return groups;
}

const FORMULA_MARKUP = {
  "m x_ddot + c x_dot + k x = F(t)": "<var>m</var><var>ẍ</var> + <var>c</var><var>ẋ</var> + <var>k</var><var>x</var> = <var>F</var>(<var>t</var>)",
  "omega_n = sqrt(k / m)": "ω<sub>n</sub> = √(<var>k</var> / <var>m</var>)",
  "f_rot = n / 60": "<var>f</var><sub>rot</sub> = <var>n</var> / 60",
  "A_rms = A_peak / sqrt(2)": "<var>A</var><sub>rms</sub> = <var>A</var><sub>peak</sub> / √2",
  "v_peak = 2 pi f x_peak": "<var>v</var><sub>peak</sub> = 2π<var>f</var><var>x</var><sub>peak</sub>",
  "a_peak = (2 pi f)^2 x_peak": "<var>a</var><sub>peak</sub> = (2π<var>f</var>)<sup>2</sup><var>x</var><sub>peak</sub>",
  "f_s >= 2 f_max": "<var>f</var><sub>s</sub> ≥ 2<var>f</var><sub>max</sub>",
  "Delta f = 1 / T": "Δ<var>f</var> = 1 / <var>T</var>",
  "F = m e omega^2": "<var>F</var> = <var>m</var><var>e</var>ω<sup>2</sup>",
  "f_mesh = z f_rot": "<var>f</var><sub>mesh</sub> = <var>z</var><var>f</var><sub>rot</sub>",
};

export function formatFormula(formula) {
  const text = String(formula);
  return FORMULA_MARKUP[text] || text.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[character]);
}

