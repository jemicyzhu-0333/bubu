const COVERAGE = Object.freeze([
  "endpoints", "transitions", "cancellation", "reduced-motion",
  "attachment", "containment", "continuous-contact",
]);
const FIELDS = {
  actor: ["sourceSHA256", "partsSHA256"],
  action: ["id", "trajectorySHA256", "attachmentSHA256"],
  garment: ["id", "modelSHA256", "attachmentSHA256"],
};

function identity(raw, kind) {
  const fields = FIELDS[kind];
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype ||
      Reflect.ownKeys(raw).length !== fields.length)
    throw new TypeError(`Closed ${kind} identity required`);
  const result = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, field);
    const value = descriptor?.value;
    if (!descriptor?.enumerable || !("value" in descriptor) ||
        typeof value !== "string" ||
        !(field === "id" ? /^[a-zA-Z0-9._-]{1,80}$/ : /^[a-f0-9]{64}$/).test(value))
      throw new TypeError(`Invalid ${kind}.${field}`);
    result[field] = value;
  }
  return Object.freeze(result);
}
const key = (actor, action, garment) => JSON.stringify([actor, action, garment]);
function wardrobe(raw) {
  if (!Array.isArray(raw) || raw.length > 5)
    throw new TypeError("At most five contact garments");
  const garments = raw.map(g => identity(g, "garment"));
  if (new Set(garments.map(g => g.id)).size !== garments.length)
    throw new Error("Duplicate contact garment");
  return Object.freeze(garments.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Evidence is supplied by trusted, hash-verifying composition, never by an action request.
 * Bare-body compatibility is explicit too: an empty wardrobe is not automatic approval.
 */
export function createContactRegistry(records = []) {
  if (!Array.isArray(records) || records.length > 256)
    throw new TypeError("Bounded contact evidence required");
  const entries = new Map();
  for (const record of records) {
    const actor = identity(record.actor, "actor");
    const action = identity(record.action, "action");
    const combination = Object.hasOwn(record, "garments");
    if (combination && (Object.hasOwn(record, "garment") || record.garments?.length < 2))
      throw new TypeError("Combination evidence requires two to five exact garments");
    const garment = combination ? wardrobe(record.garments) :
      record.garment === null ? null : identity(record.garment, "garment");
    const id = key(actor, action, garment);
    if (entries.has(id)) throw new Error("Duplicate contact evidence");
    if (!["supported", "blocked"].includes(record.status) ||
        typeof record.reason !== "string" || !record.reason.length ||
        !Array.isArray(record.coverage) ||
        record.coverage.some(c => !COVERAGE.includes(c)) ||
        new Set(record.coverage).size !== record.coverage.length)
      throw new TypeError("Invalid contact evidence");
    if (record.status === "supported" &&
        !COVERAGE.every(c => record.coverage.includes(c)))
      throw new Error("Partial contact sampling cannot authorize full action playback");
    entries.set(id, Object.freeze({
      status: record.status, reason: record.reason,
      coverage: Object.freeze([...record.coverage]),
    }));
  }
  return Object.freeze({
    evaluate({ actor: rawActor, action: rawAction, garments: rawGarments }) {
      const actor = identity(rawActor, "actor"), action = identity(rawAction, "action");
      const garments = wardrobe(rawGarments);
      const findings = [null, ...garments].map(garment => Object.freeze({
        garment,
        ...(entries.get(key(actor, action, garment)) ?? {
          status: "untested", reason: "no-matching-contact-evidence", coverage: Object.freeze([]),
        }),
      }));
      if (garments.length > 1) findings.push(Object.freeze({
        garments,
        ...(entries.get(key(actor, action, garments)) ?? {
          status: "untested", reason: "wardrobe-combination-not-reviewed",
          coverage: Object.freeze([]),
        }),
      }));
      // A known blocker remains visible even when bare-body evidence is still missing.
      const status = findings.some(f => f.status === "blocked") ? "blocked" :
        findings.every(f => f.status === "supported") ? "supported" : "untested";
      return Object.freeze({
        status, allowed: status === "supported", actor, action,
        garments: Object.freeze(garments), findings: Object.freeze(findings),
      });
    },
  });
}

export { COVERAGE as FULL_CONTACT_COVERAGE };
