"""Disposable PDF for native-text and /Rotate regression checks, not library content."""
from pathlib import Path
from reportlab.pdfgen import canvas

target = Path('tmp/pdfs/native-orientation-fixture.pdf')
target.parent.mkdir(parents=True, exist_ok=True)
pdf = canvas.Canvas(str(target), pagesize=(600, 800))
for angle, metadata in [(0, 0), (90, 0), (180, 0), (270, 0), (0, 90), (90, 90)]:
    pdf.setPageRotation(metadata)
    pdf.saveState()
    pdf.translate(300, 400)
    pdf.rotate(angle)
    pdf.setFont('Helvetica', 14)
    pdf.drawString(-220, 30, 'Equivalence relations are reflexive and symmetric.')
    pdf.drawString(-220, 0, 'Physical page numbers must stay unchanged.')
    pdf.restoreState()
    pdf.showPage()
pdf.save()
print(target)
