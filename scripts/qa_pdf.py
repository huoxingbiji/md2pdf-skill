#!/usr/bin/env python3
"""Render and inspect a PDF, producing a JSON report and contact sheet."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw
from pypdf import PdfReader


RAW_PATTERNS = {
    "double_dollar": re.compile(r"\$\$"),
    "latex_frac": re.compile(r"\\frac\b"),
    "latex_times": re.compile(r"\\times\b"),
    "markdown_fence": re.compile(r"```"),
    "double_asterisk": re.compile(r"\*\*"),
    "mermaid_error": re.compile(r"(?:syntax|parse) error", re.IGNORECASE),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--render", choices=("all", "sample", "none"), default="sample")
    parser.add_argument("--dpi", type=int, default=100)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument(
        "--expect-internal-links",
        action="store_true",
        help="fail when the PDF contains no internal link annotations",
    )
    return parser.parse_args()


def sample_pages(page_count: int) -> list[int]:
    if page_count <= 8:
        return list(range(1, page_count + 1))
    values = {1, page_count, 2, page_count - 1}
    values.update({round(1 + (page_count - 1) * fraction) for fraction in (0.25, 0.5, 0.75)})
    return sorted(page for page in values if 1 <= page <= page_count)


def locate_pdftoppm() -> str:
    command = shutil.which("pdftoppm")
    if command:
        return command
    candidate = (
        Path.home()
        / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
    )
    if candidate.is_file():
        return str(candidate)
    raise FileNotFoundError("pdftoppm not found")


def render_pages(pdf: Path, output_dir: Path, pages: list[int], dpi: int) -> list[Path]:
    pdftoppm = locate_pdftoppm()
    rendered: list[Path] = []
    for page_number in pages:
        prefix = output_dir / f"page-{page_number:03d}"
        command = [
            pdftoppm,
            "-png",
            "-r", str(dpi),
            "-f", str(page_number),
            "-l", str(page_number),
            "-singlefile",
            str(pdf),
            str(prefix),
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"pdftoppm failed on page {page_number}")
        image_path = prefix.with_suffix(".png")
        if not image_path.is_file():
            raise RuntimeError(f"missing rendered page {page_number}")
        rendered.append(image_path)
    return rendered


def make_contact_sheet(images: list[Path], output_path: Path) -> None:
    if not images:
        return
    thumbs = []
    for path in images:
        image = Image.open(path).convert("RGB")
        image.thumbnail((260, 368))
        thumbs.append((path, image.copy()))
        image.close()
    columns = min(4, len(thumbs))
    rows = math.ceil(len(thumbs) / columns)
    cell_w, cell_h = 280, 410
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), "white")
    draw = ImageDraw.Draw(sheet)
    for index, (path, image) in enumerate(thumbs):
        x = (index % columns) * cell_w + (cell_w - image.width) // 2
        y = (index // columns) * cell_h + 28
        sheet.paste(image, (x, y))
        draw.text((index % columns * cell_w + 10, index // columns * cell_h + 6), path.stem, fill="black")
    sheet.save(output_path)


def inspect_link_annotations(reader: PdfReader) -> dict[str, object]:
    total = 0
    internal = 0
    external = 0
    other = 0
    pages: set[int] = set()

    for page_number, page in enumerate(reader.pages, start=1):
        annotations = page.get("/Annots") or []
        for annotation_ref in annotations:
            try:
                annotation = annotation_ref.get_object()
            except AttributeError:
                annotation = annotation_ref
            if str(annotation.get("/Subtype")) != "/Link":
                continue
            total += 1
            pages.add(page_number)
            if annotation.get("/Dest") is not None:
                internal += 1
                continue
            action = annotation.get("/A")
            if action is not None and hasattr(action, "get_object"):
                action = action.get_object()
            action_type = str(action.get("/S")) if action is not None else ""
            if action_type == "/GoTo":
                internal += 1
            elif action_type == "/URI":
                external += 1
            else:
                other += 1

    return {
        "total": total,
        "internal": internal,
        "external": external,
        "other": other,
        "pages": sorted(pages),
        "named_destinations": len(reader.named_destinations),
    }


def main() -> int:
    args = parse_args()
    if not args.input_pdf.is_file() or args.input_pdf.stat().st_size == 0:
        raise FileNotFoundError(args.input_pdf)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(args.input_pdf))
    if reader.is_encrypted:
        reader.decrypt("")
    page_count = len(reader.pages)
    if page_count == 0:
        raise RuntimeError("PDF has no pages")

    raw_hits = {name: [] for name in RAW_PATTERNS}
    low_text_pages = []
    page_sizes = []
    character_counts = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        compact = re.sub(r"\s+", "", text)
        character_counts.append(len(compact))
        if len(compact) < 40:
            low_text_pages.append(index)
        for name, pattern in RAW_PATTERNS.items():
            if pattern.search(text):
                raw_hits[name].append(index)
        page_sizes.append([round(float(page.mediabox.width), 2), round(float(page.mediabox.height), 2)])

    pages_to_render = []
    if args.render == "all":
        pages_to_render = list(range(1, page_count + 1))
    elif args.render == "sample":
        pages_to_render = sample_pages(page_count)
    rendered = render_pages(args.input_pdf, args.out_dir, pages_to_render, args.dpi) if pages_to_render else []
    contact_sheet = args.out_dir / "contact-sheet.png"
    make_contact_sheet(rendered, contact_sheet)

    populated_raw_hits = {name: pages for name, pages in raw_hits.items() if pages}
    link_annotations = inspect_link_annotations(reader)
    expected_a4 = all(
        (abs(width - 595.28) < 3 and abs(height - 841.89) < 3)
        or (abs(width - 841.89) < 3 and abs(height - 595.28) < 3)
        for width, height in page_sizes
    )
    report = {
        "pdf": str(args.input_pdf.resolve()),
        "bytes": args.input_pdf.stat().st_size,
        "pages": page_count,
        "encrypted": reader.is_encrypted,
        "a4_pages": expected_a4,
        "page_sizes": sorted({tuple(size) for size in page_sizes}),
        "min_text_characters": min(character_counts),
        "max_text_characters": max(character_counts),
        "low_text_pages": low_text_pages,
        "raw_marker_hits": populated_raw_hits,
        "link_annotations": link_annotations,
        "rendered_pages": pages_to_render,
        "contact_sheet": str(contact_sheet.resolve()) if rendered else None,
    }
    report_path = args.out_dir / "qa-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    missing_expected_links = args.expect_internal_links and link_annotations["internal"] == 0
    strict_failures = bool(populated_raw_hits or low_text_pages or not expected_a4)
    return 2 if missing_expected_links or (args.strict and strict_failures) else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"qa error: {exc}", file=sys.stderr)
        raise SystemExit(1)
