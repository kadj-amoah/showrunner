import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { InteractiveAnswers } from './prompts.js';

/**
 * Buffered line reader on top of readline.Interface. Two reasons to queue
 * rather than use `rl.question()` / `rl.once('line')` directly:
 *
 *   1. `readline/promises` `rl.question()` has a documented edge case where
 *      the second-or-third call silently exits when stdin is piped (non-TTY).
 *   2. With piped stdin, all lines arrive in a burst; if we only register a
 *      one-shot 'line' listener per ask(), every line after the first fires
 *      with no listener and is lost. Queueing preserves them for later asks.
 */
class LineReader {
  private queue: string[] = [];
  private waiter: ((line: string) => void) | null = null;
  private rejecter: ((err: Error) => void) | null = null;
  private closed = false;

  constructor(rl: ReadlineInterface) {
    rl.on('line', (line: string) => {
      if (this.waiter) {
        const cb = this.waiter;
        this.waiter = null;
        this.rejecter = null;
        cb(line);
      } else {
        this.queue.push(line);
      }
    });
    rl.on('close', () => {
      this.closed = true;
      if (this.rejecter) {
        const rej = this.rejecter;
        this.waiter = null;
        this.rejecter = null;
        rej(new Error('stdin closed before answer was provided'));
      }
    });
  }

  read(): Promise<string> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.closed) {
      return Promise.reject(new Error('stdin closed before answer was provided'));
    }
    return new Promise<string>((resolve, reject) => {
      this.waiter = resolve;
      this.rejecter = reject;
    });
  }
}

async function ask(reader: LineReader, prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return reader.read();
}

export async function runInteractiveQA(): Promise<InteractiveAnswers> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const reader = new LineReader(rl);

  try {
    process.stdout.write(
      '\nLet\'s build a product_model interactively. Answer each prompt with a short line.\n\n',
    );
    const productName = (await ask(reader, '1. Product name: ')).trim();
    if (!productName) throw new Error('product name is required');

    const tagline = (await ask(reader, '2. One-sentence tagline: ')).trim();
    const primaryUser = (await ask(reader, '3. Who is the primary user? ')).trim();

    const featuresLine = (
      await ask(reader, '4. Top 3-6 features, comma-separated:\n   ')
    ).trim();
    const topFeatures = featuresLine
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const flowCountStr = (
      await ask(reader, '5. How many flows would you like to demo (2-4)? ')
    ).trim();
    const flowCount = clamp(parseInt(flowCountStr, 10) || 2, 2, 4);
    const topFlows: { name: string; steps: string[] }[] = [];
    for (let i = 0; i < flowCount; i++) {
      const name = (await ask(reader, `   Flow ${i + 1} name: `)).trim();
      const stepsLine = (
        await ask(reader, `   Flow ${i + 1} steps, '|' separated:\n   `)
      ).trim();
      const steps = stepsLine
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      topFlows.push({ name, steps });
    }

    const durationStr = (
      await ask(reader, '6. Target demo duration in seconds (60-120, default 75): ')
    ).trim();
    const suggestedDurationSeconds = clamp(parseInt(durationStr, 10) || 75, 30, 180);

    return {
      productName,
      primaryUser,
      tagline,
      topFeatures,
      topFlows,
      suggestedDurationSeconds,
    };
  } finally {
    rl.close();
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
