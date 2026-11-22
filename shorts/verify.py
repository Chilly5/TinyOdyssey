"""Decode the deliverable films and verify format, timing and audio levels."""
import json
import pathlib
import re
import subprocess
import imageio_ffmpeg
HERE=pathlib.Path(__file__).resolve().parent
ff=imageio_ffmpeg.get_ffmpeg_exe()
reports={}
for sid in ['nobody','icarus','sisyphus']:
    file=HERE/f'{sid}.mp4'
    reader=imageio_ffmpeg.read_frames(str(file))
    meta=next(reader);reader.close()
    count,duration=imageio_ffmpeg.count_frames_and_secs(str(file))
    srt=(HERE/f'{sid}.srt').read_text()
    end=re.findall(r'--> (\d+):(\d+):(\d+),(\d+)',srt)[-1]
    h,m,s,ms=map(int,end);expected=round((h*3600+m*60+s+ms/1000)*24)
    p=subprocess.run([ff,'-hide_banner','-xerror','-i',str(file),'-af','ebur128=peak=true','-f','null','-'],capture_output=True,text=True)
    summary=p.stderr[p.stderr.rfind('Summary:'):]
    loudness=float(re.search(r'I:\s+([-\d.]+) LUFS',summary)[1])
    peak=float(re.search(r'Peak:\s+([-\d.]+) dBFS',summary)[1])
    assert p.returncode==0,p.stderr[-2000:]
    assert meta['size']==(1080,1920),meta
    assert meta['fps']==24 and meta['codec']=='h264',meta
    assert count==expected,(sid,count,expected)
    assert peak<=-.5 and -18<=loudness<=-14,(sid,loudness,peak)
    assert (HERE/f'{sid}.jpg').stat().st_size>1000
    assert (HERE/f'{sid}.vtt').read_text().startswith('WEBVTT')
    reports[sid]={'pass':True,'width':1080,'height':1920,'fps':24,'frames':count,'seconds':duration,'codec':meta['codec'],'pixel_format':meta['pix_fmt'],'bytes':file.stat().st_size,'loudness_lufs':loudness,'true_peak_dbfs':peak,'full_decode_exit':p.returncode}
    print(sid,json.dumps(reports[sid]),flush=True)
(HERE.parent/'art/review/media-qa.json').write_text(json.dumps(reports,indent=2))
