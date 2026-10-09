"""Extract actual encoded composite frames without rerendering character pixels."""
import argparse
import json
import subprocess
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--out', default='dist/dango-complete-audit/actions')
args = parser.parse_args()
root = Path(args.out)
records = []
for kind in ['action', 'session', 'expression']:
    for file in sorted((root / kind).glob('*/record.json')):
        records.append((file.parent, json.loads(file.read_text())))
for page in range((len(records) + 7) // 8):
    rows = records[page * 8:(page + 1) * 8]
    sheet = Image.new('RGB', (900, len(rows) * 230), '#e9edef')
    draw = ImageDraw.Draw(sheet)
    for row, (folder, record) in enumerate(rows):
        draw.text((5, row * 230 + 10), record['kind'] + '/' + record['id'], fill='#263642')
        for column, progress in enumerate([.15, .5, .85]):
            command = ['ffmpeg', '-v', 'error', '-ss', str(record['durationMs'] / 1000 * progress),
                       '-i', str(folder / 'normal-speed.mp4'), '-frames:v', '1', '-f', 'image2pipe',
                       '-vcodec', 'png', '-']
            pixels = subprocess.run(command, capture_output=True, check=True).stdout
            image = Image.open(BytesIO(pixels))
            sheet.paste(image.crop((12, 145, 232, 365)), (220 + column * 225, row * 230))
            draw.text((225 + column * 225, row * 230 + 215), f'{progress:.2f}', fill='#263642')
    sheet.save(root / f'composite-review-{page + 1:02}.png')
print(json.dumps({'items': len(records), 'frames': len(records) * 3, 'nativeBodyWidthCss': 99}))
