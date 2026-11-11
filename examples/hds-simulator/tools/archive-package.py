import argparse
import gzip
from pathlib import Path
import tarfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    if args.output.resolve().is_relative_to(source):
        raise SystemExit("Archive must be outside its input folder")
    if args.output.exists():
        raise SystemExit("Archive already exists")
    with args.output.open("xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for item in [source, *sorted(source.rglob("*"))]:
                    if item.is_symlink() or not (item.is_file() or item.is_dir()):
                        raise SystemExit("Only ordinary package files and directories are allowed")
                    relative = item.relative_to(source)
                    info = archive.gettarinfo(str(item), arcname=str(Path(source.name) / relative).replace("\\", "/"))
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ""
                    executable = item.is_dir() or relative.as_posix() in ("START.command", "runtime/node")
                    info.mode = 0o755 if executable else 0o644
                    if item.is_file():
                        with item.open("rb") as data:
                            archive.addfile(info, data)
                    else:
                        archive.addfile(info)
    with tarfile.open(args.output, "r:gz") as archive:
        for relative in ("START.command", "runtime/node"):
            assert archive.getmember(f"{source.name}/{relative}").mode == 0o755
    print(f"Created {args.output.name} with executable Mac launcher and runtime")


if __name__ == "__main__":
    main()
