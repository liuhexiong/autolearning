# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoLearning is a browser extension MVP that helps with algorithm problem solving by:
1. Automatically identifying problem statements on the left side of the page
2. Reading existing code from the right-side editor
3. Calling a large language model (OpenAI-compatible) to generate solutions
4. Filling the generated code back into the editor

The extension is built for Chrome Manifest V3 and primarily targets "left problem statement + right code editor" interfaces like Educoder, but also supports generic editors (Monaco, CodeMirror 5, Ace, textarea).

## Development Commands

```bash
# Run the Playwright prototype (requires .env with EDUCODER_USERNAME/PASSWORD)
npm run dev

# Build TypeScript source to dist/
npm run build

# Run the built JavaScript
npm run start

# Launch Playwright's code generator for recording flows
npm run codegen

# Check extension JavaScript files for syntax errors
npm run check:extension

# Run browser automation smoke test (starts mock server, loads extension)
npm run test:extension
```

### Environment Variables

Create a `.env` file from `.env.example`:
- `EDUCODER_USERNAME`, `EDUCODER_PASSWORD`: Credentials for the Educoder platform (used by the Playwright prototype)
- `HEADLESS`: Set to `true` to run Playwright in headless mode
- `KEEP_OPEN`: Set to `true` to keep the browser open after prototype execution

## Architecture

### Browser Extension (`extension/`)

**Manifest V3** (`manifest.json`):
- Content script (`content.js`) injected on all pages
- Background service worker (`background.js`)
- Options page (`options.html`, `options.js`)
- Page bridge script (`page-bridge.js`) injected via `web_accessible_resources`
- Permissions: `storage`, `clipboardRead`, `clipboardWrite`
- Host permissions: `<all_urls>`

**Key Components**:

1. **Content Script** (`content.js`):
   - Injects floating UI panel with buttons: "识别题面", "生成答案", "填充代码"
   - Detects supported pages (left panel with problem, right panel with editor)
   - Communicates with page bridge to read/write editor content
   - Sends problem data to background for AI solving

2. **Background Service Worker** (`background.js`):
   - Handles settings storage (base URL, API key, model, extra instructions)
   - Makes API calls to OpenAI-compatible endpoints
   - Processes problem solving requests from content script

3. **Page Bridge** (`page-bridge.js`):
   - Injected into page context to access editor APIs
   - Supports Monaco, CodeMirror 5, Ace, and plain textarea
   - Provides `getEditorValue` and `setEditorValue` functions

4. **Options Page**:
   - Allows configuration of AI endpoint settings
   - Stores settings in `chrome.storage.local`

**Communication Flow**:
Content script ↔ Background (via `chrome.runtime.sendMessage`)
Content script ↔ Page bridge (via custom DOM events)

### Playwright Prototype (`src/`)

Originally used for extracting problem data from Educoder, now kept as reference for debugging site structures.

**Key Files**:
- `main.ts`: Entry point launching browser and extracting problem data
- `extractor.ts`: DOM selectors and extraction logic for problem statements
- `config.ts`: Environment configuration
- `types.ts`: TypeScript interfaces (`ProblemData`, `SolveResult`)
- `prompt.ts`: Builds AI prompts from extracted problem data
- `flows/recorded.ts`: Navigation flow for Educoder

**Data Structures**:

```typescript
interface ProblemData {
  url: string;
  title: string;
  statementText: string;
  statementHtml: string;
  currentCode: string;
  currentCodeLineCount: number;
  samples: Array<{ input: string; output: string }>;
  limits: { time?: string; memory?: string; language?: string };
}

interface SolveResult {
  model: string;
  promptPreview: string;
  code: string;
}
```

### Testing

**Smoke Test** (`scripts/extension-smoke.mjs`):
- Starts a mock HTTP server with a test problem page and mock AI endpoint
- Loads the extension into a persistent browser context
- Exercises the full workflow: UI injection, problem extraction, AI call, code fill-back
- Validates each step and saves screenshots on failure

**Real Educoder Check** (`scripts/real-educoder-check.mjs`):
- Tests the extension on a real Educoder problem page (requires macOS Chrome profile)
- Copies Chrome user data to avoid login prompts
- Generates a report with UI visibility and extraction results
- Useful for validating selector updates against the live site

## Important Notes

- The extension is unpacked; load via Chrome's "Load unpacked" extension developer mode
- The extension is a learning aid and does not automatically submit answers
- Generated artifacts (screenshots, extracted data) are saved to the `artifacts/` directory
- Page structure changes may require selector updates in `content.js` and `page-bridge.js`
- The Playwright prototype requires valid Educoder credentials to run
- AI settings are configurable via the extension options page
- The project uses TypeScript for the prototype but plain JavaScript for the extension