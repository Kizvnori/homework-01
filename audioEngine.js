// Audio Engine for osu! mania Web
// Handles Web Audio API playback, hitsounds, and procedural demo music generation

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.audioBuffer = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.hitsoundGain = null;
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseOffset = 0;
        this.masterVolume = 0.8;
        this.hitsoundVolume = 0.6;
        this.userOffsetMs = 0; // Calibration offset in ms
    }

    init() {
        if (!this.ctx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextClass();
            this.gainNode = this.ctx.createGain();
            this.gainNode.gain.value = this.masterVolume;
            this.gainNode.connect(this.ctx.destination);

            this.hitsoundGain = this.ctx.createGain();
            this.hitsoundGain.gain.value = this.hitsoundVolume;
            this.hitsoundGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    async loadFromBlob(blob) {
        this.init();
        const arrayBuffer = await blob.arrayBuffer();
        this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        return this.audioBuffer;
    }

    play(startAtSeconds = 0) {
        this.init();
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch (e) { }
        }

        if (!this.audioBuffer) return;

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.gainNode);

        const safeOffset = Math.max(0, Math.min(startAtSeconds, this.audioBuffer.duration));
        this.startTime = this.ctx.currentTime - safeOffset;
        this.pauseOffset = safeOffset;
        this.sourceNode.start(0, safeOffset);
        this.isPlaying = true;
    }

    pause() {
        if (this.isPlaying && this.sourceNode) {
            this.pauseOffset = this.getCurrentTime();
            try { this.sourceNode.stop(); } catch (e) { }
            this.sourceNode = null;
            this.isPlaying = false;
        }
    }

    stop() {
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch (e) { }
            this.sourceNode = null;
        }
        this.isPlaying = false;
        this.pauseOffset = 0;
    }

    getCurrentTime() {
        if (!this.isPlaying) return this.pauseOffset;
        return (this.ctx.currentTime - this.startTime) + (this.userOffsetMs / 1000);
    }

    getDuration() {
        return this.audioBuffer ? this.audioBuffer.duration : 0;
    }

    setMusicVolume(val) {
        this.masterVolume = Math.max(0, Math.min(1, val));
        if (this.gainNode) this.gainNode.gain.value = this.masterVolume;
    }

    setHitsoundVolume(val) {
        this.hitsoundVolume = Math.max(0, Math.min(1, val));
        if (this.hitsoundGain) this.hitsoundGain.gain.value = this.hitsoundVolume;
    }

    // Play procedural hitsound (crisp osu! mania click/drum)
    playHitSound(type = 'normal') {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.hitsoundGain);

        if (type === 'clap') {
            // Snappy clap / noise
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(120, now + 0.06);
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else {
            // Standard crisp mania hit tick
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        }
    }

    // Procedural Electronic Demo Music Generator (165 BPM Synth Wave)
    generateDemoSong() {
        this.init();
        const sampleRate = this.ctx.sampleRate;
        const bpm = 165;
        const beatSec = 60 / bpm;
        const totalMeasures = 32;
        const duration = totalMeasures * 4 * beatSec; // ~46.5 seconds
        const buffer = this.ctx.createBuffer(2, Math.floor(sampleRate * duration), sampleRate);
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);

        const chordProgression = [
            [220.00, 261.63, 329.63, 392.00], // Am7
            [174.61, 220.00, 261.63, 329.63], // Fmaj7
            [261.63, 329.63, 392.00, 493.88], // Cmaj7
            [196.00, 246.94, 293.66, 392.00]  // G
        ];

        const melodyNotes = [
            440, 493.88, 523.25, 659.25, 587.33, 523.25, 493.88, 440,
            659.25, 783.99, 880, 783.99, 659.25, 587.33, 659.25, 523.25
        ];

        for (let i = 0; i < buffer.length; i++) {
            const t = i / sampleRate;
            const beatIndex = t / beatSec;
            const measureIndex = Math.floor(beatIndex / 4);
            const subBeat = beatIndex % 1;
            const chord = chordProgression[measureIndex % 4];

            let sampleL = 0;
            let sampleR = 0;

            // Kick drum on beats 0, 1, 2, 3
            if (measureIndex >= 4) {
                const kickTime = (beatIndex % 1) * beatSec;
                if (kickTime < 0.2) {
                    const kickFreq = 150 * Math.exp(-kickTime * 25);
                    const kickAmp = Math.exp(-kickTime * 18);
                    const kickVal = Math.sin(2 * Math.PI * kickFreq * kickTime) * kickAmp * 0.8;
                    sampleL += kickVal;
                    sampleR += kickVal;
                }
            }

            // Snare / Clap on beats 1 & 3
            if (measureIndex >= 4) {
                const snareBeat = (beatIndex % 2);
                if (snareBeat >= 1 && snareBeat < 1.3) {
                    const snareTime = (snareBeat - 1) * beatSec;
                    const noise = (Math.random() * 2 - 1) * Math.exp(-snareTime * 20);
                    const body = Math.sin(2 * Math.PI * 200 * snareTime) * Math.exp(-snareTime * 25);
                    const snareVal = (noise * 0.4 + body * 0.4) * 0.7;
                    sampleL += snareVal;
                    sampleR += snareVal;
                }
            }

            // Hi-hats on 8th notes
            if (measureIndex >= 2) {
                const hatTime = ((beatIndex * 2) % 1) * (beatSec / 2);
                if (hatTime < 0.05) {
                    const hatVal = (Math.random() * 2 - 1) * Math.exp(-hatTime * 60) * 0.15;
                    sampleL += hatVal * 0.8;
                    sampleR += hatVal * 1.2;
                }
            }

            // Arpeggiated synth chords
            const arpStep = Math.floor((beatIndex * 4) % 4);
            const chordFreq = chord[arpStep % chord.length];
            const synthEnv = Math.exp(-((beatIndex * 4) % 1) * 6);
            const saw = (2 * ((t * chordFreq) % 1) - 1) * synthEnv * 0.12;
            sampleL += saw;
            sampleR += saw * 0.9;

            // Lead Melody
            if (measureIndex >= 8 && measureIndex < 28) {
                const noteIndex = Math.floor((beatIndex * 2) % melodyNotes.length);
                const leadFreq = melodyNotes[noteIndex];
                const leadEnv = Math.exp(-((beatIndex * 2) % 1) * 4);
                // Pulse wave
                const phase = (t * leadFreq) % 1;
                const pulse = (phase < 0.4 ? 1 : -1) * leadEnv * 0.18;
                sampleL += pulse * 0.8;
                sampleR += pulse * 1.1;
            }

            // Soft bass
            const bassFreq = chord[0] / 2;
            const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.25;
            sampleL += bass;
            sampleR += bass;

            // Subtle Fade In / Out
            let masterEnv = 1;
            if (t < 2) masterEnv = t / 2;
            if (t > duration - 2) masterEnv = Math.max(0, (duration - t) / 2);

            left[i] = Math.max(-1, Math.min(1, sampleL * masterEnv));
            right[i] = Math.max(-1, Math.min(1, sampleR * masterEnv));
        }

        this.audioBuffer = buffer;
        return buffer;
    }
}

window.AudioEngine = AudioEngine;
