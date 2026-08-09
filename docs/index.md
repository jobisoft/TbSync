# TbSync developer notes

TbSync is the Thunderbird add-on that manages cloud accounts and syncs their
contacts, calendars and tasks. It does not talk to any server itself — that
is a **provider** add-on's job. TbSync owns the accounts, the folder list and
the user interface; the provider owns one protocol.

These pages are for people working on TbSync or writing a provider. For user
documentation, see the
[add-on listing](https://addons.thunderbird.net/addon/tbsync/).

| | |
| --- | --- |
| [**How things work**](descriptions.html) | The parts of the host a provider author has to know about. |
| [**The bridge**](bridge.html) | A development aid that lets a script drive the add-on. Beta builds only. |

The provider contract itself lives in code, in
[`protocol/`](https://github.com/jobisoft/TbSync/tree/main/protocol) — one
directory, vendored into every provider.

Provider-specific notes live with the provider:
[EAS-4-TbSync](https://jobisoft.github.io/EAS-4-TbSync/).
