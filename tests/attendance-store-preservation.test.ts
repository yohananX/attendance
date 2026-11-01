import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AttendanceEvent,
  AttendanceRecord,
  clearAttendanceForDataset,
  getPendingEvents,
  saveSignIn,
} from "../src/lib/attendance-store";

// ---------------------------------------------------------------------------
// Fake IndexedDB + localStorage so attendance-store can be exercised in node.
// The fake models transaction lifecycle (active/completed/aborted) and abort
// rollback so the D6 behaviour can be verified without a browser.
// ---------------------------------------------------------------------------

const STORE_NAME = "attendance";

interface StoredRecord extends AttendanceRecord {
  sessionRef: string;
}

let records = new Map<string, StoredRecord>();
let localStorageStore = new Map<string, string>();

class IDBRequestFake<T = unknown> {
  result: T | null = null;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  // Defer resolution to a microtask so callers can attach onsuccess/onerror
  // after calling the IndexedDB operation (mirroring real async behaviour).
  resolve(value: T) {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.());
  }

  reject(err: unknown) {
    this.error = err;
    queueMicrotask(() => this.onerror?.());
  }
}

class IDBObjectStoreFake {
  tx: IDBTransactionFake | null = null;

  // Records the mutation operations applied during this transaction so abort
  // can roll them back, mirroring real IndexedDB transaction semantics.
  private pendingOps: Array<() => void> = [];

  private complete() {
    queueMicrotask(() => this.tx?.complete());
  }

  getAll() {
    const req = new IDBRequestFake<StoredRecord[]>();
    req.resolve(Array.from(records.values()));
    this.complete();
    return req;
  }

  get(key: string) {
    const req = new IDBRequestFake<StoredRecord | undefined>();
    req.resolve(records.get(key));
    this.complete();
    return req;
  }

  put(value: StoredRecord) {
    if (!this.tx?.active) {
      throw new Error("Cannot write to an inactive IndexedDB transaction.");
    }
    const previous = records.get(value.sessionRef);
    records.set(value.sessionRef, value);
    this.pendingOps.push(() => {
      if (previous === undefined) records.delete(value.sessionRef);
      else records.set(value.sessionRef, previous);
    });
    const req = new IDBRequestFake();
    req.resolve(undefined);
    this.complete();
    return req;
  }

  delete(key: string) {
    if (!this.tx?.active) {
      throw new Error("Cannot delete from an inactive IndexedDB transaction.");
    }
    const previous = records.get(key);
    records.delete(key);
    this.pendingOps.push(() => {
      if (previous !== undefined) records.set(key, previous);
    });
    const req = new IDBRequestFake();
    req.resolve(undefined);
    this.complete();
    return req;
  }

  clear() {
    if (!this.tx?.active) {
      throw new Error("Cannot clear an inactive IndexedDB transaction.");
    }
    const snapshot = new Map(records);
    records.clear();
    this.pendingOps.push(() => {
      records.clear();
      for (const [key, value] of snapshot) records.set(key, value);
    });
    const req = new IDBRequestFake();
    req.resolve(undefined);
    this.complete();
    return req;
  }

  count() {
    const req = new IDBRequestFake<number>();
    req.resolve(records.size);
    this.complete();
    return req;
  }

  rollback() {
    for (const op of this.pendingOps.reverse()) op();
    this.pendingOps = [];
  }
}

class IDBTransactionFake {
  active = true;
  completed = false;
  aborted = false;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readonly store: IDBObjectStoreFake;

  constructor(store: IDBObjectStoreFake) {
    this.store = store;
    store.tx = this;
  }

  objectStore() {
    return this.store;
  }

  complete() {
    this.active = false;
    this.completed = true;
    queueMicrotask(() => this.oncomplete?.());
  }

  abort() {
    this.active = false;
    this.aborted = true;
    this.store.rollback();
    queueMicrotask(() => this.onabort?.());
  }
}

class IDBDatabaseFake {
  transaction() {
    return new IDBTransactionFake(new IDBObjectStoreFake());
  }

  close() {
    // noop
  }

  get objectStoreNames() {
    return { contains: () => true };
  }
}

const fakeIndexedDB = {
  open: () => {
    const req = new IDBRequestFake<IDBDatabaseFake>();
    req.resolve(new IDBDatabaseFake());
    return req;
  },
};

Object.defineProperty(globalThis, "indexedDB", {
  value: fakeIndexedDB,
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => localStorageStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageStore.delete(key);
    },
    clear: () => {
      localStorageStore.clear();
    },
  },
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<AttendanceEvent> = {}): AttendanceEvent {
  return {
    eventId: "evt-1",
    eventType: "sign_in",
    sessionRef: "sess-1",
    studentName: "A Child",
    parentPhone: "+2348012345678",
    deviceEventAt: "2026-10-31T08:00:00+01:00",
    capturedOffline: true,
    deviceId: "device-1",
    deviceSeq: 1,
    dayKey: "2026-10-31",
    staffName: "Staff",
    syncState: "pending",
    ...overrides,
  };
}

function makeRecord(
  sessionRef: string,
  pendingEvents: AttendanceEvent[] = [],
): AttendanceRecord {
  return {
    sessionRef,
    studentName: "A Child",
    parentPhone: "+2348012345678",
    dayKey: "2026-10-31",
    signedInAt: "2026-10-31T08:00:00+01:00",
    signedOutAt: null,
    signedInBy: "Staff",
    signedOutBy: null,
    serverVersion: 1,
    corrected: false,
    conflictType: null,
    lateSynced: false,
    needsReview: false,
    whatsappLaunchedAt: null,
    pendingEvents,
    syncError: null,
  };
}

function resetStore() {
  records = new Map();
  localStorageStore = new Map();
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("clearAttendanceForDataset (D6 data preservation)", () => {
  it("blocks the clear when unacknowledged pending events exist and throws an actionable error", async () => {
    const pending = makeEvent({ syncState: "pending", eventId: "evt-pending" });
    await saveSignIn(makeRecord("sess-1", [pending]));

    const error = (await clearAttendanceForDataset("new-dataset").catch(
      (e: unknown) => e as Error,
    )) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/not been acknowledged/);
    expect(error.message).toContain("new-dataset");
    expect(error.message).toContain("Sync them first");
  });

  it("preserves unsynchronised pending events after an attempted clear", async () => {
    const pending = makeEvent({ syncState: "pending", eventId: "evt-pending" });
    await saveSignIn(makeRecord("sess-1", [pending]));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();

    const surviving = await getPendingEvents();
    expect(surviving).toHaveLength(1);
    expect(surviving[0].eventId).toBe("evt-pending");
    expect(surviving[0].syncState).toBe("pending");
  });

  it("preserves inflight (pending) and failed-review events", async () => {
    const inflight = makeEvent({
      syncState: "pending",
      eventId: "evt-inflight",
    });
    const failed = makeEvent({
      syncState: "failed",
      eventId: "evt-failed",
      syncError: "The server did not accept this attendance record.",
    });
    await saveSignIn(makeRecord("sess-1", [inflight, failed]));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();

    const pendingOnly = await getPendingEvents();
    const allIncludingFailed = await getPendingEvents(true);
    expect(pendingOnly).toHaveLength(1);
    expect(pendingOnly[0].eventId).toBe("evt-inflight");
    expect(allIncludingFailed).toHaveLength(2);
    expect(
      allIncludingFailed.map((e) => e.eventId).sort(),
    ).toEqual(["evt-failed", "evt-inflight"].sort());
    expect(
      allIncludingFailed.find((e) => e.eventId === "evt-failed")?.syncState,
    ).toBe("failed");
  });

  it("does not reset the dataset identifier while unacknowledged events remain", async () => {
    localStorageStore.set("gh_attendance_dataset", "old-dataset");
    await saveSignIn(makeRecord("sess-1", [makeEvent({ syncState: "pending" })]));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();

    expect(localStorageStore.get("gh_attendance_dataset")).toBe("old-dataset");
    expect(localStorageStore.has("gh_attendance_dataset")).toBe(true);
  });

  it("leaves every record unchanged when the clear is aborted", async () => {
    const pending = makeEvent({ syncState: "pending", eventId: "evt-pending" });
    await saveSignIn(makeRecord("sess-1", [pending]));
    await saveSignIn(makeRecord("sess-2", []));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();

    expect(records.size).toBe(2);
    expect(records.has("sess-1")).toBe(true);
    expect(records.has("sess-2")).toBe(true);
  });

  it("clears acknowledged records and updates the dataset identifier when no unacknowledged events exist", async () => {
    await saveSignIn(makeRecord("sess-1", []));
    await saveSignIn(makeRecord("sess-2", []));

    await clearAttendanceForDataset("new-dataset");

    const remaining = await getPendingEvents();
    expect(remaining).toHaveLength(0);
    expect(records.size).toBe(0);
    expect(localStorageStore.get("gh_attendance_dataset")).toBe("new-dataset");
  });

  it("deletes acknowledged records within an active transaction and does not touch unacknowledged records elsewhere", async () => {
    await saveSignIn(makeRecord("sess-ack", []));
    await saveSignIn(makeRecord("sess-pending", [makeEvent({ syncState: "pending" })]));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();

    // The acknowledged record must survive because the transaction aborted.
    expect(records.size).toBe(2);
    expect(records.has("sess-ack")).toBe(true);
    expect(records.has("sess-pending")).toBe(true);
    const all = await getPendingEvents(true);
    expect(all).toHaveLength(1);
  });

  it("a repeated/retry clear still does not destroy unacknowledged records", async () => {
    const pending = makeEvent({ syncState: "pending", eventId: "evt-retry" });
    await saveSignIn(makeRecord("sess-1", [pending]));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();
    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();

    const surviving = await getPendingEvents();
    expect(surviving).toHaveLength(1);
    expect(surviving[0].eventId).toBe("evt-retry");
    expect(surviving[0].syncState).toBe("pending");
  });

  it("clears acknowledged records after an earlier blocked clear leaves them intact, then blocks again once a new pending event arrives", async () => {
    await saveSignIn(makeRecord("sess-ack", []));
    await saveSignIn(makeRecord("sess-pending", [makeEvent({ syncState: "pending" })]));

    await expect(clearAttendanceForDataset("new-dataset")).rejects.toThrow();
    expect(records.size).toBe(2);

    // Resolve the pending event, then the clear may proceed.
    await saveSignIn(makeRecord("sess-pending", []));
    await clearAttendanceForDataset("new-dataset");
    expect(records.size).toBe(0);
    expect(localStorageStore.get("gh_attendance_dataset")).toBe("new-dataset");

    // A brand-new pending event blocks a subsequent clear.
    await saveSignIn(makeRecord("sess-new", [makeEvent({ syncState: "pending" })]));
    await expect(clearAttendanceForDataset("other-dataset")).rejects.toThrow();
    const stillThere = await getPendingEvents();
    expect(stillThere).toHaveLength(1);
  });
});
