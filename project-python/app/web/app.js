/* 企业级 AI Agent 控制台前端逻辑（原生 JS，无构建依赖） */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const DEFAULT_BASE = location.origin + "/api/v1";

  const els = {
    apiBase: $("#apiBase"),
    statusDot: $("#statusDot"),
    healthSummary: $("#healthSummary"),
    toast: $("#toast"),
  };

  /* ---------- 通用工具 ---------- */

  function apiBase() {
    const v = (els.apiBase.value || "").trim().replace(/\/+$/, "");
    return v || DEFAULT_BASE;
  }

  function url(path) {
    return apiBase() + path;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      els.toast.hidden = true;
    }, 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  /** 统一请求：返回 { ok, status, data, text, ms } */
  async function request(path, options) {
    const started = performance.now();
    const res = await fetch(url(path), options);
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, text, ms };
  }

  function errorText(r) {
    if (r.data && r.data.detail) return String(r.data.detail);
    return `HTTP ${r.status} ${r.text || ""}`.trim();
  }

  function setBadge(el, text, kind) {
    el.textContent = text;
    el.className = "badge" + (kind ? " " + kind : "");
  }

  function setDot(kind) {
    els.statusDot.className = "dot dot-" + kind;
  }

  /* ---------- Tab 切换 ---------- */

  $$("#tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$("#tabs .tab").forEach((t) => t.classList.remove("active"));
      $$(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });

  /* ---------- 1/2. 健康检查 ---------- */

  async function checkHealth(kind) {
    const path = kind === "ready" ? "/health/ready" : "/health";
    setBadge($("#healthStatus"), "请求中…", "");
    try {
      const r = await request(path, { method: "GET" });
      $("#healthRaw").textContent = JSON.stringify(r.data ?? r.text, null, 2);
      $("#statLatency").textContent = r.ms + " ms";

      if (!r.ok) {
        setBadge($("#healthStatus"), "HTTP " + r.status, "err");
        els.healthSummary.textContent = "健康检查失败：" + errorText(r);
        setDot("err");
        return;
      }

      const d = r.data || {};
      setBadge($("#healthStatus"), "HTTP " + r.status + " " + (d.status || "ok"), d.status === "ok" ? "ok" : "warn");

      if (path === "/health") {
        $("#statApp").textContent = d.status || "-";
        els.healthSummary.textContent = `服务存活（${r.ms} ms）`;
        setDot("ok");
      } else {
        $("#statApp").textContent = d.status || "-";
        $("#statDb").textContent = d.database === "up" ? "已连接" : "未连接";
        $("#statEnv").textContent = d.app_env || "-";
        const dbUp = d.database === "up";
        els.healthSummary.textContent = dbUp ? "服务就绪，数据库已连接" : "服务已启动，数据库未连接";
        setDot(dbUp ? "ok" : "warn");
      }
    } catch (err) {
      $("#healthRaw").textContent = String(err);
      setBadge($("#healthStatus"), "请求失败", "err");
      els.healthSummary.textContent = "无法连接服务，请检查后端是否已启动";
      setDot("err");
    }
  }

  $("#btnHealth").addEventListener("click", () => checkHealth("health"));
  $("#btnReady").addEventListener("click", () => checkHealth("ready"));

  /* ---------- 对话通用渲染 ---------- */

  function bubble(container, role, content, meta) {
    const empty = container.querySelector(".empty");
    if (empty) empty.remove();
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const b = document.createElement("div");
    b.className = "bubble" + (role === "assistant" && meta && meta.streaming ? " cursor" : "");
    b.textContent = content;
    if (meta && meta.text) {
      const m = document.createElement("span");
      m.className = "msg-meta";
      m.textContent = meta.text;
      b.appendChild(m);
    }
    wrap.appendChild(b);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return { wrap, bubble: b };
  }

  function buildPayload(inputEl, modelEl, tempEl, maxTokensEl, history) {
    const text = inputEl.value.trim();
    if (!text) return null;
    const messages = history.concat([{ role: "user", content: text }]);
    const payload = {
      messages,
      temperature: parseFloat(tempEl.value),
    };
    const model = modelEl.value.trim();
    if (model) payload.model = model;
    const mt = parseInt(maxTokensEl.value, 10);
    if (mt > 0) payload.max_tokens = mt;
    inputEl.value = "";
    return payload;
  }

  /* ---------- 3. 非流式对话 ---------- */

  const chatState = { history: [] };

  $("#chatTemp").addEventListener("input", (e) => {
    $("#chatTempVal").textContent = e.target.value;
  });

  function updateChatMeta() {
    $("#chatMeta").textContent = chatState.history.length + " 条上下文";
  }

  async function sendChat() {
    const payload = buildPayload($("#chatInput"), $("#chatModel"), $("#chatTemp"), $("#chatMaxTokens"), chatState.history);
    if (!payload) return toast("请输入消息内容");

    bubble($("#chatWindow"), "user", payload.messages[payload.messages.length - 1].content);
    const btn = $("#btnChatSend");
    btn.disabled = true;
    btn.textContent = "生成中…";

    try {
      const r = await request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        bubble($("#chatWindow"), "system", "请求失败：" + errorText(r));
        return;
      }

      const d = r.data;
      bubble($("#chatWindow"), "assistant", d.content || "", {
        text: `model=${d.model} · tokens=${d.usage ? d.usage.total_tokens : "-"} · ${r.ms} ms · trace=${d.trace_id || "-"}`,
      });
      chatState.history = payload.messages.concat([{ role: "assistant", content: d.content || "" }]);
      updateChatMeta();
    } catch (err) {
      bubble($("#chatWindow"), "system", "请求异常：" + err);
    } finally {
      btn.disabled = false;
      btn.textContent = "发送";
    }
  }

  $("#btnChatSend").addEventListener("click", sendChat);
  $("#chatInput").addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") sendChat();
  });
  $("#btnChatClear").addEventListener("click", () => {
    chatState.history = [];
    $("#chatWindow").innerHTML = '<div class="empty">发送消息开始对话</div>';
    updateChatMeta();
  });
  updateChatMeta();

  /* ---------- 4. 流式对话 ---------- */

  const streamState = { history: [] };

  $("#streamTemp").addEventListener("input", (e) => {
    $("#streamTempVal").textContent = e.target.value;
  });

  async function sendStream() {
    const payload = buildPayload($("#streamInput"), $("#streamModel"), $("#streamTemp"), $("#streamMaxTokens"), streamState.history);
    if (!payload) return toast("请输入消息内容");

    bubble($("#streamWindow"), "user", payload.messages[payload.messages.length - 1].content);
    const btn = $("#btnStreamSend");
    btn.disabled = true;
    btn.textContent = "流式生成中…";
    $("#streamMeta").textContent = "等待首个 token…";

    const started = performance.now();
    let firstTokenAt = 0;
    let acc = "";
    let node = null;

    try {
      const res = await fetch(url("/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text();
        let msg = t;
        try {
          msg = JSON.parse(t).detail || t;
        } catch (_) {}
        bubble($("#streamWindow"), "system", `请求失败：HTTP ${res.status} ${msg}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch (_) {
            continue;
          }
          if (evt.error) {
            bubble($("#streamWindow"), "system", "流式错误：" + evt.error);
            continue;
          }
          if (evt.done) continue;
          if (!evt.content) continue;

          if (!firstTokenAt) firstTokenAt = Math.round(performance.now() - started);
          acc += evt.content;
          if (!node) {
            node = bubble($("#streamWindow"), "assistant", acc, { streaming: true });
          } else {
            node.bubble.firstChild.nodeValue = acc;
            $("#streamWindow").scrollTop = $("#streamWindow").scrollHeight;
          }
          $("#streamMeta").textContent = `已接收 ${acc.length} 字符 · 首字 ${firstTokenAt} ms`;
        }
      }

      const total = Math.round(performance.now() - started);
      if (node) {
        node.bubble.classList.remove("cursor");
        const meta = document.createElement("span");
        meta.className = "msg-meta";
        meta.textContent = `stream · 首字 ${firstTokenAt || "-"} ms · 总计 ${total} ms`;
        node.bubble.appendChild(meta);
      }
      if (acc) {
        streamState.history = payload.messages.concat([{ role: "assistant", content: acc }]);
      }
    } catch (err) {
      bubble($("#streamWindow"), "system", "请求异常：" + err);
    } finally {
      btn.disabled = false;
      btn.textContent = "流式发送";
    }
  }

  $("#btnStreamSend").addEventListener("click", sendStream);
  $("#streamInput").addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") sendStream();
  });
  $("#btnStreamClear").addEventListener("click", () => {
    streamState.history = [];
    $("#streamWindow").innerHTML = '<div class="empty">发送消息，回复将以打字机效果呈现</div>';
    $("#streamMeta").textContent = "等待发送";
  });

  /* ---------- 5. 文档上传 ---------- */

  let selectedFile = null;
  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");

  $("#btnPickFile").addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

  function setFile(file) {
    selectedFile = file || null;
    $("#fileName").textContent = file ? `${file.name}（${(file.size / 1024).toFixed(1)} KB）` : "尚未选择文件";
    $("#btnUpload").disabled = !file;
  }

  $("#btnUpload").addEventListener("click", () => {
    if (!selectedFile) return toast("请先选择文件");

    const form = new FormData();
    form.append("file", selectedFile);

    const btn = $("#btnUpload");
    btn.disabled = true;
    $("#progressWrap").hidden = false;
    setBadge($("#uploadStatus"), "上传中…", "");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url("/documents/upload"));

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $("#progressInner").style.width = pct + "%";
      $("#progressText").textContent = pct + "%";
    };

    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (_) {}
      $("#uploadRaw").textContent = JSON.stringify(data ?? xhr.responseText, null, 2);
      if (xhr.status >= 200 && xhr.status < 300) {
        setBadge($("#uploadStatus"), "HTTP " + xhr.status + " 成功", "ok");
        toast(`上传成功：${data.chunk_count} 个分块`);
      } else {
        const detail = data && data.detail ? data.detail : xhr.responseText;
        setBadge($("#uploadStatus"), "HTTP " + xhr.status, "err");
        toast("上传失败：" + detail);
      }
    };

    xhr.onerror = () => {
      setBadge($("#uploadStatus"), "请求失败", "err");
      $("#uploadRaw").textContent = "网络错误，请确认后端服务已启动";
    };

    xhr.onloadend = () => {
      btn.disabled = false;
      $("#progressText").textContent = "完成";
    };

    xhr.send(form);
  });

  /* ---------- 6. 文档列表 ---------- */

  async function loadDocs() {
    setBadge($("#docsStatus"), "加载中…", "");
    try {
      const r = await request("/documents", { method: "GET" });
      $("#docsRaw").textContent = JSON.stringify(r.data ?? r.text, null, 2);
      const body = $("#docsBody");

      if (!r.ok) {
        setBadge($("#docsStatus"), "HTTP " + r.status, "err");
        body.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(errorText(r))}</td></tr>`;
        return;
      }

      const list = Array.isArray(r.data) ? r.data : [];
      setBadge($("#docsStatus"), `HTTP ${r.status} · ${list.length} 条`, "ok");
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row">暂无文档，先去「文档上传」页传一个</td></tr>';
        return;
      }
      body.innerHTML = list
        .map(
          (d) => `<tr>
            <td>${escapeHtml(d.filename || "-")}</td>
            <td>${escapeHtml(d.mime_type || "-")}</td>
            <td><span class="badge ${d.status === "ready" ? "ok" : "warn"}">${escapeHtml(d.status || "-")}</span></td>
            <td>${escapeHtml(d.created_at || "-")}</td>
            <td>${escapeHtml(d.id || "-")}</td>
          </tr>`
        )
        .join("");
    } catch (err) {
      setBadge($("#docsStatus"), "请求失败", "err");
      $("#docsBody").innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(String(err))}</td></tr>`;
    }
  }

  $("#btnRefreshDocs").addEventListener("click", loadDocs);

  /* ---------- 初始化 ---------- */

  els.apiBase.value = localStorage.getItem("apiBase") || DEFAULT_BASE;
  els.apiBase.addEventListener("change", () => {
    localStorage.setItem("apiBase", els.apiBase.value.trim());
    toast("API Base 已更新");
  });

  checkHealth("health");
  setInterval(() => checkHealth("health"), 30000);
})();
