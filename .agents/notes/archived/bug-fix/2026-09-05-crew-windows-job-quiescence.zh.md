# Agent Note: Crew Windows 清理等待 Job 与进程退出

Status: implemented
Archived: 2026-09-06

[English](2026-09-05-crew-windows-job-quiescence.md) | 中文

## 问题

命令的直属进程退出后，脱离父进程生命周期的后代仍可能运行，且不持有任何输出管道。关闭最后一个关闭即终止 Job 句柄会请求终止，同时也移除了启动器观察整个 Job 的途径。因此，输出 EOF 和直属进程退出各自都不能证明，在移除私有执行文件之前，整个进程树已经完全停稳。

## 决策

[Crew Windows 启动器](../../../../packages/experimental/crew/src/execution-windows.ts)在有序清理期间保留私有 Job 句柄。父进程退出、取消和异常清理共享同一个终止操作。该操作把 Job 的活动进程上限设为零以拒绝新进程准入，为列表中的成员取得原生句柄，包括嵌套 Job 中的进程，然后调用 `TerminateJobObject`。它等待活动进程数为零、每个已取得的进程句柄均成为有信号状态，然后才关闭原生资源。同一个配置的宽限期约束成员枚举、终止观察和输出排空。

Microsoft 文档说明[准入上限](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)、[嵌套成员列表](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list)、[Job 统计信息](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information)与[终止 API](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject)。活动计数为零不能替代进程句柄等待：原生测试观察到，计数归零后，直属进程与独立后代的句柄都可能尚未进入有信号状态。取得的 PID 句柄只用于等待，永不单独终止进程；获取句柄前 PID 已消失即可证明它已退出，其他获取失败则拒绝清理。

API 失败或宽限期到期会拒绝命令。若显式终止或观察失败，最终关闭句柄仍保留关闭即终止的进程约束，但不会把该兜底操作报告为已经验证完全停稳。文件授权、网络拒绝、创建时关联及已安装 Node 运行时保持不变。

[创建时 Job 决策](2026-09-05-crew-windows-creation-time-job.zh.md)在宿主来不及有序清理就消失时仍独立必要。[共享 Win32 基础操作](../architecture/2026-08-19-shared-win32-process-primitives.zh.md)、[Windows ACL 沙箱](../feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md)和[原生 Crew 工作流](../feature/2026-09-04-dsh-native-crew-orchestration.zh.md)分别保留其 API、策略与持久状态决策。

## 已考虑的替代方案

**关闭 Job 后只等待管道 EOF。** 脱离父进程生命周期的后代可能不持有任何输出管道，因此 EOF 不能观察其生命周期。

**只等待直属进程或 Job 统计信息。** 直属进程退出并不意味着后代已经停止。Job 统计信息也可能在各进程退出信号之前结算，因此这两种简化都会漏掉独立后代的拆除。

**把 Job 句柄作为通用完成事件来等待。** Microsoft 的 [Job 文档](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)把其有信号状态定义为指定的整个 Job 时间限制到期，而不是任意命令终止。

## 验证

[原生测试集](../../../../packages/experimental/crew/tests/execution-windows.spec.ts)使用原子发布的就绪文件和由宿主控制的释放屏障。测试打开仍存活的独立后代的原生进程句柄，验证它属于精确的私有 Job，并在父进程退出或取消后，检查命令返回前该后代已经退出。它还验证启动器确实等待该成员，并且零准入设置之后的真实创建尝试会被拒绝。释放 Job 句柄时观察到活动进程数为零。修正前的观察同时暴露了释放 Job 句柄时仍存活的后代，以及命令返回后仍未进入有信号状态的后代。

注入的原生失败覆盖恢复执行、管道读取、直属进程等待、关闭准入、成员枚举、Job 终止、Job 查询、统计信息仍活动、进程尚未退出以及输出排空到期。在相关原生 API 仍可用的路径中，真实终止操作和句柄观察验证异常清理。每次调用各自拥有快照、profile、句柄与拆除；独立测试进程使用不同资源。

本次修改不改变 Session 载荷或 Web 展示。[执行测试集](../../../../packages/experimental/crew/tests/execution.spec.ts)继续独立负责受限命令行为及带管道后代的验证。这些清理测试没有解决 Node 24.14 的子进程管道限制。

## 后果

有序清理关闭进程准入，并在释放资源前观察每个已取得句柄的成员退出。它额外拥有等待句柄；Windows 尚未完成终止时，还需要等待配置的轮询间隔。无法观察或过晚的退出会失败，而不是产生成功验证证据。宿主突然退出仍依赖不可继承的关闭即终止句柄，不声称已终止的宿主能够观察完成。
