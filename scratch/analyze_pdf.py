import os
from pypdf import PdfReader
import json

def analyze_pdfs(pdf_dir):
    results = {}
    for filename in os.listdir(pdf_dir):
        if not filename.endswith('.pdf'):
            continue
        
        path = os.path.join(pdf_dir, filename)
        reader = PdfReader(path)
        page = reader.pages[0]
        text = page.extract_text()
        
        results[filename] = {
            "text": text,
            "mediabox": [float(x) for x in page.mediabox]
        }
    
    with open('pdf_analysis.json', 'w') as f:
        json.dump(results, f, indent=2)

if __name__ == "__main__":
    analyze_pdfs(r'd:\webprojects\viale_sim\viale_sim_assets\pdf')
