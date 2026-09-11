#!/usr/bin/env python3
"""Merge a repeated watermark into every page and optionally apply AES-256 permissions."""

from __future__ import annotations

import argparse
from io import BytesIO
import json
import math
import os
from pathlib import Path
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions
from reportlab.pdfgen import canvas


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_pdf", type=Path)
    parser.add_argument("--watermark", default="")
    parser.add_argument("--opacity", type=float, default=0.12)
    parser.add_argument("--angle", type=float, default=-35.0)
    parser.add_argument("--owner-password-env", default="")
    return parser.parse_args()


def make_watermark(width: float, height: float, text: str, opacity: float, angle: float):
    packet = BytesIO()
    pdf = canvas.Canvas(packet, pagesize=(width, height))
    if hasattr(pdf, "setFillAlpha"):
        pdf.setFillAlpha(opacity)
    pdf.setFillColorRGB(0.35, 0.39, 0.46)
    font_size = max(24.0, min(width, height) / 13.0)
    pdf.setFont("Helvetica-Bold", font_size)

    diagonal = math.hypot(width, height)
    spacing_x = max(220.0, diagonal * 0.34)
    spacing_y = max(150.0, diagonal * 0.22)
    for y in range(int(-height), int(height * 2), int(spacing_y)):
        for x in range(int(-width), int(width * 2), int(spacing_x)):
            pdf.saveState()
            pdf.translate(x, y)
            pdf.rotate(angle)
            pdf.drawCentredString(0, 0, text)
            pdf.restoreState()
    pdf.save()
    packet.seek(0)
    return PdfReader(packet).pages[0]


def main() -> int:
    args = parse_args()
    if not args.input_pdf.is_file():
        raise FileNotFoundError(args.input_pdf)
    if not 0 <= args.opacity <= 1:
        raise ValueError("opacity must be between 0 and 1")

    owner_password = ""
    if args.owner_password_env:
        owner_password = os.environ.get(args.owner_password_env, "")
        if not owner_password:
            raise RuntimeError(f"environment variable {args.owner_password_env} is empty")

    reader = PdfReader(str(args.input_pdf))
    writer = PdfWriter()
    for page in reader.pages:
        if args.watermark:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            page.merge_page(make_watermark(width, height, args.watermark, args.opacity, args.angle), over=True)
        writer.add_page(page)

    encrypted = bool(owner_password)
    if encrypted:
        permissions = (
            UserAccessPermissions.PRINT
            | UserAccessPermissions.EXTRACT
            | UserAccessPermissions.EXTRACT_TEXT_AND_GRAPHICS
            | UserAccessPermissions.PRINT_TO_REPRESENTATION
        )
        writer.encrypt(
            user_password="",
            owner_password=owner_password,
            permissions_flag=permissions,
            algorithm="AES-256-R5",
        )

    args.output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with args.output_pdf.open("wb") as output:
        writer.write(output)

    print(json.dumps({
        "postprocessed": True,
        "pages": len(reader.pages),
        "watermark": args.watermark or None,
        "encrypted": encrypted,
        "output": str(args.output_pdf),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # concise CLI failure for the Node wrapper
        print(f"postprocess error: {exc}", file=sys.stderr)
        raise SystemExit(1)
