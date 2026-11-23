export function isInteractionId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isInteractionComplete(progress, interactionId) {
  const completed = progress?.interactionsCompleted;
  return isInteractionId(interactionId) && Array.isArray(completed) && completed.includes(interactionId);
}

export function completeInteraction(progress, interactionId) {
  if (!isInteractionId(interactionId) || isInteractionComplete(progress, interactionId)) return progress;
  const completed = progress?.interactionsCompleted;
  return {
    ...progress,
    interactionsCompleted: [...(Array.isArray(completed) ? completed : []), interactionId],
  };
}

export const resonanceControls = [
  { key: "excitation", configKey: "frequencyRatio", label: "Частота возбуждения (доля базовой частоты)", min: 0.2, max: 2, step: 0.01, initial: 0.6 },
  { key: "mass", configKey: "mass", label: "Масса (доля базовой массы)", min: 0.5, max: 2, step: 0.01, initial: 1 },
  { key: "stiffness", configKey: "stiffness", label: "Жёсткость (доля базовой жёсткости)", min: 0.5, max: 2, step: 0.01, initial: 1 },
  { key: "damping", configKey: "damping", label: "Доля критического демпфирования (безразмерная)", min: 0.02, max: 0.5, step: 0.01, initial: 0.1 },
];

const resonanceExplanations = {
  below: "Возбуждение медленнее собственных колебаний. При приближении к собственной частоте отклик может вырасти.",
  near: "Частоты близки. Слабое демпфирование даёт высокий пик, а усиление демпфирования снижает амплитуду.",
  above: "Возбуждение быстрее собственных колебаний. Вдали от резонанса отклик ослабевает.",
};

export function clampLabNumber(value, { min, max, initial }) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : initial;
}

export function resonanceResponse(input) {
  const frequencyRatio = clampLabNumber(input?.frequencyRatio, { min: 0.1, max: 4, initial: 0.6 });
  const damping = clampLabNumber(input?.damping, resonanceControls[3]);
  // Steady-state displacement relative to the static deflection under the same force.
  const amplitudeRatio = Math.min(25, 1 / Math.hypot(1 - frequencyRatio ** 2, 2 * damping * frequencyRatio));
  const zone = frequencyRatio < 0.85 ? "below" : frequencyRatio > 1.15 ? "above" : "near";
  return { amplitudeRatio, zone, explanation: resonanceExplanations[zone] };
}

export const sensorChoices = {
  scenario: new Map([
    ["imbalance", "Дисбаланс"],
    ["misalignment", "Несоосность"],
    ["bearing-defect", "Подозрение на дефект подшипника двигателя"],
  ]),
  location: new Map([
    ["bearing", "Опора двигателя"],
    ["coupling", "Корпус у муфты"],
    ["second-bearing", "Опора ведомой машины"],
  ]),
  direction: new Map([
    ["radial", "Радиально"],
    ["axial", "Осево"],
  ]),
};

const sensorScenarios = {
  imbalance: {
    diagnosis: "Сила от дисбаланса действует поперёк вала. Радиальное измерение на опоре улавливает отклик от этой силы.",
    good: {
      sees: "Радиальная составляющая 1× частоты вращения.",
      misses: "Осевую составляющую, которая помогает проверить другие причины.",
    },
    limited: {
      sees: "Переданную на корпус у муфты радиальную составляющую 1×.",
      misses: "Локальный отклик опоры, который нужен для сравнения амплитуды и фазы.",
    },
    poor: {
      sees: "Осевые колебания корпуса и часть переданной вибрации.",
      misses: "Основной радиальный отклик на частоте 1×.",
    },
  },
  misalignment: {
    diagnosis: "При несоосности полезно сравнивать осевые измерения на неподвижных корпусах по обе стороны муфты.",
    good: {
      sees: "Осевую составляющую 1× или 2× вблизи муфты.",
      misses: "Радиальные составляющие и фазу на другой стороне муфты.",
    },
    limited: {
      sees: "Осевые колебания, переданные на опору.",
      misses: "Отклик непосредственно у муфты и разность фаз между её сторонами.",
    },
    poor: {
      sees: "Радиальные составляющие 1× или 2×, которые встречаются при разных дефектах.",
      misses: "Осевой признак, полезный для проверки несоосности.",
    },
  },
  "bearing-defect": {
    diagnosis: "Короткие удары лучше улавливать на корпусе проверяемого подшипника. Соседние детали ослабляют высокочастотный сигнал.",
    good: {
      sees: "Высокочастотные удары возле подшипника, которые можно искать по огибающей.",
      misses: "Состояние подшипника на другой опоре.",
    },
    limited: {
      sees: "Часть ударов, переданных от проверяемого подшипника.",
      misses: "Слабые удары раннего дефекта, особенно при неблагоприятном направлении нагрузки.",
    },
    poor: {
      sees: "В основном вибрацию ближайшей к датчику опоры и общий фон машины.",
      misses: "Слабые высокочастотные удары от подшипника двигателя.",
    },
  },
};

export function sensorSelection(input, defaults) {
  return Object.fromEntries(Object.entries(sensorChoices).map(([key, choices]) => {
    const choice = input?.[key];
    const fallback = defaults?.[key];
    return [key, choices.has(choice) ? choice : choices.has(fallback) ? fallback : choices.keys().next().value];
  }));
}

export function evaluateSensorPlacement(input) {
  const { scenario, location, direction } = sensorSelection(input);
  const radial = direction === "radial";
  const atCoupling = location === "coupling";
  const atMotorBearing = location === "bearing";
  let quality = "poor";
  if (scenario === "imbalance" && radial) quality = atCoupling ? "limited" : "good";
  if (scenario === "misalignment" && !radial) quality = atCoupling ? "good" : "limited";
  if (scenario === "bearing-defect") {
    if (atMotorBearing) quality = radial ? "good" : "limited";
    else if (atCoupling) quality = "limited";
  }

  const { diagnosis, [quality]: { sees, misses } } = sensorScenarios[scenario];
  return { quality, sees, misses, explanation: diagnosis };
}

const defaultSamplingFrequencies = { signalHz: 8, sampleHz: 24 };
export const samplingWindowSeconds = 0.5;

export const samplingControls = [
  { key: "signalHz", label: "Частота сигнала, Гц", min: 2, max: 16, step: 1, initial: defaultSamplingFrequencies.signalHz },
  { key: "sampleHz", label: "Частота дискретизации, Гц", min: 4, max: 48, step: 1, initial: defaultSamplingFrequencies.sampleHz },
];

function positiveFrequency(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function samplingModel(input) {
  const signalHz = positiveFrequency(input?.signalHz, defaultSamplingFrequencies.signalHz);
  const sampleHz = positiveFrequency(input?.sampleHz, defaultSamplingFrequencies.sampleHz);
  const aliases = signalHz > sampleHz - signalHz;
  const remainder = signalHz % sampleHz;
  const apparentHz = aliases ? Math.min(remainder, sampleHz - remainder) : signalHz;
  const count = Math.min(256, Math.floor(sampleHz * samplingWindowSeconds) + 1);
  // A zero-phase cosine has identical samples at the original and folded frequencies.
  const cyclesPerSample = apparentHz / sampleHz;
  const samples = Array.from({ length: count }, (_, index) => ({
    time: index / sampleHz,
    amplitude: Math.cos(2 * Math.PI * cyclesPerSample * index),
  }));
  return { samples, apparentHz, aliases, status: aliases ? "aliasing" : "safe" };
}

// The 2× harmonic has its own toggle, so the higher harmonic group starts at 3×.
const spectrumPeaks = [
  { frequencyOrder: 0.5, amplitude: 0.68, label: "0,5×", category: "sub-synchronous" },
  { frequencyOrder: 1, amplitude: 0.78, label: "1×", category: "1x" },
  { frequencyOrder: 2, amplitude: 0.92, label: "2×", category: "2x" },
  { frequencyOrder: 3, amplitude: 0.56, label: "3×", category: "harmonics" },
  { frequencyOrder: 4, amplitude: 0.32, label: "4×", category: "harmonics" },
  { frequencyOrder: 8, amplitude: 0.84, label: "8×", category: "high-frequency" },
];

export function buildSpectrum(activeComponents) {
  const active = new Set(Array.isArray(activeComponents) ? activeComponents : []);
  return spectrumPeaks.filter(({ category }) => active.has(category)).map((peak) => ({ ...peak }));
}

const fullTurn = 2 * Math.PI;

export function wrapBalanceAngle(value, fallback = 0) {
  const angle = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;
  const remainder = angle % 360;
  return remainder < 0 ? (remainder + 360) % 360 : remainder + 0;
}

export function balanceAttempt(input) {
  const heavy = wrapBalanceAngle(input?.heavyAngle) * fullTurn / 360;
  const trial = wrapBalanceAngle(input?.trialAngle) * fullTurn / 360;
  const magnitude = clampLabNumber(input?.trialMagnitude, { min: 0, max: Number.MAX_VALUE, initial: 1 });
  // In the teaching model, the initial 1× vector has unit length.
  const x = Math.cos(heavy) + magnitude * Math.cos(trial);
  const y = Math.sin(heavy) + magnitude * Math.sin(trial);
  const length = Math.min(Number.MAX_VALUE, Math.hypot(x, y));
  const amplitude = length < 1e-12 ? 0 : length;
  const phase = amplitude === 0 ? 0 : wrapBalanceAngle(Math.atan2(y, x) * 360 / fullTurn);
  const score = 1 - Math.min(1, amplitude);
  return { amplitude, phase, improved: score > 1e-12, score };
}

const machineCases = new Map([
  ["normal", {
    bestView: "waveform",
    explanation: "Во временном сигнале видны устойчивые колебания. Огибающая почти постоянна, а возле частоты зацепления отсутствуют боковые полосы.",
  }],
  ["bearing", {
    bestView: "envelope",
    explanation: "Огибающая высокочастотной полосы показывает повторяющиеся всплески. Каждый всплеск соответствует серии быстрых колебаний после удара в этой модели.",
  }],
  ["gear", {
    bestView: "spectrum",
    explanation: "В спектре вокруг частоты зацепления 40 Гц видны боковые полосы с шагом 4 Гц. В этой модели так проявляется изменение амплитуды зацепления с частотой вращения.",
  }],
]);

const machineSampleRate = 256;
export const machineWindowSeconds = 1;
export const machineNyquistHz = machineSampleRate / 2;

function machineSpectrum(waveform) {
  const peaks = [];
  for (let bin = 1; bin <= waveform.length / 2; bin++) {
    const frequencyHz = bin / machineWindowSeconds;
    let real = 0;
    let imaginary = 0;
    for (const { time, amplitude } of waveform) {
      const angle = fullTurn * frequencyHz * time;
      real += amplitude * Math.cos(angle);
      imaginary += amplitude * Math.sin(angle);
    }
    const amplitude = Math.hypot(real, imaginary) * (bin === waveform.length / 2 ? 1 : 2) / waveform.length;
    if (amplitude >= 0.005) peaks.push({ frequencyHz, amplitude });
  }
  return peaks;
}

export function machineSignal(mode) {
  const scenario = machineCases.get(mode) ?? machineCases.get("normal");
  const envelope = Array.from({ length: machineSampleRate * machineWindowSeconds }, (_, index) => {
    const time = index / machineSampleRate;
    // Known demodulated amplitude of the isolated 96 Hz band in this synthetic signal.
    const amplitude = mode === "bearing" ? 0.03 + 0.46 * (0.5 + 0.5 * Math.cos(fullTurn * 8 * time)) ** 3 : 0.025;
    return { time, amplitude };
  });
  const waveform = envelope.map(({ time, amplitude }) => {
    const rotation = fullTurn * 4 * time;
    const meshAmplitude = mode === "gear" ? 0.3 + 0.2 * Math.cos(rotation) + 0.1 * Math.cos(2 * rotation) : 0.1;
    return {
      time,
      amplitude: 0.26 * Math.cos(rotation) + meshAmplitude * Math.cos(10 * rotation)
        + amplitude * Math.cos(fullTurn * 96 * time),
    };
  });
  return { waveform, spectrum: machineSpectrum(waveform), envelope, ...scenario };
}
