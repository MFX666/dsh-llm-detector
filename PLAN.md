# DSH 模型指纹检测插件方案

状态：设计交付，尚未实现、安装或调用付费模型 API。基于当前安装的 DSH 0.2.2-rc.3、Node 24.21.0 与上游 lmfpd-sdk 0.2.0 核实。

## 1. 目标与交付边界

在 DSH 内打开“模型指纹”面板，选择已配置的 Provider / 模型，执行一轮三题检测，展示与公开参考库最接近的模型及家族、样本质量和证据。用户无需再次填写 API Key，也无需离开 DSH。

采用用户选择的客户端插件形态，并按当前 DSH 的真实格式落地：一个安装包包含轻量客户端入口与必要的 Host 逻辑。“Tier-1 ESM”是此前讨论中的形态称呼，当前 DSH 不直接加载 CC GUI 的 manifest.json / activate(ctx) 单文件协议。Host 可使用 ESM；浏览器产物必须注册 DSH 的模块工厂。

本轮只交付此方案。后续实现不改 DSH 核心、不改用户现有 Provider 配置，不安装其他检测插件。第一版不做 tokenizer 探测、图片题、多轮投票、批量测速、历史数据库、自动定时检测、自建参考库或运行时下载新版代码。一个全局面板、一个 Host 检测操作即可完成核心用途。

## 2. 已核实的约束与关键决策

| 问题 | 决定 | 原因 |
| --- | --- | --- |
| 模型请求由谁发 | Host 调用 ctx.llm.stream | 沿用 DSH 的凭据解析、协议适配与 Provider 兼容参数 |
| 上游 SDK 用到哪里 | generateChallenges + loadDetector + detector.analyze | 复用出题与评分；不重新实现分布特征、阈值或概率校准 |
| 客户端是否接触密钥 | 不接触；只传 provider / model 标识 | 无需把 baseURL、apiKeyEnv 或凭据送进浏览器 |
| 是否需要 Agent / 会话 | 不需要；使用独立 LLM 请求 | 避免聊天上下文、系统提示、工具调用和会话日志污染样本 |
| 页面位置 | root 级 main 全局面板 | 不依赖当前 Session；空白会话也能检测 |
| 请求数量 | 每轮 3 题，串行，每题一次尝试 | 对齐标准三题评分，避免不必要的并行与隐式费用 |
| 懒加载 | 入口轻量注册，首次开始检测才 import SDK 和加载数据 | 重代码、解压、参考库下载不进入启动路径 |
| 数据更新 | 每轮重新 loadDetector，复用 SDK 磁盘缓存 | 常驻 detector 单例不会因 TTL 自动换库 |
| 题目 / 算法更新 | 升级固定版本 SDK / 插件 | 数据更新不等于代码或提示词更新 |

直接把 DSH 的 baseURL / apiKey / model 映射给 SDK.detect 虽然省一层采样代码，却会绕过 DSH Provider 适配，不能作为默认实现。无需维护 openai-responses、openai-completions、anthropic-messages 的第二套协议映射。

## 3. 用户流程与页面

1. 从 DSH 全局导航打开“模型指纹”。进入页面只读取模型目录，不触发检测、SDK 加载或参考库下载。
2. 按 Provider 分组选择模型。展示真实配置标识与可用性；没有可用模型时，引导前往 DSH 模型设置。
3. 页面说明“一轮 3 次模型请求，可能产生渠道费用”，点击“开始检测”才创建任务。
4. 展示“加载参考库 → 第 1/3 题 → 第 2/3 题 → 第 3/3 题 → 评分”。执行中可取消，禁止重复开始。
5. 完成后展示结果、各题状态和实际使用的参考库版本。失败时给出可定位的原因，用户可主动重试整轮。

页面内容顺序：渠道与模型选择、费用说明与操作按钮、运行状态、结果摘要、Top 5 候选、三题详情、方法局限。移动窗口改为单列；候选表可横向滚动。中文为默认用户语言，同时准备英文资源。

结果摘要使用“参考库内最接近：…”与“家族倾向：…”。只有 SDK 返回有效校准概率时显示“参考库内校准概率”，不得改写成“真实模型确认率”。无校准概率时显示排序分与原因。上游 decision 为 partial / unscorable / not_model 时分别显示“样本不足 / 无法评分 / 不符合模型样本特征”，不强行给成功结论。

请求中的 model 标识只标作“配置模型”。DSH 通用流接口没有稳定的 response_model 字段；第一版不从适配器私有 replayState 猜测实际响应型号。候选模型与配置模型相同，也不能证明渠道身份。

## 4. 架构与数据流

~~~mermaid
flowchart LR
    UI[DSH 全局 React 面板] -->|模型标识与操作| H[插件 Host 检测操作]
    H -->|裸模型请求| L[DSH llm.stream]
    L --> P[已配置 Provider]
    H -->|按需 import| S[lmfpd-sdk]
    S -->|按需加载 / 缓存| D[公开参考库]
    H -->|challenge prompt| L
    H -->|回答文本 + expected_count| S
    H -->|脱敏状态与结果| UI
~~~

浏览器负责表单、状态和展示；Host 负责输入验证、任务生命周期、模型请求和评分；SDK 负责挑战与检测方法。公开参考数据请求只下载数据，不向 lm.ikale.io 上传渠道密钥、模型回答或会话内容。

### 4.1 DSH 连接点

- Host 枚举：ctx.llm.listProviders() 与 await ctx.llm.listModels(provider)。浏览器可利用现有 ctx.remote.session.modelCatalog() 获得分组、默认项与 failures；该目录构建不需要已存在的 Session。
- Host 采样：ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>。顶层 options.signal 支持取消；请求不设置 identity / session / agent。
- Client 页面：使用 root-scoped 的 main keyed slot，key 为插件独有值 dsh-llm-detector。通过 ctx.layout.selectPanel(id) 打开，selectPanel(null) 返回聊天；不创建或切换会话。
- 模块入口：package.json 声明 dsh.client、./client export；client.js 使用 window.__ModuleLoader__.load({ id, factory(require) { ... } })，React 取自 require('react')。
- 资源生命周期：所有 slot、样式、事件与任务取消器归属插件 Context 的 effect；卸载时移除入口、清除订阅、取消在途模型请求。组件内样式随组件卸载。

面板与导航的具体注册以及 Host 远程接口写法见第 13 节。上述 DSH API 已读当前安装源码，但尚未做运行时插件验证。

### 4.2 插件自定义操作契约

以下为待实现的插件接口，不是声称 DSH 已有同名服务：

| 操作 | 输入 | 返回 / 行为 |
| --- | --- | --- |
| start | { provider: string, model: string } | 验证模型仍可用；成功创建单轮任务并立即返回 runId；已有活动任务返回 busy |
| status | { runId?: string } | 指定 runId 时读取该轮；省略时返回当前任务 / 最近结果，供重开页面恢复；无任务返回 idle；不返回密钥或请求头 |
| cancel | { runId: string } | 只取消匹配的活动任务；重复取消幂等；不存在时明确返回 not_found |

Host 每实例只保留一个活动任务与最近一次结果，无队列、数据库或后台常驻任务。终态后允许新一轮覆盖旧结果。重复点击和多个页面同时开始都由 Host 的活动状态判定，不只依赖按钮禁用。runId 由 Host 生成；过期 runId 不能取消新任务。

可见状态由同一个 Host 快照产生，UI 与 Agent 共用同一组 Host 方法。重新打开面板时调用 status({}) 恢复；运行中约每秒查询，前次查询结束才排下一次，不叠加请求；终态或页面卸载停止轮询。断连时显示“连接中断，状态未确认”，重连后重新读取；不得仅因前端连接中断便显示任务已取消。无需自建进度事件系统。

## 5. 最小检测流程

1. 同步校验 provider、model 为非空字符串并限制长度；拒绝客户端自定义 URL、Header、API Key、prompt 或任意 GenerateOptions。
2. 在任何异步等待前占用唯一活动任务并建立 AbortController，再到当前模型目录验证组合。验证失败释放活动占位并返回安全错误；验证成功创建 runId、返回任务标识，后台进入 loading_data。
3. 动态 import('lmfpd-sdk')。原生 import 缓存模块加载；不在顶层 import SDK。若插件自己保存 import Promise，加载失败必须清空，允许下一次重试。
4. await loadDetector({ ttl: 86400 })。本轮固定该 detector 和 builtAt。检查任务是否已取消 / 插件是否已卸载，再继续。
5. 调用 generateChallenges(3)，保存每题原始 id、prompt、expected_count；不改题、不翻译、不手填 300。
6. 对每题单独调用 ctx.llm.stream，messages 只有一个 user 消息，内容为该题 prompt；不传 system、工具、会话历史或身份上下文。串行执行，不自动重试。
7. 只累计 text-delta.text。block-end 可能包含同一段全文，不能再次累加；reasoning 与 tool 内容不进入评分。每题保留最终观察到的 usage 快照，跨题各累计一次，不能把流中重复快照相加；缺失时显示“渠道未提供”。
8. 每题使用独立的 120 秒总超时，连同整轮取消合并到请求 signal；finally 清除计时器。与 SDK.detect 的流式首包超时语义不同，此处明确采用总时限。
9. 只有自然结束且 finish.reason.kind 为 stop 的文本才进入评分。max-tokens、tool-calls、aborted、error、抛异常、没有 finish 的中断流均作失败，保留脱敏错误；未知的扩展 finish kind 默认失败。
10. 对三题组装 Output[]，成功项为 { text, expected_count }，失败项 text 为空，仍保留原 expected_count 供 SDK 标识缺失。整轮主动取消时不调用 analyze、不发布成功结果。
11. detector.analyze(outputs, { strict: false }) 完成解析与评分；不另写整数提取、最少数量、特征统计或概率公式。返回 decision、候选、诊断与版本元信息。
12. 在写回结果前再核对 runId、取消状态与插件存活状态，避免旧异步结果覆盖新任务或卸载后的页面。

上游要求每题约 292–332 个 1–355 整数，实际数量以 Challenge.expected_count 为准。最低有效数为 max(80, ceil(expected_count × 0.55))，宽松评分截取超量整数；这些规则由 SDK 执行，插件只展示 diagnostics。自然 stop 不等于有效回答；拒答或非数字内容仍由评分器判为不可用。

请求不主动设置 temperature、top_p 或强制关闭 thinking，沿用 Provider 默认行为；不得声称关闭思考就是上游默认。上游直接请求在 Messages 使用 max_tokens 8192，在 Responses / Chat 不设输出上限；DSH 适配器可能使用自己的默认值与兼容策略。本插件保留 DSH 渠道行为，报告中记录采样路径为 DSH llm.stream，不能声称与网页网络请求完全相同。若 Provider 修改默认采样参数，可能影响匹配，应随结果说明。

这里选择等待自然完成，第一版不做“数够后提前切断”的流式优化。它减少一套截断与取消判定，但可能比上游宽松采样多消耗输出 token。以后若加入提前结束，必须区分达到数量的正常截断和用户取消，并添加相应回归覆盖。

## 6. 状态、错误与恢复

~~~text
idle → loading_data → sampling(1..3) → analyzing → completed
                 ↘ failed         ↘ failed
任一活动阶段 → cancelled
~~~

completed 只表示检测流程结束；是否能下结论必须看 analysis.decision。一个或两个有效样本允许 partial，不补发付费请求；全失败展示每题原因，不能把错误文本喂给评分器。

| 场景 | 行为 |
| --- | --- |
| 没有可用模型 / 目录部分失败 | 展示目录 failures；可用分组仍可选择 |
| 模型在点击后被移除 | Host 二次校验失败，不发请求 |
| 首次加载参考库且离线 | loading_data 失败；不发送模型请求；可主动重试 |
| 已有参考库但更新失败 | 继续使用 SDK 缓存；显示实际 builtAt，不声称已更新 |
| 401 / 403 | 该题失败，提示检查 DSH 渠道鉴权；不要回显 Authorization 或原始请求 |
| 429 / 网络错误 / 超时 | 保留失败，不隐式重试；用户可取消或整轮重测 |
| reasoning、拒答、输出过短 | reasoning 不计入文本；交给 SDK 诊断样本质量 |
| 取消发生在参考库加载时 | 立即标记取消；SDK.loadDetector 无外部 signal，下载可能继续；返回后不得开始模型请求 |
| 取消发生在模型请求时 | abort 当前请求，后续题不启动，整轮不评分；已产生费用无法撤回 |
| 页面切走 / 重新进入 | Host 任务继续，回到面板读取状态；不把视图卸载当主动取消 |
| 禁用插件 / Host 结束 | 取消活动模型请求，释放注册；在途数据加载不能承诺物理取消 |

只展示经过处理的错误类别、状态码与安全说明。错误对象可能包含带 token 的 URL、Header、请求体或堆栈，不能直接 JSON.stringify 后送到浏览器或日志。

## 7. 懒加载与更新语义

### 7.1 首次使用加载什么

| 阶段 | 允许的工作 | 不应发生 |
| --- | --- | --- |
| DSH 启动 | 载入小型 Host 入口，注册客户端 factory、全局入口和远程操作 | SDK import、参考库读取 / 解压 / 联网、模型请求 |
| 打开面板 | 渲染轻量 React 页面，读取模型目录 | 自动检测与参考库下载 |
| 点击开始 | import SDK、loadDetector、出题、采样、评分 | 任意额外探测或后台批量任务 |
| 后续检测 | 复用已载入 SDK，再次 loadDetector，复用磁盘缓存 | 复用永久不变的 detector 单例 |

当前 DSH 启动 combo 会携带 client.js 并注册 factory；可见入口也需要轻量激活。因此不能承诺插件“启动零字节 / 零开销”。第一版 UI 足够小，直接使用官方单文件 factory 格式，不为几项表单引入额外打包器或 UI 库。以后确有重型 UI 时再用官方 import() → require.async 分块链路；不能直接给浏览器塞 Node SDK。

### 7.2 参考库如何更新

SDK 默认来源依次为 https://lm.ikale.io/data/ 与 https://cdn.jsdmirror.com/npm/lmfpd-data@latest/。首个可用来源决定该次加载版本，不保证其总是全球最新。使用 SDK 默认缓存位置，不删除或改写用户共享缓存。

- 没有缓存：同步下载、解析后返回；全部来源失败就报错。
- 有缓存：立即返回缓存数据。缓存检查时间超过 TTL 时，后台检查版本并尝试下载新数据。
- 后台更新与磁盘写入成功完成后，后续 loadDetector 才能取得新版本。正在执行的一轮保持旧快照；下一轮也可能赶不上更新。
- ttl: 0 也只是每次加载时触发后台检查，不是等待更新完成。第一版不提供语义含糊的“立即刷新”按钮，也不通过删缓存强迫联网。
- 后台错误和缓存写失败可能被 SDK 吞掉。builtAt 表示使用的数据构建时间，不能当成“最近成功联网检查时间”。镜像同步也可能延迟。

每次 start 重新 loadDetector 比常驻单例多一次缓存读取 / 解析，却省去自建更新器、锁与替换逻辑。第一版串行单任务；SDK 过期刷新尚未完成时再次运行可能触发重复后台检查，不对其做额外封装。后续只有测得下载放大问题才增加协调。

### 7.3 网站更新能否同步

| 上游变化 | 本插件行为 |
| --- | --- |
| 新增模型、参考样本或重新训练同一兼容格式的检测库 | 公共数据发布后，按上述缓存流程取得；不是网页一上线就即时同步 |
| 改题目语言、措辞或生成策略 | 升级 lmfpd-sdk / 插件后生效 |
| 改评分算法、输出结构或不兼容的数据 schema | 升级 SDK 并做回归；不靠 TTL 解决 |
| 网站专有 tokenizer / 图片 / 多轮功能 | 不会因为刷新参考库自动加入本插件 |

SDK 依赖固定为 0.2.0 并提交锁文件，禁止运行时用 latest 下载执行代码。以后升级明确记录 SDK 版本、数据兼容性与结果变化。

## 8. 结果与数据契约

每轮保存于 Host 内存的最小报告：

- runId、startedAt、finishedAt、status、requestedProvider、requestedModel。
- sdkVersion（插件依赖 / 构建元数据写入）、detectorBuiltAt、analysis.model_version 中可用的方法与数据版本字段。
- challenges 原始 id / prompt / expected_count；samples 的文本、终态、耗时、finish kind、usage 与脱敏错误。
- analysis 原样可用的 decision、prediction、family_prediction、results、probability_status、calibration、used_outputs、diagnostics。

浏览器默认返回结果摘要与诊断；原始文本只在本地展开查看。密钥、认证记录、完整请求头、Provider 原始配置、私有 replayState 不进入结果。第一版无持久化历史、自动上传、遥测或文件导出，因此没有旧数据迁移。

SDK 不导出 sdkVersion，包 exports 也未开放 package.json；不能编造 import { sdkVersion }。方法版本与数据版本也不能只由 npm 版本替代。JSON 中保留原始分数语义；不把 score 排序分转为百分比。

模型检测为参考库内的统计归因。未收录模型、供应商调参、系统层提示、量化、微调、代理改写、动态路由、混合后端都可能降低准确度。三题还可能分别命中不同后端，因此一轮结果不代表渠道长期固定使用同一模型。

## 9. 安全、费用与可访问性

信任边界为浏览器 → Host → DSH Provider / SDK 数据源。Host 对模型标识与任务操作做校验；鉴权、baseURL 和密钥继续由 DSH 处理。插件不读取或重写用户的 cordis.patch.yml，不遍历配置目录取密钥。

检测只在明确操作后启动，不挂开机、模型切换、会话打开或定时器自动检测。页面说明三次请求与潜在费用；报告使用渠道返回的 token usage：inputTokens 是未缓存输入，总输入另加 cacheReadTokens 与 cacheWriteTokens；reasoningTokens 不重复加进 output / total。缺失值不当零，不根据 token 数伪造货币账单。取消不能撤销已发生的计费。

界面沿用 DSH 的 --dsw-alias-* 主题 token、字号和布局。控件有 label、键盘焦点与禁用状态；进度区域 aria-live=polite，错误可被读屏获取，不只靠颜色表达结果。中英文文案走 ctx.locale。禁止 iframe、第二个 React 根节点、DOM 抓取或 require 内部 UI primitives 包。

## 10. 文件与打包计划

下列是后续实现的计划文件，当前尚未创建：

~~~text
dsh-llm-detector/
  PLAN.md                 本设计；唯一方案文档
  package.json            ESM、exports、dsh.bundle / dsh.client、固定 SDK 依赖
  cordis.patch.yml        只插入本插件的 Loader 行
  index.js                Host 激活、接口、任务、DSH 采样与 SDK 懒加载
  client.js               DSH factory 格式，面板与导航；复用宿主 React
  locale/zh.json          插件元信息与中文 UI
  locale/en.json          插件元信息与英文 UI
  icon.svg                原创或明确可再分发的图标
  README.md               实际能力、用法、费用与局限；可用作插件详情回退
  test/detector.test.js    小型 Node 测试，模拟 Provider 与 SDK；不调用付费 API
  package-manager lock    实现时所用包管理器的单一锁文件
~~~

包名建议 @local/dsh-llm-detector，Loader id 为 dsh-llm-detector。exports 至少包含 .、./client、./locale/*.json、./icon。files 必须覆盖实际运行 JS、patch、locale、图标与 README；SDK 为运行时 dependency，其余 DSH 注入服务不随包再打第二份。只使用现有运行环境和标准库，不引入应用框架、数据库或状态管理库。

安装时走 DSH 插件管理器的本地目录安装或 install_bundle；不写脚本直接修改 profile。插件替换版本按管理器返回的 restart-required 处理，不承诺页面无需刷新。当前任务不执行安装、启用或发布。

## 11. 实施顺序与完成条件

1. 建立最小 bundle，注册全局入口与页面，核对中文 / 英文元信息、图标、深浅主题及卸载清理。此时不带 SDK 请求。
2. 接通模型目录与 Host 远程操作，用假 Provider 完成 start / status / cancel；验证空会话可用与单任务锁。
3. 加入 SDK 懒加载、每轮 loadDetector 与三题串行 DSH 采样，输出完整元信息。注册一个 llm_detector 工具，用 action=start/status/cancel 复用同一 Host 方法；按 dsh-doc 对比 UI 与工具路径的结果、错误和状态。
4. 完成下表的离线回归、打包文件检查与当前 DSH 界面验证。
5. 在用户明确要求实测后，对一个已配置渠道运行一轮真实检测，核对取消、用量与报告。真实请求可能计费，不能用单元测试替代这一步的结论。

| 验收项 | 可观察证据 |
| --- | --- |
| 启动 / 打开页面无重任务 | SDK import、数据读取与网络请求计数均为零；只有模型目录查询 |
| 首轮懒加载成功 | 开始后才 import / load；请求前能看到 loading_data；失败后可重试 |
| 模型目录复用 | 分组、不可用项、部分 failures 正确；Host 拒绝不存在的组合 |
| 不污染会话 | 从面板运行不创建 Session 或聊天消息；工具入口只有正常工具调用记录，采样不读取调用者会话历史 |
| 采样协议 | 仅三条独立 user prompt、原始 expected_count；没有历史 / system / tools |
| 流处理正确 | text-delta 与 block-end 不双计，reasoning 不入样本，usage 缺失可识别 |
| 异常与部分样本 | stop 可评分；max-tokens / error / 无 finish 排除；1–2 有效样本显示 partial |
| 取消与竞态 | 数据加载后取消不发模型请求；在途 abort；取消后无评分；旧 runId 不影响新任务 |
| 费用次数受控 | 同一轮每题只尝试一次；重复开始被 Host 拒绝；没有自动补题 |
| 参考库更新 | 模拟旧缓存后台更新：本轮仍用旧 builtAt，写入完成后的后续加载用新版本 |
| 版本与概率正确 | 报告记录 SDK / 数据 / 方法版本；无校准时不显示百分比身份结论 |
| 错误脱敏 | 注入含 token 的错误，UI / 日志无密钥、Header 或带凭据 URL |
| 生命周期与兼容 | 导航离开再返回状态可恢复；查询不并发堆积；禁用插件取消请求并移除入口；空会话不崩溃 |
| 远程契约与共享操作 | Host / Client 描述符一致、拒绝未知字段；UI 与工具同参数产生相同任务与失败；卸载后入口不可调用 |
| 发行包完整 | 实际打包清单覆盖 exports 与 patch 资源；运行时能解析 lmfpd-sdk；无重复 React |

无需给静态文案、简单文件列表或一行导出写镜像测试。重点覆盖采样、取消、失败和缓存语义，测试使用可控 async iterable 与假 SDK；真实渠道测试另记请求条件与结果。

## 12. 证据、剩余验证与交接

本方案依据安装版 dsh-doc 及对应 DSH 包源码，不再沿用 CC GUI 插件技能。已验证本机 DSH 0.2.2-rc.3，Electron 内 Node 24.21.0 满足 SDK 的 Node 22+ 要求。SDK 0.2.0 源码对应 commit 1e58ed83c1cde17f88cba89560ad4d083042ae92。

上游资料：

- [LM Detector SDK 文档](https://lm.ikale.io/docs/sdk)、[API](https://lm.ikale.io/docs/sdk/api)、[数据与缓存](https://lm.ikale.io/docs/sdk/data)、[免责声明](https://lm.ikale.io/docs/disclaimer)。
- [SDK 缓存源码（固定 commit）](https://github.com/Ikaleio/lm-detector/blob/1e58ed83c1cde17f88cba89560ad4d083042ae92/sdk/ts/src/data.ts#L112-L120)：有缓存先返回、过期后台刷新。
- [SDK 出口与 detector 源码（固定 commit）](https://github.com/Ikaleio/lm-detector/blob/1e58ed83c1cde17f88cba89560ad4d083042ae92/sdk/ts/src/index.ts)、[评分入口](https://github.com/Ikaleio/lm-detector/blob/1e58ed83c1cde17f88cba89560ad4d083042ae92/sdk/ts/src/analysis.ts)。
- [DSH 官方源码](https://github.com/deepseek-ai/deepseek-harness)。本方案的 DSH 接口以本机 0.2.2-rc.3 包为准，不用主分支文档推定旧版本支持情况。

仍需实现阶段验证：自定义 Remote 服务在本机的注册与卸载、实际面板渲染、各已配置 Provider 的采样兼容、真实 usage 返回、真实检测准确性，以及实际 npm 打包清单。现阶段没有运行插件、没有实测模型身份，不承诺某一渠道一定兼容或某一模型一定能识别。

交接状态：可按本方案进入最小实现；先完成无网络的集成与回归，再安排一次真实渠道实测。若 DSH 版本变化，重读对应版本 dsh-doc 与服务契约，不静默使用私有 API 兜底。

## 13. DSH 具体注册契约

本节补充全局入口、远程操作与共享工具的源码核对结果，作为实现时的接线依据。它描述后续代码，当前没有安装或注册这些服务。

### 13.1 全局面板与导航

客户端 factory 的 apply(ctx) 以 Context effect 持有两项注册；Page 与 Icon 使用宿主 React，标签走本地化：

~~~js
ctx.effect(() => ctx.slots.inject('main', () =>
  ctx.slots.register({ name: 'main', key: PANEL_ID }, Page)));
ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
  ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, label: panelLabel,
  }, Icon)));
~~~

PANEL_ID 固定为 dsh-llm-detector。sidebar 项与 main 使用同一 id / key，现有侧边栏负责导航，无需另建按钮协议。直接导航时使用 ctx.layout.selectPanel(PANEL_ID)，返回聊天用 null。页面不挂 Session 级 slot。

### 13.2 Host / Client 远程契约

采用当前 DSH 明确支持的手工 Typert 注册，保留普通 Host ESM。无需 TypeScript decorator 编译器，也无需额外生成 ./typert、./remote 产物。

- Host 从 @deepseek-ai/dsh-typert-protocol 导入 TypertRemoteService，声明 export const inject = ['llm', 'typert', 'tools']。服务继承 TypertRemoteService，构造调用 super(ctx, 'llmDetector')，由 Cordis 持有服务生命周期。start、status、cancel 均是此服务实例方法，不另建 HTTP 服务。
- Host 通过 ctx.effect(() => ctx.typert.register(manifest)) 注册公共描述符；manifest 为 { package: '@local/dsh-llm-detector', face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: descriptors }。返回 disposer 交给 Context，禁用插件撤销注册。
- 三个 descriptor 分别使用稳定 id @local/dsh-llm-detector#llmDetector/start、#llmDetector/status、#llmDetector/cancel；service 与 namespace 均为 llmDetector，method 为对应方法名，invocation 为 { kind: 'direct' }。
- 三者都是普通异步返回值，mode 字段省略。每个方法只接受一个 JSON 业务参数 input，对应第 4.2 节对象；parameter 描述 name / wire 均为 input、source 为 json，codec 为严格 schema。result 同样必须携带 mode: 'strict'、typeSymbol 和 create() 解析器。严格输入拒绝未知字段、空标识、无效 action 与超长字符串。
- Client 声明 inject: ['remote', 'remote.session', 'slots']，直接使用 layout 时另加 layout；使用平台已有的 require('zod') 定义对应 codec。await ctx.remote.$mount({ package, descriptors }) 返回异步 disposer，调用所属 fiber 已拥有其清理，无需再套独立生命周期。挂载完成后使用 ctx.remote.llmDetector.start(input)、status(input)、cancel(input)。其返回值为 { ok: true, value } 或 { ok: false, error }，必须先判断 ok，再读取第 4.2 节业务结果。无需 require 不在客户端基础模块表内的 protocol/remote-info。
- 手工描述符不需要生成器提供的 input()/invoke() 辅助函数；两者都省略才符合此处约定。不把宽松、缺少 codec 的动态方法暴露为兜底。

start 只创建任务并立即返回，RPC 断连不等于取消检测。取消检测由 cancel({runId}) 显式执行；模型请求的 AbortController 属 Host 任务，不绑定浏览器查询连接。status 的结果来自白名单快照，底层异常与 Provider 配置不进入结果。预期的 busy / not_found / 参数错误使用稳定业务错误码，不把原始异常交给 Gateway 自动序列化。

此路径需要在两侧声明三个小型 wire schema。回归比较 descriptor 的 id、service、namespace、method、参数和结果形状，并通过正常、未知字段与缺字段样例交叉解析，防止手写契约漂移；不为三个方法再造代码生成器。

### 13.3 一个操作，两种调用方

按 dsh-doc 的共享操作要求，提供单个 llm_detector 工具，action=start/status/cancel；参数与第 4.2 节保持同义，调用上述同一 Host 实例。Host 从 @deepseek-ai/dsh-tools 导入 defineTool，用 ctx.tools.register(defineTool({ name, description, parameters, output, execute })) 注册。parameters / output 使用 DSH Tool schema DSL，不把 Zod schema 直接当工具参数；execute 分派到同一服务方法并返回同义业务结果。工具不接受 prompt、API Key、URL 或任意请求选项。status / cancel 不触发新检测；start 的工具描述明确一轮三次模型请求及可能计费，不自动挂入任何启动流程。

### 13.4 当前安装版证据

以下是本机源码路径，部署版本变化后需重新核对：

- [全局面板与侧栏注册示例](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/src/client/index.ts:129)；[侧栏导航契约](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/README.md:42)。
- [手工 Typert 注册支持](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-typert-loader/src/index.ts:21)；[手工 descriptor 校验条件](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-typert-loader/src/index.ts:272)。
- [公开调用描述符形状](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/src/types.ts:390)；[客户端严格参数校验](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-gateway/src/client/index.ts:301)。
- [启动模块与按需分块机制](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md:43)；[UI 与工具共用操作要求](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/references/user-actions.md:3)。

补充依据：[客户端挂载与释放](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-gateway/src/client/index.ts:214)、[RemoteResult 包装](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-gateway/src/client/index.ts:444)、[工具注册](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/README.md:38)、[usage 字段定义](/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/src/types.ts:175)。

手工注册已完成源码核对，另用内存 Gateway 断言验证了普通服务与手工 descriptor 的分派、输入校验和 signal，最终 exit 0；这不是成品插件测试。完整插件面板、Client $mount 连线、禁用清理和真实渠道仍属于实现阶段的验收。

## 14. 交付自检

自评对象仅为设计文档，不代表实现通过。

| 维度 | 分数 | 依据与边界 |
| --- | --- | --- |
| 准确性 | 4/5 | 按安装版与固定 SDK 源码核对；尚无运行时插件或真实渠道验证 |
| 完整性 | 5/5 | 覆盖渠道、凭据、采样、生命周期、缓存、升级、异常与验收 |
| 清晰度 | 5/5 | 用户承诺、内部接口、更新条件和剩余验证分别说明 |
| 可执行性 | 4/5 | 有文件计划与实施顺序；仍需本机集成与真实渠道验证 |
| 简洁性 | 4/5 | 一份完整方案，省去独立配置页、历史库和自建更新器；契约说明较长 |

总分 4.4/5。无低于 4 分的项。主要边界为运行时验证留待实现阶段完成，不以自评分代替测试。用户判断应以是否覆盖既定客户端形态、Provider 复用和懒加载 / 更新问题为准；不能预设用户同意此评分。
