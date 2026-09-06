// Shared math and validation error used by the v2 cashflow engine.

export class ModelInputError extends Error {
  constructor(errors) {
    super(errors.join(" "));
    this.name = "ModelInputError";
    this.errors = errors;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanNumbers(values) {
  return values.filter(isFiniteNumber).sort((a, b) => a - b);
}

export function quantile(values, q) {
  const clean = cleanNumbers(values);
  if (!clean.length) return 0;
  if (q <= 0) return clean[0];
  if (q >= 1) return clean[clean.length - 1];

  const position = (clean.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return clean[lower];
  const weight = position - lower;
  return clean[lower] * (1 - weight) + clean[upper] * weight;
}

export function median(values) {
  return quantile(values, 0.5);
}

export function monthlyPayment(principal, annualRatePct, termMonths) {
  if (!isFiniteNumber(principal) || principal < 0) return 0;
  if (!isFiniteNumber(annualRatePct) || annualRatePct < 0) return 0;
  if (!Number.isInteger(termMonths) || termMonths <= 0) return 0;
  if (principal === 0) return 0;

  const monthlyRate = annualRatePct / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;

  const factor = (1 + monthlyRate) ** termMonths;
  return (principal * monthlyRate * factor) / (factor - 1);
}
