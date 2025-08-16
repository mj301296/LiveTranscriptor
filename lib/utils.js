// Format milliseconds as HH:MM:SS
export const fmtTime = (ms) => new Date(ms).toISOString().substr(11, 8);

// Exponential backoff with jitter
export function expBackoff(attempt, base = 500) {
  const jitter = Math.random() * 150;
  return Math.min(10000, base * 2 ** attempt + jitter);
}

// Trigger download of text as a file
export function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Copy text to clipboard
export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text);
}
