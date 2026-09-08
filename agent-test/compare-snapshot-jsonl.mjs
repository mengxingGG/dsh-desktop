/** Read-only field-level comparison of two generated Session snapshot files. */
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line))
const before = read(process.argv[2])
const after = read(process.argv[3])
const differences = new Map()
function compare(left, right, path) {
  if (Object.is(left, right)) return
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) compare(left[key], right[key], `${path}.${key}`)
    return
  }
  const compact = value => JSON.stringify(value)?.slice(0, 240)
  const key = path.replace(/\.\d+/gu, '[]')
  const found = differences.get(key) ?? { count: 0, examples: [] }
  found.count += 1
  if (found.examples.length < 2) found.examples.push({ before: compact(left), after: compact(right) })
  differences.set(key, found)
}
compare(before, after, 'events')
console.log(JSON.stringify({ beforeEvents: before.length, afterEvents: after.length, differences: Object.fromEntries(differences) }, null, 2))
