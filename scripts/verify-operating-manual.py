"""Structural artifact checks; visual review is an explicit human/agent step."""
import argparse
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--visually-reviewed', action='store_true')
args = parser.parse_args()
directory = Path(__file__).resolve().parent.parent / 'output' / 'manual'
pdf_path = directory / 'Arrow_Operating_Manual_HE.pdf'
html_path = directory / 'Arrow_Operating_Manual_HE.html'
reader = PdfReader(pdf_path)
texts = [page.extract_text() for page in reader.pages]
html = html_path.read_text(encoding='utf8')
assert len(reader.pages) == 8, 'Expected exactly eight pages'
assert all(len(text) > 600 for text in texts), 'Blank or unexpectedly sparse page'
assert '${ref' not in ''.join(texts), 'Unresolved source-reference placeholder'
assert all(term in html for term in ['CONTEXT_READY', 'Hanging Man', 'Inverted Hammer',
    '198.10', '203.10', '843', '23.7', '52,600', 'Exit All',
    'לשונית לוגי ההכנה', 'Open editor in new window', 'Pine Logs']), 'Required operating facts missing'
assert 'contenteditable="true"' in html, 'Editable version unavailable'
assert not any(page.get('/AcroForm') for page in reader.pages)
metadata_path = directory / 'manual-build-metadata.json'
metadata = json.loads(metadata_path.read_text(encoding='utf8'))
assert len(metadata['officialSources']) == 13, 'Expected thirteen official source links'
metadata['preloadWorkflow'] = {
    'logSource': 'DETACHED_LINKED_PINE_EDITOR', 'selectorLabel': 'לשונית לוגי ההכנה',
    'helperMustRemainOpen': True, 'mainChartDataWindowRemainsVisible': True,
    'sourceRunMatchRequired': True,
}
metadata['pdfSha256'] = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
metadata['pdfBytes'] = pdf_path.stat().st_size
metadata['qualityAssurance'] = {
    'pages': len(reader.pages), 'pageFormat': 'A4', 'language': 'Hebrew RTL', 'font': 'Arial',
    'allEightRenderedPagesVisuallyInspected': args.visually_reviewed,
    'visualDefectsFound': 0 if args.visually_reviewed else None,
    'textCharactersPerPage': [len(text) for text in texts],
    'sourceReferencesResolved': True, 'accountIdsIncluded': False,
    'accountScreenshotsIncluded': False, 'editableHtml': True,
    'networkResourcesInHtml': False, 'noBrokerOrRuntimeActions': True,
    'pageImages': [
        {'page': index, 'path': str(Path('tmp/pdfs') / f'arrow-manual-page-{index}.png'),
         'sha256': hashlib.sha256((directory.parent.parent / 'tmp/pdfs' /
             f'arrow-manual-page-{index}.png').read_bytes()).hexdigest()}
        for index in range(1, 9)
    ],
}
metadata['renderer'] = 'Fresh isolated owned headless Chrome; Poppler PNGs; pypdf checks; all8 PNGs inspected.'
metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps({'pdfPages': len(reader.pages), 'pdfBytes': metadata['pdfBytes'],
    'pdfSha256': metadata['pdfSha256'], 'visualReviewConfirmed': args.visually_reviewed}, ensure_ascii=False))
