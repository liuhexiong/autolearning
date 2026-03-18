# AutoLearning Browser Extension MVP

这个仓库现在以浏览器插件为主，目标是帮助你在做算法题时：

1. 自动识别页面左侧题面
2. 把右侧已有代码一起作为上下文
3. 调用大模型生成解题思路和代码
4. 一键把生成结果填回编辑器

当前实现优先适配 Educoder 这类“左题面 + 右代码编辑器”的界面，同时兼容一部分通用编辑器页面。

## 已完成的 MVP

- Chrome Manifest V3 插件
- 页面内悬浮助手面板
- 自动提取题目标题、题面正文、样例提示和当前代码
- 支持 Monaco / CodeMirror 5 / Ace / 普通 textarea 的读取与回填
- 通过可配置的 OpenAI 兼容接口调用模型
- 设置页可填写 `Base URL`、`API Key`、`Model` 和额外提示词

## 目录

- [extension](/Users/lhx/Desktop/autolearing/extension): 浏览器插件本体
- [src](/Users/lhx/Desktop/autolearing/src): 之前的 Playwright 原型，保留作提取调试参考

## 安装插件

1. 打开 Chrome 或 Edge 的扩展管理页面
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择这个目录下的 [extension](/Users/lhx/Desktop/autolearing/extension)

## 配置模型

加载插件后，打开插件详情页里的“扩展程序选项”，或者在页面悬浮面板里点击“设置”。

建议先填：

- Base URL: `https://api.openai.com/v1`
- API Key: 你的接口密钥
- Model: `gpt-4.1-mini`

如果你用 OpenRouter 或别的兼容服务，只要把 `Base URL` 改成对应地址即可。

## 使用方式

1. 打开带题面和代码编辑器的算法题页面
2. 页面右侧会出现 `AL` 悬浮按钮
3. 点击后执行：
   - `识别题面`
   - `生成答案`
   - `填充代码`

插件会把页面题面和当前代码一起发给模型，所以如果你右侧已经写了一半，模型会尽量在现有代码基础上补全。

## 本地校验

如果你想快速检查扩展脚本有没有语法错误，可以运行：

```bash
npm run check:extension
```

如果你想直接跑一遍浏览器自动化冒烟测试，可以运行：

```bash
npm run test:extension
```

## 说明

- 这是学习辅助插件，当前不会自动提交答案。
- 页面结构变化后，可能需要微调选择器。
- 老的 Playwright 原型还在 [src](/Users/lhx/Desktop/autolearing/src) 目录，可以继续拿来做站点结构调试。
