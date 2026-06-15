const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: ReadonlyArray<readonly [number, string]> = [
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];

function under1000(n: number): string {
  let s = '';
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} hundred`;
    n %= 100;
    if (n > 0) s += ' ';
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)]!;
    if (n % 10 > 0) s += `-${ONES[n % 10]}`;
  } else if (n > 0) {
    s += ONES[n]!;
  }
  return s;
}

/** Non-negative integers up to the millions — enough for currency amounts. */
export function numberToWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rem = n;
  for (const [value, name] of SCALES) {
    if (rem >= value) {
      parts.push(`${under1000(Math.floor(rem / value))} ${name}`);
      rem %= value;
    }
  }
  if (rem > 0) parts.push(under1000(rem));
  return parts.join(' ');
}
