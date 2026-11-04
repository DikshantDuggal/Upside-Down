"""Build four static role handoffs from the same data used by the demo UI.
Run with a Python environment containing reportlab; Node >=24 is also required.
"""
from pathlib import Path
import html
import json
import re
import subprocess
import shutil
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted, LongTable, TableStyle, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "demo"
OUT.mkdir(parents=True, exist_ok=True)
for source in ["ARCHITECTURE.md", "CONTRACT.md"]:
    shutil.copyfile(ROOT / "src" / "features" / "demo" / "fixtures" / source, OUT / source)
code = "import {roles, context, rolePrompt} from './src/features/demo/data.ts'; console.log(JSON.stringify({context,roles:roles.map(r=>({...r,prompt:rolePrompt(r)}))}));"
data = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", code], cwd=ROOT, text=True, encoding="utf-8"))
(OUT / "context.md").write_text(data["context"], encoding="utf-8")
FONT = Path("C:/Windows/Fonts")
if (FONT / "segoeui.ttf").exists():
    pdfmetrics.registerFont(TTFont("Body", str(FONT / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("Strong", str(FONT / "segoeuib.ttf")))
    pdfmetrics.registerFont(TTFont("Code", str(FONT / "consola.ttf")))
else:
    for name, base in [("Body", "Helvetica"), ("Strong", "Helvetica-Bold"), ("Code", "Courier")]:
        pdfmetrics.registerFont(pdfmetrics.Font(name, base, "WinAnsiEncoding"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Strong", italic="Body", boldItalic="Strong")
INK = colors.HexColor("#243A2D")
GREEN = colors.HexColor("#60784B")
PALE = colors.HexColor("#EEF3E7")
styles = {
    "body": ParagraphStyle("body", fontName="Body", fontSize=9, leading=14, textColor=INK, spaceAfter=7),
    "h1": ParagraphStyle("h1", fontName="Strong", fontSize=21, leading=27, textColor=INK, spaceBefore=12, spaceAfter=15, keepWithNext=True),
    "h2": ParagraphStyle("h2", fontName="Strong", fontSize=13, leading=18, textColor=GREEN, spaceBefore=14, spaceAfter=8, keepWithNext=True),
    "h3": ParagraphStyle("h3", fontName="Strong", fontSize=10, leading=15, textColor=INK, spaceBefore=9, spaceAfter=6, keepWithNext=True),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=6.8, leading=10, textColor=INK, wordWrap="CJK"),
    "code": ParagraphStyle("code", fontName="Code", fontSize=6.8, leading=10, textColor=INK, backColor=PALE, borderPadding=8, spaceBefore=5, spaceAfter=10),
    "eyebrow": ParagraphStyle("eyebrow", fontName="Strong", fontSize=9, leading=14, textColor=GREEN, spaceAfter=15),
    "cover": ParagraphStyle("cover", fontName="Strong", fontSize=37, leading=43, textColor=INK, spaceAfter=22),
    "subtitle": ParagraphStyle("subtitle", fontName="Body", fontSize=16, leading=24, textColor=GREEN, spaceAfter=20),
}
def inline(text):
    parts = re.split(r"(`[^`]+`)", text)
    result = []
    for part in parts:
        if part.startswith("`") and part.endswith("`"):
            result.append('<font name="Code">' + html.escape(part[1:-1]) + '</font>')
        else:
            safe = html.escape(part)
            safe = re.sub(r"(?<![\w/])\*\*([^*]+)\*\*(?!\w)", r"<b>\1</b>", safe)
            result.append(re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", safe))
    return ''.join(result)

def cells(line):
    # Pipes inside Markdown inline code belong to that cell.
    parts, current, tick = [], "", False
    for ch in line.strip().strip("|"):
        if ch == "`": tick = not tick
        if ch == "|" and not tick: parts.append(current.strip()); current = ""
        else: current += ch
    parts.append(current.strip())
    return parts

def markdown(text):
    lines = text.splitlines(); result = []; i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line: i += 1; continue
        if line.startswith("```"):
            content = []; i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                original = lines[i].expandtabs(2)
                # Width-limited line wrapping protects code and ASCII diagrams.
                while len(original) > 105:
                    content.append(original[:105]); original = "  " + original[105:]
                content.append(original); i += 1
            result.append(Preformatted("\n".join(content), styles["code"]))
            i += 1; continue
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i+1]):
            rows = [cells(line)]; i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(cells(lines[i])); i += 1
            count = max(len(row) for row in rows)
            formatted = [[Paragraph(inline(cell), styles["cell"]) for cell in row + [""] * (count-len(row))] for row in rows]
            table = LongTable(formatted, colWidths=[483/count]*count, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([("BACKGROUND", (0,0),(-1,0),colors.HexColor("#DCE7CE")),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F7F9F4")]),("VALIGN",(0,0),(-1,-1),"TOP"),("GRID",(0,0),(-1,-1),.35,colors.HexColor("#D8E0D2")),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
            result.extend([table,Spacer(1,10)]); continue
        heading = re.match(r"^(#{1,6})\s+(.*)", line)
        if heading:
            result.append(Paragraph(inline(heading[2]), styles["h"+str(min(3,len(heading[1]))) ]))
        elif line.startswith(">"):
            result.append(Paragraph(inline(line.lstrip("> ")), styles["body"]))
        elif line.startswith("- "):
            result.append(Paragraph("• " + inline(line[2:]), styles["body"]))
        else:
            result.append(Paragraph(inline(line), styles["body"]))
        i += 1
    return result

architecture = (OUT / "ARCHITECTURE.md").read_text(encoding="utf-8")
contract = (OUT / "CONTRACT.md").read_text(encoding="utf-8")
for role in data["roles"]:
    letter = role["letter"]
    (OUT / f'{role["id"]}-prompt.md').write_text(role["prompt"], encoding="utf-8")
    target = OUT / f'laptop-{letter.lower()}-pack.pdf'
    doc = SimpleDocTemplate(str(target), pagesize=A4, rightMargin=56, leftMargin=56, topMargin=63, bottomMargin=53, title=f'AgentSync - Laptop {letter} - {role["name"]}', author="Upside Down Studio")
    story = [Spacer(1,30),Paragraph("UPSIDE DOWN / HACKATHON STUDIO",styles["eyebrow"]),Spacer(1,35),Paragraph(f'Laptop {letter}.<br/>One clear role.',styles["cover"]),Paragraph(role["name"],styles["subtitle"]),Paragraph(role["goal"],styles["body"]),Spacer(1,25)]
    for label, value in [("ASSIGNMENT", role["id"]), ("OWNED PATHS", ", ".join(role["paths"])), ("DEMO BRANCH", role["branch"])]:
        story += [Paragraph(label,styles["eyebrow"]),Paragraph(inline(value),styles["body"]),Spacer(1,8)]
    story += [Spacer(1,24),Paragraph("YOUR HANDOFF PACK",styles["eyebrow"]),Paragraph("1. Your role prompt<br/>2. Common context.md<br/>3. Complete supplied ARCHITECTURE.md<br/>4. Complete supplied CONTRACT.md",styles["body"]),Spacer(1,15),Paragraph("Fixed reference plan. Device assignments and planning are simulated. This document does not claim that agents executed code or connected to other laptops. The supplied documents describe AgentSync, not a migration of the running Upside Down application.",styles["body"])]
    for section in [role["prompt"], data["context"], architecture, contract]:
        story.append(PageBreak()); story.extend(markdown(section))
    def footer(canvas, document):
        canvas.saveState(); canvas.setStrokeColor(colors.HexColor("#D8E1D0")); canvas.line(56,43,539,43)
        canvas.setFont("Body",8); canvas.setFillColor(GREEN)
        canvas.drawString(56,29,f'UPSIDE DOWN  /  AgentSync reference pack  /  Laptop {letter} · {role["id"]}')
        canvas.drawRightString(539,29,str(document.page))
        if document.page > 1:
            canvas.setFont("Body",7); canvas.drawString(56,817,role["name"] + "  /  Shared plan, individual ownership")
        canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    print(f"Created {target.name}: {target.stat().st_size} bytes")
