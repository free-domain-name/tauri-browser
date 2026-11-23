# Verification

This folder checks what a user actually sees. It starts the real browser
build, drives the running window and looks at the result. There is no mock
browser, no fake network and no snapshot of what the code hoped would
happen: the checks run against the application binary with the real
Chromium, the real Rust and the real network.

The whole suite takes about twenty seconds.

## Running it

```sh
npm run verify                 # every journey
npm run verify -- first-launch # one journey
npm run verify -- --list       # the names of the journeys
```

The runner needs a build of the browser. On macOS:

```sh
cd ../free-domain-browser-cef
cargo build --bin free-domain-browser-cef
cargo run --bin bundle -- --build-only
```

`FDB_CEF_BINARY` overrides the path of the build it starts. The run uses its
own profile and its own settings file, so it never touches the browser you
are using and can start next to it.

## The journeys

A journey is a JSON file in `journeys/`. It is the written-down version of
what the browser must do, and the runner checks exactly that.

```json
{
  "name": "first-launch",
  "description": "The browser opens on its own start page, never on a search engine.",
  "steps": [
    { "do": "evaluate", "expression": "return document.getElementById('url').value;",
      "expect": { "equals": "" }, "why": "the address bar starts empty" }
  ]
}
```

Every step says what it does and why it matters. When a step fails the
runner prints the reason and writes a screenshot of the window to
`verification/artifacts/`.

The steps are:

| step | what it does |
| --- | --- |
| `evaluate` | runs an expression in the window and checks the value |
| `click` | presses a button |
| `type` | types into a field and presses Enter |
| `waitFor` | waits until an expression is true |
| `waitForSelector` | waits until an element exists |
| `targets` | waits until a page with the expected title is open |
| `screenshot` | saves a picture of the window |
| `pause` | waits a moment |

The expectations are `equals`, `notEquals`, `contains`, `notContains`,
`matches`, `truthy`, `falsy`, `above` and `atLeast`.

## Why it exists

The unit tests check the parts. They cannot tell you that the browser
opens on a search engine, that the settings button does nothing, or that
the home button takes you somewhere else. Those are the bugs that reach a
user, and they are the ones a journey catches.

Add a journey when a behaviour matters. A journey that fails is a bug that
would have reached someone.

## What is covered today

| journey | what it holds down |
| --- | --- |
| `first-launch` | the browser starts on its own start page, not on a search engine |
| `chrome-controls` | the settings, chat and home buttons do what they say |
| `navigation` | a name typed into the address bar resolves and loads |

The journeys run against the CEF build, which is the complete application.
The Tauri build shares the journeys; the adapter that drives it is the
next piece of work.
