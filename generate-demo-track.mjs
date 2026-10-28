import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sampleRate = 44100;
const bpm = 124;
const beat = 60 / bpm;
const bars = 16;
const duration = bars * 4 * beat + 1.5;
const frameCount = Math.ceil(duration * sampleRate);
const left = new Float32Array(frameCount);
const right = new Float32Array(frameCount);
let noiseState = 0x1f123bb5;

const chordProgression = [
  [261.63, 329.63, 392.0],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [196.0, 246.94, 293.66],
];

const melody = [
  [0, 659.25], [1, 587.33], [2, 523.25], [3, 587.33],
  [4, 659.25], [5, 783.99], [6, 659.25], [7, 587.33],
  [8, 523.25], [9, 440.0], [10, 523.25], [11, 587.33],
  [12, 659.25], [13, 587.33], [14, 523.25], [15, 440.0],
];

function seededNoise() {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 0xffffffff) * 2 - 1;
}

function envelope(seconds, durationSeconds, attack, release) {
  if (seconds < attack) return seconds / attack;
  if (seconds > durationSeconds - release) return Math.max(0, (durationSeconds - seconds) / release);
  return 1;
}

function oscillator(phase, kind) {
  if (kind === "square") return Math.sin(phase) >= 0 ? 1 : -1;
  if (kind === "saw") return 2 * (phase / (Math.PI * 2) - Math.floor(phase / (Math.PI * 2) + 0.5));
  return Math.sin(phase);
}

function addTone(start, length, frequency, volume, kind, pan = 0) {
  const first = Math.max(0, Math.floor(start * sampleRate));
  const final = Math.min(frameCount, Math.ceil((start + length) * sampleRate));
  const leftGain = volume * (1 - pan) * 0.5;
  const rightGain = volume * (1 + pan) * 0.5;

  for (let sample = first; sample < final; sample += 1) {
    const time = sample / sampleRate - start;
    const fade = envelope(time, length, Math.min(0.012, length / 8), Math.min(0.08, length / 3));
    const wobble = kind === "lead" ? Math.sin(time * Math.PI * 10) * 0.006 : 0;
    const wave = oscillator((frequency * (1 + wobble)) * time * Math.PI * 2, kind === "lead" ? "saw" : kind);
    left[sample] += wave * fade * leftGain;
    right[sample] += wave * fade * rightGain;
  }
}

function addKick(start) {
  const length = 0.19;
  const first = Math.floor(start * sampleRate);
  const final = Math.min(frameCount, Math.ceil((start + length) * sampleRate));
  for (let sample = first; sample < final; sample += 1) {
    const time = sample / sampleRate - start;
    const frequency = 145 * Math.exp(-time * 19) + 45;
    const value = Math.sin(time * frequency * Math.PI * 2) * Math.exp(-time * 18) * 0.68;
    left[sample] += value;
    right[sample] += value;
  }
}

function addSnare(start) {
  const length = 0.13;
  const first = Math.floor(start * sampleRate);
  const final = Math.min(frameCount, Math.ceil((start + length) * sampleRate));
  for (let sample = first; sample < final; sample += 1) {
    const time = sample / sampleRate - start;
    const value = seededNoise() * Math.exp(-time * 25) * 0.27;
    left[sample] += value;
    right[sample] += value;
  }
}

function addHat(start) {
  const length = 0.045;
  const first = Math.floor(start * sampleRate);
  const final = Math.min(frameCount, Math.ceil((start + length) * sampleRate));
  for (let sample = first; sample < final; sample += 1) {
    const time = sample / sampleRate - start;
    const value = seededNoise() * Math.exp(-time * 72) * 0.09;
    left[sample] += value;
    right[sample] += value;
  }
}

for (let bar = 0; bar < bars; bar += 1) {
  const barStart = bar * beat * 4;
  const chord = chordProgression[bar % chordProgression.length];
  chord.forEach((frequency, index) => addTone(barStart, beat * 3.82, frequency, 0.12, "square", index === 0 ? -0.45 : index === 2 ? 0.45 : 0));
  addTone(barStart, beat * 3.6, chord[0] / 2, 0.19, "sine", -0.08);

  for (let step = 0; step < 8; step += 1) {
    const time = barStart + step * beat / 2;
    addHat(time);
    if (step === 0 || step === 4) addKick(time);
    if (step === 2 || step === 6) addSnare(time);
  }

  for (let step = 0; step < 4; step += 1) {
    const note = melody[(bar * 4 + step) % melody.length][1] * (bar % 4 === 3 && step === 3 ? 1.25 : 1);
    addTone(barStart + step * beat, beat * 0.76, note, 0.105, "lead", step % 2 ? 0.18 : -0.18);
  }
}

const bytes = Buffer.alloc(44 + frameCount * 4);
bytes.write("RIFF", 0);
bytes.writeUInt32LE(36 + frameCount * 4, 4);
bytes.write("WAVE", 8);
bytes.write("fmt ", 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(sampleRate, 24);
bytes.writeUInt32LE(sampleRate * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write("data", 36);
bytes.writeUInt32LE(frameCount * 4, 40);

for (let index = 0; index < frameCount; index += 1) {
  const leftSample = Math.tanh(left[index] * 0.88);
  const rightSample = Math.tanh(right[index] * 0.88);
  bytes.writeInt16LE(Math.round(leftSample * 32767), 44 + index * 4);
  bytes.writeInt16LE(Math.round(rightSample * 32767), 46 + index * 4);
}

const output = resolve(process.cwd(), "demo-track.wav");
writeFileSync(output, bytes);
console.log(`Created ${output}`);
