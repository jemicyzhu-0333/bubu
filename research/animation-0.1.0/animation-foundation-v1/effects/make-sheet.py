from PIL import Image, ImageDraw
import json
from pathlib import Path
root = Path(__file__).parent
sheet = Image.new('RGB', (1056, 630), '#f4f1eb')
draw = ImageDraw.Draw(sheet)
draw.text((20, 12), 'Native bounded particles | actual source meshes + runtime instance transforms | Blender CPU only', fill='#222222')
for n, kind in enumerate(['forest', 'sakura', 'halo']):
    image = Image.open(root / 'renders' / kind / '0000.png').convert('RGBA')
    tile = image.resize((340, 340))
    sheet.paste(tile, (8 + n * 352, 42), tile)
    draw.text((20 + n * 352, 390), kind + ' / sparse stream at 2.5s', fill='#222222')
    data = json.loads((root / 'renders' / f'{kind}.json').read_text())
    body = next(m for m in data['frames'][0]['meshes'] if m['name'] == 'Bubu_body')
    xs = body['positions'][::3]
    projected_body_width = (max(xs) - min(xs)) * 512 / 3
    size = round(512 * 99 / projected_body_width)
    small = image.resize((size, size), Image.Resampling.LANCZOS)
    background = Image.new('RGB', (168, 178), '#20252e')
    background.paste(small, ((168 - size) // 2, (178 - size) // 2), small)
    sheet.paste(background, (20 + n * 352, 420))
    for y, text in [(455, 'Body width: 99px'), (475, 'geometry-derived'), (495, 'CPU proxy only'),
                    (525, f"{data['effectEvidence']['liveCount']} live flecks")]:
        draw.text((196 + n * 352, y), text, fill='#222222')
sheet.save(root / 'renders' / 'prototype-sheet.png')
