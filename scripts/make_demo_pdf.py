"""Generate a tiny 1-page demo question-paper PDF for the PDF-test verification."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

out = "/home/z/my-project/.zscripts/demo-paper.pdf"
c = canvas.Canvas(out, pagesize=A4)
w, h = A4
c.setFont("Helvetica-Bold", 16)
c.drawString(60, h - 70, "Demo Physics Drill - Kinematics & Laws of Motion")
c.setFont("Helvetica", 12)
lines = [
    "Q1. A body starts from rest and reaches 30 m/s in 6 s.",
    "    Its acceleration is:",
    "    (A) 3 m/s2   (B) 5 m/s2   (C) 6 m/s2   (D) 10 m/s2",
    "",
    "Q2. The dimensional formula of work is:",
    "    (A) M L T^-2   (B) M L^2 T^-2   (C) M L^2 T^-3   (D) M L T^-1",
    "",
    "Q3. A 2 kg block under a net 6 N force accelerates at (m/s2): ____",
    "",
    "Q4. SI unit of impulse is:",
    "    (A) N s   (B) N/s   (C) J s   (D) kg m",
]
y = h - 110
for ln in lines:
    c.drawString(60, y, ln)
    y -= 22
c.save()
print("written", out)
