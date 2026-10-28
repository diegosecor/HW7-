export const MAX_SONG_SECONDS = 20 * 60;

export function validateDuration(duration) {
  if (!Number.isFinite(duration) || duration < 3 || duration > MAX_SONG_SECONDS) {
    throw new Error("Please choose a song between 3 seconds and 20 minutes long.");
  }
  return duration;
}

export function createDemoBeats(duration) {
  validateDuration(duration);
  const interval = 60 / 124;
  // Match the generated track's beat grid, excluding its silent tail.
  const count = Math.min(64, Math.floor((duration - 0.15) / interval));
  return Array.from({ length: count }, (_, index) => index * interval).filter(time => time >= 2.5);
}

export function findBeats(buffer, duration) {
  validateDuration(duration);
  const frameSize = Math.max(512, Math.floor(buffer.sampleRate * 0.05));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const energies = [];
  for (let start = 0; start + frameSize < buffer.length; start += frameSize) {
    let energy = 0;
    for (const samples of channels) {
      for (let i = start; i < start + frameSize; i += 4) energy += samples[i] ** 2;
    }
    energies.push(Math.sqrt(energy / (Math.ceil(frameSize / 4) * channels.length)));
  }
  const average = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length);
  const deviation = Math.sqrt(energies.reduce((sum, x) => sum + (x - average) ** 2, 0) / Math.max(1, energies.length));
  const beats = [];
  let lastBeat = -1;
  for (let i = 1; i < energies.length - 1; i++) {
    const time = i * frameSize / buffer.sampleRate;
    if (energies[i] > average + deviation * 0.26 && energies[i] >= energies[i - 1] && energies[i] > energies[i + 1] && time - lastBeat >= 0.32 && time > 2.5 && time < duration - 0.15) {
      beats.push(time); lastBeat = time;
    }
  }
  if (beats.length >= Math.min(8, duration / 12)) return beats;
  return Array.from({ length: Math.max(0, Math.floor((duration - 2.65) / 0.62) + 1) }, (_, i) => 2.5 + i * 0.62);
}
