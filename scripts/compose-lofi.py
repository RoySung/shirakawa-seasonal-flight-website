"""Original 48-bar acoustic watercolor score, 70 BPM, circular room tails."""
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from scipy.io.wavfile import write
from scipy.signal import butter, sosfilt

sr = 32000
beat = 60 / 70
bars = 48
length = bars * 4 * beat
n = round(length * sr)
rng = np.random.default_rng(89)
mix = np.zeros((n, 2))

def add(sound, start, amp=1, pan=0):
    idx = (np.arange(len(sound)) + round(start * sr)) % n
    mix[idx, 0] += sound * amp * np.sqrt((1 - pan) / 2)
    mix[idx, 1] += sound * amp * np.sqrt((1 + pan) / 2)

def note(midi, dur, kind='guitar'):
    t = np.arange(round(dur * sr)) / sr
    f = 440 * 2 ** ((midi - 69) / 12)
    tail = np.clip((dur - t) / .22, 0, 1)
    if kind == 'bass':
        return (np.sin(2*np.pi*f*t) + .1*np.sin(4*np.pi*f*t)) * (1-np.exp(-t*30)) * np.exp(-t*2.1) * tail
    sound = np.zeros_like(t)
    if kind == 'piano':
        for h in range(1, 11):
            partial = f*h*np.sqrt(1+.00013*h*h)
            sound += np.sin(2*np.pi*partial*t) / h**1.8 * np.exp(-t*(.65+.32*h))
        return sound * (1-np.exp(-t*180)) * tail
    for h in range(1, min(24, int(8500/f))):
        strength = np.sin(np.pi*h*.23) / h**1.55
        sound += strength*np.sin(2*np.pi*f*h*t)*np.exp(-t*(.75+.25*h+.025*h*h))
    attack = sosfilt(butter(2, [800, 3000], btype='bandpass', fs=sr, output='sos'), rng.normal(0, 1, len(t)))
    sound += .012*attack*np.exp(-t*120)
    sound += .018*np.sin(2*np.pi*193*t)*np.exp(-t*25)
    return sound*(1-np.exp(-t*450))*tail

chords = [[53,57,60,64,67], [52,55,59,62,67], [50,53,57,60,64], [48,52,55,59,64],
          [53,57,60,64,69], [52,55,59,62,67], [50,53,57,60,65], [55,59,62,65,69]]
melodies = [[76,79,81], [79,76,74], [77,76,72], [74,71,67],
            [76,79,83], [79,76,74], [77,74,72], [74,71,67]]
# Six eight-bar chapters: arrival, gentle pulse, open air, return, open air, home.
for bar in range(bars):
    start = bar*4*beat
    chapter = bar//8
    chord = chords[bar%8]
    quiet = chapter in [2,4]
    pattern = [(0,0), (.75,2), (1.5,3), (2.25,1), (3,4), (3.5,2)]
    if quiet:
        pattern = [(0,0), (1.5,2), (3,3)]
    for j, (pos, voice) in enumerate(pattern):
        jitter = rng.uniform(-.008,.008) if pos else 0
        add(note(chord[voice], 3.1), start+pos*beat+jitter, (.115 if voice==0 else .095)*rng.uniform(.91,1.04), -.18+voice*.08)
    # Sparse piano phrases alternate with guitar-only bars; never a continuous lead.
    if not quiet and bar%4 in [1,3] and not (chapter==0 and bar<4):
        phrase = melodies[bar%8]
        for j, pitch in enumerate(phrase[:2 if bar%4==1 else 3]):
            add(note(pitch,3.7,'piano'), start+(1.25+j*.9)*beat, .034 if j else .043, -.27)
    if not quiet and chapter!=0:
        add(note(chord[0]-12,1.4,'bass'), start, .085)
        if bar%2==0:
            add(note(chord[0]-12,1.1,'bass'), start+2.5*beat, .045)
    # A low, sparse pulse and a quiet brushed backbeat leave the landscape space.
    if chapter in [1,3,5] and not (chapter==5 and bar%8>=6):
        t=np.arange(int(sr*.3))/sr
        kick=np.sin(2*np.pi*(43*t+3*(1-np.exp(-t*24))))*np.exp(-t*21)*(1-np.exp(-t*250))
        add(kick,start,.055)
        if bar%2==0:
            add(kick,start+2.5*beat,.027)
        for pos in ([3] if bar%2 else [1,3]):
            t=np.arange(int(sr*.22))/sr
            brush=sosfilt(butter(2,[1100,3600],btype='bandpass',fs=sr,output='sos'),rng.normal(0,1,len(t)))
            add(brush*np.exp(-t*31),start+(pos+.04)*beat,.018,-.2)

# A barely audible, seamless air-and-water bed, without repetitive bird samples.
time=np.arange(n)/sr
for channel in range(2):
    noise=rng.normal(0,1,n)
    # Warm up a periodic filter with its own tail so the loop boundary is continuous.
    pad=sr*2
    air=sosfilt(butter(2,[180,1700],btype='bandpass',fs=sr,output='sos'),np.concatenate([noise[-pad:],noise]))[pad:]
    envelope=.65+.18*np.sin(2*np.pi*time/length*5+channel)+.1*np.sin(2*np.pi*time/length*11)
    mix[:,channel]+=air*envelope*.0018

dry=mix.copy()
for delay,gain in [(.11,.055),(.23,.055),(.43,.04),(.67,.028),(.91,.018), (1.27,.01)]:
    mix+=np.roll(dry,round(delay*sr),axis=0)[:,::-1]*gain
# Circular low pass preserves the instrumental tail across the repeat.
pad=sr*2
mix=sosfilt(butter(2,5200,fs=sr,output='sos'),np.concatenate([mix[-pad:],mix]),axis=0)[pad:]
mix=np.tanh(mix*1.1)
# Leave headroom and avoid turning sparse sections into loud individual plucks.
mix*=min(1.8,.70/max(np.max(np.abs(mix)),.001))
out=Path(__file__).resolve().parents[1]/'docs/assets/village-watercolor-acoustic.mp3'
with tempfile.TemporaryDirectory() as td:
    wav=Path(td)/'music.wav'
    write(wav,sr,(mix*32767).astype(np.int16))
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','160k',str(out)],check=True)
print(f'{out.name}: {length:.2f}s, 70 BPM; peak={np.max(np.abs(mix)):.3f}, rms={np.sqrt(np.mean(mix**2)):.4f}')
