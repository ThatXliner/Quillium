import copy
import hashlib
import pathlib
import sys
import tarfile
import zipfile

node = {
    "arm64": ("f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9", "bun-linux-aarch64/bun", "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e"),
    "amd64": ("b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406", "bun-linux-x64/bun", "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c"),
}
architecture, destination = sys.argv[1:]
node_hash, bun_member, bun_hash = node[architecture]
node_archive = pathlib.Path(f"/archives/node-{architecture}.tar.gz")
if hashlib.sha256(node_archive.read_bytes()).hexdigest() != node_hash:
    raise SystemExit("Node archive SHA256 mismatch")
with tarfile.open(node_archive) as source:
    members = []
    for member in source.getmembers():
        member = copy.copy(member)
        member.name = "/".join(member.name.split("/")[1:])
        if member.name:
            members.append(member)
    source.extractall(pathlib.Path(destination) / "node", members=members, filter="data")
bun_archive = pathlib.Path(f"/archives/bun-{architecture}.zip")
if hashlib.sha256(bun_archive.read_bytes()).hexdigest() != bun_hash:
    raise SystemExit("Bun archive SHA256 mismatch")
with zipfile.ZipFile(bun_archive) as source:
    content = source.read(bun_member)
target = pathlib.Path(destination) / "bun"
target.write_bytes(content)
target.chmod(0o755)
