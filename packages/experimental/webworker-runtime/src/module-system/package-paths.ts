/** Node-style package search directories, bounded by the image root. */
import { dirname, join, resolve } from './posix-path.ts'

/**
 * Walk importer ancestors without searching beyond the image.
 * @param fromDirectory - Importing module's absolute VFS directory.
 * @param root - Absolute image root.
 * @returns Nearest-first node_modules directories, with the image-level directory last.
 */
export function packageSearchPaths(fromDirectory: string, root: string): string[] {
  const imageRoot = resolve(root, '.')
  const paths: string[] = []
  let directory = resolve(fromDirectory, '.')
  while (directory === imageRoot || directory.startsWith(imageRoot === '/' ? '/' : `${imageRoot}/`)) {
    if (!directory.endsWith('/node_modules')) paths.push(join(directory, 'node_modules'))
    if (directory === imageRoot) break
    directory = dirname(directory)
  }
  const shared = join(imageRoot, 'node_modules')
  if (!paths.includes(shared)) paths.push(shared)
  return paths
}
