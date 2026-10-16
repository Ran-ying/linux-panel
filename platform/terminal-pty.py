#!/usr/bin/env python3
"""Private stdin JSON controls -> PTY; stdout JSON base64 output. No history/logs."""
import base64, errno, fcntl, json, os, pty, select, signal, struct, sys, termios

cols, rows = int(sys.argv[1]), int(sys.argv[2])
pid, master = pty.fork()
if pid == 0:
    if os.path.exists("/bin/bash"):
        os.execv("/bin/bash", ["bash", "--noprofile", "--norc", "-i"])
    os.execv("/bin/sh", ["sh", "-i"])

def resize(c, r):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))

def terminate(*_):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, terminate)
resize(cols, rows)
pending = b""
input_bytes = b""
os.set_blocking(master, False)
try:
    while True:
        readable, writable, _ = select.select([0, master], [master] if input_bytes else [], [], 1)
        if master in writable:
            try:
                count = os.write(master, input_bytes[:4096])
                input_bytes = input_bytes[count:]
            except BlockingIOError:
                pass
        if master in readable:
            try:
                data = os.read(master, 4096)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            print(json.dumps({"data":base64.b64encode(data).decode("ascii")}), flush=True)
        if 0 in readable:
            data = os.read(0, 65536)
            if not data:
                break
            pending += data
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                event = json.loads(line)
                if "data" in event:
                    input_bytes += base64.b64decode(event["data"])
                    if len(input_bytes) > 2 * 1024 * 1024:
                        raise SystemExit(0)
                elif "cols" in event:
                    resize(event["cols"], event["rows"])
finally:
    os.close(master)
    try:
        os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
