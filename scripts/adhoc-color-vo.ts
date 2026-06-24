// Ad-hoc driver: run the SHIPPED Showrunner VO engine (master single-call +
// <break> joins + slice + de-breath + normalize + gate) on the color-theory
// script, so the narration has natural continuous cadence — not 12 flat calls.
import { runAdHocSynthesis } from '../src/studio/synthesize.js';

const LINES = [
  'There is no red in the world.',
  "There's light at a wavelength, and three cones in your eye. Red is what your brain makes of the mix.",
  "So colour isn't out there — your eye builds it. Which means your screen never sends you colour. It sends three numbers.",
  'Screens make every colour by adding light. Red and green add up to yellow; all three read as white.',
  'Red, green and blue is how the hardware works. People think in hue — which colour it is — plus how vivid and how light.',
  'Hue is an angle on a wheel, which is why colour schemes are really just geometry.',
  'Now the catch from the opening. A screen can only show a triangle of colours.',
  'The old standard, sRGB, is small. Your display reaches a wider one called Display P3.',
  'That vivid red from the start lives out here — where your old screen could not go.',
  "One more thing — white isn't fixed. Your screen warms or cools it to match the room.",
  "That's easier on your eyes, but it skews colour, so turn it off when colour has to be right.",
  'Treat this screen as a reference — it shows more than the screen your work lands on. Before you trust a colour, ask where it is going.',
];

const script = LINES.join('\n\n');

const res = await runAdHocSynthesis(
  {
    script,
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Sarah
    model: 'eleven_multilingual_v2',
    normalize: true,
    gatePolicy: 'warn',
    naturalness: false,
    g2p: false,
  },
  {
    runsRoot:
      'C:/Users/amoah/OneDrive/Documents/Journal/_Learning/color-and-the-m3-display/hf-color/vo-build',
  },
);

console.log('AUDIO_PATH=' + res.audioPath);
console.log('WORKDIR=' + res.workdir);
console.log('SUMMARY=' + JSON.stringify(res.summary));
