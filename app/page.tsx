import { AegisConsole } from '@/components/console/AegisConsole'

/**
 * The console is a client component: it owns a canvas render loop and live
 * telemetry, neither of which benefits from server rendering. The server work
 * that matters happens in the API routes, which do the CelesTrak fetching and
 * caching.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main>
      <AegisConsole />
    </main>
  )
}
