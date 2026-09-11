/** State-driven stroke icons with bounded Morphicons transitions. */

import { MorphIcon } from 'morphicons/react'
import type { IconProps } from './icons/props.ts'

const PATHS = {
  'panel-open': 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M9 3v18 M13 9l3 3-3 3',
  'panel-closed': 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M9 3v18 M16 9l-3 3 3 3',
  copy: 'M9 9h11v11H9Z M15 5V3H3v12h2',
  check: 'M5 12l4 4L19 6',
  team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2 M17 4a4 4 0 0 1 0 7 M22 21v-2a5 5 0 0 0-3-4.6',
  working: 'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M5 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M19 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M12 8v4 M12 12l-7 4 M12 12l7 4',
} as const

/** State names accepted by the shared animated icon component. */
export type AnimatedIconName = keyof typeof PATHS

/**
 * Render a decorative icon whose transitions honor the user's reduced-motion preference.
 * @param props - Named state, pixel size, and optional layout class; the containing control owns its accessible name.
 * @returns A stable SVG that morphs when its named state changes.
 */
export function AnimatedIcon({ name, size = 16, className }: IconProps & { name: AnimatedIconName }) {
  return <MorphIcon icon={PATHS[name]} size={size} className={className} strokeWidth={1.75}
    spring="snappy" reducedMotion="user" aria-hidden="true" focusable="false" />
}
