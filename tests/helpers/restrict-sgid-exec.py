"""Simulate the RestrictSUIDSGID=true denial that affects Git shared repos.

This is test-only: the real deployed root Broker keeps systemd seccomp enabled.
Only mkdir/chmod calls requesting SUID or SGID are denied with EPERM.
"""
import ctypes
import ctypes.util
import os
import sys


class ArgCmp(ctypes.Structure):
    _fields_ = [
        ("arg", ctypes.c_uint), ("op", ctypes.c_int),
        ("datum_a", ctypes.c_uint64), ("datum_b", ctypes.c_uint64),
    ]


def main(argv):
    library = ctypes.util.find_library("seccomp")
    if not library:
        return 77  # fixture unavailable
    lib = ctypes.CDLL(library)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ArgCmp,
    ]
    lib.seccomp_rule_add.restype = ctypes.c_int
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_load.restype = ctypes.c_int
    ctx = lib.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not ctx:
        raise RuntimeError("seccomp init failed")
    for syscall, argument in (
        ("mkdir", 1), ("mkdirat", 2), ("chmod", 1), ("fchmod", 1),
        ("fchmodat", 2),
    ):
        num = lib.seccomp_syscall_resolve_name(syscall.encode())
        if num < 0:
            continue
        for bit in (0o2000, 0o4000):
            cmp = ArgCmp(argument, 7, bit, bit)  # SCMP_CMP_MASKED_EQ
            code = lib.seccomp_rule_add(ctx, 0x00050001, num, 1, cmp)
            if code < 0:
                raise RuntimeError(f"Cannot add {syscall} restriction: {code}")
    if lib.seccomp_load(ctx) < 0:
        raise RuntimeError("seccomp load failed")
    os.umask(0o077)
    os.execvp(argv[0], argv)
    return 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        sys.exit(0 if ctypes.util.find_library("seccomp") else 77)
    sys.exit(main(sys.argv[1:]))
