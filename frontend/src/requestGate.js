export function createRequestGate() {
  let current = null
  return {
    start() {
      current?.abort()
      current = new AbortController()
      return current
    },
    isCurrent(request) {
      return request === current && !request.signal.aborted
    },
    finish(request) {
      if (request !== current) return false
      current = null
      return true
    },
    cancel() {
      current?.abort()
      current = null
    },
  }
}
