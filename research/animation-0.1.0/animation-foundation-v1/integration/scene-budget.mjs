/** Accounts CPU-owned decoded buffers and conservative temporary reservations.
 * Approved resident body assets are a separately admitted baseline. No GPU bytes claimed.
 */
export class SceneBudget {
  #claims = new Map();
  #next = 0;
  #closed = false;
  constructor({ maxBytes = 128 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new TypeError("Positive byte budget required");
    this.maxBytes = maxBytes;
  }
  reserve(bytes, label) {
    if (this.#closed) throw new Error("Scene budget closed");
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new TypeError("Finite integer byte reservation required");
    if (this.diagnostics().claimedBytes + bytes > this.maxBytes)
      throw new Error("Aggregate scene byte budget exhausted");
    const id = ++this.#next;
    const claim = { bytes, label, state: "reserved" };
    this.#claims.set(id, claim);
    return Object.freeze({
      commit: (residentBytes) => {
        if (!this.#claims.has(id) || this.#closed)
          throw new Error("Reservation no longer live");
        if (
          !Number.isSafeInteger(residentBytes) ||
          residentBytes < 0 ||
          residentBytes > claim.bytes
        )
          throw new Error("Resident bytes exceed reservation");
        claim.bytes = residentBytes;
        claim.state = "resident";
      },
      release: () => this.#claims.delete(id),
    });
  }
  diagnostics() {
    const claims = [...this.#claims.values()];
    return {
      maxBytes: this.maxBytes,
      claimedBytes: claims.reduce((sum, c) => sum + c.bytes, 0),
      residentBytes: claims
        .filter((c) => c.state === "resident")
        .reduce((sum, c) => sum + c.bytes, 0),
      pendingReservations: claims.filter((c) => c.state === "reserved").length,
      claims: claims.length,
      closed: this.#closed,
    };
  }
  close() {
    this.#closed = true;
  }
}
