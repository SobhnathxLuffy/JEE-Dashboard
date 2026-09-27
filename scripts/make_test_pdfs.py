"""Generate adversarial test PDFs for the full-app verification pass.

Outputs (scripts/test-assets/):
  offset-drill.pdf    — single-section paper numbered Q21-Q28 (tests first_q offset)
  key-digital.pdf     — digital answer-key PDF (tests A4 key-PDF extraction)
  full-paper-mini.pdf — 3 pages: P Q1-3 / C Q4-6 / M Q7-9 (tests full-paper mode)
  keyless-drill.pdf   — 4-question sheet for key-later (self-mark) flow
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = "/home/z/my-project/scripts/test-assets"
os.makedirs(OUT, exist_ok=True)


def header(c, title):
    w, h = A4
    c.setFont("Helvetica-Bold", 15)
    c.drawString(60, h - 70, title)
    c.setFont("Helvetica", 12)
    return h - 105


def q_mcq(c, y, no, text, opts):
    c.drawString(60, y, f"Q{no}. {text}")
    y -= 20
    c.drawString(72, y, "   ".join(f"({l}) {o}" for l, o in zip("ABCD", opts)))
    return y - 26


def q_num(c, y, no, text):
    c.drawString(60, y, f"Q{no}. {text} ____")
    return y - 26


def save(c, name):
    path = os.path.join(OUT, name)
    c.save()
    print("written", path)


# ── 1. offset drill: Q21-Q28 on one page ────────────────────────────────────
c = canvas.Canvas(os.path.join(OUT, "offset-drill.pdf"), pagesize=A4)
y = header(c, "Integration Drill - Q21 to Q28 (coaching module sheet)")
c.drawString(60, y, "Answer with A-D or a number. Time: 8 minutes.")
y -= 30
y = q_mcq(c, y, 21, "Integral of 2x dx is:", ["x^2 + C", "2x^2 + C", "x + C", "2x + C"])
y = q_mcq(c, y, 22, "d/dx (sin x) =", ["cos x", "-cos x", "sin x", "tan x"])
y = q_mcq(c, y, 23, "Integral of sec^2 x dx is:", ["tan x", "cot x", "sec x", "-tan x"])
y = q_num(c, y, 24, "Value of integral of 3x^2 dx from 0 to 1")
y = q_num(c, y, 25, "If f(x) = x^3, f'(2) equals")
y = q_mcq(c, y, 26, "Integral of 1/x dx =", ["ln|x| + C", "x^-2/2 + C", "-1/x^2 + C", "e^x + C"])
y = q_mcq(c, y, 27, "d/dx (e^2x) =", ["e^2x", "2e^2x", "2e^x", "e^x"])
y = q_num(c, y, 28, "Area under y = 2x from x=0 to x=3")
save(c, "offset-drill.pdf")

# ── 2. digital key PDF for offset-drill (dirty shapes) ──────────────────────
c = canvas.Canvas(os.path.join(OUT, "key-digital.pdf"), pagesize=A4)
y = header(c, "Answer Key - Integration Drill Q21-Q28")
key_lines = [
    "21. A",
    "22. C",
    "23. B/C",
    "24. bonus",
    "25. 12",
    "26. D",
    "27. B",
    "28. 9",
]
for ln in key_lines:
    c.drawString(70, y, ln)
    y -= 24
c.setFont("Helvetica-Oblique", 10)
c.drawString(70, y - 8, "Note: Q23 accepts B or C (revised key). Q24 dropped - bonus for all.")
save(c, "key-digital.pdf")

# ── 3. full paper mini: P Q1-3 (page1) / C Q4-6 (page2) / M Q7-9 (page3) ────
c = canvas.Canvas(os.path.join(OUT, "full-paper-mini.pdf"), pagesize=A4)
y = header(c, "Mini Full Paper - Page 1: Physics (Q1-Q3)")
y = q_mcq(c, y, 1, "SI unit of power is:", ["Watt", "Joule", "Newton", "Pascal"])
y = q_num(c, y, 2, "A 5 kg ball at 10 m height has PE of ___ J (g = 10)")
y = q_mcq(c, y, 3, "Sound cannot travel through:", ["Vacuum", "Air", "Water", "Steel"])
c.showPage()
y = header(c, "Mini Full Paper - Page 2: Chemistry (Q4-Q6)")
y = q_mcq(c, y, 4, "pH of a neutral solution at 25 C is:", ["7", "0", "14", "1"])
y = q_num(c, y, 5, "Number of moles in 44 g of CO2 (M = 44 g/mol)")
y = q_mcq(c, y, 6, "Avogadro number is approximately:", ["6.022 x 10^23", "6.022 x 10^22", "3.14 x 10^23", "9.8 x 10^23"])
c.showPage()
y = header(c, "Mini Full Paper - Page 3: Mathematics (Q7-Q9)")
y = q_mcq(c, y, 7, "sin^2 x + cos^2 x =", ["1", "0", "2", "tan^2 x"])
y = q_num(c, y, 8, "If 2x = 10 then x equals")
y = q_mcq(c, y, 9, "Derivative of a constant is:", ["0", "1", "x", "undefined"])
save(c, "full-paper-mini.pdf")

# ── 4. keyless drill (self-mark flow) ───────────────────────────────────────
c = canvas.Canvas(os.path.join(OUT, "keyless-drill.pdf"), pagesize=A4)
y = header(c, "Probability Exercise - Q1 to Q4 (no key printed)")
y = q_mcq(c, y, 1, "Probability of a sure event is:", ["1", "0", "0.5", "2"])
y = q_mcq(c, y, 2, "Range of probability is:", ["0 to 1", "-1 to 1", "0 to 100", "any"])
y = q_num(c, y, 3, "Two fair coins are tossed. P(two heads) = (as 0.25)")
y = q_mcq(c, y, 4, "P(A) = 0.3 means P(not A) =", ["0.7", "0.3", "1", "0"])
save(c, "keyless-drill.pdf")

print("all test PDFs generated")
