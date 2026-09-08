/** Host-side fixture HTTP transport; remote authorities never depend on host DNS. */
import { Agent } from 'undici'

/**
 * Create a fixture-owned HTTP client whose DNS lookup always selects loopback.
 * @returns Fetch and close operations; the owner must close the dispatcher after every response settles.
 */
export function createScaffoldHttpClient(): {
  fetch(url: string | URL, init: RequestInit): Promise<Response>
  close(): Promise<void>
} {
  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }])
        else callback(null, '127.0.0.1', 4)
      },
    },
  })
  return {
    fetch(url, init) {
      const options = { ...init, dispatcher }
      return fetch(url, options)
    },
    close: () => dispatcher.close(),
  }
}
