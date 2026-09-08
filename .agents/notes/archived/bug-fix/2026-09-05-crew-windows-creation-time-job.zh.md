# Agent Note: Crew Windows 进程在创建时加入 Job

Status: implemented
Archived: 2026-09-06

[English](2026-09-05-crew-windows-creation-time-job.md) | 中文

## 问题

以挂起状态创建进程，可以阻止目标代码在 Job 关联前运行，但若宿主在创建与关联之间被终止，就无法清理尚未关联的进程。Crew 必须在不依赖后续宿主调用的情况下确立进程树所有者。

## 决策

[Crew Windows 启动器](../../../../packages/experimental/crew/src/execution-windows.ts)通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 传递其私有的关闭即终止 Job，与 LPAC 安全设置和继承的标准输入输出一起交给同一次 `CreateProcessW` 调用。Job 句柄不被继承。属性设置失败会拒绝启动，不存在创建后再关联的回退。目标保持挂起，直到启动器取得返回句柄的所有权。

Microsoft 文档说明，[创建时 Job 列表](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)支持 Windows 10 及更新版本。这项修改不扩大文件授权、不添加网络能力，也不替换已安装的 Node 运行时。

[共享 Win32 基础操作决策](../architecture/2026-08-19-shared-win32-process-primitives.zh.md)继续适用于受限令牌消费方及其不同的启动 API。[Windows ACL 沙箱决策](../feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md)继续拥有仅限制写入的策略；Crew 的私有 LPAC 输入不替代该沙箱。

## 已考虑的替代方案

**在创建后关联挂起进程。** 这种方式能阻止目标在关联前执行，但宿主退出时仍可能留下尚无 Job 所有者的进程。

**不带 Job 列表属性重试。** 回退会在请求的创建策略失败时，恰好重新引入该间隙。

## 验证

[原生回归](../../../../packages/experimental/crew/tests/execution-windows.spec.ts)保留真实进程创建调用，并在控制权返回启动器之前，用 `IsProcessInJob` 查询精确的私有 Job。成功命令在该时点已有成员关系；注入属性拒绝时不创建进程。两种结果之后都会清理私有快照。针对创建后关联的实现，正向成员断言会失败。

这项 Windows 专有创建属性不改变 Session 载荷或 Web 展示。原生 API 观察提供其回归证据。[执行测试集](../../../../packages/experimental/crew/tests/execution.spec.ts)另行检查有界输出和截止时间；其带管道子进程用例在 Node 24.14 上仍失败，本回归不替代该用例。

## 后果

每个成功创建的 Crew 进程都在宿主侧继续执行前获得其 Job 所有者。所属宿主退出时，Windows 关闭不可继承的 Job 句柄，包括目标尚未恢复执行的情形。Job 列表拒绝会使启动失败，而不是削弱进程所有权。有序关闭遵循独立的 [Job 完全停稳决策](2026-09-05-crew-windows-job-quiescence.zh.md)。这两项决策都不解决 Node 子进程管道限制；[包限制](../../../../packages/experimental/crew/README.zh.md#known-limitations-and-deferred-work)继续有效。
