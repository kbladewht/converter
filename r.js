let port = null;
let reader = null;
let writer = null;

let reconnectTimer = null;
let isConnecting = false;

const logElement = document.getElementById("log");
const connectBtn = document.getElementById("connect");
const connStatus = document.getElementById("connStatus");
const inputEl = document.getElementById("input");
const themeToggle = document.getElementById("themeToggle");

// ============ 工具：追加日志 ============
function appendLog(text) {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    logElement.value += `[${ts}] ${text}\n`;
    logElement.scrollTop = logElement.scrollHeight;
}

// ============ 主题切换 ============
themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    themeToggle.textContent = document.body.classList.contains("dark") ? "☀️" : "🌙";
});

// ============ 连接状态 UI ============
function setConnUI(connected) {
    connectBtn.textContent = connected ? "断开串口" : "连接串口";
    connStatus.textContent = connected ? "已连接" : "未连接";
    connStatus.className = "status " + (connected ? "status-on" : "status-off");
}

// ============ 命令发送 ============
async function sendCommand(cmd) {
    if (!writer) {
        alert("请先连接串口");
        return;
    }
    await writer.write(new TextEncoder().encode(cmd + "\n"));
    appendLog("→ " + cmd);
}

// ============ 数据读取 ============
let ansiBuffer = "";

async function readData() {
    try {
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            ansiBuffer += decoder.decode(value, { stream: true });

            // 未收到完整一行，继续接收
            if (!ansiBuffer.includes("\n")) continue;

            // 先尝试解析电池数据（原始数据）
            handleBatteryData(ansiBuffer);

            // 清理 ANSI 转义序列
            let clean = ansiBuffer
                .replace(/\x1B(?:[@-_]|\[[0-?]*[ -/]*[@-~])/g, "")
                .replace(/1DJ/g, "")
                .replace(/[\r]/g, "");

            // 超过 2000 字符自动清屏
            if (logElement.value.length > 2000) {
                logElement.value = "";
            }

            logElement.value += clean;
            ansiBuffer = "";
            logElement.scrollTop = logElement.scrollHeight;
        }
    } catch (e) {
        console.log("UART disconnected", e);
        uartDisconnected();
    }
}

// ============ 打开 UART ============
async function openUART(forceSelect = false) {
    if (isConnecting) return;
    isConnecting = true;

    try {
        if (forceSelect) {
            port = await navigator.serial.requestPort();
        } else {
            const ports = await navigator.serial.getPorts();
            port = ports.length > 0 ? ports[0] : await navigator.serial.requestPort();
        }

        await port.open({ baudRate: 115200 });
        writer = port.writable.getWriter();
        reader = port.readable.getReader();

        setConnUI(true);
        isConnecting = false;
        appendLog("串口已连接 (115200)");
        readData();
    } catch (e) {
        console.log("open uart fail", e);
        port = reader = writer = null;
        isConnecting = false;
        setConnUI(false);
    }
}

// ============ 重连逻辑 ============
function startReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(async () => {
        if (port) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
            return;
        }
        console.log("try reconnect");
        await openUART();
    }, 1000);
}

// ============ 关闭 UART ============
async function closeUART() {
    try {
        if (reader) { await reader.cancel(); reader.releaseLock(); }
        if (writer) { writer.releaseLock(); }
        if (port) { await port.close(); }
    } catch (e) { console.log(e); }

    reader = writer = port = null;
    setConnUI(false);
    appendLog("串口已断开");
}

// ============ UART 断开处理 ============
async function uartDisconnected() {
    try {
        if (reader) { await reader.cancel(); reader.releaseLock(); }
        if (writer) { writer.releaseLock(); }
    } catch (e) {}

    reader = writer = port = null;
    setConnUI(false);
    startReconnect();
}

// ============ 自动重连 ============
async function autoReconnect() {
    if (port) return;
    try {
        const ports = await navigator.serial.getPorts();
        if (ports.length > 0) {
            port = ports[0];
            await port.open({ baudRate: 115200 });
            writer = port.writable.getWriter();
            reader = port.readable.getReader();
            setConnUI(true);
            appendLog("串口已重连");
            readData();
            return;
        }
    } catch (e) { console.log("Reconnect failed"); }
    reconnectTimer = setTimeout(autoReconnect, 1000);
}

// ============ 清空 / 导出日志 ============
document.getElementById("clearLog").addEventListener("click", () => {
    logElement.value = "";
});

document.getElementById("exportLog").addEventListener("click", () => {
    const blob = new Blob([logElement.value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "uart-log-" + new Date().toISOString().slice(0, 19).replace(/[:-]/g, "") + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
});

// ============ 发送（回车 + 按钮） ============
inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && inputEl.value.trim()) {
        sendCommand(inputEl.value.trim());
        inputEl.value = "";
    }
});

document.getElementById("send").addEventListener("click", () => {
    if (inputEl.value.trim()) {
        sendCommand(inputEl.value.trim());
        inputEl.value = "";
    }
});

// ============ Radio 切换地址 ============
document.querySelectorAll('input[name="channel"]').forEach((r) => {
    r.addEventListener("change", () => {
        if (r.checked) sendCommand("channel " + r.value);
    });
});

// ============ 连接按钮 ============
connectBtn.onclick = async function () {
    if (port) await closeUART();
    else await openUART(true);
};

// ============ 预设命令按钮（含 battery Demo） ============
document.querySelectorAll(".cmd").forEach((btn) => {
    btn.addEventListener("click", async () => {
        const cmd = btn.dataset.cmd;

        // Demo：点击"显示电量"模拟收到 battery:85%
        if (cmd === "battery show") {
            appendLog("[DEMO] ← battery:85%");
            updateBatteryUI(85);
            return;
        }

        await sendCommand(cmd);
    });
});

// ============ 设备断开事件 ============
navigator.serial.addEventListener("disconnect", (event) => {
    if (event.target === port) {
        console.log("Device disconnected");
        uartDisconnected();
    }
});

// ============ 电池 UI 更新 ============
function updateBatteryUI(percent) {
    const batteryLevel = document.getElementById("batteryLevel");
    const batteryValue = document.getElementById("batteryValue");
    const batteryStatus = document.getElementById("batteryStatus");

    percent = Math.max(0, Math.min(100, percent));
    batteryLevel.style.width = percent + "%";
    batteryValue.textContent = percent + "%";

    batteryLevel.className = "battery-level";
    if (percent >= 60) {
        batteryLevel.classList.add("high");
        batteryStatus.textContent = "电量充足 ✅";
    } else if (percent >= 20) {
        batteryLevel.classList.add("medium");
        batteryStatus.textContent = "电量中等 ⚠️";
    } else {
        batteryLevel.classList.add("low");
        batteryStatus.textContent = "电量不足 ❌ 请充电";
    }
}

// 解析串口返回的电池数据，如 "battery:85%" 或 "BATTERY = 85"
function handleBatteryData(rawData) {
    const match = rawData.match(/battery-mark:(\d+)battery-mark/);
    if (match) {
        const percent = parseInt(match[1], 10);
        updateBatteryUI(percent);
        appendLog(`[BATTERY] Current Power: ${percent}%`);
    }
}

// ============ 启动 ============
window.onbeforeunload = () => { closeUART(); };
autoReconnect();