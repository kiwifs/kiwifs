# Changelog

## [0.17.4](https://github.com/kiwifs/kiwifs/compare/v0.17.3...v0.17.4) (2026-05-18)


### Features

* Airbyte protocol importer, import API, and kanban Storybook stories ([1643f54](https://github.com/kiwifs/kiwifs/commit/1643f54de37c435d692a99f254225e94beff23eb))
* per-page publish with public reader view ([9ba2a59](https://github.com/kiwifs/kiwifs/commit/9ba2a590b35a8b0c4ceaad1cf67ec98a1e4092b9))
* **ui:** add 3D knowledge graph view ([94ab1aa](https://github.com/kiwifs/kiwifs/commit/94ab1aa9c1d5b2f62bf3460d0f34b00ba1acff57))
* **ui:** add glow effects to 2D and 3D knowledge graph ([2e5907f](https://github.com/kiwifs/kiwifs/commit/2e5907f89798390af38b466ceccc9b2a9aca9755))
* **ui:** add JSON/CSV/SQLite to import wizard and use SourceIcon SVGs ([5d36ee1](https://github.com/kiwifs/kiwifs/commit/5d36ee19af6d4589680afe7d685d1466c19bf195))
* **ui:** dynamic Airbyte spec and stream discovery in import wizard ([0d5d27f](https://github.com/kiwifs/kiwifs/commit/0d5d27f2ecbdb91f8d5021b476ae3d52d75b1eb7))


### Bug Fixes

* address kanban refactor review feedback ([99a0b63](https://github.com/kiwifs/kiwifs/commit/99a0b635d8c9bf121c18e11e4aeb0be858db4b9e))
* correct workflow transitions type in kanban stories ([6a273da](https://github.com/kiwifs/kiwifs/commit/6a273dae2745bc818428e30f1b3e67785431e651))
* normalize Unicode MCP paths ([7298ee3](https://github.com/kiwifs/kiwifs/commit/7298ee3ec205544b8d177d2e9d58f001630209fe))
* support CJK paths in MCP tools ([fd75675](https://github.com/kiwifs/kiwifs/commit/fd756755fce795472ae3d66e4a607f4a896e2383))
* **ui:** make 3d graph links visible ([474d9dc](https://github.com/kiwifs/kiwifs/commit/474d9dc788ae707477d3de41280ac66ec13257ab))
* **ui:** stabilize force graph hover updates ([a07ad78](https://github.com/kiwifs/kiwifs/commit/a07ad78ca862fba8012abf5d4fd082126433b36a))

## [0.17.3](https://github.com/kiwifs/kiwifs/compare/v0.17.2...v0.17.3) (2026-05-17)


### Features

* **ui:** add kiwi-app, kiwi-diff, kiwi-kanban blocks and fix playground YAML export ([#86](https://github.com/kiwifs/kiwifs/issues/86)) ([cd7d545](https://github.com/kiwifs/kiwifs/commit/cd7d5453d685aef5f4b72991930410959f47b7f5))

## [0.17.2](https://github.com/kiwifs/kiwifs/compare/v0.17.1...v0.17.2) (2026-05-17)


### Features

* **ui:** add rich markdown widgets — chart, tabs, columns, color, progress, playground ([#85](https://github.com/kiwifs/kiwifs/issues/85)) ([9b9ac02](https://github.com/kiwifs/kiwifs/commit/9b9ac02df925f2a5daed2d9b4d26f73a45b7a04d))
* workflow API, kanban UI overhaul, and multi-space fix ([961887a](https://github.com/kiwifs/kiwifs/commit/961887a64648f22542dcacc53bb3dc1a4c147354))
* workflow API, kanban UI overhaul, and multi-space fix ([0f00b51](https://github.com/kiwifs/kiwifs/commit/0f00b51686f9a2df49a5e0c155293514c7cca69c))


### Bug Fixes

* **markdown:** preserve unicode heading slugs ([19dcd45](https://github.com/kiwifs/kiwifs/commit/19dcd45ae86facd2a02799b3114984a44f2d1110))
* **markdown:** preserve unicode heading slugs ([0d740a5](https://github.com/kiwifs/kiwifs/commit/0d740a5f4440365bb0ee6e2b09db199e8281ae9e))
* persist dynamically created spaces across restarts ([4d33354](https://github.com/kiwifs/kiwifs/commit/4d33354601251c943e6fb0ec8153abb48526e765))
* persist dynamically created spaces across restarts ([d9d741e](https://github.com/kiwifs/kiwifs/commit/d9d741e4eae02010bc4807060da7399b703d581e))
* **ui:** preserve frontmatter in WYSIWYG editor ([8c28cce](https://github.com/kiwifs/kiwifs/commit/8c28cce890da9c20cb06ebf42f0d0d53170d3950))
* **ui:** preserve frontmatter in WYSIWYG editor ([0400d78](https://github.com/kiwifs/kiwifs/commit/0400d786a513694850491c128e965f6c42dd8b6e))
* YAML frontmatter editor data corruption bugs ([572748b](https://github.com/kiwifs/kiwifs/commit/572748b6232d2ead8ecdab16082e7717131731db))

## [0.17.1](https://github.com/kiwifs/kiwifs/compare/v0.17.0...v0.17.1) (2026-05-15)


### Features

* **cli:** connect, login, and update commands ([12b181e](https://github.com/kiwifs/kiwifs/commit/12b181e5745ddfd9de6205a8737d2afc707a3811))
* create and manage kanban boards ([9754d25](https://github.com/kiwifs/kiwifs/commit/9754d259ac13a87823af8d103d829ffec6ce9288))
* **kanban:** create cards from board ([7d39595](https://github.com/kiwifs/kiwifs/commit/7d39595dccdcf38f8820ce0b9a57a119adc77f1e))
* **ui:** create kanban workflow boards ([2c534c4](https://github.com/kiwifs/kiwifs/commit/2c534c431263aa52351b2a6e1b75de0d300dec50))
* **ui:** delete kanban workflow boards ([6e719d0](https://github.com/kiwifs/kiwifs/commit/6e719d05de4d391c6a66d867cebd09bfbcad8fdc))
* **ui:** edit kanban workflow columns ([896db34](https://github.com/kiwifs/kiwifs/commit/896db3469e4180b61872c2a778383123953b7612))


### Bug Fixes

* resolve TS2339 in workflow board type ([54d0fce](https://github.com/kiwifs/kiwifs/commit/54d0fcefcc563dbd8cd04ec05fbd1a0a2bd5aa6e))
* **ui:** adapt getWorkflowBoard to workflow+board API shape ([bcef178](https://github.com/kiwifs/kiwifs/commit/bcef178dfccaf721016fba03d112adebc3eeab68))

## [0.17.0](https://github.com/kiwifs/kiwifs/compare/v0.16.0...v0.17.0) (2026-05-14)


### Features

* agent-driven canvas generation with Graphviz auto-layout ([4595b69](https://github.com/kiwifs/kiwifs/commit/4595b695fdd6bd18432629996b4c2fd756997884))

## [0.16.0](https://github.com/kiwifs/kiwifs/compare/v0.15.1...v0.16.0) (2026-05-14)


### Features

* **ui:** reveal current page in tree ([406cbb1](https://github.com/kiwifs/kiwifs/commit/406cbb1bfd5bbb05d8a841856ede5256c3698d29))
* **ui:** reveal current page in tree ([5af338b](https://github.com/kiwifs/kiwifs/commit/5af338b29462650a8504ab6bbfc83efe201f0223))


### Bug Fixes

* **ui:** add rAF cleanup, focus anchors in tree reveal ([124e91a](https://github.com/kiwifs/kiwifs/commit/124e91afa82eacfc85167d3b2901e3a2560a5855))

## [0.15.1](https://github.com/kiwifs/kiwifs/compare/v0.15.0...v0.15.1) (2026-05-13)


### Bug Fixes

* **ui:** parse hex, RGB, and HSL inputs in KiwiThemeEditor ([5da448d](https://github.com/kiwifs/kiwifs/commit/5da448d64139b7ccd6c2fafe3b3ed17285b00e67))

## [0.15.0](https://github.com/kiwifs/kiwifs/compare/v0.14.1...v0.15.0) (2026-05-13)


### Features

* rebase backup branch before push ([bb825ed](https://github.com/kiwifs/kiwifs/commit/bb825ed3309a9f68ec572e6d372393acee258433))
* rebase backup branch before push ([0564cc6](https://github.com/kiwifs/kiwifs/commit/0564cc6ed53bff104c21bd707a5422a8636fef53))
* **ui:** add Mermaid diagram zoom controls ([92b5b8a](https://github.com/kiwifs/kiwifs/commit/92b5b8af181a5de02c17c37f750f25bbecc7db23))
* **ui:** add Mermaid diagram zoom controls ([39badf1](https://github.com/kiwifs/kiwifs/commit/39badf1fcafd7feff11924521836780df95ca360))


### Bug Fixes

* **api:** avoid duplicate Atom XML declaration ([cf0dcbb](https://github.com/kiwifs/kiwifs/commit/cf0dcbb3e4eebbc76840b7910a1884bc6d97cdac))
* **api:** avoid duplicate Atom XML declaration ([dc3349a](https://github.com/kiwifs/kiwifs/commit/dc3349a979b7c042a5165ba33ded05a2da0f4158))

## [0.14.1](https://github.com/kiwifs/kiwifs/compare/v0.14.0...v0.14.1) (2026-05-13)


### Bug Fixes

* canvas routing collision + MCP parity for canvas/views/timeline ([#62](https://github.com/kiwifs/kiwifs/issues/62)) ([788b3a6](https://github.com/kiwifs/kiwifs/commit/788b3a6776200bc293f1b401bef2a1f142a0b3a3))

## [0.14.0](https://github.com/kiwifs/kiwifs/compare/v0.13.0...v0.14.0) (2026-05-12)


### Features

* knowledge features v2 — graph analytics, web clipper, bases, canvas, timeline, kanban ([#61](https://github.com/kiwifs/kiwifs/issues/61)) ([d958d64](https://github.com/kiwifs/kiwifs/commit/d958d649f8a8c58ea338c7d0a6b82e0c3fd76586))


### Bug Fixes

* **ui:** hide SpaceSelector when embedded in cloud shell ([15e7f11](https://github.com/kiwifs/kiwifs/commit/15e7f1195ec5172c1ab4067ac922ac383635cb5c))

## [0.13.0](https://github.com/kiwifs/kiwifs/compare/v0.12.0...v0.13.0) (2026-05-12)


### Features

* **ui:** extend theme hooks and kiwiTheme export; tighten release workflow ([e9ccc0a](https://github.com/kiwifs/kiwifs/commit/e9ccc0aecb932ae2b949a10078971f2308aa7f09))


### Bug Fixes

* **ui:** use double-cast for window-to-Record assertions ([#59](https://github.com/kiwifs/kiwifs/issues/59)) ([4b4b82b](https://github.com/kiwifs/kiwifs/commit/4b4b82b0432b4f51a6dc282f8a40e2573ce15b5c))

## [0.12.0](https://github.com/kiwifs/kiwifs/compare/v0.11.0...v0.12.0) (2026-05-12)


### Features

* **import:** connection browse API, KiwiImportWizard + KiwiData, handler wiring ([f0477ef](https://github.com/kiwifs/kiwifs/commit/f0477effd7dd8aedffcef8ec3ca08db2dd268385))


### Bug Fixes

* **ui:** cast credentials check to boolean for ReactNode compat ([#57](https://github.com/kiwifs/kiwifs/issues/57)) ([0474c41](https://github.com/kiwifs/kiwifs/commit/0474c41e7ee8677a1b261ade647ba9a3f340aa80))

## [0.10.0](https://github.com/kiwifs/kiwifs/compare/v0.9.0...v0.10.0) (2026-05-10)


### Features

* markdown auto-format on write + kiwi_lint MCP tool ([#53](https://github.com/kiwifs/kiwifs/issues/53)) ([ad76ac9](https://github.com/kiwifs/kiwifs/commit/ad76ac980c3e60cbb8b3bd0936b6d3d77fda9719))


### Bug Fixes

* **ui:** array frontmatter parsing; dedupe properties block; print layout ([6ad6dc3](https://github.com/kiwifs/kiwifs/commit/6ad6dc3f65dd22f0026fcb61af5e0a5771855f40))
* **ui:** batch fix theme editor, search, wiki links, graph, and nav bugs ([a3fe400](https://github.com/kiwifs/kiwifs/commit/a3fe400944df7cad6eaef800a415a570ae6fb1db))
* **ui:** batch fix theme editor, search, wiki links, graph, and nav bugs ([c6ad3dd](https://github.com/kiwifs/kiwifs/commit/c6ad3dd1548ea4d15b9d014716021114da1a83bf))
* **ui:** refine KiwiPage, ToC, page actions, and base styles ([096688f](https://github.com/kiwifs/kiwifs/commit/096688fc1f80ba549f0f81592a4d7cbf63c7dab3))
* **ui:** screen-reader title for command palette dialog ([cb9c6d0](https://github.com/kiwifs/kiwifs/commit/cb9c6d0649e45f38f7b36c9be015ba0373f5b1be))
* **ui:** shrink recent-search clear icon in KiwiSearch ([dd372fc](https://github.com/kiwifs/kiwifs/commit/dd372fc468613fe6c47f29afdfc8b140dfb1f21b))
* **ui:** tweak App shell, page actions, and global CSS ([5181591](https://github.com/kiwifs/kiwifs/commit/5181591868072a243ace8123a4a5a66697030a88))

## [0.9.0](https://github.com/kiwifs/kiwifs/compare/v0.8.0...v0.9.0) (2026-05-09)


### Features

* **ui:** comprehensive markdown rendering v2 ([2b6e79a](https://github.com/kiwifs/kiwifs/commit/2b6e79a3b7a5427ecd212c87db7ed343fb8e6645))
* **ui:** comprehensive markdown rendering v2 ([c78aeff](https://github.com/kiwifs/kiwifs/commit/c78aeffa0ccfa245d5c9b3ebef871f3691523637))
* **ui:** ship bundled themes wiki; wire App and useTheme hooks ([a68c47c](https://github.com/kiwifs/kiwifs/commit/a68c47cc0adb1b751b03d093a061941e03537f8b))

## [0.8.0](https://github.com/kiwifs/kiwifs/compare/v0.7.0...v0.8.0) (2026-05-09)


### Features

* **ui:** upgrade Tailwind CSS v3 → v4 ([8dacf29](https://github.com/kiwifs/kiwifs/commit/8dacf29e553759f4afab98d11ae24a924c381acb))


### Bug Fixes

* copy .npmrc in Dockerfile for legacy-peer-deps ([2e9b13b](https://github.com/kiwifs/kiwifs/commit/2e9b13b88327dc66d0cc79acde87487580bbbc87))
* **ui:** responsive layout + fix CI build ([74f500a](https://github.com/kiwifs/kiwifs/commit/74f500ac02de29074e65736107ffa59c324b37e5))

## [0.7.0](https://github.com/kiwifs/kiwifs/compare/v0.6.0...v0.7.0) (2026-05-08)


### Features

* draft spaces — git-backed agent staging with isolated worktrees ([83b046b](https://github.com/kiwifs/kiwifs/commit/83b046bbcc3083d8d8f6e5f1a92db7db296491c4))

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
