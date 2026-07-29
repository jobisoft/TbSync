# v5.0.12 test plan

25 commits across the three add-ons. **None of it has run against a live
server** — everything so far is verified by harnesses against the real modules
with stubbed I/O. This is the list of what that leaves unproven.

Tests marked **NEW PATH** exercise code that has never executed in production
in any form. They deserve the most attention.

## 0. Before you start

**Install all three together.** `PROTOCOL_VERSION` goes 1.1 → 1.2, and the host
rejects a mismatched announce outright. A partial update gives you a provider
that will not connect until its sibling updates.

Open the background console for either add-on:
`about:debugging` → *This Thunderbird* → the add-on → *Inspect* → *Console*.

**Back up your accounts first** — several tests corrupt stored state
deliberately. From the **TbSync** console:

```js
const K = "tbsync.accounts";
copy(JSON.stringify((await browser.storage.local.get(K))[K].data));
// paste somewhere safe
```

To restore:

```js
const K = "tbsync.accounts";
const s = (await browser.storage.local.get(K))[K];
s.data = JSON.parse(`<paste>`);
await browser.storage.local.set({ [K]: s });
// then restart Thunderbird
```

Two things to know while testing:

- The Event Log lives in `storage.session`, so **a restart wipes it**. Read it
  before restarting.
- `debug`-level entries are dropped unless you raise the verbosity in the
  manager's settings.

---

## 1. Install and handshake

| # | Step | Expect |
|---|---|---|
| 1.1 | Install all three, restart | Both providers appear as *Ready* in the manager; accounts sync |
| 1.2 | Downgrade **one** provider to v5.0.11, restart | That provider does **not** connect. The other still works. This is the lockstep gate doing its job, not a bug |
| 1.3 | Re-install it at v5.0.12 | It reconnects |

Failing 1.2 in the other direction — an old provider that *does* connect — is
the serious outcome, because 1.2 exists to stop a provider without the resync
fix from pairing with a host that preserves local data.

---

## 2. Authentication failure — the biggest behavioural change

Previously an auth failure ran the same teardown as clicking Disconnect: it
deleted every Thunderbird address book and calendar for the account, wiped the
folder rows, and reset the folder sync key. Now it only stamps the error.

**Setup:** note the account's local calendars and address books, their colours
and item counts, and one folder's `custom.synckey`.

```js
const K = "tbsync.folders";
const f = (await browser.storage.local.get(K))[K];
console.table(Object.values(f["<accountId>"]).map(x =>
  ({ folderId: x.folderId, name: x.displayName, synckey: x.custom?.synckey, target: x.targetID })));
```

**Break the credentials** — for a password account change the password in
Settings; for OAuth corrupt the token from the TbSync console:

```js
const K = "tbsync.accounts", ID = "1";
const s = (await browser.storage.local.get(K))[K];
s.data[ID].custom.refreshToken = "broken-" + s.data[ID].custom.refreshToken;
await browser.storage.local.set({ [K]: s });
```

Then **restart Thunderbird** — the provider caches the good token and a valid
access token in memory, so without a restart the sync may just succeed. Sync.

| # | Expect | Why |
|---|---|---|
| 2.1 | Pill reads *Authentication failed*; button reads **Authenticate** | new label |
| 2.2 | **Folder list still listed** | previously wiped |
| 2.3 | **Local calendars and address books still present**, colours intact | previously deleted |
| 2.4 | `custom.synckey` unchanged, not reset to `"0"` | previously reset |
| 2.5 | Account still shows as connected/enabled | previously disabled |
| 2.6 | **Red toolbar badge appears** | previously invisible — the badge filters to enabled accounts before checking errors |
| 2.7 | Sync greyed; **Disconnect available** | intentional change |
| 2.8 | Wait out an autosync interval: **no further sync attempts** in the Event Log | the `syncAccount` guard. If this fails the account can get locked out at the server |

---

## 3. GAL autocomplete must go quiet — **NEW PATH**

With the account still in *Authentication failed* from section 2, and an EAS
account whose server advertises `Search`:

| # | Step | Expect |
|---|---|---|
| 3.1 | Open a compose window, type 3+ characters of a name in **To:** | No results from the GAL directory, and **no network attempts** in the Event Log |
| 3.2 | Authenticate successfully, then type again | GAL results return **without** restarting or reconnecting |

3.1 is the one that matters: this path fires on every keystroke and was the
regression the audit caught. 3.2 proves the guard is in the callback rather
than in listener registration — nothing re-registers it.

---

## 4. Re-authentication

### 4a. OAuth account

| # | Step | Expect |
|---|---|---|
| 4.1 | Click **Authenticate** → sign in | Popup closes; account recovers on its own; a sync follows immediately |
| 4.2 | Confirm the sync is **incremental** — same item counts, no duplicates, sync key continues | this is where sections 2 and 5 meet |
| 4.3 | Event Log has **no** "Re-authentication failed" line | |
| 4.4 | Break it again, click Authenticate, then **close the window without signing in** | Account stays failed; **no Event Log entry at all** |
| 4.5 | Sign in as a **different** Microsoft account | Refused with a mismatch message; stored token unchanged |

### 4b. Username/password account — **NEW PATH**

| # | Step | Expect |
|---|---|---|
| 4.6 | Click **Authenticate** | The **Settings dialog** opens, fully editable |
| 4.7 | Close it without saving | Account stays failed; **no Event Log entry** |
| 4.8 | Click again, enter the correct password, Save | Account recovers on its own and syncs |
| 4.9 | Repeat with a *wrong* password | An error dialog, and the account left disabled with its error cleared — click **Connect** to retry. Known host behaviour, not a regression |

---

## 5. Popup focus — **NEW PATH**

The two focus commands were collapsed into one. This has never run.

| # | Step | Expect |
|---|---|---|
| 5.1 | Click **Authenticate** on an OAuth account; click the main window to bury the consent popup; click **Authenticate** again | The consent window comes to the front. Nothing new opens |
| 5.2 | Same on a password account with the Settings dialog | The Settings dialog comes to the front |
| 5.3 | Click **Settings** on a healthy account, bury it, click **Settings** again | Raises |

5.2 is the case that was broken — the button looked dead.

---

## 6. Resync must not duplicate — **NEW PATH**

The identity fallback has never run. Section 2 makes this reachable for the
first time: recovery now resumes from existing sync keys instead of pulling
everything fresh.

| # | Step | Expect |
|---|---|---|
| 6.1 | Sync a populated calendar folder (20+ events). Note the item count | |
| 6.2 | Corrupt that folder's sync key (below), then sync | Server answers Status 3; the runner resets and re-pulls |
| 6.3 | **Item count is unchanged — no duplicates** | the whole point |
| 6.4 | `custom.indexMap` has been rebuilt | the fallback repopulates it |
| 6.5 | A following sync is a normal incremental one | |
| 6.6 | Repeat on a **contacts** folder | different codec |

```js
const K = "tbsync.folders", ID = "1", FID = "<folderId>";
const f = (await browser.storage.local.get(K))[K];
f[ID][FID].custom.synckey = "999999999";
await browser.storage.local.set({ [K]: f });
```

If 6.3 fails you get a full duplicate set that the user must clean up by hand —
this is the most damaging possible outcome in the release.

---

## 7. Setup flow still completes

Both providers' internal message listeners were rewritten so they no longer
claim every message. The setup dialog's completion message goes to a *different*
listener, which is what was being shadowed.

| # | Step | Expect |
|---|---|---|
| 7.1 | Add a new EAS account (any flavour) end to end | The dialog completes and closes; the account appears |
| 7.2 | Add a new Google account | Same |
| 7.3 | Cancel a setup halfway | Clean cancellation, no stuck account |

---

## 8. Thunderbird 153 **and** 154

The manifest allows both. Section 2's calendar checks depend on the calendar
experiment, which differs between the two.

| # | Step | Expect |
|---|---|---|
| 8.1 | Run a calendar sync on **153** | Works |
| 8.2 | Same on **154** | Works, and no `TypeError` from the timezone experiment at load or first sync |
| 8.3 | On 154, create / modify / delete a calendar item and run a full folder sync | Exercises the `wrappedJSObject`-on-objects paths that could not be settled from source alone |

---

## 9. Google smoke test

google had no functional change — only the vendored protocol and its message
listener — but it has had the least exercise of the three.

| # | Step | Expect |
|---|---|---|
| 9.1 | Sync contacts | Works |
| 9.2 | Re-authenticate from the manager | Consent flow completes; account recovers |

---

## 10. Cannot be forced — watch for it instead

**Rotated refresh tokens.** Microsoft decides when to hand back a new refresh
token; there is nothing to click. Note the stored `refreshToken`, use the
account normally across several restarts, and re-check. What you are watching
for is the *absence* of a spurious *Authenticate* prompt after a restart. If
the value ever changes, the write-back fired.

I can add a debug-level Event Log line when a rotation is stored, which would
turn this from watch-and-wait into something visible. Say the word.

---

## Known and accepted going in

- **Existing duplicates are not cleaned up.** Section 6 stops new ones; anyone
  who already has duplicates from an earlier resync keeps them.
- **Google's legacy conversion has still never executed.** It needs a real v4
  Google profile to exercise. Structured and committed, but untested.
- **Credentials are stored unencrypted** in the host's account row. Platform
  limitation, not a task.
- **`CANCEL_SYNC` remains dead** — see `cancel-sync.md`. A sync in progress
  still greys out every account action including Remove.
