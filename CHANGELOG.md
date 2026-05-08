# Changelog

## [0.6.0](https://github.com/kiwifs/kiwifs/compare/v0.5.1...v0.6.0) (2026-05-08)


### Features

* **ui:** add [[wiki-link autocomplete to source editor ([#44](https://github.com/kiwifs/kiwifs/issues/44)) ([f8a68f3](https://github.com/kiwifs/kiwifs/commit/f8a68f37082c20c6be450ce0eb31e39f0b3bdd76))
* **ui:** make Markdown source editing the default ([0c83832](https://github.com/kiwifs/kiwifs/commit/0c83832741d297513b4990984b90fc20469b9e2c))
* **ui:** make Markdown source editing the default ([c855fc5](https://github.com/kiwifs/kiwifs/commit/c855fc5c3a404a8c83a84e8bce0907b1871bd487))


### Bug Fixes

* allow agents to read/write .kiwi/rules.md and playbook.md ([#41](https://github.com/kiwifs/kiwifs/issues/41)) ([4b01988](https://github.com/kiwifs/kiwifs/commit/4b019889535cff99666e2caefeb091f96da7d6c5))
* **ui:** diversify graph community colors ([5506002](https://github.com/kiwifs/kiwifs/commit/5506002553f834a4c2b447cf8f5f77f5b452acf5))
* **ui:** improve graph label contrast ([6666806](https://github.com/kiwifs/kiwifs/commit/66668066ef750885d736d24a33686e087aea6fb3))
* **ui:** preserve graph colors while hovering ([0de79fa](https://github.com/kiwifs/kiwifs/commit/0de79fa5169569837e2ceb0ed09ebccb5bb97008))
* **ui:** render knowledge graph node borders ([f174c76](https://github.com/kiwifs/kiwifs/commit/f174c76e847ea52b0fe1e353dbc8d2111adf8c4e))
* **ui:** stabilize large knowledge graph rendering ([8309365](https://github.com/kiwifs/kiwifs/commit/830936571ea7c24462fe315d69728cad35710ba8))

## [0.5.0](https://github.com/kiwifs/kiwifs/compare/v0.4.1...v0.5.0) (2026-05-06)


### Features

* agent-ready infrastructure — claims, workflows, webhooks, _blocked ([722de40](https://github.com/kiwifs/kiwifs/commit/722de40c188cba401ada9dd6e933315b4410b89a))
* agent-ready infrastructure — claims, workflows, webhooks, _blocked ([6150d6e](https://github.com/kiwifs/kiwifs/commit/6150d6ecccd71a596c6867112d78af8aad6bc39d))
* ML & analytics features — 10 new capabilities ([6cefa7c](https://github.com/kiwifs/kiwifs/commit/6cefa7c804f0fb4795c36351fe14cc3f755c8547))
* ML & analytics features — 10 new capabilities ([275b25b](https://github.com/kiwifs/kiwifs/commit/275b25b888dc47300bf996b075dc381aa2dd5f92))
* protect HTTP MCP endpoint with API key auth ([#34](https://github.com/kiwifs/kiwifs/issues/34)) ([fdd6dac](https://github.com/kiwifs/kiwifs/commit/fdd6dac5f172bf8077ce1f350a8ee9b25b5a4114))
* render Mermaid diagrams in Markdown pages ([6300dae](https://github.com/kiwifs/kiwifs/commit/6300dae7818acadaebb72422d3856a0ce00da2ad))
* render Mermaid diagrams in Markdown pages ([9cbe657](https://github.com/kiwifs/kiwifs/commit/9cbe657d10517f321fb8fb0bb20db403faa322a6))
* template consolidation, kiwi_context, UI updates, doc fixes ([06585d8](https://github.com/kiwifs/kiwifs/commit/06585d89db748a8bb60ef56cccb022a8496f43af))
* template consolidation, kiwi_context, UI updates, doc fixes ([#36](https://github.com/kiwifs/kiwifs/issues/36)) ([e35d2a1](https://github.com/kiwifs/kiwifs/commit/e35d2a108ee0e8f539d33c7bae97e3886e065e6c))
* X-Kiwi-Space header dispatch + config-file spaces ([05b442d](https://github.com/kiwifs/kiwifs/commit/05b442de3556e6874be828bc0176ab446bbd7455))


### Bug Fixes

* extract MermaidDiagram, add dark mode reactivity and Storybook stories ([5313577](https://github.com/kiwifs/kiwifs/commit/53135775e3185b4087b0d592072d79dbbc5ef144))

## [0.4.1](https://github.com/kiwifs/kiwifs/compare/v0.4.0...v0.4.1) (2026-05-02)


### Bug Fixes

* sanitize yaml.v2 map types for JSON serialization in metadata_only ([fc5cb5a](https://github.com/kiwifs/kiwifs/commit/fc5cb5a3d143199bb9680ecded0bb8b0e3997cbf))

## [0.4.0](https://github.com/kiwifs/kiwifs/compare/v0.3.0...v0.4.0) (2026-05-02)


### Features

* add HTTP transport for MCP server ([#30](https://github.com/kiwifs/kiwifs/issues/30)) ([3ca2813](https://github.com/kiwifs/kiwifs/commit/3ca28132943dd39864f8cd206f903e766021b750))
* agent infrastructure primitives ([#31](https://github.com/kiwifs/kiwifs/issues/31)) ([0127d65](https://github.com/kiwifs/kiwifs/commit/0127d652d422322e4a597a3746d927b0ac0f9512))
* **ui:** add copy code button, skeletons, error boundaries, and UX improvements ([#27](https://github.com/kiwifs/kiwifs/issues/27)) ([57ea6a8](https://github.com/kiwifs/kiwifs/commit/57ea6a8587bceb4287287baab1190ddc39974090))


### Bug Fixes

* add items schema for bulk write files ([#28](https://github.com/kiwifs/kiwifs/issues/28)) ([757c241](https://github.com/kiwifs/kiwifs/commit/757c24139ca5c0b7e90502d410d18b585873a531))

## [0.3.0](https://github.com/kiwifs/kiwifs/compare/v0.2.0...v0.3.0) (2026-05-01)


### Features

* **ui:** add CSS rendering features and enrich Storybook stories ([#26](https://github.com/kiwifs/kiwifs/issues/26)) ([397a2b5](https://github.com/kiwifs/kiwifs/commit/397a2b58396e781d92583f5c0eeaaa6852879544))
* **ui:** add Storybook with stories for all components ([#25](https://github.com/kiwifs/kiwifs/issues/25)) ([9d2be25](https://github.com/kiwifs/kiwifs/commit/9d2be25066aa99c8333d2f3c32fb7b0dfff58796))
* **ui:** render and edit Excalidraw markdown drawings ([ff3120c](https://github.com/kiwifs/kiwifs/commit/ff3120ca5797a560a847be6d7dad960f61237bcc))
* **ui:** render and edit Excalidraw markdown drawings ([9e36dbe](https://github.com/kiwifs/kiwifs/commit/9e36dbed0fed44bd0a4650f636d72552d9c97764))


### Bug Fixes

* **ui:** fix story rendering and add dark mode toggle ([e324a5c](https://github.com/kiwifs/kiwifs/commit/e324a5cdcb2a0d7c22a64ba1037c3c76394e1460))
