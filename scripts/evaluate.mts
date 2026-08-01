/**
 * CLI wrapper for the detector evaluation harness.
 *
 * `npm run evaluate` regenerates lib/detection/evaluation-results.json, which
 * the UI imports to display detector accuracy. Keeping the I/O here means
 * lib/detection/evaluate.ts stays a pure module the client bundle can import
 * without pulling in node:fs.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatEvaluation, runEvaluation } from '../lib/detection/evaluate'

const result = runEvaluation()
process.stdout.write(`${formatEvaluation(result)}\n`)

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'lib',
  'detection',
  'evaluation-results.json',
)

writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`\nwrote ${outputPath}\n`)
