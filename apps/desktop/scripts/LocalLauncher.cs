// Windows 本地开发入口：沿用桌面开发脚本，使用当前仓库的构建和数据目录。
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class LocalLauncher
{
    [STAThread]
    private static void Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string logPath = Path.Combine(root, ".run", "desktop-launcher.log");
        try
        {
            string identity;
            using (SHA256 hash = SHA256.Create())
                identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-", "");
            bool owns;
            using (Mutex mutex = new Mutex(true, "Local\\DeepSeekHarness-" + identity, out owns))
            {
                if (!owns) return;
                try { Run(root, logPath); }
                finally { mutex.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            MessageBox.Show("无法启动 DeepSeek Harness。\n\n" + error.Message + "\n\n日志：" + logPath,
                "DeepSeek Harness", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string NodeExecutable()
    {
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            string path = Path.Combine(directory.Trim().Trim('"'), "node.exe");
            if (Path.IsPathRooted(path) && File.Exists(path)) return path;
        }
        string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (File.Exists(installed)) return installed;
        throw new FileNotFoundException("未找到 Node.js，请安装项目支持的 Node.js 并加入 PATH。");
    }

    // 直接传入 CreateProcess 参数，不经 cmd.exe 解释仓库路径。
    private static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
            else { result.Append('\\', slashes); result.Append(character); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    private static void Run(string root, string logPath)
    {
        string manager = Path.Combine(root, "apps", "desktop", "node_modules", "pnpm", "bin", "pnpm.cjs");
        if (!File.Exists(manager) || !File.Exists(Path.Combine(root, "apps", "desktop", "lib", "main.js")))
            throw new FileNotFoundException("当前目录缺少依赖或桌面构建。请在项目目录安装依赖并执行 pnpm run build 和 pnpm run build:desktop。");
        Directory.CreateDirectory(Path.GetDirectoryName(logPath));
        ProcessStartInfo start = new ProcessStartInfo(NodeExecutable(), Quote(manager) + " run start:desktop");
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        start.EnvironmentVariables["DSH_DESKTOP_OPEN_DEVTOOLS"] = "0";
        start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        using (StreamWriter log = new StreamWriter(logPath, false, new UTF8Encoding(false)))
        using (Process process = new Process())
        {
            log.AutoFlush = true;
            log.WriteLine(DateTimeOffset.Now.ToString("O") + " " + root);
            object logLock = new object();
            DataReceivedEventHandler append = (sender, data) => { if (data.Data != null) lock (logLock) log.WriteLine(data.Data); };
            process.StartInfo = start;
            process.OutputDataReceived += append;
            process.ErrorDataReceived += append;
            if (!process.Start()) throw new InvalidOperationException("启动进程失败。");
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new InvalidOperationException("桌面启动进程退出，代码 " + process.ExitCode + "。请查看日志中的具体错误。");
        }
    }
}
