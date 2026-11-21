# Compadr reference

This page describes each command of the command line, the console, the MCP server and the files that Compadr reads and writes. The [README](../README.md) gives the installation and the first steps.

The examples run the command line built from a clone of this repository (`node packages/cli/dist/cli.js`). With the package installed from npm, `npx compadr` runs the same commands.

## Drift report

`compadr drift` reads a repository at one git reference, without writing to it, and writes its drift report as JSON. The report follows the schema in [`packages/format/schema/drift-report.schema.json`](../packages/format/schema/drift-report.schema.json).

```bash
yarn build
node packages/cli/dist/cli.js drift ../my-repo --ref main --adr-dir docs/adr --out /tmp/drift.json
```

| Option | Role | Default |
|---|---|---|
| `--ref` | Git reference to analyse | `HEAD` |
| `--adr-dir` | Folder of the decision records | `docs/adr` |
| `--name` | Name shown in the report | Folder name |
| `--out` | File to write, outside the analysed repository | Standard output |

The command exits with 1 when git fails or the folder holds no decision record, and with 2 on a usage error.

## Console

`compadr console` serves the console on the decisions of one or more repositories. It runs `compadr-console`, the program of `@compadr/console`: the console is under the FCL, so the command line never imports it.

```bash
yarn build
node packages/console/dist/server/console.js ../my-repo ../other-repo --ref main
```

The server reads each repository at its reference, without writing to it, and listens on `127.0.0.1:4180` by default. It computes a drift report again only when the commit of the reference changes. It keeps the reports of the last commits in the same folder as `compadr mcp` (`--cache-dir`, `--no-cache`), so a new server or a new MCP server answers at once on a commit already analysed. The server answers only requests addressed to `localhost`, to an IP address or to the `--host` name, so that a page of another site cannot read the decisions through a domain name of its own. The API also refuses a request that the browser names as coming from another site, and its answers are never kept in a cache.

With `--host` on an address other than this machine, the console creates a random token at start and prints its address with the token (`http://<host>:<port>/?token=…`). The first visit keeps the token in a cookie of the site, and every request without it gets 401. The console warns at start in that case.

`GET /api/reviews` lists the branches that propose decisions: each local or remote-tracking branch that adds or changes a record with the status "proposed", compared with the commit where it leaves the followed reference. With the GitHub CLI (`gh`), each branch carries its open pull request. The report of a branch is served on the report routes, and is computed when the console first asks for it.

The Reviews view lists those proposed decisions. The review of one shows its feature and the decision it would be a detail of, then the decisions it may overlap: a relation it declares, a file that both records cite, or a term between backticks that both use. A term that more than six decisions use is left out. The review asks the three questions that justify a record (hard to reverse, surprising, the result of a trade-off). When none holds, it proposes a code note instead. The decision itself is taken on the pull request: the view gives the `gh` commands to accept, request changes or reject with a reason, and never runs them.

| Option | Role | Default |
|---|---|---|
| `--ref` | Git reference to follow | `HEAD` |
| `--adr-dir` | Folder of the decision records | `docs/adr` |
| `--port`, `--host` | Address to listen on; another address than this machine asks for the token of the printed address | `4180`, `127.0.0.1` |
| `--cache-dir` | Folder of the reports on disk, outside the repositories | `$XDG_CACHE_HOME/compadr` or `~/.cache/compadr` |
| `--no-cache` | Keep the reports in memory only | |
| `--no-github` | Do not ask `gh` for the pull requests of the branches under review | |
| `--draft` | Name of the local draft that the actions of correction fill | `console` |
| `--no-draft` | Give the commands of the corrections instead of filling a draft | |

The actions of correction of the pages add their commit to a local draft of each repository, as `--draft` does on the command line (see [Drafts](#drafts)). "Mark as checked" on the page of a decision and the anchor proposed for a link each have an "Add to the draft" button. The Draft view lists the commits of the draft and gives the command that publishes it as one pull request, `compadr draft publish`: the console never publishes. The report of the draft joins the list of reports, next to the report of the followed reference, so that the console shows the signals that the draft resolves. The drafts stay in the cache folder, even with `--no-cache`.

The server writes only in its clone of the drafts, never in the repositories, and nothing leaves the machine. A request that writes (`POST /api/drafts/<id>/checks` or `/anchors`) must carry the JSON type and the origin of the console: a page of another site cannot fill a draft. With `--host` on an address that other machines reach, a request also needs the token of the console: a program on the network without it cannot read the reports or fill the drafts. With `--no-draft`, the routes of the drafts answer 404 and the pages give the commands of the command line, as before.

The console reads its reports on `GET /api/reports` (the list) and `GET /api/reports/<id>`. For development, the Vite server serves the same routes from a folder of saved reports:

```bash
COMPADR_REPORTS_DIR=/tmp/reports yarn workspace @compadr/console dev
```

## Check in CI

`compadr check` reads a repository at one git reference, without writing to it, and exits with 1 when its decisions have a certain problem. Probable drift never fails the check: it goes to the review queue of the console.

| Problem | Rule |
|---|---|
| A broken drift signal: cited path or anchored symbol gone, line beyond the end of the file, superseded or unknown decision cited, status that differs from the index | Signal type |
| A status that Compadr cannot read | `status-unknown` |
| A superseded decision that names no successor | `superseded-without-successor` |
| A successor that the ADR folder does not hold | `successor-missing` |
| A decision outside every feature, when the repository declares features | `decision-without-feature` |
| A feature declaration that the engine leaves out | `feature-declaration` |
| A decision in force without `compadr.rule`, under the policy `required` | `rule-missing` |
| A setting of `compadr.yml` that cannot be read | `config-invalid` |

The check also prints notices, which never fail it: a decision in force without a rule that stands alone (`rule-missing`, under the policy `preferred`), a declared rule too short to stand alone (`rule-weak`), a record of more than 400 lines (`record-too-long`), a Decision section of more than 12 000 characters (`decision-text-too-long`), validated rules in force whose chain changed (`consolidated-rule-stale`), and a proposed decision that files of the code already cite (`proposed-applied`). A person may have forgotten to accept such a decision: the console lists them under "Proposed but applied" on the Decisions page. The notices on length show whatever the rule policy. With `--base`, only the new notices appear. Each notice line says `warning`, and `--format github` writes the notices as warning annotations.

With `--base`, only the problems that the base reference does not have fail the check. A pull request then fails on what it adds, and not on the history it starts from. The comparison leaves line numbers out, so a line added above a reference does not make its problem new.

```yaml
- uses: actions/checkout@<sha> # fetch-depth: 0 gives the base reference
  with:
    fetch-depth: 0
- run: npx compadr check . --base origin/${{ github.base_ref }} --format github
```

`--format github` writes each problem as an annotation on the file and line of the pull request. The command exits with 2 on a usage error.

With `--diff`, the command checks a change before it is committed. It reads a unified diff against `--ref`, from a file or from the standard input, and fails when the change removes or moves a path that a decision cites, or cites a superseded or unknown decision. Cited lines that the change modifies appear as blocks to review and do not fail the check. The problems that the repository already has do not count.

```bash
git diff HEAD | npx compadr check . --diff -
```

An empty diff checks nothing, and the command says so. A diff in which the command reads no file stops it with exit 2, so that a failed `git diff` does not pass as a clean change.

## Generated files

`compadr index` writes `INDEX.md` in the ADR folder: the decisions in force, by feature, with the main decision first. `compadr map` writes `MAP.md` in the ADR folder: the memory card that a coding agent reads once per session. `compadr agents` writes an excerpt in `AGENTS.md`, or in `CLAUDE.md` when only that file exists (`--file` names another). The excerpt tells coding agents where the decisions are, to read the memory card once per session, how to read the decisions of a file, and which decision leads each feature. It sits between `<!-- compadr:start -->` and `<!-- compadr:end -->`, and a new run replaces it.

The memory card gives the features with their main decision and its rule (120 characters at most), the zones of the code with three linked files or more, their coverage and their decisions, and the titles of the other decisions in force. It lists the decisions of a zone by number and leaves out dates, signals and weights, so that it changes with the records and the links rather than with each commit. The MCP tool `memory` gives the same card without the file.

The files follow the language of the records (English or French). The commands write on a new branch of a temporary clone, like `compadr anchor`, with the same options (`--push`, `--open-pr`, `--branch`, `--title`, `--body`).

`compadr check` fails with `generated-file-stale` when an index or a memory card that starts with the marker of its command, or an excerpt between the markers, no longer matches the records.

## Anchored references

A decision record that cites `services/billing.ts:116` breaks as soon as the line moves. An anchored reference names the symbol that holds the code instead. The record keeps a fingerprint of that symbol in its frontmatter:

```markdown
---
compadr:
  anchors:
    "services/billing.ts#BillingService.charge":
      fingerprint: sha256:3f2a9c0b7d1e4a65
---

The retry loop lives in `services/billing.ts#BillingService.charge`.
```

The fingerprint is computed in three steps:

1. Each run of white space in the symbol text becomes one space, and the ends are trimmed.
2. The engine computes the SHA-256 of that text.
3. The fingerprint is `sha256:` followed by the first 16 hexadecimal digits of the hash.

A symbol is an ASCII identifier, or several joined by dots (`BillingService.charge`). Private class members (`#field`) and non-ASCII names cannot be anchored.

An optional `lines` entry (`{ count, fingerprint }`) tracks the cited lines inside a large symbol. `count` is the number of consecutive lines. `fingerprint` is the fingerprint of those lines joined by line breaks. The engine looks for them anywhere in the symbol.

The drift report gives each anchor problem a level:

| Problem | Level |
|---|---|
| The symbol no longer exists | Broken |
| Several symbols bear the name | To review |
| The symbol changed since its fingerprint | To review |
| The tracked lines are no longer in the symbol | To review |
| The engine cannot check the anchor | Info |

For each reference that cites a line, the drift report proposes an anchor in its `proposal` field. The engine finds the innermost declaration that held the first cited line when the record cited it. That declaration must exist once at the analysed commit, where the engine computes its fingerprint. The proposal also tracks the cited lines when they are found unchanged, and once, in the symbol.

The engine finds that commit with `git blame` on the record. It is the last commit that changed the line of the reference: when the line was reworded after the citation, the cited line numbers may point elsewhere at that commit.

The engine reads the declarations of TypeScript, TSX and JavaScript files with tree-sitter. A getter and a setter of the same property form one symbol. A static member that shares the name of an instance member is named `Class.static.member`.

## Anchoring references on a branch

`compadr anchor` replaces references that cite line numbers by the anchors that the drift report proposes:

```bash
node packages/cli/dist/cli.js anchor ../my-repo --ref origin/main --reference 0037:services/billing.ts:116:1
```

A reference is named by its decision, the text it cites and the rank of that citation in the record. The identifier stays the same when other lines of the record change.

The command works in a temporary clone of the repository and never writes to its working copy. It proceeds in four steps:

1. It computes the drift report at `--ref` and reads the proposal of each `--reference`.
2. It rewrites the records: each reference becomes `path#Symbol`, and its fingerprint goes into `compadr.anchors`.
3. It commits the change on a new branch of the clone and prints the commit.
4. With `--push`, it pushes the branch to the `origin` remote. With `--open-pr`, it also opens a pull request with `gh`.

Without `--push` or `--open-pr`, nothing leaves the temporary clone, which is then removed. `--with-lines` also tracks the cited lines, when the proposal found them. The command never forces a push.

The commit takes the `user.name` and `user.email` of the analysed repository, so that its own git rules apply. The pull request targets `--base`, or the branch of `--ref`: the current branch for `HEAD`, `main` for `origin/main`. A tag or a commit names no branch, so the command then asks for `--base` before it pushes anything.

The console lists these proposals in its Links to repair view, and in the detail of each reference signal. It shows the entry that the record receives and the `compadr anchor` command that opens the pull request. For a symbol of more than 40 lines, it offers to track the cited lines as well.

## Checked references

A signal of a cited line or file starts from the date the line of the record was written. When a person checks that the reference still holds, the record keeps the date of the commit they checked, and the signals of that reference start from it instead. A later change of the code raises the signal again.

```markdown
---
compadr:
  checked:
    "services/billing.ts:116": 2026-11-04T09:12:00Z
    "services/billing.ts:140":
      at: 2026-11-04T09:12:00Z
      by: Ana Martin
---
```

The key is the reference as the record cites it. The value is a UTC date and time, or a map of that date (`at`) and the person who checked (`by`). An entry without such a date is left out. `compadr mark-checked <repository> --reference <id>` writes the entries for the references named by their identifier in the report, with the date of the commit at `--ref`, on a new branch like `compadr anchor` (`--push`, `--open-pr`). It names the person given by `--by`, or else the `user.name` of the git configuration of the repository. The report gives this date as `checkedAt` on the reference, and gives each decision the last commits of its record (`history`).

## Records that agents read

A coding agent reads the memory card once, the decisions of the files it changes, and then the records that matter, by their outline first. A record serves it best in this form:

- **One rule, declared.** `compadr.rule` says in one sentence what the decision requires. The agent reads it in every answer and decides from it whether to open the record.
- **One rule per subsection.** Each `###` subsection of the Decision section holds one rule, with a heading that states it ("Every AI call goes through the provider port") rather than a topic ("Providers"). `get_decision` with `sections` then gives the agent the rule it needs and nothing else.
- **The code it applies to, between backticks.** A path, a path with lines, `path#Symbol`, or a symbol that one file declares. Each citation links the decision to a file, so that `decisions_for_file` finds it. A symbol or an anchor ages better than a line number.
- **Short.** The Decision section stays under 12 000 characters, about 3 400 tokens, and the record under 400 lines. An inventory of files and lines, an audit or a plan of pull requests belongs elsewhere: in the pull requests, a note of the code, or a document that the record cites.
- **One feature.** `compadr.feature` names it, and `compadr.parent` the main decision that a detail decision completes. A decision that covers several features is better split.
- **Superseded, not edited.** A change of principle is a new record that supersedes the old one. A clarification is a detail decision with a parent.

`compadr check` checks two points of this form only: the length of the record and of its Decision section, and the declared rule (under the policy `preferred`). It gives a notice, never a failure. The other points are advice. `propose_decision` drafts the Decision section in this form.

## Rule of a decision

The rule of a decision says what it requires, in one sentence. An agent reads the rules before it opens the records, so that it opens only the ones that concern its change.

```markdown
---
compadr:
  rule: Every AI call goes through the provider port, never through an SDK.
---
```

A record declares its rule in `compadr.rule`. Without it, the rule is the first sentence of the Decision section, when that sentence can stand alone. A sentence shorter than 30 characters, one that ends with a colon, or one about the record itself ("This ADR replaces…") cannot. A sentence that opens a list ("Four pieces: storage, …") keeps the part before the colon. A decision whose subsections are a list of topics then has no rule: the headings of its subsections tell where to read instead. The report gives each decision its `rule`, with its source (`declared` or `first-sentence`), or null.

The team chooses how much the rules count in `compadr.yml`, in the folder of the records:

```yaml
rules:
  policy: preferred # derived, preferred or required
```

| Policy | `compadr check` |
|---|---|
| `derived` | Says nothing: the first sentence is enough. |
| `preferred` (default) | Gives a notice for each decision in force without a rule that stands alone. The check does not fail. |
| `required` | Fails on each decision in force without `compadr.rule`. With `--base`, only the records that a pull request adds or changes count. |

The file is optional. A setting that cannot be read keeps its default and fails the check (`config-invalid`), and the report lists it in `configProblems`.

## Who decided and who checked

The report names people with the source of each name:

- `checkedBy` on a checked reference: the `by` of its entry (`declared`), or else the author of the commit that wrote the entry, read with `git blame` (`commit`). `git blame` gives the last commit that changed the line: a later edit of the entry, such as a new indentation, moves the attribution to its author. `mark-checked` always writes `by` for that reason.
- `attribution` on a decision: the deciders that the record names (`declared`), or else the author of the commit that added the record (`commit`). Compadr reads `decision-makers` in the frontmatter (MADR), and a `Deciders:` line of the header (MADR 2, Log4brains). It separates the names on commas and semicolons only, since "and" can belong to the name of a team. adr-tools records name no one.
- `author` on each commit of `history`.

A name read in git also gives its `commit`. The console server goes one step further with the GitHub CLI (`gh`). When that commit came through a merged pull request, the server replaces the commit author with the people who approved the pull request, or else with the person who merged it (`pull-request`). The attribution then carries the number, title and link of the pull request, and the role of the people (`approved` or `merged`). The names are GitHub logins. A declared name always comes first. Without `gh`, without a GitHub remote or with `--no-github`, the console keeps the commit author. The engine, the CLI and the MCP server never call `gh`: their reports keep the `commit` source.

In the console, the page of a decision lets you tick the links to review or to reorder that you checked, and gives the `compadr mark-checked` command that records them on a pull request. The page names who decided, with a link to the pull request when the names come from one, and its History tab lists the commits of the record with their author and the checks of its references with the person who checked, the most recent first.

## Features

A feature groups a main decision and the detail decisions that refine it. Each record declares its feature in its frontmatter, and a detail decision names the main decision of its feature:

```markdown
---
compadr:
  feature: billing
  parent: 3
---
```

The glossary of the repository, `features.yml` in the ADR folder, gives each feature its label and its main decision:

```yaml
billing:
  label: Billing and invoices
  main: 3
```

A feature identifier is made of lowercase ASCII words joined by hyphens. The glossary may name features that no record declares yet.

The drift report lists the features in its `features` field. When a record or the glossary declares a feature, the report holds the declared features (`source: declared`). Otherwise the engine proposes a first grouping (`source: proposed`):

1. Two decisions are linked by their relations (an amendment, a replacement, a declared link), and by the code files that both cite. The files of a decision are those that its record cites, outside the ADR folder, and the code files that cite it. A file that more than a tenth of the decisions cite says little and is left out. Two decisions whose files overlap by less than a tenth (Jaccard index) are not linked by their files.
2. The engine groups the linked decisions with the Louvain method, which gathers the decisions more linked to each other than to the rest.
3. The main decision of a group is the one that the most decisions of the group change, then the most linked one, then the oldest one.

A decision linked to no other stays out of the features. The proposal is a starting point: edit it as a plan, as the next section explains.

The console shows the features in its Feature map view. Each card counts the details of a feature and shows the drift state of each decision. A card opens the page of the feature. The page reads the rules in force in order: the main decision first, then its details in number order. Each decision shows its relations, the rules it replaces, and the subsections of its `Decision` section. It also names the newer decisions of other features that change it, so that a chain of amendments stays complete from its main decision. A rule that a later decision replaces is struck through where the engine found it, followed by the number of that decision. The console renders the Markdown of the records as text: it runs no HTML and opens no link of a record.

`featureProblems` lists the declarations that the engine left out, with the reason: an invalid identifier, a glossary entry that is not a map, or a main decision that the folder does not hold.

The drift report also carries what a feature page needs to show the rules in force:

- `text.relations` holds the header items of a record that link it to older decisions (“Amends ADR 0003”).
- `text.sections` holds the subsections of its `Decision` section, in order.
- `replacedRules` lists the rules of older decisions that a record quotes as replaced, as in “Replaces its rule « a refund always covers the whole invoice »”. A quote of fewer than four words names a term, not a rule, and is left out.

The engine looks for each quoted rule in the decisions named before the quote. The search ignores case, emphasis, punctuation and text in parentheses. An ellipsis (`[…]`) splits a quote into parts that must appear in order. A rule found once gets its `target` decision. When the rule sits in the `Decision` section of the target, its `location` gives the section and the offsets.

## Writing features on a branch

`compadr features` writes the features of a repository as a YAML plan. The plan holds the declared features, or the grouping that the engine proposes when the repository declares none. The title of each decision follows its number as a comment.

```bash
node packages/cli/dist/cli.js features ../my-repo --ref origin/main --out /tmp/features.yml
```

Edit the identifiers, labels, main decisions and details of the plan, then write it on a branch:

```bash
node packages/cli/dist/cli.js features ../my-repo --ref origin/main --plan /tmp/features.yml --open-pr
```

The command checks the plan before it writes anything. It lists every problem: an invalid identifier, a decision missing from the folder, a decision in two features, or a feature without a main decision. Each record of a feature then receives `compadr.feature`, and each detail decision receives `compadr.parent`. `features.yml` receives the labels and the main decisions. A record left out of the plan does not change.

The branch, the push and the pull request follow the rules of `compadr anchor`. Both commands accept `--body` to replace the generated body of the commit and the pull request.

## Drafts

A draft gathers several corrections of the decision records before a single pull request. Each correction command adds its commit to a draft with `--draft <name>`: `index`, `agents`, `anchor`, `mark-checked` and `features --plan`.

```bash
node packages/cli/dist/cli.js mark-checked ../my-repo --reference 0023:src/pool.ts:1 --draft review
node packages/cli/dist/cli.js index ../my-repo --draft review
node packages/cli/dist/cli.js draft show ../my-repo review
node packages/cli/dist/cli.js draft publish ../my-repo review --open-pr
```

The first command creates the draft at `--ref`. The next ones read the records at the tip of the draft, so that each correction sees the previous ones, and refuse `--ref`. `mark-checked` dates the checks with the commit the draft starts from, since the commits of a draft change records only.

A draft is a branch of a clone that Compadr keeps in its cache folder (`$XDG_CACHE_HOME/compadr/drafts`, or `~/.cache/compadr/drafts`, or `--cache-dir`), one clone per repository. The working copy of the analysed repository is never written, and nothing leaves the machine before `compadr draft publish`.

- `compadr draft list <repository>` lists the drafts, with their number of commits and their starting commit.
- `compadr draft show <repository> <name>` lists the commits and the changed files of a draft. It also compares the drift reports of its start and of its tip, and lists the signals that the draft resolves (`-`) or adds (`+`).
- `compadr draft publish <repository> <name>` pushes the draft to the `origin` remote on `compadr/<name>` (or `--branch`). With `--open-pr`, it also opens one pull request with `gh`, on the branch of the `--ref` that created the draft (or `--base`). The push is never forced. The draft stays after its publication: a new commit added to it and published again goes to the same branch.
- `compadr draft discard <repository> <name>` deletes the draft.

`compadr drift <repository> --draft <name>` writes the drift report of the tip of a draft.

## Decisions of a file

`compadr decisions` lists the decisions that apply to a file of a repository:

```bash
node packages/cli/dist/cli.js decisions ../my-repo src/billing/charge.ts --ref origin/main
```

A decision applies to a file when its record cites the file or one of its folders, when its record cites a symbol that the file alone declares, or when the file cites the decision. The answer keeps the source of each link.

A record cites a symbol by its name between backticks: `chargeCustomer`, `InvoiceLine`, `RETRY_LIMIT`. The engine looks for its declaration at the start of a line of code (`function`, `class`, `interface`, `type`, `enum`, `const`, `let`, `var`, a Prisma `model`, `def`, `func`, `fn`, `struct`, `trait`, with `export`, `default`, `async` and the like before them). It leaves out indented lines, where a local variable often bears the name of a field, documents, third-party code and generated code (`*.graphql`, `gql/`, `generated/`, `__generated__/`, `*.generated.*`). The report gives the declarations of each symbol reference in `declaredIn`. A symbol declared in one file links the decision to that file (`record-cites-symbol`, weight 2, `read: "lines"`). A name declared in several files is ambiguous and links none. The search is one `git grep` that runs with the other searches of the report.

- **In force.** These are the accepted decisions. A superseded decision leads to the decisions that replace it, with its links.
- **Context, not binding.** These are the proposed decisions, and those whose status is unknown.
- **No longer in force.** These are the rejected and deprecated decisions, and the superseded ones without a known successor.

In each group, the decisions linked to the file itself come before those that reach it through a cited folder only. Then come the decisions linked in both directions, then those with the most links.

`--json` writes the answer as JSON. The command reads a path of the repository, or an absolute path inside its working copy, and exits with 1 when the path is not in the repository at `--ref`. The format package exports the same answer as `decisionsForFile`.

The console shows the same answer in its Files view. The view lists the paths that a record or a citation links to a decision, with a search. A path opens the decisions of the file, and a decision opens its page in the Decisions view. That page shows the status, the feature and the relations of the decision, then three parts:

- the code links of the record, each with the date of its citation and its drift state;
- the files that cite the decision;
- the text of its `Decision` section, where a rule that a later decision replaces is struck through.

## Coverage of the code

`compadr coverage` shows the zones of the code and how much the decisions in force reach them. It tells a team where the decisions cover the code most and least. Covering everything is not the aim: a zone without decision is information, and the command always exits with 0.

```bash
node packages/cli/dist/cli.js coverage ../my-repo --ref origin/main
```

A zone is a folder of code files; Markdown and text files do not count. It starts at the second folder of the path that is not generic (`src`, `lib`, `app` and `packages` are), as `codeArea` names it. When two subfolders or more of that folder hold linked files, each subfolder becomes a zone, and the files directly in the folder form a zone of their own (`own`).

A file is linked when the record of a decision in force cites it, or when it cites the decision. The weight of a link is the weight of `decisions_for_file`. A folder that a record cites marks the zone that holds its files (`folderCited`), without linking each file: a folder cited above the zones says nothing about them in particular.

| Coverage | Zone |
|---|---|
| `strong` | Half of its files are linked or more, and one of them is linked both ways |
| `partial` | 15 % of its files are linked or more |
| `thin` | Fewer files are linked |
| `folder-only` | Only a cited folder reaches it |
| `none` | No decision in force reaches it |

The report gives the zones in `zones`, by path, with their files, linked files, files linked both ways, weight and decisions. The decisions of a zone come the heaviest first. `--json` writes the zones.

The Coverage view of the console lists the zones under decisions, then those without, the largest first. A zone opens its decisions, the heaviest first, and its linked files; a file opens its decisions in the Files view. A report computed before the zones existed says so.

## MCP server for coding agents

`compadr mcp` serves the decisions of a repository to coding agents, as a local MCP server on the standard input and output. For Claude Code:

```bash
claude mcp add compadr -- node /path/to/compadr/packages/cli/dist/cli.js mcp /path/to/repository
```

| Tool | Answer |
|---|---|
| `memory` | The memory card of `compadr map`, in Markdown: features, zones of the code under decisions, decisions in force |
| `decisions_for_file` | The decisions that apply to a file: in force, context, out of force. Each decision in force gives its rule, a weight and what to read next. `detail: "full"` gives every link, as `compadr decisions` does |
| `check_change_against_decisions` | For a unified diff against the commit of the server: the decisions in force that the changed files fall under, with their rule, and the signals that the change raises (a cited path removed or renamed, cited lines modified, a superseded or unknown decision cited in the added code) |
| `decisions_for_symbol` | For a symbol that a record cites: the decisions whose record cites it, with their rule, the files that declare it, and the decisions in force of its file when one file alone declares it |
| `get_decision` | The status, feature, relations, rule, outline and decision text of a record, the rules it replaces, its code links with their drift, and the files that cite it |
| `search_decisions` | A full-text search over the titles, relations and decision texts, with an optional status |
| `propose_decision` | A draft record with the status `proposed`, written like the latest record of the repository, with its rule in `compadr.rule`. With `"assist": true` and a diff, the assist service drafts it |

The answers are compact, because an agent pays for every token it reads. They are JSON without indentation.

- **`decisions_for_file`** gives, for each decision in force, its number, title, rule (100 characters at most), `weight` and `read`. The weight adds up the links between the decision and the file: the record cites the file (1), lines of it (2) or an anchored symbol (3), and the file cites the record (2). Both directions together add 2. A broken reference counts nothing, one to review counts half, and a cited folder counts nothing. `read` says what to do next: `rule` when the rule says enough, `lines` when the record cites lines or a symbol of the file and the link is not broken, `record` when the record and the file cite each other or the record cites the file three times or more. An agent opens a record only for `lines` or `record`.
- **`get_decision`** groups the code links by cited path, with their count, whether they name lines and their worst drift, and lists the cited symbols by name. It counts the files that cite the record. `sections: "none"` gives the rule and the outline of the Decision section without its text, and `sections: [2, 7]` gives the subsections of those indexes in the outline only. The text before the first subsection, when there is one, has index 1 and no heading. Both leave the code links out unless `codeLinks` asks for them. `codeLinks: "full"` and `citedBy: "lines"` give the answer of earlier versions.

The server only reads. `check_change_against_decisions` reads the diff that the agent passes and does not run `git diff` itself. With `"semantic": true`, it also sends the change to the assist service, under the settings of the [semantic check](#semantic-check). Its line signals hold when the diff starts from the commit that every answer gives. `propose_decision` returns a path and a content: the agent writes the record in its own branch and opens a pull request. With `"assist": true` and the diff of the change, the assist service writes the title, the rule, the sections and the relations of the record, under the same settings as the semantic check: nothing is sent unless `compadr.yml` sets `assist.semantic`, and the files that `assist.exclude` names never leave. The agent passes only `feature` and `parent` then. The answer names the model and what the guard says of the draft, or gives `notNeeded` without a record when the change only applies a decision in force. An agent proposes a decision; a person accepts it.

The server computes the drift report when it starts, so the first call of an agent does not wait for it. Each call reads the commit of `--ref` and computes the report again only when that commit changed, so it answers at once while the code does not move.

The server keeps the reports of the last five commits of each repository on disk, in `$XDG_CACHE_HOME/compadr` or `~/.cache/compadr`. A new server reads the report of a commit already analysed instead of computing it again. `--cache-dir <dir>` chooses another folder outside the repository, and `--no-cache` keeps the reports in memory only.

The server uses the official MCP SDK (`@modelcontextprotocol/sdk`). The command line bundles its server and stdio modules only.

## Assist contract

An assist service can review a change, consolidate a chain of amendments, write a record in plain language, draft a record, or recommend what to do with a proposed decision that the code cites. The service is not part of this repository. This section describes the contract between Compadr and the service, and the command that sends a request.

- `@compadr/format` defines a request and a suggestion for each of the five kinds. The JSON Schemas are in [`packages/format/schema/assist-request.schema.json`](../packages/format/schema/assist-request.schema.json) and [`packages/format/schema/assist-suggestion.schema.json`](../packages/format/schema/assist-suggestion.schema.json). The status of a suggestion is always `suggested`: a person decides.
- `@compadr/engine` builds each request from the drift report, without any model. A check request holds the memory card, the signals of the change, and at most 8 decisions in force that the changed files fall under. The decisions that a signal names come first, then those with the heaviest links to the changed files. Each Decision section is cut at 12 000 characters.
- The diff of a request leaves out documentation, translation catalogues, lock files, generated code (`gql/`, `generated/`, `__generated__/`, `*.generated.*`) and the content of deleted files. A GraphQL schema stays. The diff stays under 150 000 characters, and a file that does not fit is named in `omittedFiles`.
- Files that hold secrets by their nature never leave: `.env` and its variants (but not `.env.example`, `.env.sample` or `.env.template`), keys and certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`), `*.tfvars`, `*.tfstate`, SSH keys, `.npmrc`, `.netrc` and `credentials.json`.
- `@compadr/engine` masks the secrets of every text it sends: the diff, the decisions, the records, the memory card and the excerpts of code. A token with the prefix of its provider, a private key, the password of a URL and a literal assigned to a name such as `password` or `apiKey` become `[masked:<type>]`. The name is read word by word, so `authToken` and `DB_PASSWORD` are masked, and `tokenizer` is not. A value without quotes, as in a shell script or a YAML file, is not masked: such files are better listed in `assist.exclude`. The name of the variable and the line stay, so the model still sees that a secret is written in the code. The masking is deterministic, so the guard checks the quotes against the masked text. The patterns carry a version (`SECRET_MASK_VERSION`).
- A consolidate request holds the whole records of the amendment chain: the decision, the older ones it amends and the newer ones that amend it. The nearest records come first and, at the same distance, those that replace a rule. At most 8 records and 120 000 characters are sent, and the others are named in `omittedRecords`.
- An accept request holds a proposed decision and the lines of the code around each of its citations: 10 lines before and 30 after. The files that cite it most come first. At most 12 files and 60 000 characters are sent, and the others are named in `omittedFiles`. Documentation, lock files, generated code and the paths of `assist.exclude` in `compadr.yml` never leave.
- `verifySuggestion` checks a suggestion against its request and the report, without any model. Every decision must exist and be in force, every quote must appear word for word in the text that was sent, in parts of at least 12 characters, and every path of a finding must be a file of the change. A record may replace a rule of its own, when a later section of it amends an earlier one. A replacement by a record that is not accepted, such as a proposed one, gets a notice. Each point of a recommendation quotes the record, and each line of its evidence must be a whole line of an excerpt that was sent. A recommendation to amend the record without the changes to make gets a notice. An error rejects the item, and a notice keeps it for the reviewer.

`compadr assist <kind> <repository>` builds a request from the drift report and sends it:

```sh
compadr assist check path/to/repo --diff change.diff
git diff | compadr assist draft path/to/repo --diff -
compadr assist draft path/to/repo --base main --draft review
compadr assist consolidate path/to/repo --decision 37
compadr assist plain path/to/repo --decision 11 --request
compadr assist accept path/to/repo --decision 53
```

- `check` and `draft` read a unified diff against `--ref`, from a file or from the standard input, or the change from where `--ref` leaves `--base`, as a pull request shows it. The files of `assist.exclude` leave the change before the request is built; when no file is left, nothing is sent. `consolidate`, `plain` and `accept` read the decision of `--decision`. `accept` reads a proposed decision only, and recommends to accept it, to amend it then accept it, to keep it proposed or to withdraw it. A person decides. The page of a proposed decision in the console shows the recommendation that `--out` wrote as `<repository>.accept-<n>.json` in the folder of `--findings-dir` (or next to the report, for the development server), on the optional route `GET /api/reports/:id/recommendations/:n`. When the service recommends to accept it, the button "Accept as recommended" adds a commit to the local draft: the status of the record becomes accepted, with the date of the day, and the message names the recommendation. A person reviews the draft and publishes it as a pull request.
- `compadr-console` started with `COMPADR_ASSIST_URL` and `COMPADR_ASSIST_TOKEN` gives the page of each decision the button "Read in plain language". The server sends the record to the service only when a person clicks, and each new version costs. It keeps each version by the service and the text of the record, in `<cache-dir>/plain/`, so a record that does not change is never sent twice. To ask for a new version after an update of the service, delete that folder. It never sends a record that `assist.exclude` names. The routes are `GET /api/assist`, and `GET` or `POST /api/assist/:id/plain/:n`. A console without the service answers 404 on them and shows no button.
- With the same settings and a local draft, the Reviews page of `compadr-console` lists the branches that change the code without proposing a record, each with the button "Draft a decision from this change". The server sends the change of the branch since it left the followed reference, without the files that `assist.exclude` names, only when a person clicks. Each new draft costs. The record, with the status `proposed`, goes into a new local draft `propose-<branch>` that starts at the tip of the branch, so its pull request goes into the branch. The server keeps the outcome for the commit of the branch in `<cache-dir>/draft-decision/`, until a person discards the draft. While that draft exists, the page shows it instead of the button, and nothing is sent, even after a new commit on the branch. The routes are `GET` or `POST /api/assist/:id/draft`, where `:id` is the report of the branch.
- `draft --draft <name>` writes the record that the service suggests into a local draft, with the status `proposed`: the title, the rule in `compadr.rule`, one line per decision it amends or replaces, and the sections Context, Decision (one subsection per rule) and Consequences, written like the latest record of the draft. A person reviews the draft with `compadr draft show`, then publishes it with `compadr draft publish`. When the service says that the change only applies a decision in force, the command says why and writes nothing. The guard adds the notice `close-decision` when the title and the rule of the record share most of their words with a decision in force that it does not name: a person may amend that decision instead. The MCP tool `propose_decision` returns a record written the same way, and drafts it with the service under the option `assist`. A second run on the same draft reads the records that the first one wrote there.
- `--request` writes the request as JSON and sends nothing. The request never depends on a model, so it can be read before anything leaves the machine.
- The address of the service comes from `--url` or `COMPADR_ASSIST_URL`, and its token from `COMPADR_ASSIST_TOKEN` only. The address starts with `https://`, or with `http://` for a service on `localhost`, `127.0.0.1` or `[::1]`. Without an address, the command says that nothing was sent and exits with 0.
- The command posts the request to `<url>/v1/assist/<kind>`, reads the suggestion against its schema and runs the guard. It writes the suggestion without the rejected items, with every problem that the guard found. It exits with 1 when the service fails or when the guard rejects the whole suggestion.
- `@compadr/assist` holds the HTTP client and a fake client that answers without a model, for the tests.

## Rules in force

A feature can keep the rules in force of its main decision, consolidated along its amendments by the assist service and validated by a person. They live in `features.yml`, under the feature:

```yaml
billing:
  label: Billing
  main: 1
  rules:
    decision: 1
    validated: 2026-11-16
    model: compadr-assist-1
    promptVersion: consolidate-2
    chain: # the fingerprint of each record of the chain, as it was read
      - decision: 1
        hash: sha256:0123456789abcdef
    rules:
      - rule: An invoice is sent on the day of the order.
        sources: [2]
        quote: An invoice is sent on the day of the order.
    replaced: []
    conflicts: []
```

`model` names what wrote the rules, as the service states it. The assist service of Compadr signs with its version, such as `compadr-assist-1`: [compadr.io](https://compadr.io/docs/assist-versions/) lists the models and the instructions that each version is built on. `promptVersion` names the instructions of this kind of request.

```bash
compadr assist consolidate . --decision 1 --out /tmp/rules.json
compadr rules . --feature billing --suggestion /tmp/rules.json --draft console
```

- `compadr rules` takes the output of `compadr assist consolidate` for the main decision, made on the same reference: a request names its commit. The suggestion passes the guard again, and only the rules it keeps are written.
- The command writes `features.yml` on a new branch of a temporary clone, or adds the change to a local draft. Without `--push` or `--draft`, it shows the change and keeps nothing.
- The drift report gives the rules of each feature and `staleRecords`: the records of the chain that changed, joined or left it since the validation. `compadr check` then prints the notice `consolidated-rule-stale`, which never fails the check.
- The page of a declared feature in the console shows the validated rules, and says when they are stale. Until a person validates current rules, it also shows the consolidation that `compadr assist consolidate --decision <main> --out` wrote as `<repository>.consolidate-<main>.json` in the folder of `--findings-dir` (or next to the report, for the development server), on the optional route `GET /api/reports/:id/consolidations/:n`. The button "Validate these rules" adds the commit of `compadr rules` to the local draft. The server reads the consolidation from the folder, never from the request, and refuses one made on another commit. A person reviews the draft and publishes it as a pull request.

## Semantic check

`compadr check --semantic` asks the assist service whether a change breaks a decision in force, after the deterministic check. Nothing leaves the repository unless its `compadr.yml` turns the option on:

```yaml
assist:
  semantic: true # off by default
  exclude: # never sent: a file, or a folder and everything under it
    - config/secrets
```

- The change is the diff of `--diff`, or the commits since `--base`, as the pull request shows them. The files of `assist.exclude` leave the diff before the request is built, so their decisions are not sent either. A setting of `assist` that cannot be read keeps the option off.
- The address of the service comes from `COMPADR_ASSIST_URL` and its token from `COMPADR_ASSIST_TOKEN`. Without the option, an address or a token, the command sends nothing and says why.
- Each finding that the guard keeps is a notice (`semantic-violated` or `semantic-at-risk`) on the line of the change, with the rule it quotes and the explanation of the model. A notice never fails the check: the exit code stays that of the deterministic check, even when the service fails.
- When the customer has used the AI credits of its month, up to its cap, the service answers 402 and calls no model. `check --semantic` then says that the semantic check was skipped and why, and keeps the exit code of the deterministic check. With `--comment`, the comment of the pull request says that the check did not run. The console, `compadr assist` and the MCP tools give the same reason.
- `--comment <file>` writes the findings as the Markdown of a pull request comment, when something was sent. The text of the model goes in without HTML and without mentions.

```yaml
permissions:
  contents: read
  pull-requests: write
steps:
  - uses: actions/checkout@<sha>
    with:
      fetch-depth: 0
  - run: >-
      npx compadr check . --base origin/${{ github.base_ref }} --format github
      --semantic --comment "$RUNNER_TEMP/compadr-comment.md"
    env:
      COMPADR_ASSIST_URL: ${{ vars.COMPADR_ASSIST_URL }}
      COMPADR_ASSIST_TOKEN: ${{ secrets.COMPADR_ASSIST_TOKEN }}
  - if: always()
    run: |
      if [ -f "$RUNNER_TEMP/compadr-comment.md" ]; then
        gh pr comment ${{ github.event.pull_request.number }} \
          --body-file "$RUNNER_TEMP/compadr-comment.md" --edit-last --create-if-none
      fi
    env:
      GH_TOKEN: ${{ github.token }}
```

`--findings <file>` writes the findings as JSON, when the service answered. The JSON Schema is in [`packages/format/schema/semantic-findings.schema.json`](../packages/format/schema/semantic-findings.schema.json). The Drift page of the console shows them under the signals, as "Suggested by a model", with the quoted rule, the place in the change and the explanation. The console reads them on the optional route `GET /api/reports/:id/findings`. The development server reads `<id>.findings.json` next to the report `<id>.json`, and `compadr console` reads the files of `--findings-dir`, named after each repository. When the findings are for another commit than the report, the page says so.

```bash
npx compadr check . --base origin/main --semantic --findings reports/shop.findings.json
npx compadr console ../shop --findings-dir reports
```

A pull request from a fork gets no secret, so its check runs without the semantic part. `check_change_against_decisions` of the MCP server takes the same option: with `"semantic": true`, its answer holds what the service says, under the same settings.

## Read-only guarantee

The engine never writes to the repository it analyses. It runs only the git subcommands listed in `packages/engine/src/git.ts` (`blame`, `diff`, `grep`, `log`, `ls-tree`, `merge-base`, `rev-parse`, `show`) and refuses the options that can write a file or start a program. `git diff` runs only with `--no-ext-diff` and `--no-textconv`.

The command line and the console server write the corrections in their own clones only: a temporary clone for a new branch, or the clone of the drafts under the cache folder. In the analysed repository it runs `git clone`, `git fetch`, `git rev-parse` and `git config --get`, which change nothing there.
