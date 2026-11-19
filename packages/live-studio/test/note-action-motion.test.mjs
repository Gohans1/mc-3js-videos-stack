import { afterEach, describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  clearAllNoteActions,
  peekNoteAction,
  signalNoteAction,
} from "../app/notes/note-action-motion.ts";

describe("note-action-motion signal registry", () => {
  afterEach(() => {
    clearAllNoteActions();
  });

  test("preserves latest action across multi-consumer peeks within TTL and overwrites cleanly on undo/interrupt", () => {
    assert.equal(peekNoteAction("1"), null);

    signalNoteAction("1", "approve");
    const firstPeek = peekNoteAction("1");
    const secondPeek = peekNoteAction("1");
    assert.equal(firstPeek?.kind, "approve");
    assert.equal(secondPeek?.at, firstPeek?.at);

    // Interrupting delete with restore updates signal kind cleanly
    signalNoteAction("1", "delete");
    assert.equal(peekNoteAction("1")?.kind, "delete");
    signalNoteAction("1", "restore");
    assert.equal(peekNoteAction("1")?.kind, "restore");

    clearAllNoteActions();
    assert.equal(peekNoteAction("1"), null);
  });
});
