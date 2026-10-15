#!/usr/bin/env python3
"""Least-privilege POSIX ACLs for Git metadata visible to Linux Panel Web.

Uses Linux's documented POSIX ACL xattr v2 format and the Python stdlib.
Do not enable Git's sharedRepository=0640 here: that attempts SGID mkdir/chmod
and fails under the Broker's systemd RestrictSUIDSGID=true sandbox.
"""
import argparse
import grp
import os
from pathlib import Path
import pwd
import stat
import struct

ACL_USER_OBJ = 0x01
ACL_GROUP_OBJ = 0x04
ACL_GROUP = 0x08
ACL_MASK = 0x10
ACL_OTHER = 0x20
UNDEFINED = 0xFFFFFFFF

# Deliberately no recursive glob or arbitrary traversal of updater-controlled
# paths as root. New Git refs/objects inherit ACLs from these known parents.
DIRECTORIES = (
    ".git", ".git/refs", ".git/refs/heads", ".git/refs/remotes",
    ".git/refs/remotes/origin", ".git/objects",
)
FILES = (
    ".git/HEAD", ".git/config", ".git/refs/heads/main",
    ".git/refs/remotes/origin/main", ".git/packed-refs",
)


def acl_blob(entries):
    return struct.pack("<I", 2) + b"".join(
        struct.pack("<HHI", tag, perms, identity)
        for tag, perms, identity in entries
    )


def entries(owner_bits, group_bits, gid):
    # Named group receives ONLY group-read on files and read/traverse on dirs;
    # ACL mask denies group write even if primary ownership later changes.
    return (
        (ACL_USER_OBJ, owner_bits, UNDEFINED),
        (ACL_GROUP_OBJ, group_bits, UNDEFINED),
        (ACL_GROUP, group_bits, gid),
        (ACL_MASK, group_bits, UNDEFINED),
        (ACL_OTHER, 0, UNDEFINED),
    )


def check_regular(path, owner_uid, directory):
    # Never follow symlinks; no chmod/chown on arbitrary checkout subpaths.
    st = path.lstat()
    valid = stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode)
    if not valid or st.st_uid != owner_uid:
        raise RuntimeError(f"Unexpected Git metadata owner or file type: {path}")
    return st


def update_acl(path, value, attribute, directory):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    if directory:
        flags |= os.O_DIRECTORY
    fd = os.open(path, flags)
    try:
        os.setxattr(fd, attribute, value)
        if os.getxattr(fd, attribute) != value:
            raise RuntimeError(f"ACL verification failed for {path}")
    finally:
        os.close(fd)


def configure(root, web_group="linuxpanel", updater_user="linuxpanel-updater"):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError("Invalid checkout")
    gid = grp.getgrnam(web_group).gr_gid
    uid = pwd.getpwnam(updater_user).pw_uid
    # A local checkout may contain packed refs; absent optional files and
    # directories are okay, but existing paths must be owned by updater.
    for rel in DIRECTORIES:
        path = root / rel
        if not path.exists() and not path.is_symlink():
            if rel in (".git", ".git/refs", ".git/refs/heads", ".git/objects"):
                raise RuntimeError(f"Missing mandatory Git directory: {path}")
            continue
        st = check_regular(path, uid, True)
        update_acl(path, acl_blob(entries((st.st_mode >> 6) & 7, 5, gid)),
                   "system.posix_acl_access", True)
        update_acl(path, acl_blob(entries(7, 5, gid)),
                   "system.posix_acl_default", True)
    for rel in FILES:
        path = root / rel
        if not path.exists() and not path.is_symlink():
            if rel in (".git/HEAD", ".git/config"):
                raise RuntimeError(f"Missing mandatory Git file: {path}")
            continue
        st = check_regular(path, uid, False)
        update_acl(path, acl_blob(entries((st.st_mode >> 6) & 7, 4, gid)),
                   "system.posix_acl_access", False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--group", default="linuxpanel")
    parser.add_argument("--owner", default="linuxpanel-updater")
    args = parser.parse_args()
    configure(args.root, args.group, args.owner)
    print("GIT_WEB_ACL_READY")
