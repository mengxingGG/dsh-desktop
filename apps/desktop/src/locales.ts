/** Native-shell copy; Web plugins retain their own locale settings. */

const en = {
  open: 'Open DeepSeek Harness',
  exit: 'Exit completely',
  cancel: 'Cancel',
  hide: 'Keep running in tray',
  closeTitle: 'Close DeepSeek Harness',
  closeMessage: 'Keep running in the system tray, or exit completely?',
  closeDetail: 'Keeping the app in the tray leaves tasks running. Exiting stops the backend.',
  activeTitle: 'Tasks are still running',
  activeMessage: 'Stop the running tasks, save their state, and exit?',
  activeDetail: 'No keeps the app and tasks running. Yes stops active work and saves Session and task records before exiting.',
  no: 'No, keep running',
  yes: 'Yes, stop and exit',
  failureTitle: 'The app has not exited',
  failureMessage: 'Task shutdown or state saving could not be confirmed.',
  failureDetail: 'You can cancel and inspect the app. Force exit stops the backend but cannot guarantee the newest state was saved.',
  force: 'Force exit',
  checking: 'DeepSeek Harness — checking tasks and saving state…',
}

/** All native dialogs and tray actions share one complete dictionary. */
export type DesktopText = typeof en

const zh: DesktopText = {
  open: '打开 DeepSeek Harness',
  exit: '彻底退出',
  cancel: '取消',
  hide: '收起到托盘',
  closeTitle: '关闭 DeepSeek Harness',
  closeMessage: '收起到系统托盘，还是彻底退出？',
  closeDetail: '收起后任务会继续在后台运行；彻底退出会停止后台。',
  activeTitle: '仍有任务正在运行',
  activeMessage: '是否确认停止任务、保存状态并退出？',
  activeDetail: '选择“否”保持应用和任务运行；选择“是”停止正在执行的工作，保存会话和任务记录后退出。',
  no: '否，继续运行',
  yes: '是，停止并退出',
  failureTitle: '应用尚未退出',
  failureMessage: '无法确认任务已停止或状态已保存。',
  failureDetail: '可以取消并查看应用。强制退出会停止后台，但无法保证最新状态已保存。',
  force: '强制退出',
  checking: 'DeepSeek Harness — 正在检查任务并保存状态…',
}

/**
 * Select native-shell text from Electron's application locale.
 * @param locale - operating-system application locale.
 * @returns the Chinese dictionary for zh locales, otherwise English.
 */
export function desktopText(locale: string): DesktopText {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}
