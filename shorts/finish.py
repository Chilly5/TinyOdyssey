"""Composite phone-safe typography and encode the finished 1080x1920 films.
python shorts/finish.py [--preview] [--only nobody,icarus,sisyphus]
"""
import argparse
import json
import pathlib
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

HERE=pathlib.Path(__file__).resolve().parent
W,H=1080,1920
FF=imageio_ffmpeg.get_ffmpeg_exe()
FONTS=pathlib.Path('C:/Windows/Fonts')
def font(size,bold=True):
    paths=[FONTS/('arialbd.ttf' if bold else 'arial.ttf'),pathlib.Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')]
    return ImageFont.truetype(str(next(p for p in paths if p.exists())),size)

def overlay(story,beat):
    im=Image.new('RGBA',(W,H),(0,0,0,0))
    d=ImageDraw.Draw(im)
    # Quiet dark fades protect readability without obscuring the action.
    for y in range(H):
        alpha=int(170*max(0,1-y/480))
        if y>1300:alpha=max(alpha,int(230*min(1,(y-1300)/330)))
        if alpha:d.line((0,y,W,y),fill=(9,20,32,alpha))
    color=story['color']
    d.rounded_rectangle((72,98,103,129),radius=6,fill=color)
    d.text((118,89),'TINY ODYSSEY',font=font(38),fill='white')
    d.text((73,148),'SMALL WORLD. VERY BIG PROBLEMS.',font=font(21),fill='#CDDDE4')
    titlefont=font(77)
    if d.textlength(story['title'],font=titlefont)>880:titlefont=font(66)
    d.text((70,211),story['title'],font=titlefont,fill='white')
    d.rounded_rectangle((74,310,218,318),radius=4,fill=color)
    d.text((74,338),story['subtitle'],font=font(24),fill=color)
    d.text((74,1375),f"{story['number']}  /  MYTHS IN MINIATURE",font=font(25),fill=color)
    lines=beat['caption'].split('\n')
    size=78
    while max(d.textlength(line,font=font(size)) for line in lines)>850:size-=1
    for j,line in enumerate(lines):
        d.text((70,1437+j*(size+14)),line,font=font(size),fill='white' if j==0 else color,stroke_width=1)
    # Keep the caption below the action and above the mobile app's bottom controls.
    for j in range(8):
        x=74+j*111
        d.rounded_rectangle((x,1701,x+98,1707),radius=3,fill=color if j<=beat['index'] else '#4F5D67')
    d.text((74,1740),story['place'],font=font(23),fill='#E2E9EC')
    d.text((74,1794),'tinyodyssey.us',font=font(28),fill='white')
    d.text((764,1799),'GREEK MYTHS',font=font(19),fill='#BECBD3')
    return im

def finish(sid,preview=False):
    folder=HERE/'work'/sid
    story=json.loads((folder/'timeline.json').read_text())
    overlays=[overlay(story,b) for b in story['timeline']]
    if preview:
        dest=folder/'caption-review';dest.mkdir(exist_ok=True)
        for beat,over in zip(story['timeline'],overlays):
            frame=round((beat['start']+beat['duration']*.5)*24)+1
            file=folder/'frames'/f'{frame:06}.png'
            if not file.exists():file=folder/'preview'/f'{frame:06}.png'
            image=Image.open(file).convert('RGBA').resize((W,H))
            image.alpha_composite(over)
            image.convert('RGB').save(dest/f"{beat['index']}.jpg",quality=90)
        print('PREVIEW',sid,flush=True);return
    files=sorted((folder/'frames').glob('*.png'))
    expected=sum(b['frames'] for b in story['timeline'])
    assert len(files)==expected,(sid,len(files),expected)
    command=[FF,'-hide_banner','-v','warning','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','24','-i','pipe:0',
             '-i',str(folder/'mix.wav'),'-c:v','libx264','-preset','fast','-crf','19','-threads','4','-pix_fmt','yuv420p',
             '-c:a','aac','-b:a','192k','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-movflags','+faststart','-shortest',
             '-metadata','title=Tiny Odyssey - '+story['title'],'-metadata','comment=Original animated mythology parody; narration synthesized with Edge TTS.',str(HERE/f'{sid}.mp4')]
    with (folder/'encode.log').open('w') as log:
        p=subprocess.Popen(command,stdin=subprocess.PIPE,stderr=log)
        bi=0
        for n,file in enumerate(files):
            if bi<7 and n>=round(story['timeline'][bi]['end']*24):bi+=1
            im=Image.open(file).convert('RGBA')
            im.alpha_composite(overlays[bi])
            rgb=im.convert('RGB')
            p.stdin.write(rgb.tobytes())
            if n==0:rgb.save(HERE/f'{sid}.jpg',quality=94)
            if n%240==0:print(sid,n,'/',expected,flush=True)
        p.stdin.close()
        if p.wait()!=0:raise RuntimeError(f'{sid}: encoder failed; see {folder}/encode.log')
    print('DONE',sid,(HERE/f'{sid}.mp4').stat().st_size,flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--only',default='nobody,icarus,sisyphus');ap.add_argument('--preview',action='store_true');a=ap.parse_args()
    for sid in a.only.split(','):finish(sid,a.preview)
