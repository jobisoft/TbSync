/**
 * Thin wrapper over `messenger.addressBooks.*` and `messenger.contacts.*`.
 * Book operations tolerate "not found" (the user may have removed the book
 * manually). Contact writes all take a vCard string via `{ vCard }`.
 */

import { localQueue, lookupBinding } from "./change-queue.mjs";

/** Create a book and return its id. */
export async function createBook(name) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("createBook requires a non-empty name");
  }
  const id = await messenger.addressBooks.create({ name: name.trim() });
  // Workaround for TB bug in ext-addressBook.js:707-710 where the
  // contact-node cache misses property updates until contacts.list()
  // has been called at least once for the parent book. Without this
  // seed, the host's content-hash gate sees stale vCards on the
  // first edit and treats real changes as ghosts.
  await messenger.contacts.list(id);
  return id;
}

/** Delete a book, tolerating "not found". */
export async function deleteBook(id) {
  if (!id) return;
  try {
    await messenger.addressBooks.delete(id);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

export async function bookExists(id) {
  if (!id) return false;
  try {
    const node = await messenger.addressBooks.get(id);
    return !!node;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

// ── Contact-level ──────────────────────────────────────────────────────────

/** List all contacts in a book, with vCard normalised to the top level. */
export async function listContacts(bookId) {
  if (!bookId) return [];
  try {
    const list = await messenger.contacts.list(bookId);
    return list.map(normalizeCard);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

/** Fetch a contact by id with vCard normalised. Null on "not found". */
export async function getContact(id) {
  if (!id) return null;
  try {
    const node = await messenger.contacts.get(id);
    return node ? normalizeCard(node) : null;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** Re-emit a contact node with `vCard` lifted to the top level, so callers
 *  have one read path. The MV2 contacts API puts it at
 *  `node.properties.vCard` on both ESR and Beta; the top-level read is kept
 *  ahead of it so a future shape change is picked up rather than ignored. */
function normalizeCard(node) {
  if (!node) return node;
  const vCard = node.vCard ?? node.properties?.vCard ?? null;
  return { ...node, vCard };
}

/** Create a contact from a vCard. Returns the new id. */
export async function createContact(bookId, vCard) {
  if (!bookId) throw new Error("createContact requires a bookId");
  if (!vCard) throw new Error("createContact requires a vCard string");
  return await messenger.contacts.create(bookId, { vCard });
}

/** Replace an existing contact's vCard. */
export async function updateContact(contactId, vCard) {
  if (!contactId) throw new Error("updateContact requires a contactId");
  if (!vCard) throw new Error("updateContact requires a vCard string");
  await messenger.contacts.update(contactId, { vCard });
}

/** Delete a contact by id, tolerating "not found". */
export async function deleteContact(contactId) {
  if (!contactId) return;
  try {
    await messenger.contacts.delete(contactId);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

// ── Mailing-list-level ────────────────────────────────────────────────────

/** List all mailing lists in a book. */
export async function listMailingLists(bookId) {
  if (!bookId) return [];
  try {
    return await messenger.mailingLists.list(bookId);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

/** Fetch a mailing list by id; null on "not found". */
export async function getMailingList(id) {
  if (!id) return null;
  try {
    return await messenger.mailingLists.get(id);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** Create a mailing list. Returns the new id. */
export async function createMailingList(bookId, { name }) {
  if (!bookId) throw new Error("createMailingList requires a bookId");
  if (!name) throw new Error("createMailingList requires a name");
  return await messenger.mailingLists.create(bookId, { name });
}

/** Rename / update a mailing list. */
export async function updateMailingList(id, { name }) {
  if (!id) throw new Error("updateMailingList requires an id");
  await messenger.mailingLists.update(id, { name });
}

/** Delete a mailing list, tolerating "not found". */
export async function deleteMailingList(id) {
  if (!id) return;
  try {
    await messenger.mailingLists.delete(id);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

/** List the contacts in a mailing list, tolerating "not found". */
export async function listMailingListMembers(listId) {
  if (!listId) return [];
  try {
    return await messenger.mailingLists.listMembers(listId);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
}

/** Add a contact to a mailing list.
 *
 *  Throws with `code: NOT_FOUND` when either side has been removed rather
 *  than returning quietly: a membership delta that swallows this reports a
 *  change it did not make. */
export async function addMailingListMember(listId, contactId) {
  if (!listId || !contactId) return;
  try {
    await messenger.mailingLists.addMember(listId, contactId);
  } catch (err) {
    if (isNotFoundError(err)) throw notFound(`addMailingListMember: list ${listId} or contact ${contactId} is gone`);
    throw err;
  }
}

/** Remove a contact from a mailing list. Same contract as
 *  `addMailingListMember`. */
export async function removeMailingListMember(listId, contactId) {
  if (!listId || !contactId) return;
  try {
    await messenger.mailingLists.removeMember(listId, contactId);
  } catch (err) {
    if (isNotFoundError(err)) throw notFound(`removeMailingListMember: list ${listId} or contact ${contactId} is gone`);
    throw err;
  }
}

/** The code a caller can test for when a list or contact it named is gone.
 *  Same string as each provider's own `PUSH_ERR.NOT_FOUND`, so existing
 *  `err.code === ...` checks keep working. */
export const NOT_FOUND = "E:NOT_FOUND";

function notFound(message) {
  const err = new Error(message);
  err.code = NOT_FOUND;
  return err;
}

/** True for Thunderbird's "there is no such id" error, and nothing else.
 *
 *  Matching on prose is not a choice we get to make: these APIs throw a bare
 *  `ExtensionError`, and only its message survives the boundary - no code, no
 *  name, no subclass. So the message is the whole signal.
 *
 *  What we can choose is to match it exactly. `ext-addressBook.js` raises this
 *  from three places - `findAddressBookById`, `findMailingListById`,
 *  `findContactById` - all with one shape, so the pattern is that shape and
 *  not a bag of keywords. The previous `/no such|not found|invalid id/`
 *  matched **none** of them (Thunderbird says "could *not be* found"), which
 *  made every tolerant branch in this file throw instead of returning null.
 *  That is how one mailing list could fail an entire contacts sync: the push
 *  path already skips an item it cannot read, but the read threw before it
 *  got the chance.
 *
 *  Erring tight is deliberate. Too loose swallows a real defect - "Invalid
 *  vCard data", "The card's UID may not be changed", "Duplicate contact id"
 *  are all our own bug, and losing them silently loses data. Too tight fails
 *  a sync loudly, which is recoverable and gets reported. If a future
 *  Thunderbird rewords this, we want the loud one. */
const NOT_FOUND_MESSAGE =
  /^(addressBook|mailingList|contact) with id=.* could not be found\.$/;

function isNotFoundError(err) {
  return NOT_FOUND_MESSAGE.test(String(err?.message ?? err ?? ""));
}

/* ── Watching ──────────────────────────────────────────────────────────
 *
 * Watches the Thunderbird address books a provider syncs, and records what
 * the user does to them in that provider's own change queue.
 *
 * ## Why the provider does this
 *
 * A calendar can be supplied by its provider, so user edits arrive as hooks
 * and the provider's own writes go somewhere invisible. Address books have
 * no such API - `addressBooks.provider` offers only `onSearchRequest` - so
 * the only way to learn about an edit is to watch the book, and every write
 * looks alike. Both halves of that are unavoidable and are why this file is
 * as involved as it is.
 *
 * What is avoidable is *where* the record goes. Watching from the provider
 * means the queue is the provider's, so a book keeps being tracked while
 * the host is disabled, updating or gone - the same reason a calendar's
 * queue is provider-side.
 *
 * ## Telling our own writes apart
 *
 * Since a sync write fires the same events a user edit does, each one is
 * announced first: `markServerWrite` puts a `*_by_server` pre-tag in the
 * queue, and the event it produces consumes the tag instead of being
 * recorded. A tag is an ANNOUNCEMENT - only the op it names may consume it,
 * and it expires after 1.5s. The rules live in `changelog-core.mjs`.
 *
 * ## The ghost gate
 *
 * Thunderbird also fires `onUpdated` for things the user did not do:
 * PopularityIndex, address-picker recency. Those do not change the vCard, so
 * a content hash tells them from a real edit and they are dropped before
 * they reach the queue. A dropped event still has to hand back any pre-tag
 * it would have consumed, or that tag would suppress the user's *next* edit.
 *
 * **VENDORED - see `TbSync/common/README.md`.**
 */



let installed = false;

/** Which books this observer watches, as `bookId -> binding`. Rebuilt from
 *  the binding cache rather than kept in sync by hand: `rememberBindings`
 *  already records every resource the provider has seen, and a book we have
 *  no binding for is not ours to watch. */
async function bookBinding(bookId) {
  if (!bookId) return null;
  const b = await lookupBinding(bookId);
  if (!b?.sessionId) return null;
  if (b.targetType !== "contacts") return null;
  return b;
}

function queueFor(binding) {
  return localQueue({ ...binding, observed: true });
}

async function computeHash(vcard) {
  const bytes = new TextEncoder().encode(vcard);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Register the listeners. Safe to call more than once; only the first call
 * does anything.
 *
 * `provider` is the SDK instance, used for the two things only the host can
 * do: carrying a renamed book's name back to the folder row, and reporting
 * that the user deleted the book. `report` is an event-log sink.
 */
export function installContactsObserver({ provider, report } = {}) {
  if (installed) return;
  installed = true;

  const log = (level, message) => report?.({ level, message });

  messenger.contacts.onCreated.addListener((node) =>
    handle("contact", "created", node),
  );
  messenger.contacts.onUpdated.addListener((node) =>
    handle("contact", "updated", node),
  );
  messenger.contacts.onDeleted.addListener((parentId, id) =>
    handle("contact", "deleted", { parentId, id }),
  );
  messenger.mailingLists.onCreated.addListener((node) =>
    handle("list", "created", node),
  );
  messenger.mailingLists.onUpdated.addListener((node) =>
    handle("list", "updated", node),
  );
  messenger.mailingLists.onDeleted.addListener((parentId, id) =>
    handle("list", "deleted", { parentId, id }),
  );

  // Membership: a contact put into a mailing list, or taken out. Its own
  // kind rather than a change to either party, because it is a change to
  // neither - the contact's fields are untouched and so is the list's name,
  // so re-pushing either would send bytes the server already has while
  // still not saying what actually changed.
  //
  // `onMemberAdded` hands back a node whose parentId is the *list* (a
  // card's own node carries the book instead) and `onMemberRemoved` gives
  // the pair directly, so either way both halves arrive - which is what
  // lets the entry name the exact pair the user touched.
  messenger.mailingLists.onMemberAdded.addListener((node) =>
    handleMembership("created", node?.parentId, node?.id),
  );
  messenger.mailingLists.onMemberRemoved.addListener((parentId, id) =>
    handleMembership("deleted", parentId, id),
  );

  // The user renaming the book: carry it to the folder row, which is what
  // the manager displays.
  messenger.addressBooks.onUpdated.addListener((node) =>
    handleRename(node?.id, node?.name),
  );

  // The user deleting the book. The binding is over; the host clears the row
  // and ends the session, which is what discards everything we hold for it.
  messenger.addressBooks.onDeleted.addListener((id) => handleRemoved(id));

  async function handleRename(bookId, name) {
    const binding = await bookBinding(bookId);
    if (!binding || !name) return;
    await provider
      ?.updateFolder({
        accountId: binding.accountId,
        folderId: binding.folderId,
        patch: { targetName: name },
      })
      .catch((err) =>
        log("debug", `[contacts] could not mirror the book rename: ${err?.message ?? err}`),
      );
  }

  async function handleRemoved(bookId) {
    const binding = await bookBinding(bookId);
    if (!binding) return;
    log("info", `[contacts] address book ${bookId} was deleted; clearing the binding`);
    await provider
      ?.folderTargetRemoved({ targetID: bookId })
      .catch((err) =>
        log("warning", `[contacts] could not report the removal of ${bookId}: ${err?.message ?? err}`),
      );
  }

  async function handleMembership(op, listId, contactId) {
    if (!listId || !contactId) return;
    let bookId = null;
    try {
      bookId = (await messenger.mailingLists.get(listId))?.parentId ?? null;
    } catch {
      // The list is already gone - deleting one fires a member-removed event
      // per member, and the list itself may lose the race. Nothing to
      // record: the list's own deleted entry carries everything needed.
      return;
    }
    const binding = await bookBinding(bookId);
    if (!binding) return;
    await record(binding, {
      kind: "membership",
      parentId: listId,
      itemId: contactId,
      name: null,
      op,
    });
  }

  async function handle(kind, op, node) {
    const parentId = node?.parentId;
    const itemId = node?.id;
    if (!parentId || !itemId) return;
    const binding = await bookBinding(parentId);
    if (!binding) return;

    if (kind === "contact") {
      const queue = queueFor(binding);
      if (op === "deleted") {
        await queue
          .dropHash(itemId)
          .catch((err) =>
            log("debug", `[contacts] hash remove failed: ${err?.message ?? err}`),
          );
      } else if (op === "created" || op === "updated") {
        if ((await ghostGate(queue, op, itemId)) === "suppress") {
          // Discarding the event must not discard someone's pre-tag with it:
          // this is the only path that would have consumed one, so a provider
          // write that changed no bytes would otherwise leave its tag behind
          // to suppress the user's next edit.
          await queue.consumeServerTag({ kind, parentId, itemId, op });
          return;
        }
      }
    }

    // A list create also carries a name, which finds the `list-by-name`
    // pre-tag written before `mailingLists.create` - Thunderbird accepts no
    // UID there, so the tag's itemId is the name until onCreated says
    // otherwise.
    const name =
      kind === "list" && op === "created" ? (node?.name ?? null) : null;

    await record(binding, { kind, parentId, itemId, name, op });
  }

  /** Decide whether a contact create/update is a Thunderbird ghost (same
   *  vCard bytes as last seen) or a real change. Fails open: anything
   *  unreadable proceeds, so a hash problem cannot swallow an edit. */
  async function ghostGate(queue, op, itemId) {
    let vcard;
    try {
      vcard = (await messenger.contacts.get(itemId))?.properties?.vCard;
    } catch (err) {
      log("debug", `[contacts] hash read failed: ${err?.message ?? err}`);
      return "proceed";
    }
    if (typeof vcard !== "string" || vcard.length === 0) return "proceed";

    const hash = await computeHash(vcard);
    if (op === "updated" && (await queue.getHash(itemId)) === hash) {
      return "suppress";
    }
    await queue
      .setHash(itemId, hash)
      .catch((err) =>
        log("debug", `[contacts] hash store failed: ${err?.message ?? err}`),
      );
    return "proceed";
  }

  async function record(binding, event) {
    const queue = queueFor(binding);
    let changed;
    try {
      changed = await queue.recordEvent(event);
    } catch (err) {
      log(
        "error",
        `[contacts] FAILED to queue ${event.kind}.${event.op} of ${event.itemId}: ${err?.message ?? err}`,
      );
      return;
    }
    if (!changed) return;

    // The host paints a needs-sync badge and cannot count a queue it does
    // not hold. Best-effort: the edit is already safe either way.
    const pending = await queue.count().catch(() => null);
    if (pending === null) return;
    await provider
      ?.updateFolder({
        accountId: binding.accountId,
        folderId: binding.folderId,
        patch: { custom: { pendingUserChanges: pending } },
      })
      .catch((err) =>
        log("debug", `[contacts] could not update the pending count: ${err?.message ?? err}`),
      );
  }
}
