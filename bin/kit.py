#!/usr/bin/env python3
"""local-mobile-kit backend: one JSON request on stdin, one JSON reply on stdout."""
import os, sys, json, csv

OUT_DIR = "/sdcard/Download/DSH-Go"


def reply(ok, data=None, error=None):
    out = {"ok": ok}
    if ok:
        out["data"] = data
    else:
        out["error"] = error
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str))
    sys.stdout.flush()
    raise SystemExit(0)


def fmt_size(n):
    n = float(n)
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return ("%d%s" % (n, u)) if u == "B" else ("%.1f%s" % (n, u))
        n /= 1024
    return "%.1fTB" % n


def need_file(p):
    if not p or not os.path.isfile(p):
        reply(False, error="文件不存在: %s" % p)


def out_path(src, out, suffix):
    if out:
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        return out
    os.makedirs(OUT_DIR, exist_ok=True)
    return os.path.join(OUT_DIR, os.path.splitext(os.path.basename(src))[0] + suffix)


# ---------------- image ----------------
def run_img(args):
    try:
        from PIL import Image, ImageOps
    except Exception as e:
        reply(False, error="Pillow 不可用: %s" % e)
    op = (args.get("op") or "info").lower()
    p = args.get("path")
    need_file(p)
    im = Image.open(p)
    if op == "info":
        d = {
            "path": p, "width": im.width, "height": im.height, "format": im.format,
            "mode": im.mode, "bytes": os.path.getsize(p), "human": fmt_size(os.path.getsize(p)),
            "frames": getattr(im, "n_frames", 1),
        }
        try:
            ex = im.getexif()
            if ex:
                d["exif"] = {str(k): str(v)[:60] for k, v in list(ex.items())[:8]}
        except Exception:
            pass
        reply(True, d)

    src_w, src_h = im.size
    if op == "resize":
        w, h, max_side = args.get("width"), args.get("height"), args.get("max_side")
        if max_side:
            im.thumbnail((int(max_side), int(max_side)), Image.LANCZOS)
        elif w and h:
            w, h = int(w), int(h)
            im = ImageOps.fit(im.convert("RGB"), (w, h), Image.LANCZOS) if args.get("fit") == "cover" else im.resize((w, h), Image.LANCZOS)
        elif w:
            w = int(w)
            im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
        elif h:
            h = int(h)
            im = im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)
        else:
            reply(False, error="需要 width / height / max_side 之一")
    elif op == "rotate":
        angle = int(args.get("angle") or 90)
        im = im.rotate(angle, expand=(angle % 90 != 0))
    elif op == "crop":
        box = args.get("box")
        if not box or len(box) != 4:
            reply(False, error="crop 需要 box=[x,y,w,h]")
        x, y, w, h = [int(v) for v in box]
        im = im.crop((x, y, x + w, y + h))
    elif op not in ("compress", "convert"):
        reply(False, error="未知 op: %s（info/resize/rotate/crop/compress/convert）" % op)

    fmt = (args.get("format") or ("png" if op == "convert" else None) or (im.format or "PNG")).lower()
    if fmt in ("jpg", "jpeg"):
        fmt = "jpeg"
    if fmt == "jpeg" and im.mode in ("RGBA", "P", "LA"):
        im = im.convert("RGB")
    quality = int(args.get("quality") or 85)
    suffix = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}.get(fmt, "." + fmt)
    if op == "compress" and not args.get("format"):
        suffix = os.path.splitext(p)[1] or suffix
        fmt = "jpeg" if suffix.lower() in (".jpg", ".jpeg") else fmt
    dst = out_path(p, args.get("out"), suffix)
    kw = {"quality": quality} if fmt in ("jpeg", "webp") else {}
    im.save(dst, fmt.upper() if fmt != "jpeg" else "JPEG", **kw)
    reply(True, {"out": dst, "width": im.width, "height": im.height, "format": fmt.upper(),
                 "bytes": os.path.getsize(dst), "human": fmt_size(os.path.getsize(dst)),
                 "from": "%dx%d" % (src_w, src_h)})


# ---------------- archive ----------------
def _safe_join(dest, name):
    target = os.path.realpath(os.path.join(dest, name))
    if not target.startswith(os.path.realpath(dest) + os.sep) and target != os.path.realpath(dest):
        raise RuntimeError("拒绝越界路径: %s" % name)
    return target


def run_archive(args):
    import zipfile, tarfile
    op = (args.get("op") or "list").lower()
    p = args.get("path")
    if op == "create":
        files = args.get("files") or []
        if not files:
            reply(False, error="create 需要 files 列表")
        fmt = (args.get("format") or "zip").lower()
        dst = args.get("out") or os.path.join(OUT_DIR, "打包%s.%s" % (
            __import__("time").strftime("%m%d-%H%M"), "zip" if fmt == "zip" else "tar.gz"))
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        count = 0
        if fmt == "zip":
            with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
                for f in files:
                    if os.path.isdir(f):
                        for root, _, fs in os.walk(f):
                            for name in fs:
                                full = os.path.join(root, name)
                                z.write(full, os.path.relpath(full, os.path.dirname(f)))
                                count += 1
                    else:
                        z.write(f, os.path.basename(f))
                        count += 1
        else:
            with tarfile.open(dst, "w:gz") as t:
                for f in files:
                    t.add(f, arcname=os.path.basename(f))
                    count += 1
        reply(True, {"out": dst, "entries": count, "bytes": os.path.getsize(dst),
                     "human": fmt_size(os.path.getsize(dst))})

    need_file(p)
    if not (zipfile.is_zipfile(p) or tarfile.is_tarfile(p)):
        reply(False, error="不是 zip / tar 压缩包: %s" % p)
    if op == "list":
        items = []
        if zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as z:
                for i in z.infolist():
                    items.append({"name": i.filename, "bytes": i.file_size})
        else:
            with tarfile.open(p) as t:
                for m in t.getmembers():
                    items.append({"name": m.name, "bytes": m.size})
        total = sum(i["bytes"] for i in items)
        reply(True, {"path": p, "entries": len(items), "uncompressed": fmt_size(total),
                     "archive_bytes": fmt_size(os.path.getsize(p)),
                     "items": items[:200], "truncated": len(items) > 200})
    if op == "extract":
        dest = args.get("dest") or os.path.join(OUT_DIR, os.path.splitext(os.path.basename(p))[0])
        os.makedirs(dest, exist_ok=True)
        n = 0
        if zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as z:
                for i in z.infolist():
                    target = _safe_join(dest, i.filename)
                    if i.is_dir():
                        os.makedirs(target, exist_ok=True)
                        continue
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with z.open(i) as s, open(target, "wb") as d:
                        d.write(s.read())
                    n += 1
        else:
            with tarfile.open(p) as t:
                for m in t.getmembers():
                    if m.isfile() or m.isdir():
                        _safe_join(dest, m.name)
                t.extractall(dest, filter="data")
                n = sum(1 for m in t.getmembers() if m.isfile())
        reply(True, {"out": dest, "files": n})


# ---------------- sheet ----------------
def _sheet_rows(path, sheet=None, limit=50, offset=0):
    if path.lower().endswith(".csv") or path.lower().endswith(".tsv"):
        delim = "\t" if path.lower().endswith(".tsv") else ","
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
            rows = list(csv.reader(f, delimiter=delim))
        return {"sheet": "csv", "total_rows": len(rows), "total_cols": max([len(r) for r in rows] or [0]),
                "rows": rows[offset:offset + limit], "sheets": ["csv"]}
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    name = sheet or wb.sheetnames[0]
    if name not in wb.sheetnames:
        reply(False, error="没有工作表 %s，可用: %s" % (name, ", ".join(wb.sheetnames)))
    ws = wb[name]
    rows = []
    for idx, row in enumerate(ws.iter_rows(values_only=True)):
        if idx < offset:
            continue
        if len(rows) >= limit:
            break
        rows.append(["" if c is None else str(c) for c in row])
    return {"sheet": name, "total_rows": ws.max_row, "total_cols": ws.max_column,
            "rows": rows, "sheets": wb.sheetnames}


def run_sheet(args):
    op = (args.get("op") or "read").lower()
    p = args.get("path")
    need_file(p)
    if op in ("info", "read"):
        info = _sheet_rows(p, args.get("sheet"), int(args.get("limit") or 50), int(args.get("offset") or 0))
        info["path"] = p
        if op == "info":
            info.pop("rows", None)
        reply(True, info)
    if op == "to_csv":
        info = _sheet_rows(p, args.get("sheet"), 100000, 0)
        dst = out_path(p, args.get("out"), ".csv")
        with open(dst, "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerows(info["rows"])
        reply(True, {"out": dst, "rows": len(info["rows"]), "sheet": info["sheet"]})
    if op == "to_xlsx":
        with open(p, newline="", encoding="utf-8-sig", errors="replace") as f:
            rows = list(csv.reader(f))
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = (args.get("sheet") or "Sheet1")[:31]
        for r in rows:
            ws.append(r)
        dst = out_path(p, args.get("out"), ".xlsx")
        wb.save(dst)
        reply(True, {"out": dst, "rows": len(rows), "cols": max([len(r) for r in rows] or [0])})
    reply(False, error="未知 op: %s（info/read/to_csv/to_xlsx）" % op)


# ---------------- sqlite ----------------
def run_sqlite(args):
    import sqlite3
    p = args.get("path")
    need_file(p)
    limit = int(args.get("limit") or 100)
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    except Exception as e:
        reply(False, error="打开失败: %s" % e)
    cur = conn.cursor()
    op = (args.get("op") or "query").lower()
    try:
        if op == "tables":
            cur.execute("select name, type from sqlite_master where type in ('table','view') order by name")
            rows = cur.fetchall()
            detail = []
            for name, kind in rows:
                try:
                    cur.execute('select count(*) from "%s"' % name.replace('"', '""'))
                    detail.append({"name": name, "type": kind, "rows": cur.fetchone()[0]})
                except Exception:
                    detail.append({"name": name, "type": kind, "rows": None})
            reply(True, {"path": p, "count": len(detail), "tables": detail})
        if op == "schema":
            cur.execute("select name, sql from sqlite_master where type='table' order by name")
            reply(True, {"path": p, "tables": [{"name": n, "sql": s} for n, s in cur.fetchall()][:50]})
        sql = (args.get("sql") or "").strip()
        if not sql:
            reply(False, error="query 需要 sql")
        head = sql.lower().lstrip()
        if not head.startswith(("select", "with", "pragma", "explain")):
            reply(False, error="只读：只接受 select / with / pragma / explain 开头的语句")
        cur.execute(sql)
        cols = [d[0] for d in (cur.description or [])]
        rows = cur.fetchmany(limit)
        reply(True, {"path": p, "columns": cols, "rows": [list(r) for r in rows], "returned": len(rows),
                     "truncated": len(rows) >= limit, "limit": limit})
    except Exception as e:
        reply(False, error="SQL 执行失败: %s" % e)
    finally:
        conn.close()


def main():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        reply(False, error="请求 JSON 解析失败: %s" % e)
    cmd = (req.get("cmd") or "").lower()
    args = req.get("args") or {}
    try:
        if cmd == "img":
            run_img(args)
        elif cmd == "archive":
            run_archive(args)
        elif cmd == "sheet":
            run_sheet(args)
        elif cmd == "sqlite":
            run_sqlite(args)
        elif cmd == "probe":
            reply(True, _probe())
        else:
            reply(False, error="未知 cmd: %s" % cmd)
    except SystemExit:
        raise
    except Exception as e:
        import traceback
        reply(False, error="%s: %s" % (type(e).__name__, e))


def _probe():
    d = {"python": sys.version.split()[0], "out_dir": OUT_DIR, "out_dir_writable": os.access(OUT_DIR, os.W_OK) if os.path.isdir(OUT_DIR) else os.makedirs(OUT_DIR, exist_ok=True) is None}
    for mod, label in (("PIL", "pillow"), ("openpyxl", "openpyxl")):
        try:
            m = __import__(mod)
            d[label] = getattr(m, "__version__", "ok")
        except Exception:
            d[label] = None
    try:
        import sqlite3
        d["sqlite"] = sqlite3.sqlite_version
    except Exception:
        d["sqlite"] = None
    return d


if __name__ == "__main__":
    main()
