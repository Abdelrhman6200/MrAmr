// Work that should finish after the response is sent (e.g. sending email).
// On Vercel a function may be frozen once it has responded unless the work is
// registered with waitUntil; elsewhere the promise simply keeps running.
import { waitUntil } from '@vercel/functions';

export function background(label, task) {
  const promise = Promise.resolve()
    .then(task)
    .catch((err) => console.error(`${label} failed:`, err.message));
  try {
    waitUntil(promise);
  } catch {
    // Not running on Vercel.
  }
  return promise;
}
