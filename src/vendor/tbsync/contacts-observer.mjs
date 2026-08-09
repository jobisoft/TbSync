/**
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

import { localQueue, lookupBinding } from "./change-queue.mjs";

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
