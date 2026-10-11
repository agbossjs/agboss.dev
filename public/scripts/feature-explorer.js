/*
 * Feature explorer on the home page. Every snippet is a trimmed copy of real code from the framework
 * repo (examples/job-scout and the package tests) — keep it that way: no invented APIs.
 * Package subpaths mirror the framework's exports (graphcompose/core → agboss/core, …).
 */
(function () {
	var SNIPPETS = {
		workflow: {
			file: "job-scout.workflow.ts",
			code: [
				'import { Workflow, provide } from "agboss/core";',
				'import { from } from "agboss/router";',
				"",
				"@Workflow({",
				'  name: "job-scout",',
				'  version: "2.0.0",',
				"  flow: [",
				"    from(ChatWorkflowStart).next(MainRouter),",
				"    from(MainRouter).routes(Profiler, Scout, Shortlist, ChatWorkflowFinish),",
				"    from(Profiler, Scout, Shortlist).next(MainRouter),",
				"  ],",
				"  mcp: [ShortlistServer],",
				"  providers: [JobFitJudge, provide(JOB_SEARCH, jobSearchConfig)],",
				"})",
				"export class JobScout {}"
			]
		},
		agent: {
			file: "scout.agent.ts",
			code: [
				'import { Agent } from "agboss/core";',
				"",
				"@Agent({",
				'  name: "scout",',
				'  description: "Searches Greenhouse with the agreed brief and returns the best-fitting jobs",',
				'  promptUrls: ["./scout.prompt.md"],',
				'  model: "moonshotai/kimi-k2.6",',
				'  thinking: "none",',
				"  maxTokens: 4000,",
				"  tools: [GreenhouseJobs],",
				'  rag: [{ use: CompanyNotes, mode: "tool" }],',
				"})",
				"export class Scout {}"
			]
		},
		router: {
			file: "main.router.ts",
			code: [
				'import { Router } from "agboss/router";',
				"",
				"@Router({",
				'  name: "main",',
				'  description: "Sends the message to the right agent, or sends the answer",',
				'  prompt: "Pick who handles the job seeker\'s message next.",',
				'  model: "typesafe/jev-1.13",',
				"  maxVisits: 3,",
				"  routes: [",
				'    { prompt: "Reading the resume and proposing a search brief", target: Profiler },',
				'    { prompt: "Finding and ranking jobs", target: Scout },',
				'    { prompt: "Saving chosen jobs to the shortlist", target: Shortlist },',
				'    { prompt: "Stop and send the answer", target: ChatWorkflowFinish },',
				"  ],",
				"})",
				"export class MainRouter {}"
			]
		},
		tool: {
			file: "read-resume.tool.ts",
			code: [
				'import { Tool, type ToolHandler } from "agboss/tool";',
				"",
				"@Tool({",
				'  name: "read_resume",',
				'  description: "Read the user\'s resume from a local file (.pdf, .md or .txt)",',
				"  input: ResumeRequest,",
				"  output: ResumeText,",
				"  deps: [ResumeReader],",
				"})",
				"export class ReadResume implements ToolHandler<ResumeRequest, ResumeText> {",
				"  constructor(private readonly reader: ResumeReader) {}",
				"",
				"  run({ path }: ResumeRequest): Promise<ResumeText> {",
				"    return this.reader.read(path);",
				"  }",
				"}"
			]
		},
		mcp: {
			file: "shortlist.server.ts",
			code: [
				'import { McpServer, McpServerClient } from "agboss/mcp";',
				"",
				"// The server tools this workflow uses — checked against the server at startup.",
				"const tools = {",
				"  read_text_file: { input: FileRead, output: FileContent },",
				"  write_file: { input: FileWrite, output: FileWritten },",
				"};",
				"",
				"@McpServer({",
				'  name: "shortlist",',
				'  transport: "stdio",',
				"  command: process.execPath,",
				"  args: [FILESYSTEM_SERVER, SHORTLIST_DIR],",
				"  tools,",
				"})",
				"export class ShortlistServer extends McpServerClient<typeof tools> {}"
			]
		},
		rag: {
			file: "company-notes.rag.ts",
			code: [
				'import { Rag, SqliteFtsConnector, type FtsOptions } from "agboss/rag";',
				'import { InjectionToken } from "agboss/core";',
				"",
				'export const NOTES_INDEX = new InjectionToken<FtsOptions>("NOTES_INDEX");',
				"",
				"// The user's notes about companies — full-text search over SQLite FTS5 (BM25).",
				"@Rag({",
				'  name: "company_notes",',
				'  description: "The user\'s notes about companies: stack, culture, what people say",',
				"  topK: 3,",
				"  deps: [NOTES_INDEX],",
				"})",
				"export class CompanyNotes extends SqliteFtsConnector {}"
			]
		},
		provider: {
			file: "openrouter.model-provider.ts",
			code: [
				'import { ModelProvider, OpenRouterProvider, EnvironmentVariable, ModelCost, RetryPolicy, ModelFailure } from "agboss/models";',
				'import { minutes, seconds } from "agboss/units";',
				"",
				"@ModelProvider({",
				'  name: "openrouter",',
				"  serves: [/.*/],",
				'  apiKey: EnvironmentVariable.named("OPENROUTER_API_KEY", { secret: true }),',
				"  timeout: minutes(2),",
				"  cost: ModelCost.fromResponse(),",
				"  retryPolicy: RetryPolicy.exponential({",
				"    maxAttempts: 3,",
				"    initialDelay: seconds(1),",
				"    maxDelay: seconds(20),",
				"    retryOn: [ModelFailure.Timeout, ModelFailure.RateLimited, ModelFailure.ServerError],",
				"  }),",
				"  circuitBreakerPolicy: { failureThreshold: 5, window: minutes(1), openFor: seconds(30) },",
				"})",
				"export class OpenRouterModelProvider extends OpenRouterProvider {}"
			]
		},
		di: {
			file: "job-fit.service.ts",
			code: [
				'import { Injectable, InjectionToken, ROUTER_FACTORY, provide } from "agboss/core";',
				"",
				'export const JOB_SEARCH = new InjectionToken<JobSearch>("JOB_SEARCH");',
				"",
				"// A service: the container creates it and hands it its own dependencies.",
				"@Injectable({ deps: [ROUTER_FACTORY] })",
				"export class JobFitJudge {",
				"  constructor(routers: (name: string) => Router) {}",
				"}",
				"",
				"// A tool declares what it needs …",
				'@Tool({ name: "greenhouse_jobs", /* … */ deps: [JobFitJudge, JOB_SEARCH] })',
				"export class GreenhouseJobs {",
				"  constructor(judge: JobFitJudge, private readonly search: JobSearch) {}",
				"}",
				"",
				"// … and the workflow decides what it gets.",
				"providers: [JobFitJudge, provide(JOB_SEARCH, jobSearchConfig)],"
			]
		},
		dto: {
			file: "greenhouse-jobs.dto.ts",
			code: [
				'import { Integer, ListOf, Text } from "agboss/dto";',
				"",
				"// What the model fills in — validated before the tool runs.",
				"export class JobQuery {",
				"  @Text({",
				'    prompt: "What the user wants: role, languages, seniority, deal-breakers",',
				"    minLength: 20,",
				"  })",
				"  profile!: string;",
				"",
				'  @ListOf(Text, { prompt: "Places or cities", minItems: 1 })',
				"  locations!: string[];",
				"",
				'  @ListOf(Text, { prompt: "Drop jobs whose title has any, e.g. Manager", default: [] })',
				"  excludeTitleWords!: string[];",
				"",
				'  @Integer({ prompt: "How many jobs to return", min: 1, max: 50, default: 20 })',
				"  count!: number;",
				"}"
			]
		},
		guards: {
			file: "job-scout.workflow.ts",
			code: [
				"export const GUARDS = {",
				"  input: {",
				'    prompt_injection: { threshold: 0.7, refusal: "I can\'t help with that request." },',
				"  },",
				"  output: {",
				'    pii: { threshold: 0.7, refusal: "The answer contained personal data and was withheld." },',
				"  },",
				"};",
				"",
				"@Workflow({",
				'  name: "job-scout",',
				"  flow: [/* … */],",
				"  guards: GUARDS,",
				"})",
				"export class JobScout {}"
			]
		},
		approval: {
			file: "save-shortlist.mcp.ts",
			code: [
				'import { McpTool } from "agboss/mcp";',
				'import { TerminalUserChannel } from "agboss/channels";',
				"",
				"// A write the user approves: the run pauses on the channel and resumes after the answer.",
				"@McpTool({",
				"  server: ShortlistServer,",
				'  name: "save_shortlist",',
				'  description: "Save the jobs the user chose to their shortlist",',
				"  channel: TerminalUserChannel,",
				"  input: ChosenJobs,",
				"  output: SavedJobs,",
				"  deps: [ShortlistServer, SHORTLIST],",
				"})",
				"export class SaveShortlist implements ToolHandler<ChosenJobs, SavedJobs> {",
				"  constructor(private readonly server: ShortlistServer, private readonly file: string) {}",
				"  /* … */",
				"}"
			]
		},
		testing: {
			file: "flow.test.ts",
			code: [
				'import { testWith, routeTo, replyWith } from "agboss/testing";',
				"",
				"const test = testWith(JobScout);",
				"",
				'test("the router sends the message to an agent and the reply back", async ({ app, mockLlm }) => {',
				"  mockLlm(MainRouter).thenReturn(routeTo(Profiler), routeTo(ChatWorkflowFinish));",
				'  mockLlm(Profiler).thenReturn(replyWith("Brief: senior backend, Israel"));',
				"",
				'  const result = await app.execute(ChatWorkflowStart, { text: "propose a search brief" });',
				"",
				"  expect(result).toFollowPath([",
				"    ChatWorkflowStart, MainRouter, Profiler, MainRouter, ChatWorkflowFinish,",
				"  ]);",
				'  expect(result).toFinishWith(ChatWorkflowFinish, { text: "Brief: senior backend, Israel" });',
				"});"
			]
		},
		ab: {
			file: "profiles/job-scout/scout-low-thinking.yaml",
			code: [
				"# Does the scout rank jobs better with a little thinking?",
				"# A profile changes only what it names — no code change, its own version.",
				"profile: scout-low-thinking",
				"version: 2.0.0-low-thinking",
				"agents:",
				"  scout:",
				"    thinking: low",
				"",
				"# Run both on the same golden set and compare quality, cost and latency:",
				"#   npm run compare -- --profiles base,scout-low-thinking --golden core"
			]
		},
		tracing: {
			file: "run-logger.ts",
			code: [
				'import { Injectable, type OnAgentStart, type OnToolEnd } from "agboss/core";',
				"",
				"// Every run is traced into your self-hosted Langfuse when",
				"// LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL are set.",
				"// Need your own sink too? Implement the hooks:",
				"@Injectable()",
				"export class RunLogger implements OnAgentStart, OnToolEnd {",
				"  async onAgentStart(ctx: { name: string }) {",
				"    log.info(`agent ${ctx.name} started`);",
				"  }",
				"",
				"  async onToolEnd(ctx: { toolName: string }) {",
				"    log.info(`tool ${ctx.toolName} finished`);",
				"  }",
				"}",
				"",
				'@Workflow({ name: "job-scout", flow: [/* … */], providers: [RunLogger] })',
				"export class JobScout {}"
			]
		},
		cost: {
			file: "job-scout.workflow.ts",
			code: [
				'import { Workflow, WorkflowSettings, type WorkflowDefinition } from "agboss/core";',
				'import { usd } from "agboss/units";',
				"",
				'@Workflow({ name: "job-scout", flow: [/* … */] })',
				"export class JobScout implements WorkflowDefinition {",
				"  settings(): WorkflowSettings {",
				"    return WorkflowSettings.builder()",
				"      .limits({",
				"        perRun: { steps: 12, cost: usd(0.1) },",
				"        perDay: { cost: usd(1) },",
				"      })",
				"      .build();",
				"  }",
				"}"
			]
		}
	};

	var ABOUT = {
		workflow: "The workflow is the one place where the graph exists. <code>flow</code> says who runs after whom; everything it names is a plain class. Adding a route or swapping an agent is a one-line change, and the whole graph is assembled and checked before the first run.",
		agent: "An agent is a class: model, prompt file, tools and knowledge bases in one decorator. The prompt lives in Markdown next to it, and limits like <code>maxTokens</code> and <code>thinking</code> are set per agent — a cheap agent stays cheap.",
		router: "A router decides where the conversation goes next. Each route is a plain-language description of when to take it, and <code>maxVisits</code> stops a cycle from running forever. Routing runs on Jev by default — a small model built for decisions, not for chat.",
		tool: "A tool is a typed function the model can call. Input and output are DTO classes, so the arguments are validated before <code>run</code> is called. Dependencies come through the constructor, so tests can hand it a fake.",
		mcp: "Point at any MCP server and list the tools you use, with their types. They are checked against the server at startup, so a renamed or changed tool fails fast instead of in the middle of a run.",
		rag: "A knowledge base is a class too. Attach it to an agent and the agent can search it when it needs to. The reference connector is SQLite full-text search (BM25) — no vector database to run.",
		provider: "Model access is configured in code: which models a provider serves, where the key comes from, timeouts, retries and a circuit breaker. The cost of each call is taken from the provider's response, so spend is counted per call.",
		di: "The same idea as Angular or NestJS: components ask for what they need in the constructor, and the workflow's <code>providers</code> decide what they get. Swap a real API for a fake in one place — no monkey-patching in tests.",
		dto: "The model fills in a class, not a free-form JSON blob. Every field carries the prompt that tells the model what goes there, plus its limits; input that breaks them is rejected before your code runs.",
		guards: "Guards check every message coming in and every answer going out: prompt injection on the way in, personal data on the way out. Each has a threshold and the refusal the user sees — set once for the whole workflow.",
		approval: "Give a tool a channel and every call to it waits for a person. The run pauses with its state saved and resumes after the answer — for anything that writes, pays or sends.",
		testing: "Tests script the models instead of calling them: each one gets its replies in order, and you assert on the path the graph took and how it finished. No network, no API keys, the same result every time.",
		ab: "A profile overrides a setting — a model, a thinking level, a prompt — and gets its own version. Run the base and the profile on the same golden set of real tasks and compare the results before you ship the change.",
		tracing: "Set three environment variables and every run — graph steps, model calls with their prompts and tokens, tool calls — lands in your self-hosted Langfuse. Nothing leaves your machine. For your own sinks, implement only the hooks you need.",
		cost: "Limits are part of the workflow: steps and dollars per run, dollars per day. A run that reaches its limit is stopped — instead of a surprise on the invoice."
	};

	var KW = /^(import|from|export|class|const|let|new|return|await|async|private|readonly|implements|extends|type|test|expect|true|false)$/;

	function esc(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function highlightYaml(line) {
		if (/^\s*#/.test(line)) { return '<span class="tok-com">' + esc(line) + "</span>"; }
		var m = /^(\s*)([A-Za-z_][\w-]*)(:)(.*)$/.exec(line);
		if (!m) { return esc(line); }
		return m[1] + '<span class="tok-kw">' + m[2] + "</span>" + m[3] + '<span class="tok-str">' + esc(m[4]) + "</span>";
	}

	function highlightTs(line) {
		var re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|`[^`]*`)|(@[A-Za-z]+)|\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
		var out = "";
		var last = 0;
		var m;
		while ((m = re.exec(line))) {
			out += esc(line.slice(last, m.index));
			if (m[1]) {
				out += '<span class="tok-com">' + esc(m[1]) + "</span>";
			} else if (m[2]) {
				out += '<span class="tok-str">' + esc(m[2]) + "</span>";
			} else if (m[3]) {
				out += '<span class="tok-dec">' + esc(m[3]) + "</span>";
			} else if (KW.test(m[4])) {
				out += '<span class="tok-kw">' + m[4] + "</span>";
			} else if (/^[A-Z]/.test(m[4])) {
				out += '<span class="tok-cls">' + m[4] + "</span>";
			} else {
				out += m[4];
			}
			last = re.lastIndex;
		}
		return out + esc(line.slice(last));
	}

	function render(snip) {
		var hl = /\.ya?ml$/.test(snip.file) ? highlightYaml : highlightTs;
		return snip.code.map(hl).join("\n");
	}

	function init() {
		var root = document.getElementById("agx");
		if (!root) { return; }
		var fileEl = document.getElementById("agx-file");
		var srcEl = document.getElementById("agx-src");
		var win = root.querySelector(".agx-win");
		var body = root.querySelector(".agx-body");
		var aboutEl = document.getElementById("agx-about");
		var items = root.querySelectorAll(".agx-item");
		var subs = root.querySelectorAll(".agx-sub");
		var current = null;
		var codeBox = root.querySelector(".agx-code");
		var narrow = window.matchMedia("(max-width: 59.99rem)");

		// On phones the list and the code are one column: put the example right under the chosen card,
		// so the result of a tap is on screen. On desktop the code sits in its own column.
		function placeCode(scroll) {
			var active = root.querySelector(".agx-item.is-active");
			if (narrow.matches && active) {
				if (active.nextElementSibling !== codeBox) { active.after(codeBox); }
				if (scroll) {
					var top = active.getBoundingClientRect().top;
					var nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sl-nav-height")) * 16 || 64;
					if (top < nav || top > window.innerHeight * 0.25) {
						window.scrollTo({ top: window.scrollY + top - nav - 12, behavior: "smooth" });
					}
				}
			} else if (codeBox.parentElement !== root) {
				root.appendChild(codeBox);
			}
		}

		// Size the window once for the tallest snippet: no scrollbars, no jumps when switching.
		function fitHeight() {
			if (narrow.matches) {
				// Phones: the example sits under its card, so let each one take its own height.
				body.style.minHeight = "0px";
				aboutEl.style.minHeight = "0px";
				return;
			}
			var tallest = 0;
			var tallestAbout = 0;
			body.style.minHeight = "0px";
			aboutEl.style.minHeight = "0px";
			Object.keys(SNIPPETS).forEach(function (key) {
				srcEl.innerHTML = render(SNIPPETS[key]);
				aboutEl.innerHTML = ABOUT[key] || "";
				tallest = Math.max(tallest, body.offsetHeight);
				tallestAbout = Math.max(tallestAbout, aboutEl.offsetHeight);
			});
			body.style.minHeight = tallest + "px";
			aboutEl.style.minHeight = tallestAbout + "px";
			srcEl.innerHTML = render(SNIPPETS[current]);
			aboutEl.innerHTML = ABOUT[current] || "";
		}

		function show(key) {
			if (key === current || !SNIPPETS[key]) { return; }
			current = key;
			win.classList.add("is-swapping");
			setTimeout(function () {
				fileEl.textContent = SNIPPETS[key].file;
				srcEl.innerHTML = render(SNIPPETS[key]);
				aboutEl.innerHTML = ABOUT[key] || "";
				win.classList.remove("is-swapping");
			}, 120);
		}

		items.forEach(function (item) {
			var tab = item.querySelector(".agx-tab");
			tab.addEventListener("click", function () {
				items.forEach(function (i) { i.classList.toggle("is-active", i === item); });
				placeCode(true);
				var activeSub = item.querySelector(".agx-sub.is-active");
				show(activeSub ? activeSub.getAttribute("data-key") : tab.getAttribute("data-key"));
			});
		});

		subs.forEach(function (sub) {
			sub.addEventListener("click", function () {
				var owner = sub.closest(".agx-item");
				items.forEach(function (i) { i.classList.toggle("is-active", i === owner); });
				subs.forEach(function (s) { s.classList.toggle("is-active", s === sub); });
				placeCode(true);
				show(sub.getAttribute("data-key"));
			});
		});

		current = "workflow";
		fileEl.textContent = SNIPPETS.workflow.file;
		placeCode(false);
		fitHeight();

		var resizeTimer;
		window.addEventListener("resize", function () {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(function () { placeCode(false); fitHeight(); }, 150);
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
