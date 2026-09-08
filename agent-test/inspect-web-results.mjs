/** Print compact, actionable failures from one completed Vitest JSON report. */
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify({
  passed: report.numPassedTests,
  failed: report.numFailedTests,
  pending: report.numPendingTests,
  suites: report.testResults.length,
}))
for (const suite of report.testResults) {
  if (suite.status !== 'failed') continue
  console.log(suite.name)
  if (suite.message) console.log(suite.message.slice(0, 4000))
  for (const test of suite.assertionResults) {
    if (test.status !== 'failed') continue
    console.log(test.fullName)
    for (const failure of test.failureMessages) console.log(failure.slice(0, 6000))
  }
}
