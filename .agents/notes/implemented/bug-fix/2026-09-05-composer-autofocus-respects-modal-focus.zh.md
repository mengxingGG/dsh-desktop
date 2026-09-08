# Agent Note: Composer 自动聚焦保留模态窗口焦点

Status: implemented

[English](2026-09-05-composer-autofocus-respects-modal-focus.md) | 中文

## 问题

添加 Workspace 会异步启动一个空白 Session。用户可以在该 Session 完成打开之前，再次打开目录选择器并编辑路径。无条件的 composer 自动聚焦随后会把焦点移出选择器，而选择器的失焦处理会取消路径草稿。因此，较慢的 Session 创建会丢弃另一项无关的编辑操作。

## 决定

如果焦点位于不包含 composer 的模态窗口中，[composer](../../../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) 会放弃挂载、解锁和切换 Session 时的自动聚焦。键盘输入仍由模态窗口接收；非模态控件或包含 composer 的模态窗口不会抑制正常自动聚焦。普通 composer 聚焦仍保留 `preventScroll` 与 Lexical 选区恢复。

这条规则属于发起聚焦的代码，而非目录导航或 Session 创建。它不增加全局焦点限制、延迟重新聚焦或 Host 状态。[Lexical 编辑器归属](../architecture/2026-08-20-web-composer-lexical-editor.zh.md)、[单一 Workspace 创建路径](../simplification/2026-07-31-one-route-to-add-a-workspace.zh.md)与[首次运行引导的显式 inert 生命周期](../feature/2026-08-13-shared-modal-product-onboarding.zh.md)仍是独立决策。

## 考虑过的替代方案

**测试先等待首个 agent（智能体）就绪，再打开另一个选择器。** 否决，因为用户可以并发执行这两项操作；串行化 fixture（测试前置数据）会隐藏产品缺陷。

**完全取消 composer 自动聚焦。** 否决，因为普通 Session 选择仍需要把键盘输入交还 composer。只有现存的外部模态窗口焦点具有更高优先级。

**把共享 Modal 改为全局焦点限制器。** 暂缓，因为这会改变所有对话框的键盘行为。已经复现的不必要聚焦请求只有一个局部归属，可直接在该处取消。

## 后果

等待中的 Session 创建不会取消已经打开的目录草稿。用户主动将焦点移走时，选择器仍按现有规则在失焦时取消编辑。关闭模态窗口不会补发其持有焦点期间被抑制的自动聚焦请求。

[InputBar 测试](../../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx)覆盖解锁、切换 Session、非模态控件及 composer 位于自身模态窗口内的情况。[Workspace 浏览器场景](../../../../apps/web/tests/workspace-management.e2e.ts)把首次真实 Session 创建保持在等待状态，直到第二个选择器已输入草稿，再验证创建完成后焦点与继续输入的行为。受控重叠无需休眠或重试即可复现原始失败。
