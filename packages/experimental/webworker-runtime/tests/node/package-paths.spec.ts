/** Package search stays inside the image and gives importer-local installations precedence. */
import { expect, it } from 'vitest'
import { packageSearchPaths } from '../../src/module-system/package-paths.ts'

it('walks scoped package ancestors without redundant node_modules/node_modules entries', () => {
  expect(packageSearchPaths('/dsh/node_modules/@scope/plugin/lib', '/dsh')).toEqual([
    '/dsh/node_modules/@scope/plugin/lib/node_modules',
    '/dsh/node_modules/@scope/plugin/node_modules',
    '/dsh/node_modules/@scope/node_modules',
    '/dsh/node_modules',
  ])
})

it('keeps callers outside the image on the shared image package directory', () => {
  expect(packageSearchPaths('/other/module', '/dsh')).toEqual(['/dsh/node_modules'])
  expect(packageSearchPaths('/dsh-extra', '/dsh')).toEqual(['/dsh/node_modules'])
  expect(packageSearchPaths('/dsh', '/dsh')).toEqual(['/dsh/node_modules'])
})

it('terminates at the filesystem root when it is the image root', () => {
  expect(packageSearchPaths('/app', '/')).toEqual(['/app/node_modules', '/node_modules'])
})
