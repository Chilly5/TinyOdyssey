"""Create narration, an original electronic score, timed captions and shot timing.
Requires edge-tts, imageio-ffmpeg, numpy and Pillow. No API key needed.
"""
import asyncio
import json
import math
import pathlib
import re
import subprocess
import wave
import numpy as np
import edge_tts
import imageio_ffmpeg

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE / 'work'
WORK.mkdir(exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
RATE = 48000
FPS = 24
stories = json.loads((HERE / 'stories.json').read_text())

def write_wave(path, audio):
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(2 if audio.ndim == 2 else 1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes((np.clip(audio, -.98, .98)*32767).astype('<i2').tobytes())

async def prepare(story):
    sid = story['id']
    folder = WORK / sid
    folder.mkdir(exist_ok=True)
    beats, pieces, cursor = [], [], 0
    for i, (caption, text) in enumerate(story['beats']):
        mp3, wav = folder / f'voice-{i}.mp3', folder / f'voice-{i}.wav'
        if not mp3.exists():
            await edge_tts.Communicate(text, story['voice'], rate='+14%').save(str(mp3))
        subprocess.run([FF,'-v','error','-y','-i',str(mp3),'-ar',str(RATE),'-ac','1',str(wav)],check=True)
        with wave.open(str(wav),'rb') as f:
            data=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768
        # Trim only the service's exterior silence; retain natural speech pauses.
        live=np.flatnonzero(abs(data)>.004)
        if len(live): data=data[max(0,live[0]-2400):min(len(data),live[-1]+6000)]
        duration=math.ceil((len(data)/RATE+.40)*FPS)/FPS
        piece=np.zeros(round(duration*RATE),np.float32)
        start=round(.12*RATE)
        piece[start:start+len(data)]=data
        pieces.append(piece)
        beats.append(dict(index=i,start=cursor,end=cursor+duration,duration=duration,caption=caption,text=text,frames=round(duration*FPS)))
        cursor+=duration
    voice=np.concatenate(pieces)
    voice*=.74/max(.1,float(abs(voice).max()))
    music=np.zeros_like(voice)
    rng=np.random.default_rng(7)
    beat=60/112
    # Original D-minor / Dorian plucks and a restrained kick/snare bed.
    notes=[146.832,220,293.665,349.228,146.832,220,329.628,440]
    for n,start in enumerate(np.arange(0,cursor,beat/2)):
        at=round(start*RATE); length=min(round(.55*RATE),len(music)-at)
        tt=np.arange(length)/RATE; freq=notes[n%len(notes)]
        pluck=(np.sin(2*np.pi*freq*tt)+.22*np.sin(4*np.pi*freq*tt))*np.exp(-tt*8)*.038
        music[at:at+length]+=pluck
        if n%4==0:
            music[at:at+length]+=.07*np.sin(2*np.pi*(62*tt+4*(1-np.exp(-tt*22))))*np.exp(-tt*17)
        if n%4==2:
            music[at:at+length]+=.023*rng.normal(size=length)*np.exp(-tt*42)
    # Punches on the reveal, failure and final joke; original synthesized effects.
    for index in [0,4,7]:
        at=round(beats[index]['start']*RATE); length=min(RATE//3,len(music)-at)
        tt=np.arange(length)/RATE
        music[at:at+length]+=.08*np.sin(2*np.pi*(120*tt-80*tt*tt))*np.exp(-tt*13)
    fade=np.minimum(1,np.arange(len(music))/(RATE*.3))*np.minimum(1,np.arange(len(music))[::-1]/(RATE*.5))
    mixed=voice+music*fade
    write_wave(folder/'mix.wav',np.column_stack((mixed,mixed)))
    write_wave(folder/'narration.wav',voice)
    story['timeline']=beats;story['duration']=cursor;story['fps']=FPS
    (folder/'timeline.json').write_text(json.dumps(story,indent=2))
    def stamp(t):
        ms=round(t*1000); h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
        return f'{h:02}:{m:02}:{s:02},{ms:03}'
    captions='\n\n'.join(f"{i+1}\n{stamp(b['start'])} --> {stamp(b['end'])}\n{b['text']}" for i,b in enumerate(beats))+'\n'
    (HERE/f'{sid}.srt').write_text(captions,encoding='utf-8')
    (HERE/f'{sid}.vtt').write_text('WEBVTT\n\n'+re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})',r'\1.\2',captions),encoding='utf-8')
    print(sid,round(cursor,2),'seconds',flush=True)

async def main():
    await asyncio.gather(*(prepare(s) for s in stories))

if __name__=='__main__': asyncio.run(main())
