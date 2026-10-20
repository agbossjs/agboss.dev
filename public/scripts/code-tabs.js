/**
 * Angular-docs-style multi-file code tabs for Starlight / Expressive Code blocks.
 * Consecutive `.expressive-code` blocks in `.sl-markdown-content` are grouped into a single
 * tabbed code viewer where Tab 1 is the primary file and subsequent tabs show the supporting
 * context (DTOs, services, prompts, workflow wiring, and tests).
 */
(function () {
	function labelFor(ec, index) {
		var titleEl = ec.querySelector(".frame > .header .title");
		if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
			return titleEl.textContent.trim();
		}
		var pre = ec.querySelector("pre[data-language]");
		var lang = pre ? pre.getAttribute("data-language") : "ts";
		if (lang === "bash" || lang === "sh") { return "terminal.sh"; }
		if (lang === "yaml" || lang === "yml") { return "profile.yaml"; }
		if (lang === "md" || lang === "markdown") { return "prompt.md"; }
		return index === 0 ? "main." + lang : "context-" + (index + 1) + "." + lang;
	}

	function isIgnorableNode(node) {
		if (!node) { return false; }
		if (node.nodeType === 8) { return true; } // Comment node (e.g. <!-- snippet-context -->)
		if (node.nodeType === 3 && !node.textContent.trim()) { return true; } // Whitespace text
		return false;
	}

	function nextSignificantSibling(el) {
		var cur = el.nextSibling;
		while (cur && isIgnorableNode(cur)) {
			cur = cur.nextSibling;
		}
		return cur;
	}

	function initCodeTabs() {
		var container = document.querySelector(".sl-markdown-content");
		if (!container) { return; }

		var blocks = Array.prototype.slice.call(
			container.querySelectorAll(":scope > .expressive-code")
		);
		var visited = new Set();

		blocks.forEach(function (block) {
			if (visited.has(block)) { return; }

			var group = [block];
			visited.add(block);

			var cursor = block;
			while (true) {
				var next = nextSignificantSibling(cursor);
				if (next && next.nodeType === 1 && next.classList.contains("expressive-code")) {
					group.push(next);
					visited.add(next);
					cursor = next;
				} else {
					break;
				}
			}

			var hasExplicitTitle = group.some(function (ec) {
				var t = ec.querySelector(".frame > .header .title");
				return Boolean(t && t.textContent && t.textContent.trim());
			});

			if (group.length < 2 && !hasExplicitTitle) {
				return;
			}

			var wrapper = document.createElement("div");
			wrapper.className = "ag-code-tabs";

			var tablist = document.createElement("div");
			tablist.className = "ag-code-tablist";
			tablist.setAttribute("role", "tablist");

			tablist.addEventListener("wheel", function (e) {
				if (tablist.scrollWidth > tablist.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
					e.preventDefault();
					tablist.scrollLeft += e.deltaY;
				}
			}, { passive: false });

			group[0].parentNode.insertBefore(wrapper, group[0]);
			wrapper.appendChild(tablist);

			var rawLabels = group.map(function (ec, idx) {
				return labelFor(ec, idx);
			});
			var bases = rawLabels.map(function (p) {
				var parts = p.split("/");
				return parts[parts.length - 1];
			});
			var shortLabels = rawLabels.map(function (p, i) {
				var base = bases[i];
				var dup = bases.some(function (b, j) { return j !== i && b === base; });
				if (!dup) { return base; }
				var parts = p.split("/");
				return parts.length >= 2 ? parts[parts.length - 2] + "/" + base : p;
			});

			var buttons = [];

			group.forEach(function (ec, idx) {
				wrapper.appendChild(ec);
				if (idx > 0) {
					ec.setAttribute("hidden", "");
				} else {
					ec.removeAttribute("hidden");
				}

				var btn = document.createElement("button");
				btn.type = "button";
				btn.className = "ag-code-tab" + (idx === 0 ? " is-active" : "");
				btn.setAttribute("role", "tab");
				btn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
				btn.title = rawLabels[idx];

				var nameSpan = document.createElement("span");
				nameSpan.textContent = shortLabels[idx];
				btn.appendChild(nameSpan);

				btn.addEventListener("click", function () {
					buttons.forEach(function (b, bIdx) {
						var active = bIdx === idx;
						b.classList.toggle("is-active", active);
						b.setAttribute("aria-selected", active ? "true" : "false");
					});
					btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
					group.forEach(function (pane, pIdx) {
						if (pIdx === idx) {
							pane.removeAttribute("hidden");
						} else {
							pane.setAttribute("hidden", "");
						}
					});
				});

				buttons.push(btn);
				tablist.appendChild(btn);
			});
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initCodeTabs);
	} else {
		initCodeTabs();
	}
})();
