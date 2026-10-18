/** Stop waiting immediately when an export is cancelled, even for browser APIs without abort support. */
export function awaitExportTask<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    // Always observe task rejection, including when cancellation wins the race.
    task.then(value => {
      signal.removeEventListener('abort', abort)
      if (!signal.aborted) resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      if (!signal.aborted) reject(error)
    })
  })
}
