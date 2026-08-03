#!/usr/bin/env python3
"""
Native messaging host for the TbSync bridge (beta builds only).

Thunderbird spawns this process when the bridge is switched on in the
TbSync Manager, and it dies when that port closes - there is no daemon to
start, stop or forget about.

It does one thing: expose TbSync's internal RPC table on a loopback HTTP
socket, so a script (or an agent) can drive TbSync from the shell.

    shell --HTTP--> this host --native messaging--> TbSync --> RPC handler

Message framing (Mozilla native messaging protocol):
  - Each message is preceded by a 4-byte unsigned int (native byte order)
    giving the byte length of the following UTF-8 JSON payload.

  Outgoing (host -> add-on):  { "requestId": str, "cmd": str, "args": {} }
                           |  { "type": "hello", "port": int, "token": str,
                                 "version": int }
  Incoming (add-on -> host):  { "requestId": str, "ok": true,  "result": any }
                            | { "requestId": str, "ok": false, "error": str }

No chunking anywhere. The 1 MB native-messaging cap applies to messages
*from* the application - our commands, which are a few dozen bytes. Replies
travel the other way, where the limit is 4 GB, and a debug-level event log
is nowhere near that.

NOTHING may be written to stdout except framed messages: a stray print()
corrupts the stream and silently kills the port. Diagnostics go to stderr,
which Thunderbird surfaces in its console.
"""

import sys
import json
import struct
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Configuration ──────────────────────────────────────────────────────────────

# Fixed, so a caller needs nothing but this file to know where to knock. An
# ephemeral port would have to be published somewhere, and publishing it was
# more machinery than it was worth for a debug tool.
PORT = 47654

# Not a secret, and not meant to be one. Its job is to make every request a
# *non-simple* CORS request: a page you visit could otherwise send a simple
# cross-origin POST at this port and trigger commands (it could not read the
# reply, but with write verbs the execution is the harm). Requiring an
# Authorization header forces a preflight, which is answered by nothing here,
# so the browser blocks the request outright.
#
# What it does not do is keep out other processes running as you. Those can
# read the Thunderbird profile anyway, so there is nothing here to protect.
TOKEN = 'tbsync'

# Bumped whenever this file changes in a way that needs reinstalling - a new
# message shape, a different port, anything the add-on's half depends on.
# The add-on carries the version it expects and says so in the Bridge tab
# when they disagree, which is the only way to tell a stale helper from a
# broken one: reinstalling it is a separate act from updating the add-on,
# because it lives outside the xpi where Thunderbird can launch it.
VERSION = 1

# How long an HTTP request waits for the add-on to answer, in seconds. The
# caller decides per request - it is the one that knows whether it asked for
# something instant or for a full resync - and this is the ceiling and the
# default. Finite either way, so a wedged call releases its socket instead of
# holding it forever.
MAX_TIMEOUT_S = 600

MAX_BODY_BYTES = 1024 * 1024

# ── Native messaging framing ───────────────────────────────────────────────────

_stdout_lock = threading.Lock()


def get_message():
    """Read one framed message from stdin. Returns None at EOF."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    payload = sys.stdin.buffer.read(message_length)
    if len(payload) < message_length:
        return None
    return json.loads(payload.decode('utf-8'))


def send_message(content):
    """Write one framed message to stdout. Serialized: interleaved writes
    would corrupt the framing, and every HTTP thread calls this."""
    encoded = json.dumps(content, separators=(',', ':')).encode('utf-8')
    with _stdout_lock:
        sys.stdout.buffer.write(struct.pack('@I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()


def log(*parts):
    print('[tbsync-bridge]', *parts, file=sys.stderr, flush=True)


# ── Pending requests ───────────────────────────────────────────────────────────

# requestId -> {"event": Event, "response": dict|None}
_pending = {}
_pending_lock = threading.Lock()


def dispatch(cmd, args, timeout_s):
    """Send one command to the add-on and wait for its reply.

    Returns the reply dict, or None if the add-on did not answer in time."""
    request_id = uuid.uuid4().hex
    event = threading.Event()
    with _pending_lock:
        _pending[request_id] = {'event': event, 'response': None}
    try:
        send_message({'requestId': request_id, 'cmd': cmd, 'args': args})
        if not event.wait(timeout_s):
            return None
        with _pending_lock:
            return _pending[request_id]['response']
    finally:
        with _pending_lock:
            _pending.pop(request_id, None)


def resolve(message):
    """Hand an incoming reply to whichever HTTP thread is waiting for it."""
    request_id = message.get('requestId')
    if not request_id:
        return
    with _pending_lock:
        entry = _pending.get(request_id)
        if not entry:
            # Timed out and already gone, or never ours.
            return
        entry['response'] = message
    entry['event'].set()


# ── HTTP server ────────────────────────────────────────────────────────────────

def make_handler():
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        # BaseHTTPRequestHandler logs every request to stderr. Thunderbird's
        # console is not the place for an access log.
        def log_message(self, fmt, *args):
            pass

        def _reply(self, status, payload):
            body = json.dumps(payload).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self):
            header = self.headers.get('Authorization', '')
            return header == f'Bearer {TOKEN}'

        def do_GET(self):
            if self.path != '/health':
                self._reply(404, {'ok': False, 'error': 'not found'})
                return
            # Answered here, without troubling the add-on: this says the host
            # is up and the token works, nothing about TbSync itself. Any real
            # command proves that.
            if not self._authorized():
                self._reply(401, {'ok': False, 'error': 'unauthorized'})
                return
            self._reply(200, {'ok': True, 'pid': os.getpid()})

        def do_POST(self):
            if self.path != '/rpc':
                self._reply(404, {'ok': False, 'error': 'not found'})
                return
            if not self._authorized():
                self._reply(401, {'ok': False, 'error': 'unauthorized'})
                return

            length = int(self.headers.get('Content-Length') or 0)
            if length > MAX_BODY_BYTES:
                self._reply(413, {'ok': False, 'error': 'body too large'})
                return
            try:
                body = json.loads(self.rfile.read(length).decode('utf-8'))
            except (ValueError, UnicodeDecodeError) as err:
                self._reply(400, {'ok': False, 'error': f'bad JSON: {err}'})
                return

            cmd = body.get('cmd')
            if not isinstance(cmd, str) or not cmd:
                self._reply(400, {'ok': False, 'error': 'missing cmd'})
                return
            args = body.get('args') or {}
            if not isinstance(args, dict):
                self._reply(400, {'ok': False, 'error': 'args must be an object'})
                return

            # Clamped rather than rejected: an out-of-range value is the
            # caller being optimistic, not the caller being wrong.
            timeout_s = body.get('timeoutMs')
            timeout_s = (
                min(max(timeout_s / 1000, 1), MAX_TIMEOUT_S)
                if isinstance(timeout_s, (int, float))
                else MAX_TIMEOUT_S
            )

            response = dispatch(cmd, args, timeout_s)
            if response is None:
                self._reply(504, {
                    'ok': False,
                    'error': f'no reply from TbSync within {timeout_s:g}s',
                })
                return
            if response.get('ok'):
                self._reply(200, {'ok': True, 'result': response.get('result')})
            else:
                self._reply(200, {
                    'ok': False,
                    'error': response.get('error') or 'unknown error',
                    'errorCode': response.get('errorCode'),
                })

    return Handler


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), make_handler())
    except OSError as err:
        # Almost always "address already in use": a second Thunderbird
        # profile with the bridge on, or a stale helper. Say so and stop -
        # a silent exit here looks like the add-on being broken.
        log(f'could not listen on 127.0.0.1:{PORT}:', err)
        send_message({'type': 'hello', 'error': f'port {PORT}: {err}'})
        return 1
    server.daemon_threads = True

    log(f'listening on 127.0.0.1:{PORT}')
    threading.Thread(target=server.serve_forever, daemon=True).start()

    # Tell the add-on we are up, so the Bridge tab can show the address
    # rather than describe it. Carries no requestId, which is how the add-on
    # tells it apart from a reply.
    send_message(
        {'type': 'hello', 'port': PORT, 'token': TOKEN, 'version': VERSION}
    )

    try:
        # Thunderbird closes the port on shutdown, or when the bridge is
        # switched off; stdin hits EOF and we are done.
        while True:
            message = get_message()
            if message is None:
                break
            resolve(message)
    except (OSError, ValueError) as err:
        log('stdin pump stopped:', err)
    finally:
        server.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main())
