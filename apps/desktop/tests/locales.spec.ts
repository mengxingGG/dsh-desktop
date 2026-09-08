/** Owner-local expected copy for native controls that have no Session transcript. */

import { expect, it } from 'vitest'
import { desktopText } from '../src/locales.ts'

it('keeps native exit choices and unsaved-state warnings complete in both languages', async () => {
  const en = desktopText('en-US')
  const zh = desktopText('zh-TW')
  expect(desktopText('zh-CN')).toBe(zh)
  expect(desktopText('fr-FR')).toBe(en)
  expect(Object.keys(zh)).toEqual(Object.keys(en))
  await expect(JSON.stringify({ en, zh }, undefined, 2) + '\n')
    .toMatchFileSnapshot('./expected/native-dialogs.json')
})
