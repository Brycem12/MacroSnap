import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "macrosnap-shared-journal";
const STORE_KEY = "shared";
const MAX_BODY_BYTES = 1_000_000;
const MAX_MEALS = 5000;
const MAX_DELETIONS = 20000;
const DEFAULT_GOALS = { calories: 1900, protein: 180, carbs: 150, fat: 55 };
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function codesMatch(provided, expected) {
  const actualBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function numberInRange(value, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error("Invalid " + label + ".");
  return number;
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid sync data.");
  const rawGoals = raw.goals || DEFAULT_GOALS;
  const goals = {};
  for (const key of Object.keys(DEFAULT_GOALS)) {
    const value = Number(rawGoals[key]);
    if (!Number.isFinite(value) || value < 1 || value > 100000) throw new Error("Invalid goals.");
    goals[key] = value;
  }
  const rawMeals = raw.meals ?? [];
  if (!Array.isArray(rawMeals) || rawMeals.length > MAX_MEALS) throw new Error("Too many meals to sync.");
  const meals = rawMeals.map(meal => {
    if (!meal || typeof meal !== "object" || !ID_PATTERN.test(String(meal.id || ""))) throw new Error("Invalid meal entry.");
    const date = String(meal.date || "");
    const name = String(meal.name || "").trim();
    if (!Number.isFinite(Date.parse(date)) || !name || name.length > 100) throw new Error("Invalid meal entry.");
    return {
      id: meal.id,
      date,
      name,
      calories: numberInRange(meal.calories, 100000, "calories"),
      protein: numberInRange(meal.protein, 10000, "protein"),
      carbs: numberInRange(meal.carbs, 10000, "carbs"),
      fat: numberInRange(meal.fat, 10000, "fat"),
      notes: String(meal.notes || "").slice(0, 500)
    };
  });
  const rawDeleted = raw.deletedMealIds ?? [];
  if (!Array.isArray(rawDeleted) || rawDeleted.length > MAX_DELETIONS) throw new Error("Too many deletion records to sync.");
  const deletedMealIds = [...new Set(rawDeleted.filter(id => typeof id === "string" && ID_PATTERN.test(id)))];
  const goalUpdatedAt = Number(raw.goalUpdatedAt || 0);
  if (!Number.isSafeInteger(goalUpdatedAt) || goalUpdatedAt < 0) throw new Error("Invalid goal timestamp.");
  return { goals, goalUpdatedAt, meals, deletedMealIds };
}

function mergeStates(current, incoming) {
  const deletedMealIds = new Set([...(current?.deletedMealIds || []), ...incoming.deletedMealIds]);
  if (deletedMealIds.size > MAX_DELETIONS) throw new Error("Too many deletion records to sync.");
  const mealsById = new Map();
  for (const meal of [...(current?.meals || []), ...incoming.meals]) {
    if (!deletedMealIds.has(meal.id)) mealsById.set(meal.id, meal);
  }
  if (mealsById.size > MAX_MEALS) throw new Error("Too many meals to sync.");
  const currentWins = current && current.goalUpdatedAt >= incoming.goalUpdatedAt;
  return {
    goals: currentWins ? current.goals : incoming.goals,
    goalUpdatedAt: Math.max(current?.goalUpdatedAt || 0, incoming.goalUpdatedAt),
    meals: [...mealsById.values()],
    deletedMealIds: [...deletedMealIds].sort()
  };
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Use POST to sync MacroSnap data." }, 405);
  const expectedCode = process.env.MACROSNAP_SYNC_CODE;
  if (!expectedCode || expectedCode.length < 16) return json({ error: "Sync is not configured." }, 503);
  const providedCode = request.headers.get("x-macrosnap-sync-code") || "";
  if (!providedCode || !codesMatch(providedCode, expectedCode)) return json({ error: "Sync code is missing or incorrect." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "Send JSON sync data." }, 415);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Sync data is too large." }, 413);

  let incoming;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return json({ error: "Sync data is too large." }, 413);
    incoming = sanitizeState(JSON.parse(body));
  } catch {
    return json({ error: "Sync data is invalid." }, 400);
  }

  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await store.getWithMetadata(STORE_KEY, { type: "json", consistency: "strong" });
      const current = existing ? sanitizeState(existing.data) : null;
      const merged = mergeStates(current, incoming);
      const condition = existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true };
      const result = await store.setJSON(STORE_KEY, merged, condition);
      if (result.modified) return json({ state: merged });
    }
    return json({ error: "Sync is busy. Please try again." }, 503);
  } catch {
    return json({ error: "The sync service could not save your data." }, 500);
  }
}
