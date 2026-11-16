# @local/dsh-llm-detector

DSH plugin: LMFPD 模型检测 — 用 3 道计数挑战题判断当前配置的模型是否为 LMFPD 库内已知模型。

Sidebar entry (模型检测) + main panel; host tool `llm_detector` (action: start/status/cancel).

## 开源项目

- [Ikaleio/lm-detector](https://github.com/Ikaleio/lm-detector) — 提供 `lmfpd-sdk` (MIT)，用于模型指纹样本加载与评分。

## Run

1. `npm install`
2. `npm test`
3. Install into DSH: plugin-manager `install_bundle` with `link:<this dir>`, restart DSH.

## Layout

- `typert.js` — hand-written strict codecs + invocation descriptors (auto-registered via `./typert` export)
- `index.js` — host service: runs challenges via `ctx.llm.stream`, analyzes with `lmfpd-sdk`, exposes start/status/cancel
- `client.js` — web face: sidebar row, panel, polling UI
- `cordis.patch.yml` — inserts the plugin into the app config

结论为参考库统计排名，非模型提供方确认；样本不足时仅给部分结论。
